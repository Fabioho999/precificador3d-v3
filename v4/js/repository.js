import { openUserCache } from "./cache.js";

/** Tabelas normalizadas que compoem um snapshot completo da V4. */
export const COLLECTIONS = Object.freeze([
  "settings",
  "filaments",
  "orders",
  "order_items",
  "stock_movements",
  "expenses",
  "recurring_expenses",
  "catalog_products",
  "calibrations",
  "tasks",
  "attachments",
]);

export const SYNC_STATUS = Object.freeze({
  SYNCHRONIZED: "synchronized",
  PENDING: "pending",
  OFFLINE: "offline",
  CONFLICT: "conflict",
});

const STATUS_LABELS = Object.freeze({
  [SYNC_STATUS.SYNCHRONIZED]: "Sincronizado",
  [SYNC_STATUS.PENDING]: "Pendente",
  [SYNC_STATUS.OFFLINE]: "Offline",
  [SYNC_STATUS.CONFLICT]: "Conflito",
});

const CRITICAL_RPCS = new Set([
  "save_filament",
  "save_order",
  "start_order_production",
  "cancel_order",
  "reopen_order",
  "restore_order",
  "archive_order",
]);
const DEFAULT_ATTACHMENT_BUCKET = "order-assets";
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const REMOTE_TIMEOUT_MS = 15_000;

export class RepositoryError extends Error {
  constructor(message, { code = "REPOSITORY_ERROR", cause = null, details = null } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "RepositoryError";
    this.code = code;
    this.details = details;
  }
}

export class AuthenticationError extends RepositoryError {
  constructor(message = "Entre na sua conta para acessar os dados.", options = {}) {
    super(message, { ...options, code: "AUTH_REQUIRED" });
    this.name = "AuthenticationError";
  }
}

export class ConflictError extends RepositoryError {
  constructor(message = "Este registro foi alterado em outro aparelho.", options = {}) {
    super(message, { ...options, code: "VERSION_CONFLICT" });
    this.name = "ConflictError";
  }
}

export class OfflineError extends RepositoryError {
  constructor(message = "Sem conexao com a internet.", options = {}) {
    super(message, { ...options, code: options.code || "OFFLINE" });
    this.name = "OfflineError";
  }
}

function uuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `op_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function isOnline() {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

function isNetworkError(error) {
  if (!isOnline()) return true;
  if (error instanceof OfflineError) return true;
  if (error?.code === "REQUEST_TIMEOUT" || error?.name === "AbortError") return true;
  const message = String(error?.message || error || "");
  return /failed to fetch|networkerror|network request|load failed|fetch failed|connection.*(lost|closed)|err_internet/i.test(
    message,
  );
}

function withTimeout(value, milliseconds = REMOTE_TIMEOUT_MS, onTimeout = null) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      try { onTimeout?.(); } catch {}
      reject(new OfflineError("A nuvem demorou para responder; usando os dados deste aparelho.", {
        code: "REQUEST_TIMEOUT",
      }));
    }, milliseconds);
  });
  return Promise.race([Promise.resolve(value), timeout]).finally(() => clearTimeout(timer));
}

function remoteRequestWithTimeout(request, milliseconds = REMOTE_TIMEOUT_MS) {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  let abortable = request;
  if (controller && typeof abortable?.abortSignal === "function") {
    abortable = abortable.abortSignal(controller.signal);
  }
  return withTimeout(abortable, milliseconds, () => controller?.abort());
}

function asRepositoryError(error, context) {
  if (error instanceof RepositoryError) return error;
  const message = error?.message || `Falha ao ${context}.`;
  return new RepositoryError(message, {
    code: error?.code || "SUPABASE_ERROR",
    cause: error,
    details: error?.details || error?.hint || null,
  });
}

function assertCollection(collection, allowedCollections) {
  if (!allowedCollections.includes(collection)) {
    throw new RepositoryError(`Colecao nao permitida: ${collection}.`, { code: "INVALID_COLLECTION" });
  }
}

function cleanRow(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    throw new TypeError("row deve ser um objeto.");
  }
  return Object.fromEntries(
    Object.entries(row).filter(([key, value]) => !key.startsWith("_") && value !== undefined),
  );
}

const DB_FIELDS = Object.freeze({
  settings: ["user_id", "studio_name", "whatsapp", "email", "instagram", "pix_key", "pix_type", "pix_holder", "logo_path", "logo_url", "currency", "quote_validity_days", "default_margin_percent", "electricity_cost_kwh", "filament_cost_kg", "energy_kwh", "k1c_kw", "kobra_kw", "depreciation_hour", "maintenance_hour", "profit_percent", "packaging_cost", "modification_terms", "validity_terms", "general_notes", "data", "version", "created_at", "updated_at"],
  filaments: ["id", "user_id", "legacy_id", "manufacturer", "material", "color", "brand", "sku", "initial_weight_g", "current_weight_g", "price_kg", "active", "archived_at", "deleted_at", "notes", "metadata", "version", "created_at", "updated_at"],
  orders: ["id", "user_id", "legacy_id", "order_number", "customer_name", "customer_email", "customer_phone", "project", "printer", "description", "notes", "due_date", "commercial_status", "cancelled_from_status", "production_status", "payment_status", "subtotal", "discount", "shipping", "total", "final_price", "total_cost", "modeling_price", "finishing_price", "paid_at", "stock_cycle", "stock_consumed_at", "stock_restored_at", "archived_at", "deleted_at", "metadata", "version", "created_at", "updated_at"],
  order_items: ["id", "user_id", "order_id", "filament_id", "legacy_id", "name", "quantity", "unit_weight_g", "print_hours", "material", "filament_price_kg", "unit_price", "line_total", "sort_order", "metadata", "version", "created_at", "updated_at"],
  stock_movements: ["id", "user_id", "filament_id", "order_id", "movement_type", "quantity_g", "balance_after_g", "stock_cycle", "idempotency_key", "reason", "metadata", "version", "created_at", "updated_at"],
  expenses: ["id", "user_id", "order_id", "legacy_id", "description", "category", "amount", "expense_date", "due_date", "paid_at", "notes", "deleted_at", "metadata", "version", "created_at", "updated_at"],
  recurring_expenses: ["id", "user_id", "legacy_id", "description", "category", "amount", "frequency", "day_of_month", "next_due_date", "active", "notes", "deleted_at", "metadata", "version", "created_at", "updated_at"],
  catalog_products: ["id", "user_id", "filament_id", "legacy_id", "name", "category", "unit_weight_g", "print_hours", "material", "default_unit_price", "suggested_price", "active", "deleted_at", "metadata", "version", "created_at", "updated_at"],
  calibrations: ["id", "user_id", "filament_id", "legacy_id", "name", "printer", "material", "temperature_c", "layer_height_mm", "speed_mm_s", "nozzle_mm", "z_offset_mm", "nozzle_diameter", "settings", "results", "notes", "deleted_at", "metadata", "version", "created_at", "updated_at"],
  tasks: ["id", "user_id", "order_id", "legacy_id", "title", "notes", "status", "priority", "due_date", "completed_at", "deleted_at", "metadata", "version", "created_at", "updated_at"],
  attachments: ["id", "user_id", "order_id", "catalog_product_id", "legacy_id", "kind", "storage_bucket", "storage_path", "file_name", "mime_type", "size_bytes", "width", "height", "sort_order", "deleted_at", "metadata", "version", "created_at", "updated_at"],
});

function pick(object, keys) {
  return Object.fromEntries(keys.filter((key) => object[key] !== undefined).map((key) => [key, object[key]]));
}

function toDatabaseRow(collection, input) {
  const row = cleanRow(input);
  if (collection === "settings") {
    const structural = new Set(DB_FIELDS.settings);
    const data = { ...(row.data || {}) };
    for (const [key, value] of Object.entries(row)) if (!structural.has(key) && key !== "id") data[key] = value;
    return pick({ ...row, data }, DB_FIELDS.settings);
  }
  if (collection === "calibrations") {
    const nozzle = row.nozzle_mm ?? row.nozzle_diameter;
    const zOffset = row.z_offset_mm ?? row.settings?.z_offset_mm;
    return pick({
      ...row,
      nozzle_mm: nozzle,
      z_offset_mm: zOffset,
      nozzle_diameter: row.nozzle_diameter ?? nozzle,
      settings: { ...(row.settings || {}), z_offset_mm: zOffset },
    }, DB_FIELDS.calibrations);
  }
  if (collection === "catalog_products") {
    const defaultPrice = row.default_unit_price ?? row.suggested_price ?? 0;
    const suggestedPrice = row.suggested_price ?? row.default_unit_price ?? 0;
    return pick({ ...row, default_unit_price: defaultPrice, suggested_price: suggestedPrice }, DB_FIELDS.catalog_products);
  }
  if (collection === "attachments") {
    return pick({ ...row, storage_bucket: row.storage_bucket || DEFAULT_ATTACHMENT_BUCKET }, DB_FIELDS.attachments);
  }
  return pick(row, DB_FIELDS[collection] || Object.keys(row));
}

function fromDatabaseRow(collection, input) {
  const row = { ...(input || {}) };
  if (collection === "settings") return { ...(row.data || {}), ...row };
  if (collection === "calibrations") return {
    ...row,
    nozzle_mm: row.nozzle_mm ?? row.nozzle_diameter,
    nozzle_diameter: row.nozzle_diameter ?? row.nozzle_mm,
    z_offset_mm: row.z_offset_mm ?? row.settings?.z_offset_mm,
  };
  if (collection === "catalog_products") return {
    ...row,
    default_unit_price: row.default_unit_price ?? row.suggested_price ?? 0,
    suggested_price: row.suggested_price ?? row.default_unit_price ?? 0,
  };
  return row;
}

function credentials(emailOrCredentials, password) {
  if (emailOrCredentials && typeof emailOrCredentials === "object") {
    return { email: String(emailOrCredentials.email || "").trim(), password: emailOrCredentials.password || "" };
  }
  return { email: String(emailOrCredentials || "").trim(), password: password || "" };
}

function firstRow(data) {
  return Array.isArray(data) ? data[0] || null : data || null;
}

function safeFileName(name) {
  const normalized = String(name || "arquivo")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(-120);
  return normalized || "arquivo";
}

function attachmentKind(file) {
  return String(file?.type || "").startsWith("image/") ? "product_photo" : "document";
}

/**
 * Repositorio unico da aplicacao.
 *
 * API estavel:
 *   createRepository({ supabaseClient, onStatus })
 *   signIn(email, password), signUp(email, password), signOut(), getSession()
 *   loadAll(), upsert(collection, row), remove(collection, id), rpc(name, args)
 *   subscribe(onChange), uploadAttachment(file, userId, orderId), replayQueue()
 *   listPendingOperations(), discardPendingOperations()
 *
 * `onStatus` recebe `{ state, label, pending, message, error, updatedAt }`.
 * Escritas sem rede atualizam o snapshot e entram na fila com chave idempotente.
 */
export function createRepository({
  supabaseClient,
  onStatus = () => {},
  collections = COLLECTIONS,
  attachmentBucket = DEFAULT_ATTACHMENT_BUCKET,
  cacheOptions = {},
} = {}) {
  if (!supabaseClient?.from || !supabaseClient?.auth) {
    const unavailable = () => Promise.reject(new OfflineError("O servico de nuvem nao foi carregado."));
    try {
      onStatus({ status: "offline", state: SYNC_STATUS.OFFLINE, label: "Offline", pending: 0 });
    } catch {}
    return Object.freeze({
      signIn: unavailable,
      signUp: unavailable,
      signOut: async () => {},
      getSession: async () => null,
      loadAll: async () => Object.fromEntries(collections.map((name) => [name, []])),
      loadCached: async () => Object.fromEntries(collections.map((name) => [name, []])),
      loadLegacyCloud: async () => [],
      upsert: unavailable,
      remove: unavailable,
      rpc: unavailable,
      subscribe: async () => () => {},
      uploadAttachment: unavailable,
      getAttachmentUrl: unavailable,
      replayQueue: async () => ({ replayed: 0, remaining: 0 }),
      listPendingOperations: async () => [],
      discardPendingOperations: unavailable,
      getStatus: () => ({ status: "offline", state: SYNC_STATUS.OFFLINE, label: "Offline", pending: 0 }),
      dispose: () => {},
    });
  }

  const allowedCollections = [...collections];
  let currentUser = null;
  let currentCache = null;
  let replayPromise = null;
  let realtimeChannel = null;
  let realtimeUserId = null;
  const changeListeners = new Set();
  let disposed = false;
  let status = {
    state: isOnline() ? SYNC_STATUS.SYNCHRONIZED : SYNC_STATUS.OFFLINE,
    status: isOnline() ? "synced" : "offline",
    label: isOnline() ? STATUS_LABELS.synchronized : STATUS_LABELS.offline,
    pending: 0,
    message: null,
    error: null,
    updatedAt: new Date().toISOString(),
  };

  function emitStatus(state, details = {}) {
    status = {
      ...status,
      ...details,
      state,
      status: state === SYNC_STATUS.SYNCHRONIZED ? "synced" : state,
      label: STATUS_LABELS[state],
      updatedAt: new Date().toISOString(),
    };
    try {
      onStatus({ ...status });
    } catch (error) {
      console.error("Falha no observador de sincronizacao.", error);
    }
    return { ...status };
  }

  async function updatePendingStatus(preferredState, details = {}) {
    const pending = currentCache ? await currentCache.countQueue() : 0;
    let state = preferredState;
    if (!state) state = !isOnline() ? SYNC_STATUS.OFFLINE : pending ? SYNC_STATUS.PENDING : SYNC_STATUS.SYNCHRONIZED;
    return emitStatus(state, { pending, ...details });
  }

  async function switchUser(user) {
    const nextId = user?.id ? String(user.id) : null;
    if (nextId === currentUser?.id && currentCache) {
      currentUser = user;
      return currentCache;
    }
    stopRealtime();
    currentCache?.close?.();
    currentUser = user || null;
    currentCache = nextId ? await openUserCache(nextId, cacheOptions) : null;
    await updatePendingStatus(!isOnline() ? SYNC_STATUS.OFFLINE : null);
    return currentCache;
  }

  async function getSession() {
    const { data, error } = await supabaseClient.auth.getSession();
    if (error) throw asRepositoryError(error, "consultar a sessao");
    await switchUser(data?.session?.user || null);
    return data?.session || null;
  }

  async function requireContext() {
    const session = await getSession();
    if (!session?.user) throw new AuthenticationError();
    return { session, user: session.user, cache: currentCache };
  }

  async function signIn(emailOrCredentials, password) {
    const values = credentials(emailOrCredentials, password);
    const { data, error } = await supabaseClient.auth.signInWithPassword(values);
    if (error) throw asRepositoryError(error, "entrar");
    await switchUser(data?.user || data?.session?.user || null);
    await replayQueue();
    return data;
  }

  async function signUp(emailOrCredentials, password) {
    const values = credentials(emailOrCredentials, password);
    const { data, error } = await supabaseClient.auth.signUp(values);
    if (error) throw asRepositoryError(error, "criar a conta");
    await switchUser(data?.user || data?.session?.user || null);
    return data;
  }

  async function signOut() {
    stopRealtime();
    const { error } = await supabaseClient.auth.signOut();
    if (error) throw asRepositoryError(error, "sair");
    currentCache?.close?.();
    currentCache = null;
    currentUser = null;
    return emitStatus(isOnline() ? SYNC_STATUS.SYNCHRONIZED : SYNC_STATUS.OFFLINE, {
      pending: 0,
      message: null,
      error: null,
    });
  }

  async function loadCached(requestedCollections = allowedCollections) {
    const { cache } = await requireContext();
    requestedCollections.forEach((collection) => assertCollection(collection, allowedCollections));
    return cache.getAllSnapshots(requestedCollections);
  }

  async function fetchCollection(collection, userId) {
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    let query = supabaseClient
      .from(collection)
      .select("*")
      .eq("user_id", userId);
    if (controller && typeof query.abortSignal === "function") query = query.abortSignal(controller.signal);
    const { data, error } = await withTimeout(query, REMOTE_TIMEOUT_MS, () => controller?.abort());
    if (error) throw error;
    return (data || []).map((row) => fromDatabaseRow(collection, row));
  }

  async function loadAll() {
    const { user, cache } = await requireContext();
    if (!isOnline()) {
      await updatePendingStatus(SYNC_STATUS.OFFLINE, { message: "Exibindo dados salvos neste aparelho." });
      return cache.getAllSnapshots(allowedCollections);
    }

    try {
      await withTimeout(replayQueue(), REMOTE_TIMEOUT_MS);
      const entries = await Promise.all(
        allowedCollections.map(async (collection) => [collection, await fetchCollection(collection, user.id)]),
      );
      const snapshot = Object.fromEntries(entries);
      await Promise.all(entries.map(([collection, rows]) => cache.setSnapshot(collection, rows)));
      await updatePendingStatus(null, { message: null, error: null });
      return snapshot;
    } catch (error) {
      if (isNetworkError(error)) {
        await updatePendingStatus(SYNC_STATUS.OFFLINE, {
          message: "A nuvem esta indisponivel; exibindo o cache local.",
          error: error?.message || String(error),
        });
        return cache.getAllSnapshots(allowedCollections);
      }
      throw asRepositoryError(error, "carregar os dados");
    }
  }

  async function remoteUpsert(collection, row, userId) {
    const source = cleanRow({ ...row, user_id: userId });
    if (collection === "settings") delete source.id;
    const expectedVersion = Number.isInteger(Number(source.version)) ? Number(source.version) : null;
    const payload = toDatabaseRow(collection, source);
    const hasRecordKey = payload.id != null || collection === "settings";

    if (hasRecordKey && expectedVersion != null && expectedVersion > 0) {
      delete payload.version;
      let query = supabaseClient.from(collection).update(payload).eq("user_id", userId);
      if (row.id != null) query = query.eq("id", row.id);
      query = query.eq("version", expectedVersion).select("*");
      const { data, error } = await remoteRequestWithTimeout(query);
      if (error) throw error;
      const saved = firstRow(data);
      if (!saved) {
        throw new ConflictError("O registro mudou em outro aparelho. Recarregue antes de salvar.", {
          details: { collection, id: row.id || userId, expectedVersion },
        });
      }
      return fromDatabaseRow(collection, saved);
    }

    const onConflict = collection === "settings" ? "user_id" : "id";
    const { data, error } = await remoteRequestWithTimeout(supabaseClient
      .from(collection)
      .upsert(payload, { onConflict })
      .select("*"));
    if (error) throw error;
    return fromDatabaseRow(collection, firstRow(data) || payload);
  }

  async function remoteRemove(collection, id, userId) {
    const { data, error } = await remoteRequestWithTimeout(supabaseClient
      .from(collection)
      .delete()
      .eq("user_id", userId)
      .eq("id", id)
      .select("id"));
    if (error) throw error;
    return Boolean(firstRow(data));
  }

  async function queueOperation(cache, operation, statusState = null) {
    const queued = await cache.enqueue(operation);
    await updatePendingStatus(statusState || (!isOnline() ? SYNC_STATUS.OFFLINE : SYNC_STATUS.PENDING), {
      message: !isOnline() ? "Alteracao salva neste aparelho e aguardando internet." : "Alteracao aguardando sincronizacao.",
      error: operation.lastError || null,
    });
    return queued;
  }

  function semanticRpcKey(name, args, userId) {
    const recordId =
      args?.p_order?.id ?? args?.order?.id ?? args?.p_filament?.id ??
      args?.p_order_id ?? args?.order_id ?? args?.p_payload?.migration_id ?? userId;
    return `rpc:${name}:${recordId}`;
  }

  async function projectRpc(cache, name, args, userId, operationId) {
    const pending = (row) => ({
      ...row,
      user_id: row.user_id || userId,
      _sync_status: "pending",
      _operation_id: operationId,
    });
    if (name === "save_order") {
      const order = args.p_order || args.order;
      const items = args.p_items || args.items;
      if (order?.id) {
        const expected = Number(args.p_expected_version ?? order.version ?? 0);
        await cache.upsertSnapshot("orders", pending({ ...order, version: expected + 1 }));
        if (Array.isArray(items)) {
          const current = (await cache.getSnapshot("order_items")) || [];
          const otherOrders = current.filter((item) => String(item.order_id) !== String(order.id));
          await cache.setSnapshot("order_items", [
            ...otherOrders,
            ...items.map((item) => pending({ ...item, order_id: order.id, version: Number(item.version || 0) + 1 })),
          ]);
        }
      }
      return;
    }
    if (name === "save_filament") {
      const filament = args.p_filament || args.filament;
      if (filament?.id) {
        const expected = Number(args.p_expected_version ?? filament.version ?? 0);
        await cache.upsertSnapshot("filaments", pending({ ...filament, version: expected + 1 }));
      }
      return;
    }
    const orderId = args.p_order_id ?? args.order_id;
    if (!orderId) return;
    const orders = (await cache.getSnapshot("orders")) || [];
    const order = orders.find((candidate) => String(candidate.id) === String(orderId));
    if (!order) return;
    const patch = { ...order };
    if (name === "start_order_production") patch.production_status = "em_producao";
    if (name === "cancel_order") {
      patch.cancelled_from_status = order.commercial_status;
      patch.commercial_status = "cancelado";
      patch.production_status = "pendente";
    }
    if (name === "archive_order") patch.archived_at = new Date().toISOString();
    if (name === "restore_order") patch.archived_at = null;
    if (name === "reopen_order") {
      patch.archived_at = null;
      patch.commercial_status = "aprovado";
      patch.cancelled_from_status = null;
      patch.production_status = "pendente";
    }
    patch.version = Number(order.version || args.p_expected_version || 0) + 1;
    await cache.upsertSnapshot("orders", pending(patch));
  }

  async function upsert(collection, row, options = {}) {
    assertCollection(collection, allowedCollections);
    const { user, cache } = await requireContext();
    const now = new Date().toISOString();
    const optimistic = cleanRow({
      ...row,
      version: options.expectedVersion ?? row.version,
      user_id: user.id,
      updated_at: now,
      created_at: row.created_at || now,
    });

    if (!isOnline()) {
      const pending = { ...optimistic, _sync_status: "pending" };
      await cache.upsertSnapshot(collection, pending, { idField: collection === "settings" ? "user_id" : "id" });
      const queued = await queueOperation(cache, {
        kind: "upsert",
        collection,
        row: optimistic,
        idempotencyKey: `upsert:${collection}:${optimistic.id ?? optimistic.user_id}`,
      });
      return { ...pending, _operation_id: queued.idempotencyKey };
    }

    try {
      const saved = await remoteUpsert(collection, optimistic, user.id);
      await cache.upsertSnapshot(collection, saved, { idField: collection === "settings" ? "user_id" : "id" });
      await updatePendingStatus(null, { message: null, error: null });
      return saved;
    } catch (error) {
      if (error instanceof ConflictError) {
        emitStatus(SYNC_STATUS.CONFLICT, { error: error.message, message: error.message });
        throw error;
      }
      if (isNetworkError(error)) {
        const pending = { ...optimistic, _sync_status: "pending" };
        await cache.upsertSnapshot(collection, pending, { idField: collection === "settings" ? "user_id" : "id" });
        const queued = await queueOperation(cache, {
          kind: "upsert",
          collection,
          row: optimistic,
          idempotencyKey: `upsert:${collection}:${optimistic.id ?? optimistic.user_id}`,
          lastError: error?.message || String(error),
        });
        return { ...pending, _operation_id: queued.idempotencyKey };
      }
      throw asRepositoryError(error, `salvar em ${collection}`);
    }
  }

  async function remove(collection, id, options = {}) {
    assertCollection(collection, allowedCollections);
    if (collection === "orders") {
      throw new RepositoryError("Pedidos devem ser arquivados pela operacao archive_order.", {
        code: "ORDER_REQUIRES_ARCHIVE",
      });
    }
    const { user, cache } = await requireContext();
    if (options.soft) {
      const rows = (await cache.getSnapshot(collection)) || [];
      const current = rows.find((row) => String(row.id) === String(id));
      if (!current) {
        throw new RepositoryError("Registro nao encontrado para exclusao segura.", {
          code: "RECORD_NOT_FOUND",
          details: { collection, id },
        });
      }
      return upsert(
        collection,
        { ...current, deleted_at: new Date().toISOString() },
        { expectedVersion: options.version ?? current.version },
      );
    }
    if (!isOnline()) {
      await cache.removeSnapshotRow(collection, id);
      await queueOperation(cache, { kind: "remove", collection, id, idempotencyKey: `remove:${collection}:${id}` });
      return true;
    }
    try {
      const removed = await remoteRemove(collection, id, user.id);
      await cache.removeSnapshotRow(collection, id);
      await updatePendingStatus(null, { message: null, error: null });
      return removed;
    } catch (error) {
      if (isNetworkError(error)) {
        await cache.removeSnapshotRow(collection, id);
        await queueOperation(cache, {
          kind: "remove",
          collection,
          id,
          idempotencyKey: `remove:${collection}:${id}`,
          lastError: error?.message || String(error),
        });
        return true;
      }
      throw asRepositoryError(error, `remover de ${collection}`);
    }
  }

  async function remoteRpc(name, args) {
    const { data, error } = await remoteRequestWithTimeout(supabaseClient.rpc(name, args || {}));
    if (error) throw error;
    return data;
  }

  function notifyCachedChange(collection, row, eventType = "UPDATE") {
    const change = {
      collection,
      table: collection,
      event: eventType,
      eventType,
      type: eventType,
      row,
      record: row,
      new: row,
      old: null,
      local: true,
    };
    for (const listener of changeListeners) {
      try { listener(change); } catch (error) { console.error("Falha no observador de dados.", error); }
    }
  }

  async function refreshCacheFromCloud(user, cache) {
    const entries = await Promise.all(
      allowedCollections.map(async (collection) => [collection, await fetchCollection(collection, user.id)]),
    );
    await Promise.all(entries.map(([collection, rows]) => cache.setSnapshot(collection, rows)));
    for (const [collection, rows] of entries) {
      for (const row of rows) notifyCachedChange(collection, row, "UPDATE");
    }
    return Object.fromEntries(entries);
  }

  async function applyRpcResult(cache, user, name, args, data) {
    if (name === "migrate_legacy_v3") {
      await refreshCacheFromCloud(user, cache);
      return;
    }
    if (name === "save_filament") {
      const row = data?.filament || data;
      if (row?.id) {
        const clean = fromDatabaseRow("filaments", row);
        await cache.upsertSnapshot("filaments", clean);
        notifyCachedChange("filaments", clean);
      }
      return;
    }
    if (["save_order", "start_order_production", "cancel_order", "archive_order", "restore_order", "reopen_order"].includes(name)) {
      const source = data?.order || data;
      if (!source?.id) return;
      const embeddedItems = Array.isArray(data?.items) ? data.items : Array.isArray(source.items) ? source.items : null;
      const { items: _items, ...orderSource } = source;
      const order = fromDatabaseRow("orders", orderSource);
      await cache.upsertSnapshot("orders", order);
      notifyCachedChange("orders", order);
      if (embeddedItems) {
        const current = (await cache.getSnapshot("order_items")) || [];
        const rows = embeddedItems.map((item) => fromDatabaseRow("order_items", item));
        await cache.setSnapshot("order_items", [
          ...current.filter((item) => String(item.order_id) !== String(order.id)),
          ...rows,
        ]);
        for (const item of rows) notifyCachedChange("order_items", item);
      }
      if (["start_order_production", "cancel_order"].includes(name)) {
        // Essas RPCs alteram pedido, saldo e ledger na mesma transacao. Atualiza
        // as tres visoes imediatamente, sem depender da latencia do Realtime.
        const related = await Promise.all(
          ["filaments", "stock_movements"].map(async (collection) => [
            collection,
            await fetchCollection(collection, user.id),
          ]),
        );
        for (const [collection, rows] of related) {
          await cache.setSnapshot(collection, rows);
          for (const row of rows) notifyCachedChange(collection, row);
        }
      }
    }
  }

  async function loadLegacyCloud() {
    const { user } = await requireContext();
    if (!isOnline()) throw new OfflineError("Conecte-se para criar o snapshot legado da nuvem.");
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    let query = supabaseClient
      .from("precificador_dados")
      .select("chave,valor,updated_at")
      .eq("user_id", user.id);
    if (controller && typeof query.abortSignal === "function") query = query.abortSignal(controller.signal);
    const { data, error } = await withTimeout(query, REMOTE_TIMEOUT_MS, () => controller?.abort());
    if (error) {
      // Instalacoes novas podem nunca ter usado a tabela snapshot da V3.
      if (error.code === "42P01" || error.code === "PGRST205") return [];
      throw asRepositoryError(error, "ler o backup V3 da nuvem");
    }
    return data || [];
  }

  async function rpc(name, args = {}) {
    const { user, cache } = await requireContext();
    const operationId = String(
      args.p_operation_id || args.operation_id || semanticRpcKey(name, args, user.id),
    );
    if (name === "migrate_legacy_v3" && !isOnline()) {
      throw new OfflineError("A migracao precisa de internet e nao pode ficar na fila offline.");
    }
    if (!isOnline()) {
      const alreadyQueued = (await cache.listQueue()).find(
        (operation) => operation.kind === "rpc" && operation.idempotencyKey === operationId,
      );
      if (alreadyQueued && !["save_order", "save_filament"].includes(name)) {
        await updatePendingStatus(SYNC_STATUS.OFFLINE);
        return { queued: true, operationId, deduplicated: true };
      }
      if (alreadyQueued && ["save_order", "save_filament"].includes(name)) {
        args = {
          ...args,
          p_expected_version: alreadyQueued.args?.p_expected_version ?? args.p_expected_version,
        };
      }
      await projectRpc(cache, name, args, user.id, operationId);
      await queueOperation(cache, {
        kind: "rpc",
        name,
        args,
        idempotencyKey: operationId,
        critical: CRITICAL_RPCS.has(name),
      });
      return { queued: true, operationId };
    }
    try {
      const data = await remoteRpc(name, args);
      await applyRpcResult(cache, user, name, args, data);
      await updatePendingStatus(null, { message: null, error: null });
      return data;
    } catch (error) {
      if (isNetworkError(error)) {
        if (name === "migrate_legacy_v3") {
          throw new OfflineError(
            "A conexao caiu durante a migracao. Nenhuma migracao foi enfileirada; tente novamente online.",
            { cause: error },
          );
        }
        await projectRpc(cache, name, args, user.id, operationId);
        await queueOperation(cache, {
          kind: "rpc",
          name,
          args,
          idempotencyKey: operationId,
          critical: CRITICAL_RPCS.has(name),
          lastError: error?.message || String(error),
        });
        return { queued: true, operationId };
      }
      if (error?.code === "P0001" || error?.code === "40001") {
        const conflict = new ConflictError(error.message, { cause: error, details: error.details });
        emitStatus(SYNC_STATUS.CONFLICT, { message: conflict.message, error: conflict.message });
        throw conflict;
      }
      throw asRepositoryError(error, `executar ${name}`);
    }
  }

  async function remoteUpload(operation, userId) {
    const { file, path, attachment } = operation;
    const { error: uploadError } = await withTimeout(supabaseClient.storage
      .from(attachmentBucket)
      .upload(path, file, {
        cacheControl: "3600",
        contentType: attachment.mime_type || file?.type || "application/octet-stream",
        upsert: true,
      }), REMOTE_TIMEOUT_MS);
    if (uploadError) throw uploadError;
    return remoteUpsert("attachments", attachment, userId);
  }

  async function uploadAttachment(file, userId, orderId, kind = null, options = {}) {
    const { user, cache } = await requireContext();
    if (!file || typeof file !== "object") throw new TypeError("Selecione um arquivo valido.");
    if (Number(file.size) > MAX_ATTACHMENT_BYTES) {
      throw new RepositoryError("O arquivo deve ter no maximo 8 MB.", { code: "FILE_TOO_LARGE" });
    }
    if (String(userId) !== String(user.id)) {
      throw new AuthenticationError("A conta ativa nao corresponde ao proprietario do arquivo.");
    }
    const id = options.id || options.idempotencyKey || uuid();
    const ownerFolder = orderId || "studio";
    const path = `${user.id}/${ownerFolder}/${id}-${safeFileName(file.name)}`;
    const attachment = {
      id,
      user_id: user.id,
      order_id: orderId,
      legacy_id: options.legacyId || null,
      kind: kind || attachmentKind(file),
      storage_bucket: attachmentBucket,
      storage_path: path,
      file_name: String(file.name || "arquivo"),
      mime_type: String(file.type || "application/octet-stream"),
      size_bytes: Number(file.size) || 0,
      created_at: new Date().toISOString(),
      deleted_at: null,
    };
    const operation = { kind: "upload", path, file, attachment, idempotencyKey: id };

    if (!isOnline()) {
      await cache.upsertSnapshot("attachments", { ...attachment, _sync_status: "pending" });
      await queueOperation(cache, operation);
      return { ...attachment, _sync_status: "pending", _operation_id: id };
    }
    try {
      const saved = await remoteUpload(operation, user.id);
      await cache.upsertSnapshot("attachments", saved);
      await updatePendingStatus(null, { message: null, error: null });
      return saved;
    } catch (error) {
      if (isNetworkError(error)) {
        await cache.upsertSnapshot("attachments", { ...attachment, _sync_status: "pending" });
        await queueOperation(cache, { ...operation, lastError: error?.message || String(error) });
        return { ...attachment, _sync_status: "pending", _operation_id: id };
      }
      throw asRepositoryError(error, "enviar o anexo");
    }
  }

  async function getAttachmentUrl(storagePath, expiresIn = 600) {
    await requireContext();
    if (!storagePath) return null;
    const { data, error } = await withTimeout(supabaseClient.storage
      .from(attachmentBucket)
      .createSignedUrl(storagePath, Math.max(60, Number(expiresIn) || 600)), REMOTE_TIMEOUT_MS);
    if (error) throw asRepositoryError(error, "abrir o anexo");
    return data?.signedUrl || data?.signedURL || null;
  }

  async function executeQueued(operation, user, cache) {
    if (operation.kind === "upsert") {
      const saved = await remoteUpsert(operation.collection, operation.row, user.id);
      await cache.upsertSnapshot(operation.collection, saved, {
        idField: operation.collection === "settings" ? "user_id" : "id",
      });
      return saved;
    }
    if (operation.kind === "remove") {
      return remoteRemove(operation.collection, operation.id, user.id);
    }
    if (operation.kind === "rpc") {
      const data = await remoteRpc(operation.name, operation.args);
      await applyRpcResult(cache, user, operation.name, operation.args, data);
      return data;
    }
    if (operation.kind === "upload") {
      const saved = await remoteUpload(operation, user.id);
      await cache.upsertSnapshot("attachments", saved);
      return saved;
    }
    throw new RepositoryError(`Operacao offline desconhecida: ${operation.kind}.`, {
      code: "UNKNOWN_QUEUE_OPERATION",
    });
  }

  async function replayQueue() {
    if (replayPromise) return replayPromise;
    replayPromise = (async () => {
      const { user, cache } = await requireContext();
      const operations = await cache.listQueue();
      if (!operations.length) {
        await updatePendingStatus(!isOnline() ? SYNC_STATUS.OFFLINE : SYNC_STATUS.SYNCHRONIZED, {
          message: null,
          error: null,
        });
        return { replayed: 0, remaining: 0 };
      }
      if (!isOnline()) {
        await updatePendingStatus(SYNC_STATUS.OFFLINE);
        return { replayed: 0, remaining: operations.length };
      }

      emitStatus(SYNC_STATUS.PENDING, { pending: operations.length, message: "Sincronizando alteracoes pendentes..." });
      let replayed = 0;
      for (const operation of operations) {
        try {
          await executeQueued(operation, user, cache);
          await cache.dequeue(operation.idempotencyKey);
          replayed += 1;
        } catch (error) {
          await cache.markAttempt(operation.idempotencyKey, error);
          if (isNetworkError(error)) {
            await updatePendingStatus(SYNC_STATUS.OFFLINE, { error: error?.message || String(error) });
            break;
          }
          const conflict = error instanceof ConflictError || error?.code === "40001" || error?.code === "P0001";
          await updatePendingStatus(SYNC_STATUS.CONFLICT, {
            message: conflict
              ? "Ha uma alteracao que precisa ser revisada antes de sincronizar."
              : "Uma alteracao pendente nao pode ser aplicada.",
            error: error?.message || String(error),
          });
          break;
        }
      }
      const remaining = await cache.countQueue();
      if (!remaining) await updatePendingStatus(SYNC_STATUS.SYNCHRONIZED, { message: null, error: null });
      return { replayed, remaining };
    })();
    try {
      return await replayPromise;
    } finally {
      replayPromise = null;
    }
  }

  async function listPendingOperations() {
    const { cache } = await requireContext();
    return cache.listQueue();
  }

  async function discardPendingOperations() {
    const { user, cache } = await requireContext();
    if (!isOnline()) {
      throw new OfflineError("Conecte-se antes de descartar pendencias e restaurar os dados da nuvem.");
    }
    const operations = await cache.listQueue();
    if (!operations.length) {
      await updatePendingStatus(SYNC_STATUS.SYNCHRONIZED, { message: null, error: null });
      return { discarded: 0, snapshot: await cache.getAllSnapshots(allowedCollections) };
    }

    // Primeiro confirma que a fonte remota esta acessivel. Se a leitura falhar,
    // a fila permanece intacta e nenhuma alteracao local e perdida.
    const snapshot = await withTimeout(refreshCacheFromCloud(user, cache), REMOTE_TIMEOUT_MS);
    await Promise.all(operations.map((operation) => cache.dequeue(operation.idempotencyKey)));
    await updatePendingStatus(SYNC_STATUS.SYNCHRONIZED, { message: null, error: null });
    return { discarded: operations.length, snapshot };
  }

  async function applyRealtimeChange(collection, payload, subscribedUserId) {
    // Um ultimo evento do canal antigo pode chegar durante uma troca de conta.
    // Nunca permita que esse evento seja gravado no cache da nova sessao.
    if (!currentCache || payload.errors?.length || String(currentUser?.id) !== String(subscribedUserId)) return;
    const event = String(payload.eventType || "").toUpperCase();
    const rowRaw = payload.new && Object.keys(payload.new).length ? payload.new : null;
    const oldRowRaw = payload.old && Object.keys(payload.old).length ? payload.old : null;
    const payloadOwner = rowRaw?.user_id ?? oldRowRaw?.user_id;
    if (payloadOwner != null && String(payloadOwner) !== String(subscribedUserId)) return;
    const row = rowRaw ? fromDatabaseRow(collection, rowRaw) : null;
    const oldRow = oldRowRaw ? fromDatabaseRow(collection, oldRowRaw) : null;

    const deletedId = collection === "settings" ? oldRow?.user_id : oldRow?.id;
    if (event === "DELETE" && deletedId != null) {
      await currentCache.removeSnapshotRow(collection, deletedId, {
        idField: collection === "settings" ? "user_id" : "id",
      });
    } else if (row) {
      await currentCache.upsertSnapshot(collection, row, {
        idField: collection === "settings" ? "user_id" : "id",
      });
    }

    const pending = await currentCache.listQueue();
    const recordId = row?.id ?? oldRow?.id ?? row?.user_id;
    const localOperation = pending.find(
      (operation) =>
        operation.kind === "upsert" &&
        operation.collection === collection &&
        String(operation.row?.id ?? operation.row?.user_id) === String(recordId),
    );
    if (localOperation && Number(row?.version) > Number(localOperation.row?.version || 0) + 1) {
      emitStatus(SYNC_STATUS.CONFLICT, {
        pending: pending.length,
        message: "O mesmo registro foi alterado em outro aparelho.",
        error: `${collection}:${recordId}`,
      });
    }

    const change = {
      collection,
      table: collection,
      event,
      eventType: event,
      type: event,
      row,
      record: row,
      new: row,
      old: oldRow,
      commitTimestamp: payload.commit_timestamp || null,
    };
    for (const listener of changeListeners) {
      try {
        listener(change);
      } catch (error) {
        console.error("Falha no observador de dados.", error);
      }
    }
  }

  function stopRealtime() {
    if (realtimeChannel) {
      try {
        supabaseClient.removeChannel(realtimeChannel);
      } catch {
        realtimeChannel.unsubscribe?.();
      }
    }
    realtimeChannel = null;
    realtimeUserId = null;
  }

  async function ensureRealtime() {
    const { user } = await requireContext();
    if (realtimeChannel && realtimeUserId === user.id) return realtimeChannel;
    stopRealtime();
    let channel = supabaseClient.channel(`precificador-v4-${user.id}`);
    for (const collection of allowedCollections) {
      channel = channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table: collection, filter: `user_id=eq.${user.id}` },
        (payload) => void applyRealtimeChange(collection, payload, user.id),
      );
    }
    realtimeChannel = channel.subscribe((channelStatus) => {
      if (channelStatus === "SUBSCRIBED") void updatePendingStatus(null, { error: null });
      if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(channelStatus) && !disposed) {
        void updatePendingStatus(!isOnline() ? SYNC_STATUS.OFFLINE : SYNC_STATUS.PENDING, {
          message: "A atualizacao em tempo real sera reconectada.",
          error: channelStatus,
        });
      }
    });
    realtimeUserId = user.id;
    return realtimeChannel;
  }

  async function subscribe(onChange) {
    if (typeof onChange !== "function") throw new TypeError("onChange deve ser uma funcao.");
    changeListeners.add(onChange);
    await ensureRealtime();
    return () => {
      changeListeners.delete(onChange);
      if (!changeListeners.size) stopRealtime();
    };
  }

  function handleOnline() {
    if (currentUser) void replayQueue();
  }

  function handleOffline() {
    void updatePendingStatus(SYNC_STATUS.OFFLINE, { message: "Sem internet; alteracoes ficarao neste aparelho." });
  }

  globalThis.addEventListener?.("online", handleOnline);
  globalThis.addEventListener?.("offline", handleOffline);

  const authSubscription = supabaseClient.auth.onAuthStateChange?.((_event, session) => {
    void switchUser(session?.user || null);
  });

  function dispose() {
    disposed = true;
    stopRealtime();
    changeListeners.clear();
    globalThis.removeEventListener?.("online", handleOnline);
    globalThis.removeEventListener?.("offline", handleOffline);
    authSubscription?.data?.subscription?.unsubscribe?.();
    authSubscription?.subscription?.unsubscribe?.();
    currentCache?.close?.();
    currentCache = null;
    currentUser = null;
  }

  return Object.freeze({
    signIn,
    signUp,
    signOut,
    getSession,
    loadAll,
    loadCached,
    loadLegacyCloud,
    upsert,
    remove,
    rpc,
    subscribe,
    uploadAttachment,
    getAttachmentUrl,
    replayQueue,
    listPendingOperations,
    discardPendingOperations,
    getStatus: () => ({ ...status }),
    dispose,
  });
}
