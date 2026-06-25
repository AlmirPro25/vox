// ============================================================================
// VOX-BRIDGE - Persistence Layer (SQLite)
// ============================================================================
// Real, production-capable persistence for identity + social graph.
// Uses better-sqlite3 (synchronous, fast, file-based, zero external service).
//
// PRODUCTION NOTES:
// - Set DATABASE_PATH to a path on a PERSISTENT disk (e.g. Render persistent
//   disk, mounted volume). On ephemeral filesystems data is lost on redeploy.
// - For multi-instance horizontal scaling, migrate these queries to Postgres.
//   The query surface is intentionally small and isolated in this module to
//   make that migration straightforward.
// ============================================================================

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const DATABASE_PATH = process.env.DATABASE_PATH || path.join(__dirname, 'data', 'voxbridge.db');

// Ensure the directory exists
const dbDir = path.dirname(DATABASE_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(DATABASE_PATH);

// WAL mode = better concurrency (readers don't block writer)
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ============================================================================
// SCHEMA
// ============================================================================
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id              TEXT PRIMARY KEY,
    token           TEXT UNIQUE NOT NULL,
    handle          TEXT NOT NULL,
    display_name    TEXT,
    native_language TEXT DEFAULT 'pt',
    target_language TEXT DEFAULT 'en',
    country         TEXT DEFAULT 'BR',
    interests       TEXT DEFAULT '[]',
    reputation      INTEGER DEFAULT 100,
    created_at      INTEGER NOT NULL,
    last_seen       INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_users_token ON users(token);

  CREATE TABLE IF NOT EXISTS friendships (
    user_id    TEXT NOT NULL,
    friend_id  TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, friend_id),
    FOREIGN KEY (user_id)   REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (friend_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS friend_requests (
    id         TEXT PRIMARY KEY,
    from_id    TEXT NOT NULL,
    to_id      TEXT NOT NULL,
    status     TEXT NOT NULL DEFAULT 'pending',
    created_at INTEGER NOT NULL,
    UNIQUE (from_id, to_id),
    FOREIGN KEY (from_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (to_id)   REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_requests_to ON friend_requests(to_id, status);

  CREATE TABLE IF NOT EXISTS blocks (
    blocker_id TEXT NOT NULL,
    blocked_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (blocker_id, blocked_id)
  );

  CREATE TABLE IF NOT EXISTS reports (
    id          TEXT PRIMARY KEY,
    reporter_id TEXT NOT NULL,
    reported_id TEXT,
    room_id     TEXT,
    reason      TEXT,
    details     TEXT,
    created_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS messages (
    id         TEXT PRIMARY KEY,
    room_id    TEXT,
    from_id    TEXT NOT NULL,
    to_id      TEXT,
    text       TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(room_id);
`);

// ============================================================================
// PREPARED STATEMENTS
// ============================================================================
const stmts = {
  insertUser: db.prepare(`
    INSERT INTO users (id, token, handle, display_name, native_language, target_language, country, interests, reputation, created_at, last_seen)
    VALUES (@id, @token, @handle, @display_name, @native_language, @target_language, @country, @interests, @reputation, @created_at, @last_seen)
  `),
  getUserByToken: db.prepare(`SELECT * FROM users WHERE token = ?`),
  getUserById: db.prepare(`SELECT * FROM users WHERE id = ?`),
  handleExists: db.prepare(`SELECT 1 FROM users WHERE handle = ? LIMIT 1`),
  touchLastSeen: db.prepare(`UPDATE users SET last_seen = ? WHERE id = ?`),
  updatePrefs: db.prepare(`
    UPDATE users SET native_language = @native_language, target_language = @target_language,
      country = @country, interests = @interests, display_name = @display_name WHERE id = @id
  `),

  insertFriendship: db.prepare(`
    INSERT OR IGNORE INTO friendships (user_id, friend_id, created_at) VALUES (?, ?, ?)
  `),
  deleteFriendship: db.prepare(`DELETE FROM friendships WHERE user_id = ? AND friend_id = ?`),
  getFriends: db.prepare(`
    SELECT u.* FROM friendships f
    JOIN users u ON u.id = f.friend_id
    WHERE f.user_id = ?
    ORDER BY f.created_at DESC
  `),
  areFriends: db.prepare(`SELECT 1 FROM friendships WHERE user_id = ? AND friend_id = ? LIMIT 1`),

  insertRequest: db.prepare(`
    INSERT INTO friend_requests (id, from_id, to_id, status, created_at)
    VALUES (@id, @from_id, @to_id, 'pending', @created_at)
    ON CONFLICT(from_id, to_id) DO UPDATE SET status = 'pending', created_at = @created_at
  `),
  getRequestById: db.prepare(`SELECT * FROM friend_requests WHERE id = ?`),
  getPendingBetween: db.prepare(`
    SELECT * FROM friend_requests WHERE from_id = ? AND to_id = ? AND status = 'pending' LIMIT 1
  `),
  getIncomingRequests: db.prepare(`
    SELECT r.id as request_id, r.created_at as request_created_at, u.*
    FROM friend_requests r
    JOIN users u ON u.id = r.from_id
    WHERE r.to_id = ? AND r.status = 'pending'
    ORDER BY r.created_at DESC
  `),
  updateRequestStatus: db.prepare(`UPDATE friend_requests SET status = ? WHERE id = ?`),

  insertBlock: db.prepare(`
    INSERT OR IGNORE INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)
  `),
  isBlockedEither: db.prepare(`
    SELECT 1 FROM blocks
    WHERE (blocker_id = @a AND blocked_id = @b) OR (blocker_id = @b AND blocked_id = @a)
    LIMIT 1
  `),
  getBlockedIds: db.prepare(`
    SELECT blocked_id FROM blocks WHERE blocker_id = ?
    UNION
    SELECT blocker_id FROM blocks WHERE blocked_id = ?
  `),

  insertReport: db.prepare(`
    INSERT INTO reports (id, reporter_id, reported_id, room_id, reason, details, created_at)
    VALUES (@id, @reporter_id, @reported_id, @room_id, @reason, @details, @created_at)
  `),

  insertMessage: db.prepare(`
    INSERT INTO messages (id, room_id, from_id, to_id, text, created_at)
    VALUES (@id, @room_id, @from_id, @to_id, @text, @created_at)
  `),
};

// ============================================================================
// HELPERS
// ============================================================================
const ADJECTIVES = ['Swift', 'Bright', 'Cool', 'Wild', 'Calm', 'Bold', 'Wise', 'Free', 'Quick', 'Sharp', 'Lunar', 'Solar', 'Nova', 'Echo', 'Vivid'];
const NOUNS = ['Fox', 'Wolf', 'Bear', 'Eagle', 'Lion', 'Tiger', 'Hawk', 'Owl', 'Panda', 'Falcon', 'Raven', 'Lynx', 'Otter', 'Crane', 'Heron'];

function generateHandle() {
  for (let attempt = 0; attempt < 10; attempt++) {
    const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
    const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
    const num = Math.floor(Math.random() * 1000);
    const handle = `${adj}${noun}${num}`;
    if (!stmts.handleExists.get(handle)) return handle;
  }
  // Fallback: guaranteed-unique handle
  return `User${crypto.randomBytes(4).toString('hex')}`;
}

function newToken() {
  return crypto.randomBytes(32).toString('hex');
}

function parseInterests(raw) {
  try {
    const arr = JSON.parse(raw || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

// Map a DB user row to a public-safe object (never exposes token)
function publicUser(row, extra = {}) {
  if (!row) return null;
  return {
    id: row.id,
    handle: row.handle,
    displayName: row.display_name || row.handle,
    nativeLanguage: row.native_language,
    targetLanguage: row.target_language,
    country: row.country,
    interests: parseInterests(row.interests),
    reputation: row.reputation,
    ...extra,
  };
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Find a user by token, or create a brand new account.
 * Returns the DB row (includes token — caller must only send it back to its owner).
 */
function findOrCreateUser({ token, displayName, nativeLanguage, targetLanguage, country, interests }) {
  const now = Date.now();

  if (token) {
    const existing = stmts.getUserByToken.get(token);
    if (existing) {
      stmts.touchLastSeen.run(now, existing.id);
      return existing;
    }
  }

  const user = {
    id: crypto.randomUUID(),
    token: newToken(),
    handle: generateHandle(),
    display_name: (displayName || '').slice(0, 40) || null,
    native_language: nativeLanguage || 'pt',
    target_language: targetLanguage || 'en',
    country: country || 'BR',
    interests: JSON.stringify(Array.isArray(interests) ? interests.slice(0, 10) : []),
    reputation: 100,
    created_at: now,
    last_seen: now,
  };
  stmts.insertUser.run(user);
  return user;
}

function getUserById(id) {
  return stmts.getUserById.get(id);
}

function touchLastSeen(id) {
  stmts.touchLastSeen.run(Date.now(), id);
}

function updatePrefs(id, { nativeLanguage, targetLanguage, country, interests, displayName }) {
  const current = stmts.getUserById.get(id);
  if (!current) return null;
  const merged = {
    id,
    native_language: nativeLanguage || current.native_language,
    target_language: targetLanguage || current.target_language,
    country: country || current.country,
    interests: interests !== undefined ? JSON.stringify((interests || []).slice(0, 10)) : current.interests,
    display_name: displayName !== undefined ? (displayName || '').slice(0, 40) || null : current.display_name,
  };
  stmts.updatePrefs.run(merged);
  return stmts.getUserById.get(id);
}

// --- Friends ---
const addFriendship = db.transaction((a, b) => {
  const now = Date.now();
  stmts.insertFriendship.run(a, b, now);
  stmts.insertFriendship.run(b, a, now);
});

function removeFriendship(a, b) {
  const tx = db.transaction(() => {
    stmts.deleteFriendship.run(a, b);
    stmts.deleteFriendship.run(b, a);
  });
  tx();
}

function getFriends(id) {
  return stmts.getFriends.all(id).map((row) => publicUser(row));
}

function areFriends(a, b) {
  return !!stmts.areFriends.get(a, b);
}

// --- Friend requests ---
function createFriendRequest(fromId, toId) {
  const id = crypto.randomUUID();
  stmts.insertRequest.run({ id, from_id: fromId, to_id: toId, created_at: Date.now() });
  return stmts.getPendingBetween.get(fromId, toId);
}

function getRequestById(id) {
  return stmts.getRequestById.get(id);
}

function getIncomingRequests(toId) {
  return stmts.getIncomingRequests.all(toId).map((row) =>
    publicUser(row, { requestId: row.request_id, requestedAt: row.request_created_at })
  );
}

function setRequestStatus(id, status) {
  stmts.updateRequestStatus.run(status, id);
}

// --- Blocks ---
function addBlock(blockerId, blockedId) {
  stmts.insertBlock.run(blockerId, blockedId, Date.now());
}

function isBlockedEither(a, b) {
  return !!stmts.isBlockedEither.get({ a, b });
}

function getBlockedIds(id) {
  return stmts.getBlockedIds.all(id, id).map((r) => r.blocked_id);
}

// --- Reports ---
function addReport({ reporterId, reportedId, roomId, reason, details }) {
  const id = crypto.randomUUID();
  stmts.insertReport.run({
    id,
    reporter_id: reporterId,
    reported_id: reportedId || null,
    room_id: roomId || null,
    reason: (reason || '').slice(0, 100),
    details: (details || '').slice(0, 1000),
    created_at: Date.now(),
  });
  return id;
}

// --- Messages (history / moderation) ---
function saveMessage({ roomId, fromId, toId, text }) {
  const id = crypto.randomUUID();
  stmts.insertMessage.run({
    id,
    room_id: roomId || null,
    from_id: fromId,
    to_id: toId || null,
    text: (text || '').slice(0, 1000),
    created_at: Date.now(),
  });
  return id;
}

function close() {
  try { db.close(); } catch { /* ignore */ }
}

module.exports = {
  db,
  publicUser,
  findOrCreateUser,
  getUserById,
  touchLastSeen,
  updatePrefs,
  addFriendship,
  removeFriendship,
  getFriends,
  areFriends,
  createFriendRequest,
  getRequestById,
  getIncomingRequests,
  setRequestStatus,
  addBlock,
  isBlockedEither,
  getBlockedIds,
  addReport,
  saveMessage,
  close,
  DATABASE_PATH,
};
