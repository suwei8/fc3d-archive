# fc3d-archive

福彩3D公开资料采集、校验与按期归档项目。

## 第一阶段：第一张图片

固定归档字段：

- 北京字谜
- 另版北京字谜（牛彩网同期发布的第二版本，群图偶尔采用此版）
- 太湖一语定胆
- 试机号
- 关注码
- 金码
- 对应码
- 底部关注码
- 底部金码
- 开奖号（draw_result，开奖后补采，已收录不覆盖）

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

GitHub Actions 定时运行采集器（`.github/workflows/collect.yml`），也支持手动触发。采集器只提交发生变化的归档文件。

- 北京时间 **18:00**：采集当日字谜数据；19:25 / 20:25 两次兜底容忍上游延迟
- 北京时间 **21:30 / 22:10**：当天 21:15 开奖后运行同一流程，天齐表第 8 列回填缺失的开奖号

> 本仓库用于公开资料归档与数据溯源。第三方页面可能改版、延迟或失效，因此所有字段都保留来源与验证状态。

## Web 管理面板（panel/）

按期查看采集数据、上传归档微信群每日 21:00 分享的三张预测图、对图核验后一键标记 verified。群图与采集值不一致时可在详情页"修正字段"直接改值；被修正的字段进入 `locked_fields`，即使该期仍是 candidate 也不会被后续采集覆盖，md 中标注"（人工修正）"。列表与详情页对开奖号做逐位命中标红，便于复盘。

首页"采集开奖号"按钮调用 `POST /api/draw/refresh`：主源为新浪开奖接口（`mix.lottery.sina.com.cn` gameOpenList，lottoType=102，海外可访问；官方 cwl.gov.cn 被网宿 WAF 拦海外 IP，Worker 不可用），按缺失期号翻页补齐，天齐表兜底；只回填缺失的 `draw_result`，不改写已收录值。`POST /api/draw/refresh?probe=1` 为探测模式，只返回上游行数不落库。

架构与 MyInput 相同：Vue3 前端（Cloudflare Pages）→ Hono API（Cloudflare Workers）→ GitHub API 读写本仓库。访问控制由 Cloudflare Access 承担，代码内无鉴权逻辑。

已部署：

- 面板：<https://fc3d.555606.xyz>（Pages 项目 `fc3d-panel`）
- API 同源路由：`fc3d.555606.xyz/api/*` → Worker `fc3d-api`（与面板共用一个 Access 会话，无跨域）
- API 独立入口：<https://fc3d-api.555606.xyz>（同一 Worker；secrets：GITHUB_TOKEN/GITHUB_OWNER/GITHUB_REPO；另有 Access service token `fc3d-automation` 供脚本直连）

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
# 然后在 Dashboard 给 fc3d-api 绑自定义域名（fc3d-api.555606.xyz），
# wrangler.toml 已声明 fc3d.555606.xyz/api/* 同源路由；两个域名都配 Cloudflare Access

# 前端：.env.production 中 VITE_API_URL 留空即走同源 /api
cd panel/frontend && npm run deploy   # 或 CF Pages 连接 Git 仓库，Root directory=panel/frontend
```
