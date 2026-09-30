import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { Bindings, IssueRecord } from './types'
import { GitHubService, imageDir, rawPath, mdPath, bytesToB64, utf8ToB64 } from './github'
import { renderMd, FIELDS } from './markdown'

const ISSUE_JSON_RE = /^raw\/(\d{4})\/(\d{7})\.json$/

const app = new Hono<{ Bindings: Bindings }>()

// 鉴权由 Cloudflare Access 在边缘完成，Worker 内部不重复校验。
app.use(
  '/*',
  cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400,
  }),
)

app.onError((err, c) => {
  console.error('Unhandled error:', err)
  return c.json({ success: false, error: err.message }, 500)
})

app.get('/', (c) => c.text('fc3d-panel API is running'))

// ---------- 期数 ----------

app.get('/api/issues', async (c) => {
  const page = Number(c.req.query('page')) || 1
  const limit = Math.min(Number(c.req.query('limit')) || 30, 100)
  const github = new GitHubService(c.env)
  return c.json(await github.listIssues(page, limit))
})

app.get('/api/issues/:issue', async (c) => {
  const issue = c.req.param('issue')
  const github = new GitHubService(c.env)
  const [record, images] = await Promise.all([
    github.getIssue(issue),
    github.listIssueImages(issue),
  ])
  if (!record) return c.json({ success: false, error: 'issue not found' }, 404)
  return c.json({
    record,
    images: images.map((img) => ({ ...img, url: `/api/${img.path}` })),
  })
})

// ---------- 图片 ----------

const EXT_MAP: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
}

// slot: "1" | "2" | "3" | "extra"
app.put('/api/issues/:issue/images/:slot', async (c) => {
  const issue = c.req.param('issue')
  const slot = c.req.param('slot')
  const body = await c.req.arrayBuffer()
  if (!body.byteLength) return c.json({ success: false, error: 'empty body' }, 400)

  const ext = EXT_MAP[c.req.header('Content-Type') || 'image/png'] || 'png'
  const name = slot === 'extra' ? `extra-${Date.now()}.${ext}` : `${slot}.${ext}`
  const path = `${imageDir(issue)}/${name}`

  const github = new GitHubService(c.env)

  // 固定槽位换图时清掉同槽位的旧扩展名文件，避免 1.png 与 1.jpg 并存
  if (slot !== 'extra') {
    const siblings = await github.listIssueImages(issue)
    for (const s of siblings) {
      if (s.name.startsWith(`${slot}.`) && s.path !== path) {
        await github.deleteFile(s.path, `panel: replace ${s.path}`)
      }
    }
  }

  await github.putFile(path, bytesToB64(new Uint8Array(body)), `panel: upload ${path}`)
  return c.json({ success: true, path, url: `/api/${path}` })
})

app.delete('/api/issues/:issue/images/:name', async (c) => {
  const issue = c.req.param('issue')
  const name = c.req.param('name')
  if (name.includes('/') || name.includes('..')) {
    return c.json({ success: false, error: 'invalid name' }, 400)
  }
  const github = new GitHubService(c.env)
  const ok = await github.deleteFile(`${imageDir(issue)}/${name}`, `panel: delete image ${issue}/${name}`)
  return c.json({ success: ok })
})

const MIME_MAP: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
}

// 私有仓图片代理：/api/images/2026/2026263/1.jpg -> api.github.com contents (raw)
app.get('/api/images/*', async (c) => {
  const path = c.req.path.replace(/^\/api\//, '')
  const github = new GitHubService(c.env)
  const res = await github.fetchFileBytes(path)
  if (!res.ok || !res.body) return c.json({ success: false, error: 'image not found' }, 404)
  const ext = path.split('.').pop()?.toLowerCase() || ''
  return c.body(res.body, 200, {
    'Content-Type': MIME_MAP[ext] || 'application/octet-stream',
    'Cache-Control': 'public, max-age=86400',
  })
})

// ---------- 开奖号补采 ----------

// 新浪开奖 API：海外可访问（cwl.gov.cn 网宿 WAF 拦海外 IP，Worker 上不可用）。
// 与 Lottery_Assistant/server/src/collector/sinaApi.ts 同一接口：lottoType=102 = 福彩3D。
const SINA_API = 'https://mix.lottery.sina.com.cn/gateway/index/entry'
const TIANQI_URL = 'https://www.800820.cn/kj/3d_sjh.html'

// 新浪分页条目：issueNo(可能5位) + openResults(["9","8","7"])
function mergeSinaPage(draws: Record<string, string>, json: any): number {
  let totalPage = 1
  const r = json?.result
  totalPage = Number(r?.pagination?.totalPage) || 1
  for (const it of r?.data ?? []) {
    let issue = String(it?.issueNo ?? '')
    if (/^\d{5}$/.test(issue)) issue = '20' + issue
    const nums: string[] = Array.isArray(it?.openResults) ? it.openResults : []
    const draw = nums.join('').replace(/\D/g, '')
    if (/^20\d{5}$/.test(issue) && draw.length === 3) draws[issue] = draw
  }
  return totalPage
}

// 抽表格行为文本单元格（天齐兜底：只有最近 ~10 期）
function parseTianqiDrawMap(html: string): Record<string, string> {
  const map: Record<string, string> = {}
  const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi
  for (const tr of html.match(/<tr[\s\S]*?<\/tr>/gi) ?? []) {
    const cells: string[] = []
    for (const m of tr.matchAll(cellRe)) {
      cells.push(m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ''))
    }
    if (cells.length < 8) continue
    const issue = cells[0].match(/20\d{5}/)?.[0]
    const draw = cells[7].replace(/\D/g, '')
    if (issue && draw.length === 3) map[issue] = draw
  }
  return map
}

// 抓上游开奖号回填缺失的 draw_result（已收录值不覆盖）；返回 {updated: [...]}
app.post('/api/draw/refresh', async (c) => {
  const github = new GitHubService(c.env)
  const tree = await github.getTree()
  const paths = tree
    .filter((i) => i.type === 'blob' && ISSUE_JSON_RE.test(i.path || ''))
    .map((i) => i.path!)
    .sort()

  // 先读记录，找出缺开奖号的期号集合
  const records = new Map<string, IssueRecord>()
  const missing = new Set<string>()
  for (const p of paths) {
    const issue = p.match(/(\d{7})\.json$/)![1]
    const record = await github.getJsonFile<IssueRecord>(p)
    if (!record) continue
    records.set(issue, record)
    if (!record.draw_result) missing.add(issue)
  }
  // ?probe=1：只探测上游可达性并写回上游行数，不落库（诊断用）
  const probeOnly = c.req.query('probe') === '1'

  if (!missing.size && !probeOnly) {
    return c.json({ success: true, updated: [], checked: paths.length, upstream_rows: 0 })
  }

  const draws: Record<string, string> = {}
  // 新浪主源：翻页直到缺号期全部命中（封顶 8 页 ≈ 400 期；probe 模式只拉第 1 页）
  const maxPage = probeOnly ? 1 : 8
  for (let page = 1; page <= maxPage && (missing.size || (probeOnly && page === 1)); page++) {
    const params = new URLSearchParams({
      format: 'json',
      __caller__: 'wap',
      __version__: '1.0.0',
      __verno__: '10000',
      cat1: 'gameOpenList',
      paginationType: '1',
      dpc: '1',
      lottoType: '102',
      page: String(page),
      pageSize: '50',
    })
    try {
      const res = await fetch(`${SINA_API}?${params}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) break
      const totalPage = mergeSinaPage(draws, await res.json())
      for (const issue of [...missing]) {
        if (draws[issue]) missing.delete(issue)
      }
      if (page >= totalPage) break
    } catch {
      break
    }
  }
  // 天齐兜底（只覆盖最近 ~10 期，但海外可达）
  if (missing.size) {
    try {
      const res = await fetch(TIANQI_URL, { headers: { 'User-Agent': 'fc3d-panel/1.0' } })
      if (res.ok) Object.assign(draws, parseTianqiDrawMap(await res.text()))
    } catch {}
  }

  const updated: string[] = []
  for (const [issue, record] of records) {
    if (probeOnly || record.draw_result || !draws[issue]) continue
    record.draw_result = draws[issue]
    await github.putFile(rawPath(issue), utf8ToB64(JSON.stringify(record, null, 2) + '\n'), `panel: ${issue} draw_result ${draws[issue]}`)
    await github.putFile(mdPath(issue), utf8ToB64(renderMd(record)), `panel: render ${issue}.md`)
    updated.push(issue)
  }
  return c.json({ success: true, updated, checked: paths.length, upstream_rows: Object.keys(draws).length })
})

// ---------- 核验 / 备注 ----------

// { "status": "verified" | "candidate", "by": "suwei8" }
app.post('/api/issues/:issue/status', async (c) => {
  const issue = c.req.param('issue')
  let body: { status?: string; by?: string } = {}
  try {
    body = await c.req.json()
  } catch {}
  const status = body.status === 'verified' ? 'verified' : 'candidate'

  const github = new GitHubService(c.env)
  const record = await github.getIssue(issue)
  if (!record) return c.json({ success: false, error: 'issue not found' }, 404)

  record.status = status
  record.verified_by = status === 'verified' ? body.by || 'panel' : null

  await github.putFile(
    rawPath(issue),
    utf8ToB64(JSON.stringify(record, null, 2) + '\n'),
    `panel: ${issue} status -> ${status}`,
  )
  // md 同步重写，render 与 collect.py 逐字节一致
  await github.putFile(
    mdPath(issue),
    utf8ToB64(renderMd(record)),
    `panel: render ${issue}.md`,
  )
  return c.json({ success: true, status })
})

// 手动修正字段：{ "fields": { "taihu": "起跳", "bottom_focus": "6,9", "draw_result": "987" } }
// 被改动的字段写入 locked_fields，之后自动采集（含 candidate 期）不再覆盖。
app.put('/api/issues/:issue/fields', async (c) => {
  const issue = c.req.param('issue')
  let body: { fields?: Record<string, unknown> } = {}
  try {
    body = await c.req.json()
  } catch {}
  const updates = body.fields
  if (!updates || typeof updates !== 'object') {
    return c.json({ success: false, error: 'fields required' }, 400)
  }

  const github = new GitHubService(c.env)
  const record = await github.getIssue(issue)
  if (!record) return c.json({ success: false, error: 'issue not found' }, 404)

  const locked = new Set(record.locked_fields || [])
  const changed: string[] = []
  for (const [key, raw] of Object.entries(updates)) {
    if (key === 'draw_result') {
      const next = String(raw ?? '').replace(/\D/g, '').slice(0, 3) || null
      if ((record.draw_result ?? null) !== next) {
        record.draw_result = next
        changed.push(key)
      }
      continue
    }
    if (!(FIELDS as readonly string[]).includes(key)) continue
    const next: string | string[] | null =
      key === 'bottom_focus'
        ? String(Array.isArray(raw) ? raw.join('') : raw ?? '').match(/\d/g)
        : String(raw ?? '').trim() || null
    if (JSON.stringify(record.fields[key] ?? null) !== JSON.stringify(next)) {
      record.fields[key] = next
      locked.add(key)
      changed.push(key)
    }
  }
  if (!changed.length) return c.json({ success: true, changed })

  record.locked_fields = [...locked]
  await github.putFile(
    rawPath(issue),
    utf8ToB64(JSON.stringify(record, null, 2) + '\n'),
    `panel: ${issue} correct fields: ${changed.join(',')}`,
  )
  await github.putFile(
    mdPath(issue),
    utf8ToB64(renderMd(record)),
    `panel: render ${issue}.md`,
  )
  return c.json({ success: true, changed })
})

// { "text": "复盘备注" }
app.post('/api/issues/:issue/notes', async (c) => {
  const issue = c.req.param('issue')
  let body: { text?: string } = {}
  try {
    body = await c.req.json()
  } catch {}
  const text = (body.text || '').trim()
  if (!text) return c.json({ success: false, error: 'text required' }, 400)

  const github = new GitHubService(c.env)
  const record = await github.getIssue(issue)
  if (!record) return c.json({ success: false, error: 'issue not found' }, 404)

  record.notes = record.notes || []
  record.notes.push({ at: new Date().toISOString(), text })

  await github.putFile(
    rawPath(issue),
    utf8ToB64(JSON.stringify(record, null, 2) + '\n'),
    `panel: ${issue} add note`,
  )
  return c.json({ success: true })
})

export default app
