
package services

import (
	"context"
	"fmt"
	"github.com/redis/go-redis/v9"
	"encoding/json"
	"time"
)

type MatchService struct {
	Redis *redis.Client
}

type MatchRequest struct {
	UserID         string `json:"user_id"`
	NativeLanguage string `json:"native_lang"`
	TargetLanguage string `json:"target_lang"`
}

func (s *MatchService) AddToQueue(req MatchRequest) error {
	ctx := context.Background()
	// Chave da fila baseada no idioma alvo para encontrar compatibilidade inversa
	queueKey := fmt.Sprintf("queue:%s:%s", req.NativeLanguage, req.TargetLanguage)
	
	val, _ := json.Marshal(req)
	return s.Redis.ZAdd(ctx, queueKey, redis.Z{
		Score:  float64(time.Now().Unix()),
		Member: val,
	}).Err()
}

func (s *MatchService) FindMatch(req MatchRequest) (*MatchRequest, error) {
	ctx := context.Background()
	// Procuramos alguém que fale o que eu quero aprender e queira aprender o que eu falo
	inverseKey := fmt.Sprintf("queue:%s:%s", req.TargetLanguage, req.NativeLanguage)
	
	vals, err := s.Redis.ZPopMin(ctx, inverseKey, 1).Result()
	if err != nil || len(vals) == 0 {
		return nil, nil
	}

	var partner MatchRequest
	json.Unmarshal([]byte(vals[0].Member.(string)), &partner)
	return &partner, nil
}
