# WebRTC Debug Mode - Connection Type Indicator

## Visão Geral

O VOX-BRIDGE agora inclui um **modo debug visual** que mostra o tipo de conexão WebRTC em tempo real durante chamadas de vídeo.

## 🎯 Funcionalidades

### 1. **Painel de Debug Visual**

Quando uma conexão WebRTC é estabelecida, um painel aparece no canto inferior direito mostrando:

- **Tipo de Conexão** (host, srflx ou relay)
- **Candidatos ICE** (local e remote)
- **Protocolo** (UDP, TCP)
- **Status visual** com emojis e cores

### 2. **Logs Detalhados no Console**

Logs automáticos no console do navegador (F12):

```
🏠 VOXGRID ICE: host (P2P direto) | local=host remote=host protocol=udp
🌐 VOXGRID ICE: srflx (STUN) | local=srflx remote=srflx protocol=udp
🔄 VOXGRID ICE: relay (TURN) | local=relay remote=host protocol=tcp
```

## 📊 Tipos de Conexão

### 🏠 Direct P2P (host)
- **Descrição**: Conexão direta entre os peers
- **Quando**: Ambos usuários na mesma rede local (LAN)
- **Performance**: Excelente - latência mínima
- **Custo**: Nenhum
- **Cor**: Verde

### 🌐 STUN P2P (srflx)
- **Descrição**: P2P via STUN (Server Reflexive)
- **Quando**: Usuários em redes diferentes, NAT não-restritivo
- **Performance**: Boa - latência baixa
- **Custo**: Nenhum (STUN é gratuito)
- **Cor**: Azul

### 🔄 TURN Relay (relay)
- **Descrição**: Tráfego retransmitido via servidor TURN
- **Quando**: NAT restritivo, firewall corporativo, P2P bloqueado
- **Performance**: Aceitável - depende do servidor TURN
- **Custo**: Sim (uso de banda no servidor TURN)
- **Cor**: Laranja

## 🎨 Interface do Painel

```
┌─────────────────────────────────┐
│ 🏠 Direct P2P                   │
│ Conexão direta (ideal)          │
│                                  │
│ Local:  host (udp)              │
│ Remote: host                    │
│ Protocol: UDP                   │
│                                  │
│ ✅ Conexão otimizada (sem custos)│
└─────────────────────────────────┘
```

Ou quando usando TURN:

```
┌─────────────────────────────────┐
│ 🔄 TURN Relay                   │
│ Via servidor TURN               │
│                                  │
│ Local:  relay (tcp)             │
│ Remote: srflx                   │
│ Protocol: TCP                   │
│                                  │
│ ⚠️ Usando TURN (pode ter custos) │
└─────────────────────────────────┘
```

## 🔧 Implementação Técnica

### Arquivos Modificados

1. **`frontend/src/components/video/VideoStage.tsx`**
   - Adicionada função `logIceTelemetry()` com callback
   - Estado `connectionInfo` para armazenar dados de debug
   - Integração com componente `WebRTCDebugPanel`

2. **`frontend/src/components/ui/WebRTCDebugPanel.tsx`** (novo)
   - Componente React para exibir informações de debug
   - Suporta 3 tipos de conexão (host, srflx, relay)
   - Design responsivo e não-intrusivo

### Como Funciona

1. **Detecção Automática**: 2 segundos após estabelecer a conexão WebRTC
2. **Análise de Stats**: Usa `RTCPeerConnection.getStats()` para obter ICE candidates
3. **Classificação**: Determina o tipo baseado nos candidatos ativos
4. **Exibição**: Atualiza o painel visual e registra no console

### Código de Exemplo

```typescript
// Função de telemetria ICE
const logIceTelemetry = (
  pc: RTCPeerConnection, 
  setConnectionInfo?: (info: ConnectionInfo) => void
) => {
  pc.getStats().then(stats => {
    // Analisa os candidatos ICE ativos
    // Determina se é host, srflx ou relay
    // Atualiza o painel de debug
  })
}

// Chamada após track recebido
pc.ontrack = ({ track, streams }) => {
  setTimeout(() => logIceTelemetry(pc, setConnectionInfo), 2000)
}
```

## 📝 Logs no Console

### Exemplo de Sessão Completa

```console
🔧 Creating RTCPeerConnection with ICE servers: [...]
🏠 ICE candidate: host (udp)
🌐 ICE candidate: srflx (udp)
🔄 ICE candidate: relay (tcp)
✅ ICE gathering complete

📺 Remote track received: video
📺 Remote track received: audio
🔌 WebRTC state: connecting
🧊 ICE: checking
🧊 ICE: connected
🔌 WebRTC state: connected
✅ WebRTC connected successfully!

🏠 VOXGRID ICE: host (P2P direto) | local=host remote=host protocol=udp
```

## 🎮 Como Usar

### Para Desenvolvedores

1. **Iniciar o sistema**:
   ```bash
   cd frontend
   npm run dev
   ```

2. **Abrir Console do Navegador**: Pressione F12

3. **Iniciar uma Chamada**: Clique em "Iniciar" e conecte com outra pessoa

4. **Observar**:
   - Painel de debug aparece no canto inferior direito
   - Logs aparecem no console
   - Tipo de conexão é identificado automaticamente

### Para QA/Testes

**Testar P2P Direto (host)**:
- Usar dois navegadores na mesma máquina
- Ou dois dispositivos na mesma rede WiFi

**Testar STUN P2P (srflx)**:
- Usar dispositivos em redes diferentes
- Ex: Desktop em WiFi + Mobile em 4G

**Forçar TURN (relay)**:
- Adicionar ao `.env.local`:
  ```bash
  NEXT_PUBLIC_FORCE_RELAY=true
  ```
- Simular firewall corporativo
- Testar em redes muito restritivas

## 🐛 Debugging

### Problema: Painel não aparece

**Verificar**:
1. Conexão WebRTC está estabelecida?
   - `remoteConnected` deve ser `true`
2. Console mostra "WebRTC connected"?
3. Stats estão sendo coletados?

**Solução**: Checar logs no console

### Problema: Tipo sempre "unknown"

**Causa**: Stats não estão disponíveis ou conexão não finalizou

**Solução**:
- Aguardar 2-3 segundos após conexão
- Verificar se `getStats()` está funcionando
- Checar compatibilidade do navegador

### Problema: TURN não está sendo usado

**Configuração**:
1. Verificar se TURN está configurado no `.env.local`
2. Testar forçando relay: `NEXT_PUBLIC_FORCE_RELAY=true`
3. Verificar credenciais TURN no console

## 📈 Métricas e Análise

### O Que Monitorar

- **Taxa de host**: % de conexões P2P diretas (ideal: >30%)
- **Taxa de srflx**: % via STUN (ideal: 50-60%)
- **Taxa de relay**: % via TURN (objetivo: <20%)

### Otimização

**Se muitos relay**:
- Verificar qualidade do TURN server
- Considerar múltiplos servidores TURN em regiões diferentes
- Analisar tipos de NAT dos usuários

**Se muitos failed**:
- Adicionar servidor TURN
- Verificar configuração de ICE servers
- Testar com TCP fallback

## 🚀 Próximos Passos

### Melhorias Futuras

1. **Telemetria Backend**: Enviar métricas para analytics
2. **Dashboard**: Visualização agregada de tipos de conexão
3. **Alertas**: Notificar quando TURN é muito usado (custos)
4. **Geo-routing**: TURN servers baseados em geolocalização
5. **A/B Testing**: Comparar diferentes configurações ICE

## 📚 Referências

- [WebRTC Stats API](https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/getStats)
- [ICE Candidate Types](https://developer.mozilla.org/en-US/docs/Web/API/RTCIceCandidate/type)
- [Understanding NAT Traversal](https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/)

---

**Data**: 2026-06-18  
**Versão**: 1.0.0  
**Autor**: VOX-BRIDGE Team
