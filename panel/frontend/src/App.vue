<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import IssueList from './components/IssueList.vue'
import IssueDetail from './components/IssueDetail.vue'

const currentIssue = ref<string | null>(null)

function syncRoute() {
  const m = location.hash.match(/^#\/issue\/(\d{7})$/)
  currentIssue.value = m ? m[1] : null
}

onMounted(() => {
  syncRoute()
  window.addEventListener('hashchange', syncRoute)
})
onUnmounted(() => window.removeEventListener('hashchange', syncRoute))
</script>

<template>
  <div class="min-h-screen bg-gray-50">
    <header class="bg-white border-b border-gray-200 sticky top-0 z-10">
      <div class="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
        <a href="#/" class="text-lg font-bold text-gray-800">福彩3D 归档面板</a>
        <span class="text-xs text-gray-400">fc3d-archive</span>
      </div>
    </header>
    <main class="max-w-5xl mx-auto px-4 py-6">
      <IssueDetail v-if="currentIssue" :issue="currentIssue" :key="currentIssue" />
      <IssueList v-else />
    </main>
  </div>
</template>
