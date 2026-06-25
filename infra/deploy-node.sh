#!/bin/bash
# ============================================================================
# VOXGRID SOVEREIGN NODE - One-Click Deploy
# ============================================================================
# 
# USO:
#   curl -sSL https://raw.githubusercontent.com/SEU_REPO/deploy-node.sh | \
#     TURN_SECRET=xxx REGION=br bash
#
# OU localmente:
#   chmod +x deploy-node.sh
#   TURN_SECRET=xxx REGION=br ./deploy-node.sh
#
# REGIÕES: br (Brasil), eu (Europa), af (África)
# ============================================================================

set -e

# Cores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}🌐 VOXGRID SOVEREIGN NODE - Deploy${NC}"
echo "============================================"

# ============================================
# VALIDAR PARÂMETROS
# ============================================
if [ -z "$TURN_SECRET" ]; then
    echo -e "${RED}❌ TURN_SECRET não definido!${NC}"
    echo "Use: TURN_SECRET=xxx REGION=br ./deploy-node.sh"
    exit 1
fi

if [ -z "$REGION" ]; then
    echo -e "${YELLOW}⚠️ REGION não definido, usando 'br'${NC}"
    REGION="br"
fi

# Detectar IP público
PUBLIC_IP=$(curl -s ifconfig.me || curl -s icanhazip.com)
echo -e "📍 IP Público: ${GREEN}$PUBLIC_IP${NC}"
echo -e "🌍 Região: ${GREEN}$REGION${NC}"

# ============================================
# INSTALAR DOCKER
# ============================================
if ! command -v docker &> /dev/null; then
    echo -e "${YELLOW}📦 Instalando Docker...${NC}"
    curl -fsSL https://get.docker.com | sh
    systemctl enable docker
    systemctl start docker
fi

if ! command -v docker-compose &> /dev/null; then
    echo -e "${YELLOW}📦 Instalando Docker Compose...${NC}"
    apt-get update && apt-get install -y docker-compose-plugin
fi

# ============================================
# CRIAR ESTRUTURA
# ============================================
INSTALL_DIR="/opt/voxgrid"
mkdir -p $INSTALL_DIR
cd $INSTALL_DIR

echo -e "${YELLOW}📁 Criando estrutura em $INSTALL_DIR${NC}"

# Criar diretórios
mkdir -p coturn nginx certs certbot-webroot backend-node

# ============================================
# CONFIGURAÇÃO COTURN
# ============================================
cat > coturn/turnserver.conf << EOF
listening-port=3478
tls-listening-port=5349
listening-ip=0.0.0.0
external-ip=$PUBLIC_IP
realm=voxgrid.voxbridge.app
server-name=turn-$REGION.voxbridge.app
use-auth-secret
static-auth-secret=$TURN_SECRET
fingerprint
lt-cred-mech
no-multicast-peers
no-cli
no-tlsv1
no-tlsv1_1
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
total-quota=100
min-port=49152
max-port=65535
log-file=/var/log/turnserver.log
verbose
EOF

# ============================================
# CONFIGURAÇÃO NGINX (HTTP only inicialmente)
# ============================================
cat > nginx/nginx.conf << 'EOF'
events {
    worker_connections 1024;
}

http {
    upstream voxgrid_api {
        server api:8080;
    }

    server {
        listen 80;
        server_name _;

        location /.well-known/acme-challenge/ {
            root /var/www/certbot;
        }

        location / {
            proxy_pass http://voxgrid_api;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_read_timeout 86400s;
        }
    }
}
EOF

# ============================================
# BACKEND NODE (código mínimo)
# ============================================
cat > backend-node/package.json << 'EOF'
{
  "name": "voxgrid-api",
  "version": "1.0.0",
  "main": "server.js",
  "scripts": {
    "start": "node server.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "ws": "^8.14.2",
    "cors": "^2.8.5",
    "uuid": "^9.0.0",
    "dotenv": "^16.3.1"
  }
}
EOF

# Copiar server.js se existir no repo, senão criar mínimo
if [ ! -f backend-node/server.js ]; then
    echo -e "${YELLOW}⚠️ server.js não encontrado, criando versão mínima${NC}"
    cat > backend-node/server.js << 'SERVEREOF'
require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const users = new Map();
const queue = [];
const rooms = new Map();

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', region: process.env.REGION, users: users.size });
});

app.get('/turn-credentials', (req, res) => {
  const TURN_SECRET = process.env.TURN_SECRET;
  const TURN_SERVERS = process.env.TURN_SERVERS || 'turn-br.voxbridge.app,turn-eu.voxbridge.app,turn-af.voxbridge.app';
  
  const ttl = 86400;
  const timestamp = Math.floor(Date.now() / 1000) + ttl;
  const username = `${timestamp}`;
  const hmac = crypto.createHmac('sha1', TURN_SECRET).update(username).digest('base64');
  
  const servers = TURN_SERVERS.split(',').map(s => ({
    urls: [`turn:${s.trim()}:3478?transport=tcp`, `turn:${s.trim()}:3478`],
    username,
    credential: hmac
  }));
  
  res.json(servers);
});

wss.on('connection', (ws) => {
  const id = uuidv4();
  users.set(id, { id, ws });
  ws.send(JSON.stringify({ type: 'connected', payload: { userId: id, online: users.size } }));
  ws.on('close', () => users.delete(id));
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log(`🚀 VOXGRID API running on port ${PORT}`));
SERVEREOF
fi

cat > backend-node/Dockerfile << 'EOF'
FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache curl
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=10s CMD curl -f http://localhost:8080/health || exit 1
CMD ["node", "server.js"]
EOF

# ============================================
# DOCKER COMPOSE
# ============================================
cat > docker-compose.yml << EOF
version: '3.8'

services:
  coturn:
    image: coturn/coturn:latest
    container_name: voxgrid-coturn
    restart: unless-stopped
    network_mode: host
    volumes:
      - ./coturn/turnserver.conf:/etc/turnserver.conf:ro
    command: -c /etc/turnserver.conf

  api:
    build: ./backend-node
    container_name: voxgrid-api
    restart: unless-stopped
    ports:
      - "8080:8080"
    environment:
      - PORT=8080
      - NODE_ENV=production
      - TURN_SECRET=$TURN_SECRET
      - TURN_SERVERS=turn-br.voxbridge.app,turn-eu.voxbridge.app,turn-af.voxbridge.app
      - REGION=$REGION

  nginx:
    image: nginx:alpine
    container_name: voxgrid-nginx
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./certs:/etc/letsencrypt:ro
      - ./certbot-webroot:/var/www/certbot:ro
    depends_on:
      - api
EOF

# ============================================
# FIREWALL
# ============================================
echo -e "${YELLOW}🔥 Configurando firewall...${NC}"
if command -v ufw &> /dev/null; then
    ufw allow 22/tcp
    ufw allow 80/tcp
    ufw allow 443/tcp
    ufw allow 3478/tcp
    ufw allow 3478/udp
    ufw allow 5349/tcp
    ufw allow 49152:65535/udp
    ufw --force enable
fi

# ============================================
# INICIAR SERVIÇOS
# ============================================
echo -e "${YELLOW}🚀 Iniciando serviços...${NC}"
docker compose build
docker compose up -d

# Aguardar
sleep 5

# ============================================
# VERIFICAR
# ============================================
echo ""
echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN}✅ VOXGRID NODE DEPLOYED!${NC}"
echo -e "${GREEN}============================================${NC}"
echo ""
echo -e "📍 IP: ${GREEN}$PUBLIC_IP${NC}"
echo -e "🌍 Região: ${GREEN}$REGION${NC}"
echo ""
echo -e "🔗 Endpoints:"
echo -e "   API: http://$PUBLIC_IP/health"
echo -e "   TURN: turn:$PUBLIC_IP:3478"
echo ""
echo -e "📋 Próximos passos:"
echo -e "   1. Configure DNS: turn-$REGION.voxbridge.app → $PUBLIC_IP"
echo -e "   2. Configure DNS: api-$REGION.voxbridge.app → $PUBLIC_IP"
echo -e "   3. Instale SSL: certbot certonly --webroot -w /opt/voxgrid/certbot-webroot -d api-$REGION.voxbridge.app"
echo ""
echo -e "📊 Logs:"
echo -e "   docker compose logs -f"
echo ""
echo -e "🧪 Testar TURN:"
echo -e "   turnutils_uclient -T -u test -w test $PUBLIC_IP"
echo ""

# Verificar health
if curl -s http://localhost/health | grep -q "healthy"; then
    echo -e "${GREEN}✅ API está saudável!${NC}"
else
    echo -e "${RED}⚠️ API pode não estar respondendo ainda. Verifique: docker compose logs api${NC}"
fi
