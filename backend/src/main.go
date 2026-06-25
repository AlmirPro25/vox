package main

import (
	"log"
	"os"

	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
	"github.com/vox-bridge/nexus-core/src/controllers"
	"github.com/vox-bridge/nexus-core/src/middleware"
	"github.com/vox-bridge/nexus-core/src/models"
	"github.com/vox-bridge/nexus-core/src/services"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func main() {
	// Initialize DB (PostgreSQL)
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		log.Fatal("DATABASE_URL is required")
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		log.Fatal("Failed to connect to database:", err)
	}

	// Auto-migrate tables
	db.AutoMigrate(&models.User{}, &models.Session{}, &models.Report{})
	log.Println("Database migrated successfully")

	// Initialize Redis
	redisAddr := os.Getenv("REDIS_URL")
	if redisAddr == "" {
		redisAddr = "localhost:6379"
	}
	rdb := redis.NewClient(&redis.Options{
		Addr: redisAddr,
	})

	// Setup Services
	jwtSecret := []byte(os.Getenv("JWT_SECRET"))
	if len(jwtSecret) == 0 {
		jwtSecret = []byte("dev-secret-change-in-production")
	}
	authService := &services.AuthService{DB: db, JWTSecret: jwtSecret}
	matchService := &services.MatchService{Redis: rdb}
	translationService := services.NewTranslationService()

	handler := &controllers.NexusHandler{
		AuthService:  authService,
		MatchService: matchService,
	}

	wsHandler := controllers.NewWSHandler(translationService, matchService, authService)
	wsHandler.DB = db

	r := gin.Default()

	// Health check
	r.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok", "neural_bridge": translationService != nil})
	})

	// Public Routes
	v1 := r.Group("/v1")
	{
		v1.POST("/auth/anonymous", handler.HandleAnonymousAuth)
		v1.GET("/ws", wsHandler.HandleWS)
	}

	// Private Routes
	authorized := v1.Group("/")
	authorized.Use(middleware.AuthRequired(jwtSecret))
	{
		authorized.POST("/match/join", handler.HandleJoinQueue)
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	log.Printf("🌌 VOX-BRIDGE Nexus Core starting on port %s", port)
	r.Run(":" + port)
}
