package main

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	texttospeech "cloud.google.com/go/texttospeech/apiv1"
	"cloud.google.com/go/texttospeech/apiv1/texttospeechpb"
	"golang.org/x/sync/singleflight"
)

const (
	defaultGoogleTTSVoice        = "th-TH-Standard-A"
	defaultGoogleTTSSpeakingRate = 0.82
	googleTTSLanguageCode        = "th-TH"
	googleTTSMonthlySafetyLimit  = int64(3_900_000)
	googleTTSStandardFreeLimit   = int64(4_000_000)
	googleTTSMaxTextCharacters   = 1_000
	ttsCacheVersion              = "v2"
)

var (
	errTTSDisabled = errors.New("google text-to-speech is disabled")
	errTTSLimit    = errors.New("google text-to-speech monthly safety limit reached")
	errTTSInvalid  = errors.New("invalid announcement text")
)

type speechSynthesizer interface {
	Synthesize(context.Context, string, string) ([]byte, error)
}

type googleSpeechSynthesizer struct {
	once         sync.Once
	client       *texttospeech.Client
	err          error
	speakingRate float64
}

func (g *googleSpeechSynthesizer) Synthesize(ctx context.Context, text, voice string) ([]byte, error) {
	g.once.Do(func() {
		g.client, g.err = texttospeech.NewClient(ctx)
	})
	if g.err != nil {
		return nil, g.err
	}
	response, err := g.client.SynthesizeSpeech(ctx, &texttospeechpb.SynthesizeSpeechRequest{
		Input: &texttospeechpb.SynthesisInput{
			InputSource: &texttospeechpb.SynthesisInput_Text{Text: text},
		},
		Voice: &texttospeechpb.VoiceSelectionParams{
			LanguageCode: googleTTSLanguageCode,
			Name:         voice,
		},
		AudioConfig: &texttospeechpb.AudioConfig{
			AudioEncoding: texttospeechpb.AudioEncoding_MP3,
			SpeakingRate:  g.speakingRate,
			Pitch:         0,
		},
	})
	if err != nil {
		return nil, err
	}
	if len(response.AudioContent) == 0 {
		return nil, errors.New("google text-to-speech returned empty audio")
	}
	return response.AudioContent, nil
}

type ttsResult struct {
	Audio      []byte
	Cached     bool
	Characters int64
	Used       int64
}

type ttsUsageSnapshot struct {
	Available         bool    `json:"available"`
	Enabled           bool    `json:"enabled"`
	Period            string  `json:"period"`
	Characters        int64   `json:"characters"`
	SafetyLimit       int64   `json:"safetyLimit"`
	ProviderFreeLimit int64   `json:"providerFreeLimit"`
	Remaining         int64   `json:"remaining"`
	Percent           float64 `json:"percent"`
	LimitReached      bool    `json:"limitReached"`
	Voice             string  `json:"voice"`
	SpeakingRate      float64 `json:"speakingRate"`
	UpdatedAt         string  `json:"updatedAt"`
	Error             string  `json:"error,omitempty"`
}

type ttsService struct {
	db           *sql.DB
	enabled      bool
	voice        string
	speakingRate float64
	cacheDir     string
	monthlyLimit int64
	synthesizer  speechSynthesizer
	reserveUsage func(context.Context, int64) (int64, bool, error)

	cacheMu sync.RWMutex
	cache   map[string][]byte
	group   singleflight.Group
}

func newTTSService(db *sql.DB) *ttsService {
	voice := strings.TrimSpace(os.Getenv("GOOGLE_TTS_VOICE"))
	if voice == "" {
		voice = defaultGoogleTTSVoice
	}
	speakingRate := defaultGoogleTTSSpeakingRate
	if configured := strings.TrimSpace(os.Getenv("GOOGLE_TTS_SPEAKING_RATE")); configured != "" {
		if parsed, err := strconv.ParseFloat(configured, 64); err == nil && parsed >= 0.25 && parsed <= 4 {
			speakingRate = parsed
		}
	}
	cacheDir := strings.TrimSpace(os.Getenv("GOOGLE_TTS_CACHE_DIR"))
	if cacheDir == "" {
		cacheDir = filepath.Join(os.TempDir(), "livematch-tts-cache")
	}
	service := &ttsService{
		db:           db,
		enabled:      envBool("GOOGLE_TTS_ENABLED", false),
		voice:        voice,
		speakingRate: speakingRate,
		cacheDir:     cacheDir,
		monthlyLimit: googleTTSMonthlySafetyLimit,
		synthesizer:  &googleSpeechSynthesizer{speakingRate: speakingRate},
		cache:        map[string][]byte{},
	}
	service.reserveUsage = service.reserveMonthlyUsage
	return service
}

func envBool(key string, fallback bool) bool {
	value := strings.TrimSpace(strings.ToLower(os.Getenv(key)))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseBool(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func ttsCharacterCount(text string) int64 {
	return int64(utf8.RuneCountInString(text))
}

func (s *ttsService) usageSnapshot(ctx context.Context) ttsUsageSnapshot {
	period := time.Now().UTC().Format("2006-01")
	if s == nil {
		return ttsUsageSnapshot{Period: period, SafetyLimit: googleTTSMonthlySafetyLimit, ProviderFreeLimit: googleTTSStandardFreeLimit, Remaining: googleTTSMonthlySafetyLimit, Error: "TTS service is unavailable"}
	}
	limit := s.monthlyLimit
	if limit <= 0 {
		limit = googleTTSMonthlySafetyLimit
	}
	snapshot := ttsUsageSnapshot{
		Enabled:           s.enabled,
		Period:            period,
		SafetyLimit:       limit,
		ProviderFreeLimit: googleTTSStandardFreeLimit,
		Remaining:         limit,
		Voice:             s.voice,
		SpeakingRate:      s.speakingRate,
	}
	if s.db == nil {
		snapshot.Error = "TTS usage database is unavailable"
		return snapshot
	}
	var updatedAt sql.NullString
	err := s.db.QueryRowContext(ctx, `
		select characters, to_char(updated_at at time zone 'Asia/Bangkok', 'YYYY-MM-DD HH24:MI')
		from tts_monthly_usage
		where period = $1
	`, period).Scan(&snapshot.Characters, &updatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		err = nil
	}
	if err != nil {
		snapshot.Error = err.Error()
		return snapshot
	}
	snapshot.Available = true
	snapshot.UpdatedAt = updatedAt.String
	snapshot.Remaining = max(int64(0), limit-snapshot.Characters)
	snapshot.Percent = float64(snapshot.Characters) / float64(limit) * 100
	snapshot.LimitReached = snapshot.Characters >= limit
	return snapshot
}

func (s *ttsService) cacheKey(text string) string {
	rate := strconv.FormatFloat(s.speakingRate, 'f', 3, 64)
	sum := sha256.Sum256([]byte(strings.Join([]string{ttsCacheVersion, s.voice, rate, text}, "\x00")))
	return hex.EncodeToString(sum[:])
}

func (s *ttsService) cachePath(key string) string {
	return filepath.Join(s.cacheDir, key+".mp3")
}

func (s *ttsService) readCache(key string) ([]byte, bool) {
	s.cacheMu.RLock()
	audio, ok := s.cache[key]
	s.cacheMu.RUnlock()
	if ok {
		return append([]byte(nil), audio...), true
	}
	audio, err := os.ReadFile(s.cachePath(key))
	if err != nil || len(audio) == 0 {
		return nil, false
	}
	s.cacheMu.Lock()
	s.cache[key] = append([]byte(nil), audio...)
	s.cacheMu.Unlock()
	return audio, true
}

func (s *ttsService) writeCache(key string, audio []byte) {
	s.cacheMu.Lock()
	s.cache[key] = append([]byte(nil), audio...)
	s.cacheMu.Unlock()
	if err := os.MkdirAll(s.cacheDir, 0o750); err != nil {
		log.Printf("create tts cache directory: %v", err)
		return
	}
	temporary, err := os.CreateTemp(s.cacheDir, key+"-*.tmp")
	if err != nil {
		log.Printf("create tts cache file: %v", err)
		return
	}
	temporaryName := temporary.Name()
	defer os.Remove(temporaryName)
	if _, err := temporary.Write(audio); err != nil {
		temporary.Close()
		log.Printf("write tts cache file: %v", err)
		return
	}
	if err := temporary.Close(); err != nil {
		log.Printf("close tts cache file: %v", err)
		return
	}
	if err := os.Rename(temporaryName, s.cachePath(key)); err != nil {
		log.Printf("save tts cache file: %v", err)
	}
}

func (s *ttsService) reserveMonthlyUsage(ctx context.Context, characters int64) (int64, bool, error) {
	if s.db == nil {
		return 0, false, errors.New("tts usage database is unavailable")
	}
	period := time.Now().UTC().Format("2006-01")
	var used int64
	err := s.db.QueryRowContext(ctx, `
		insert into tts_monthly_usage (period, characters, updated_at)
		values ($1, $2, now())
		on conflict (period) do update set
			characters = tts_monthly_usage.characters + excluded.characters,
			updated_at = now()
		where tts_monthly_usage.characters + excluded.characters <= $3
		returning characters
	`, period, characters, s.monthlyLimit).Scan(&used)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, false, nil
	}
	if err != nil {
		return 0, false, err
	}
	return used, true, nil
}

func (s *ttsService) Synthesize(ctx context.Context, rawText string) (ttsResult, error) {
	if s == nil || !s.enabled {
		return ttsResult{}, errTTSDisabled
	}
	text := strings.TrimSpace(rawText)
	characters := ttsCharacterCount(text)
	if characters == 0 || characters > googleTTSMaxTextCharacters {
		return ttsResult{}, errTTSInvalid
	}
	key := s.cacheKey(text)
	if audio, ok := s.readCache(key); ok {
		return ttsResult{Audio: audio, Cached: true, Characters: characters}, nil
	}

	value, err, _ := s.group.Do(key, func() (any, error) {
		if audio, ok := s.readCache(key); ok {
			return ttsResult{Audio: audio, Cached: true, Characters: characters}, nil
		}
		used, allowed, err := s.reserveUsage(ctx, characters)
		if err != nil {
			return ttsResult{}, fmt.Errorf("reserve tts usage: %w", err)
		}
		if !allowed {
			return ttsResult{}, errTTSLimit
		}
		audio, err := s.synthesizer.Synthesize(ctx, text, s.voice)
		if err != nil {
			// Attempts remain counted. This is deliberately conservative so an ambiguous
			// provider timeout can never push usage above the 3.9M safety ceiling.
			return ttsResult{}, fmt.Errorf("synthesize google tts: %w", err)
		}
		s.writeCache(key, audio)
		return ttsResult{Audio: audio, Characters: characters, Used: used}, nil
	})
	if err != nil {
		return ttsResult{}, err
	}
	return value.(ttsResult), nil
}

func (a *app) handleAnnouncementAudio(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Text string `json:"text"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8<<10)).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid announcement text", "fallback": true})
		return
	}
	result, err := a.tts.Synthesize(r.Context(), body.Text)
	if err != nil {
		status := http.StatusBadGateway
		code := "tts_unavailable"
		message := "ไม่สามารถสร้างเสียง Google ได้ จะใช้เสียงจากอุปกรณ์แทน"
		switch {
		case errors.Is(err, errTTSDisabled):
			status = http.StatusServiceUnavailable
			code = "tts_disabled"
		case errors.Is(err, errTTSLimit):
			status = http.StatusTooManyRequests
			code = "tts_monthly_limit"
			message = "ใช้เสียง Google ครบเพดาน 3.9 ล้านตัวอักษรแล้ว จะใช้เสียงจากอุปกรณ์แทน"
		case errors.Is(err, errTTSInvalid):
			status = http.StatusBadRequest
			code = "tts_invalid_text"
			message = "ข้อความประกาศไม่ถูกต้อง จะใช้เสียงจากอุปกรณ์แทน"
		default:
			log.Printf("google tts fallback: %v", err)
		}
		writeJSON(w, status, map[string]any{"error": message, "code": code, "fallback": true})
		return
	}
	w.Header().Set("Content-Type", "audio/mpeg")
	w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
	w.Header().Set("X-LiveMatch-TTS-Cache", strconv.FormatBool(result.Cached))
	w.Header().Set("X-LiveMatch-TTS-Characters", strconv.FormatInt(result.Characters, 10))
	if result.Used > 0 {
		w.Header().Set("X-LiveMatch-TTS-Monthly-Usage", strconv.FormatInt(result.Used, 10))
	}
	w.Header().Set("Content-Length", strconv.Itoa(len(result.Audio)))
	w.WriteHeader(http.StatusOK)
	if _, err := w.Write(result.Audio); err != nil {
		log.Printf("write tts audio: %v", err)
	}
}
