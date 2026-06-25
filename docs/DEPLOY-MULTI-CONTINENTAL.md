# 🌍 VOXGRID - Deploy Multi-Continental Simplificado

## OBJETIVO
Clonar seu backend em 3 continentes e criar um túnel global para soberania total.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         ARQUITETURA SOBERANA                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   🇧🇷 SÃO PAULO           🇪🇺 FRANKFURT           🇿🇦 JOHANNESBURG          │
│   ┌────────────┐         ┌────────────┐         ┌────────────┐             │
│   │  COTURN    │◄───────►│  COTURN    │◄───────►│  COTURN    │             │
│   │  + API     │  Mesh   │  + API     │  Mesh   │  + API     │             │
│   │  $5/mês    │         │  $5/mês    │         │  $6/mês    │             │
│   └─────┬──────┘         └─────┬──────┘         └─────┬──────┘             │
│         │                      │                      │                     │
│         └──────────────────────┼──────────────────────┘                     │
│                                │                                            │
│                    ┌───────────┴───────────┐                               │
│                    │   CLOUDFLARE DNS      │                               │
│                    │   Geo-routing grátis  │                               │
│                    │   api.voxbridge.app   │                               │
│                    └───────────────────────┘                               │
│                                                                              │
│   Usuário Brasil → Conecta em São Paulo                                     │
│   Usuário Nigéria → Conecta em Johannesburg                                 │
│   Usuário Europa → Conecta em Frankfurt                                     │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## CUSTO TOTAL: ~$16/mês

| Região | Provedor | Spec | Custo |
|--------|----------|------|-------|
| Brasil (São Paulo) | Vultr | 1 vCPU, 1GB RAM | $5/mês |
| Europa (Frankfurt) | Hetzner | 1 vCPU, 2GB RAM | $4/mês |
| África (Johannesburg) | Vultr | 1 vCPU, 1GB RAM | $6/mês |
| DNS | Cloudflare | Free tier | $0 |

---

## PASSO 1: Criar as 3 VPS

### 1.1 Vultr (Brasil + África)
1. Acesse https://www.vultr.com
2. Deploy → Cloud Compute → Regular Performance
3. Selecione **São Paulo** → Ubuntu 22.04 → $5/mês
4. Repita para **Johannesburg** → $6/mês

### 1.2 Hetzner (Europa)
1. Acesse https://www.hetzner.com/cloud
2. Create Server → Falkenstein ou Frankfurt
3. Ubuntu 22.04 → CX11 (€3.29/mês ≈ $4)

---

## PASSO 2: Script de Deploy Unificado

Execute em CADA servidor:

```bash
#!/bin/bash
# deploy-voxgrid-node.sh
# Execute: curl -sSL https://raw.githubusercontent.com/seu-repo/deploy.sh | sudo bash

set -e

# ============================================
# CONFIGURAÇÕES (EDITE AQUI)
# ============================================
TURN_SECRET="SEU_SECRET_COMPARTILHADO"  # MESMO em todos os servidores!
DOMAIN="voxbridge.app"
REGION="br"  # br, eu, ou af

# ============================================
# DETECTAR IP
# ============================================
PUBLIC_IP=$(curl -s ifconfig.me)
echo "📍 IP: $PUBLIC_IP"
echo "🌍 Região: $REGION"

# ============================================
# INSTALAR DEPENDÊNCIAS
# ============================================
apt update && apt upgrade -y
apt install -y coturn nodejs npm nginx certbot python3-certbot-nginx

# ============================================
# CONFIGURAR COTURN
# ============================================
cat > /etc/turnserver.conf << EOF
listening-port=3478
tls-listening-port=5349
listening-ip=0.0.0.0
external-ip=$PUBLIC_IP
realm=$DOMAIN
server-name=turn-$REGION.$DOMAIN
use-auth-secret
static-auth-secret=$TURN_SECRET
fingerprint
lt-cred-mech
no-multicast-peers
no-cli
no-tlsv1
no-tlsv1_1
min-port=49152
max-port=65535
log-file=/var/log/turnserver.log
EOF

sed -i 's/#TURNSERVER_ENABLED=1/TURNSERVER_ENABLED=1/' /etc/default/coturn
systemctl enable coturn
systemctl restart coturn

# ============================================
# CONFIGURAR FIREWALL
# ============================================
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 3478/tcp
ufw allow 3478/udp
ufw allow 5349/tcp
ufw allow 49152:65535/udp
ufw allow 8080/tcp
ufw --force enable

# ============================================
# CLONAR E RODAR BACKEND
# ============================================
mkdir -p /opt/voxbridge
cd /opt/voxbridge

# Clone seu repo ou copie os arquivos
# git clone https://github.com/seu-repo/vox-bridge.git .

# Criar .env
cat > .env << EOF
PORT=8080
TURN_SECRET=$TURN_SECRET
TURN_SERVERS=turn-br.$DOMAIN,turn-eu.$DOMAIN,turn-af.$DOMAIN
NODE_ENV=production
REGION=$REGION
EOF

npm install
npm install -g pm2
pm2 start server.js --name voxbridge
pm2 save
pm2 startup

# ============================================
# NGINX REVERSE PROXY
# ============================================
cat > /etc/nginx/sites-available/voxbridge << EOF
server {
    listen 80;
    server_name api-$REGION.$DOMAIN turn-$REGION.$DOMAIN;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    }
}
EOF

ln -sf /etc/nginx/sites-available/voxbridge /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx

echo "✅ Deploy completo! Configure DNS e SSL."
```

---

## PASSO 3: Configurar DNS no Cloudflare

1. Adicione seu domínio no Cloudflare (grátis)
2. Crie os registros:

```
# APIs regionais
api-br.voxbridge.app  →  A  →  IP_BRASIL
api-eu.voxbridge.app  →  A  →  IP_EUROPA
api-af.voxbridge.app  →  A  →  IP_AFRICA

# TURN servers
turn-br.voxbridge.app →  A  →  IP_BRASIL     (Proxy: OFF ⚠️)
turn-eu.voxbridge.app →  A  →  IP_EUROPA     (Proxy: OFF ⚠️)
turn-af.voxbridge.app →  A  →  IP_AFRICA     (Proxy: OFF ⚠️)

# API principal com geo-routing (Load Balancer ou Workers)
api.voxbridge.app     →  CNAME → api-br.voxbridge.app (default)
```

⚠️ **IMPORTANTE**: TURN servers devem ter Proxy DESLIGADO (nuvem cinza)

### Geo-Routing Grátis com Cloudflare Workers

```javascript
// workers/geo-router.js
export default {
  async fetch(request) {
    const country = request.cf?.country || 'BR';
    
    // Mapear país para região
    const regionMap = {
      // América do Sul
      'BR': 'br', 'AR': 'br', 'CL': 'br', 'CO': 'br', 'PE': 'br',
      // Europa
      'DE': 'eu', 'FR': 'eu', 'GB': 'eu', 'ES': 'eu', 'IT': 'eu', 'PT': 'eu',
      // África
      'ZA': 'af', 'NG': 'af', 'KE': 'af', 'EG': 'af', 'GH': 'af',
    };
    
    const region = regionMap[country] || 'br';
    const url = new URL(request.url);
    url.hostname = `api-${region}.voxbridge.app`;
    
    return fetch(url.toString(), request);
  }
}
```

---

## PASSO 4: SSL com Let's Encrypt

Em cada servidor:

```bash
# Certificado para API
certbot --nginx -d api-br.voxbridge.app

# Certificado para TURN (standalone porque não passa pelo nginx)
certbot certonly --standalone -d turn-br.voxbridge.app --preferred-challenges http

# Atualizar coturn para usar SSL
cat >> /etc/turnserver.conf << EOF
cert=/etc/letsencrypt/live/turn-br.voxbridge.app/fullchain.pem
pkey=/etc/letsencrypt/live/turn-br.voxbridge.app/privkey.pem
EOF

systemctl restart coturn

# Auto-renovação
echo "0 0 * * * certbot renew --quiet && systemctl restart coturn nginx" | crontab -
```

---

## PASSO 5: Atualizar Frontend

```typescript
// VideoStage.tsx - Detectar região automaticamente
const getApiUrl = () => {
  // Em produção, usa o geo-router
  if (process.env.NODE_ENV === 'production') {
    return 'https://api.voxbridge.app';
  }
  return 'http://localhost:8080';
};

// Buscar TURN credentials do servidor mais próximo
const fetchTurnCredentials = async () => {
  const res = await fetch(`${getApiUrl()}/turn-credentials`);
  return res.json();
};
```

---

## PASSO 6: Testar

### Teste TURN local
```bash
# Em cada servidor
turnutils_uclient -T -u test -w test localhost
```

### Teste TURN remoto
```bash
# Do seu PC
turnutils_uclient -T -u 1234567890 -w $(echo -n "1234567890" | openssl dgst -sha1 -hmac "SEU_SECRET" -binary | base64) turn-br.voxbridge.app
```

### Teste Brasil ↔ África
1. Abra o app no Brasil
2. Peça pro amigo na Nigéria abrir
3. Conectem
4. No console (F12), verifique:
```
📡 VOXGRID ICE: relay (TURN) | local=relay remote=relay
```

---

## MONITORAMENTO

### Health Check Script
```bash
#!/bin/bash
# /opt/voxbridge/health-check.sh

SERVERS="turn-br.voxbridge.app turn-eu.voxbridge.app turn-af.voxbridge.app"
WEBHOOK="https://discord.com/api/webhooks/SEU_WEBHOOK"

for server in $SERVERS; do
  if curl -s --max-time 5 "https://api-${server#turn-}.voxbridge.app/health" | grep -q "healthy"; then
    echo "✅ $server OK"
  else
    echo "❌ $server FAILED"
    curl -X POST "$WEBHOOK" -H "Content-Type: application/json" \
      -d "{\"content\": \"🚨 VOXGRID: $server está DOWN!\"}"
  fi
done
```

Adicione ao cron:
```bash
*/5 * * * * /opt/voxbridge/health-check.sh >> /var/log/voxgrid-health.log 2>&1
```

---

## RESUMO

| Etapa | Tempo | Dificuldade |
|-------|-------|-------------|
| Criar 3 VPS | 15 min | Fácil |
| Rodar script de deploy | 10 min cada | Fácil |
| Configurar DNS | 10 min | Fácil |
| SSL | 5 min cada | Fácil |
| Testar | 15 min | Médio |

**Total: ~1 hora para ter infraestrutura global soberana**

---

## PRÓXIMOS PASSOS

1. [ ] Criar VPS Brasil (Vultr São Paulo)
2. [ ] Criar VPS Europa (Hetzner Frankfurt)
3. [ ] Criar VPS África (Vultr Johannesburg)
4. [ ] Gerar TURN_SECRET compartilhado
5. [ ] Rodar script em cada servidor
6. [ ] Configurar DNS no Cloudflare
7. [ ] Instalar SSL
8. [ ] Testar Brasil ↔ África
9. [ ] Configurar monitoramento

Quando tiver as VPS criadas, me avisa que a gente configura juntos!
