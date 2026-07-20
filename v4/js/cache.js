/**
 * Cache local da V4.
 *
 * API publica:
 *   const cache = await openUserCache(userId)
 *   cache.getSnapshot(collection) -> Array | null
 *   cache.setSnapshot(collection, rows)
 *   cache.getAllSnapshots(collections?) -> { [collection]: Array }
 *   cache.upsertSnapshot(collection, row, { idField? })
 *   cache.removeSnapshotRow(collection, id, { idField? })
 *   cache.enqueue(operation) -> operacao persistida (idempotente por idempotencyKey)
 *   cache.listQueue(), cache.markAttempt(key, error), cache.dequeue(key)
 *   cache.getMeta(key), cache.setMeta(key, value), cache.clearUser(), cache.close()
 *
 * Todos os registros carregam userId na chave primaria. Assim, trocar de conta
 * nunca mistura snapshots ou operacoes pendentes. Quando IndexedDB nao esta
 * disponivel (modo privado antigo/testes), a mesma API usa memoria isolada.
 */

const DB_NAME = "fh3d-v4-cache";
const DB_VERSION = 1;
const SNAPSHOTS_STORE = "snapshots";
const QUEUE_STORE = "queue";
const META_STORE = "meta";

const memoryDatabases = new Map();

function assertUserId(userId) {
  const normalized = String(userId || "").trim();
  if (!normalized) throw new TypeError("userId e obrigatorio para abrir o cache.");
  return normalized;
}

function assertCollection(collection) {
  const normalized = String(collection || "").trim();
  if (!normalized) throw new TypeError("collection e obrigatoria.");
  return normalized;
}

function clone(value) {
  if (value === undefined) return undefined;
  if (typeof structuredClone === "function") return structuredClone(value);
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

function newId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `op_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Falha no IndexedDB."));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error("Transacao IndexedDB cancelada."));
    transaction.onerror = () => reject(transaction.error || new Error("Falha na transacao IndexedDB."));
  });
}

async function withTransaction(db, stores, mode, work) {
  const transaction = db.transaction(stores, mode);
  const done = transactionDone(transaction);
  const result = await work(transaction);
  await done;
  return result;
}

function openDatabase(indexedDBImpl, name) {
  return new Promise((resolve, reject) => {
    let request;
    try {
      request = indexedDBImpl.open(name, DB_VERSION);
    } catch (error) {
      reject(error);
      return;
    }

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SNAPSHOTS_STORE)) {
        const store = db.createObjectStore(SNAPSHOTS_STORE, { keyPath: ["userId", "collection"] });
        store.createIndex("by_user", "userId", { unique: false });
      }
      if (!db.objectStoreNames.contains(QUEUE_STORE)) {
        const store = db.createObjectStore(QUEUE_STORE, { keyPath: ["userId", "idempotencyKey"] });
        store.createIndex("by_user", "userId", { unique: false });
        store.createIndex("by_user_created", ["userId", "createdAt"], { unique: false });
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        const store = db.createObjectStore(META_STORE, { keyPath: ["userId", "key"] });
        store.createIndex("by_user", "userId", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Nao foi possivel abrir o IndexedDB."));
    request.onblocked = () => reject(new Error("Atualizacao do cache bloqueada por outra aba."));
  });
}

function normalizeOperation(userId, operation) {
  if (!operation || typeof operation !== "object") {
    throw new TypeError("A operacao da fila deve ser um objeto.");
  }
  const kind = String(operation.kind || operation.type || "").trim();
  if (!kind) throw new TypeError("A operacao da fila precisa de kind.");
  const idempotencyKey = String(
    operation.idempotencyKey || operation.operationId || operation.id || newId(),
  );
  const now = new Date().toISOString();
  return {
    ...clone(operation),
    userId,
    kind,
    idempotencyKey,
    operationId: idempotencyKey,
    createdAt: operation.createdAt || now,
    updatedAt: now,
    attempts: Number(operation.attempts) || 0,
    lastError: operation.lastError || null,
  };
}

async function deleteByUser(index, userId) {
  await new Promise((resolve, reject) => {
    const request = index.openCursor(userId);
    request.onerror = () => reject(request.error || new Error("Falha ao limpar cache."));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve();
        return;
      }
      cursor.delete();
      cursor.continue();
    };
  });
}

class IndexedDBUserCache {
  constructor(userId, db) {
    this.userId = userId;
    this.db = db;
  }

  async getSnapshot(collection) {
    collection = assertCollection(collection);
    const record = await withTransaction(this.db, SNAPSHOTS_STORE, "readonly", (tx) =>
      requestResult(tx.objectStore(SNAPSHOTS_STORE).get([this.userId, collection])),
    );
    return record ? clone(record.rows) : null;
  }

  async setSnapshot(collection, rows) {
    collection = assertCollection(collection);
    if (!Array.isArray(rows)) throw new TypeError("O snapshot deve ser um array.");
    const record = {
      userId: this.userId,
      collection,
      rows: clone(rows),
      updatedAt: new Date().toISOString(),
    };
    await withTransaction(this.db, SNAPSHOTS_STORE, "readwrite", (tx) =>
      requestResult(tx.objectStore(SNAPSHOTS_STORE).put(record)),
    );
    return clone(record.rows);
  }

  async getAllSnapshots(collections) {
    if (Array.isArray(collections)) {
      const entries = await Promise.all(
        collections.map(async (collection) => [collection, (await this.getSnapshot(collection)) || []]),
      );
      return Object.fromEntries(entries);
    }
    const records = await withTransaction(this.db, SNAPSHOTS_STORE, "readonly", (tx) =>
      requestResult(tx.objectStore(SNAPSHOTS_STORE).index("by_user").getAll(this.userId)),
    );
    return Object.fromEntries(records.map((record) => [record.collection, clone(record.rows)]));
  }

  async upsertSnapshot(collection, row, { idField = "id" } = {}) {
    if (!row || typeof row !== "object") throw new TypeError("row deve ser um objeto.");
    if (row[idField] == null) throw new TypeError(`row.${idField} e obrigatorio.`);
    const rows = (await this.getSnapshot(collection)) || [];
    const index = rows.findIndex((candidate) => String(candidate?.[idField]) === String(row[idField]));
    if (index >= 0) rows[index] = { ...rows[index], ...clone(row) };
    else rows.push(clone(row));
    await this.setSnapshot(collection, rows);
    return clone(index >= 0 ? rows[index] : rows[rows.length - 1]);
  }

  async removeSnapshotRow(collection, id, { idField = "id" } = {}) {
    const rows = (await this.getSnapshot(collection)) || [];
    const next = rows.filter((row) => String(row?.[idField]) !== String(id));
    await this.setSnapshot(collection, next);
    return next.length !== rows.length;
  }

  async enqueue(operation) {
    const record = normalizeOperation(this.userId, operation);
    const existing = await withTransaction(this.db, QUEUE_STORE, "readonly", (tx) =>
      requestResult(tx.objectStore(QUEUE_STORE).get([this.userId, record.idempotencyKey])),
    );
    const merged = existing
      ? { ...existing, ...record, createdAt: existing.createdAt, attempts: existing.attempts || 0 }
      : record;
    await withTransaction(this.db, QUEUE_STORE, "readwrite", (tx) =>
      requestResult(tx.objectStore(QUEUE_STORE).put(merged)),
    );
    return clone(merged);
  }

  async listQueue() {
    const records = await withTransaction(this.db, QUEUE_STORE, "readonly", (tx) =>
      requestResult(tx.objectStore(QUEUE_STORE).index("by_user").getAll(this.userId)),
    );
    return records
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
      .map(clone);
  }

  async markAttempt(idempotencyKey, error) {
    const key = [this.userId, String(idempotencyKey)];
    const existing = await withTransaction(this.db, QUEUE_STORE, "readonly", (tx) =>
      requestResult(tx.objectStore(QUEUE_STORE).get(key)),
    );
    if (!existing) return null;
    existing.attempts = (Number(existing.attempts) || 0) + 1;
    existing.lastError = error ? String(error.message || error) : null;
    existing.updatedAt = new Date().toISOString();
    await withTransaction(this.db, QUEUE_STORE, "readwrite", (tx) =>
      requestResult(tx.objectStore(QUEUE_STORE).put(existing)),
    );
    return clone(existing);
  }

  async dequeue(idempotencyKey) {
    await withTransaction(this.db, QUEUE_STORE, "readwrite", (tx) =>
      requestResult(tx.objectStore(QUEUE_STORE).delete([this.userId, String(idempotencyKey)])),
    );
  }

  async countQueue() {
    return withTransaction(this.db, QUEUE_STORE, "readonly", (tx) =>
      requestResult(tx.objectStore(QUEUE_STORE).index("by_user").count(this.userId)),
    );
  }

  async getMeta(key) {
    const record = await withTransaction(this.db, META_STORE, "readonly", (tx) =>
      requestResult(tx.objectStore(META_STORE).get([this.userId, String(key)])),
    );
    return record ? clone(record.value) : null;
  }

  async setMeta(key, value) {
    await withTransaction(this.db, META_STORE, "readwrite", (tx) =>
      requestResult(
        tx.objectStore(META_STORE).put({
          userId: this.userId,
          key: String(key),
          value: clone(value),
          updatedAt: new Date().toISOString(),
        }),
      ),
    );
    return clone(value);
  }

  async clearUser() {
    await withTransaction(
      this.db,
      [SNAPSHOTS_STORE, QUEUE_STORE, META_STORE],
      "readwrite",
      async (tx) => {
        await Promise.all(
          [SNAPSHOTS_STORE, QUEUE_STORE, META_STORE].map((storeName) =>
            deleteByUser(tx.objectStore(storeName).index("by_user"), this.userId),
          ),
        );
      },
    );
  }

  close() {
    this.db.close();
  }
}

function memoryState(name, userId) {
  if (!memoryDatabases.has(name)) memoryDatabases.set(name, new Map());
  const database = memoryDatabases.get(name);
  if (!database.has(userId)) {
    database.set(userId, { snapshots: new Map(), queue: new Map(), meta: new Map() });
  }
  return database.get(userId);
}

class MemoryUserCache {
  constructor(userId, name) {
    this.userId = userId;
    this.state = memoryState(name, userId);
  }

  async getSnapshot(collection) {
    collection = assertCollection(collection);
    return this.state.snapshots.has(collection) ? clone(this.state.snapshots.get(collection)) : null;
  }

  async setSnapshot(collection, rows) {
    collection = assertCollection(collection);
    if (!Array.isArray(rows)) throw new TypeError("O snapshot deve ser um array.");
    this.state.snapshots.set(collection, clone(rows));
    return clone(rows);
  }

  async getAllSnapshots(collections) {
    const names = Array.isArray(collections) ? collections : [...this.state.snapshots.keys()];
    return Object.fromEntries(names.map((name) => [name, clone(this.state.snapshots.get(name) || [])]));
  }

  async upsertSnapshot(collection, row, { idField = "id" } = {}) {
    if (!row || row[idField] == null) throw new TypeError(`row.${idField} e obrigatorio.`);
    const rows = (await this.getSnapshot(collection)) || [];
    const index = rows.findIndex((candidate) => String(candidate?.[idField]) === String(row[idField]));
    if (index >= 0) rows[index] = { ...rows[index], ...clone(row) };
    else rows.push(clone(row));
    await this.setSnapshot(collection, rows);
    return clone(index >= 0 ? rows[index] : rows[rows.length - 1]);
  }

  async removeSnapshotRow(collection, id, { idField = "id" } = {}) {
    const rows = (await this.getSnapshot(collection)) || [];
    const next = rows.filter((row) => String(row?.[idField]) !== String(id));
    await this.setSnapshot(collection, next);
    return next.length !== rows.length;
  }

  async enqueue(operation) {
    const record = normalizeOperation(this.userId, operation);
    const existing = this.state.queue.get(record.idempotencyKey);
    const merged = existing
      ? { ...existing, ...record, createdAt: existing.createdAt, attempts: existing.attempts || 0 }
      : record;
    this.state.queue.set(record.idempotencyKey, clone(merged));
    return clone(merged);
  }

  async listQueue() {
    return [...this.state.queue.values()]
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
      .map(clone);
  }

  async markAttempt(idempotencyKey, error) {
    const existing = this.state.queue.get(String(idempotencyKey));
    if (!existing) return null;
    existing.attempts = (Number(existing.attempts) || 0) + 1;
    existing.lastError = error ? String(error.message || error) : null;
    existing.updatedAt = new Date().toISOString();
    return clone(existing);
  }

  async dequeue(idempotencyKey) {
    this.state.queue.delete(String(idempotencyKey));
  }

  async countQueue() {
    return this.state.queue.size;
  }

  async getMeta(key) {
    return this.state.meta.has(String(key)) ? clone(this.state.meta.get(String(key))) : null;
  }

  async setMeta(key, value) {
    this.state.meta.set(String(key), clone(value));
    return clone(value);
  }

  async clearUser() {
    this.state.snapshots.clear();
    this.state.queue.clear();
    this.state.meta.clear();
  }

  close() {}
}

/**
 * Abre um cache estritamente isolado para o usuario informado.
 * `options.indexedDB` e injetavel para testes; use null para forcar memoria.
 */
export async function openUserCache(userId, options = {}) {
  userId = assertUserId(userId);
  const name = options.dbName || DB_NAME;
  const indexedDBImpl = options.indexedDB === undefined ? globalThis.indexedDB : options.indexedDB;
  if (!indexedDBImpl) return new MemoryUserCache(userId, name);
  try {
    const db = await openDatabase(indexedDBImpl, name);
    return new IndexedDBUserCache(userId, db);
  } catch (error) {
    console.warn("IndexedDB indisponivel; usando cache temporario em memoria.", error);
    return new MemoryUserCache(userId, name);
  }
}

export const createCache = openUserCache;
