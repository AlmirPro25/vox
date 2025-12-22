
# 🛰 Deployment Strategy: Scaling the Nexus

## 1. Infrastructure Requirements
- **Compute**: Minimum 2 vCPUs and 4GB RAM per node (Video encoding/decoding is intensive).
- **Networking**: Low-latency routes. Use AWS (Global Accelerator) or GCP (Premium Tier).
- **WebRTC**: Open ports 7880 (TCP) for signaling and 50000-60000 (UDP) for media streams.

## 2. Production Steps
1. **Database Migration**:
   ```bash
   docker exec nexus-backend npx prisma migrate deploy
   ```
2. **Environment Tuning**:
   Set `NODE_ENV=production` and `GOGC=100` for balanced garbage collection in Go.
3. **SSL Certificate**:
   Use Certbot (Let's Encrypt) to secure the Gateway (Nginx).

## 3. Scaling the Matchmaking
The system uses Redis Sorted Sets for matchmaking. To scale:
- Cluster Redis to handle millions of simultaneous queue entries.
- Deploy Backend instances geographically close to users (Edge Computing).

## 4. AI Thresholds
Monitor Gemini API quotas. The system implements circuit breakers to fallback to high-quality text translation if the multimodal live API exceeds limits.
