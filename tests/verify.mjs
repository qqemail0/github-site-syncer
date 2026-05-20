import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const required = [
  "server.js",
  "package.json",
  ".github/workflows/deploy-pages.yml",
  "public/index.html",
  "public/CNAME",
  "public/site-config.js",
  "public/assets/styles.css",
  "public/assets/app.js",
  "scripts/build-static-sites.mjs"
];

for (const file of required) {
  const fullPath = path.join(root, file);
  if (!existsSync(fullPath)) {
    throw new Error(`Missing required file: ${file}`);
  }
}

const server = await readFile(path.join(root, "server.js"), "utf8");
const app = await readFile(path.join(root, "public/assets/app.js"), "utf8");
const html = await readFile(path.join(root, "public/index.html"), "utf8");
const readme = await readFile(path.join(root, "README.md"), "utf8");
const config = await readFile(path.join(root, "public/site-config.js"), "utf8");
const cname = await readFile(path.join(root, "public/CNAME"), "utf8");
const workflow = await readFile(path.join(root, ".github/workflows/deploy-pages.yml"), "utf8");
const buildScript = await readFile(path.join(root, "scripts/build-static-sites.mjs"), "utf8");

const checks = [
  [server.includes("repos/${nameWithOwner}/pages"), "server must read GitHub Pages API"],
  [server.includes("/api/sync"), "server must expose sync API"],
  [server.includes("setInterval"), "server must auto-sync"],
  [app.includes("syncPublicGitHub"), "client must support GitHub Pages static mode"],
  [app.includes("loadStaticSnapshot"), "client must prefer GitHub Actions snapshot"],
  [app.includes("fallbackKnownPages"), "client must degrade to known pages when API is rate-limited"],
  [app.includes("api.github.com/users"), "client must read public GitHub API in static mode"],
  [app.includes("previewFrame"), "client must render iframe preview"],
  [app.includes("syncNow"), "client must support manual sync"],
  [html.includes("GitHub 网站同步器"), "HTML title must match product"],
  [html.includes("https://github.com/qqemail0/github-site-syncer"), "HTML must include open source repository link"],
  [html.includes("repo-orb"), "HTML must include top-right circular repository link"],
  [html.includes("source-footer-link"), "HTML must include styled footer repository button"],
  [readme.includes("https://admin.pupwho.eu.org/"), "README must declare deployed GitHub Pages URL"],
  [html.includes("site-config.js"), "HTML must load deployment config"],
  [config.includes("owner: \"qqemail0\""), "config must set default GitHub owner"],
  [config.includes("knownPages"), "config must include known deployed Pages URLs"],
  [config.includes("admin.pupwho.eu.org"), "config must use custom syncer domain"],
  [cname.trim() === "admin.pupwho.eu.org", "CNAME must bind custom syncer domain"],
  [workflow.includes("actions/deploy-pages"), "workflow must deploy to GitHub Pages"],
  [workflow.includes("scripts/build-static-sites.mjs"), "workflow must build static snapshot"],
  [workflow.includes("*/30 * * * *"), "workflow must refresh snapshot on a schedule"],
  [buildScript.includes("sites-static.json"), "build script must emit static snapshot"]
];

for (const [ok, message] of checks) {
  if (!ok) throw new Error(message);
}

console.log("OK: GitHub site syncer files verified.");
