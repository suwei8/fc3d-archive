export interface Bindings {
  GITHUB_TOKEN: string
  GITHUB_OWNER: string
  GITHUB_REPO: string
}

export interface IssueRecord {
  issue: string
  status: 'candidate' | 'verified'
  verified_by: string | null
  fields: Record<string, string | string[] | null>
  locked_fields?: string[]
  draw_result?: string | null
  sources: Record<string, { url: string; fetched_at: string; fields: string[] }>
  collected_at: string
  notes: Array<{ at: string; text: string } | string>
}
