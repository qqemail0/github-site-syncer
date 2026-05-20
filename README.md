# GitHub 网站同步器

一个本地 GitHub Pages 控制台：自动读取当前 GitHub CLI 登录账号，扫描已启用 GitHub Pages 的仓库，显示线上地址、部署状态、HTTPS 状态和网页预览。

## 运行

```powershell
npm start
```

默认地址：

```text
http://127.0.0.1:8091/
```

## 配置

可选环境变量：

- `PORT`: 本地服务端口，默认 `8091`
- `SYNC_INTERVAL_MS`: 自动同步间隔，默认 `60000`
- `GITHUB_OWNER`: 指定要扫描的 GitHub 用户或组织；不设置时自动读取当前 `gh` 登录账号
- `GITHUB_REPO_LIMIT`: 仓库扫描上限，默认 `200`
- `GH_PATH`: GitHub CLI 可执行文件路径

## 说明

这个工具需要在本机运行，因为它依赖 GitHub CLI 的登录状态来读取你的 GitHub Pages 和 Actions 数据。纯 GitHub Pages 静态网站不能安全地直接读取你的私有 GitHub 授权信息。

## 部署到 GitHub Pages

仓库内置了 `.github/workflows/deploy-pages.yml`。推送到 GitHub 后，在仓库 Pages 设置里选择 GitHub Actions，工作流会把 `public/` 部署为静态站点。

线上静态版会自动切换为公开 API 模式：

- 可扫描公开仓库的 GitHub Pages 部署信号
- 可预览公开 Pages 网站
- 不读取私有仓库
- 不暴露 GitHub Token

如果要修改默认账号，编辑 `public/site-config.js` 里的 `owner`。

为避免浏览器端 GitHub API 触发未授权限流，部署工作流会先运行 `scripts/build-static-sites.mjs`，生成 `public/sites-static.json`。线上页面优先读取这个快照；工作流每 30 分钟自动刷新一次，也可以在 Actions 页面手动运行。
