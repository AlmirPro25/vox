
package models

import (
	"time"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// User representa a identidade efêmera no Nexus
type User struct {
	ID             string    `gorm:"primaryKey;type:uuid" json:"id"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
	AnonymousID    string    `gorm:"uniqueIndex;not null" json:"anonymous_id"`
	LastIP         string    `json:"last_ip"`
	NativeLanguage string    `gorm:"default:'en'" json:"native_language"`
	TargetLanguage string    `json:"target_language"`
	Reputation     float64   `gorm:"default:100.0" json:"reputation"`
	IsBanned       bool      `gorm:"default:false" json:"is_banned"`
}

func (u *User) BeforeCreate(tx *gorm.DB) (err error) {
	if u.ID == "" {
		u.ID = uuid.New().String()
	}
	return
}

// Session registra métricas de tradução e IA
type Session struct {
	ID               string     `gorm:"primaryKey;type:uuid" json:"id"`
	UserID           string     `gorm:"not null" json:"user_id"`
	User             User       `gorm:"foreignKey:UserID" json:"-"`
	StartTime        time.Time  `gorm:"default:now()" json:"start_time"`
	EndTime          *time.Time `json:"end_time"`
	RoomID           string     `gorm:"uniqueIndex;not null" json:"room_id"`
	TranslationCount int        `gorm:"default:0" json:"translation_count"`
	AvgLatency       float64    `gorm:"default:0" json:"avg_latency"`
}

// Report para moderação neural e denúncias
type Report struct {
	ID             string    `gorm:"primaryKey;type:uuid" json:"id"`
	CreatedAt      time.Time `json:"created_at"`
	ReporterID     string    `json:"reporter_id"`
	ReportedUserID string    `json:"reported_user_id"`
	Reason         string    `json:"reason"`
	AiEvidence     string    `gorm:"type:jsonb" json:"ai_evidence"` // Flags de moderação IA
}
