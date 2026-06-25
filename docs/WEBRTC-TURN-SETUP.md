# WebRTC STUN/TURN Configuration

## Visão Geral

O VOX-BRIDGE usa WebRTC para conexões P2P (peer-to-peer) de áudio/vídeo. Por padrão, o sistema tenta conexão direta entre os usuários usando servidores STUN públicos do Google.

## Quando Usar TURN?

**TURN (Traversal Using Relays around NAT)** é necessário quando a conexão P2P direta falha devido a:

- **NAT Restritivo**: Roteadores/firewalls corporativos que bloqueiam UDP
- **Symmetric NAT**: Ambos usuários atrás de NAT simétrico
- **Firewalls Corporativos**: Empresas que bloqueiam tráfego P2P
- **Cenários Intercontinentais**: Conexões de longa distância com múltiplos hops

## Configuração

### 1. Modo Padrão (Sem Configuração)

Por padrão, o sistema usa apenas STUN do Google:
```
stun:stun.l.google.com:19302
stun:stun1.l.google.com:19302
```

Funciona para **~80-85%** dos casos (usuários residenciais).

### 2. Adicionar TURN Server

Edite o arquivo `frontend/.env.local`:

```bash
# TURN Server Configuration
NEXT_PUBLIC_TURN_URL=turn:turn.example.com:3478
NEXT_PUBLIC_TURN_USERNAME=seu_username
NEXT_PUBLIC_TURN_CREDENTIAL=sua_credencial
```

### 3. STUN Customizado (Opcional)

Se quiser usar um servidor STUN diferente:

```bash
# Substituir Google STUN por outro
NEXT_PUBLIC_STUN_URL=stun:stun.example.com:3478
```

## Provedores TURN Recomendados

### 1. Metered.ca (Recomendado)
- **Gratuito**: 50GB/mês
- **Global**: Servidores em múltiplos continentes
- **Fácil Setup**: API simples
- **Link**: https://www.metered.ca

```bash
NEXT_PUBLIC_TURN_URL=turn:a.relay.metered.ca:80
NEXT_PUBLIC_TURN_USERNAME=<seu_username>
NEXT_PUBLIC_TURN_CREDENTIAL=<sua_credential>
```

### 2. Twilio STUN/TURN
- **Pago**: Integrado com Twilio
- **Global**: Infraestrutura confiável
- **Link**: https://www.twilio.com/docs/stun-turn

### 3. Xirsys
- **Freemium**: Plano gratuito disponível
- **Global**: Rede CDN
- **Link**: https://xirsys.com

### 4. Self-Hosted (Coturn)
- **Grátis**: Open source
- **Controle Total**: Sua infraestrutura
- **Complexidade**: Requer manutenção
- **Guia**: Ver `docs/COTURN-SETUP.md`

## Como Testar

### Verificar Configuração Atual

No console do navegador (F12), ao iniciar uma chamada:

```javascript
// Sem TURN configurado:
// ICE Servers: [{ urls: 'stun:stun.l.google.com:19302' }, ...]

// Com TURN configurado:
// ICE Servers: [
//   { urls: 'stun:stun.l.google.com:19302' },
//   { urls: 'turn:...', username: '...', credential: '...' }
// ]
```

### Forçar Uso de TURN

Para testar se TURN está funcionando, você pode:

1. **Chrome DevTools** → Network conditions → Throttling → Offline
2. Usar extensão para simular NAT restritivo
3. Testar entre redes diferentes (4G vs WiFi)

### Métricas de Sucesso

No console, procure por:
```
WebRTC state: connected    // ✅ Sucesso (P2P ou TURN)
WebRTC state: failed       // ❌ Falha na conexão
```

## Fluxo de Fallback

O WebRTC tenta automaticamente na seguinte ordem:

1. **Host Candidate**: IP local (LAN)
2. **Server Reflexive (srflx)**: STUN - IP público via NAT
3. **Relay (relay)**: TURN - Retransmissão via servidor

**Sem TURN**: Para no passo 2 (falha em ~15-20% dos casos)  
**Com TURN**: Tenta até passo 3 (sucesso em ~99% dos casos)

## Custos Estimados

### Metered.ca
- Gratuito: 50GB/mês (~100 horas de chamadas)
- Pago: $0.40/GB (~$8 por 1000 minutos)

### Twilio
- $0.40/GB (~$8 por 1000 minutos)

### Self-Hosted (Coturn)
- VPS: $5-10/mês (AWS/DigitalOcean)
- Tráfego: Variável por provedor

## Exemplo Completo

`frontend/.env.local`:
```bash
# WebSocket
NEXT_PUBLIC_WS_URL=ws://localhost:8080

# WebRTC - STUN/TURN
NEXT_PUBLIC_STUN_URL=stun:stun.l.google.com:19302
NEXT_PUBLIC_TURN_URL=turn:a.relay.metered.ca:80
NEXT_PUBLIC_TURN_USERNAME=abc123def456
NEXT_PUBLIC_TURN_CREDENTIAL=xyz789abc123
```

## Troubleshooting

### Problema: "WebRTC state: failed"

**Causa**: Não há TURN configurado e P2P falhou  
**Solução**: Configure um servidor TURN

### Problema: "Connection timeout"

**Causa**: TURN server inválido ou credenciais erradas  
**Solução**: Verifique URL, username e credential

### Problema: "ICE gathering timeout"

**Causa**: Firewall bloqueando portas UDP  
**Solução**: Use TURN com TCP fallback (porta 80/443)

## Referências

- [WebRTC Documentation](https://webrtc.org/)
- [ICE, STUN, TURN Explained](https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/)
- [Metered.ca Docs](https://www.metered.ca/docs/turn-server/)

---

**Última atualização**: 2026-06-18  
**Versão**: 1.0.0
