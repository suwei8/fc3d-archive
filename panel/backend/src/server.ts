import { serve } from '@hono/node-server'
import app from './index'
import type { Bindings } from './types'

// 本地开发入口：从环境变量注入 GitHub 凭据
//   set GITHUB_TOKEN=xxx && set GITHUB_OWNER=suwei8 && set GITHUB_REPO=fc3d-archive && npm run dev
const env: Bindings = {
  GITHUB_TOKEN: process.env.GITHUB_TOKEN || '',
  GITHUB_OWNER: process.env.GITHUB_OWNER || 'suwei8',
  GITHUB_REPO: process.env.GITHUB_REPO || 'fc3d-archive',
}

// Hono 的 app.fetch 需要一个 env 形参
const handler = (request: Request) => app.fetch(request, env)

serve({ fetch: handler, port: 8787 })
console.log('fc3d-panel API listening on http://localhost:8787')
