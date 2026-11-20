<script setup lang="ts">
import { Paperclip } from 'lucide-vue-next'
import { onMounted, ref } from 'vue'
import type { FileSummary } from '@tdm/shared'
import { PERMISSIONS } from '@tdm/shared/permissions'
import { ACTION_ICONS } from '@/components/ui/actions'
import IconButton from '@/components/ui/IconButton.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiCard from '@/components/ui/UiCard.vue'
import { api, errorMessage } from '@/services/api'
import { downloadFile, formatBytes, openFile } from '@/services/files'
import { useAuthStore } from '@/stores/auth'
import { formatDate } from '@/utils/format'

const props = defineProps<{ tenderId: string }>()
const emit = defineEmits<{ changed: [docs: FileSummary[]] }>()
const auth = useAuthStore()

const docs = ref<FileSummary[]>([])
const error = ref('')
const uploading = ref(false)

const canDelete = (d: FileSummary) =>
  d.uploadedBy?.id === auth.user?.id || auth.can(PERMISSIONS.TENDER_ASSIGN)
const viewable = (d: FileSummary) =>
  d.mimeType === 'application/pdf' || d.mimeType.startsWith('image/')

async function load() {
  try {
    docs.value = (await api.get<FileSummary[]>(`/tenders/${props.tenderId}/documents`)).data
    emit('changed', docs.value)
  } catch (err) {
    error.value = errorMessage(err)
  }
}
onMounted(load)

async function upload(e: Event) {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  if (!files.length) return
  error.value = ''
  uploading.value = true
  try {
    // One request per file, so one bad file does not stop the others.
    for (const f of files) {
      const body = new FormData()
      body.append('file', f)
      try {
        await api.post(`/tenders/${props.tenderId}/documents`, body, { timeout: 120_000 })
      } catch (err) {
        error.value = `${f.name}: ${errorMessage(err)}`
      }
    }
    await load()
  } finally {
    uploading.value = false
  }
}

async function remove(d: FileSummary) {
  if (!confirm(`Delete “${d.title}”?`)) return
  try {
    await api.delete(`/files/${d.id}`)
    await load()
  } catch (err) {
    error.value = errorMessage(err)
  }
}

const act = (fn: () => Promise<void>) => fn().catch((err) => (error.value = errorMessage(err)))
</script>

<template>
  <UiCard title="Tender Documents">
    <template #header>
      <label
        class="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md bg-blue-500 px-3 text-xs text-white hover:bg-blue-600"
      >
        <Paperclip class="size-4" aria-hidden="true" />
        {{ uploading ? 'Uploading…' : 'Add files' }}
        <input
          type="file"
          multiple
          accept=".pdf,.png,.jpg,.jpeg,.docx,.xlsx,.doc,.xls,.zip"
          class="sr-only"
          :disabled="uploading"
          @change="upload"
        />
      </label>
    </template>
    <UiAlert v-if="error" class="mb-3">{{ error }}</UiAlert>
    <ul v-if="docs.length" class="divide-y divide-gray-100 dark:divide-gray-800">
      <li v-for="d in docs" :key="d.id" class="flex items-center gap-3 py-2.5">
        <div class="min-w-0 flex-1">
          <p class="truncate text-theme-sm font-medium text-gray-800 dark:text-white/90">
            {{ d.title }}
          </p>
          <p class="text-theme-xs text-gray-500 dark:text-gray-400">
            {{ formatBytes(d.sizeBytes) }} · {{ d.uploadedBy?.name ?? 'System' }} ·
            {{ formatDate(d.createdAt) }}
          </p>
        </div>
        <IconButton
          v-if="viewable(d)"
          :icon="ACTION_ICONS.view"
          :label="`Open ${d.title}`"
          @click="act(() => openFile(d.id))"
        />
        <IconButton
          :icon="ACTION_ICONS.download"
          :label="`Download ${d.title}`"
          @click="act(() => downloadFile(d.id))"
        />
        <IconButton
          v-if="canDelete(d)"
          :icon="ACTION_ICONS.delete"
          :label="`Delete ${d.title}`"
          variant="danger"
          @click="remove(d)"
        />
      </li>
    </ul>
    <p v-else class="text-theme-sm text-gray-500 dark:text-gray-400">
      No documents yet. Add the tender document, BOQ, drawings or anything else the team needs.
    </p>
  </UiCard>
</template>
