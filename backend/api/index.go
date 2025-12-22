package handler

import (
	"encoding/json"
	"net/http"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

type User struct {
	ID             string   `json:"id"`
	AnonymousID    string   `json:"anonymousId"`
	NativeLanguage string   `json:"nativeLanguage"`
	TargetLanguage string   `json:"targetLanguage"`
	Interests      []string `json:"interests"`
	Country        string   `json:"country"`
	Conn           *websocket.Conn `json:"-"`
}

type Message struct {
	Type    string      `json:"type"`
	Payload interface{} `json:"payload"`
}

var (
	users     = make(map[string]*User)
	queue     = make([]*User, 0)
	rooms     = make(map[string][2]*User)
	mu        sync.RWMutex
)

func Handler(w http.ResponseWriter, r *http.Request) {
	// CORS
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	path := r.URL.Path

	switch {
	case path == "/api" || path == "/api/":
		json.NewEncoder(w).Encode(map[string]string{"status": "ok", "message": "VOX-BRIDGE API"})
	case path == "/api/health" || path == "/health":
		json.NewEncoder(w).Encode(map[string]interface{}{"status": "healthy", "timestamp": time.Now().Unix()})
	default:
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]string{"error": "not found"})
	}
}
