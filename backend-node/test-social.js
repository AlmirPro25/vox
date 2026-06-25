// Quick integration test for the social layer over WebSocket.
// Run with the server already listening on PORT (default 8080).
//   node test-social.js
const WebSocket = require('ws');

const PORT = process.env.PORT || 8080;
const BASE = `ws://localhost:${PORT}`;

function client(name) {
  return new Promise((resolve) => {
    const state = { name, token: null, accountId: null, events: [], ws: null };
    const ws = new WebSocket(BASE);
    state.ws = ws;
    ws.on('message', (data) => {
      const msg = JSON.parse(data);
      state.events.push(msg);
      if (msg.type === 'connected') {
        state.token = msg.payload.token;
        state.accountId = msg.payload.accountId;
        resolve(state);
      }
    });
  });
}

function send(state, type, payload) {
  state.ws.send(JSON.stringify({ type, payload }));
}

function waitFor(state, type, timeout = 2000) {
  return new Promise((resolve, reject) => {
    const found = state.events.find((e) => e.type === type);
    if (found) return resolve(found);
    const onMsg = (data) => {
      const msg = JSON.parse(data);
      if (msg.type === type) {
        state.ws.off('message', onMsg);
        resolve(msg);
      }
    };
    state.ws.on('message', onMsg);
    setTimeout(() => { state.ws.off('message', onMsg); reject(new Error(`timeout waiting ${type} for ${state.name}`)); }, timeout);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let pass = 0, fail = 0;
  const ok = (cond, label) => { if (cond) { pass++; console.log(`  ✅ ${label}`); } else { fail++; console.log(`  ❌ ${label}`); } };

  console.log('1) Two clients connect and get persistent identities');
  const alice = await client('alice');
  const bob = await client('bob');
  ok(!!alice.token && alice.token.length === 64, 'alice got a 64-char token');
  ok(!!bob.accountId && bob.accountId !== alice.accountId, 'bob has a distinct accountId');

  console.log('2) Alice sends Bob a friend request');
  send(alice, 'friend_request', { toUserId: bob.accountId });
  const received = await waitFor(bob, 'friend_request_received');
  ok(received.payload.request.id === alice.accountId, 'bob received request from alice');
  ok(!!received.payload.request.requestId, 'request carries a requestId');

  console.log('3) Bob accepts');
  send(bob, 'friend_request_respond', { requestId: received.payload.request.requestId, accept: true });
  const aliceAccepted = await waitFor(alice, 'friend_request_accepted');
  ok(aliceAccepted.payload.friend.id === bob.accountId, 'alice notified that bob accepted');
  await sleep(200);
  const bobList = bob.events.filter((e) => e.type === 'friends_list').pop();
  ok(bobList && bobList.payload.friends.some((f) => f.id === alice.accountId && f.online), 'bob friends list shows alice online');

  console.log('4) Reconnect persistence: alice reconnects with her token');
  alice.ws.close();
  await sleep(300);
  const alice2 = await new Promise((resolve) => {
    const s = { name: 'alice2', events: [], ws: null };
    const ws = new WebSocket(`${BASE}?token=${alice.token}`);
    s.ws = ws;
    ws.on('message', (data) => {
      const msg = JSON.parse(data);
      s.events.push(msg);
      if (msg.type === 'connected') { s.accountId = msg.payload.accountId; resolve(s); }
    });
  });
  ok(alice2.accountId === alice.accountId, 'alice kept the same accountId after reconnect (token works)');
  const aliceFriends = await waitFor(alice2, 'friends_list');
  ok(aliceFriends.payload.friends.some((f) => f.id === bob.accountId), 'alice still friends with bob after reconnect');

  console.log('5) Discovery shows a third online stranger, not friends');
  const carol = await client('carol');
  send(alice2, 'get_discovery', {});
  const disc = await waitFor(alice2, 'discovery_list');
  ok(disc.payload.users.some((u) => u.id === carol.accountId), 'discovery includes carol (online stranger)');
  ok(!disc.payload.users.some((u) => u.id === bob.accountId), 'discovery excludes bob (already friend)');

  console.log('6) Block: alice blocks carol -> carol disappears from discovery');
  send(alice2, 'block_user', { targetUserId: carol.accountId });
  await waitFor(alice2, 'block_ack');
  send(alice2, 'get_discovery', {});
  await sleep(200);
  const disc2 = alice2.events.filter((e) => e.type === 'discovery_list').pop();
  ok(disc2 && !disc2.payload.users.some((u) => u.id === carol.accountId), 'carol removed from discovery after block');

  console.log('7) Report is accepted');
  send(alice2, 'report_user', { reportedUserId: carol.accountId, reason: 'spam', details: 'test' });
  const ack = await waitFor(alice2, 'report_ack');
  ok(ack.payload.ok === true, 'report acknowledged');

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  [alice2, bob, carol].forEach((c) => c.ws.close());
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('TEST ERROR:', e.message); process.exit(1); });
