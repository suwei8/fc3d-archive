<script setup lang="ts">
import { ref } from 'vue'
import { api } from '../api'
import type { ImageItem } from '../types'

const props = defineProps<{
  issue: string
  slot: string
  label: string
  image?: ImageItem
}>()

const emit = defineEmits<{
  (e: 'refresh'): void
  (e: 'preview', url: string): void
}>()

const fileInput = ref<HTMLInputElement | null>(null)
const uploading = ref(false)
const dragOver = ref(false)
const error = ref('')

async function upload(file: Blob) {
  uploading.value = true
  error.value = ''
  try {
    await api.uploadImage(props.issue, props.slot, file, file.type || 'image/png')
    emit('refresh')
  } catch (e: any) {
    error.value = e.message
  } finally {
    uploading.value = false
  }
}

function onPick(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (f) upload(f)
  ;(e.target as HTMLInputElement).value = ''
}

function onDrop(e: DragEvent) {
  dragOver.value = false
  const f = e.dataTransfer?.files?.[0]
  if (f && f.type.startsWith('image/')) upload(f)
}

async function remove() {
  if (!props.image) return
  if (!confirm(`删除 ${props.image.name}？`)) return
  try {
    await api.deleteImage(props.issue, props.image.name)
    emit('refresh')
  } catch (e: any) {
    error.value = e.message
  }
}

defineExpose({ upload })
</script>

<template>
  <div
    class="relative rounded-xl border-2 overflow-hidden aspect-[4/3] bg-white transition-colors"
    :class="[
      dragOver ? 'border-blue-500 bg-blue-50' : 'border-dashed border-gray-300',
      image ? 'border-solid' : '',
    ]"
    @dragover.prevent="dragOver = true"
    @dragleave.prevent="dragOver = false"
    @drop.prevent="onDrop"
  >
    <input ref="fileInput" type="file" accept="image/*" class="hidden" @change="onPick" />

    <!-- 已有图 -->
    <template v-if="image">
      <img
        :src="image.url"
        :alt="label"
        class="w-full h-full object-cover cursor-zoom-in"
        loading="lazy"
        @click="emit('preview', image.url)"
      />
      <div class="absolute top-0 left-0 right-0 flex items-center justify-between px-2 py-1 bg-gradient-to-b from-black/50 to-transparent">
        <span class="text-xs text-white">{{ label }}</span>
        <button
          class="text-white/80 hover:text-white text-sm leading-none"
          title="删除"
          @click.stop="remove"
        >✕</button>
      </div>
    </template>

    <!-- 空槽位 -->
    <button
      v-else
      class="w-full h-full flex flex-col items-center justify-center gap-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50/50 transition-colors"
      :disabled="uploading"
      @click="fileInput?.click()"
    >
      <svg v-if="!uploading" class="w-8 h-8" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
      </svg>
      <svg v-else class="w-8 h-8 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      <span class="text-sm font-medium">{{ label }}</span>
      <span class="text-xs">点击 / 拖入 / Ctrl+V 粘贴</span>
    </button>

    <div v-if="error" class="absolute bottom-0 inset-x-0 text-xs bg-red-500 text-white px-2 py-1 truncate">{{ error }}</div>
  </div>
</template>
