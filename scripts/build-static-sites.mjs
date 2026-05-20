import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const publicDir = path.join(root, "public");
const configFile = path.join(publicDir, "site-config.js");
const outputFile = path.join(publicDir, "sites-static.json");
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";

async function loadConfig() {
  const source = await fs.readFile(configFile, "utf8");
  const sandbox = { window: {} };
  vm.runInNewContext(source, sandbox, { filename: "site-config.js" });
  return sandbox.window.SITE_SYNCER_CONFIG || {};
}

async function githubJson(url) {
  const response = await fetch(url, {
    headers: {
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "github-site-syncer-build/1.0",
      ...(token ? { authorization: `Bearer ${token}` } : {})
    }
  });

  if (!response.ok) {
    throw new Error(`GitHub API ${response.status}: ${url}`);
  }

  return response.json();
}

async function rawText(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "github-site-syncer-build/1.0"
    }
  });
  return response.ok ? response.text() : "";
}

async function mapLimit(items, limit, worker) {
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

async function readCname(owner, repo) {
  const refs = Array.from(new Set([repo.default_branch, "main", "master", "gh-pages"].filter(Boolean)));

  for (const ref of refs) {
    for (const file of ["CNAME", "public/CNAME"]) {
      const raw = await rawText(`https://raw.githubusercontent.com/${owner}/${repo.name}/${ref}/${file}`);
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

async function siteFromRepo(owner, repo, config) {
  const known = config.knownPages && config.knownPages[repo.full_name] ? config.knownPages[repo.full_name] : null;
  const [deployments, runs, cname] = await Promise.all([
    githubJson(`https://api.github.com/repos/${owner}/${repo.name}/deployments?environment=github-pages&per_page=1`).catch(() => []),
    githubJson(`https://api.github.com/repos/${owner}/${repo.name}/actions/runs?per_page=1`).catch(() => ({ workflow_runs: [] })),
    readCname(owner, repo).catch(() => "")
  ]);

  const hasPagesSignal = Boolean(known) || Boolean(cname) || (Array.isArray(deployments) && deployments.length > 0) || repo.name.toLowerCase() === `${owner.toLowerCase()}.github.io`;
  if (!hasPagesSignal) return null;

  const deployment = Array.isArray(deployments) ? deployments[0] : null;
  const run = runs.workflow_runs && runs.workflow_runs[0];
  const pagesUrl = known && known.pagesUrl ? known.pagesUrl : fallbackPagesUrl(owner, repo, cname);

  return {
    nameWithOwner: repo.full_name,
    repoUrl: repo.html_url,
    description: repo.description || "",
    isPrivate: false,
    pushedAt: repo.pushed_at,
    language: repo.language || null,
    pagesUrl,
    cname: known && Object.prototype.hasOwnProperty.call(known, "cname") ? known.cname : cname,
    status: deployment && deployment.state ? deployment.state : "public",
    buildType: "actions-static-snapshot",
    httpsEnforced: known && Object.prototype.hasOwnProperty.call(known, "httpsEnforced") ? Boolean(known.httpsEnforced) : true,
    source: {
      branch: repo.default_branch,
      path: "/"
    },
    latestRun: normalizeRun(run),
    live: {
      ok: true,
      status: null,
      staticOnly: true,
      checkedAt: new Date().toISOString()
    }
  };
}

async function main() {
  const config = await loadConfig();
  const owner = process.env.GITHUB_OWNER || config.owner || "qqemail0";
  const limit = Number(process.env.GITHUB_REPO_LIMIT || config.repoLimit || 80);
  const repos = await githubJson(`https://api.github.com/users/${owner}/repos?per_page=${Math.min(limit, 100)}&sort=pushed&type=owner`);
  const sites = await mapLimit(repos.slice(0, limit), 5, (repo) => siteFromRepo(owner, repo, config));
  const now = new Date().toISOString();

  const payload = {
    account: owner,
    syncedAt: now,
    ghPath: "GitHub Actions static snapshot",
    repoLimit: limit,
    sync: {
      running: false,
      lastError: null,
      lastStartedAt: now,
      intervalMs: 30 * 60 * 1000
    },
    sites: sites
      .filter(Boolean)
      .sort((a, b) => new Date(b.pushedAt || 0) - new Date(a.pushedAt || 0))
  };

  await fs.writeFile(outputFile, JSON.stringify(payload, null, 2), "utf8");
  console.log(`Wrote ${payload.sites.length} GitHub Pages sites to ${path.relative(root, outputFile)}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
