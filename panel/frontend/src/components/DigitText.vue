<script setup lang="ts">
import { computed } from 'vue'

// 开奖号命中的数字标红：value 支持字符串或数组，逐位与 draw 比对
const props = defineProps<{
  value: string | string[] | null | undefined
  draw?: string | null
}>()

const spans = computed(() => {
  const text = Array.isArray(props.value) ? props.value.join('、') : props.value ?? ''
  const drawSet = new Set((props.draw || '').split(''))
  return String(text)
    .split('')
    .map((c) => ({ c, hit: /\d/.test(c) && drawSet.has(c) }))
})
</script>

<template>
  <span v-for="(d, i) in spans" :key="i" :class="d.hit ? 'text-red-600 font-bold' : ''">{{ d.c }}</span>
  <span v-if="!spans.length">—</span>
</template>
