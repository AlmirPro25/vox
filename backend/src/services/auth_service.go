
package services

import (
	"errors"
	"time"
	"github.com/golang-jwt/jwt/v5"
	"github.com/vox-bridge/nexus-core/src/models"
	"gorm.io/gorm"
)

type AuthService struct {
	DB        *gorm.DB
	JWTSecret []byte
}

type Claims struct {
	UserID      string `json:"user_id"`
	AnonymousID string `json:"anonymous_id"`
	jwt.RegisteredClaims
}

func (s *AuthService) CreateAnonymousSession(anonymousID string, ip string) (*models.User, string, error) {
	var user models.User
	result := s.DB.Where("anonymous_id = ?", anonymousID).First(&user)

	if result.Error != nil {
		if errors.Is(result.Error, gorm.ErrRecordNotFound) {
			user = models.User{
				AnonymousID:    anonymousID,
				LastIP:         ip,
				NativeLanguage: "en",
			}
			if err := s.DB.Create(&user).Error; err != nil {
				return nil, "", err
			}
		} else {
			return nil, "", result.Error
		}
	}

	if user.IsBanned {
		return nil, "", errors.New("user_is_banned")
	}

	token, err := s.generateToken(&user)
	return &user, token, err
}

func (s *AuthService) generateToken(user *models.User) (string, error) {
	expirationTime := time.Now().Add(24 * time.Hour)
	claims := &Claims{
		UserID:      user.ID,
		AnonymousID: user.AnonymousID,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(expirationTime),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(s.JWTSecret)
}

func (s *AuthService) ValidateToken(tokenString string) (*Claims, error) {
	claims := &Claims{}
	token, err := jwt.ParseWithClaims(tokenString, claims, func(t *jwt.Token) (interface{}, error) {
		return s.JWTSecret, nil
	})

	if err != nil || !token.Valid {
		return nil, errors.New("invalid_token")
	}

	return claims, nil
}
