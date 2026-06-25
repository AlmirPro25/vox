# � VOXGRID - Infraestrutura Soberana Multi-Continente

## VISÃO GERAL

Você quer rodar seu próprio TURN server em 3 continentes, sem depender de Metered.ca ou qualquer terceiro. Isso é 100% possível usando **Coturn** (open source, usado pelo Jitsi, Matrix, etc).

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        VOXGRID SOVEREIGN MESH                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   🇧🇷 BRASIL              🇪🇺 EUROPA              🇿🇦 ÁFRICA             │
│   ┌──────────┐           ┌──────────┐           ┌──────────┐           │
│   │  COTURN  │◄─────────►│  COTURN  │◄─────────►│  COTURN  │           │
│   │ São Paulo│   VPN     │ Frankfurt│   VPN     │ Cape Town│           │
│   │  $5/mês  │  Tunnel   │  $5/mês  │  Tunnel   │  $6/mês  │           │
│   └────┬─────┘           └────┬─────┘           └────┬─────┘           │
│        │                      │                      │                  │
│        └──────────────────────┼──────────────────────┘                  │
│                               │                                          │
│                    ┌──────────┴──────────┐                              │
│                    │   VOX-BRIDGE API    │                              │
│                    │   (Render/Fly.io)   │                              │
│                    │   Geo-routing DNS   │                              │
│                    └─────────────────────┘                              │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## CUSTO MENSAL ESTIMADO

| Componente | Provedor | Custo |
|------------|----------|-------|
| VPS Brasil (São Paulo) | Vultr/DigitalOcean | $5-6/mês |
| VPS Europa (Frankfurt) | Hetzner | $4-5/mês |
| VPS África (Cape Town) | Vultr | $6/mês |
| **TOTAL** | | **~$15-17/mês** |

Comparação:
- Metered.ca com 1000 usuários/dia: ~$120/mês
- Sua infra própria: ~$17/mês (economia de 85%)

---

## PASSO A PASSO

### FASE 1: Criar VPS em 3 Continentes

#### Opção A: Vultr (Recomendado - tem São Paulo e Cape Town)
1. Acesse https://www.vultr.com
2. Crie 3 VPS "Cloud Compute" ($5/mês cada):
   - **São Paulo** (Brasil)
   - **Frankfurt** (Europa) 
   - **Johannesburg** ou use Hetzner para Cape Town

#### Opção B: Mix de provedores
- **Brasil**: Vultr São Paulo ($5)
- **Europa**: Hetzner Frankfurt ($4)
- **África**: Vultr Johannesburg ($6)

Specs mínimas: 1 vCPU, 1GB RAM, Ubuntu 22.04

---

### FASE 2: Instalar Coturn em cada VPS

SSH em cada servidor e execute:

```bash
#!/bin/bash
# install-coturn.sh

# Atualizar sistema
apt update && apt upgrade -y

# Instalar Coturn
apt install -y coturn

# Habilitar serviço
systemctl enable coturn

# Gerar secret compartilhado (MESMO em todos os servidores!)
# Use este comando UMA VEZ e copie para todos:
# openssl rand -hex 32

# Criar configuração
cat > /etc/turnserver.conf << 'EOF'
# ===========================================
# VOXGRID COTURN CONFIG
# ===========================================

# Rede
listening-port=3478
tls-listening-port=5349
alt-listening-port=3479
alt-tls-listening-port=5350

# IPs (substitua pelo IP público do servidor)
listening-ip=0.0.0.0
external-ip=SEU_IP_PUBLICO

# Realm (seu domínio)
realm=voxgrid.voxbridge.app
server-name=voxgrid.voxbridge.app

# Autenticação HMAC (long-term credentials)
use-auth-secret
static-auth-secret=SEU_SECRET_COMPARTILHADO_AQUI

# Segurança
fingerprint
lt-cred-mech
no-multicast-peers
no-cli
no-tlsv1
no-tlsv1_1

# Logs
log-file=/var/log/turnserver.log
verbose

# Performance
total-quota=100
bps-capacity=0
stale-nonce=600

# Portas de relay (para NAT traversal)
min-port=49152
max-port=65535

# Certificados TLS (Let's Encrypt)
# cert=/etc/letsencrypt/live/turn.voxbridge.app/fullchain.pem
# pkey=/etc/letsencrypt/live/turn.voxbridge.app/privkey.pem
EOF

# Abrir portas no firewall
ufw allow 3478/tcp
ufw allow 3478/udp
ufw allow 5349/tcp
ufw allow 5349/udp
ufw allow 49152:65535/udp

# Reiniciar
systemctl restart coturn

echo "✅ Coturn instalado! Edite /etc/turnserver.conf com seu IP e secret"
```

---

### FASE 3: Configurar DNS Geo-Routing

Para que usuários conectem automaticamente ao servidor mais próximo:

#### Opção A: Cloudflare (Grátis com Load Balancing $5/mês)
1. Adicione seu domínio no Cloudflare
2. Crie registros A para cada região:
   ```
   turn-br.voxbridge.app → IP_BRASIL
   turn-eu.voxbridge.app → IP_EUROPA
   turn-af.voxbridge.app → IP_AFRICA
   ```
3. Configure Load Balancer com geo-steering

#### Opção B: Route53 (AWS) - Geolocation Routing
```
turn.voxbridge.app:
  - Brasil/América do Sul → IP_BRASIL
  - Europa → IP_EUROPA
  - África → IP_AFRICA
  - Default → IP_BRASIL
```

#### Opção C: Simples (sem geo-routing)
Retorne todos os servidores e deixe o WebRTC escolher o melhor:
```javascript
const turnServers = [
  { urls: 'turn:turn-br.voxbridge.app:3478', username, credential },
  { urls: 'turn:turn-eu.voxbridge.app:3478', username, credential },
  { urls: 'turn:turn-af.voxbridge.app:3478', username, credential },
];
```

---

### FASE 4: Atualizar Backend VOX-BRIDGE

```javascript
// backend-node/server.js - Endpoint /turn-credentials

app.get('/turn-credentials', (req, res) => {
  const crypto = require('crypto');
  
  // Secret compartilhado (MESMO em todos os Coturn servers)
  const TURN_SECRET = process.env.TURN_SECRET || 'seu_secret_aqui';
  
  // Gerar credenciais temporárias (HMAC)
  const ttl = 86400; // 24 horas
  const timestamp = Math.floor(Date.now() / 1000) + ttl;
  const username = `${timestamp}`;
  
  const hmac = crypto
    .createHmac('sha1', TURN_SECRET)
    .update(username)
    .digest('base64');
  
  // Retornar TODOS os servidores (WebRTC escolhe o melhor)
  const turnServers = [
    {
      urls: [
        'turn:turn-br.voxbridge.app:3478',
        'turn:turn-br.voxbridge.app:3478?transport=tcp',
        'turns:turn-br.voxbridge.app:5349?transport=tcp'
      ],
      username,
      credential: hmac
    },
    {
      urls: [
        'turn:turn-eu.voxbridge.app:3478',
        'turn:turn-eu.voxbridge.app:3478?transport=tcp',
        'turns:turn-eu.voxbridge.app:5349?transport=tcp'
      ],
      username,
      credential: hmac
    },
    {
      urls: [
        'turn:turn-af.voxbridge.app:3478',
        'turn:turn-af.voxbridge.app:3478?transport=tcp',
        'turns:turn-af.voxbridge.app:5349?transport=tcp'
      ],
      username,
      credential: hmac
    }
  ];
  
  res.json(turnServers);
});
```

---

### FASE 5: Certificados TLS (TURNS)

Para conexões seguras (TURNS na porta 5349):

```bash
# Em cada servidor
apt install -y certbot

# Gerar certificado (substitua pelo seu domínio)
certbot certonly --standalone -d turn-br.voxbridge.app

# Atualizar /etc/turnserver.conf
cert=/etc/letsencrypt/live/turn-br.voxbridge.app/fullchain.pem
pkey=/etc/letsencrypt/live/turn-br.voxbridge.app/privkey.pem

# Reiniciar
systemctl restart coturn

# Auto-renovação
echo "0 0 * * * certbot renew --quiet && systemctl restart coturn" | crontab -
```

---

## ARQUITETURA DE TÚNEL (Opcional - para relay entre continentes)

Se quiser que os servidores TURN se comuniquem entre si (relay federado):

### Opção A: WireGuard VPN (Recomendado)
```bash
# Em cada servidor
apt install -y wireguard

# Gerar chaves
wg genkey | tee privatekey | wg pubkey > publickey

# Configurar /etc/wireguard/wg0.conf
[Interface]
PrivateKey = SUA_CHAVE_PRIVADA
Address = 10.0.0.1/24  # Brasil: .1, Europa: .2, África: .3
ListenPort = 51820

[Peer]
PublicKey = CHAVE_PUBLICA_OUTRO_SERVIDOR
AllowedIPs = 10.0.0.2/32
Endpoint = IP_OUTRO_SERVIDOR:51820
PersistentKeepalive = 25
```

### Opção B: Tailscale (Mais fácil)
```bash
curl -fsSL https://tailscale.com/install.sh | sh
tailscale up
```

---

## MONITORAMENTO

### Script de Health Check
```bash
#!/bin/bash
# /opt/voxgrid/health-check.sh

SERVERS="turn-br.voxbridge.app turn-eu.voxbridge.app turn-af.voxbridge.app"

for server in $SERVERS; do
  if turnutils_uclient -T -u test -w test $server 2>/dev/null; then
    echo "✅ $server OK"
  else
    echo "❌ $server FAILED"
    # Enviar alerta (webhook, email, etc)
  fi
done
```

### Métricas Prometheus (Opcional)
```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'coturn'
    static_configs:
      - targets: ['turn-br:9641', 'turn-eu:9641', 'turn-af:9641']
```

---

## CHECKLIST DE DEPLOY

### Servidor Brasil
- [ ] VPS criada (Vultr São Paulo)
- [ ] Coturn instalado
- [ ] Firewall configurado
- [ ] DNS apontando (turn-br.voxbridge.app)
- [ ] Certificado TLS
- [ ] Testado com turnutils_uclient

### Servidor Europa
- [ ] VPS criada (Hetzner Frankfurt)
- [ ] Coturn instalado
- [ ] Firewall configurado
- [ ] DNS apontando (turn-eu.voxbridge.app)
- [ ] Certificado TLS
- [ ] Testado

### Servidor África
- [ ] VPS criada (Vultr Johannesburg)
- [ ] Coturn instalado
- [ ] Firewall configurado
- [ ] DNS apontando (turn-af.voxbridge.app)
- [ ] Certificado TLS
- [ ] Testado

### Backend
- [ ] TURN_SECRET configurado no Render
- [ ] Endpoint /turn-credentials atualizado
- [ ] Testado Brasil ↔ África

---

## TESTE FINAL

```bash
# Testar conectividade TURN
turnutils_uclient -T -u 1234567890 -w $(echo -n "1234567890" | openssl dgst -sha1 -hmac "SEU_SECRET" -binary | base64) turn-br.voxbridge.app

# Testar no browser (console)
const pc = new RTCPeerConnection({
  iceServers: [{
    urls: 'turn:turn-br.voxbridge.app:3478',
    username: '1234567890',
    credential: 'HMAC_GERADO'
  }]
});
pc.createDataChannel('test');
pc.createOffer().then(o => pc.setLocalDescription(o));
pc.onicecandidate = e => console.log(e.candidate?.candidate);
```

---

## RESUMO

| Item | Valor |
|------|-------|
| Custo mensal | ~$17 |
| Servidores | 3 (Brasil, Europa, África) |
| Software | Coturn (open source) |
| Dependência externa | ZERO |
| Escalabilidade | Adicionar mais VPS conforme cresce |

**Você terá soberania total sobre sua infraestrutura de vídeo.**

---

*Documento criado em 14/01/2026*
*VOXGRID Sovereign Infrastructure v1.0*
