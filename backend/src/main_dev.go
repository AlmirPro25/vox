// +build ignore

package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

// ============== TYPES ==============

type Claims struct {
	UserID      string `json:"user_id"`
	AnonymousID string `json:"anonymous_id"`
	jwt.RegisteredClaims
}

type User struct {
	ID             string   `json:"id"`
	AnonymousID    string   `json:"anonymous_id"`
	NativeLanguage string   `json:"native_language"`
	TargetLanguage string   `json:"target_language"`
	Interests      []string `json:"interests"`
	Country        string   `json:"country"`
}

type Report struct {
	ID         string    `json:"id"`
	ReporterID string    `json:"reporter_id"`
	ReportedID string    `json:"reported_id"`
	Reason     string    `json:"reason"`
	Details    string    `json:"details"`
	CreatedAt  time.Time `json:"created_at"`
}

type QueueEntry struct {
	User       *User
	Conn       *websocket.Conn
	JoinedAt   time.Time
}

type Room struct {
	ID      string
	User1   *QueueEntry
	User2   *QueueEntry
	Created time.Time
}

type WSMessage struct {
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload,omitempty"`
}

type MatchFoundPayload struct {
	RoomID        string   `json:"room_id"`
	PartnerID     string   `json:"partner_id"`
	PartnerLang   string   `json:"partner_lang"`
	PartnerCountry string  `json:"partner_country"`
	CommonInterests []string `json:"common_interests"`
}

type ChatPayload struct {
	Message   string `json:"message"`
	SenderID  string `json:"sender_id"`
	Timestamp int64  `json:"timestamp"`
}

// ============== GLOBALS ==============

var (
	jwtSecret = []byte("dev-secret-key-change-in-production-32chars")
	users     = make(map[string]*User)
	usersMu   sync.RWMutex

	// Matchmaking queue
	queue   = make(map[string]*QueueEntry)
	queueMu sync.Mutex

	// Active rooms
	rooms   = make(map[string]*Room)
	roomsMu sync.RWMutex

	// WebSocket connections by user ID
	connections   = make(map[string]*websocket.Conn)
	connectionsMu sync.RWMutex

	// Reports storage
	reports   = make([]Report, 0)
	reportsMu sync.Mutex

	upgrader = websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool { return true },
	}
)

// ============== MAIN ==============

func main() {
	r := gin.Default()

	// CORS
	r.Use(func(c *gin.Context) {
		c.Header("Access-Control-Allow-Origin", "*")
		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Origin, Content-Type, Authorization")
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}
		c.Next()
	})

	// Health check
	r.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"status":    "online",
			"service":   "VOX-BRIDGE Nexus Core",
			"version":   "1.0.0-dev",
			"time":      time.Now().Format(time.RFC3339),
			"queue":     len(queue),
			"rooms":     len(rooms),
			"connected": len(connections),
		})
	})

	v1 := r.Group("/v1")
	{
		v1.POST("/auth/anonymous", handleAnonymousAuth)
		
		// WebSocket endpoint
		v1.GET("/ws", handleWebSocket)

		// Protected routes
		authorized := v1.Group("/")
		authorized.Use(authMiddleware())
		{
			authorized.PATCH("/user/preferences", handleUpdatePrefs)
		}
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("🌌 VOX-BRIDGE Nexus Core iniciando na porta %s", port)
	log.Printf("📡 Health check: http://localhost:%s/health", port)
	log.Printf("🔌 WebSocket: ws://localhost:%s/v1/ws?token=JWT", port)
	r.Run(":" + port)
}

// ============== AUTH ==============

func handleAnonymousAuth(c *gin.Context) {
	var input struct {
		AnonymousID    string   `json:"anonymous_id"`
		NativeLanguage string   `json:"native_language"`
		TargetLanguage string   `json:"target_language"`
		Interests      []string `json:"interests"`
		Country        string   `json:"country"`
	}
	c.ShouldBindJSON(&input)

	if input.AnonymousID == "" {
		input.AnonymousID = "NX-" + uuid.New().String()[:8]
	}
	if input.NativeLanguage == "" {
		input.NativeLanguage = "pt"
	}
	if input.TargetLanguage == "" {
		input.TargetLanguage = "en"
	}
	if input.Country == "" {
		input.Country = "BR"
	}

	usersMu.Lock()
	user, exists := users[input.AnonymousID]
	if !exists {
		user = &User{
			ID:             uuid.New().String(),
			AnonymousID:    input.AnonymousID,
			NativeLanguage: input.NativeLanguage,
			TargetLanguage: input.TargetLanguage,
			Interests:      input.Interests,
			Country:        input.Country,
		}
		users[input.AnonymousID] = user
	}
	usersMu.Unlock()

	token, _ := generateToken(user)

	c.JSON(http.StatusCreated, gin.H{
		"token":      token,
		"session_id": user.ID,
		"user":       user,
	})
}

func generateToken(user *User) (string, error) {
	claims := &Claims{
		UserID:      user.ID,
		AnonymousID: user.AnonymousID,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(24 * time.Hour)),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(jwtSecret)
}

func authMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "token_required"})
			return
		}

		tokenString := authHeader
		if len(authHeader) > 7 && authHeader[:7] == "Bearer " {
			tokenString = authHeader[7:]
		}

		claims := &Claims{}
		token, err := jwt.ParseWithClaims(tokenString, claims, func(t *jwt.Token) (interface{}, error) {
			return jwtSecret, nil
		})

		if err != nil || !token.Valid {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid_token"})
			return
		}

		c.Set("user_id", claims.UserID)
		c.Set("anonymous_id", claims.AnonymousID)
		c.Next()
	}
}

func handleUpdatePrefs(c *gin.Context) {
	userID := c.GetString("user_id")
	var prefs struct {
		NativeLanguage string `json:"native_language"`
		TargetLanguage string `json:"target_language"`
	}
	if err := c.ShouldBindJSON(&prefs); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_body"})
		return
	}

	usersMu.Lock()
	for _, u := range users {
		if u.ID == userID {
			if prefs.NativeLanguage != "" {
				u.NativeLanguage = prefs.NativeLanguage
			}
			if prefs.TargetLanguage != "" {
				u.TargetLanguage = prefs.TargetLanguage
			}
			break
		}
	}
	usersMu.Unlock()

	c.JSON(http.StatusOK, gin.H{"message": "preferences_updated"})
}

// ============== WEBSOCKET ==============

func handleWebSocket(c *gin.Context) {
	tokenString := c.Query("token")
	if tokenString == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "token_required"})
		return
	}

	claims := &Claims{}
	token, err := jwt.ParseWithClaims(tokenString, claims, func(t *jwt.Token) (interface{}, error) {
		return jwtSecret, nil
	})
	if err != nil || !token.Valid {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid_token"})
		return
	}

	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Printf("WebSocket upgrade error: %v", err)
		return
	}

	userID := claims.UserID
	
	// Get user
	usersMu.RLock()
	var user *User
	for _, u := range users {
		if u.ID == userID {
			user = u
			break
		}
	}
	usersMu.RUnlock()

	if user == nil {
		conn.Close()
		return
	}

	// Register connection
	connectionsMu.Lock()
	connections[userID] = conn
	connectionsMu.Unlock()

	log.Printf("🔌 User connected: %s (%s)", user.AnonymousID, userID)

	// Send welcome
	sendJSON(conn, WSMessage{Type: "connected", Payload: mustMarshal(gin.H{"user_id": userID})})

	// Handle messages
	go handleMessages(conn, user)
}

func handleMessages(conn *websocket.Conn, user *User) {
	defer func() {
		// Cleanup on disconnect
		connectionsMu.Lock()
		delete(connections, user.ID)
		connectionsMu.Unlock()

		queueMu.Lock()
		delete(queue, user.ID)
		queueMu.Unlock()

		// Leave room if in one
		leaveRoom(user.ID)

		conn.Close()
		log.Printf("🔌 User disconnected: %s", user.AnonymousID)
	}()

	for {
		_, message, err := conn.ReadMessage()
		if err != nil {
			break
		}

		var msg WSMessage
		if err := json.Unmarshal(message, &msg); err != nil {
			continue
		}

		switch msg.Type {
		case "join_queue":
			handleJoinQueue(conn, user)
		case "leave_queue":
			handleLeaveQueue(user)
		case "chat":
			handleChat(user, msg.Payload)
		case "typing":
			handleTyping(user, true)
		case "stop_typing":
			handleTyping(user, false)
		case "update_languages":
			handleUpdateLanguages(user, msg.Payload)
		case "update_interests":
			handleUpdateInterests(user, msg.Payload)
		case "report_user":
			handleReportUser(user, msg.Payload)
		case "block_user":
			handleBlockUser(user)
		case "leave_room":
			handleLeaveRoom(user)
		case "ping":
			sendJSON(conn, WSMessage{Type: "pong"})
		}
	}
}

// ============== MATCHMAKING ==============

func handleJoinQueue(conn *websocket.Conn, user *User) {
	queueMu.Lock()
	defer queueMu.Unlock()

	// Check if already in queue
	if _, exists := queue[user.ID]; exists {
		sendJSON(conn, WSMessage{Type: "already_in_queue"})
		return
	}

	// Check if already in room
	roomsMu.RLock()
	for _, room := range rooms {
		if room.User1.User.ID == user.ID || room.User2.User.ID == user.ID {
			roomsMu.RUnlock()
			sendJSON(conn, WSMessage{Type: "already_in_room"})
			return
		}
	}
	roomsMu.RUnlock()

	entry := &QueueEntry{
		User:     user,
		Conn:     conn,
		JoinedAt: time.Now(),
	}

	// Try to find a match
	var bestMatch *QueueEntry
	var bestMatchID string
	var bestScore int

	for id, partner := range queue {
		// Match: user wants partner's language AND partner wants user's language
		if partner.User.NativeLanguage == user.TargetLanguage &&
			partner.User.TargetLanguage == user.NativeLanguage {
			
			// Calculate match score based on common interests
			score := 1 // Base score for language match
			for _, ui := range user.Interests {
				for _, pi := range partner.User.Interests {
					if ui == pi {
						score++
					}
				}
			}

			if score > bestScore {
				bestScore = score
				bestMatch = partner
				bestMatchID = id
			}
		}
	}

	if bestMatch != nil {
		// Found match! Remove partner from queue
		delete(queue, bestMatchID)

		// Find common interests
		var commonInterests []string
		for _, ui := range user.Interests {
			for _, pi := range bestMatch.User.Interests {
				if ui == pi {
					commonInterests = append(commonInterests, ui)
				}
			}
		}

		// Create room
		roomID := "room-" + uuid.New().String()[:8]
		room := &Room{
			ID:      roomID,
			User1:   entry,
			User2:   bestMatch,
			Created: time.Now(),
		}

		roomsMu.Lock()
		rooms[roomID] = room
		roomsMu.Unlock()

		// Notify both users
		matchPayload1 := MatchFoundPayload{
			RoomID:          roomID,
			PartnerID:       bestMatch.User.AnonymousID,
			PartnerLang:     bestMatch.User.NativeLanguage,
			PartnerCountry:  bestMatch.User.Country,
			CommonInterests: commonInterests,
		}
		matchPayload2 := MatchFoundPayload{
			RoomID:          roomID,
			PartnerID:       user.AnonymousID,
			PartnerLang:     user.NativeLanguage,
			PartnerCountry:  user.Country,
			CommonInterests: commonInterests,
		}

		sendJSON(conn, WSMessage{Type: "match_found", Payload: mustMarshal(matchPayload1)})
		sendJSON(bestMatch.Conn, WSMessage{Type: "match_found", Payload: mustMarshal(matchPayload2)})

		log.Printf("🎯 Match! %s ↔ %s in room %s (score: %d, common: %v)", user.AnonymousID, bestMatch.User.AnonymousID, roomID, bestScore, commonInterests)
		return
	}

	// No match found, add to queue
	queue[user.ID] = entry
	sendJSON(conn, WSMessage{Type: "queue_joined", Payload: mustMarshal(gin.H{"position": len(queue)})})
	log.Printf("📥 %s joined queue (%s → %s). Queue size: %d", user.AnonymousID, user.NativeLanguage, user.TargetLanguage, len(queue))
}

func handleLeaveQueue(user *User) {
	queueMu.Lock()
	delete(queue, user.ID)
	queueMu.Unlock()

	connectionsMu.RLock()
	if conn, ok := connections[user.ID]; ok {
		sendJSON(conn, WSMessage{Type: "queue_left"})
	}
	connectionsMu.RUnlock()
}

// ============== CHAT ==============

func handleTyping(user *User, isTyping bool) {
	roomsMu.RLock()
	var partner *QueueEntry
	for _, r := range rooms {
		if r.User1.User.ID == user.ID {
			partner = r.User2
			break
		} else if r.User2.User.ID == user.ID {
			partner = r.User1
			break
		}
	}
	roomsMu.RUnlock()

	if partner != nil && partner.Conn != nil {
		msgType := "partner_typing"
		if !isTyping {
			msgType = "partner_stop_typing"
		}
		sendJSON(partner.Conn, WSMessage{Type: msgType})
	}
}

func handleUpdateLanguages(user *User, payload json.RawMessage) {
	var langs struct {
		NativeLanguage string `json:"native_language"`
		TargetLanguage string `json:"target_language"`
	}
	if err := json.Unmarshal(payload, &langs); err != nil {
		return
	}

	usersMu.Lock()
	if langs.NativeLanguage != "" {
		user.NativeLanguage = langs.NativeLanguage
	}
	if langs.TargetLanguage != "" {
		user.TargetLanguage = langs.TargetLanguage
	}
	usersMu.Unlock()

	connectionsMu.RLock()
	if conn, ok := connections[user.ID]; ok {
		sendJSON(conn, WSMessage{Type: "languages_updated", Payload: mustMarshal(gin.H{
			"native_language": user.NativeLanguage,
			"target_language": user.TargetLanguage,
		})})
	}
	connectionsMu.RUnlock()

	log.Printf("🌐 %s updated languages: %s → %s", user.AnonymousID, user.NativeLanguage, user.TargetLanguage)
}

func handleUpdateInterests(user *User, payload json.RawMessage) {
	var data struct {
		Interests []string `json:"interests"`
	}
	if err := json.Unmarshal(payload, &data); err != nil {
		return
	}

	usersMu.Lock()
	user.Interests = data.Interests
	usersMu.Unlock()

	connectionsMu.RLock()
	if conn, ok := connections[user.ID]; ok {
		sendJSON(conn, WSMessage{Type: "interests_updated", Payload: mustMarshal(gin.H{
			"interests": user.Interests,
		})})
	}
	connectionsMu.RUnlock()

	log.Printf("🎯 %s updated interests: %v", user.AnonymousID, user.Interests)
}

func handleReportUser(user *User, payload json.RawMessage) {
	var data struct {
		Reason  string `json:"reason"`
		Details string `json:"details"`
	}
	if err := json.Unmarshal(payload, &data); err != nil {
		return
	}

	// Find partner in room
	roomsMu.RLock()
	var reportedID string
	for _, r := range rooms {
		if r.User1.User.ID == user.ID {
			reportedID = r.User2.User.ID
			break
		} else if r.User2.User.ID == user.ID {
			reportedID = r.User1.User.ID
			break
		}
	}
	roomsMu.RUnlock()

	if reportedID == "" {
		return
	}

	report := Report{
		ID:         uuid.New().String(),
		ReporterID: user.ID,
		ReportedID: reportedID,
		Reason:     data.Reason,
		Details:    data.Details,
		CreatedAt:  time.Now(),
	}

	reportsMu.Lock()
	reports = append(reports, report)
	reportsMu.Unlock()

	connectionsMu.RLock()
	if conn, ok := connections[user.ID]; ok {
		sendJSON(conn, WSMessage{Type: "report_submitted"})
	}
	connectionsMu.RUnlock()

	log.Printf("🚨 Report submitted: %s reported %s for %s", user.AnonymousID, reportedID, data.Reason)
}

func handleBlockUser(user *User) {
	// Leave room and add to blocked list (simplified - just leaves room)
	leaveRoom(user.ID)
	
	connectionsMu.RLock()
	if conn, ok := connections[user.ID]; ok {
		sendJSON(conn, WSMessage{Type: "user_blocked"})
	}
	connectionsMu.RUnlock()
}

func handleChat(user *User, payload json.RawMessage) {
	var chatMsg struct {
		Message string `json:"message"`
	}
	if err := json.Unmarshal(payload, &chatMsg); err != nil || chatMsg.Message == "" {
		return
	}

	// Find user's room
	roomsMu.RLock()
	var room *Room
	var partner *QueueEntry
	for _, r := range rooms {
		if r.User1.User.ID == user.ID {
			room = r
			partner = r.User2
			break
		} else if r.User2.User.ID == user.ID {
			room = r
			partner = r.User1
			break
		}
	}
	roomsMu.RUnlock()

	if room == nil || partner == nil {
		return
	}

	// Send to partner
	chatPayload := ChatPayload{
		Message:   chatMsg.Message,
		SenderID:  user.AnonymousID,
		Timestamp: time.Now().UnixMilli(),
	}

	sendJSON(partner.Conn, WSMessage{Type: "chat", Payload: mustMarshal(chatPayload)})
	
	// Echo back to sender with confirmation
	sendJSON(connections[user.ID], WSMessage{Type: "chat_sent", Payload: mustMarshal(chatPayload)})
}

func handleLeaveRoom(user *User) {
	leaveRoom(user.ID)
}

func leaveRoom(userID string) {
	roomsMu.Lock()
	defer roomsMu.Unlock()

	for roomID, room := range rooms {
		var partner *QueueEntry
		if room.User1.User.ID == userID {
			partner = room.User2
		} else if room.User2.User.ID == userID {
			partner = room.User1
		} else {
			continue
		}

		// Notify partner
		if partner != nil && partner.Conn != nil {
			sendJSON(partner.Conn, WSMessage{Type: "partner_left"})
		}

		// Delete room
		delete(rooms, roomID)
		log.Printf("🚪 Room %s closed", roomID)
		return
	}
}

// ============== HELPERS ==============

func sendJSON(conn *websocket.Conn, msg WSMessage) {
	if conn == nil {
		return
	}
	data, _ := json.Marshal(msg)
	conn.WriteMessage(websocket.TextMessage, data)
}

func mustMarshal(v interface{}) json.RawMessage {
	data, _ := json.Marshal(v)
	return data
}
