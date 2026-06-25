#!/bin/bash
# ============================================================================
# VOXGRID - Coturn Installation Script
# ============================================================================
# Execute em cada VPS (Brasil, Europa, África)
# 
# Uso:
#   chmod +x install-coturn.sh
#   sudo ./install-coturn.sh
#
# Após executar, edite /etc/turnserver.conf com:
#   - external-ip=SEU_IP_PUBLICO
#   - static-auth-secret=SEU_SECRET (mesmo em todos os servidores!)
# ============================================================================

set -e

echo "🌐 VOXGRID - Instalando Coturn..."

# Verificar se é root
if [ "$EUID" -ne 0 ]; then
  echo "❌ Execute como root: sudo ./install-coturn.sh"
  exit 1
fi

# Detectar IP público
PUBLIC_IP=$(curl -s ifconfig.me || curl -s icanhazip.com || echo "DETECTAR_MANUALMENTE")
echo "📍 IP Público detectado: $PUBLIC_IP"

# Atualizar sistema
echo "📦 Atualizando sistema..."
apt update && apt upgrade -y

# Instalar Coturn
echo "📦 Instalando Coturn..."
apt install -y coturn

# Habilitar Coturn como serviço
echo "⚙️ Habilitando serviço..."
sed -i 's/#TURNSERVER_ENABLED=1/TURNSERVER_ENABLED=1/' /etc/default/coturn
systemctl enable coturn

# Gerar secret se não existir
if [ -z "$TURN_SECRET" ]; then
  TURN_SECRET=$(openssl rand -hex 32)
  echo ""
  echo "🔐 SECRET GERADO (GUARDE ISSO!):"
  echo "   $TURN_SECRET"
  echo ""
  echo "⚠️  Use o MESMO secret em TODOS os servidores!"
  echo ""
fi

# Backup config original
cp /etc/turnserver.conf /etc/turnserver.conf.backup

# Criar configuração
cat > /etc/turnserver.conf << EOF
# ============================================================================
# VOXGRID COTURN CONFIGURATION
# ============================================================================
# Gerado automaticamente em $(date)
# ============================================================================

# ===================
# REDE
# ===================
listening-port=3478
tls-listening-port=5349
alt-listening-port=3479
alt-tls-listening-port=5350

# IPs
listening-ip=0.0.0.0
external-ip=$PUBLIC_IP

# ===================
# DOMÍNIO
# ===================
realm=voxgrid.voxbridge.app
server-name=voxgrid.voxbridge.app

# ===================
# AUTENTICAÇÃO
# ===================
# HMAC-SHA1 com secret compartilhado
use-auth-secret
static-auth-secret=$TURN_SECRET

# ===================
# SEGURANÇA
# ===================
fingerprint
lt-cred-mech
no-multicast-peers
no-cli
no-tlsv1
no-tlsv1_1

# Bloquear IPs privados (segurança)
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255

# ===================
# PERFORMANCE
# ===================
total-quota=100
bps-capacity=0
stale-nonce=600
max-bps=0

# Portas de relay
min-port=49152
max-port=65535

# ===================
# LOGS
# ===================
log-file=/var/log/turnserver.log
verbose
# simple-log  # Descomente para logs mais simples

# ===================
# TLS (Descomente após instalar certificados)
# ===================
# cert=/etc/letsencrypt/live/turn.voxbridge.app/fullchain.pem
# pkey=/etc/letsencrypt/live/turn.voxbridge.app/privkey.pem
# cipher-list="ECDHE-RSA-AES256-GCM-SHA512:DHE-RSA-AES256-GCM-SHA512"
# ec-curve-name=secp384r1
# dh-file=/etc/ssl/certs/dhparam.pem

EOF

# Configurar firewall
echo "🔥 Configurando firewall..."
if command -v ufw &> /dev/null; then
  ufw allow 3478/tcp comment 'TURN TCP'
  ufw allow 3478/udp comment 'TURN UDP'
  ufw allow 3479/tcp comment 'TURN Alt TCP'
  ufw allow 3479/udp comment 'TURN Alt UDP'
  ufw allow 5349/tcp comment 'TURNS TLS'
  ufw allow 5350/tcp comment 'TURNS Alt TLS'
  ufw allow 49152:65535/udp comment 'TURN Relay Ports'
  echo "✅ UFW configurado"
else
  echo "⚠️ UFW não encontrado, configure o firewall manualmente"
fi

# Criar diretório de logs
mkdir -p /var/log
touch /var/log/turnserver.log
chown turnserver:turnserver /var/log/turnserver.log 2>/dev/null || true

# Reiniciar serviço
echo "🔄 Reiniciando Coturn..."
systemctl restart coturn

# Verificar status
sleep 2
if systemctl is-active --quiet coturn; then
  echo ""
  echo "✅ ============================================"
  echo "✅ COTURN INSTALADO COM SUCESSO!"
  echo "✅ ============================================"
  echo ""
  echo "📋 Próximos passos:"
  echo ""
  echo "1. Verifique o IP externo em /etc/turnserver.conf:"
  echo "   external-ip=$PUBLIC_IP"
  echo ""
  echo "2. Use o MESMO secret em todos os servidores:"
  echo "   static-auth-secret=$TURN_SECRET"
  echo ""
  echo "3. Para TLS (TURNS), instale certificado:"
  echo "   apt install certbot"
  echo "   certbot certonly --standalone -d turn-br.voxbridge.app"
  echo ""
  echo "4. Teste a conexão:"
  echo "   turnutils_uclient -T -u test -w test $PUBLIC_IP"
  echo ""
  echo "5. Logs:"
  echo "   tail -f /var/log/turnserver.log"
  echo ""
else
  echo "❌ Erro ao iniciar Coturn. Verifique:"
  echo "   journalctl -u coturn -n 50"
fi
