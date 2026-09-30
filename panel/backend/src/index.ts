import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { Bindings, IssueRecord } from './types'
import { GitHubService, imageDir, rawPath, mdPath, bytesToB64, utf8ToB64 } from './github'
import { renderMd } from './markdown'

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
