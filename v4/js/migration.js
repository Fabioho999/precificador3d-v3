import { normalizeOrderStatuses, normalizeQuoteItem } from "./domain.js";

/** Chaves de dados conhecidas da V3. Outras chaves fh3d_* entram no backup, mas nao sao importadas. */
export const LEGACY_KEYS = Object.freeze([
  "fh3d_config",
  "fh3d_custos",
  "fh3d_estoque",
  "fh3d_calibracoes",
  "fh3d_prazos",
  "fh3d_orcamentos",
  "fh3d_logo",
  "fh3d_despesas",
  "fh3d_despesas_fixas",
  "fh3d_catalogo_custom",
]);

const COLLECTIONS = Object.freeze([
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

const PRODUCTION_FROM_DEADLINE = Object.freeze({
  PENDENTE: "pendente",
  PRODUCAO: "em_producao",
  EM_PRODUCAO: "em_producao",
  PRONTO: "pronto",
  ENVIADO: "enviado",
  ENTREGUE: "entregue",
});

function getStorage(storage) {
  const resolved = storage ?? globalThis.localStorage;
  if (!resolved) throw new Error("localStorage nao esta disponivel.");
  return resolved;
}

function allStorageKeys(storage) {
  const keys = [];
  for (let index = 0; index < Number(storage.length || 0); index += 1) {
    const key = storage.key(index);
    if (key != null) keys.push(String(key));
  }
  return keys;
}

function parseStoredValue(key, raw) {
  if (raw == null) return { value: null, valid: true, error: null };
  if (key === "fh3d_logo") return { value: raw, valid: true, error: null };
  try {
    return { value: JSON.parse(raw), valid: true, error: null };
  } catch (error) {
    return { value: raw, valid: false, error: error.message };
  }
}

/** Retorna true somente para chaves V3 importaveis; marcadores da V4 nao contam. */
export function hasLegacyData(storage = globalThis.localStorage) {
  if (!storage) return false;
  return LEGACY_KEYS.some((key) => storage.getItem(key) != null);
}

/**
 * Le todas as chaves fh3d_* sem altera-las. Valores JSON invalidos sao
 * preservados em `raw` e listados em `parseErrors`.
 */
export function detectLegacyData(storage = globalThis.localStorage) {
  storage = getStorage(storage);
  const keys = allStorageKeys(storage).filter((key) => key.startsWith("fh3d_")).sort();
  const data = {};
  const raw = {};
  const parseErrors = [];
  for (const key of keys) {
    const stored = storage.getItem(key);
    raw[key] = stored;
    const parsed = parseStoredValue(key, stored);
    data[key] = parsed.value;
    if (!parsed.valid) parseErrors.push({ key, message: parsed.error });
  }
  return { found: LEGACY_KEYS.some((key) => keys.includes(key)), keys, data, raw, parseErrors };
}

/** Inicia o download do backup quando existe DOM; em testes/worker apenas retorna false. */
export function downloadLegacyBackup(backup, filename = `precificador-v3-backup-${Date.now()}.json`) {
  if (!globalThis.document?.createElement || !globalThis.URL?.createObjectURL) return false;
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.hidden = true;
  document.body?.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
  return true;
}

/**
 * Cria a parte local do backup. `migrateLegacyData` acrescenta o snapshot V3 da
 * nuvem e o snapshot V4 e baixa o arquivo completo antes da primeira escrita.
 */
export function createLegacyBackup({ storage = globalThis.localStorage, download = false } = {}) {
  const detected = detectLegacyData(storage);
  const backup = {
    format: "fh3d-v3-local-storage",
    version: 1,
    exported_at: new Date().toISOString(),
    origin: globalThis.location?.href || null,
    keys: detected.keys,
    data: detected.data,
    raw: detected.raw,
    parse_errors: detected.parseErrors,
  };
  if (download) downloadLegacyBackup(backup);
  return backup;
}

function number(value, fallback = 0) {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().replace(/R\$/gi, "").replace(/\s/g, "");
  const parsed = Number(normalized.includes(",") ? normalized.replace(/\./g, "").replace(",", ".") : normalized);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function positive(value, fallback = 0) {
  return Math.max(0, number(value, fallback));
}

function text(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function legacyData(backup) {
  if (backup?.combined_data && typeof backup.combined_data === "object") return backup.combined_data;
  if (backup?.data && typeof backup.data === "object") return backup.data;
  if (backup?.keys && !Array.isArray(backup.keys)) {
    return Object.fromEntries(
      Object.entries(backup.keys).map(([key, entry]) => [key, entry?.value ?? entry]),
    );
  }
  return {};
}

function cloudRowsToData(rows) {
  const result = {};
  const timestamps = new Map();
  for (const row of array(rows)) {
    if (!row?.chave) continue;
    const updatedAt = timestampValue(row.updated_at);
    if (result[row.chave] !== undefined && updatedAt < (timestamps.get(row.chave) || 0)) continue;
    let value = row.valor;
    if (typeof value === "string" && row.chave !== "fh3d_logo") {
      try { value = JSON.parse(value); } catch {}
    }
    result[row.chave] = value;
    timestamps.set(row.chave, updatedAt);
  }
  return result;
}

function timestampValue(value) {
  if (value == null || value === "") return 0;
  const parsed = value instanceof Date ? value : new Date(value);
  const milliseconds = parsed.getTime();
  return Number.isFinite(milliseconds) ? milliseconds : 0;
}

function recordTimestamp(value, fallback = 0) {
  if (!value || typeof value !== "object") return fallback;
  return timestampValue(
    value.updated_at ?? value.updatedAt ?? value.modified_at ?? value.created_at ?? value.data,
  ) || fallback;
}

function distinctValues(left, right) {
  try {
    return JSON.stringify(left) !== JSON.stringify(right);
  } catch {
    return left !== right;
  }
}

function mergeLegacyArrays(localRows, cloudRows, cloudSnapshotTime, key, decisions) {
  const merged = [];
  const positions = new Map();
  const origins = new Map();

  function add(row, origin) {
    if (!row || typeof row !== "object" || row.id == null) {
      merged.push(row);
      return;
    }
    const identity = String(row.id);
    if (!positions.has(identity)) {
      positions.set(identity, merged.length);
      origins.set(identity, origin);
      merged.push(row);
      return;
    }
    const index = positions.get(identity);
    const current = merged[index];
    const currentOrigin = origins.get(identity);
    const currentTime = recordTimestamp(current, currentOrigin === "cloud" ? cloudSnapshotTime : 0);
    const candidateTime = recordTimestamp(row, origin === "cloud" ? cloudSnapshotTime : 0);
    // O snapshot compartilhado vence somente no empate; timestamps explicitos
    // do registro sempre prevalecem, independentemente da origem.
    if (candidateTime > currentTime || (candidateTime === currentTime && origin === "cloud")) {
      merged[index] = row;
      origins.set(identity, origin);
    }
    if (distinctValues(current, row)) {
      decisions.push({
        key,
        id: identity,
        chosen: origins.get(identity),
        localTimestamp: origin === "local" ? candidateTime : currentTime,
        cloudTimestamp: origin === "cloud" ? candidateTime : currentTime,
      });
    }
  }

  array(localRows).forEach((row) => add(row, "local"));
  array(cloudRows).forEach((row) => add(row, "cloud"));
  return merged;
}

function mergeLegacySources(local, cloud, cloudRows = [], decisions = []) {
  const merged = {};
  const cloudTimes = new Map();
  for (const row of array(cloudRows)) {
    const key = String(row?.chave || "");
    cloudTimes.set(key, Math.max(cloudTimes.get(key) || 0, timestampValue(row?.updated_at)));
  }
  const keys = new Set([...Object.keys(cloud || {}), ...Object.keys(local || {})]);
  for (const key of keys) {
    const localValue = local?.[key];
    const cloudValue = cloud?.[key];
    const cloudTime = cloudTimes.get(key) || 0;
    if (Array.isArray(localValue) || Array.isArray(cloudValue)) {
      merged[key] = mergeLegacyArrays(localValue, cloudValue, cloudTime, key, decisions);
    } else if (
      localValue && typeof localValue === "object" &&
      cloudValue && typeof cloudValue === "object"
    ) {
      const localTime = recordTimestamp(localValue);
      const resolvedCloudTime = recordTimestamp(cloudValue, cloudTime);
      const cloudIsNewer = resolvedCloudTime >= localTime;
      merged[key] = cloudIsNewer
        ? { ...localValue, ...cloudValue }
        : { ...cloudValue, ...localValue };
      if (distinctValues(localValue, cloudValue)) {
        decisions.push({ key, chosen: cloudIsNewer ? "cloud" : "local", localTimestamp: localTime, cloudTimestamp: resolvedCloudTime });
      }
    } else if (key !== "fh3d_logo" && cloudValue && typeof cloudValue === "object" && typeof localValue !== "object") {
      merged[key] = cloudValue;
    } else {
      const bothExist = localValue != null && cloudValue != null;
      const localTime = recordTimestamp(localValue);
      const cloudIsNewer = cloudTime >= localTime;
      merged[key] = bothExist ? (cloudIsNewer ? cloudValue : localValue) : (localValue ?? cloudValue);
      if (bothExist && distinctValues(localValue, cloudValue)) {
        decisions.push({ key, chosen: cloudIsNewer ? "cloud" : "local", localTimestamp: localTime, cloudTimestamp: cloudTime });
      }
    }
  }
  return merged;
}

function timestampFromLegacyId(value) {
  const candidate = Number(value);
  if (!Number.isFinite(candidate) || candidate < 946684800000 || candidate > 4102444800000) return null;
  return new Date(candidate);
}

function iso(value, fallback) {
  let date = value instanceof Date ? value : null;
  if (!date && value != null && value !== "") {
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) date = new Date(`${value}T12:00:00-03:00`);
    else date = new Date(value);
  }
  if (!date || Number.isNaN(date.getTime())) date = fallback instanceof Date ? fallback : new Date(fallback || Date.now());
  return date.toISOString();
}

function dateOnly(value) {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return String(value);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(parsed);
}

function addDays(value, days) {
  const base = dateOnly(value);
  if (!base || !Number.isFinite(Number(days)) || Number(days) <= 0) return null;
  const parsed = new Date(`${base}T12:00:00-03:00`);
  parsed.setUTCDate(parsed.getUTCDate() + Math.round(Number(days)));
  return dateOnly(parsed);
}

// cyrb128 produz IDs UUID deterministas sem depender de crypto.subtle.
function hash128(value) {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    h1 = h2 ^ Math.imul(h1 ^ code, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ code, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ code, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ code, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [h1 ^ h2 ^ h3 ^ h4, h2 ^ h1, h3 ^ h1, h4 ^ h1].map((part) => part >>> 0);
}

/** UUID estavel: repetir a migracao gera exatamente as mesmas chaves. */
export function legacyUuid(userId, namespace, legacyId) {
  const words = hash128(`${userId}:${namespace}:${legacyId}`);
  const hex = words.map((word) => word.toString(16).padStart(8, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function latestLegacyRows(rows, namespace, report) {
  const byKey = new Map();
  rows.forEach((row, index) => {
    if (!row || typeof row !== "object") {
      report.rejected += 1;
      if (report.byCollection?.[namespace]) report.byCollection[namespace].rejected += 1;
      report.errors.push({ collection: namespace, legacyIndex: index, message: "Registro legado invalido." });
      return;
    }
    const key = String(row.id ?? `${namespace}:${index}`);
    const current = byKey.get(key);
    if (!current) {
      byKey.set(key, row);
      return;
    }
    const currentTime = new Date(current.updated_at || current.data || 0).getTime() || 0;
    const candidateTime = new Date(row.updated_at || row.data || 0).getTime() || 0;
    if (candidateTime >= currentTime) byKey.set(key, row);
    report.corrected += 1;
    if (report.byCollection?.[namespace]) report.byCollection[namespace].corrected += 1;
    report.warnings.push(`${namespace}: duplicata ${key} consolidada.`);
  });
  return [...byKey.entries()].map(([legacyId, row]) => ({ legacyId, row }));
}

function existingByLegacy(rows) {
  const map = new Map();
  for (const row of array(rows)) {
    if (row?.legacy_id != null) map.set(String(row.legacy_id), row);
  }
  return map;
}

function existingKeys(rows) {
  const keys = new Set();
  for (const row of array(rows)) {
    if (row?.id != null) keys.add(`id:${row.id}`);
    if (row?.legacy_id != null) keys.add(`legacy:${row.legacy_id}`);
    if (row?.idempotency_key) keys.add(`operation:${row.idempotency_key}`);
  }
  return keys;
}

function mergeCollection(currentRows, importedRows, report, collection) {
  const result = [...array(currentRows)];
  const keys = existingKeys(result);
  const pending = [];
  for (const row of importedRows) {
    const duplicate =
      (row.id != null && keys.has(`id:${row.id}`)) ||
      (row.legacy_id != null && keys.has(`legacy:${row.legacy_id}`)) ||
      (row.idempotency_key && keys.has(`operation:${row.idempotency_key}`));
    if (duplicate) {
      report.skipped += 1;
      report.byCollection[collection].skipped += 1;
      continue;
    }
    result.push(row);
    pending.push(row);
    if (row.id != null) keys.add(`id:${row.id}`);
    if (row.legacy_id != null) keys.add(`legacy:${row.legacy_id}`);
    if (row.idempotency_key) keys.add(`operation:${row.idempotency_key}`);
  }
  return { result, pending };
}

function statusFromDeadline(deadline, legacyOrder) {
  const raw = String(deadline?.status || "").trim().toUpperCase().replace(/[\s-]+/g, "_");
  const domain = normalizeOrderStatuses(legacyOrder);
  let commercial = domain.commercialStatus;
  let production = PRODUCTION_FROM_DEADLINE[raw] || domain.productionStatus;
  let payment = domain.paymentStatus;
  if (raw === "CANCELADO" || String(legacyOrder.status || "").toUpperCase() === "CANCELADO") {
    commercial = "cancelado";
    if (!PRODUCTION_FROM_DEADLINE[raw]) production = "pendente";
  } else if (production !== "pendente" || payment === "pago") {
    commercial = "aprovado";
  }
  if (legacyOrder.pago === true || String(legacyOrder.status || "").toUpperCase() === "PAGO") payment = "pago";
  return { commercial, production, payment };
}

function itemConsumption(legacyOrder, filamentIds) {
  const entries = array(legacyOrder.consumoEstoque).length
    ? legacyOrder.consumoEstoque.map((entry) => ({
        filamentId: entry.filamentoId ?? entry.filamentId,
        grams: positive(entry.gramas ?? entry.grams),
      }))
    : array(legacyOrder.itens).map((raw) => {
        const item = normalizeQuoteItem(raw);
        return { filamentId: raw.filamentoId ?? raw.filamentId, grams: positive(item.unitWeightG) * Math.max(1, number(item.quantity, 1)) };
      });
  const totals = new Map();
  for (const entry of entries) {
    const resolved = filamentIds.get(String(entry.filamentId));
    if (!resolved || entry.grams <= 0) continue;
    totals.set(resolved, (totals.get(resolved) || 0) + entry.grams);
  }
  return totals;
}

function emptyData(currentData = {}) {
  return Object.fromEntries(COLLECTIONS.map((collection) => [collection, [...array(currentData[collection])]]));
}

/**
 * Transformacao pura da V3 para o contrato V4 consumido pela interface.
 * `pending` contem somente linhas que ainda precisam ser gravadas.
 */
export function transformLegacyData({ backup, userId, currentData = {}, now = new Date() } = {}) {
  if (!userId) throw new TypeError("userId e obrigatorio para migrar.");
  const source = legacyData(backup);
  const report = {
    startedAt: iso(now, new Date()),
    completedAt: null,
    imported: 0,
    corrected: 0,
    rejected: 0,
    skipped: 0,
    warnings: [],
    errors: [],
    byCollection: Object.fromEntries(COLLECTIONS.map((name) => [name, { imported: 0, corrected: 0, skipped: 0, rejected: 0 }])),
    reconciliation: { releasedPendingGrams: 0, preservedProductionGrams: 0 },
  };
  for (const parseError of array(backup?.parse_errors)) {
    report.rejected += 1;
    report.errors.push({ collection: "backup", key: parseError.key, message: parseError.message });
  }
  const data = emptyData(currentData);
  const pending = Object.fromEntries(COLLECTIONS.map((collection) => [collection, []]));
  const assets = { logo: null, photos: [] };
  const migrationTime = now instanceof Date ? now : new Date(now);

  // Configuracoes e custos eram dois documentos na V3 e agora formam uma linha.
  const config = source.fh3d_config && typeof source.fh3d_config === "object" ? source.fh3d_config : {};
  const costs = source.fh3d_custos && typeof source.fh3d_custos === "object" ? source.fh3d_custos : {};
  const settings = {
    user_id: userId,
    studio_name: text(config.nome, "Studio FH3D"),
    whatsapp: text(config.whatsapp),
    email: text(config.email),
    instagram: text(config.instagram),
    pix_key: text(config.pixChave),
    pix_type: text(config.pixTipo, "cpf"),
    pix_holder: text(config.pixTitular),
    filament_cost_kg: positive(costs.custoFilamento, 95),
    energy_kwh: positive(costs.tarifaEnergia, 0.85),
    k1c_kw: positive(costs.consumoK1C, 0.25),
    kobra_kw: positive(costs.consumoKobra, 0.3),
    depreciation_hour: positive(costs.depreciacao, 2.5),
    maintenance_hour: positive(costs.manutencao, 0.5),
    profit_percent: positive(costs.lucroPadrao, 30),
    packaging_cost: positive(costs.embalagem, 10),
    modification_terms: text(config.textoMod),
    validity_terms: text(config.textoVal),
    general_notes: text(config.textoObs),
    data: { source: "v3" },
    created_at: iso(config.created_at, migrationTime),
    updated_at: iso(config.updated_at, migrationTime),
  };
  if (!data.settings.length) {
    data.settings.push(settings);
    pending.settings.push(settings);
  } else {
    const current = data.settings[0];
    const merged = { ...current };
    for (const [key, legacyValue] of Object.entries(settings)) {
      const currentValue = current[key];
      const empty = currentValue == null || currentValue === "" ||
        (typeof currentValue === "number" && currentValue === 0 && Number(legacyValue) > 0);
      if (empty) merged[key] = legacyValue;
    }
    data.settings[0] = merged;
    pending.settings.push(merged);
    report.corrected += 1;
    report.byCollection.settings.corrected += 1;
    report.warnings.push("Configuracoes V3 mescladas com a linha V4 existente.");
  }
  if (typeof source.fh3d_logo === "string" && source.fh3d_logo.startsWith("data:")) assets.logo = source.fh3d_logo;

  // Filamentos recebem IDs deterministas e um mapa para os itens/pedidos.
  const currentFilaments = existingByLegacy(data.filaments);
  const filamentIds = new Map();
  const importedFilaments = [];
  const legacyFilaments = latestLegacyRows(array(source.fh3d_estoque), "filaments", report);
  for (const { legacyId, row } of legacyFilaments) {
    const existing = currentFilaments.get(String(legacyId));
    const id = existing?.id || legacyUuid(userId, "filament", legacyId);
    filamentIds.set(String(legacyId), id);
    importedFilaments.push({
      id,
      user_id: userId,
      legacy_id: String(legacyId),
      manufacturer: text(row.fabricante, "Sem fabricante"),
      color: text(row.cor, "Sem cor"),
      material: text(row.tipo ?? row.material, "PLA").toUpperCase(),
      initial_weight_g: positive(row.pesoInicial ?? row.peso),
      current_weight_g: positive(row.peso),
      price_kg: positive(row.preco),
      active: true,
      created_at: iso(row.data, timestampFromLegacyId(row.id) || migrationTime),
      updated_at: iso(row.updated_at ?? row.data, migrationTime),
      metadata: { source: "v3", calibration_count: positive(row.calibracoes) },
    });
  }

  const deadlines = latestLegacyRows(array(source.fh3d_prazos), "tasks", report);
  const deadlineByOrder = new Map();
  for (const entry of deadlines) {
    if (entry.row.orcId != null) deadlineByOrder.set(String(entry.row.orcId), entry.row);
  }

  const importedOrders = [];
  const importedItems = [];
  const consumptionMovements = [];
  const releaseByFilament = new Map();
  const activeConsumptionByFilament = new Map();
  const legacyOrders = latestLegacyRows(array(source.fh3d_orcamentos), "orders", report);
  const currentOrders = existingByLegacy(data.orders);
  for (const { legacyId, row } of legacyOrders) {
    // Uma migracao parcial antiga pode ter criado o pedido com outro UUID. Todo
    // o agregado precisa reutilizar esse ID para nunca produzir FKs orfas.
    const existingOrder = currentOrders.get(String(legacyId));
    const orderId = existingOrder?.id || legacyUuid(userId, "order", legacyId);
    const deadline = deadlineByOrder.get(String(legacyId));
    const statuses = statusFromDeadline(deadline, row);
    const createdAt = iso(row.data, timestampFromLegacyId(row.id) || migrationTime);
    const dueDate = dateOnly(deadline?.dataPrazo) || addDays(createdAt, number(row.prazo));
    const consumption = itemConsumption(row, filamentIds);
    const wasDeducted = row.estoqueBaixado === true;
    const productionStarted = ["em_producao", "pronto", "enviado", "entregue"].includes(statuses.production);
    const needsRelease = wasDeducted && (!productionStarted || statuses.commercial === "cancelado");

    if (needsRelease) {
      for (const [filamentId, grams] of consumption) {
        releaseByFilament.set(filamentId, (releaseByFilament.get(filamentId) || 0) + grams);
        report.reconciliation.releasedPendingGrams += grams;
      }
      report.corrected += 1;
      report.byCollection.filaments.corrected += 1;
    }
    if (productionStarted && statuses.commercial !== "cancelado") {
      for (const [filamentId, grams] of consumption) {
        activeConsumptionByFilament.set(filamentId, (activeConsumptionByFilament.get(filamentId) || 0) + grams);
        report.reconciliation.preservedProductionGrams += grams;
        const idempotencyKey = `migration:v3:consumption:${orderId}:${filamentId}:1`;
        consumptionMovements.push({
          id: legacyUuid(userId, "stock-movement", idempotencyKey),
          user_id: userId,
          filament_id: filamentId,
          order_id: orderId,
          movement_type: "consumption",
          quantity_g: -grams,
          stock_cycle: 1,
          idempotency_key: idempotencyKey,
          reason: "Migracao V3: consumo ja aplicado antes da migracao",
          created_at: iso(deadline?.data ?? row.data, migrationTime),
        });
      }
    }

    importedOrders.push({
      id: orderId,
      user_id: userId,
      legacy_id: String(legacyId),
      customer_name: text(row.cliente, "Cliente nao informado"),
      project: text(row.projeto, "Pedido migrado"),
      description: text(row.descricao),
      printer: text(row.impressora, "K1C"),
      due_date: dueDate,
      commercial_status: statuses.commercial,
      production_status: statuses.production,
      payment_status: statuses.payment,
      final_price: positive(row.precoFinal),
      total_cost: positive(row.custoBase),
      modeling_price: positive(row.modelagem),
      finishing_price: positive(row.pintura),
      discount: positive(row.desconto),
      paid_at: statuses.payment === "pago" ? iso(row.paid_at ?? row.dataPagamento ?? row.data, migrationTime) : null,
      stock_cycle: productionStarted && statuses.commercial !== "cancelado" ? 1 : 0,
      stock_consumed_at: productionStarted && statuses.commercial !== "cancelado" ? iso(deadline?.data ?? row.data, migrationTime) : null,
      stock_restored_at: null,
      created_at: createdAt,
      updated_at: iso(row.updated_at ?? deadline?.data ?? row.data, migrationTime),
      metadata: { source: "v3", legacy_stock_was_deducted: wasDeducted },
    });

    array(row.itens).forEach((rawItem, index) => {
      const item = normalizeQuoteItem(rawItem, index);
      const oldFilamentId = rawItem.filamentoId ?? rawItem.filamentId;
      const filamentId = filamentIds.get(String(oldFilamentId)) || null;
      if (oldFilamentId && !filamentId) {
        report.corrected += 1;
        report.byCollection.order_items.corrected += 1;
        report.warnings.push(`Pedido ${legacyId}: filamento ${oldFilamentId} nao encontrado.`);
      }
      importedItems.push({
        id: legacyUuid(userId, "order-item", `${legacyId}:${rawItem.id ?? index}`),
        user_id: userId,
        order_id: orderId,
        legacy_id: rawItem.id != null ? String(rawItem.id) : `${legacyId}:${index}`,
        name: text(item.name, `Item ${index + 1}`),
        quantity: Math.max(1, Math.round(number(item.quantity, 1))),
        unit_weight_g: positive(item.unitWeightG),
        print_hours: positive(item.printHours),
        material: text(item.material, "PLA"),
        filament_id: filamentId,
        filament_price_kg: positive(item.filamentPriceKg),
        sort_order: index,
        created_at: createdAt,
        updated_at: createdAt,
      });
    });

    array(row.fotos).forEach((dataUrl, index) => {
      if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:")) return;
      assets.photos.push({ orderId, dataUrl, index, name: `produto-${legacyId}-${index + 1}` });
    });
  }

  // A RPC importa o saldo anterior aos consumos ativos e aplica o ledger no mesmo
  // transaction. Assim o saldo final nao e descontado duas vezes.
  for (const filament of importedFilaments) {
    const release = releaseByFilament.get(filament.id) || 0;
    const activeConsumption = activeConsumptionByFilament.get(filament.id) || 0;
    filament.current_weight_g += release + activeConsumption;
    filament.initial_weight_g = Math.max(filament.initial_weight_g, filament.current_weight_g);
    if (release) filament.metadata = { ...filament.metadata, pending_reservations_released_g: release };
  }

  // Ledger inicia antes dos consumos preservados, de modo que a soma termine no saldo atual.
  const openingMovements = importedFilaments.flatMap((filament) => {
    const opening = filament.current_weight_g;
    if (!(opening > 0)) return [];
    const idempotencyKey = `migration:v3:opening:${filament.id}`;
    return [{
      id: legacyUuid(userId, "stock-movement", idempotencyKey),
      user_id: userId,
      filament_id: filament.id,
      order_id: null,
      movement_type: "opening",
      quantity_g: opening,
      balance_after_g: opening,
      stock_cycle: 0,
      idempotency_key: idempotencyKey,
      reason: "Migracao V3: saldo de abertura reconciliado",
      created_at: filament.created_at,
    }];
  });
  const runningBalances = new Map(importedFilaments.map((filament) => [filament.id, filament.current_weight_g]));
  for (const movement of consumptionMovements) {
    const balance = Math.max(0, (runningBalances.get(movement.filament_id) || 0) + movement.quantity_g);
    movement.balance_after_g = balance;
    runningBalances.set(movement.filament_id, balance);
  }

  const importedExpenses = latestLegacyRows(array(source.fh3d_despesas), "expenses", report).map(({ legacyId, row }) => ({
    id: legacyUuid(userId, "expense", legacyId),
    user_id: userId,
    legacy_id: String(legacyId),
    expense_date: dateOnly(row.data) || dateOnly(migrationTime),
    category: text(row.categoria, "Outros"),
    description: text(row.descricao, "Despesa migrada"),
    amount: positive(row.valor),
    created_at: iso(row.created_at ?? row.data, timestampFromLegacyId(row.id) || migrationTime),
  }));

  const importedRecurring = latestLegacyRows(array(source.fh3d_despesas_fixas), "recurring_expenses", report).map(({ legacyId, row }) => ({
    id: legacyUuid(userId, "recurring-expense", legacyId),
    user_id: userId,
    legacy_id: String(legacyId),
    description: text(row.nome ?? row.descricao, "Despesa fixa migrada"),
    category: text(row.categoria, "Fixa"),
    amount: positive(row.valor),
    day_of_month: Math.min(28, Math.max(1, Math.round(number(row.dia, 1)))),
    active: row.ativa !== false,
    created_at: iso(row.created_at, timestampFromLegacyId(row.id) || migrationTime),
  }));

  const importedCatalog = latestLegacyRows(array(source.fh3d_catalogo_custom), "catalog_products", report).map(({ legacyId, row }) => ({
    id: legacyUuid(userId, "catalog-product", legacyId),
    user_id: userId,
    legacy_id: String(legacyId),
    name: text(row.nome, "Produto migrado"),
    category: text(row.categoria),
    unit_weight_g: positive(row.peso),
    print_hours: positive(row.tempo),
    default_unit_price: positive(row.preco),
    material: text(row.material, "PLA"),
    suggested_price: positive(row.preco),
    active: true,
    created_at: iso(row.created_at, timestampFromLegacyId(row.id) || migrationTime),
  }));

  const importedCalibrations = [];
  const calibrations = source.fh3d_calibracoes && typeof source.fh3d_calibracoes === "object" ? source.fh3d_calibracoes : {};
  for (const [printer, values] of Object.entries(calibrations)) {
    array(values).forEach((row, index) => {
      const legacyId = `${printer}:${row.id ?? row.nome ?? index}`;
      importedCalibrations.push({
        id: legacyUuid(userId, "calibration", legacyId),
        user_id: userId,
        legacy_id: legacyId,
        name: text(row.nome, `Calibracao ${printer}`),
        printer: text(printer),
        material: text(row.material, "PLA"),
        temperature_c: positive(row.temp),
        layer_height_mm: positive(row.layer),
        speed_mm_s: positive(row.speed),
        nozzle_mm: positive(row.nozzle, 0.4),
        z_offset_mm: number(row.zoffset, 0),
        nozzle_diameter: positive(row.nozzle, 0.4),
        settings: { z_offset_mm: number(row.zoffset, 0) },
        created_at: iso(row.data, migrationTime),
      });
    });
  }

  const importedTasks = deadlines
    .filter(({ row }) => row.orcId == null)
    .map(({ legacyId, row }) => {
      const rawStatus = String(row.status || "PENDENTE").toUpperCase();
      return {
        id: legacyUuid(userId, "task", legacyId),
        user_id: userId,
        legacy_id: String(legacyId),
        title: text(row.projeto, "Prazo migrado"),
        notes: [row.cliente, row.descricao].filter(Boolean).join(" - "),
        due_date: dateOnly(row.dataPrazo),
        status: rawStatus === "ENTREGUE" ? "done" : rawStatus === "CANCELADO" ? "cancelled" : rawStatus === "PRODUCAO" ? "in_progress" : "pending",
        completed_at: rawStatus === "ENTREGUE" ? iso(row.updated_at ?? row.data, migrationTime) : null,
        created_at: iso(row.data, timestampFromLegacyId(row.id) || migrationTime),
      };
    });

  const candidates = {
    filaments: importedFilaments,
    orders: importedOrders,
    order_items: importedItems,
    stock_movements: [...openingMovements, ...consumptionMovements],
    expenses: importedExpenses,
    recurring_expenses: importedRecurring,
    catalog_products: importedCatalog,
    calibrations: importedCalibrations,
    tasks: importedTasks,
    attachments: [],
  };

  for (const [collection, rows] of Object.entries(candidates)) {
    const merged = mergeCollection(data[collection], rows, report, collection);
    data[collection] = merged.result;
    pending[collection].push(...merged.pending);
  }

  report.completedAt = new Date().toISOString();
  return { data, pending, assets, report };
}

function dataUrlToFile(dataUrl, name) {
  const [header, encoded = ""] = String(dataUrl).split(",", 2);
  const mime = header.match(/^data:([^;,]+)/)?.[1] || "image/jpeg";
  let bytes;
  if (header.includes(";base64")) {
    const binary = atob(encoded);
    bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } else {
    bytes = new TextEncoder().encode(decodeURIComponent(encoded));
  }
  const extension = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
  if (typeof File === "function") return new File([bytes], `${name}.${extension}`, { type: mime });
  const blob = new Blob([bytes], { type: mime });
  Object.defineProperty(blob, "name", { value: `${name}.${extension}` });
  return blob;
}

function namedFile(blob, name, type = blob.type) {
  const extension = type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
  if (typeof File === "function") return new File([blob], `${name}.${extension}`, { type });
  const copy = blob.slice(0, blob.size, type);
  Object.defineProperty(copy, "name", { value: `${name}.${extension}` });
  return copy;
}

async function canvasBlob(canvas, quality) {
  if (typeof canvas.convertToBlob === "function") {
    return canvas.convertToBlob({ type: "image/webp", quality });
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error("O navegador nao conseguiu comprimir a imagem.")),
      "image/webp",
      quality,
    );
  });
}

async function loadBitmap(blob) {
  if (typeof createImageBitmap === "function") return createImageBitmap(blob);
  if (typeof Image !== "function" || !globalThis.URL?.createObjectURL) {
    throw new Error("Este navegador nao oferece compressao de imagens grandes.");
  }
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Nao foi possivel decodificar a imagem legada."));
      image.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function prepareLegacyImage(dataUrl, name, maxBytes = 8 * 1024 * 1024) {
  const original = dataUrlToFile(dataUrl, name);
  const supportedMime = ["image/jpeg", "image/png", "image/webp"].includes(original.type);
  if (original.size <= maxBytes && supportedMime) {
    return { file: original, compressed: false, originalBytes: original.size };
  }
  const bitmap = await loadBitmap(original);
  try {
    const sourceWidth = bitmap.width || bitmap.naturalWidth;
    const sourceHeight = bitmap.height || bitmap.naturalHeight;
    if (!sourceWidth || !sourceHeight) throw new Error("Dimensoes da imagem legada invalidas.");
    let scale = Math.min(1, 1600 / Math.max(sourceWidth, sourceHeight));
    let best = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const width = Math.max(1, Math.round(sourceWidth * scale));
      const height = Math.max(1, Math.round(sourceHeight * scale));
      const canvas = typeof OffscreenCanvas === "function"
        ? new OffscreenCanvas(width, height)
        : globalThis.document?.createElement?.("canvas");
      if (!canvas) throw new Error("Canvas indisponivel para comprimir a imagem legada.");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { alpha: true });
      if (!context) throw new Error("Canvas 2D indisponivel.");
      context.drawImage(bitmap, 0, 0, width, height);
      for (const quality of [0.82, 0.68, 0.52]) {
        const candidate = await canvasBlob(canvas, quality);
        if (!best || candidate.size < best.size) best = candidate;
        if (candidate.size <= maxBytes) {
          return { file: namedFile(candidate, name, "image/webp"), compressed: true, originalBytes: original.size };
        }
      }
      scale *= 0.72;
    }
    if (best?.size <= maxBytes) {
      return { file: namedFile(best, name, "image/webp"), compressed: true, originalBytes: original.size };
    }
    throw new Error("A imagem continua maior que 8 MB apos a compressao.");
  } finally {
    bitmap.close?.();
  }
}

/**
 * Executa a importacao sem apagar ou modificar nenhuma chave V3.
 * Falhas sao isoladas por registro e retornadas no relatorio; o marcador de
 * migracao so deve ser gravado pelo chamador depois que esta Promise resolver.
 */
export async function migrateLegacyData({
  repository,
  userId,
  currentData = {},
  backup = null,
  cloudRows = null,
  onProgress = () => {},
} = {}) {
  if (!repository?.rpc || !repository?.loadAll) throw new TypeError("repository V4 e obrigatorio.");
  if (!userId) throw new TypeError("userId e obrigatorio.");
  const safeBackup = backup || createLegacyBackup();
  // Esta leitura acontece antes de qualquer escrita: se a nuvem nao responder,
  // abortamos para nunca migrar apenas metade das fontes legadas.
  const resolvedCloudRows = Array.isArray(cloudRows)
    ? cloudRows
    : repository.loadLegacyCloud ? await repository.loadLegacyCloud() : [];
  const cloudData = cloudRowsToData(resolvedCloudRows);
  const mergeDecisions = [];
  const combinedData = mergeLegacySources(legacyData(safeBackup), cloudData, resolvedCloudRows, mergeDecisions);
  const capturedAt = new Date().toISOString();
  const completeBackup = {
    ...safeBackup,
    format: "fh3d-v3-and-v4-pre-migration",
    captured_at: capturedAt,
    user_id: userId,
    legacy_local: { data: legacyData(safeBackup), raw: safeBackup.raw || {} },
    legacy_cloud: { rows: resolvedCloudRows, data: cloudData },
    current_v4_snapshot: { captured_at: capturedAt, user_id: userId, data: currentData },
    combined_data: combinedData,
    merge_decisions: mergeDecisions,
  };
  const backupFilename = `precificador-pre-migracao-${Date.now()}.json`;
  const backupDownloaded = downloadLegacyBackup(completeBackup, backupFilename);
  const transformed = transformLegacyData({ backup: completeBackup, userId, currentData });
  const report = transformed.report;
  report.backup = {
    filename: backupFilename,
    downloaded: backupDownloaded,
    capturedAt,
    localKeys: completeBackup.keys?.length || 0,
    cloudRows: resolvedCloudRows.length,
    currentRows: Object.values(currentData).reduce((total, rows) => total + array(rows).length, 0),
  };
  for (const decision of mergeDecisions) {
    const suffix = decision.id == null ? "" : ` (${decision.id})`;
    report.warnings.push(`Conflito ${decision.key}${suffix}: usada a versao mais recente de ${decision.chosen === "cloud" ? "nuvem" : "local"}.`);
  }

  const withoutUserId = (row) => {
    const clean = { ...row };
    delete clean.user_id;
    delete clean._sync_status;
    return clean;
  };
  const payload = {
    migration_id: legacyUuid(userId, "migration", "v3-to-v4"),
    captured_at: capturedAt,
  };
  for (const collection of COLLECTIONS.filter((name) => name !== "attachments")) {
    payload[collection] = array(transformed.pending[collection]).map(withoutUserId);
  }

  onProgress({ collection: "database", current: 0, total: 1, report: { ...report } });
  let databaseResult;
  try {
    databaseResult = await repository.rpc("migrate_legacy_v3", { p_payload: payload });
    if (databaseResult?.queued) throw new Error("Migracao aguardando internet; tente novamente quando estiver online.");
  } catch (error) {
    for (const collection of COLLECTIONS.filter((name) => name !== "attachments")) {
      const count = array(payload[collection]).length;
      report.rejected += count;
      report.byCollection[collection].rejected += count;
    }
    report.errors.push({ collection: "database", message: error?.message || String(error) });
    report.completedAt = new Date().toISOString();
    report.retryRequired = true;
    error.migrationReport = report;
    throw error;
  }

  for (const collection of COLLECTIONS.filter((name) => name !== "attachments")) {
    const count = array(payload[collection]).length;
    const serverCount = databaseResult?.byCollection?.[collection] ?? databaseResult?.by_collection?.[collection];
    const imported = Number(serverCount?.imported ?? serverCount ?? count) || 0;
    const skipped = Number(serverCount?.skipped ?? 0) || 0;
    report.byCollection[collection].imported += imported;
    report.byCollection[collection].skipped += skipped;
    report.imported += imported;
    report.skipped += skipped;
  }
  report.databaseResult = databaseResult || null;
  onProgress({ collection: "database", current: 1, total: 1, report: { ...report } });

  // Fotos e logo deixam de ser base64 no banco e passam ao bucket privado.
  for (const photo of transformed.assets.photos) {
    try {
      const prepared = await prepareLegacyImage(photo.dataUrl, photo.name);
      const assetId = legacyUuid(userId, "attachment", `${photo.orderId}:${photo.index}`);
      await repository.uploadAttachment(prepared.file, userId, photo.orderId, "product_photo", {
        id: assetId,
        legacyId: `photo:${photo.orderId}:${photo.index}`,
      });
      if (prepared.compressed) {
        report.corrected += 1;
        report.byCollection.attachments.corrected += 1;
        report.warnings.push(`Foto de ${photo.name} comprimida de ${prepared.originalBytes} bytes antes do envio.`);
      }
      report.imported += 1;
      report.byCollection.attachments.imported += 1;
    } catch (error) {
      report.rejected += 1;
      report.byCollection.attachments.rejected += 1;
      report.errors.push({ collection: "attachments", orderId: photo.orderId, message: error?.message || String(error) });
    }
  }

  if (transformed.assets.logo) {
    try {
      const prepared = await prepareLegacyImage(transformed.assets.logo, "logo-v3");
      const attachment = await repository.uploadAttachment(prepared.file, userId, null, "logo", {
        id: legacyUuid(userId, "attachment", "logo"),
        legacyId: "logo",
      });
      if (prepared.compressed) {
        report.corrected += 1;
        report.byCollection.attachments.corrected += 1;
        report.warnings.push(`Logo comprimido de ${prepared.originalBytes} bytes antes do envio.`);
      }
      const cached = repository.loadCached ? await repository.loadCached(["settings"]) : null;
      const base = cached?.settings?.[0] || transformed.data.settings[0] || { user_id: userId };
      await repository.upsert("settings", { ...base, logo_path: attachment.storage_path }, { expectedVersion: base.version ?? null });
      report.imported += 1;
      report.byCollection.attachments.imported += 1;
    } catch (error) {
      report.rejected += 1;
      report.byCollection.attachments.rejected += 1;
      report.errors.push({ collection: "attachments", kind: "logo", message: error?.message || String(error) });
    }
  }

  report.completedAt = new Date().toISOString();
  report.retryRequired = report.errors.some((entry) => ["database", "attachments"].includes(entry.collection));
  try {
    report.data = await repository.loadAll();
  } catch (error) {
    try {
      report.data = repository.loadCached ? await repository.loadCached() : transformed.data;
    } catch {
      report.data = transformed.data;
    }
    report.warnings.push(`Os dados foram importados, mas a releitura da nuvem falhou: ${error?.message || error}`);
  }
  return report;
}
