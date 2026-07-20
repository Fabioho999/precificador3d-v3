import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const TEST_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const APP_DIRECTORY = resolve(TEST_DIRECTORY, "..");
const EXPECTED_MODULES = [
  "/js/app.js",
  "/js/cache.js",
  "/js/domain.js",
  "/js/migration.js",
  "/js/pdf.js",
  "/js/repository.js",
];

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};

function findEdge() {
  const candidates = [
    process.env.EDGE_PATH,
    process.env["PROGRAMFILES(X86)"] && join(process.env["PROGRAMFILES(X86)"], "Microsoft", "Edge", "Application", "msedge.exe"),
    process.env.PROGRAMFILES && join(process.env.PROGRAMFILES, "Microsoft", "Edge", "Application", "msedge.exe"),
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  ].filter(Boolean);
  return candidates.find(candidate => existsSync(candidate)) || null;
}

function delay(milliseconds) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, milliseconds));
}

async function unusedPort() {
  const server = createNetServer();
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const { port } = server.address();
  await new Promise(resolveClose => server.close(resolveClose));
  return port;
}

async function startStaticServer(rootDirectory) {
  const requestedPaths = new Set();
  const normalizedRoot = resolve(rootDirectory);
  const rootPrefix = `${normalizedRoot}${sep}`;
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url || "/", "http://127.0.0.1").pathname);
      requestedPaths.add(pathname);
      const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
      const filePath = resolve(normalizedRoot, relativePath);
      if (filePath !== normalizedRoot && !filePath.startsWith(rootPrefix)) {
        response.writeHead(403).end("Forbidden");
        return;
      }
      const fileStats = await stat(filePath);
      if (!fileStats.isFile()) throw new Error("Not a file");
      const body = await readFile(filePath);
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-type": MIME_TYPES[extname(filePath).toLowerCase()] || "application/octet-stream",
      });
      response.end(body);
    } catch {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found");
    }
  });
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  return {
    server,
    requestedPaths,
    url: `http://127.0.0.1:${server.address().port}/`,
  };
}

async function waitForDebugger(port, browser, browserOutput) {
  const deadline = Date.now() + 15_000;
  const endpoint = `http://127.0.0.1:${port}/json/list`;
  while (Date.now() < deadline) {
    if (browser.exitCode !== null) {
      throw new Error(`Edge encerrou antes de abrir o DevTools.\n${browserOutput()}`);
    }
    try {
      const response = await fetch(endpoint, { signal: AbortSignal.timeout(700) });
      if (response.ok) {
        const targets = await response.json();
        const page = targets.find(target => target.type === "page" && target.webSocketDebuggerUrl);
        if (page) return page.webSocketDebuggerUrl;
      }
    } catch {
      // O processo ainda pode estar inicializando.
    }
    await delay(100);
  }
  throw new Error(`Edge não expôs o DevTools dentro do prazo.\n${browserOutput()}`);
}

class CdpClient {
  constructor(webSocketUrl) {
    this.webSocketUrl = webSocketUrl;
    this.socket = null;
    this.sequence = 0;
    this.pending = new Map();
    this.listeners = new Map();
    this.backgroundErrors = [];
  }

  async connect() {
    this.socket = new WebSocket(this.webSocketUrl);
    this.socket.addEventListener("message", event => this.#handleMessage(event));
    await new Promise((resolveOpen, reject) => {
      this.socket.addEventListener("open", resolveOpen, { once: true });
      this.socket.addEventListener("error", () => reject(new Error("Falha ao conectar ao Chrome DevTools Protocol.")), { once: true });
    });
  }

  on(method, listener) {
    const current = this.listeners.get(method) || [];
    current.push(listener);
    this.listeners.set(method, current);
  }

  send(method, params = {}) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error(`CDP desconectado ao chamar ${method}.`));
    }
    const id = ++this.sequence;
    return new Promise((resolveCommand, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Tempo esgotado no comando CDP ${method}.`));
      }, 10_000);
      this.pending.set(id, { method, resolveCommand, reject, timeout });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const response = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (response.exceptionDetails) {
      throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text || "Falha na avaliação do navegador.");
    }
    return response.result?.value;
  }

  async close() {
    if (!this.socket) return;
    if (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING) {
      this.socket.close();
      await Promise.race([
        new Promise(resolveClose => this.socket.addEventListener("close", resolveClose, { once: true })),
        delay(500),
      ]);
    }
  }

  #handleMessage(event) {
    let message;
    try {
      message = JSON.parse(typeof event.data === "string" ? event.data : Buffer.from(event.data).toString("utf8"));
    } catch (error) {
      this.backgroundErrors.push(error);
      return;
    }
    if (message.id) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timeout);
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`));
      else pending.resolveCommand(message.result || {});
      return;
    }
    for (const listener of this.listeners.get(message.method) || []) {
      Promise.resolve()
        .then(() => listener(message.params || {}))
        .catch(error => this.backgroundErrors.push(error));
    }
  }
}

async function waitForExpression(client, expression, description, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      if (await client.evaluate(expression)) return;
    } catch (error) {
      lastError = error;
    }
    await delay(50);
  }
  throw new Error(`Tempo esgotado aguardando ${description}.${lastError ? ` ${lastError.message}` : ""}`);
}

async function stopBrowser(browser) {
  if (!browser || browser.exitCode !== null) return;
  const exited = new Promise(resolveExit => browser.once("exit", resolveExit));
  browser.kill();
  await Promise.race([exited, delay(2_000)]);
  if (browser.exitCode === null) browser.kill("SIGKILL");
}

const edgePath = findEdge();

test("V4 carrega módulos e funciona no viewport móvel", {
  skip: edgePath ? false : "Microsoft Edge não encontrado; smoke test de navegador ignorado.",
  timeout: 45_000,
}, async () => {
  let browser;
  let client;
  let staticServer;
  let profileDirectory;
  let browserLogs = "";
  const javascriptExceptions = [];

  try {
    staticServer = await startStaticServer(APP_DIRECTORY);
    const debuggerPort = await unusedPort();
    profileDirectory = await mkdtemp(join(tmpdir(), "precificador-v4-edge-"));
    browser = spawn(edgePath, [
      "--headless=new",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-default-apps",
      "--disable-extensions",
      "--disable-features=Translate,MediaRouter",
      "--disable-gpu",
      "--no-default-browser-check",
      "--no-first-run",
      `--remote-debugging-port=${debuggerPort}`,
      "--remote-allow-origins=*",
      `--user-data-dir=${profileDirectory}`,
      "about:blank",
    ], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const appendBrowserLog = chunk => {
      browserLogs = `${browserLogs}${chunk}`.slice(-8_000);
    };
    browser.stdout.on("data", appendBrowserLog);
    browser.stderr.on("data", appendBrowserLog);

    const webSocketUrl = await waitForDebugger(debuggerPort, browser, () => browserLogs);
    client = new CdpClient(webSocketUrl);
    await client.connect();
    client.on("Runtime.exceptionThrown", event => javascriptExceptions.push(event.exceptionDetails));
    client.on("Fetch.requestPaused", async event => {
      await client.send("Fetch.fulfillRequest", {
        requestId: event.requestId,
        responseCode: 200,
        responseHeaders: [{ name: "Content-Type", value: "text/javascript; charset=utf-8" }],
        body: Buffer.from("// Supabase omitido intencionalmente no smoke test offline.\n").toString("base64"),
      });
    });

    await client.send("Page.enable");
    await client.send("Runtime.enable");
    await client.send("Fetch.enable", {
      patterns: [{ urlPattern: "https://cdn.jsdelivr.net/*", requestStage: "Request" }],
    });
    await client.send("Emulation.setDeviceMetricsOverride", {
      width: 412,
      height: 915,
      deviceScaleFactor: 1,
      mobile: true,
      screenWidth: 412,
      screenHeight: 915,
    });
    await client.send("Page.navigate", { url: staticServer.url });

    await waitForExpression(
      client,
      `document.readyState === "complete" && document.querySelectorAll("#tab-dashboard .card").length >= 4`,
      "a renderização inicial da V4",
    );

    for (const modulePath of EXPECTED_MODULES) {
      assert.ok(staticServer.requestedPaths.has(modulePath), `O navegador deve carregar o módulo real ${modulePath}.`);
    }

    const structure = await client.evaluate(`(() => ({
      tabs: document.querySelectorAll("#tabs button[data-tab]").length,
      panels: document.querySelectorAll("main > .panel").length,
      panelIds: [...document.querySelectorAll("main > .panel")].map(panel => panel.id),
    }))()`);
    assert.equal(structure.tabs, 8, "A navegação deve conter oito abas funcionais.");
    assert.equal(structure.panels, 8, "A aplicação deve conter oito painéis de conteúdo.");
    assert.equal(new Set(structure.panelIds).size, 8, "Cada painel deve possuir um ID único.");

    await client.evaluate(`document.querySelector('#tabs button[data-tab="quote"]').click()`);
    const quoteState = await client.evaluate(`(() => ({
      tabActive: document.querySelector('#tabs button[data-tab="quote"]').classList.contains("active"),
      panelActive: document.querySelector("#tab-quote").classList.contains("active"),
      dashboardInactive: !document.querySelector("#tab-dashboard").classList.contains("active"),
    }))()`);
    assert.deepEqual(quoteState, { tabActive: true, panelActive: true, dashboardInactive: true });

    const mobileAccount = await client.evaluate(`(() => {
      const button = document.querySelector("#mobileAccountButton");
      const style = getComputedStyle(button);
      const rect = button.getBoundingClientRect();
      return {
        text: button.textContent.trim(),
        visible: style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0,
      };
    })()`);
    assert.equal(mobileAccount.text, "Entrar");
    assert.equal(mobileAccount.visible, true, "O botão móvel Entrar deve estar visível em 412 px.");

    await client.evaluate(`document.querySelector("#mobileAccountButton").click()`);
    await waitForExpression(client, `document.querySelector("#authDialog").open === true`, "a abertura do diálogo de autenticação");
    assert.equal(await client.evaluate(`document.querySelector("#authDialog").open`), true);

    await delay(200);
    assert.deepEqual(client.backgroundErrors, [], "O cliente CDP não deve registrar erros em segundo plano.");
    assert.equal(
      javascriptExceptions.length,
      0,
      `A página não deve lançar exceções JavaScript: ${JSON.stringify(javascriptExceptions)}`,
    );
  } finally {
    await client?.close().catch(() => {});
    await stopBrowser(browser).catch(() => {});
    if (staticServer?.server) {
      await new Promise(resolveClose => staticServer.server.close(resolveClose));
    }
    if (profileDirectory) await rm(profileDirectory, { recursive: true, force: true }).catch(() => {});
  }
});
