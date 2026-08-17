package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"image"
	"image/color"
	stdDraw "image/draw"
	"image/jpeg"
	_ "image/png"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	xdraw "golang.org/x/image/draw"
	_ "golang.org/x/image/webp"
)

const (
	maxBookingSlipBytes   = 2 << 20
	storedSlipTargetBytes = 100 * 1024
	storedSlipMaximumEdge = 1200
)

type storedSlip struct {
	Key    string
	MIME   string
	Size   int64
	SHA256 string
	Data   []byte
}

func bookingSlipStorageDir() string {
	if value := strings.TrimSpace(os.Getenv("BOOKING_SLIP_STORAGE_DIR")); value != "" {
		return value
	}
	return "/var/lib/livematch/booking-slips"
}

func validateSlipBytesLimit(raw []byte, maximum int) (string, error) {
	if len(raw) == 0 || len(raw) > maximum {
		return "", errors.New("รองรับสลิปหลังย่อขนาดไม่เกิน 2 MB")
	}
	mimeType := http.DetectContentType(raw)
	if mimeType != "image/jpeg" && mimeType != "image/png" && mimeType != "image/webp" {
		return "", errors.New("รองรับเฉพาะ JPEG, PNG และ WebP")
	}
	config, _, err := image.DecodeConfig(bytes.NewReader(raw))
	if err != nil || config.Width < 1 || config.Height < 1 || config.Width > 10000 || config.Height > 10000 {
		return "", errors.New("ไฟล์สลิปไม่ใช่ภาพที่ถูกต้อง")
	}
	return mimeType, nil
}

func validateSlipBytes(raw []byte) (string, error) {
	return validateSlipBytesLimit(raw, maxBookingSlipBytes)
}

func slipExtension(mimeType string) string {
	switch mimeType {
	case "image/png":
		return ".png"
	case "image/webp":
		return ".webp"
	default:
		return ".jpg"
	}
}

func safeSlipSegment(value string) string {
	var result strings.Builder
	for _, char := range value {
		if (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || (char >= '0' && char <= '9') || char == '-' || char == '_' {
			result.WriteRune(char)
		}
	}
	return result.String()
}

func normalizeStoredBookingSlip(raw []byte, mimeType string) ([]byte, string, error) {
	img, _, err := image.Decode(bytes.NewReader(raw))
	if err != nil {
		return nil, "", errors.New("ไฟล์สลิปไม่ใช่ภาพที่ถูกต้อง")
	}
	bounds := img.Bounds()
	width, height := bounds.Dx(), bounds.Dy()
	if len(raw) <= storedSlipTargetBytes && max(width, height) <= storedSlipMaximumEdge {
		return raw, mimeType, nil
	}
	baseScale := min(1.0, float64(storedSlipMaximumEdge)/float64(max(width, height)))
	var best []byte
	for _, dimensionScale := range []float64{1, 0.85, 0.7, 0.6, 0.5} {
		targetWidth := max(1, int(float64(width)*baseScale*dimensionScale))
		targetHeight := max(1, int(float64(height)*baseScale*dimensionScale))
		resized := image.NewRGBA(image.Rect(0, 0, targetWidth, targetHeight))
		stdDraw.Draw(resized, resized.Bounds(), image.NewUniform(color.White), image.Point{}, stdDraw.Src)
		xdraw.CatmullRom.Scale(resized, resized.Bounds(), img, bounds, stdDraw.Over, nil)
		for _, quality := range []int{82, 74, 66, 58, 50, 42} {
			var output bytes.Buffer
			if err = jpeg.Encode(&output, resized, &jpeg.Options{Quality: quality}); err != nil {
				return nil, "", err
			}
			candidate := append([]byte(nil), output.Bytes()...)
			if len(best) == 0 || len(candidate) < len(best) {
				best = candidate
			}
			if len(candidate) <= storedSlipTargetBytes {
				return candidate, "image/jpeg", nil
			}
		}
	}
	return nil, "", errors.New("ไม่สามารถลดขนาดสลิปให้ต่ำกว่า 100 KB ได้")
}

func storeBookingSlipWithLimit(adminID, paymentID string, raw []byte, maximum int) (storedSlip, error) {
	mimeType, err := validateSlipBytesLimit(raw, maximum)
	if err != nil {
		return storedSlip{}, err
	}
	raw, mimeType, err = normalizeStoredBookingSlip(raw, mimeType)
	if err != nil {
		return storedSlip{}, err
	}
	adminID, paymentID = safeSlipSegment(adminID), safeSlipSegment(paymentID)
	if adminID == "" || paymentID == "" {
		return storedSlip{}, errors.New("invalid slip owner")
	}
	key := filepath.ToSlash(filepath.Join(adminID, paymentID+slipExtension(mimeType)))
	root := bookingSlipStorageDir()
	target := filepath.Join(root, filepath.FromSlash(key))
	if err = os.MkdirAll(filepath.Dir(target), 0o750); err != nil {
		return storedSlip{}, err
	}
	temporary, err := os.CreateTemp(filepath.Dir(target), paymentID+"-*.tmp")
	if err != nil {
		return storedSlip{}, err
	}
	temporaryName := temporary.Name()
	defer os.Remove(temporaryName)
	if _, err = temporary.Write(raw); err == nil {
		err = temporary.Chmod(0o640)
	}
	if closeErr := temporary.Close(); err == nil {
		err = closeErr
	}
	if err == nil {
		err = os.Rename(temporaryName, target)
	}
	if err != nil {
		return storedSlip{}, err
	}
	digest := sha256.Sum256(raw)
	return storedSlip{Key: key, MIME: mimeType, Size: int64(len(raw)), SHA256: hex.EncodeToString(digest[:]), Data: raw}, nil
}

func storeBookingSlip(adminID, paymentID string, raw []byte) (storedSlip, error) {
	return storeBookingSlipWithLimit(adminID, paymentID, raw, maxBookingSlipBytes)
}

func readBookingSlip(key string) ([]byte, error) {
	clean := filepath.Clean(filepath.FromSlash(strings.TrimSpace(key)))
	if clean == "." || filepath.IsAbs(clean) || strings.HasPrefix(clean, "..") {
		return nil, errors.New("invalid slip key")
	}
	root, err := filepath.Abs(bookingSlipStorageDir())
	if err != nil {
		return nil, err
	}
	target, err := filepath.Abs(filepath.Join(root, clean))
	if err != nil || (target != root && !strings.HasPrefix(target, root+string(os.PathSeparator))) {
		return nil, errors.New("invalid slip key")
	}
	return os.ReadFile(target)
}

func removeBookingSlip(key string) {
	clean := filepath.Clean(filepath.FromSlash(strings.TrimSpace(key)))
	if clean == "." || filepath.IsAbs(clean) || strings.HasPrefix(clean, "..") {
		return
	}
	_ = os.Remove(filepath.Join(bookingSlipStorageDir(), clean))
}

func readMultipartSlip(w http.ResponseWriter, r *http.Request) ([]byte, error) {
	r.Body = http.MaxBytesReader(w, r.Body, maxBookingSlipBytes+256*1024)
	if err := r.ParseMultipartForm(maxBookingSlipBytes + 128*1024); err != nil {
		return nil, errors.New("ไฟล์สลิปใหญ่เกิน 2 MB")
	}
	file, _, err := r.FormFile("slip")
	if err != nil {
		return nil, errors.New("ไม่พบไฟล์สลิป")
	}
	defer file.Close()
	return io.ReadAll(io.LimitReader(file, maxBookingSlipBytes+1))
}

func (a *app) migrateBookingSlipFiles(ctx context.Context) (int, int, error) {
	rows, err := a.db.QueryContext(ctx, `select p.id,p.admin_id,p.slip_data from booking_payments p where p.slip_file_key='' and p.slip_data<>'' order by p.created_at,p.id`)
	if err != nil {
		return 0, 0, err
	}
	migrated, failed := 0, 0
	for rows.Next() {
		var paymentID, adminID, dataURL string
		if err = rows.Scan(&paymentID, &adminID, &dataURL); err != nil {
			return migrated, failed, err
		}
		raw, decodeErr := decodeDataURL(dataURL)
		if decodeErr != nil {
			failed++
			continue
		}
		stored, storeErr := storeBookingSlipWithLimit(adminID, paymentID, raw, 6_800_000)
		if storeErr != nil {
			failed++
			continue
		}
		result, updateErr := a.db.ExecContext(ctx, `update booking_payments set slip_file_key=$2,slip_mime_type=$3,slip_size_bytes=$4,slip_sha256=$5,slip_data='' where id=$1 and slip_file_key=''`, paymentID, stored.Key, stored.MIME, stored.Size, stored.SHA256)
		if updateErr != nil {
			removeBookingSlip(stored.Key)
			return migrated, failed, updateErr
		}
		if count, _ := result.RowsAffected(); count == 1 {
			migrated++
		}
	}
	if err = rows.Err(); err != nil {
		_ = rows.Close()
		return migrated, failed, err
	}
	_ = rows.Close()

	fileRows, err := a.db.QueryContext(ctx, `select id,admin_id,slip_file_key,slip_mime_type from booking_payments where slip_file_key<>'' order by created_at,id`)
	if err != nil {
		return migrated, failed, err
	}
	defer fileRows.Close()
	for fileRows.Next() {
		var paymentID, adminID, oldKey, oldMIME string
		if err = fileRows.Scan(&paymentID, &adminID, &oldKey, &oldMIME); err != nil {
			return migrated, failed, err
		}
		raw, readErr := readBookingSlip(oldKey)
		if readErr != nil {
			failed++
			continue
		}
		mimeType, validateErr := validateSlipBytesLimit(raw, 6_800_000)
		if validateErr != nil {
			failed++
			continue
		}
		normalized, normalizedMIME, normalizeErr := normalizeStoredBookingSlip(raw, mimeType)
		if normalizeErr != nil {
			failed++
			continue
		}
		if bytes.Equal(normalized, raw) && normalizedMIME == oldMIME {
			continue
		}
		stored, storeErr := storeBookingSlipWithLimit(adminID, paymentID, normalized, storedSlipTargetBytes)
		if storeErr != nil {
			failed++
			continue
		}
		result, updateErr := a.db.ExecContext(ctx, `update booking_payments set slip_file_key=$2,slip_mime_type=$3,slip_size_bytes=$4,slip_sha256=$5 where id=$1 and slip_file_key=$6`, paymentID, stored.Key, stored.MIME, stored.Size, stored.SHA256, oldKey)
		if updateErr != nil {
			if stored.Key != oldKey {
				removeBookingSlip(stored.Key)
			}
			return migrated, failed, updateErr
		}
		if count, _ := result.RowsAffected(); count == 1 {
			if stored.Key != oldKey {
				removeBookingSlip(oldKey)
			}
			migrated++
		}
	}
	return migrated, failed, fileRows.Err()
}

func (a *app) bookingSlipData(ctx context.Context, paymentID, adminID string) (storedSlip, error) {
	var result storedSlip
	var legacy string
	err := a.db.QueryRowContext(ctx, `select slip_file_key,slip_mime_type,slip_size_bytes,slip_sha256,slip_data from booking_payments where id=$1 and admin_id=$2`, paymentID, adminID).Scan(&result.Key, &result.MIME, &result.Size, &result.SHA256, &legacy)
	if err != nil {
		return result, err
	}
	if result.Key != "" {
		result.Data, err = readBookingSlip(result.Key)
		return result, err
	}
	if legacy == "" {
		return result, sql.ErrNoRows
	}
	result.Data, err = decodeDataURL(legacy)
	if err == nil {
		result.MIME, err = validateSlipBytes(result.Data)
	}
	return result, err
}

func (a *app) serveBookingSlip(w http.ResponseWriter, r *http.Request, adminID, paymentID string) {
	slip, err := a.bookingSlipData(r.Context(), paymentID, adminID)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "ไม่พบสลิป"})
		return
	}
	w.Header().Set("Content-Type", slip.MIME)
	w.Header().Set("Cache-Control", "private, max-age=300")
	w.Header().Set("Content-Disposition", fmt.Sprintf("inline; filename=%q", paymentID+slipExtension(slip.MIME)))
	_, _ = w.Write(slip.Data)
}

func (a *app) cleanupOrphanBookingSlips(ctx context.Context) {
	rows, err := a.db.QueryContext(ctx, `select slip_file_key from booking_payments where slip_file_key<>''`)
	if err != nil {
		return
	}
	referenced := map[string]bool{}
	for rows.Next() {
		var key string
		if rows.Scan(&key) == nil {
			referenced[filepath.ToSlash(key)] = true
		}
	}
	_ = rows.Close()
	root := bookingSlipStorageDir()
	_ = filepath.WalkDir(root, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil || entry.IsDir() {
			return nil
		}
		relative, relErr := filepath.Rel(root, path)
		if relErr == nil && !referenced[filepath.ToSlash(relative)] {
			// A file is written before its payment row is committed. Keep recent
			// files so the periodic cleanup cannot race an in-flight upload.
			if info, infoErr := entry.Info(); infoErr == nil && time.Since(info.ModTime()) < time.Hour {
				return nil
			}
			_ = os.Remove(path)
		}
		return nil
	})
}

func (a *app) runBookingSlipCleanup(ctx context.Context) {
	a.cleanupOrphanBookingSlips(ctx)
	ticker := time.NewTicker(24 * time.Hour)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			a.cleanupOrphanBookingSlips(ctx)
		}
	}
}
