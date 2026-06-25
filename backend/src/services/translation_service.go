package services

import (
	"context"
	"fmt"
	"log"
	"os"

	"github.com/google/generative-ai-go/genai"
	"google.golang.org/api/option"
)

type TranslationService struct {
	client *genai.Client
	ctx    context.Context
}

func NewTranslationService() *TranslationService {
	apiKey := os.Getenv("GEMINI_API_KEY")
	if apiKey == "" {
		log.Println("⚠️ GEMINI_API_KEY not found. Translation will be disabled.")
		return &TranslationService{}
	}

	ctx := context.Background()
	client, err := genai.NewClient(ctx, option.WithAPIKey(apiKey))
	if err != nil {
		log.Printf("❌ Failed to create Gemini client: %v", err)
		return &TranslationService{}
	}

	return &TranslationService{
		client: client,
		ctx:    ctx,
	}
}

func (s *TranslationService) Translate(text, fromLang, toLang string) (string, error) {
	if s.client == nil {
		return text, nil // Fallback
	}

	model := s.client.GenerativeModel("gemini-1.5-flash")
	model.SetTemperature(0.2) // Low temperature for accuracy

	prompt := fmt.Sprintf("Translate the following text from %s to %s. Return ONLY the translated text without any explanations or quotes: %s", fromLang, toLang, text)

	resp, err := model.GenerateContent(s.ctx, genai.Text(prompt))
	if err != nil {
		return "", err
	}

	if len(resp.Candidates) == 0 || len(resp.Candidates[0].Content.Parts) == 0 {
		return "", fmt.Errorf("no translation generated")
	}

	translated := ""
	for _, part := range resp.Candidates[0].Content.Parts {
		translated += fmt.Sprintf("%v", part)
	}

	return translated, nil
}
