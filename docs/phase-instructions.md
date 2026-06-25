
# Phase 2 Instructions: Backend Forge 🚀

## 🎯 Goal
Build the high-performance Go backend with LiveKit and Gemini 2.0 integration.

## 🛠️ Implementation Steps

### 1. The Core (Domain)
- Define `User`, `Match`, and `AudioStream` entities.
- Implement the `Matchmaker` logic using Redis Sorted Sets to group users by `(native_language, target_language, interest_tags)`.

### 2. LiveKit Interceptor (The Bridge)
- Use LiveKit's **Server SDK** to join rooms as a "hidden bot".
- Eavesdrop on the audio track of User A.
- **DO NOT** forward User A's audio to User B.

### 3. Gemini Multimodal Live Integration
- Open a WebSocket to `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.ModelService/BidiGenerateContent`.
- Send the raw PCM audio chunks from LiveKit to Gemini.
- Receive the translated PCM audio chunks.
- Inject the translated audio into the LiveKit track assigned to User B.

### 4. Neural Moderation
- Implement a background Goroutine that samples video frames every 3 seconds.
- Send frames to Gemini 2.0 Flash for content safety analysis.
- If violation detected, terminate the session and flag the user in PostgreSQL.

## 🔒 Security Requirements
- All API communication must be TLS 1.3.
- JWT tokens for all WebSocket connections.
- AES-256-GCM encryption for the text-based backup chat.

## ⚡ Performance Targets
- Cold start connection < 1s.
- Audio buffer size: 20ms to 40ms for minimal jitter.
- Max Goroutines per core: Optimized via Load Balancer.
