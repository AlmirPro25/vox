package controllers

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/vox-bridge/nexus-core/src/services"
	"gorm.io/gorm"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

type WSHandler struct {
	TranslationService *services.TranslationService
	MatchService       *services.MatchService
	AuthService        *services.AuthService
	DB                 *gorm.DB

	// Active connections
	connections map[string]*websocket.Conn
	rooms       map[string]*Room
	mu          sync.RWMutex
}

type Room struct {
	ID    string
	User1 string
	User2 string
}

type WSMessage struct {
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload,omitempty"`
}

func NewWSHandler(ts *services.TranslationService, ms *services.MatchService, as *services.AuthService) *WSHandler {
	return &WSHandler{
		TranslationService: ts,
		MatchService:       ms,
		AuthService:        as,
		connections:        make(map[string]*websocket.Conn),
		rooms:              make(map[string]*Room),
	}
}

func (h *WSHandler) HandleWS(c *gin.Context) {
	token := c.Query("token")
	if token == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "token_required"})
		return
	}

	// Validate token
	claims, err := h.AuthService.ValidateToken(token)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid_token"})
		return
	}

	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Printf("❌ WS Upgrade failed: %v", err)
		return
	}

	h.mu.Lock()
	h.connections[claims.UserID] = conn
	h.mu.Unlock()

	defer func() {
		h.mu.Lock()
		delete(h.connections, claims.UserID)
		h.mu.Unlock()
		conn.Close()
	}()

	// Welcome message
	h.sendJSON(conn, WSMessage{Type: "connected", Payload: h.mustMarshal(gin.H{"status": "online"})})

	for {
		_, msgData, err := conn.ReadMessage()
		if err != nil {
			break
		}

		var msg WSMessage
		if err := json.Unmarshal(msgData, &msg); err != nil {
			continue
		}

		h.handleMessage(claims.UserID, msg)
	}
}

func (h *WSHandler) handleMessage(userID string, msg WSMessage) {
	switch msg.Type {
	case "join_queue":
		h.handleJoinQueue(userID, msg.Payload)
	case "leave_queue":
		h.handleLeaveQueue(userID)
	case "chat_message":
		h.handleChat(userID, msg.Payload)
	case "typing":
		h.handleTyping(userID, true)
	case "stop_typing":
		h.handleTyping(userID, false)
	case "ping":
		h.mu.RLock()
		if conn, ok := h.connections[userID]; ok {
			h.sendJSON(conn, WSMessage{Type: "pong", Payload: h.mustMarshal(gin.H{"online": len(h.connections)})})
		}
		h.mu.RUnlock()
	}
}

func (h *WSHandler) handleJoinQueue(userID string, payload json.RawMessage) {
	var req services.MatchRequest
	json.Unmarshal(payload, &req)
	req.UserID = userID

	log.Printf("📥 User %s joining queue (%s -> %s)", userID, req.NativeLanguage, req.TargetLanguage)
	h.MatchService.AddToQueue(req)

	h.mu.RLock()
	if conn, ok := h.connections[userID]; ok {
		h.sendJSON(conn, WSMessage{Type: "queue_joined"})
	}
	h.mu.RUnlock()

	// Perform background matchmaking
	go h.attemptMatch(req)
}

func (h *WSHandler) handleLeaveQueue(userID string) {
	// Implement removal from Redis if needed
	h.mu.RLock()
	if conn, ok := h.connections[userID]; ok {
		h.sendJSON(conn, WSMessage{Type: "queue_left"})
	}
	h.mu.RUnlock()
}

func (h *WSHandler) attemptMatch(req services.MatchRequest) {
	partner, err := h.MatchService.FindMatch(req)
	if err != nil || partner == nil {
		return
	}

	roomID := "room_" + req.UserID + "_" + partner.UserID
	room := &Room{
		ID:    roomID,
		User1: req.UserID,
		User2: partner.UserID,
	}

	h.mu.Lock()
	h.rooms[roomID] = room
	h.mu.Unlock()

	// Notify both partners
	h.notifyMatch(req.UserID, partner.UserID, roomID)
	h.notifyMatch(partner.UserID, req.UserID, roomID)
}

func (h *WSHandler) notifyMatch(userID, partnerID, roomID string) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	if conn, ok := h.connections[userID]; ok {
		h.sendJSON(conn, WSMessage{Type: "matched", Payload: h.mustMarshal(gin.H{
			"room_id": roomID,
			"partner": gin.H{
				"id":           partnerID,
				"anonymous_id": "NexusPeer_" + partnerID[:4],
			},
		})})
	}
}

func (h *WSHandler) handleChat(senderID string, payload json.RawMessage) {
	var input struct {
		Text string `json:"text"`
	}
	json.Unmarshal(payload, &input)

	// Find room
	var room *Room
	var partnerID string
	h.mu.RLock()
	for _, r := range h.rooms {
		if r.User1 == senderID {
			room = r
			partnerID = r.User2
			break
		} else if r.User2 == senderID {
			room = r
			partnerID = r.User1
			break
		}
	}
	h.mu.RUnlock()

	if room == nil {
		return
	}

	// Translation Logic
	translated := input.Text
	// In a real scenario, we would determine languages from user profiles
	// Simplified: auto-translate if bridge is active
	if h.TranslationService != nil {
		trans, err := h.TranslationService.Translate(input.Text, "auto", "en")
		if err == nil {
			translated = trans
		}
	}

	h.mu.RLock()
	if conn, ok := h.connections[partnerID]; ok {
		h.sendJSON(conn, WSMessage{Type: "chat_message", Payload: h.mustMarshal(gin.H{
			"from":            senderID,
			"text":            input.Text,
			"translated_text": translated,
			"timestamp":       time.Now().UnixMilli(),
		})})
	}
	h.mu.RUnlock()
}

func (h *WSHandler) handleTyping(userID string, isTyping bool) {
	// Send typing status to partner
}

func (h *WSHandler) sendJSON(conn *websocket.Conn, msg WSMessage) {
	data, _ := json.Marshal(msg)
	conn.WriteMessage(websocket.TextMessage, data)
}

func (h *WSHandler) mustMarshal(v interface{}) json.RawMessage {
	data, _ := json.Marshal(v)
	return data
}
