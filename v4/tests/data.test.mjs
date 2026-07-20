import test from "node:test";
import assert from "node:assert/strict";

import { openUserCache } from "../js/cache.js";
import { createRepository, OfflineError } from "../js/repository.js";
import { migrateLegacyData, transformLegacyData } from "../js/migration.js";

const USER_ID = "11111111-1111-4111-a111-111111111111";
const EXISTING_ORDER_ID = "22222222-2222-4222-a222-222222222222";

function emptyV4(overrides = {}) {
  return {
    settings: [],
    filaments: [],
    orders: [],
    order_items: [],
    stock_movements: [],
    expenses: [],
    recurring_expenses: [],
    catalog_products: [],
    calibrations: [],
    tasks: [],
    attachments: [],
    ...overrides,
  };
}

test("migracao parcial reutiliza o UUID existente em itens, movimentos e fotos", () => {
  const result = transformLegacyData({
    userId: USER_ID,
    now: new Date("2026-07-17T12:00:00-03:00"),
    currentData: emptyV4({
      orders: [{
        id: EXISTING_ORDER_ID,
        user_id: USER_ID,
        legacy_id: "pedido-1",
        version: 3,
      }],
    }),
    backup: {
      data: {
        fh3d_estoque: [{ id: "rolo-1", fabricante: "Marca", tipo: "PLA", peso: 900 }],
        fh3d_prazos: [{ id: "prazo-1", orcId: "pedido-1", status: "PRODUCAO" }],
        fh3d_orcamentos: [{
          id: "pedido-1",
          cliente: "Cliente",
          projeto: "Projeto",
          estoqueBaixado: true,
          consumoEstoque: [{ filamentoId: "rolo-1", gramas: 100 }],
          itens: [{ id: "item-1", nome: "Peca", quantidade: 1, peso: 100, filamentoId: "rolo-1" }],
          fotos: ["data:image/png;base64,AA=="],
        }],
      },
    },
  });

  assert.equal(result.pending.orders.length, 0);
  assert.equal(result.pending.order_items[0].order_id, EXISTING_ORDER_ID);
  assert.equal(
    result.pending.stock_movements.find((movement) => movement.movement_type === "consumption").order_id,
    EXISTING_ORDER_ID,
  );
  assert.equal(result.assets.photos[0].orderId, EXISTING_ORDER_ID);
});

test("merge local/nuvem deduplica por ID e escolhe updated_at mais recente", async () => {
  const cloudRows = [{
    chave: "fh3d_orcamentos",
    updated_at: "2026-06-01T12:00:00Z",
    valor: [
      { id: "mesmo", cliente: "Nuvem nova", updated_at: "2026-05-01T12:00:00Z" },
      { id: "so-nuvem", cliente: "Somente nuvem" },
    ],
  }];
  let legacyReads = 0;
  let rpcPayload = null;
  const repository = {
    loadLegacyCloud: async () => {
      legacyReads += 1;
      return [];
    },
    loadAll: async () => emptyV4(),
    loadCached: async () => emptyV4(),
    rpc: async (_name, args) => {
      rpcPayload = args.p_payload;
      return { byCollection: {} };
    },
    uploadAttachment: async () => {
      throw new Error("nao deveria enviar anexos neste teste");
    },
    upsert: async () => null,
  };

  await migrateLegacyData({
    repository,
    userId: USER_ID,
    currentData: emptyV4(),
    cloudRows,
    backup: {
      keys: ["fh3d_orcamentos"],
      raw: {},
      data: {
        fh3d_orcamentos: [
          { id: "mesmo", cliente: "Local velho", updated_at: "2026-01-01T12:00:00Z" },
          { id: "so-local", cliente: "Somente local" },
        ],
      },
    },
  });

  assert.equal(legacyReads, 0, "o snapshot cloud fornecido deve ser reutilizado");
  assert.equal(rpcPayload.orders.length, 3);
  assert.equal(rpcPayload.orders.find((order) => order.legacy_id === "mesmo").customer_name, "Nuvem nova");
});

test("migracao nunca e enfileirada sem internet", async () => {
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine: false } });
  const user = { id: USER_ID };
  const supabaseClient = {
    auth: {
      getSession: async () => ({ data: { session: { user } }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => ({ error: null }),
    },
    from() {
      throw new Error("a nuvem nao deve ser chamada offline");
    },
    rpc() {
      throw new Error("a RPC nao deve ser chamada offline");
    },
  };
  const repository = createRepository({
    supabaseClient,
    cacheOptions: { indexedDB: null, dbName: `offline-migration-${Date.now()}` },
  });

  try {
    await assert.rejects(
      repository.rpc("migrate_legacy_v3", { p_payload: { migration_id: "test" } }),
      (error) => error instanceof OfflineError,
    );
    assert.deepEqual(await repository.listPendingOperations(), []);
  } finally {
    repository.dispose();
    if (previousNavigator) Object.defineProperty(globalThis, "navigator", previousNavigator);
    else delete globalThis.navigator;
  }
});

test("cache e fila permanecem isolados ao trocar de conta", async () => {
  const dbName = `account-isolation-${Date.now()}`;
  const accountA = await openUserCache("account-a", { indexedDB: null, dbName });
  const accountB = await openUserCache("account-b", { indexedDB: null, dbName });
  await accountA.setSnapshot("orders", [{ id: "a" }]);
  await accountB.setSnapshot("orders", [{ id: "b" }]);
  await accountA.enqueue({ kind: "upsert", idempotencyKey: "only-a", collection: "orders", row: { id: "a" } });

  assert.deepEqual(await accountA.getSnapshot("orders"), [{ id: "a" }]);
  assert.deepEqual(await accountB.getSnapshot("orders"), [{ id: "b" }]);
  assert.equal((await accountA.listQueue()).length, 1);
  assert.equal((await accountB.listQueue()).length, 0);

  await accountA.clearUser();
  assert.deepEqual(await accountB.getSnapshot("orders"), [{ id: "b" }]);
});

test("descartar pendencias restaura a nuvem antes de apagar somente a fila ativa", async () => {
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const network = { onLine: false };
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: network });
  const user = { id: USER_ID };
  const query = (rows = []) => {
    const result = Promise.resolve({ data: rows, error: null });
    const builder = {
      select: () => builder,
      eq: () => builder,
      abortSignal: () => builder,
      then: result.then.bind(result),
      catch: result.catch.bind(result),
      finally: result.finally.bind(result),
    };
    return builder;
  };
  const supabaseClient = {
    auth: {
      getSession: async () => ({ data: { session: { user } }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => ({ error: null }),
    },
    from: (collection) => query(collection === "orders" ? [{ id: "cloud", user_id: USER_ID, version: 1 }] : []),
    rpc: () => query(),
  };
  const repository = createRepository({
    supabaseClient,
    cacheOptions: { indexedDB: null, dbName: `discard-${Date.now()}` },
  });

  try {
    await repository.upsert("orders", { id: "local", customer_name: "Pendente" });
    assert.equal((await repository.listPendingOperations()).length, 1);
    network.onLine = true;
    const result = await repository.discardPendingOperations();
    assert.equal(result.discarded, 1);
    assert.deepEqual(result.snapshot.orders.map((order) => order.id), ["cloud"]);
    assert.deepEqual(await repository.listPendingOperations(), []);
  } finally {
    repository.dispose();
    if (previousNavigator) Object.defineProperty(globalThis, "navigator", previousNavigator);
    else delete globalThis.navigator;
  }
});
