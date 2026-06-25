# ============================================================================
# VOXGRID API - Dockerfile
# ============================================================================

FROM node:20-alpine

WORKDIR /app

# Instalar dependências de build
RUN apk add --no-cache curl

# Copiar package files
COPY package*.json ./

# Instalar dependências
RUN npm ci --only=production

# Copiar código
COPY . .

# Expor porta
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:8080/health || exit 1

# Rodar
CMD ["node", "server.js"]
