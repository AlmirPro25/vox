# INTEGRAÇÃO VOX-BRIDGE ↔ PROST-QS

## STATUS: ✅ IMPLEMENTADO (Passo 0-2)

---

## DIAGNÓSTICO DO APP

### O que o VOX-BRIDGE já tem:
| Feature | Status | Tecnologia |
|---------|--------|------------|
| WebRTC P2P | ✅ Production | Perfect Negotiation |
| Chat tempo real | ✅ OK | WebSocket |
| Matchmaking | ✅ OK | Por idioma + fallback |
| Tradução IA | ✅ OK | Gemini AI |
| Rate limiting | ✅ OK | Por ação |
| Heartbeat | ✅ OK | 30s ping/pong |
| Garbage collection | ✅ OK | Rooms, queue, peers |

### URLs de Produção:
- Frontend: https://vox-bridge-ivory.vercel.app
- Backend: https://vox-bridge-api.onrender.com

### Stack:
- Frontend: Next.js 14 + TypeScript + Tailwind
- Backend: Node.js + Express + WebSocket
- Infra: Vercel (frontend) + Render (backend)

---

## O QUE O PROST-QS VAI ADICIONAR

O PROST-QS **não substitui** o backend do VOX-BRIDGE.  
Ele adiciona uma **camada de governança horizontal**.

```
┌─────────────────────────────────────────────────────────────┐
│                      VOX-BRIDGE                              │
│  WebRTC │ Chat │ Matchmaking │ Tradução                     │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼ (eventos)
┌─────────────────────────────────────────────────────────────┐
│                      PROST-QS                                │
│  Identity │ Policy │ Audit │ Risk │ Kill Switch             │
└─────────────────────────────────────────────────────────────┘
```

---

## INTEGRAÇÃO MÍNIMA (FASE 1)

### 1. Identity Anônima
Sem login público. Identidade interna rastreável.

```javascript
// No backend-node/server.js, ao conectar:
const sessionData = {
  session_id: uuidv4(),
  fingerprint: hashFingerprint(req),
  ip_country: geoip.lookup(ip)?.country || 'XX',
  user_agent: req.headers['user-agent'],
  connected_at: Date.now()
};

// Registrar no PROST-QS
await fetch('http://localhost:8080/api/v1/audit', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${PROSTQS_TOKEN}` },
  body: JSON.stringify({
    type: 'SESSION_STARTED',
    actor_id: sessionData.session_id,
    actor_type: 'anonymous_user',
    target_id: sessionData.session_id,
    target_type: 'session',
    action: 'connect',
    metadata: JSON.stringify(sessionData)
  })
});
```

### 2. Audit de Eventos Críticos
Tudo que importa vira evento auditável:

| Evento | Quando | Dados |
|--------|--------|-------|
| `SESSION_STARTED` | Conexão WebSocket | IP, country, fingerprint |
| `QUEUE_JOINED` | Entrou na fila | Idiomas, interesses |
| `MATCH_CREATED` | Match feito | Ambos session_ids |
| `MATCH_ENDED` | Saiu da sala | Duração, quem saiu |
| `SKIP_FAST` | Skip < 10s | Possível comportamento suspeito |
| `ICE_FAILURE` | Falha WebRTC | Tipo de erro |
| `TRANSLATION_USED` | Usou tradução | Idiomas, chars |

### 3. Policy Engine (Decisões)
O PROST-QS decide, o VOX-BRIDGE executa:

```javascript
// Antes de criar match:
const canMatch = await fetch('http://localhost:8080/api/v1/policies/evaluate', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${PROSTQS_TOKEN}` },
  body: JSON.stringify({
    action: 'create_match',
    actor_id: user.sessionId,
    context: {
      skip_count_last_hour: user.skipCount,
      country: user.country,
      risk_score: user.riskScore
    }
  })
});

if (!canMatch.allowed) {
  safeSend(user.ws, 'match_blocked', { reason: canMatch.reason });
  return;
}
```

### 4. Risk Score por Sessão
Calcular risco baseado em comportamento:

| Fator | Peso | Descrição |
|-------|------|-----------|
| Skip rápido (< 10s) | +15 | Comportamento de spam |
| Muitos skips/hora | +20 | Abuso do sistema |
| ICE failures | +10 | Possível VPN/proxy |
| Horário incomum | +5 | Fora do padrão |
| País de alto risco | +10 | Configurável |

### 5. Kill Switch
Parar tudo se necessário:

```javascript
// Verificar kill switch antes de aceitar conexão
const killSwitch = await fetch('http://localhost:8080/api/v1/killswitch/active');
const active = await killSwitch.json();

if (active.some(ks => ks.scope === 'global' || ks.scope === 'vox-bridge')) {
  ws.close(1013, 'Service temporarily unavailable');
  return;
}
```

---

## ARQUIVOS A MODIFICAR

### Backend Node.js
```
backend-node/
├── server.js           ← Adicionar integração PROST-QS
├── prostqs-client.js   ← NOVO: Cliente para PROST-QS API
└── .env                ← Adicionar PROSTQS_URL, PROSTQS_TOKEN
```

### Não modificar:
- Frontend (não precisa saber do PROST-QS)
- WebRTC logic
- Matchmaking algorithm
- Chat/tradução

---

## VARIÁVEIS DE AMBIENTE

```env
# VOX-BRIDGE backend-node/.env
# IMPORTANTE: Nunca commitar secrets no git!
# Obtenha as credenciais via Admin Panel do PROST-QS

PROSTQS_URL=http://localhost:8080
PROSTQS_APP_ID=4fb16e2f-f8f0-425d-84f0-2ef3176bba43
PROSTQS_APP_KEY=<obter_via_admin_panel>
PROSTQS_APP_SECRET=<obter_via_admin_panel>
```

> ⚠️ **SEGURANÇA**: As credenciais devem ser obtidas via Admin Panel do PROST-QS e configuradas apenas em variáveis de ambiente. NUNCA commitar secrets no repositório.

## APP REGISTRADO NO PROST-QS

| Campo | Valor |
|-------|-------|
| App ID | `4fb16e2f-f8f0-425d-84f0-2ef3176bba43` |
| Slug | `vox-bridge` |
| Status | `active` |
| Owner | `admin (super_admin)` |

---

## FLUXO DE INTEGRAÇÃO

```
1. Registrar VOX-BRIDGE como Application no PROST-QS
   POST /api/v1/applications
   
2. Gerar credenciais (app_id + app_secret)
   
3. Criar políticas específicas para VOX-BRIDGE
   - max_skips_per_hour: 20
   - min_match_duration: 10s
   - block_on_risk_score: 80
   
4. Modificar server.js para:
   - Enviar eventos de audit
   - Consultar policies antes de match
   - Verificar kill switch
   
5. Testar localmente
   
6. Deploy
```

---

## O QUE NÃO FAZER

❌ Não adicionar login/cadastro no VOX-BRIDGE  
❌ Não criar perfis de usuário  
❌ Não adicionar features sociais (feed, seguidores)  
❌ Não modificar o PROST-QS  
❌ Não expor PROST-QS para o frontend  

---

## MÉTRICAS ESPERADAS

Após integração, o PROST-QS vai mostrar:
- Total de sessões por dia
- Taxa de match vs skip
- Duração média de matches
- Distribuição geográfica
- Sessões de alto risco bloqueadas
- Uso de tradução

---

## PRÓXIMO PASSO

Quando autorizar, vou:
1. Criar o `prostqs-client.js` no backend-node
2. Modificar `server.js` para integrar
3. Registrar VOX-BRIDGE como Application no PROST-QS
4. Criar políticas específicas
5. Testar a integração

---

*Documento criado em 29/12/2024*
