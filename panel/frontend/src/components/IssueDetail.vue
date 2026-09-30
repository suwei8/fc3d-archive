<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { api } from '../api'
import type { ImageItem, IssueRecord } from '../types'
import ImageSlot from './ImageSlot.vue'

const props = defineProps<{ issue: string }>()

const FIELD_LABELS: [string, string][] = [
  ['beijing', '北京字谜'],
  ['beijing_alt', '另版北京字谜'],
  ['taihu', '太湖一语定胆'],
  ['trial_number', '试机号'],
  ['focus', '关注码'],
  ['gold', '金码'],
  ['corresponding', '对应码'],
  ['bottom_focus', '底部关注码'],
  ['bottom_gold', '底部金码'],
]
const SLOTS = [
  { slot: '1', label: '群图 1（字谜图）' },
  { slot: '2', label: '群图 2' },
  { slot: '3', label: '群图 3' },
]

const record = ref<IssueRecord | null>(null)
const images = ref<ImageItem[]>([])
const loading = ref(true)
const error = ref('')
const busy = ref(false)
const previewUrl = ref('')
const noteText = ref('')
const slotRefs = ref<InstanceType<typeof ImageSlot>[]>([])
const editing = ref(false)
const draft = ref<Record<string, string>>({})

const slotImage = computed(() => {
  const map: Record<string, ImageItem | undefined> = {}
  for (const s of SLOTS) {
    map[s.slot] = images.value.find((img) => img.name.startsWith(`${s.slot}.`))
  }
  return map
})
const extraImages = computed(() => images.value.filter((img) => img.name.startsWith('extra-')))

async function load() {
  loading.value = true
  error.value = ''
  try {
    const data = await api.getIssue(props.issue)
    record.value = data.record
    images.value = data.images
  } catch (e: any) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

function fieldValue(key: string) {
  const v = record.value?.fields?.[key]
  return Array.isArray(v) ? v.join('、') : v || '—'
}

// 开奖后的命中标注：数字字段与开奖号按位统计重合度
const DRAW_AWARE = new Set(['trial_number', 'focus', 'gold', 'corresponding', 'bottom_focus', 'bottom_gold'])

function hitBadge(key: string): { text: string; hit: boolean } | null {
  const draw = record.value?.draw_result
  if (!draw || draw.length !== 3 || !DRAW_AWARE.has(key)) return null
  const v = record.value?.fields?.[key]
  if (v == null) return null
  const digits = Array.isArray(v) ? v : String(v).split('')
  const drawSet = new Set(draw.split(''))
  const hits = digits.filter((d) => drawSet.has(d)).length
  if (key === 'gold' || key === 'bottom_gold') {
    return hits ? { text: '命中', hit: true } : { text: '未中', hit: false }
  }
  return hits ? { text: `${hits}位中`, hit: true } : { text: '未中', hit: false }
}

// 手动修正：以群图为准直接改字段，改过的字段进 locked_fields 不再被采集覆盖
function startEdit() {
  const d: Record<string, string> = { draw_result: record.value?.draw_result || '' }
  for (const [key] of FIELD_LABELS) {
    const v = record.value?.fields?.[key]
    d[key] = Array.isArray(v) ? v.join(',') : (v ?? '')
  }
  draft.value = d
  editing.value = true
}

async function saveEdit() {
  if (!record.value || busy.value) return
  busy.value = true
  try {
    await api.updateFields(props.issue, draft.value)
    editing.value = false
    await load()
  } catch (e: any) {
    error.value = e.message
  } finally {
    busy.value = false
  }
}

async function toggleVerify() {
  if (!record.value || busy.value) return
  busy.value = true
  try {
    const next = record.value.status === 'verified' ? 'candidate' : 'verified'
    await api.setStatus(props.issue, next)
    await load()
  } catch (e: any) {
    error.value = e.message
  } finally {
    busy.value = false
  }
}

async function submitNote() {
  const text = noteText.value.trim()
  if (!text || busy.value) return
  busy.value = true
  try {
    await api.addNote(props.issue, text)
    noteText.value = ''
    await load()
  } catch (e: any) {
    error.value = e.message
  } finally {
    busy.value = false
  }
}

function noteTextOf(n: IssueRecord['notes'][number]) {
  return typeof n === 'string' ? n : n.text
}
function noteAtOf(n: IssueRecord['notes'][number]) {
  return typeof n === 'string' ? '' : new Date(n.at).toLocaleString('zh-CN', { hour12: false })
}

// 全局粘贴：优先填满 1/2/3 空槽位，全部有图则进 extra
function onPaste(e: ClipboardEvent) {
  const items = e.clipboardData?.items
  if (!items) return
  const files: Blob[] = []
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      const f = item.getAsFile()
      if (f) files.push(f)
    }
  }
  if (!files.length) return
  e.preventDefault()
  for (const f of files) {
    const emptyIdx = SLOTS.findIndex((s) => !slotImage.value[s.slot])
    if (emptyIdx >= 0) {
      slotRefs.value[emptyIdx]?.upload(f)
    } else {
      api.uploadImage(props.issue, 'extra', f, f.type || 'image/png').then(load).catch(() => {})
    }
  }
}

function fmtTime(iso?: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('zh-CN', { hour12: false })
}

onMounted(() => {
  load()
  document.addEventListener('paste', onPaste)
})
onUnmounted(() => document.removeEventListener('paste', onPaste))
</script>

<template>
  <div>
    <div class="mb-4">
      <a href="#/" class="text-sm text-blue-600 hover:underline">← 返回列表</a>
    </div>

    <div v-if="error" class="mb-4 p-3 rounded-lg bg-red-50 text-red-700 text-sm">{{ error }}</div>
    <div v-if="loading" class="py-16 text-center text-gray-400">加载中…</div>

    <template v-else-if="record">
      <!-- 头部：期号 + 状态 + 核验 -->
      <div class="flex flex-wrap items-center gap-3 mb-5">
        <h2 class="text-2xl font-bold font-mono text-gray-800">{{ record.issue }}</h2>
        <span
          class="px-2.5 py-1 rounded-full text-xs font-medium"
          :class="record.status === 'verified'
            ? 'bg-green-100 text-green-700'
            : 'bg-amber-100 text-amber-700'"
        >{{ record.status }}</span>
        <span v-if="record.verified_by" class="text-xs text-gray-400">核验人：{{ record.verified_by }}</span>
        <span v-if="record.draw_result" class="px-3 py-1 rounded-lg bg-blue-600 text-white font-mono font-bold tracking-widest">
          开奖 {{ record.draw_result }}
        </span>
        <button
          class="ml-auto px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50 transition-colors"
          :class="record.status === 'verified'
            ? 'bg-gray-500 hover:bg-gray-600'
            : 'bg-green-600 hover:bg-green-700'"
          :disabled="busy"
          @click="toggleVerify"
        >{{ record.status === 'verified' ? '取消核验' : '对图核验通过' }}</button>
      </div>

      <div>
        <!-- 字段 -->
        <section class="bg-white rounded-xl border border-gray-200 p-4">
          <div class="flex items-center justify-between mb-3">
            <h3 class="font-semibold text-gray-800">采集字段</h3>
            <div v-if="!editing" class="flex items-center gap-2">
              <button
                class="px-3 py-1.5 rounded-lg text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 transition-colors"
                @click="startEdit"
              >修正字段</button>
            </div>
            <div v-else class="flex items-center gap-2">
              <button
                class="px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 transition-colors"
                :disabled="busy"
                @click="saveEdit"
              >保存</button>
              <button
                class="px-3 py-1.5 rounded-lg text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors"
                :disabled="busy"
                @click="editing = false"
              >取消</button>
            </div>
          </div>
          <table class="w-full text-sm">
            <tbody>
              <tr v-for="[key, label] in FIELD_LABELS" :key="key" class="border-b border-gray-100 last:border-0">
                <td class="py-2 pr-3 text-gray-500 w-28">{{ label }}</td>
                <td class="py-2 font-medium" :class="key === 'gold' && !editing ? 'text-red-600 font-bold' : 'text-gray-800'">
                  <input
                    v-if="editing"
                    v-model="draft[key]"
                    class="w-full rounded border border-gray-300 px-2 py-1 font-normal outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-100"
                  />
                  <template v-else>
                    {{ fieldValue(key) }}
                    <span
                      v-if="record.locked_fields?.includes(key)"
                      class="ml-2 px-1.5 py-0.5 rounded text-xs font-normal bg-purple-100 text-purple-600"
                    >已修正</span>
                    <span
                      v-if="hitBadge(key)"
                      class="ml-2 px-1.5 py-0.5 rounded text-xs font-normal"
                      :class="hitBadge(key)!.hit ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'"
                    >{{ hitBadge(key)!.text }}</span>
                  </template>
                </td>
              </tr>
              <tr v-if="editing" class="border-b border-gray-100 last:border-0">
                <td class="py-2 pr-3 text-gray-500 w-28">开奖号</td>
                <td class="py-2">
                  <input
                    v-model="draft.draw_result"
                    class="w-full rounded border border-gray-300 px-2 py-1 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-100"
                    placeholder="3 位数字，留空表示未开"
                  />
                </td>
              </tr>
            </tbody>
          </table>
          <p class="mt-3 text-xs text-gray-400">
            采集于 {{ fmtTime(record.collected_at) }}
            <template v-if="editing">｜保存后被改动的字段将标记"已修正"并锁定，不再被自动采集覆盖</template>
          </p>
        </section>

      </div>

      <!-- 群图 -->
      <section class="mt-4 bg-white rounded-xl border border-gray-200 p-4">
        <div class="flex items-center justify-between mb-3">
          <h3 class="font-semibold text-gray-800">微信群图（每日 21:00）</h3>
          <span class="text-xs text-gray-400">在页面任意位置 Ctrl+V 可直接粘贴图片</span>
        </div>
        <div class="grid gap-3 sm:grid-cols-3">
          <ImageSlot
            v-for="(s, i) in SLOTS"
            :key="s.slot"
            :ref="(el: any) => { if (el) slotRefs[i] = el }"
            :issue="issue"
            :slot="s.slot"
            :label="s.label"
            :image="slotImage[s.slot]"
            @refresh="load"
            @preview="previewUrl = $event"
          />
        </div>

        <div v-if="extraImages.length" class="mt-4">
          <h4 class="text-sm font-medium text-gray-600 mb-2">追加图片</h4>
          <div class="grid gap-3 sm:grid-cols-4">
            <ImageSlot
              v-for="img in extraImages"
              :key="img.name"
              :issue="issue"
              slot="extra"
              :label="img.name"
              :image="img"
              @refresh="load"
              @preview="previewUrl = $event"
            />
          </div>
        </div>

        <div class="mt-3">
          <ImageSlot
            :issue="issue"
            slot="extra"
            label="追加图片"
            @refresh="load"
            @preview="previewUrl = $event"
          />
        </div>
      </section>

      <!-- 备注 -->
      <section class="mt-4 bg-white rounded-xl border border-gray-200 p-4">
        <h3 class="font-semibold text-gray-800 mb-3">复盘备注</h3>
        <ul v-if="record.notes?.length" class="space-y-2 mb-3 text-sm">
          <li v-for="(n, i) in record.notes" :key="i" class="flex gap-2">
            <span class="text-gray-400 shrink-0">{{ noteAtOf(n) }}</span>
            <span class="text-gray-700 whitespace-pre-wrap">{{ noteTextOf(n) }}</span>
          </li>
        </ul>
        <p v-else class="text-sm text-gray-400 mb-3">暂无备注</p>
        <div class="flex gap-2">
          <textarea
            v-model="noteText"
            rows="2"
            class="flex-1 rounded-lg border border-gray-300 p-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 resize-y"
            placeholder="记录本期复盘、图谜解读…"
          ></textarea>
          <button
            class="self-end px-4 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700 disabled:opacity-50"
            :disabled="!noteText.trim() || busy"
            @click="submitNote"
          >保存</button>
        </div>
      </section>

      <!-- 数据源：低频信息沉到页尾，默认收起 -->
      <section class="mt-4 bg-white rounded-xl border border-gray-200 p-4">
        <details class="group">
          <summary class="font-semibold text-gray-800 cursor-pointer select-none flex items-center justify-between list-none [&::-webkit-details-marker]:hidden">
            数据源
            <svg class="w-4 h-4 text-gray-400 transition-transform group-open:rotate-180" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
            </svg>
          </summary>
          <ul class="space-y-2 text-sm mt-3">
            <li v-for="(meta, id) in record.sources" :key="id" class="break-all">
              <span class="text-gray-500">{{ id }}：</span>
              <a :href="meta.url" target="_blank" class="text-blue-600 hover:underline">{{ meta.url }}</a>
            </li>
            <li v-if="!record.sources || !Object.keys(record.sources).length" class="text-gray-400">暂无来源记录</li>
          </ul>
        </details>
      </section>
    </template>

    <!-- 大图预览 -->
    <div
      v-if="previewUrl"
      class="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 cursor-zoom-out"
      @click="previewUrl = ''"
    >
      <img :src="previewUrl" class="max-w-full max-h-full rounded-lg shadow-2xl" />
    </div>
  </div>
</template>
