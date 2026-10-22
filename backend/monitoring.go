package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

const monitoringSampleLimit = 5000

type monitoringResponseWriter struct {
	http.ResponseWriter
	status int
	bytes  int
}

func (w *monitoringResponseWriter) WriteHeader(status int) {
	if w.status != 0 {
		return
	}
	w.status = status
	w.ResponseWriter.WriteHeader(status)
}

func (w *monitoringResponseWriter) Write(body []byte) (int, error) {
	if w.status == 0 {
		w.WriteHeader(http.StatusOK)
	}
	n, err := w.ResponseWriter.Write(body)
	w.bytes += n
	return n, err
}

type apiRouteMetric struct {
	Count       int64
	Errors      int64
	TotalMicros int64
	MaxMicros   int64
}

type apiErrorSample struct {
	At        time.Time `json:"at"`
	RequestID string    `json:"requestId"`
	Method    string    `json:"method"`
	Path      string    `json:"path"`
	Status    int       `json:"status"`
	LatencyMS float64   `json:"latencyMs"`
}

type apiMonitoring struct {
	mu          sync.Mutex
	startedAt   time.Time
	total       int64
	active      int64
	status      map[int]int64
	routes      map[string]*apiRouteMetric
	durationsUS []int64
	recent      []apiErrorSample
}

func newAPIMonitoring() *apiMonitoring {
	return &apiMonitoring{startedAt: time.Now().UTC(), status: map[int]int64{}, routes: map[string]*apiRouteMetric{}}
}

func (a *app) apiMonitoring() *apiMonitoring {
	if a.monitoring == nil {
		a.monitoring = newAPIMonitoring()
	}
	return a.monitoring
}

func normalizeMonitoringPath(path string) string {
	parts := strings.Split(strings.Trim(path, "/"), "/")
	for i, part := range parts {
		if i == 0 || part == "api" || part == "admin" || part == "pos" || part == "sessions" {
			continue
		}
		if strings.HasPrefix(part, "sale-") || strings.HasPrefix(part, "payment-") || strings.HasPrefix(part, "product-") || strings.HasPrefix(part, "pos-") || len(part) >= 24 {
			parts[i] = ":id"
		}
	}
	return "/" + strings.Join(parts, "/")
}

func (a *app) observeAPIRequest(r *http.Request, w *monitoringResponseWriter, startedAt time.Time) {
	if !strings.HasPrefix(r.URL.Path, "/api/") {
		return
	}
	status := w.status
	if status == 0 {
		status = http.StatusOK
	}
	duration := time.Since(startedAt)
	requestID, _ := r.Context().Value(requestIDContextKey).(string)
	path := normalizeMonitoringPath(r.URL.Path)
	metric := a.apiMonitoring()
	metric.mu.Lock()
	metric.total++
	metric.status[status]++
	key := r.Method + " " + path
	route := metric.routes[key]
	if route == nil {
		route = &apiRouteMetric{}
		metric.routes[key] = route
	}
	micros := duration.Microseconds()
	route.Count++
	route.TotalMicros += micros
	if micros > route.MaxMicros {
		route.MaxMicros = micros
	}
	if status >= 400 {
		route.Errors++
	}
	metric.durationsUS = append(metric.durationsUS, micros)
	if len(metric.durationsUS) > monitoringSampleLimit {
		metric.durationsUS = append([]int64(nil), metric.durationsUS[len(metric.durationsUS)-monitoringSampleLimit:]...)
	}
	if status == http.StatusConflict || status == http.StatusTooManyRequests || status >= 500 {
		metric.recent = append(metric.recent, apiErrorSample{At: time.Now().UTC(), RequestID: requestID, Method: r.Method, Path: path, Status: status, LatencyMS: float64(micros) / 1000})
		if len(metric.recent) > 100 {
			metric.recent = append([]apiErrorSample(nil), metric.recent[len(metric.recent)-100:]...)
		}
	}
	metric.mu.Unlock()
	if status == http.StatusConflict || status == http.StatusTooManyRequests || status >= 500 || duration >= 2*time.Second {
		raw, _ := json.Marshal(map[string]any{"event": "api_request", "requestId": requestID, "method": r.Method, "path": path, "status": status, "latencyMs": float64(micros) / 1000, "bytes": w.bytes})
		log.Print(string(raw))
	}
}

func percentile(values []int64, percent float64) float64 {
	if len(values) == 0 {
		return 0
	}
	sort.Slice(values, func(i, j int) bool { return values[i] < values[j] })
	index := int(float64(len(values)-1)*percent + 0.5)
	return float64(values[index]) / 1000
}

func (a *app) writePOSMonitoring(w http.ResponseWriter, r *http.Request, user adminUser) {
	if !requirePOSOwner(w, user) {
		return
	}
	m := a.apiMonitoring()
	m.mu.Lock()
	durations := append([]int64(nil), m.durationsUS...)
	recent := append([]apiErrorSample(nil), m.recent...)
	statusCounts := map[string]int64{}
	for status, count := range m.status {
		statusCounts[strconv.Itoa(status)] = count
	}
	type routeItem struct {
		Route     string  `json:"route"`
		Count     int64   `json:"count"`
		Errors    int64   `json:"errors"`
		AverageMS float64 `json:"averageMs"`
		MaximumMS float64 `json:"maximumMs"`
	}
	routes := make([]routeItem, 0, len(m.routes))
	for name, value := range m.routes {
		average := float64(0)
		if value.Count > 0 {
			average = float64(value.TotalMicros) / float64(value.Count) / 1000
		}
		routes = append(routes, routeItem{Route: name, Count: value.Count, Errors: value.Errors, AverageMS: average, MaximumMS: float64(value.MaxMicros) / 1000})
	}
	startedAt, total := m.startedAt, m.total
	m.mu.Unlock()
	sort.Slice(routes, func(i, j int) bool { return routes[i].MaximumMS > routes[j].MaximumMS })
	if len(routes) > 20 {
		routes = routes[:20]
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{
		"startedAt": startedAt, "uptimeSeconds": int64(time.Since(startedAt).Seconds()), "totalRequests": total,
		"statusCounts":  statusCounts,
		"watched":       map[string]int64{"409": statusCounts["409"], "429": statusCounts["429"], "500": statusCounts["500"]},
		"latencyMs":     map[string]float64{"p50": percentile(append([]int64(nil), durations...), .50), "p95": percentile(append([]int64(nil), durations...), .95), "p99": percentile(append([]int64(nil), durations...), .99)},
		"slowestRoutes": routes, "recentErrors": recent,
		"requestId": fmt.Sprint(r.Context().Value(requestIDContextKey)),
	})
}
