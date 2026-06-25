/**
 * TESTE DE INTEGRAÇÃO VOX-BRIDGE <-> PROST-QS
 * Simula conexões WebSocket e verifica eventos de audit
 */

require('dotenv').config({ path: '../.env' });
const WebSocket = require('ws');

const VOX_URL = `ws://localhost:${process.env.PORT || 3003}`;
const PROSTQS_URL = process.env.PROSTQS_URL || 'http://localhost:8080';

console.log('🧪 TESTE DE INTEGRAÇÃO VOX-BRIDGE <-> PROST-QS');
console.log('================================================');
console.log(`VOX-BRIDGE: ${VOX_URL}`);
console.log(`PROST-QS: ${PROSTQS_URL}`);
console.log('');

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testConnection() {
  console.log('📡 Teste 1: Conexão WebSocket...');
  
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(VOX_URL);
    let userId = null;
    
    ws.on('open', () => {
      console.log('   ✅ WebSocket conectado');
    });
    
    ws.on('message', (data) => {
      const msg = JSON.parse(data);
      if (msg.type === 'connected') {
        userId = msg.payload.userId;
        console.log(`   ✅ Recebeu connected: userId=${userId.substring(0,8)}...`);
        
        // Aguardar um pouco e fechar
        setTimeout(() => {
          ws.close();
        }, 1000);
      }
    });
    
    ws.on('close', () => {
      console.log('   ✅ WebSocket fechado');
      resolve(userId);
    });
    
    ws.on('error', (err) => {
      console.log(`   ❌ Erro: ${err.message}`);
      reject(err);
    });
  });
}

async function testQueueAndMatch() {
  console.log('\n📡 Teste 2: Fila e Match...');
  
  return new Promise((resolve, reject) => {
    const ws1 = new WebSocket(VOX_URL);
    const ws2 = new WebSocket(VOX_URL);
    let user1Id, user2Id;
    let matchReceived = 0;
    
    function handleMessage(ws, name) {
      return (data) => {
        const msg = JSON.parse(data);
        
        if (msg.type === 'connected') {
          const userId = msg.payload.userId;
          if (name === 'User1') user1Id = userId;
          else user2Id = userId;
          console.log(`   ✅ ${name} conectado: ${userId.substring(0,8)}...`);
          
          // Entrar na fila
          setTimeout(() => {
            ws.send(JSON.stringify({
              type: 'join_queue',
              payload: {
                nativeLanguage: name === 'User1' ? 'pt' : 'en',
                targetLanguage: name === 'User1' ? 'en' : 'pt',
                interests: ['test'],
                country: 'BR'
              }
            }));
            console.log(`   📤 ${name} entrou na fila`);
          }, 500);
        }
        
        if (msg.type === 'queue_joined') {
          console.log(`   ✅ ${name} na fila (posição ${msg.payload.position})`);
        }
        
        if (msg.type === 'matched') {
          matchReceived++;
          console.log(`   🎯 ${name} recebeu match! Room: ${msg.payload.roomId.substring(0,8)}...`);
          
          if (matchReceived === 2) {
            // Ambos receberam match, sair da sala
            setTimeout(() => {
              ws1.send(JSON.stringify({ type: 'leave_room' }));
              console.log('   📤 User1 saiu da sala');
            }, 1000);
          }
        }
        
        if (msg.type === 'partner_left') {
          console.log(`   ✅ ${name} recebeu partner_left`);
          setTimeout(() => {
            ws1.close();
            ws2.close();
          }, 500);
        }
      };
    }
    
    ws1.on('message', handleMessage(ws1, 'User1'));
    ws2.on('message', handleMessage(ws2, 'User2'));
    
    let closed = 0;
    const onClose = () => {
      closed++;
      if (closed === 2) {
        console.log('   ✅ Ambos desconectados');
        resolve({ user1Id, user2Id });
      }
    };
    
    ws1.on('close', onClose);
    ws2.on('close', onClose);
    
    ws1.on('error', reject);
    ws2.on('error', reject);
  });
}

async function checkAuditLogs() {
  console.log('\n📊 Teste 3: Verificar Audit Logs no PROST-QS...');
  
  try {
    // Login para obter token
    const loginRes = await fetch(`${PROSTQS_URL}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'Admin@123456' })
    });
    
    if (!loginRes.ok) {
      console.log('   ❌ Falha no login');
      return false;
    }
    
    const { token } = await loginRes.json();
    console.log('   ✅ Login OK');
    
    // Buscar audit logs
    const auditRes = await fetch(`${PROSTQS_URL}/api/v1/audit?limit=20`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (!auditRes.ok) {
      console.log('   ❌ Falha ao buscar audit logs');
      return false;
    }
    
    const auditData = await auditRes.json();
    const logs = auditData.logs || auditData.events || [];
    
    console.log(`   ✅ ${logs.length} eventos encontrados`);
    
    // Filtrar eventos do VOX-BRIDGE
    const voxEvents = logs.filter(l => 
      l.action?.includes('session') || 
      l.action?.includes('queue') || 
      l.action?.includes('match') ||
      l.type?.includes('SESSION') ||
      l.type?.includes('QUEUE') ||
      l.type?.includes('MATCH')
    );
    
    if (voxEvents.length > 0) {
      console.log(`   ✅ ${voxEvents.length} eventos do VOX-BRIDGE:`);
      voxEvents.slice(0, 5).forEach(e => {
        console.log(`      - ${e.type || e.action} (${e.actor_id?.substring(0,8) || 'N/A'}...)`);
      });
    } else {
      console.log('   ⚠️ Nenhum evento do VOX-BRIDGE encontrado ainda');
      console.log('      (eventos são enviados em batch a cada 5s)');
    }
    
    return true;
  } catch (err) {
    console.log(`   ❌ Erro: ${err.message}`);
    return false;
  }
}

async function main() {
  try {
    // Teste 1: Conexão simples
    await testConnection();
    
    // Aguardar flush de eventos
    console.log('\n⏳ Aguardando flush de eventos (5s)...');
    await sleep(6000);
    
    // Teste 2: Fila e Match
    await testQueueAndMatch();
    
    // Aguardar flush de eventos
    console.log('\n⏳ Aguardando flush de eventos (5s)...');
    await sleep(6000);
    
    // Teste 3: Verificar audit logs
    await checkAuditLogs();
    
    console.log('\n================================================');
    console.log('🏁 TESTE CONCLUÍDO');
    console.log('================================================');
    
  } catch (err) {
    console.error('\n❌ ERRO NO TESTE:', err.message);
    process.exit(1);
  }
  
  process.exit(0);
}

main();
