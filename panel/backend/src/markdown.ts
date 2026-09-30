import type { IssueRecord } from './types'

// 与 scripts/collect.py 的 render_md 保持逐字节一致，避免下次采集时产生无谓 diff。
export const FIELDS = [
  'beijing', 'beijing_alt', 'taihu', 'trial_number', 'focus', 'gold',
  'corresponding', 'bottom_focus', 'bottom_gold',
] as const

export const LABELS: Record<string, string> = {
  beijing: '北京',
  beijing_alt: '另版北京',
  taihu: '太湖',
  trial_number: '试机号',
  focus: '关注码',
  gold: '金码',
  corresponding: '对应码',
  bottom_focus: '底部关注码',
  bottom_gold: '底部金码',
}

export function renderMd(record: IssueRecord): string {
  const lines = [
    `# 福彩3D ${record.issue}期`,
    '',
    `> 当前状态：**${record.status}**`,
    '',
  ]
  if (record.draw_result) {
    lines.push(`> 开奖号：**${record.draw_result}**`, '')
  }
  lines.push('| 字段 | 数据 |', '| --- | --- |')

  const locked = new Set(record.locked_fields || [])
  for (const key of FIELDS) {
    const value = record.fields[key]
    let shown = Array.isArray(value) ? value.join('、') : (value || '—')
    if (locked.has(key)) shown += '（人工修正）'
    lines.push(`| ${LABELS[key]} | ${shown} |`)
  }

  lines.push('', '## 数据源', '')
  const sources = record.sources || {}
  if (Object.keys(sources).length > 0) {
    for (const [sourceId, meta] of Object.entries(sources)) {
      lines.push(`- ${sourceId}: ${meta.url}`)
    }
  } else {
    lines.push('- 暂无自动来源记录')
  }

  lines.push(
    '',
    '## 说明',
    '',
    '- 自动采集结果默认保持 candidate，未经人工核图不得升级为 verified。',
    '- 已人工确认的字段不会被后续自动采集覆盖。',
    '',
  )
  return lines.join('\n')
}
