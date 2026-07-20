import test from "node:test";
import assert from "node:assert/strict";

import {
  DomainValidationError,
  aggregateFilamentConsumption,
  calculateDashboardMetrics,
  calculateQuote,
  dateOnlyToLocalDate,
  daysBetweenDateOnly,
  formatCurrency,
  formatLocalDate,
  monthKey,
  normalizeOrderStatuses,
  parseNumber,
  toSaoPauloDateKey,
  updateOrderStatuses,
  validateQuoteItems,
} from "../js/domain.js";

test("converte numeros e moeda brasileira sem perder centavos", () => {
  assert.equal(parseNumber("R$ 1.234,56"), 1234.56);
  assert.equal(parseNumber("1,5"), 1.5);
  assert.equal(parseNumber("invalido", 7), 7);
  assert.match(formatCurrency(1234.5), /1\.234,50/);
});

test("preserva datas date-only no fuso de Sao Paulo", () => {
  assert.equal(formatLocalDate("2026-07-17"), "17/07/2026");
  assert.equal(toSaoPauloDateKey("2026-07-17"), "2026-07-17");
  assert.equal(monthKey("2026-07-01"), "2026-07");
  assert.equal(daysBetweenDateOnly("2026-07-17", "2026-07-20"), 3);
  assert.equal(toSaoPauloDateKey(dateOnlyToLocalDate("2026-07-17")), "2026-07-17");
  assert.equal(dateOnlyToLocalDate("2026-02-30"), null);
});

test("rejeita quantidades zero, negativas e fracionarias", () => {
  for (const quantity of [0, -1, 1.5, ""]) {
    const result = validateQuoteItems([
      {
        name: "Peca",
        quantity,
        unitWeightG: 20,
        printHours: 1,
        filamentId: "rolo-1",
      },
    ]);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => error.code === "INVALID_QUANTITY"));
  }
});

test("agrega dois itens que usam o mesmo rolo antes de validar o estoque", () => {
  const items = [
    { name: "A", quantity: 2, unitWeightG: 80, printHours: 1, filamentId: "pla-preto" },
    { name: "B", quantity: 1, unitWeightG: 50, printHours: 1, filamentId: "pla-preto" },
    { name: "C", quantity: 3, unitWeightG: 10, printHours: 1, filamentId: "petg-azul" },
  ];

  assert.deepEqual(aggregateFilamentConsumption(items), [
    { filamentId: "pla-preto", grams: 210, itemIndexes: [0, 1] },
    { filamentId: "petg-azul", grams: 30, itemIndexes: [2] },
  ]);

  const validation = validateQuoteItems(items, {
    "pla-preto": { stockGrams: 200 },
    "petg-azul": { stockGrams: 30 },
  });
  assert.equal(validation.valid, false);
  assert.deepEqual(
    validation.errors.find((error) => error.code === "INSUFFICIENT_STOCK"),
    {
      code: "INSUFFICIENT_STOCK",
      field: "stockGrams",
      path: "stock",
      filamentId: "pla-preto",
      requiredGrams: 210,
      availableGrams: 200,
      message: "Estoque insuficiente: necessario 210g e disponivel 200g.",
    },
  );
});

test("valida saldo usando a coluna canônica current_weight_g", () => {
  const result = validateQuoteItems([
    { name: "Peça", quantity: 2, unitWeightG: 60, printHours: 1, filamentId: "rolo-1", material: "PLA" },
  ], [{ id: "rolo-1", current_weight_g: 100 }]);
  assert.equal(result.valid, false);
  assert.equal(result.errors.some((error) => error.code === "INSUFFICIENT_STOCK"), true);
});

test("calcula orcamento multi-itens com custos, servicos e desconto", () => {
  const result = calculateQuote({
    items: [
      {
        name: "Suporte",
        quantity: 2,
        unitWeightG: 100,
        printHours: 1,
        filamentPriceKg: 100,
        material: "PLA",
      },
      {
        name: "Tampa",
        quantity: 1,
        unitWeightG: 50,
        printHours: 0.5,
        filamentPriceKg: 200,
        material: "PETG",
      },
    ],
    printer: { consumptionKw: 0.2, wastePercent: 10 },
    costs: {
      energyRateKwh: 1,
      depreciationPerHour: 2,
      maintenancePerHour: 1,
      profitPercent: 30,
      packaging: 10,
      wastePercent: 10,
    },
    modeling: 15,
    finishing: 5,
    discount: 10,
  });

  assert.equal(result.totalWeightG, 250);
  assert.equal(result.totalPrintHours, 2.5);
  assert.equal(result.materialCost, 33);
  assert.equal(result.energyCost, 0.5);
  assert.equal(result.machineCost, 7.5);
  assert.equal(result.postProcessingCost, 1.5);
  assert.equal(result.baseCost, 42.5);
  assert.equal(result.suggestedPrice, 68.25);
  assert.equal(result.printPrice, 70);
  assert.equal(result.finalPrice, 80);
  assert.equal(result.realProfit, 37.5);
});

test("calculo falha de forma explicita quando a quantidade e invalida", () => {
  assert.throws(
    () => calculateQuote({
      items: [{ quantity: 0, unitWeightG: 20, printHours: 1, filamentPriceKg: 100 }],
    }),
    (error) =>
      error instanceof DomainValidationError &&
      error.errors.some((entry) => entry.code === "INVALID_QUANTITY"),
  );
});

test("mantem os status comercial, de producao e pagamento independentes", () => {
  const order = {
    commercialStatus: "aprovado",
    productionStatus: "pendente",
    paymentStatus: "parcial",
  };
  const changed = updateOrderStatuses(order, { productionStatus: "em_producao" });

  assert.deepEqual(normalizeOrderStatuses(changed), {
    commercialStatus: "aprovado",
    productionStatus: "em_producao",
    paymentStatus: "parcial",
  });
  assert.equal(changed.commercialStatus, "aprovado");
  assert.equal(changed.paymentStatus, "parcial");
});

test("dashboard exclui cancelados e reconhece receita pelo paid_at", () => {
  const orders = [
    {
      id: "julho-pago",
      created_at: "2026-07-02T10:00:00-03:00",
      paid_at: "2026-07-10T15:00:00-03:00",
      finalPrice: 100,
      commercialStatus: "aprovado",
      paymentStatus: "pago",
    },
    {
      id: "julho-pendente",
      created_at: "2026-07-03T10:00:00-03:00",
      finalPrice: 200,
      commercialStatus: "aprovado",
      paymentStatus: "pendente",
    },
    {
      id: "cancelado",
      created_at: "2026-07-04T10:00:00-03:00",
      paid_at: "2026-07-05T10:00:00-03:00",
      finalPrice: 1000,
      commercialStatus: "cancelado",
      paymentStatus: "pago",
    },
    {
      id: "junho-pago-em-julho",
      created_at: "2026-06-20T10:00:00-03:00",
      paid_at: "2026-07-01",
      finalPrice: 50,
      commercialStatus: "aprovado",
      paymentStatus: "pago",
    },
    {
      id: "julho-pago-em-junho",
      created_at: "2026-07-06T10:00:00-03:00",
      paid_at: "2026-06-30T10:00:00-03:00",
      finalPrice: 80,
      commercialStatus: "aprovado",
      paymentStatus: "pago",
    },
  ];
  const metrics = calculateDashboardMetrics({
    orders,
    expenses: [
      { expense_date: "2026-07-08", amount: 30 },
      { data: "2026-06-30", valor: 999 },
    ],
    referenceDate: "2026-07-17",
  });

  assert.equal(metrics.month, "2026-07");
  assert.equal(metrics.billed, 380);
  assert.equal(metrics.revenue, 150);
  assert.equal(metrics.pending, 200);
  assert.equal(metrics.expenses, 30);
  assert.equal(metrics.netProfit, 120);
  assert.equal(metrics.orderCount, 3);
  assert.equal(metrics.paidOrderCount, 2);
  assert.ok(metrics.recentOrders.every((order) => order.id !== "cancelado"));
});
