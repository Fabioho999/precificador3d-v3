/**
 * Regras puras do Precificador 3D V4.
 *
 * Este modulo nao acessa DOM, armazenamento, rede ou relogio global durante os
 * calculos. As funcoes aceitam formatos V4 e aliases legados usados pela V3
 * para permitir uma migracao gradual dos dados.
 */

export const TIME_ZONE = "America/Sao_Paulo";
export const LOCALE = "pt-BR";

export const COMMERCIAL_STATUSES = Object.freeze([
  "orcamento",
  "aprovado",
  "cancelado",
]);

export const PRODUCTION_STATUSES = Object.freeze([
  "pendente",
  "em_producao",
  "pronto",
  "enviado",
  "entregue",
]);

export const PAYMENT_STATUSES = Object.freeze([
  "pendente",
  "parcial",
  "pago",
  "reembolsado",
]);

export const ORDER_STATUSES = Object.freeze({
  commercial: COMMERCIAL_STATUSES,
  production: PRODUCTION_STATUSES,
  payment: PAYMENT_STATUSES,
});

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const currencyFormatter = new Intl.NumberFormat(LOCALE, {
  style: "currency",
  currency: "BRL",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const saoPauloDatePartsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const hasOwn = (object, key) =>
  Object.prototype.hasOwnProperty.call(object ?? {}, key);

const firstDefined = (object, keys) => {
  for (const key of keys) {
    if (hasOwn(object, key) && object[key] !== null && object[key] !== "") {
      return object[key];
    }
  }
  return undefined;
};

export class DomainValidationError extends Error {
  constructor(message, errors = []) {
    super(message);
    this.name = "DomainValidationError";
    this.errors = errors;
  }
}

/** Converte numero, moeda brasileira e valores vindos de inputs HTML. */
export function parseNumber(value, fallback = Number.NaN) {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  if (typeof value === "bigint") {
    const converted = Number(value);
    return Number.isFinite(converted) ? converted : fallback;
  }
  if (typeof value !== "string") return fallback;

  let normalized = value
    .trim()
    .replace(/\u00a0/g, "")
    .replace(/\s/g, "")
    .replace(/R\$/gi, "")
    .replace(/%/g, "");
  if (!normalized) return fallback;

  const comma = normalized.lastIndexOf(",");
  const dot = normalized.lastIndexOf(".");

  if (comma >= 0 && dot >= 0) {
    const decimalSeparator = comma > dot ? "," : ".";
    const thousandsSeparator = decimalSeparator === "," ? "." : ",";
    normalized = normalized.split(thousandsSeparator).join("");
    if (decimalSeparator === ",") normalized = normalized.replace(",", ".");
  } else if (comma >= 0) {
    const parts = normalized.split(",");
    const decimal = parts.pop();
    normalized = `${parts.join("")}.${decimal}`;
  } else if ((normalized.match(/\./g) ?? []).length > 1) {
    const parts = normalized.split(".");
    const looksLikeThousands = parts.slice(1).every((part) => part.length === 3);
    if (looksLikeThousands) {
      normalized = parts.join("");
    } else {
      const decimal = parts.pop();
      normalized = `${parts.join("")}.${decimal}`;
    }
  }

  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(normalized)) return fallback;
  const result = Number(normalized);
  return Number.isFinite(result) ? result : fallback;
}

export function toNumber(value, fallback = 0) {
  return parseNumber(value, fallback);
}

export function roundMoney(value) {
  const number = parseNumber(value);
  if (!Number.isFinite(number)) return 0;
  return Math.round((number + Number.EPSILON) * 100) / 100;
}

export function formatCurrency(value) {
  return currencyFormatter.format(toNumber(value, 0));
}

export const money = formatCurrency;

function validDateOnlyParts(year, month, day) {
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

export function isDateOnly(value) {
  if (typeof value !== "string") return false;
  const match = value.match(DATE_ONLY_PATTERN);
  if (!match) return false;
  return validDateOnlyParts(Number(match[1]), Number(match[2]), Number(match[3]));
}

/**
 * Converte uma data sem horario para um instante seguro no meio do dia em Sao
 * Paulo. Isso evita a regressao classica de exibir o dia anterior no Brasil.
 */
export function dateOnlyToLocalDate(value) {
  if (!isDateOnly(value)) return null;
  return new Date(`${value}T12:00:00-03:00`);
}

export function toSaoPauloDateKey(value) {
  if (isDateOnly(value)) return value;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const parts = saoPauloDatePartsFormatter.formatToParts(date);
  const part = (type) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function monthKey(value) {
  return toSaoPauloDateKey(value).slice(0, 7);
}

export function formatLocalDate(value) {
  const key = toSaoPauloDateKey(value);
  if (!key) return "";
  const [year, month, day] = key.split("-");
  return `${day}/${month}/${year}`;
}

export function compareDateOnly(left, right) {
  const leftKey = toSaoPauloDateKey(left);
  const rightKey = toSaoPauloDateKey(right);
  if (!leftKey || !rightKey) return Number.NaN;
  return leftKey.localeCompare(rightKey);
}

export function daysBetweenDateOnly(from, to) {
  const fromKey = toSaoPauloDateKey(from);
  const toKey = toSaoPauloDateKey(to);
  if (!fromKey || !toKey) return Number.NaN;
  const [fy, fm, fd] = fromKey.split("-").map(Number);
  const [ty, tm, td] = toKey.split("-").map(Number);
  return Math.round(
    (Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000,
  );
}

function normalizeMaterial(value) {
  return String(value ?? "").trim().toUpperCase();
}

function normalizeId(value) {
  if (value === null || value === undefined || value === "") return "";
  return String(value);
}

export function normalizeQuoteItem(item = {}, index = 0) {
  const hours = toNumber(
    firstDefined(item, ["printHours", "timeHours", "tempoEmHoras", "tempo"]),
    Number.NaN,
  );
  const explicitHours = toNumber(firstDefined(item, ["hours", "horas"]), 0);
  const explicitMinutes = toNumber(firstDefined(item, ["minutes", "minutos"]), 0);
  const printHours = Number.isFinite(hours)
    ? hours
    : explicitHours + explicitMinutes / 60;

  return {
    ...item,
    index,
    name: String(firstDefined(item, ["name", "nome"]) ?? "").trim(),
    quantity: toNumber(firstDefined(item, ["quantity", "qtd", "quantidade"]), Number.NaN),
    unitWeightG: toNumber(
      firstDefined(item, ["unitWeightG", "weightGrams", "peso", "pesoGramas", "grams"]),
      Number.NaN,
    ),
    printHours,
    filamentPriceKg: toNumber(
      firstDefined(item, ["filamentPriceKg", "filamentPricePerKg", "precoFilamento", "pricePerKg"]),
      Number.NaN,
    ),
    filamentId: normalizeId(firstDefined(item, ["filamentId", "filament_id"])),
    material: normalizeMaterial(firstDefined(item, ["material", "materialType"])),
  };
}

function validationError(code, index, field, message, extra = {}) {
  return {
    code,
    index,
    field,
    path: `items[${index}].${field}`,
    message,
    ...extra,
  };
}

function normalizeStock(stockById) {
  if (!stockById) return null;
  if (stockById instanceof Map) return new Map(stockById);

  if (Array.isArray(stockById)) {
    return new Map(
      stockById.map((filament) => [
        normalizeId(firstDefined(filament, ["id", "filamentId", "filament_id"])),
        filament,
      ]),
    );
  }

  if (typeof stockById === "object") return new Map(Object.entries(stockById));
  return null;
}

function stockGrams(stockEntry) {
  if (typeof stockEntry === "number" || typeof stockEntry === "string") {
    return toNumber(stockEntry, Number.NaN);
  }
  return toNumber(
    firstDefined(stockEntry, [
      "stockGrams",
      "remainingGrams",
      "availableGrams",
      "currentGrams",
      "current_weight_g",
      "peso",
      "grams",
      "quantityGrams",
      "quantidade_gramas",
    ]),
    Number.NaN,
  );
}

/** Soma as gramas por rolo; o desperdicio de precificacao nao sai do estoque. */
export function aggregateFilamentConsumption(items, { strict = true } = {}) {
  if (!Array.isArray(items)) {
    if (strict) {
      throw new DomainValidationError("A lista de itens e obrigatoria.", [
        { code: "ITEMS_REQUIRED", path: "items", message: "Adicione pelo menos um item." },
      ]);
    }
    return [];
  }

  const totals = new Map();
  const errors = [];

  items.forEach((rawItem, index) => {
    const item = normalizeQuoteItem(rawItem, index);
    if (!item.filamentId) {
      errors.push(validationError("FILAMENT_REQUIRED", index, "filamentId", "Selecione o filamento."));
      return;
    }
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      errors.push(validationError("INVALID_QUANTITY", index, "quantity", "A quantidade deve ser um inteiro maior que zero."));
      return;
    }
    if (!Number.isFinite(item.unitWeightG) || item.unitWeightG <= 0) {
      errors.push(validationError("INVALID_WEIGHT", index, "unitWeightG", "O peso deve ser maior que zero."));
      return;
    }

    const grams = item.quantity * item.unitWeightG;
    const current = totals.get(item.filamentId) ?? {
      filamentId: item.filamentId,
      grams: 0,
      itemIndexes: [],
    };
    current.grams = roundMoney(current.grams + grams);
    current.itemIndexes.push(index);
    totals.set(item.filamentId, current);
  });

  if (strict && errors.length) {
    throw new DomainValidationError("Existem itens invalidos para consumo de estoque.", errors);
  }
  return [...totals.values()];
}

/**
 * Valida itens e, quando stockById for informado, compara o consumo agregado
 * com o saldo de cada rolo.
 */
export function validateQuoteItems(items, stockById = null, options = {}) {
  if (
    stockById &&
    !(stockById instanceof Map) &&
    !Array.isArray(stockById) &&
    typeof stockById === "object" &&
    (hasOwn(stockById, "requireFilament") || hasOwn(stockById, "checkStock"))
  ) {
    options = stockById;
    stockById = options.stockById ?? null;
  }

  const requireFilament = options.requireFilament ?? true;
  const stock = normalizeStock(stockById);
  const normalizedItems = Array.isArray(items)
    ? items.map((item, index) => normalizeQuoteItem(item, index))
    : [];
  const errors = [];

  if (!Array.isArray(items) || items.length === 0) {
    errors.push({
      code: "ITEMS_REQUIRED",
      path: "items",
      message: "Adicione pelo menos um item.",
    });
  }

  normalizedItems.forEach((item, index) => {
    if (!item.name) {
      errors.push(validationError("NAME_REQUIRED", index, "name", "Informe o nome do item."));
    }
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      errors.push(validationError("INVALID_QUANTITY", index, "quantity", "A quantidade deve ser um inteiro maior que zero."));
    }
    if (!Number.isFinite(item.unitWeightG) || item.unitWeightG <= 0) {
      errors.push(validationError("INVALID_WEIGHT", index, "unitWeightG", "O peso deve ser maior que zero."));
    }
    if (!Number.isFinite(item.printHours) || item.printHours <= 0) {
      errors.push(validationError("INVALID_PRINT_TIME", index, "printHours", "O tempo de impressao deve ser maior que zero."));
    }
    if (requireFilament && !item.filamentId) {
      errors.push(validationError("FILAMENT_REQUIRED", index, "filamentId", "Selecione o filamento."));
    }
  });

  if (stock) {
    const consumption = aggregateFilamentConsumption(normalizedItems, { strict: false });
    for (const entry of consumption) {
      const filament = stock.get(entry.filamentId);
      if (filament === undefined) {
        errors.push({
          code: "FILAMENT_NOT_FOUND",
          field: "filamentId",
          path: "items",
          filamentId: entry.filamentId,
          message: `Filamento ${entry.filamentId} nao encontrado no estoque.`,
        });
        continue;
      }
      const available = stockGrams(filament);
      if (!Number.isFinite(available) || available < 0) {
        errors.push({
          code: "INVALID_STOCK",
          field: "stockGrams",
          path: "stock",
          filamentId: entry.filamentId,
          message: `O saldo do filamento ${entry.filamentId} e invalido.`,
        });
      } else if (entry.grams > available) {
        errors.push({
          code: "INSUFFICIENT_STOCK",
          field: "stockGrams",
          path: "stock",
          filamentId: entry.filamentId,
          requiredGrams: entry.grams,
          availableGrams: available,
          message: `Estoque insuficiente: necessario ${entry.grams}g e disponivel ${available}g.`,
        });
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    items: normalizedItems,
    normalizedItems,
  };
}

export function assertValidQuoteItems(items, stockById = null, options = {}) {
  const validation = validateQuoteItems(items, stockById, options);
  if (!validation.valid) {
    throw new DomainValidationError("Corrija os itens do orcamento.", validation.errors);
  }
  return validation.items;
}

const materialPostProcessingMultiplier = Object.freeze({
  PLA: 0.5,
  PETG: 1,
  ABS: 2,
  ASA: 2,
  RESINA: 3,
});

const printerDefaults = Object.freeze({
  K1C: { consumptionKw: 0.25, wastePercent: 8 },
  KOBRA: { consumptionKw: 0.3, wastePercent: 10 },
  AMBAS: { consumptionKw: 0.275, wastePercent: 9 },
  BOTH: { consumptionKw: 0.275, wastePercent: 9 },
});

function configuredNumber(object, aliases, fallback) {
  const value = parseNumber(firstDefined(object, aliases));
  return Number.isFinite(value) ? value : fallback;
}

function validatePricingItems(items) {
  const normalizedItems = Array.isArray(items)
    ? items.map((item, index) => normalizeQuoteItem(item, index))
    : [];
  const errors = [];
  if (!normalizedItems.length) {
    errors.push({ code: "ITEMS_REQUIRED", path: "items", message: "Adicione pelo menos um item." });
  }
  normalizedItems.forEach((item, index) => {
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      errors.push(validationError("INVALID_QUANTITY", index, "quantity", "A quantidade deve ser um inteiro maior que zero."));
    }
    if (!Number.isFinite(item.unitWeightG) || item.unitWeightG <= 0) {
      errors.push(validationError("INVALID_WEIGHT", index, "unitWeightG", "O peso deve ser maior que zero."));
    }
    if (!Number.isFinite(item.printHours) || item.printHours <= 0) {
      errors.push(validationError("INVALID_PRINT_TIME", index, "printHours", "O tempo de impressao deve ser maior que zero."));
    }
  });
  if (errors.length) throw new DomainValidationError("Nao foi possivel calcular o orcamento.", errors);
  return normalizedItems;
}

/**
 * Calcula um orcamento multi-itens.
 *
 * Entrada V4:
 * calculateQuote({ items, costs, printer, modeling, finishing, discount })
 */
export function calculateQuote({
  items,
  costs = {},
  printer = "K1C",
  modeling = 0,
  finishing = 0,
  discount = 0,
} = {}) {
  const normalizedItems = validatePricingItems(items);
  const printerKey = typeof printer === "string" ? printer.trim().toUpperCase() : "CUSTOM";
  const printerConfig =
    typeof printer === "object" && printer !== null
      ? printer
      : printerDefaults[printerKey] ?? printerDefaults.K1C;

  const defaultConsumption = configuredNumber(
    printerConfig,
    ["consumptionKw", "consumoKw", "consumo"],
    printerDefaults.K1C.consumptionKw,
  );
  const configuredConsumption =
    printerKey === "K1C"
      ? configuredNumber(costs, ["k1cConsumptionKw", "consumoK1C"], defaultConsumption)
      : printerKey === "KOBRA"
        ? configuredNumber(costs, ["kobraConsumptionKw", "consumoKobra"], defaultConsumption)
        : configuredNumber(costs, ["printerConsumptionKw", "consumptionKw"], defaultConsumption);
  const wastePercent = configuredNumber(
    costs,
    ["wastePercent", "desperdicioPercentual", "desperdicio"],
    configuredNumber(printerConfig, ["wastePercent", "desperdicioPercentual"], 8),
  );
  const wasteFactor = 1 + wastePercent / 100;
  const fallbackFilamentPrice = configuredNumber(
    costs,
    ["filamentPriceKg", "filamentPricePerKg", "custoFilamento"],
    95,
  );
  const energyRateKwh = configuredNumber(costs, ["energyRateKwh", "tarifaEnergia"], 0.85);
  const depreciationPerHour = configuredNumber(costs, ["depreciationPerHour", "depreciacao"], 2.5);
  const maintenancePerHour = configuredNumber(costs, ["maintenancePerHour", "manutencao"], 0.5);
  const profitPercent = configuredNumber(costs, ["profitPercent", "lucroPadrao"], 30);
  const packaging = configuredNumber(costs, ["packaging", "embalagem"], 10);
  const modelingValue = Math.max(0, toNumber(modeling, 0));
  const finishingValue = Math.max(0, toNumber(finishing, 0));
  const discountValue = Math.max(0, toNumber(discount, 0));

  const totalWeightG = normalizedItems.reduce(
    (total, item) => total + item.unitWeightG * item.quantity,
    0,
  );
  const totalPrintHours = normalizedItems.reduce(
    (total, item) => total + item.printHours * item.quantity,
    0,
  );
  const materialCost = normalizedItems.reduce((total, item) => {
    const priceKg = Number.isFinite(item.filamentPriceKg)
      ? item.filamentPriceKg
      : fallbackFilamentPrice;
    return total + (item.unitWeightG * item.quantity / 1000) * wasteFactor * priceKg;
  }, 0);
  const kwh = totalPrintHours * configuredConsumption;
  const energyCost = kwh * energyRateKwh;
  const machineCost = totalPrintHours * (depreciationPerHour + maintenancePerHour);
  const postProcessingCost = normalizedItems.reduce((total, item) => {
    const multiplier = materialPostProcessingMultiplier[item.material] ?? 1;
    return total + item.quantity * (item.unitWeightG / 100) * multiplier;
  }, 0);
  const baseCost = materialCost + energyCost + machineCost + postProcessingCost;
  const priceBeforeProfit = baseCost + packaging;
  const suggestedPrice = priceBeforeProfit * (1 + profitPercent / 100);
  const printPrice = Math.ceil(suggestedPrice / 5) * 5;
  const finalPrice = Math.max(0, printPrice + modelingValue + finishingValue - discountValue);
  const realProfit = finalPrice - baseCost;
  const marginPercent = finalPrice > 0 ? realProfit / finalPrice * 100 : 0;
  const totalHoursWhole = Math.floor(totalPrintHours);
  let totalMinutes = Math.round((totalPrintHours - totalHoursWhole) * 60);
  let totalHours = totalHoursWhole;
  if (totalMinutes === 60) {
    totalHours += 1;
    totalMinutes = 0;
  }

  const costBreakdown = {
    material: roundMoney(materialCost),
    energy: roundMoney(energyCost),
    machine: roundMoney(machineCost),
    postProcessing: roundMoney(postProcessingCost),
    base: roundMoney(baseCost),
    packaging: roundMoney(packaging),
  };

  return {
    items: normalizedItems,
    printer: printerKey,
    totalWeightG: roundMoney(totalWeightG),
    totalWeightKg: totalWeightG / 1000,
    weightWithWasteKg: totalWeightG / 1000 * wasteFactor,
    totalPrintHours,
    totalHours,
    totalMinutes,
    kwh: roundMoney(kwh),
    wastePercent,
    profitPercent,
    costs: costBreakdown,
    materialCost: costBreakdown.material,
    energyCost: costBreakdown.energy,
    machineCost: costBreakdown.machine,
    postProcessingCost: costBreakdown.postProcessing,
    baseCost: costBreakdown.base,
    packaging: costBreakdown.packaging,
    priceBeforeProfit: roundMoney(priceBeforeProfit),
    suggestedPrice: roundMoney(suggestedPrice),
    printPrice: roundMoney(printPrice),
    modeling: roundMoney(modelingValue),
    finishing: roundMoney(finishingValue),
    discount: roundMoney(discountValue),
    finalPrice: roundMoney(finalPrice),
    realProfit: roundMoney(realProfit),
    marginPercent: Math.round(marginPercent * 10) / 10,

    // Aliases de leitura para a migracao dos registros V3.
    pesoTotalGramas: roundMoney(totalWeightG),
    tempoTotalHorasDecimal: totalPrintHours,
    custoMaterial: costBreakdown.material,
    custoEnergia: costBreakdown.energy,
    custoMaquina: costBreakdown.machine,
    custoPosProcessamento: costBreakdown.postProcessing,
    custoBase: costBreakdown.base,
    precoSemLucro: roundMoney(priceBeforeProfit),
    precoComLucro: roundMoney(suggestedPrice),
    precoFinal: roundMoney(finalPrice),
    lucroReal: roundMoney(realProfit),
  };
}

const statusAliases = Object.freeze({
  commercial: {
    ORCAMENTO: "orcamento",
    PENDENTE: "orcamento",
    APROVADO: "aprovado",
    CANCELADO: "cancelado",
  },
  production: {
    PENDENTE: "pendente",
    AGUARDANDO: "pendente",
    EM_PRODUCAO: "em_producao",
    "EM PRODUCAO": "em_producao",
    PRODUCAO: "em_producao",
    PRONTO: "pronto",
    ENVIADO: "enviado",
    ENTREGUE: "entregue",
  },
  payment: {
    PENDENTE: "pendente",
    PARCIAL: "parcial",
    PAGO: "pago",
    REEMBOLSADO: "reembolsado",
  },
});

function canonicalStatus(value, type, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  const raw = String(value).trim();
  const normalized = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\s-]+/g, "_")
    .toLowerCase();
  const allowed = ORDER_STATUSES[type];
  if (allowed.includes(normalized)) return normalized;
  return statusAliases[type][normalized.toUpperCase()] ?? fallback;
}

/** Normaliza os tres eixos sem derivar um status a partir de outro. */
export function normalizeOrderStatuses(order = {}) {
  const legacyStatus = firstDefined(order, ["status"]);
  let commercialStatus = canonicalStatus(
    firstDefined(order, ["commercialStatus", "commercial_status", "statusComercial"]),
    "commercial",
    "orcamento",
  );
  let productionStatus = canonicalStatus(
    firstDefined(order, ["productionStatus", "production_status", "statusProducao"]),
    "production",
    "pendente",
  );
  let paymentStatus = canonicalStatus(
    firstDefined(order, ["paymentStatus", "payment_status", "statusPagamento"]),
    "payment",
    order.pago === true ? "pago" : "pendente",
  );

  // O campo legado so e consultado quando o eixo novo nao existe.
  if (!firstDefined(order, ["commercialStatus", "commercial_status", "statusComercial"])) {
    if (String(legacyStatus ?? "").toUpperCase() === "CANCELADO") commercialStatus = "cancelado";
    else if (["APROVADO", "PAGO", "EM_PRODUCAO", "PRONTO", "ENVIADO", "ENTREGUE"].includes(String(legacyStatus ?? "").toUpperCase())) commercialStatus = "aprovado";
  }
  if (!firstDefined(order, ["productionStatus", "production_status", "statusProducao"])) {
    productionStatus = canonicalStatus(legacyStatus, "production", productionStatus);
  }
  if (!firstDefined(order, ["paymentStatus", "payment_status", "statusPagamento"])) {
    paymentStatus = canonicalStatus(legacyStatus, "payment", paymentStatus);
  }

  return { commercialStatus, productionStatus, paymentStatus };
}

export function validateOrderStatuses(statuses = {}) {
  const normalized = normalizeOrderStatuses(statuses);
  const errors = [];
  for (const [type, key] of [
    ["commercial", "commercialStatus"],
    ["production", "productionStatus"],
    ["payment", "paymentStatus"],
  ]) {
    const supplied = firstDefined(statuses, [key, key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)]);
    if (supplied !== undefined && canonicalStatus(supplied, type, "") === "") {
      errors.push({
        code: "INVALID_STATUS",
        field: key,
        path: key,
        message: `Status ${String(supplied)} invalido para ${type}.`,
      });
    }
  }
  return { valid: errors.length === 0, errors, statuses: normalized };
}

/** Atualiza apenas os eixos explicitamente informados. */
export function updateOrderStatuses(order, changes = {}) {
  const current = normalizeOrderStatuses(order);
  const next = {
    commercialStatus: hasOwn(changes, "commercialStatus")
      ? canonicalStatus(changes.commercialStatus, "commercial", "")
      : current.commercialStatus,
    productionStatus: hasOwn(changes, "productionStatus")
      ? canonicalStatus(changes.productionStatus, "production", "")
      : current.productionStatus,
    paymentStatus: hasOwn(changes, "paymentStatus")
      ? canonicalStatus(changes.paymentStatus, "payment", "")
      : current.paymentStatus,
  };
  const validation = validateOrderStatuses(next);
  if (!validation.valid || Object.values(next).some((status) => !status)) {
    throw new DomainValidationError("Status de pedido invalido.", validation.errors);
  }
  return { ...order, ...next };
}

export function isCancelledOrder(order) {
  return normalizeOrderStatuses(order).commercialStatus === "cancelado";
}

export function canCancelOrder(order) {
  const { commercialStatus, productionStatus } = normalizeOrderStatuses(order);
  return commercialStatus !== "cancelado" && productionStatus !== "entregue";
}

function orderTotal(order) {
  return Math.max(0, toNumber(firstDefined(order, [
    "finalPrice",
    "final_price",
    "totalAmount",
    "total_amount",
    "precoFinal",
    "valor",
  ]), 0));
}

function paidAmount(order, total) {
  const explicit = parseNumber(firstDefined(order, ["paidAmount", "paid_amount", "valorPago"]));
  if (Number.isFinite(explicit)) return Math.min(total, Math.max(0, explicit));
  const { paymentStatus } = normalizeOrderStatuses(order);
  return paymentStatus === "pago" ? total : 0;
}

function orderCreatedAt(order) {
  return firstDefined(order, ["createdAt", "created_at", "data", "date"]);
}

function orderPaidAt(order) {
  return firstDefined(order, ["paidAt", "paid_at", "dataPagamento"]);
}

function expenseDate(expense) {
  return firstDefined(expense, ["occurredAt", "occurred_at", "expenseDate", "expense_date", "date", "data", "created_at"]);
}

function expenseAmount(expense) {
  return Math.max(0, toNumber(firstDefined(expense, ["amount", "valor", "value"]), 0));
}

/**
 * Metricas mensais. Pedidos cancelados nunca entram e receita e atribuida ao
 * mes de paid_at, mesmo que o pedido tenha sido criado em outro mes.
 */
export function calculateDashboardMetrics(input = {}, expensesArgument = [], optionsArgument = {}) {
  const config = Array.isArray(input)
    ? { orders: input, expenses: expensesArgument, ...optionsArgument }
    : input;
  const orders = Array.isArray(config.orders) ? config.orders : [];
  const expenses = Array.isArray(config.expenses) ? config.expenses : [];
  const referenceDate = config.referenceDate ?? config.now ?? new Date();
  const selectedMonth = config.month ?? monthKey(referenceDate);
  if (!/^\d{4}-\d{2}$/.test(selectedMonth)) {
    throw new DomainValidationError("Mes de referencia invalido.", [
      { code: "INVALID_MONTH", path: "month", message: "Use o formato AAAA-MM." },
    ]);
  }

  const activeOrders = orders.filter((order) => !isCancelledOrder(order));
  const monthOrders = activeOrders.filter((order) => monthKey(orderCreatedAt(order)) === selectedMonth);
  const billed = monthOrders.reduce((total, order) => total + orderTotal(order), 0);
  const revenue = activeOrders.reduce((total, order) => {
    const statuses = normalizeOrderStatuses(order);
    if (statuses.paymentStatus === "reembolsado") return total;
    if (monthKey(orderPaidAt(order)) !== selectedMonth) return total;
    const amount = paidAmount(order, orderTotal(order));
    return total + (amount > 0 ? amount : orderTotal(order));
  }, 0);
  const pending = monthOrders.reduce((total, order) => {
    const statuses = normalizeOrderStatuses(order);
    if (statuses.paymentStatus === "reembolsado") return total;
    const value = orderTotal(order);
    return total + Math.max(0, value - paidAmount(order, value));
  }, 0);
  const expenseTotal = expenses
    .filter((expense) => monthKey(expenseDate(expense)) === selectedMonth)
    .reduce((total, expense) => total + expenseAmount(expense), 0);
  const recentOrders = [...activeOrders]
    .sort((left, right) => {
      const leftTime = new Date(orderCreatedAt(left) ?? 0).getTime();
      const rightTime = new Date(orderCreatedAt(right) ?? 0).getTime();
      return (Number.isNaN(rightTime) ? 0 : rightTime) - (Number.isNaN(leftTime) ? 0 : leftTime);
    })
    .slice(0, Math.max(0, toNumber(config.recentLimit, 5)));

  const metrics = {
    month: selectedMonth,
    billed: roundMoney(billed),
    revenue: roundMoney(revenue),
    pending: roundMoney(pending),
    expenses: roundMoney(expenseTotal),
    netProfit: roundMoney(revenue - expenseTotal),
    orderCount: monthOrders.length,
    paidOrderCount: activeOrders.filter((order) =>
      monthKey(orderPaidAt(order)) === selectedMonth &&
      normalizeOrderStatuses(order).paymentStatus === "pago"
    ).length,
    recentOrders,
  };

  return {
    ...metrics,
    // Aliases em portugues para os componentes da interface.
    faturamento: metrics.billed,
    receita: metrics.revenue,
    pago: metrics.revenue,
    pendente: metrics.pending,
    despesas: metrics.expenses,
    lucroLiquido: metrics.netProfit,
  };
}

// Aliases publicos para os modulos da interface em portugues.
export const calcularOrcamento = calculateQuote;
export const validarItensOrcamento = validateQuoteItems;
export const agregarConsumoFilamentos = aggregateFilamentConsumption;
export const calcularMetricasDashboard = calculateDashboardMetrics;
export const formatarMoeda = formatCurrency;
export const formatarDataLocal = formatLocalDate;
