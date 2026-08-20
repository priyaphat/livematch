package main

import "testing"

func TestDetectAnnouncementBell(t *testing.T) {
	tests := []struct {
		name string
		data []byte
		mime string
		ext  string
	}{
		{name: "mp3 id3", data: []byte("ID3sample"), mime: "audio/mpeg", ext: ".mp3"},
		{name: "mp3 frame", data: []byte{0xff, 0xfb, 0x90, 0x64}, mime: "audio/mpeg", ext: ".mp3"},
		{name: "wav", data: []byte("RIFF0000WAVEdata"), mime: "audio/wav", ext: ".wav"},
		{name: "ogg", data: []byte("OggSsample"), mime: "audio/ogg", ext: ".ogg"},
		{name: "webm", data: []byte{0x1a, 0x45, 0xdf, 0xa3, 0x01}, mime: "audio/webm", ext: ".webm"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			mimeType, extension, ok := detectAnnouncementBell(test.data)
			if !ok || mimeType != test.mime || extension != test.ext {
				t.Fatalf("detectAnnouncementBell() = %q, %q, %v", mimeType, extension, ok)
			}
		})
	}
}

func TestDetectAnnouncementBellRejectsUnknownContent(t *testing.T) {
	if _, _, ok := detectAnnouncementBell([]byte("not audio")); ok {
		t.Fatal("expected unknown content to be rejected")
	}
}
