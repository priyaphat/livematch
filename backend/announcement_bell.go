package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

const maxAnnouncementBellBytes = 2 << 20

func announcementBellStorageDir() string {
	if value := strings.TrimSpace(os.Getenv("ANNOUNCEMENT_BELL_STORAGE_DIR")); value != "" {
		return value
	}
	return "/var/lib/livematch/announcement-bells"
}

func detectAnnouncementBell(data []byte) (string, string, bool) {
	switch {
	case len(data) >= 12 && bytes.Equal(data[:4], []byte("RIFF")) && bytes.Equal(data[8:12], []byte("WAVE")):
		return "audio/wav", ".wav", true
	case len(data) >= 4 && bytes.Equal(data[:4], []byte("OggS")):
		return "audio/ogg", ".ogg", true
	case len(data) >= 4 && bytes.Equal(data[:4], []byte{0x1a, 0x45, 0xdf, 0xa3}):
		return "audio/webm", ".webm", true
	case len(data) >= 3 && bytes.Equal(data[:3], []byte("ID3")):
		return "audio/mpeg", ".mp3", true
	case len(data) >= 2 && data[0] == 0xff && data[1]&0xe0 == 0xe0:
		return "audio/mpeg", ".mp3", true
	default:
		return "", "", false
	}
}

func writeAnnouncementBell(data []byte, extension string) (string, error) {
	dir := announcementBellStorageDir()
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", err
	}
	key := randHex(16) + extension
	temporary, err := os.CreateTemp(dir, ".upload-*")
	if err != nil {
		return "", err
	}
	temporaryName := temporary.Name()
	defer os.Remove(temporaryName)
	if err = temporary.Chmod(0o600); err == nil {
		_, err = temporary.Write(data)
	}
	if closeErr := temporary.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		return "", err
	}
	if err = os.Rename(temporaryName, filepath.Join(dir, key)); err != nil {
		return "", err
	}
	return key, nil
}

func (a *app) saveAdminAnnouncementBellSettings(r *http.Request, user adminUser, settings Settings, action string) error {
	normalizeAdminDefaultSettings(&settings)
	raw, err := json.Marshal(settings)
	if err != nil {
		return err
	}
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(r.Context(), `
		insert into admin_default_settings (admin_id, settings) values ($1,$2)
		on conflict (admin_id) do update set settings=excluded.settings,updated_at=now()
	`, user.ID, raw); err != nil {
		return err
	}
	if err = a.insertActivityLogTx(r.Context(), tx, "admin", user.ID, action, "admin_default_settings", user.ID, map[string]any{"fileName": settings.AnnouncementBellName, "hasCustomBell": settings.AnnouncementBellKey != ""}); err != nil {
		return err
	}
	return tx.Commit()
}

func (a *app) handleAdminAnnouncementBell(w http.ResponseWriter, r *http.Request, user adminUser) {
	settings, err := a.adminDefaultSettings(r.Context(), user.ID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	switch r.Method {
	case http.MethodGet:
		a.serveAnnouncementBell(w, r, settings)
	case http.MethodPost:
		r.Body = http.MaxBytesReader(w, r.Body, maxAnnouncementBellBytes+(256<<10))
		file, header, openErr := r.FormFile("bell")
		if openErr != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "กรุณาเลือกไฟล์เสียงกริ่ง"})
			return
		}
		defer file.Close()
		data, readErr := io.ReadAll(io.LimitReader(file, maxAnnouncementBellBytes+1))
		if readErr != nil || len(data) == 0 || len(data) > maxAnnouncementBellBytes {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "ไฟล์เสียงต้องมีขนาดไม่เกิน 2 MB"})
			return
		}
		mimeType, extension, valid := detectAnnouncementBell(data)
		if !valid {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "รองรับเฉพาะ MP3, WAV, OGG และ WebM"})
			return
		}
		key, writeErr := writeAnnouncementBell(data, extension)
		if writeErr != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": writeErr.Error()})
			return
		}
		settings.AnnouncementBellKey = key
		settings.AnnouncementBellName = filepath.Base(strings.TrimSpace(header.Filename))
		settings.AnnouncementBellMIME = mimeType
		if settings.AnnouncementBellName == "." || settings.AnnouncementBellName == "" {
			settings.AnnouncementBellName = "เสียงกริ่ง" + extension
		}
		if err = a.saveAdminAnnouncementBellSettings(r, user, settings, "upload_announcement_bell"); err != nil {
			_ = os.Remove(filepath.Join(announcementBellStorageDir(), key))
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		a.writeAdminMe(w, r, user)
	case http.MethodDelete:
		settings.AnnouncementBellKey = ""
		settings.AnnouncementBellName = ""
		settings.AnnouncementBellMIME = ""
		if err = a.saveAdminAnnouncementBellSettings(r, user, settings, "clear_announcement_bell"); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		// Do not delete the immutable file: existing sessions may still reference it.
		a.writeAdminMe(w, r, user)
	default:
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
	}
}

func (a *app) serveAnnouncementBell(w http.ResponseWriter, r *http.Request, settings Settings) {
	key := strings.TrimSpace(settings.AnnouncementBellKey)
	if key == "" {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "custom announcement bell not found"})
		return
	}
	if filepath.Base(key) != key || strings.ContainsAny(key, `/\\`) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "custom announcement bell not found"})
		return
	}
	file, err := os.Open(filepath.Join(announcementBellStorageDir(), key))
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "custom announcement bell not found"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	defer file.Close()
	stat, err := file.Stat()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	w.Header().Set("Content-Type", settings.AnnouncementBellMIME)
	w.Header().Set("Cache-Control", "private, no-store")
	http.ServeContent(w, r, key, stat.ModTime(), file)
}
