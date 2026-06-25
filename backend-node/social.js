// ============================================================================
// VOX-BRIDGE - Social Layer
// ============================================================================
// Real friends / friend-requests / discovery / presence / moderation.
// Persistence via db.js (SQLite). Presence is runtime state (who has a live WS).
//
// PRESENCE MODEL:
//   A persistent account (users table) may have multiple live connections
//   (e.g. phone + desktop). We track presence by accountId -> Set<connection>.
//   "online" = at least one live connection.
// ============================================================================

const db = require('./db');

// accountId -> Set of connection objects (the in-memory `user` objects from server.js)
const presence = new Map();

function isOnline(accountId) {
  const set = presence.get(accountId);
  return !!(set && set.size > 0);
}

function registerPresence(conn) {
  if (!conn.accountId) return;
  let set = presence.get(conn.accountId);
  if (!set) {
    set = new Set();
    presence.set(conn.accountId, set);
  }
  set.add(conn);
}

function unregisterPresence(conn) {
  if (!conn.accountId) return;
  const set = presence.get(conn.accountId);
  if (!set) return;
  set.delete(conn);
  if (set.size === 0) presence.delete(conn.accountId);
}

function onlineAccountCount() {
  return presence.size;
}

// Send a message to ALL live connections of an account. Returns true if delivered.
function sendToAccount(accountId, type, payload, safeSend) {
  const set = presence.get(accountId);
  if (!set || set.size === 0) return false;
  let delivered = false;
  for (const conn of set) {
    if (safeSend(conn.ws, type, payload)) delivered = true;
  }
  return delivered;
}

// Build the friends list payload (with live online status) for an account.
function buildFriendsPayload(accountId) {
  const friends = db.getFriends(accountId).map((f) => ({
    ...f,
    online: isOnline(f.id),
  }));
  const requests = db.getIncomingRequests(accountId);
  return { friends, requests };
}

// Discovery: real online accounts that are NOT self, NOT already friends,
// NOT blocked (either direction), and NOT currently mid-call. Newest first.
function buildDiscovery(accountId, { currentRoomFilter } = {}) {
  const blocked = new Set(db.getBlockedIds(accountId));
  const out = [];
  const seen = new Set();

  for (const [otherId, set] of presence.entries()) {
    if (otherId === accountId) continue;
    if (seen.has(otherId)) continue;
    if (blocked.has(otherId)) continue;
    if (db.areFriends(accountId, otherId)) continue;

    // Pick a representative live connection
    const conn = set.values().next().value;
    if (!conn) continue;

    // Optionally hide users already in a call
    if (currentRoomFilter && conn.roomId) continue;

    const row = db.getUserById(otherId);
    if (!row) continue;

    seen.add(otherId);
    out.push({
      ...db.publicUser(row),
      online: true,
      inCall: !!conn.roomId,
    });
  }

  // Most recently active first (representative connection connectedAt)
  return out.slice(0, 50);
}

// ============================================================================
// ACTIONS (return a result object; server.js handles the WS responses/notifs)
// ============================================================================

function sendFriendRequest(fromConn, toAccountId) {
  const fromId = fromConn.accountId;
  if (!fromId || !toAccountId) return { ok: false, error: 'invalid' };
  if (fromId === toAccountId) return { ok: false, error: 'self' };
  if (!db.getUserById(toAccountId)) return { ok: false, error: 'not_found' };
  if (db.isBlockedEither(fromId, toAccountId)) return { ok: false, error: 'blocked' };

  // Already friends?
  if (db.areFriends(fromId, toAccountId)) return { ok: true, alreadyFriends: true };

  // If the other side already sent ME a pending request, accept it (mutual) instead.
  const incoming = db.getIncomingRequests(fromId).find((r) => r.id === toAccountId);
  if (incoming) {
    db.addFriendship(fromId, toAccountId);
    db.setRequestStatus(incoming.requestId, 'accepted');
    return { ok: true, becameFriends: true, friendId: toAccountId };
  }

  const request = db.createFriendRequest(fromId, toAccountId);
  return { ok: true, request, toAccountId };
}

function respondFriendRequest(conn, requestId, accept) {
  const meId = conn.accountId;
  const request = db.getRequestById(requestId);
  if (!request) return { ok: false, error: 'not_found' };
  if (request.to_id !== meId) return { ok: false, error: 'forbidden' };
  if (request.status !== 'pending') return { ok: false, error: 'already_handled' };

  if (accept) {
    db.addFriendship(request.from_id, request.to_id);
    db.setRequestStatus(requestId, 'accepted');
    return { ok: true, accepted: true, fromId: request.from_id, toId: request.to_id };
  }
  db.setRequestStatus(requestId, 'declined');
  return { ok: true, accepted: false, fromId: request.from_id };
}

function removeFriend(conn, friendId) {
  const meId = conn.accountId;
  if (!meId || !friendId) return { ok: false, error: 'invalid' };
  db.removeFriendship(meId, friendId);
  return { ok: true, friendId };
}

function blockUser(conn, targetAccountId) {
  const meId = conn.accountId;
  if (!meId || !targetAccountId) return { ok: false, error: 'invalid' };
  db.addBlock(meId, targetAccountId);
  // Blocking also removes any friendship
  db.removeFriendship(meId, targetAccountId);
  return { ok: true, targetAccountId };
}

function reportUser(conn, { reportedId, roomId, reason, details }) {
  const reporterId = conn.accountId;
  if (!reporterId) return { ok: false, error: 'invalid' };
  const id = db.addReport({ reporterId, reportedId, roomId, reason, details });
  return { ok: true, id };
}

module.exports = {
  presence,
  isOnline,
  registerPresence,
  unregisterPresence,
  onlineAccountCount,
  sendToAccount,
  buildFriendsPayload,
  buildDiscovery,
  sendFriendRequest,
  respondFriendRequest,
  removeFriend,
  blockUser,
  reportUser,
};
