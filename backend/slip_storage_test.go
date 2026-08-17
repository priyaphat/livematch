package main

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"testing"
)

func testPNG(t *testing.T) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 12, 12))
	for y := 0; y < 12; y++ {
		for x := 0; x < 12; x++ {
			img.Set(x, y, color.RGBA{R: uint8(x * 10), G: uint8(y * 10), B: 80, A: 255})
		}
	}
	var buffer bytes.Buffer
	if err := png.Encode(&buffer, img); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}

func TestBookingSlipStorageIsPrivateAndPathSafe(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("BOOKING_SLIP_STORAGE_DIR", dir)
	raw := testPNG(t)
	stored, err := storeBookingSlip("admin-1", "payment-1", raw)
	if err != nil {
		t.Fatal(err)
	}
	if stored.MIME != "image/png" || stored.Size != int64(len(raw)) || stored.SHA256 == "" {
		t.Fatalf("unexpected metadata: %#v", stored)
	}
	loaded, err := readBookingSlip(stored.Key)
	if err != nil || !bytes.Equal(loaded, raw) {
		t.Fatalf("stored slip mismatch: %v", err)
	}
	if _, err = os.Stat(filepath.Join(dir, filepath.FromSlash(stored.Key))); err != nil {
		t.Fatal(err)
	}
	if _, err = readBookingSlip("../../secret"); err == nil {
		t.Fatal("path traversal must be rejected")
	}
}

func TestValidateSlipBytesRejectsSpoofedAndOversizedFiles(t *testing.T) {
	if _, err := validateSlipBytes([]byte("not an image")); err == nil {
		t.Fatal("spoofed image must be rejected")
	}
	if _, err := validateSlipBytes(make([]byte, maxBookingSlipBytes+1)); err == nil {
		t.Fatal("oversized image must be rejected")
	}
}

func TestBookingSlipStorageCompressesLargeImages(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("BOOKING_SLIP_STORAGE_DIR", dir)
	img := image.NewRGBA(image.Rect(0, 0, 1400, 1000))
	for y := 0; y < 1000; y++ {
		for x := 0; x < 1400; x++ {
			img.Set(x, y, color.RGBA{R: uint8((x * y) % 251), G: uint8((x + y) % 253), B: uint8((x*3 + y*7) % 255), A: 255})
		}
	}
	var source bytes.Buffer
	if err := png.Encode(&source, img); err != nil {
		t.Fatal(err)
	}
	stored, err := storeBookingSlipWithLimit("admin-1", "payment-large", source.Bytes(), source.Len()+1)
	if err != nil {
		t.Fatal(err)
	}
	if stored.Size > storedSlipTargetBytes || stored.MIME != "image/jpeg" {
		t.Fatalf("large slip was not normalized: %#v", stored)
	}
	config, _, err := image.DecodeConfig(bytes.NewReader(stored.Data))
	if err != nil || max(config.Width, config.Height) > storedSlipMaximumEdge {
		t.Fatalf("unexpected stored dimensions: %#v, %v", config, err)
	}
}
