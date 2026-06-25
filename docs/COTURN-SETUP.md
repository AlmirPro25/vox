# 🧊 Coturn Setup Guide - VOX-BRIDGE

## Quando você precisa de TURN próprio?

- ❌ Quedas "aleatórias" mesmo com frontend perfeito
- 📱 Muitos usuários mobile (4G/5G)
- 🌍 Usuários em países diferentes
- 💸 Conta do TURN público subindo
- ⏱️ Calls caem após 20-60s

## 1. Escolher VPS

### Requisitos mínimos
- 2 vCPU
- 4GB RAM
- 1TB+ bandwidth/mês
- IP público fixo
- Portas UDP abertas

### Provedores recomendados (custo-benefício)
- **Vultr** - $24/mês (High Frequency)
- **DigitalOcean** - $24/mês (Premium AMD)
- **Hetzner** - €15/mês (melhor custo na Europa)
- **OVH** - €20/mês (bom para Europa)

### Capacidade estimada
- 2 vCPU / 4GB: ~300-600 conexões relay simultâneas
- 4 vCPU / 8GB: ~800-1500 conexões relay simultâneas

## 2. Instalar Coturn

```bash
# Ubuntu/Debian
sudo apt update
sudo apt install coturn -y

# Habilitar serviço
sudo systemctl enable coturn
```

## 3. Configurar Coturn

Edite `/etc/turnserver.conf`:

```conf
# ============================================
# COTURN CONFIG - VOX-BRIDGE
# ============================================

# Portas
listening-port=3478
tls-listening-port=5349
min-port=49152
max-port=65535

# IP (substitua pelo IP público da VPS)
listening-ip=0.0.0.0
external-ip=SEU_IP_PUBLICO

# Autenticação HMAC (OBRIGATÓRIO)
fingerprint
lt-cred-mech
use-auth-secret
static-auth-secret=GERE_UM_SEGREDO_FORTE_AQUI

# Domínio
realm=vox-bridge.com

# Limites
total-quota=1000
bps-capacity=0
stale-nonce=600

# Segurança
no-loopback-peers
no-multicast-peers
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=172.16.0.0-172.31.255.255

# Logs
log-file=/var/log/turnserver.log
verbose

# SSL (opcional mas recomendado)
# cert=/etc/letsencrypt/live/turn.seudominio.com/fullchain.pem
# pkey=/etc/letsencrypt/live/turn.seudominio.com/privkey.pem
```

## 4. Gerar segredo forte

```bash
# Gerar segredo de 32 caracteres
openssl rand -hex 16
```

Copie o resultado e coloque em `static-auth-secret`.

## 5. Abrir portas no firewall

```bash
# UFW
sudo ufw allow 3478/tcp
sudo ufw allow 3478/udp
sudo ufw allow 5349/tcp
sudo ufw allow 5349/udp
sudo ufw allow 49152:65535/udp

# Ou iptables
sudo iptables -A INPUT -p tcp --dport 3478 -j ACCEPT
sudo iptables -A INPUT -p udp --dport 3478 -j ACCEPT
sudo iptables -A INPUT -p tcp --dport 5349 -j ACCEPT
sudo iptables -A INPUT -p udp --dport 5349 -j ACCEPT
sudo iptables -A INPUT -p udp --dport 49152:65535 -j ACCEPT
```

## 6. Iniciar Coturn

```bash
sudo systemctl start coturn
sudo systemctl status coturn

# Ver logs
sudo tail -f /var/log/turnserver.log
```

## 7. Configurar Backend (Render)

No Render, adicione as variáveis de ambiente:

```
TURN_SECRET=seu_segredo_aqui
TURN_URLS=turn:SEU_IP:3478,turns:SEU_IP:5349
```

## 8. Testar

### Teste local
```bash
turnutils_uclient -T -u test -w test SEU_IP
```

### Teste no browser
Abra o console e verifique:
```javascript
// Se aparecer candidateType: "relay" = TURN funcionando
```

## 9. SSL (Produção)

Para TURNS (TURN sobre TLS):

```bash
# Instalar certbot
sudo apt install certbot -y

# Gerar certificado
sudo certbot certonly --standalone -d turn.seudominio.com

# Adicionar ao turnserver.conf
cert=/etc/letsencrypt/live/turn.seudominio.com/fullchain.pem
pkey=/etc/letsencrypt/live/turn.seudominio.com/privkey.pem
```

## 10. Monitoramento

### Métricas importantes
- Conexões ativas: `netstat -an | grep 3478 | wc -l`
- Bandwidth: `vnstat` ou painel da VPS
- CPU/RAM: `htop`

### Alertas recomendados
- CPU > 80%
- RAM > 80%
- Bandwidth > 80% do limite

## Custos estimados

| Escala | VPS | Bandwidth | Total/mês |
|--------|-----|-----------|-----------|
| MVP (100 users) | $24 | ~500GB | ~$24 |
| Médio (1000 users) | $48 | ~2TB | ~$60 |
| Grande (10000 users) | $96+ | ~10TB+ | ~$150+ |

## Troubleshooting

### TURN não conecta
1. Verificar firewall (portas UDP!)
2. Verificar external-ip no config
3. Verificar segredo no backend

### Alta latência
1. Escolher VPS mais próxima dos usuários
2. Considerar multi-região

### Muitas conexões relay
- Normal em mobile/4G
- Se > 50% relay, considerar mais servidores
