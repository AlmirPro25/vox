
# VOX-BRIDGE Project Structure

## 🏗️ Backend (Go - Hexagonal Architecture)
```text
/cmd
  /api              # Entry point for the REST/WS server
/internal
  /core
    /domain         # Entities (User, Session, Match)
    /ports          # Interfaces (Repository, AIClient, StreamProvider)
    /services       # Business Logic (Matchmaking, AI Orchestrator)
  /adapters
    /db             # GORM/PostgreSQL implementation
    /cache          # Redis implementation
    /ai             # Gemini Multimodal Live API Client
    /media          # LiveKit/WebRTC logic
    /http           # Gin/Echo handlers
/pkg
  /logger           # Structured logging (Zap/Slog)
  /utils            # Crypto (AES-256), Validation
```

## 🌐 Frontend (Next.js 15)
```text
/src
  /app              # App Router (Home, Chat, Settings)
  /components
    /trinity        # 3-Column Specific Components
    /video          # WebRTC Video components
    /chat           # Real-time transcriptions
  /hooks            # useWebRTC, useGeminiLive, useMatchmaking
  /services         # API Client, WebSocket handlers
  /store            # State management (Zustand)
  /styles           # Tailwind config, Nexus Theme
```

## 📱 Mobile (Flutter)
```text
/lib
  /core             # Constants, Themes, API Config
  /domain           # Repositories & Entities
  /presentation     # BLoC/Provider states + 3-column UI
  /infrastructure   # LiveKit Flutter SDK integration
```
