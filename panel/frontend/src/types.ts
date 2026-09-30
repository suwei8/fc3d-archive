export interface IssueSummary {
  issue: string
  status: 'candidate' | 'verified'
  fields: Record<string, string | string[] | null>
  draw_result: string | null
  collected_at: string | null
  image_count: number
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

export interface ImageItem {
  path: string
  name: string
  url: string
}
