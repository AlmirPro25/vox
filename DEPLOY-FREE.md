# 🆓 VOX-BRIDGE - Deploy 100% Grátis

## Stack Gratuita
- **Frontend**: Vercel (grátis, SSL automático)
- **Backend**: Render (grátis, SSL automático)
- **Domínio**: Subdomínio grátis incluso

---

## 📦 Passo 1: Subir código pro GitHub

1. Crie uma conta no [GitHub](https://github.com) se não tiver
2. Crie um novo repositório chamado `vox-bridge`
3. No terminal do projeto:

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/SEU-USUARIO/vox-bridge.git
git push -u origin main
```

---

## 🔧 Passo 2: Deploy do Backend (Render)

1. Acesse [render.com](https://render.com) e crie conta com GitHub
2. Clique em **New** → **Web Service**
3. Conecte seu repositório `vox-bridge`
4. Configure:
   - **Name**: `vox-bridge-api`
   - **Root Directory**: `backend`
   - **Runtime**: `Go`
   - **Build Command**: `go build -o server src/main_dev.go`
   - **Start Command**: `./server`
5. Em **Environment Variables**, adicione:
   - `PORT` = `8080`
   - `JWT_SECRET` = (clique em Generate)
6. Clique **Create Web Service**
7. Aguarde o deploy (5-10 min)
8. Copie a URL gerada (ex: `https://vox-bridge-api.onrender.com`)

---

## 🌐 Passo 3: Deploy do Frontend (Vercel)

1. Acesse [vercel.com](https://vercel.com) e crie conta com GitHub
2. Clique em **Add New** → **Project**
3. Importe o repositório `vox-bridge`
4. Configure:
   - **Framework Preset**: Next.js
   - **Root Directory**: `frontend`
5. Em **Environment Variables**, adicione:
   - `NEXT_PUBLIC_API_URL` = `https://vox-bridge-api.onrender.com` (URL do Render)
   - `NEXT_PUBLIC_WS_URL` = `wss://vox-bridge-api.onrender.com` (mesma URL com wss://)
6. Clique **Deploy**
7. Aguarde (2-3 min)
8. Sua URL: `https://vox-bridge.vercel.app` 🎉

---

## ✅ Pronto!

Seu site está no ar em:
- **Frontend**: `https://seu-projeto.vercel.app`
- **Backend**: `https://seu-projeto.onrender.com`

### URLs de exemplo:
- Site: https://vox-bridge.vercel.app
- API: https://vox-bridge-api.onrender.com/health
- WebSocket: wss://vox-bridge-api.onrender.com/v1/ws

---

## ⚠️ Limitações do Tier Gratuito

### Render (Backend)
- Dorme após 15 min sem uso (primeira requisição demora ~30s)
- 750 horas/mês (suficiente para 1 serviço 24/7)
- Sem domínio customizado no free

### Vercel (Frontend)
- 100GB bandwidth/mês
- Sem limites práticos para projetos pequenos
- Domínio customizado grátis!

---

## 🚀 Dicas para Melhorar

### Evitar que o backend durma
Crie um cron job grátis no [cron-job.org](https://cron-job.org):
- URL: `https://vox-bridge-api.onrender.com/health`
- Intervalo: A cada 14 minutos

### Domínio customizado grátis
1. Pegue um domínio grátis em [freenom.com](https://freenom.com) (.tk, .ml, .ga)
2. Configure no Vercel: Settings → Domains → Add

---

## 🔄 Atualizações Automáticas

Toda vez que você fizer `git push`, o deploy é automático:
- Vercel rebuilda o frontend
- Render rebuilda o backend

---

## 🐛 Troubleshooting

### "WebSocket connection failed"
- Verifique se usou `wss://` (não `ws://`)
- Confirme que a URL do Render está correta

### Backend demora para responder
- Normal no tier grátis (cold start)
- Primeira requisição após inatividade demora ~30s

### Erro de CORS
O backend já está configurado para aceitar qualquer origem. Se der erro:
1. Verifique a URL do backend nas variáveis do Vercel
2. Redeploy o frontend
