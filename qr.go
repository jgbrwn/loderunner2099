package main

import (
	"net/http"
	"strconv"

	qrcode "github.com/skip2/go-qrcode"
)

const maxQRText = 512

// GET /api/qr?text=...&size=256 → PNG
func handleQR(w http.ResponseWriter, r *http.Request) {
	text := r.URL.Query().Get("text")
	if text == "" || len(text) > maxQRText {
		http.Error(w, "text required (max 512 bytes)", http.StatusBadRequest)
		return
	}
	size, _ := strconv.Atoi(r.URL.Query().Get("size"))
	if size < 64 || size > 1024 {
		size = 256
	}
	png, err := qrcode.Encode(text, qrcode.Medium, size)
	if err != nil {
		http.Error(w, "qr error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "image/png")
	w.Header().Set("Cache-Control", "public, max-age=86400")
	w.Write(png)
}
