import type { ImageItem, IssueRecord, IssueSummary } from './types'

// 开发环境走 vite proxy（留空），生产环境读 VITE_API_URL
const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, init)
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`HTTP ${res.status}: ${text}`)
  }
  return res.json() as Promise<T>
}

export const api = {
  listIssues: (page = 1, limit = 30) =>
    request<{ issues: IssueSummary[]; total: number }>(`/api/issues?page=${page}&limit=${limit}`),

  getIssue: (issue: string) =>
    request<{ record: IssueRecord; images: ImageItem[] }>(`/api/issues/${issue}`),

  uploadImage: (issue: string, slot: string, file: Blob, contentType: string) =>
    request<{ success: boolean; path: string; url: string }>(
      `/api/issues/${issue}/images/${slot}`,
      { method: 'PUT', headers: { 'Content-Type': contentType }, body: file },
    ),

  deleteImage: (issue: string, name: string) =>
    request<{ success: boolean }>(
      `/api/issues/${issue}/images/${encodeURIComponent(name)}`,
      { method: 'DELETE' },
    ),

  setStatus: (issue: string, status: 'verified' | 'candidate', by = 'panel') =>
    request<{ success: boolean; status: string }>(`/api/issues/${issue}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, by }),
    }),

  updateFields: (issue: string, fields: Record<string, string>) =>
    request<{ success: boolean; changed: string[] }>(`/api/issues/${issue}/fields`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields }),
    }),

  addNote: (issue: string, text: string) =>
    request<{ success: boolean }>(`/api/issues/${issue}/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    }),

  imageUrl: (path: string) => `${API_BASE}/api/${path}`,
}
