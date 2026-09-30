import { Octokit } from '@octokit/rest'
import type { Bindings, IssueRecord } from './types'

const ISSUE_JSON_RE = /^raw\/(\d{4})\/(\d{7})\.json$/
const ISSUE_IMAGE_RE = /^images\/(\d{4})\/(\d{7})\/(.+)$/

export function issueYear(issue: string): string {
  return issue.slice(0, 4)
}

export function rawPath(issue: string): string {
  return `raw/${issueYear(issue)}/${issue}.json`
}

export function mdPath(issue: string): string {
  return `data/${issueYear(issue)}/${issue}.md`
}

export function imageDir(issue: string): string {
  return `images/${issueYear(issue)}/${issue}`
}

export class GitHubService {
  public octokit: Octokit
  public owner: string
  public repo: string
  private token: string

  constructor(bindings: Bindings) {
    this.octokit = new Octokit({ auth: bindings.GITHUB_TOKEN })
    this.owner = bindings.GITHUB_OWNER
    this.repo = bindings.GITHUB_REPO
    this.token = bindings.GITHUB_TOKEN
  }

  // 仓库默认分支最新提交的递归 tree；数据期数不多，每次现取即可。
  async getTree() {
    const commits = await this.octokit.repos.listCommits({
      owner: this.owner,
      repo: this.repo,
      per_page: 1,
    })
    if (commits.data.length === 0) return []
    const tree = await this.octokit.git.getTree({
      owner: this.owner,
      repo: this.repo,
      tree_sha: commits.data[0].commit.tree.sha,
      recursive: '1',
    })
    return tree.data.tree
  }

  async listIssues(page = 1, limit = 30): Promise<{ issues: any[]; total: number }> {
    const tree = await this.getTree()

    const imageCount: Record<string, number> = {}
    const issuePaths: string[] = []
    for (const item of tree) {
      if (item.type !== 'blob' || !item.path) continue
      const jsonMatch = item.path.match(ISSUE_JSON_RE)
      if (jsonMatch) {
        issuePaths.push(item.path)
        continue
      }
      const imgMatch = item.path.match(ISSUE_IMAGE_RE)
      if (imgMatch) {
        const issue = imgMatch[2]
        imageCount[issue] = (imageCount[issue] || 0) + 1
      }
    }

    issuePaths.sort((a, b) => b.localeCompare(a))
    const total = issuePaths.length
    const pagePaths = issuePaths.slice((page - 1) * limit, page * limit)

    const issues = await Promise.all(
      pagePaths.map(async (path) => {
        const issue = path.match(ISSUE_JSON_RE)![2]
        const record = await this.getJsonFile<IssueRecord>(path)
        return {
          issue,
          status: record?.status ?? 'candidate',
          fields: record?.fields ?? {},
          draw_result: record?.draw_result ?? null,
          collected_at: record?.collected_at ?? null,
          image_count: imageCount[issue] || 0,
        }
      }),
    )

    return { issues, total }
  }

  async getIssue(issue: string): Promise<IssueRecord | null> {
    return this.getJsonFile<IssueRecord>(rawPath(issue))
  }

  async listIssueImages(issue: string): Promise<{ path: string; name: string }[]> {
    const tree = await this.getTree()
    const prefix = `${imageDir(issue)}/`
    return tree
      .filter(
        (item) =>
          item.type === 'blob' &&
          !!item.path &&
          item.path.startsWith(prefix),
      )
      .map((item) => ({
        path: item.path!,
        name: item.path!.slice(prefix.length),
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  async getJsonFile<T>(path: string): Promise<T | null> {
    try {
      const res = await this.octokit.repos.getContent({
        owner: this.owner,
        repo: this.repo,
        path,
      })
      const data = res.data as any
      if (Array.isArray(data) || data.type !== 'file') return null
      return JSON.parse(b64ToUtf8(data.content)) as T
    } catch {
      return null
    }
  }

  async getFileSha(path: string): Promise<string | null> {
    try {
      const res = await this.octokit.repos.getContent({
        owner: this.owner,
        repo: this.repo,
        path,
      })
      const data = res.data as any
      return !Array.isArray(data) && data.sha ? data.sha : null
    } catch {
      return null
    }
  }

  async putFile(path: string, base64: string, message: string): Promise<void> {
    const doPut = (sha?: string) =>
      this.octokit.repos.createOrUpdateFileContents({
        owner: this.owner,
        repo: this.repo,
        path,
        message,
        content: base64,
        sha,
      })
    const sha = (await this.getFileSha(path)) ?? undefined
    try {
      await doPut(sha)
    } catch (e: any) {
      // 与定时采集提交撞车时重取 sha 重试一次
      if (e?.status === 409 || e?.status === 422) {
        await doPut((await this.getFileSha(path)) ?? undefined)
      } else {
        throw e
      }
    }
  }

  async deleteFile(path: string, message: string): Promise<boolean> {
    const sha = await this.getFileSha(path)
    if (!sha) return false
    await this.octokit.repos.deleteFile({
      owner: this.owner,
      repo: this.repo,
      path,
      message,
      sha,
    })
    return true
  }

  // 走 api.github.com 而非 raw.githubusercontent.com（后者在国内不可达，本地调试也依赖它）
  async fetchFileBytes(path: string): Promise<Response> {
    return fetch(
      `https://api.github.com/repos/${this.owner}/${this.repo}/contents/${path}`,
      {
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: 'application/vnd.github.raw',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'fc3d-panel',
        },
      },
    )
  }
}

export function b64ToUtf8(b64: string): string {
  const binary = atob(b64.replace(/\n/g, ''))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

export function utf8ToB64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

export function bytesToB64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}
