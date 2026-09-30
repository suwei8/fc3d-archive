<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { api } from '../api'
import type { IssueSummary } from '../types'

const issues = ref<IssueSummary[]>([])
const total = ref(0)
const page = ref(1)
const limit = 30
const loading = ref(false)
const error = ref('')

async function load(p = 1) {
  loading.value = true
  error.value = ''
  try {
    const data = await api.listIssues(p, limit)
    issues.value = data.issues
    total.value = data.total
    page.value = p
  } catch (e: any) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

function fmtTime(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('zh-CN', { hour12: false })
}

function go(issue: string) {
  window.location.hash = `#/issue/${issue}`
}

function field(issue: IssueSummary, key: string) {
  const v = issue.fields[key]
  return Array.isArray(v) ? v.join('、') : v || '—'
}

const totalPages = () => Math.max(1, Math.ceil(total.value / limit))

onMounted(() => load(1))
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-xl font-semibold text-gray-800">期数列表</h2>
      <button
        class="text-sm px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
        :disabled="loading"
        @click="load(page)"
      >刷新</button>
    </div>

    <div v-if="error" class="mb-4 p-3 rounded-lg bg-red-50 text-red-700 text-sm">{{ error }}</div>

    <div class="bg-white rounded-xl border border-gray-200 overflow-x-auto">
      <table class="w-full text-sm">
        <thead>
          <tr class="text-left text-gray-500 border-b border-gray-200 bg-gray-50">
            <th class="px-4 py-3 font-medium">期号</th>
            <th class="px-4 py-3 font-medium">状态</th>
            <th class="px-4 py-3 font-medium">试机号</th>
            <th class="px-4 py-3 font-medium">关注码</th>
            <th class="px-4 py-3 font-medium">金码</th>
            <th class="px-4 py-3 font-medium">开奖号</th>
            <th class="px-4 py-3 font-medium">群图</th>
            <th class="px-4 py-3 font-medium">采集时间</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading && !issues.length">
            <td colspan="8" class="px-4 py-10 text-center text-gray-400">加载中…</td>
          </tr>
          <tr v-else-if="!issues.length">
            <td colspan="8" class="px-4 py-10 text-center text-gray-400">暂无数据</td>
          </tr>
          <tr
            v-for="item in issues"
            :key="item.issue"
            class="border-b border-gray-100 hover:bg-blue-50/40 cursor-pointer transition-colors"
            @click="go(item.issue)"
          >
            <td class="px-4 py-3 font-mono font-medium text-blue-700">{{ item.issue }}</td>
            <td class="px-4 py-3">
              <span
                class="inline-block px-2 py-0.5 rounded-full text-xs font-medium"
                :class="item.status === 'verified'
                  ? 'bg-green-100 text-green-700'
                  : 'bg-amber-100 text-amber-700'"
              >{{ item.status }}</span>
            </td>
            <td class="px-4 py-3 font-mono">{{ field(item, 'trial_number') }}</td>
            <td class="px-4 py-3 font-mono">{{ field(item, 'focus') }}</td>
            <td class="px-4 py-3 font-mono font-bold text-red-600">{{ field(item, 'gold') }}</td>
            <td class="px-4 py-3 font-mono font-bold text-blue-700">{{ item.draw_result || '—' }}</td>
            <td class="px-4 py-3">
              <span :class="item.image_count >= 3 ? 'text-green-600' : 'text-gray-400'">
                {{ item.image_count }}/3
              </span>
            </td>
            <td class="px-4 py-3 text-gray-500">{{ fmtTime(item.collected_at) }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="mt-4 flex items-center justify-between text-sm text-gray-500">
      <span>共 {{ total }} 期</span>
      <div class="flex gap-2">
        <button
          class="px-3 py-1.5 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-40"
          :disabled="page <= 1 || loading"
          @click="load(page - 1)"
        >上一页</button>
        <span class="px-2 py-1.5">{{ page }} / {{ totalPages() }}</span>
        <button
          class="px-3 py-1.5 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-40"
          :disabled="page >= totalPages() || loading"
          @click="load(page + 1)"
        >下一页</button>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
export default { name: 'IssueList' }
</script>
