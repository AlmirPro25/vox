# 🌐 VOXGRID - Estratégia de Escala Global para VOX-BRIDGE

## CONTEXTO DO PROBLEMA

O VOX-BRIDGE funciona perfeitamente para conexões Brasil-Brasil, mas falha em conexões intercontinentais (ex: Brasil-Nigéria). O problema é **NAT traversal internacional** - os servidores TURN públicos gratuitos têm limitações geográficas e de capacidade.

### Diagnóstico Técnico
```
Brasil ←→ Brasil: ✅ Funciona (mesmo servidor TURN regional)
Brasil ←→ Nigéria: ❌ Falha (servidores TURN diferentes, sem ponte)
```

O WebSocket (chat) funciona porque passa pelo servidor central. O WebRTC (vídeo) falha porque precisa de TURN servers que façam relay entre continentes.

---

## SOLUÇÕES DISPONÍVEIS

### OPÇÃO 1: TURN Global Gerenciado (Recomendado para começar)

#### Metered.ca (Já usado parcialmente)
- **31+ regiões** incluindo África e América do Sul
- **Backbone privado** entre regiões (Brasil ↔ África via rede própria)
- **Preço**: $0.40/GB (primeiros 500MB grátis/mês)
- **Endpoint global**: `global.relay.metered.ca` (auto-routing)

**Implementação imediata:**
```javascript
// backend-node/server.js - Atualizar TURN credentials
const turnServers = [
  {
    urls: [
      'turn:global.relay.metered.ca:80',
      'turn:global.relay.metered.ca:443',
      'turns:global.relay.metered.ca:443?transport=tcp'
    ],
    username: 'SEU_API_KEY',
    credential: 'SEU_API_SECRET'
  }
];
```

**Custo estimado:**
- 100 usuários/dia × 5 min/chamada × 2MB/min = ~1GB/dia = ~$12/mês
- 1000 usuários/dia = ~$120/mês

#### Twilio Network Traversal
- **7 regiões** globais
- **Preço**: $0.40/GB (América do Norte), mais caro em outras regiões
- Mais enterprise, melhor suporte

#### Xirsys
- **12+ regiões** incluindo África do Sul
- **Preço**: A partir de $25/mês (plano básico)
- Bom para escala média

---

### OPÇÃO 2: Cloudflare Calls (Melhor custo-benefício futuro)

Cloudflare lançou TURN com **Anycast** - 330+ localizações globais automaticamente.

**Vantagens:**
- Anycast = usuário conecta ao PoP mais próximo automaticamente
- Sem configuração de regiões
- Integrado com Cloudflare (se já usa)

**Preço:** $0.05/minuto de vídeo (mais barato que TURN puro para alto volume)

**Quando usar:** Quando tiver >1000 usuários/dia

---

### OPÇÃO 3: LiveKit (SFU Open Source)

Para escala real, P2P puro não aguenta. Precisa de **SFU (Selective Forwarding Unit)**.

**LiveKit Cloud:**
- Rede global distribuída
- Auto-scaling
- $0.004/minuto/participante
- Suporta gravação, streaming

**LiveKit Self-Hosted:**
- Deploy em múltiplas regiões (AWS, GCP, etc)
- Custo: ~$50-100/mês por região (VPS)
- Mais controle, mais trabalho

---

### OPÇÃO 4: Agora.io (Enterprise)

Rede proprietária com **200+ regiões**, latência <40ms.

**Preço:**
- 10,000 minutos grátis/mês
- Depois: $0.99/1000 minutos (áudio), $3.99/1000 minutos (vídeo SD)
- Mínimo $500/mês para Cloud Proxy

**Quando usar:** Quando tiver investimento e precisar de SLA enterprise

---

## ESTRATÉGIA DE FEDERAÇÃO (Conectar com outras redes)

### O Problema
Você quer conectar VOX-BRIDGE com redes existentes (OmeTV, Chatroulette, etc) para ter usuários sem ter tráfego próprio.

### Realidade
**Nenhuma dessas plataformas oferece API pública de federação.**

Elas são:
- Fechadas (não querem compartilhar usuários)
- Sem API de matchmaking externo
- Protegidas contra bots/automação

### Alternativas Viáveis

#### 1. Matrix Protocol (Federação Real)
- Protocolo aberto de comunicação federada
- Usado por Element, Beeper, etc
- Suporta vídeo via Jitsi/LiveKit
- **Problema:** Poucos usuários de video chat aleatório

#### 2. Criar sua própria rede federada
```
VOX-BRIDGE (Brasil) ←→ VOX-BRIDGE (Europa) ←→ VOX-BRIDGE (África)
         ↓                    ↓                    ↓
    [Kernel PROST-QS compartilhado ou federado]
```

Você pode:
- Licenciar VOX-BRIDGE para operadores regionais
- Cada operador roda sua instância
- Matchmaking federado via API

#### 3. Parcerias B2B
Contatar diretamente:
- Emerald Chat (menor, pode estar aberto)
- Tinychat (tem API limitada)
- Startups menores de video chat

---

## ARQUITETURA VOXGRID PROPOSTA

```
┌─────────────────────────────────────────────────────────────────┐
│                         VOXGRID                                  │
│                   (Rede Global VOX-BRIDGE)                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐  │
│  │  TURN    │    │  TURN    │    │  TURN    │    │  TURN    │  │
│  │ São Paulo│←──→│ Frankfurt│←──→│ Singapore│←──→│ Cape Town│  │
│  └────┬─────┘    └────┬─────┘    └────┬─────┘    └────┬─────┘  │
│       │               │               │               │         │
│       └───────────────┴───────────────┴───────────────┘         │
│                    BACKBONE PRIVADO                              │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              SIGNALING LAYER (WebSocket)                  │   │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐     │   │
│  │  │ Render  │  │ Fly.io  │  │ Railway │  │ Vercel  │     │   │
│  │  │ (atual) │  │ (backup)│  │ (África)│  │ (Edge)  │     │   │
│  │  └─────────┘  └─────────┘  └─────────┘  └─────────┘     │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    MATCHMAKING GLOBAL                     │   │
│  │                                                           │   │
│  │  • Fila única global (Redis Cluster ou Upstash)          │   │
│  │  • Geo-aware matching (preferência por região próxima)   │   │
│  │  • Fallback cross-region após timeout                    │   │
│  │                                                           │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                      PROST-QS KERNEL                      │   │
│  │                                                           │   │
│  │  • Identity (usuários globais)                           │   │
│  │  • Telemetry (métricas por região)                       │   │
│  │  • Policy (regras de matching)                           │   │
│  │  • Billing (monetização)                                 │   │
│  │                                                           │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## PLANO DE IMPLEMENTAÇÃO

### FASE 1: Fix Imediato (1-2 dias) - $0-15/mês ✅ IMPLEMENTADO

**Alterações feitas:**

1. **Backend** (`backend-node/server.js`):
   - Endpoint `/turn-credentials` atualizado para Metered.ca global
   - TCP primeiro (melhor para firewalls africanos)
   - Suporte a API key via variáveis de ambiente
   - Fallback para TURN público em desenvolvimento

2. **Frontend** (`frontend/src/components/video/VideoStage.tsx`):
   - `getIceServers()` atualizado com ordem TCP primeiro
   - Telemetria ICE (`logIceTelemetry`) para métricas
   - Modo `FORCE_RELAY` para testes (força TURN)
   - Logs detalhados de tipo de conexão

3. **Configuração** (`.env.example`):
   - Novas variáveis: `METERED_API_KEY`, `METERED_API_SECRET`
   - Documentação de uso

4. **Documentação**:
   - `CHECKLIST-TESTE-GLOBAL.md` - guia de teste Brasil ↔ África

**Para ativar:**
```bash
# No Render (variáveis de ambiente)
METERED_API_KEY=sua_api_key
METERED_API_SECRET=seu_secret

# Para teste forçando TURN (opcional)
NEXT_PUBLIC_FORCE_RELAY=true
```

### FASE 2: Otimização (1 semana) - $20-50/mês
1. Migrar backend de Render para Fly.io (melhor para WebSocket)
2. Adicionar Redis para fila global (Upstash free tier)
3. Implementar geo-routing no matchmaking

### FASE 3: Escala (1 mês) - $100-300/mês
1. Deploy multi-região do signaling server
2. Avaliar LiveKit para SFU (se grupos/qualidade)
3. Dashboard de métricas por região

### FASE 4: Federação (3+ meses)
1. Definir protocolo de federação
2. Buscar parceiros/operadores regionais
3. Implementar matchmaking federado

---

## COMPARATIVO DE CUSTOS

| Solução | 100 users/dia | 1000 users/dia | 10000 users/dia |
|---------|---------------|----------------|-----------------|
| TURN Público (atual) | $0 | $0 | ❌ Não funciona |
| Metered.ca | ~$15/mês | ~$120/mês | ~$1000/mês |
| Cloudflare Calls | ~$50/mês | ~$300/mês | ~$2000/mês |
| LiveKit Cloud | ~$30/mês | ~$200/mês | ~$1500/mês |
| Agora.io | $0 (free tier) | ~$200/mês | ~$2000/mês |
| Self-hosted (Coturn) | ~$50/mês | ~$150/mês | ~$500/mês |

---

## RECOMENDAÇÃO FINAL

### Para resolver AGORA (Brasil ↔ Nigéria):
```
1. Criar conta Metered.ca
2. Pegar API key
3. Atualizar server.js com endpoint global
4. Testar
```

### Para escalar depois:
```
1. Migrar para Fly.io (signaling)
2. Avaliar LiveKit (se precisar SFU)
3. Implementar matchmaking geo-aware
```

### Para federação:
```
Não existe API pública das grandes plataformas.
Opções: Matrix protocol, parcerias B2B, ou criar sua própria rede.
```

---

## PRÓXIMOS PASSOS

1. **Imediato**: Implementar Metered.ca global
2. **Esta semana**: Testar conexão Brasil ↔ África
3. **Este mês**: Migrar para Fly.io
4. **Q1 2026**: Avaliar LiveKit/SFU

---

*Documento criado em 14/01/2026*
*Para uso como briefing técnico*
