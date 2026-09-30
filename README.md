# fc3d-archive

福彩3D公开资料采集、校验与按期归档项目。

## 第一阶段：第一张图片

固定归档字段：

- 北京字谜
- 太湖一语定胆
- 试机号
- 关注码
- 金码
- 对应码
- 底部关注码
- 底部金码

目录约定：

```text
data/
  2026/
    2026257.md
    2026258.md
raw/
  2026/
    2026258.json
scripts/
  collect.py
  render.py
tests/
  test_golden.py
.github/workflows/
  collect.yml
```

每一期同时保存：

1. 人类可读的 Markdown；
2. 机器可读 JSON；
3. 字段来源、抓取时间、校验状态；
4. 多源冲突时不自动覆盖已验证数据。

## Golden fixture

2026258 期作为第一份人工核验黄金样本：

- 北京：踏霜行
- 太湖：山君坐镇
- 试机号：018
- 关注码：546
- 金码：5
- 对应码：369
- 底部关注码：1、3
- 底部金码：8

自动采集逻辑若无法复现黄金样本，测试必须失败。

## 自动化

GitHub Actions 每日定时运行采集器，也支持手动触发。采集器只提交发生变化的归档文件。

> 本仓库用于公开资料归档与数据溯源。第三方页面可能改版、延迟或失效，因此所有字段都保留来源与验证状态。

## Web 管理面板（panel/）

按期查看采集数据、上传归档微信群每日 21:00 分享的三张预测图、对图核验后一键标记 verified。

架构与 MyInput 相同：Vue3 前端（Cloudflare Pages）→ Hono API（Cloudflare Workers）→ GitHub API 读写本仓库。访问控制由 Cloudflare Access 承担，代码内无鉴权逻辑。

已部署：

- 面板：<https://fc3d.555606.xyz>（Pages 项目 `fc3d-panel`）
- API：<https://fc3d-api.555606.xyz>（Worker `fc3d-api`，secrets：GITHUB_TOKEN/GITHUB_OWNER/GITHUB_REPO）

图片存放约定：`images/YYYY/期号/{1,2,3}.<ext>` 为群图固定槽位，`extra-*.<ext>` 为追加图片；面板通过 `/api/images/...` 代理回源（走 api.github.com，私有仓/国内均可访问）。

### 本地开发

```bash
# 后端（需要 GitHub 凭据，建议 fine-grained PAT 只授权本仓库）
cd panel/backend
npm install
set GITHUB_TOKEN=xxx && set GITHUB_OWNER=suwei8 && set GITHUB_REPO=fc3d-archive
npm run dev          # http://localhost:8787

# 前端
cd panel/frontend
npm install
npm run dev          # http://localhost:5173，/api 已代理到 8787
```

### 部署

```bash
# 后端
cd panel/backend
npx wrangler secret put GITHUB_TOKEN && npx wrangler secret put GITHUB_OWNER && npx wrangler secret put GITHUB_REPO
npm run deploy
# 然后在 Dashboard 给 fc3d-api 绑自定义域名（如 fc3d-api.555606.xyz），并配 Cloudflare Access

# 前端：修改 panel/frontend/.env.production 的 VITE_API_URL 后
cd panel/frontend && npm run deploy   # 或 CF Pages 连接 Git 仓库，Root directory=panel/frontend
```
