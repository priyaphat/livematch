package main

import (
	"bytes"
	"database/sql"
	"errors"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	_ "golang.org/x/image/webp"
)

const (
	maxMemberAvatarUploadBytes = 5 << 20
	maxMemberAvatarDimension   = 720
)

func memberAvatarURL(memberID string, version int64) string {
	if strings.TrimSpace(memberID) == "" || version <= 0 {
		return ""
	}
	return "/api/member-avatar/" + url.PathEscape(memberID) + "?v=" + strconv.FormatInt(version, 10)
}

func memberAvatarPath(path string) (string, bool) {
	parts := strings.Split(strings.Trim(path, "/"), "/")
	if len(parts) != 2 || parts[0] == "" || parts[1] != "avatar" {
		return "", false
	}
	memberID, err := url.PathUnescape(parts[0])
	return memberID, err == nil && memberID != "" && !strings.ContainsAny(memberID, `/\\`)
}

func detectMemberAvatar(data []byte) (string, bool) {
	switch {
	case len(data) >= 3 && data[0] == 0xff && data[1] == 0xd8 && data[2] == 0xff:
		return "image/jpeg", true
	case len(data) >= 8 && bytes.Equal(data[:8], []byte{0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a}):
		return "image/png", true
	case len(data) >= 12 && bytes.Equal(data[:4], []byte("RIFF")) && bytes.Equal(data[8:12], []byte("WEBP")):
		return "image/webp", true
	default:
		return "", false
	}
}

func validateMemberAvatar(data []byte) (string, error) {
	if len(data) == 0 || len(data) > maxMemberAvatarUploadBytes {
		return "", errors.New("รูปโปรไฟล์ต้องมีขนาดไม่เกิน 5 MB")
	}
	mimeType, ok := detectMemberAvatar(data)
	if !ok {
		return "", errors.New("รองรับเฉพาะรูป JPEG, PNG หรือ WebP")
	}
	config, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || config.Width < 1 || config.Height < 1 {
		return "", errors.New("ไฟล์รูปโปรไฟล์ไม่ถูกต้อง")
	}
	if config.Width > maxMemberAvatarDimension || config.Height > maxMemberAvatarDimension {
		return "", errors.New("กรุณาบีบรูปโปรไฟล์ให้ไม่เกิน 720 × 720 พิกเซล")
	}
	return mimeType, nil
}

func (a *app) handleMemberAvatarUpload(w http.ResponseWriter, r *http.Request, adminID, memberID, actorType, actorID string) {
	var exists bool
	if err := a.db.QueryRowContext(r.Context(), `select exists(select 1 from members where id=$1 and admin_id=$2 and deleted_at is null)`, memberID, adminID).Scan(&exists); err != nil || !exists {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "member not found"})
		return
	}

	switch r.Method {
	case http.MethodPost:
		r.Body = http.MaxBytesReader(w, r.Body, maxMemberAvatarUploadBytes+(256<<10))
		file, _, err := r.FormFile("avatar")
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "กรุณาเลือกรูปโปรไฟล์"})
			return
		}
		defer file.Close()
		data, err := io.ReadAll(io.LimitReader(file, maxMemberAvatarUploadBytes+1))
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "อ่านไฟล์รูปโปรไฟล์ไม่สำเร็จ"})
			return
		}
		mimeType, err := validateMemberAvatar(data)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		var version int64
		if err = a.db.QueryRowContext(r.Context(), `update members set avatar_data=$3,avatar_mime=$4,avatar_version=avatar_version+1,updated_at=now() where id=$1 and admin_id=$2 and deleted_at is null returning avatar_version`, memberID, adminID, data, mimeType).Scan(&version); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		a.insertActivityLog(r.Context(), actorType, actorID, "upload_member_avatar", "member", memberID, map[string]any{"adminId": adminID, "mimeType": mimeType, "bytes": len(data)})
		writeJSON(w, http.StatusOK, map[string]any{"avatarUrl": memberAvatarURL(memberID, version), "avatarVersion": version})
	case http.MethodDelete:
		var version int64
		if err := a.db.QueryRowContext(r.Context(), `update members set avatar_data=null,avatar_mime='',avatar_version=avatar_version+1,updated_at=now() where id=$1 and admin_id=$2 and deleted_at is null returning avatar_version`, memberID, adminID).Scan(&version); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		a.insertActivityLog(r.Context(), actorType, actorID, "delete_member_avatar", "member", memberID, map[string]any{"adminId": adminID})
		writeJSON(w, http.StatusOK, map[string]any{"avatarUrl": "", "avatarVersion": version})
	default:
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
	}
}

func (a *app) serveMemberAvatar(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		return
	}
	memberID, err := url.PathUnescape(strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/member-avatar/"), "/"))
	if err != nil || memberID == "" || strings.ContainsAny(memberID, `/\\`) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "avatar not found"})
		return
	}
	var data []byte
	var mimeType string
	var version int64
	err = a.db.QueryRowContext(r.Context(), `select avatar_data,avatar_mime,avatar_version from members where id=$1 and deleted_at is null and avatar_data is not null`, memberID).Scan(&data, &mimeType, &version)
	if errors.Is(err, sql.ErrNoRows) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "avatar not found"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	etag := `"member-avatar-` + memberID + `-` + strconv.FormatInt(version, 10) + `"`
	if r.Header.Get("If-None-Match") == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	w.Header().Set("Content-Type", mimeType)
	w.Header().Set("Content-Length", strconv.Itoa(len(data)))
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	w.Header().Set("ETag", etag)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if r.Method == http.MethodGet {
		_, _ = w.Write(data)
	}
}
