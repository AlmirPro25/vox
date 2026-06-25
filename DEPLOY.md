# 🚀 VOX-BRIDGE Deploy Guide

## Opção 1: VPS com Docker (Recomendado)

### Requisitos
- VPS com 2GB RAM mínimo (DigitalOcean, Vultr, Hetzner)
- Ubuntu 22.04 ou Debian 12
- Domínio apontando para o IP do servidor

### Passo a Passo

#### 1. Configurar servidor
```bash
# Conectar via SSH
ssh root@seu-servidor-ip

# Instalar Docker
curl -fsSL https://get.docker.com | sh
apt install docker-compose-plugin -y

# Clonar projeto
git clone https://github.com/seu-usuario/vox-bridge.git
cd vox-bridge
```

#### 2. Configurar domínio
Aponte seu domínio para o IP do servidor:
- Tipo A: `@` → `seu-ip`
- Tipo A: `www` → `seu-ip`

#### 3. Gerar certificado SSL
```bash
chmod +x scripts/init-ssl.sh
./scripts/init-ssl.sh seu-dominio.com seu-email@exemplo.com
```

#### 4. Configurar variáveis de ambiente
```bash
cp .env.production .env
nano .env  # Edite com suas credenciais
```

#### 5. Iniciar aplicação
```bash
docker compose -f docker-compose.prod.yml up -d
```

#### 6. Verificar
```bash
# Ver logs
docker compose -f docker-compose.prod.yml logs -f

# Testar
curl https://seu-dominio.com/health
```

---

## Opção 2: Deploy Separado (Vercel + Railway)

### Frontend (Vercel)
1. Conecte seu repositório no [Vercel](https://vercel.com)
2. Configure as variáveis de ambiente:
   - `NEXT_PUBLIC_API_URL=https://api.seu-dominio.com`
   - `NEXT_PUBLIC_WS_URL=wss://api.seu-dominio.com`
3. Deploy automático a cada push

### Backend (Railway)
1. Crie projeto no [Railway](https://railway.app)
2. Adicione PostgreSQL e Redis do marketplace
3. Configure variáveis de ambiente
4. Deploy do Dockerfile

---

## Opção 3: Fly.io (Simples e Barato)

### Backend
```bash
# Instalar flyctl
curl -L https://fly.io/install.sh | sh

# Login
fly auth login

# Criar app
cd backend
fly launch --name vox-bridge-api

# Configurar secrets
fly secrets set JWT_SECRET=seu-secret DATABASE_URL=sua-url

# Deploy
fly deploy
```

### Frontend
```bash
cd frontend
fly launch --name vox-bridge-web
fly deploy
```

---

## Renovação Automática de SSL

O certificado Let's Encrypt expira em 90 dias. O container certbot renova automaticamente, mas você pode forçar:

```bash
docker compose -f docker-compose.prod.yml exec certbot certbot renew
docker compose -f docker-compose.prod.yml exec nginx nginx -s reload
```

---

## Monitoramento

### Health Check
```bash
curl https://seu-dominio.com/health
```

### Logs
```bash
# Todos os serviços
docker compose -f docker-compose.prod.yml logs -f

# Apenas backend
docker compose -f docker-compose.prod.yml logs -f backend
```

### Métricas
O endpoint `/health` retorna:
```json
{
  "status": "online",
  "queue": 5,
  "rooms": 2,
  "connected": 10
}
```

---

## Troubleshooting

### WebSocket não conecta
- Verifique se está usando `wss://` (não `ws://`)
- Confirme que nginx está passando headers de upgrade
- Teste: `wscat -c wss://seu-dominio.com/v1/ws?token=test`

### Certificado inválido
```bash
# Renovar manualmente
docker compose -f docker-compose.prod.yml run --rm certbot certonly --webroot -w /var/www/certbot -d seu-dominio.com
docker compose -f docker-compose.prod.yml restart nginx
```

### Erro 502 Bad Gateway
```bash
# Verificar se backend está rodando
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs backend
```
