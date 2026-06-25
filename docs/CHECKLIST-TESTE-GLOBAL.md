# 🌍 CHECKLIST: Teste Brasil ↔ África

## PRÉ-REQUISITOS

### 1. Configurar Metered.ca
- [ ] Criar conta em https://www.metered.ca
- [ ] Obter API Key e Secret
- [ ] Configurar no Render (variáveis de ambiente):
  ```
  METERED_API_KEY=sua_api_key
  METERED_API_SECRET=seu_secret
  ```

### 2. Deploy
- [ ] Commit das alterações
- [ ] Push para GitHub
- [ ] Aguardar deploy no Render (~2-3 min)

---

## TESTE 1: Validar TURN Global (Forçar Relay)

### No Frontend (temporário para teste)
Adicionar no `.env.local`:
```
NEXT_PUBLIC_FORCE_RELAY=true
```

### Verificar no Console do Browser
Deve aparecer:
```
🔒 VOXGRID: FORCE_RELAY_MODE ativo - forçando TURN
🌐 VOXGRID: TURN servers loaded from backend
📡 VOXGRID ICE: relay (TURN) | local=relay remote=relay
```

### Resultado Esperado
- [ ] Conexão estabelecida via TURN (não P2P)
- [ ] Vídeo funcionando
- [ ] Latência aceitável (<500ms)

---

## TESTE 2: Brasil ↔ Nigéria

### Setup
1. Você no Brasil: https://vox-bridge-ivory.vercel.app
2. Amigo na Nigéria: mesmo link

### Passos
1. [ ] Ambos acessam o site
2. [ ] Ambos clicam "Iniciar"
3. [ ] Aguardar match (pode demorar se poucos usuários)
4. [ ] Verificar console do browser

### Console - O que procurar
```
📡 VOXGRID ICE: relay (TURN) | local=relay remote=relay
```

Se aparecer `relay` = TURN funcionando ✅
Se aparecer `failed` = problema de TURN ❌

### Métricas a Coletar
- [ ] Tipo de conexão (relay/srflx/host)
- [ ] Latência aproximada (visual)
- [ ] Qualidade de vídeo (boa/média/ruim)
- [ ] Tempo para conectar

---

## TESTE 3: Diferentes Redes

### Cenários a Testar
- [ ] Wi-Fi ↔ Wi-Fi
- [ ] Wi-Fi ↔ 4G
- [ ] 4G ↔ 4G
- [ ] Rede corporativa (firewall)

### Resultado Esperado
Todos devem funcionar via TURN (relay).

---

## TROUBLESHOOTING

### "ICE failed" ou "Connection failed"
1. Verificar se METERED_API_KEY está configurado no Render
2. Verificar logs do backend: `🌐 VOXGRID: Metered.ca global TURN`
3. Se aparecer `⚠️ VOXGRID: Usando TURN público` = credenciais não configuradas

### "Conecta mas cai depois de 30s"
- TURN público tem limite de tempo
- Solução: configurar Metered.ca com API key

### "Vídeo trava/pixelado"
- Normal para conexões intercontinentais via TURN
- Latência Brasil ↔ África ~200-400ms
- Considerar reduzir qualidade de vídeo

### "Funciona no Brasil mas não na África"
- ISPs africanos frequentemente bloqueiam UDP
- Verificar se está usando TCP (turns:...?transport=tcp)
- Metered.ca global deve resolver automaticamente

---

## MÉTRICAS PARA REPORTAR

Após os testes, anotar:

| Métrica | Brasil-Brasil | Brasil-Nigéria |
|---------|---------------|----------------|
| Tipo conexão | | |
| Tempo para conectar | | |
| Qualidade vídeo | | |
| Latência percebida | | |
| Quedas em 5 min | | |

---

## PRÓXIMOS PASSOS

### Se funcionar ✅
1. Remover `NEXT_PUBLIC_FORCE_RELAY=true`
2. Testar conexão normal (P2P quando possível)
3. Monitorar custos no Metered.ca

### Se não funcionar ❌
1. Coletar logs do console
2. Verificar região do TURN (deve ser global)
3. Testar com Cloudflare Calls como alternativa

---

*Checklist criado em 14/01/2026*
