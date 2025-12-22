
# 🌌 VOX-BRIDGE: The Global Nexus

> **"The End of Foreign."**
> VOX-BRIDGE is an ultra-low latency, AI-mediated communication infrastructure designed to eradicate language barriers through real-time multimodal translation.

## 🏛 Architecture & Lore
Created by **Aurelius, the Architect of the Nexus**, this system operates on a 3-column paradigm:
1. **Navigation/Filters**: Managing your global identity.
2. **Video/Focus**: Direct human connection.
3. **Context/Neural**: Real-time AI translation and cultural context.

Powered by **Gemini 2.0 Flash**, VOX-BRIDGE intercepts audio streams and translates them natively, preserving tone and emotion without the delay of traditional STT/TTS pipelines.

## 🚀 Rapid Deployment

### Prerequisites
- Docker & Docker Compose
- Google Gemini API Key
- LiveKit Server (or LiveKit Cloud API Key)

### Local Forging
1. Clone the repository.
2. Configure `.env` (use `.env.example` as base).
3. Execute the nexus:
   ```bash
   docker-compose up --build
   ```
4. Access the interface: `http://localhost:3000`

## 🛠 Tech Stack
- **Backend**: Go (Hexagonal Architecture), WebRTC (LiveKit), Redis (Matchmaking).
- **Frontend**: Next.js 15 (App Router), Tailwind CSS, Framer Motion.
- **AI**: Gemini 2.0 Flash Multimodal Live API.
- **Database**: PostgreSQL (Prisma).

## 🛡 Security Manifesto
- **Zero-Knowledge**: No private audio/video logs are stored.
- **AES-256-GCM**: Encryption for all metadata.
- **Neural Moderation**: Real-time AI scanning for safety.
