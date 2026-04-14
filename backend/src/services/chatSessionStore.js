/**
 * In-memory хранилище чат-сессий.
 * Каждая сессия хранит распарсенный контент документации, историю сообщений
 * и последний сгенерированный результат.
 * TTL: 2 часа — после этого сессия автоматически удаляется.
 */

const SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2 часа

/** @type {Map<string, import('./chatSessionStore').Session>} */
const sessions = new Map();

/**
 * @typedef {Object} Session
 * @property {string} id
 * @property {Object} docContent - Распарсенный контент документации
 * @property {string} docHash - SHA-256 хеш документа (для векторного поиска)
 * @property {boolean} useRag - Используется ли RAG для этой сессии
 * @property {Array<{role: string, content: string, timestamp: string}>} messages
 * @property {Object|null} lastResult - Последний сгенерированный {fields, rowSections}
 * @property {number} createdAt
 * @property {number} lastAccessedAt
 */

function generateId() {
  return crypto.randomUUID();
}

/**
 * Создаёт новую сессию с контентом документации
 * @param {Object} docContent - Распарсенный контент документа
 * @returns {Session}
 */
export function createSession(docContent) {
  const id = generateId();
  const now = Date.now();
  const session = {
    id,
    docContent,
    docHash: docContent.docHash || null,
    useRag: false,
    messages: [],
    lastResult: null,
    createdAt: now,
    lastAccessedAt: now,
  };
  sessions.set(id, session);
  return session;
}

/**
 * Получает сессию по ID (обновляет lastAccessedAt)
 * @param {string} sessionId
 * @returns {Session|null}
 */
export function getSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return null;
  // Проверяем TTL
  if (Date.now() - session.lastAccessedAt > SESSION_TTL_MS) {
    sessions.delete(sessionId);
    return null;
  }
  session.lastAccessedAt = Date.now();
  return session;
}

/**
 * Добавляет сообщение в историю сессии
 * @param {string} sessionId
 * @param {'user'|'assistant'} role
 * @param {string} content
 */
export function addMessage(sessionId, role, content) {
  const session = getSession(sessionId);
  if (!session) return null;
  session.messages.push({
    role,
    content,
    timestamp: new Date().toISOString(),
  });
  return session;
}

/**
 * Сохраняет последний сгенерированный результат
 * @param {string} sessionId
 * @param {Object} result - {fields, rowSections}
 */
export function setLastResult(sessionId, result) {
  const session = getSession(sessionId);
  if (!session) return null;
  session.lastResult = result;
  return session;
}

/**
 * Удаляет сессию
 * @param {string} sessionId
 * @returns {boolean}
 */
export function deleteSession(sessionId) {
  return sessions.delete(sessionId);
}

// Периодическая очистка просроченных сессий (каждые 30 минут)
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.lastAccessedAt > SESSION_TTL_MS) {
      sessions.delete(id);
    }
  }
}, 30 * 60 * 1000);
