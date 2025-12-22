
package controllers

import (
	"net/http"
	"github.com/gin-gonic/gin"
	"github.com/vox-bridge/nexus-core/src/services"
	"github.com/vox-bridge/nexus-core/src/models"
)

type NexusHandler struct {
	AuthService  *services.AuthService
	MatchService *services.MatchService
}

func (h *NexusHandler) HandleAnonymousAuth(c *gin.Context) {
	var input struct {
		AnonymousID string `json:"anonymous_id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_payload"})
		return
	}

	user, token, err := h.AuthService.CreateAnonymousSession(input.AnonymousID, c.ClientIP())
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"token":      token,
		"session_id": user.ID,
		"aes_key":    "SUPER_SECRET_AES_REPLACE_IN_PROD",
	})
}

func (h *NexusHandler) HandleJoinQueue(c *gin.Context) {
	userID := c.GetString("user_id")
	var prefs models.User
	// Atualiza preferências antes de entrar na fila
	if err := c.ShouldBindJSON(&prefs); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_prefs"})
		return
	}

	matchReq := services.MatchRequest{
		UserID:         userID,
		NativeLanguage: prefs.NativeLanguage,
		TargetLanguage: prefs.TargetLanguage,
	}

	// Tenta match imediato
	partner, _ := h.MatchService.FindMatch(matchReq)
	if partner != nil {
		c.JSON(http.StatusOK, gin.H{
			"status":     "connected",
			"partner_id": partner.UserID,
			"room_id":    "room_" + userID + "_" + partner.UserID,
		})
		return
	}

	h.MatchService.AddToQueue(matchReq)
	c.JSON(http.StatusAccepted, gin.H{"status": "searching"})
}
