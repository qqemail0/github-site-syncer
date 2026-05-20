const state = {
  payload: null,
  sites: [],
  selectedUrl: localStorage.getItem("selectedPagesUrl") || "",
  query: "",
  syncing: false,
  backendAvailable: null,
  source: "local"
};

const config = window.SITE_SYNCER_CONFIG || {};

const els = {
  searchInput: document.querySelector("#searchInput"),
  syncButton: document.querySelector("#syncButton"),
  totalSites: document.querySelector("#totalSites"),
  onlineSites: document.querySelector("#onlineSites"),
  customDomains: document.querySelector("#customDomains"),
  lastSync: document.querySelector("#lastSync"),
  syncBadge: document.querySelector("#syncBadge"),
  accountName: document.querySelector("#accountName"),
  siteList: document.querySelector("#siteList"),
  template: document.querySelector("#siteItemTemplate"),
  selectedRepo: document.querySelector("#selectedRepo"),
  selectedTitle: document.querySelector("#selectedTitle"),
  selectedUrl: document.querySelector("#selectedUrl"),
  pagesStatus: document.querySelector("#pagesStatus"),
  httpsStatus: document.querySelector("#httpsStatus"),
  deployStatus: document.querySelector("#deployStatus"),
  liveStatus: document.querySelector("#liveStatus"),
  openSite: document.querySelector("#openSite"),
  openRepo: document.querySelector("#openRepo"),
  openActions: document.querySelector("#openActions"),
  previewFrame: document.querySelector("#previewFrame"),
  emptyState: document.querySelector("#emptyState")
};

function formatDate(value) {
  if (!value) return "尚未同步";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    hour12: false,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function deployText(run) {
  if (!run) return "无记录";
  if (run.error) return "读取失败";
  const conclusion = run.conclusion || run.status || "unknown";
  if (conclusion === "success") return "成功";
  if (conclusion === "failure") return "失败";
  if (conclusion === "cancelled") return "已取消";
  if (conclusion === "in_progress" || run.status === "in_progress") return "部署中";
  if (run.status === "queued") return "排队中";
  return conclusion;
}

function liveText(live) {
  if (!live) return "未探测";
  if (live.staticOnly) return "可预览";
  if (live.ok) return `HTTP ${live.status}`;
  if (live.error) return "不可访问";
  return live.status ? `HTTP ${live.status}` : "未知";
}

function statusClass(site) {
  if (site.live && site.live.ok) return "ok";
  if (site.latestRun && site.latestRun.conclusion === "failure") return "fail";
  return "warn";
}

function filteredSites() {
  const q = state.query.trim().toLowerCase();
  if (!q) return state.sites;
  return state.sites.filter((site) => [
    site.nameWithOwner,
    site.pagesUrl,
    site.cname,
    site.status,
    deployText(site.latestRun),
    liveText(site.live)
  ].join(" ").toLowerCase().includes(q));
}

function setLink(el, href) {
  if (!href) {
    el.href = "#";
    el.classList.add("disabled");
    return;
  }
  el.href = href;
  el.classList.remove("disabled");
}

function selectSite(site) {
  if (!site) {
    els.selectedRepo.textContent = "选择一个站点";
    els.selectedTitle.textContent = "线上网页预览";
    els.selectedUrl.textContent = "同步后会在这里显示你 GitHub 上部署的网页。";
    els.pagesStatus.textContent = "-";
    els.httpsStatus.textContent = "-";
    els.deployStatus.textContent = "-";
    els.liveStatus.textContent = "-";
    setLink(els.openSite, "");
    setLink(els.openRepo, "");
    setLink(els.openActions, "");
    els.previewFrame.src = "about:blank";
    els.emptyState.classList.remove("hidden");
    return;
  }

  state.selectedUrl = site.pagesUrl;
  localStorage.setItem("selectedPagesUrl", site.pagesUrl);
  els.selectedRepo.textContent = site.nameWithOwner;
  els.selectedTitle.textContent = site.cname || site.nameWithOwner.split("/").pop();
  els.selectedUrl.textContent = site.pagesUrl;
  els.pagesStatus.textContent = site.status || "已启用";
  els.httpsStatus.textContent = site.httpsEnforced ? "强制 HTTPS" : "未强制";
  els.deployStatus.textContent = deployText(site.latestRun);
  els.liveStatus.textContent = liveText(site.live);
  setLink(els.openSite, site.pagesUrl);
  setLink(els.openRepo, site.repoUrl);
  setLink(els.openActions, site.latestRun && site.latestRun.url);
  els.previewFrame.src = site.pagesUrl || "about:blank";
  els.emptyState.classList.add("hidden");
  renderSites();
}

function renderMetrics() {
  const sites = state.sites;
  els.totalSites.textContent = String(sites.length);
  els.onlineSites.textContent = String(sites.filter((site) => site.live && site.live.ok).length);
  els.customDomains.textContent = String(sites.filter((site) => site.cname).length);
  els.accountName.textContent = state.payload && state.payload.account ? `@${state.payload.account}` : "未连接";
  els.lastSync.textContent = formatDate(state.payload && state.payload.syncedAt);
}

function renderSyncBadge() {
  const sync = state.payload && state.payload.sync;
  els.syncButton.disabled = state.syncing || (sync && sync.running);
  els.syncBadge.classList.toggle("error", Boolean(sync && sync.lastError));

  if (state.syncing || (sync && sync.running)) {
    els.syncBadge.textContent = "同步中";
    els.syncButton.textContent = "同步中...";
    return;
  }

  els.syncButton.textContent = "立即同步";
  if (sync && sync.lastError) {
    els.syncBadge.textContent = "同步异常";
    return;
  }

  els.syncBadge.textContent = state.source === "github-public" ? "公开 API" : "自动同步";
}

function renderSites() {
  const sites = filteredSites();
  els.siteList.innerHTML = "";

  if (!sites.length) {
    const empty = document.createElement("div");
    empty.className = "empty-list";
    empty.textContent = state.sites.length ? "没有匹配的站点" : "暂未发现 GitHub Pages 站点";
    els.siteList.append(empty);
    return;
  }

  for (const site of sites) {
    const node = els.template.content.firstElementChild.cloneNode(true);
    node.classList.toggle("active", site.pagesUrl === state.selectedUrl);
    node.querySelector(".status-dot").classList.add(statusClass(site));
    node.querySelector(".site-name").textContent = site.nameWithOwner;
    node.querySelector(".site-url").textContent = site.pagesUrl;
    node.querySelector(".site-meta").textContent = `${deployText(site.latestRun)} / ${liveText(site.live)} / ${formatDate(site.pushedAt)}`;
    node.addEventListener("click", () => selectSite(site));
    els.siteList.append(node);
  }
}

function render() {
  renderMetrics();
  renderSyncBadge();
  renderSites();
  const selected = state.sites.find((site) => site.pagesUrl === state.selectedUrl) || state.sites[0];
  if (selected && els.previewFrame.src === "about:blank") {
    selectSite(selected);
  } else if (!selected) {
    selectSite(null);
  }
}

async function loadSites() {
  if (config.staticMode || state.backendAvailable === false || location.hostname.endsWith("github.io")) {
    await syncPublicGitHub(false);
    return;
  }

  try {
    const response = await fetch("/api/sites", { cache: "no-store" });
    if (!response.ok) throw new Error(`Local API returned ${response.status}`);
    state.payload = await response.json();
    state.backendAvailable = true;
    state.source = "local";
    state.sites = state.payload.sites || [];
    render();
  } catch {
    state.backendAvailable = false;
    await syncPublicGitHub(false);
  }
}

async function syncNow() {
  state.syncing = true;
  renderSyncBadge();
  try {
    if (config.staticMode || state.backendAvailable === false || location.hostname.endsWith("github.io")) {
      await syncPublicGitHub(true);
      return;
    }
    const response = await fetch("/api/sync", { cache: "no-store" });
    if (!response.ok) throw new Error(`Local API returned ${response.status}`);
    state.payload = await response.json();
    state.backendAvailable = true;
    state.source = "local";
    state.sites = state.payload.sites || [];
    render();
  } catch (error) {
    state.backendAvailable = false;
    try {
      await syncPublicGitHub(true);
    } catch (publicError) {
      state.payload = state.payload || {};
      state.payload.sync = {
        lastError: publicError.message || error.message || String(error)
      };
      renderSyncBadge();
    }
  } finally {
    state.syncing = false;
    renderSyncBadge();
  }
}

function apiHeaders() {
  return {
    "accept": "application/vnd.github+json",
    "x-github-api-version": "2022-11-28"
  };
}

async function githubJson(url) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: apiHeaders()
  });
  if (!response.ok) {
    throw new Error(`GitHub API ${response.status}`);
  }
  return response.json();
}

async function githubText(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) return "";
  return response.text();
}

async function readCname(owner, repo) {
  const refs = Array.from(new Set([repo.default_branch, "main", "master", "gh-pages"].filter(Boolean)));
  for (const ref of refs) {
    for (const file of ["CNAME", "public/CNAME"]) {
      const raw = await githubText(`https://raw.githubusercontent.com/${owner}/${repo.name}/${ref}/${file}`);
      const cname = raw.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
      if (cname && /^[a-z0-9.-]+$/i.test(cname)) return cname;
    }
  }
  return "";
}

function fallbackPagesUrl(owner, repo, cname) {
  if (cname) return `https://${cname}/`;
  if (repo.name.toLowerCase() === `${owner.toLowerCase()}.github.io`) {
    return `https://${owner}.github.io/`;
  }
  return `https://${owner}.github.io/${repo.name}/`;
}

async function publicSiteFromRepo(owner, repo) {
  const known = config.knownPages && config.knownPages[repo.full_name] ? config.knownPages[repo.full_name] : null;
  const [deployments, runs, cname] = await Promise.all([
    githubJson(`https://api.github.com/repos/${owner}/${repo.name}/deployments?environment=github-pages&per_page=1`).catch(() => []),
    githubJson(`https://api.github.com/repos/${owner}/${repo.name}/actions/runs?per_page=1`).catch(() => ({ workflow_runs: [] })),
    readCname(owner, repo).catch(() => "")
  ]);

  const hasPagesSignal = Boolean(known) || Boolean(cname) || (Array.isArray(deployments) && deployments.length > 0) || repo.name.toLowerCase() === `${owner.toLowerCase()}.github.io`;
  if (!hasPagesSignal) return null;

  const run = runs.workflow_runs && runs.workflow_runs[0];
  const deployment = Array.isArray(deployments) ? deployments[0] : null;

  return {
    nameWithOwner: repo.full_name,
    repoUrl: repo.html_url,
    description: repo.description || "",
    isPrivate: false,
    pushedAt: repo.pushed_at,
    language: repo.language || null,
    pagesUrl: known && known.pagesUrl ? known.pagesUrl : fallbackPagesUrl(owner, repo, cname),
    cname: known && Object.prototype.hasOwnProperty.call(known, "cname") ? known.cname : cname,
    status: deployment && deployment.state ? deployment.state : "public",
    buildType: "static-public",
    httpsEnforced: known && Object.prototype.hasOwnProperty.call(known, "httpsEnforced") ? Boolean(known.httpsEnforced) : true,
    source: {
      branch: repo.default_branch,
      path: "/"
    },
    latestRun: run ? {
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
    } : null,
    live: {
      ok: true,
      status: null,
      staticOnly: true,
      checkedAt: new Date().toISOString()
    }
  };
}

async function publicMapLimit(items, limit, worker) {
  const results = [];
  let cursor = 0;

  async function next() {
    const index = cursor;
    cursor += 1;
    if (index >= items.length) return;
    results[index] = await worker(items[index]);
    await next();
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, next));
  return results;
}

async function syncPublicGitHub(force) {
  state.source = "github-public";
  const owner = new URLSearchParams(location.search).get("owner") || config.owner || "qqemail0";
  const limit = Number(config.repoLimit || 80);
  const repos = await githubJson(`https://api.github.com/users/${owner}/repos?per_page=${Math.min(limit, 100)}&sort=pushed&type=owner`);
  const sites = await publicMapLimit(repos.slice(0, limit), 4, (repo) => publicSiteFromRepo(owner, repo));
  state.payload = {
    account: owner,
    syncedAt: new Date().toISOString(),
    ghPath: "GitHub public API",
    repoLimit: limit,
    sync: {
      running: false,
      lastError: null,
      lastStartedAt: force ? new Date().toISOString() : null,
      intervalMs: 60_000
    },
    sites: sites
      .filter(Boolean)
      .sort((a, b) => new Date(b.pushedAt || 0) - new Date(a.pushedAt || 0))
  };
  state.sites = state.payload.sites;
  render();
}

els.searchInput.addEventListener("input", (event) => {
  state.query = event.target.value;
  renderSites();
});

els.syncButton.addEventListener("click", () => {
  syncNow();
});

loadSites()
  .then(() => {
    if (!state.sites.length) return syncNow();
    return null;
  })
  .catch(() => syncNow());

setInterval(loadSites, 15_000);
