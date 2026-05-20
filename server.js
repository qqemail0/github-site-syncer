const http = require("node:http");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");

const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const DATA_DIR = path.join(ROOT_DIR, "data");
const CACHE_FILE = path.join(DATA_DIR, "sites.json");
const PORT = Number(process.env.PORT || 8091);
const SYNC_INTERVAL_MS = Number(process.env.SYNC_INTERVAL_MS || 60_000);
const REPO_LIMIT = Number(process.env.GITHUB_REPO_LIMIT || 200);

let ghExecutable;
let syncPromise = null;
const syncState = {
  running: false,
  lastError: null,
  lastStartedAt: null,
  intervalMs: SYNC_INTERVAL_MS
};

function findGhExecutable() {
  if (ghExecutable) return ghExecutable;

  const candidates = [
    process.env.GH_PATH,
    process.env.GITHUB_CLI_PATH,
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Microsoft", "WinGet", "Links", "gh.exe"),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Microsoft", "WindowsApps", "gh.exe"),
    "C:\\Program Files\\GitHub CLI\\gh.exe",
    "C:\\Program Files (x86)\\GitHub CLI\\gh.exe"
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fsSync.existsSync(candidate)) {
      ghExecutable = candidate;
      return ghExecutable;
    }
  }

  ghExecutable = "gh";
  return ghExecutable;
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, {
      cwd: ROOT_DIR,
      windowsHide: true,
      timeout: options.timeout || 45_000,
      maxBuffer: options.maxBuffer || 1024 * 1024 * 20,
      env: process.env
    }, (error, stdout, stderr) => {
      if (error) {
        const detail = stderr || stdout || error.message;
        reject(new Error(detail.trim()));
        return;
      }
      resolve(stdout.trim());
    });
  });
}

async function gh(args, options) {
  return run(findGhExecutable(), args, options);
}

async function ghJson(args, options) {
  const output = await gh(args, options);
  return output ? JSON.parse(output) : null;
}

async function detectAccount() {
  const login = await gh(["api", "user", "--jq", ".login"], { timeout: 20_000 });
  return login || "unknown";
}

async function mapLimit(items, limit, worker) {
  const results = [];
  let index = 0;

  async function next() {
    const currentIndex = index;
    index += 1;
    if (currentIndex >= items.length) return;
    results[currentIndex] = await worker(items[currentIndex], currentIndex);
    await next();
  }

  const runners = Array.from({ length: Math.min(limit, items.length) }, next);
  await Promise.all(runners);
  return results;
}

function makePagesUrl(pages) {
  const raw = pages.html_url || pages.url || (pages.cname ? `https://${pages.cname}` : "");
  if (!raw) return "";
  return raw.endsWith("/") ? raw : `${raw}/`;
}

function normalizeRun(run) {
  if (!run) return null;
  return {
    id: run.id,
    name: run.name,
    displayTitle: run.display_title,
    status: run.status,
    conclusion: run.conclusion,
    event: run.event,
    branch: run.head_branch,
    createdAt: run.created_at,
    updatedAt: run.updated_at,
    url: run.html_url
  };
}

async function readCache() {
  try {
    const raw = await fs.readFile(CACHE_FILE, "utf8");
    return JSON.parse(raw);
  } catch {
    return {
      account: null,
      syncedAt: null,
      ghPath: findGhExecutable(),
      sites: []
    };
  }
}

async function writeCache(payload) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(CACHE_FILE, JSON.stringify(payload, null, 2), "utf8");
}

async function getPages(nameWithOwner) {
  try {
    return await ghJson(["api", `repos/${nameWithOwner}/pages`], { timeout: 25_000 });
  } catch (error) {
    const message = String(error.message || "");
    if (message.includes("404") || message.includes("Not Found")) return null;
    return { error: message };
  }
}

async function getLatestRun(nameWithOwner) {
  try {
    const result = await ghJson(["api", `repos/${nameWithOwner}/actions/runs?per_page=1`], { timeout: 25_000 });
    return normalizeRun(result && result.workflow_runs && result.workflow_runs[0]);
  } catch (error) {
    return {
      error: String(error.message || "Cannot read workflow run")
    };
  }
}

async function probeUrl(url) {
  if (!url || typeof fetch !== "function") {
    return { ok: false, status: null, checkedAt: new Date().toISOString() };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);

  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": "github-site-syncer/1.0"
      }
    });
    return {
      ok: response.ok,
      status: response.status,
      finalUrl: response.url,
      checkedAt: new Date().toISOString()
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      error: String(error.message || error),
      checkedAt: new Date().toISOString()
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function syncSites() {
  if (syncPromise) return syncPromise;

  syncPromise = (async () => {
    syncState.running = true;
    syncState.lastError = null;
    syncState.lastStartedAt = new Date().toISOString();

    try {
      const account = process.env.GITHUB_OWNER || await detectAccount();
      const repos = await ghJson([
        "repo",
        "list",
        account,
        "--limit",
        String(REPO_LIMIT),
        "--json",
        "nameWithOwner,url,isPrivate,pushedAt,description,primaryLanguage"
      ], { timeout: 45_000 });

      const sites = await mapLimit(repos || [], 5, async (repo) => {
        const pages = await getPages(repo.nameWithOwner);
        if (!pages) return null;

        const latestRun = await getLatestRun(repo.nameWithOwner);
        const pagesUrl = makePagesUrl(pages);
        const live = await probeUrl(pagesUrl);

        return {
          nameWithOwner: repo.nameWithOwner,
          repoUrl: repo.url,
          description: repo.description || "",
          isPrivate: Boolean(repo.isPrivate),
          pushedAt: repo.pushedAt,
          language: repo.primaryLanguage && repo.primaryLanguage.name ? repo.primaryLanguage.name : null,
          pagesUrl,
          cname: pages.cname || "",
          status: pages.status || "",
          buildType: pages.build_type || "",
          httpsEnforced: Boolean(pages.https_enforced),
          source: pages.source || null,
          latestRun,
          live
        };
      });

      const payload = {
        account,
        syncedAt: new Date().toISOString(),
        ghPath: findGhExecutable(),
        repoLimit: REPO_LIMIT,
        sync: { ...syncState, running: false },
        sites: sites
          .filter(Boolean)
          .sort((a, b) => new Date(b.pushedAt || 0) - new Date(a.pushedAt || 0))
      };

      await writeCache(payload);
      return payload;
    } catch (error) {
      syncState.lastError = String(error.message || error);
      const cache = await readCache();
      cache.sync = { ...syncState, running: false };
      return cache;
    } finally {
      syncState.running = false;
      syncPromise = null;
    }
  })();

  return syncPromise;
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(JSON.stringify(payload, null, 2));
}

async function sendStatic(request, response, url) {
  const safePath = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const resolved = path.normalize(path.join(PUBLIC_DIR, safePath));

  if (!resolved.startsWith(PUBLIC_DIR)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const data = await fs.readFile(resolved);
    const ext = path.extname(resolved).toLowerCase();
    const contentTypes = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".svg": "image/svg+xml"
    };
    response.writeHead(200, {
      "content-type": contentTypes[ext] || "application/octet-stream",
      "cache-control": ext === ".html" ? "no-store" : "public, max-age=300"
    });
    response.end(data);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
}

async function handleRequest(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || "127.0.0.1"}`);

  if (url.pathname === "/api/health") {
    sendJson(response, 200, {
      ok: true,
      ghPath: findGhExecutable(),
      sync: syncState
    });
    return;
  }

  if (url.pathname === "/api/sites") {
    const cache = await readCache();
    cache.sync = { ...syncState, running: Boolean(syncPromise || syncState.running) };
    sendJson(response, 200, cache);
    return;
  }

  if (url.pathname === "/api/sync") {
    const payload = await syncSites();
    payload.sync = { ...syncState, running: false };
    sendJson(response, 200, payload);
    return;
  }

  await sendStatic(request, response, url);
}

const server = http.createServer((request, response) => {
  handleRequest(request, response).catch((error) => {
    sendJson(response, 500, {
      error: String(error.message || error)
    });
  });
});

server.listen(PORT, () => {
  console.log(`GitHub site syncer running at http://127.0.0.1:${PORT}/`);
  syncSites().catch((error) => {
    syncState.lastError = String(error.message || error);
  });
});

setInterval(() => {
  syncSites().catch((error) => {
    syncState.lastError = String(error.message || error);
  });
}, SYNC_INTERVAL_MS);
