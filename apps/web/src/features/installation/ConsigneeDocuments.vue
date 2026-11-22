<script setup lang="ts">
import { Paperclip } from 'lucide-vue-next'
import { ref } from 'vue'
import type { ConsigneeDocument } from '@tdm/shared'
import { PERMISSIONS } from '@tdm/shared/permissions'
import { ACTION_ICONS } from '@/components/ui/actions'
import IconButton from '@/components/ui/IconButton.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import { api, errorMessage } from '@/services/api'
import { downloadFile, formatBytes, openFile } from '@/services/files'
import { useAuthStore } from '@/stores/auth'
import { formatDate } from '@/utils/format'
import { SECTION_HEADING } from './installation-ui'

/**
 * A consignee's documents (signed installation certificate, site photos):
 * PDF, JPG or PNG, several at once. Laid out like the tender's documents list.
 */
const props = defineProps<{
  tenderId: string
  consigneeId: string
  documents: ConsigneeDocument[]
  canUpload: boolean
}>()
const emit = defineEmits<{ changed: [] }>()
const auth = useAuthStore()
const error = ref('')
const uploading = ref(false)

const canDelete = (d: ConsigneeDocument) =>
  d.uploadedBy?.id === auth.user?.id || auth.can(PERMISSIONS.INSTALLATION_MANAGE)

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
        await api.post(
          `/tenders/${props.tenderId}/installation-report/consignees/${props.consigneeId}/documents`,
          body,
          { timeout: 120_000 },
        )
      } catch (err) {
        error.value = `${f.name}: ${errorMessage(err)}`
      }
    }
    emit('changed')
  } finally {
    uploading.value = false
  }
}

async function remove(d: ConsigneeDocument) {
  if (!confirm(`Delete “${d.originalName}”?`)) return
  try {
    await api.delete(`/files/${d.id}`)
    emit('changed')
  } catch (err) {
    error.value = errorMessage(err)
  }
}

const act = (fn: () => Promise<void>) => fn().catch((err) => (error.value = errorMessage(err)))
</script>

<template>
  <section v-if="documents.length || canUpload">
    <div class="mb-2 flex items-center justify-between gap-3">
      <h4 :class="SECTION_HEADING">Documents ({{ documents.length }})</h4>
      <label
        v-if="canUpload"
        class="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md bg-gray-200 px-3 text-xs text-gray-700 hover:bg-gray-300 dark:bg-white/5 dark:text-white/90 dark:hover:bg-white/10"
      >
        <Paperclip class="size-3.5" aria-hidden="true" />
        {{ uploading ? 'Uploading…' : 'Add files' }}
        <input
          type="file"
          multiple
          accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
          class="sr-only"
          :disabled="uploading"
          @change="upload"
        />
      </label>
    </div>
    <UiAlert v-if="error" class="mb-2">{{ error }}</UiAlert>
    <ul v-if="documents.length" class="divide-y divide-gray-100 dark:divide-gray-800">
      <li v-for="d in documents" :key="d.id" class="flex items-center gap-3 py-2">
        <div class="min-w-0 flex-1">
          <p class="truncate text-theme-sm font-medium text-gray-800 dark:text-white/90">
            {{ d.originalName }}
          </p>
          <p class="text-theme-xs text-gray-500 dark:text-gray-400">
            {{ formatBytes(d.sizeBytes) }} · {{ d.uploadedBy?.name ?? 'System' }} ·
            {{ formatDate(d.createdAt) }}
          </p>
        </div>
        <IconButton
          :icon="ACTION_ICONS.view"
          :label="`Open ${d.originalName}`"
          @click="act(() => openFile(d.id))"
        />
        <IconButton
          :icon="ACTION_ICONS.download"
          :label="`Download ${d.originalName}`"
          @click="act(() => downloadFile(d.id))"
        />
        <IconButton
          v-if="canDelete(d)"
          :icon="ACTION_ICONS.delete"
          :label="`Delete ${d.originalName}`"
          variant="danger"
          @click="remove(d)"
        />
      </li>
    </ul>
    <p v-else class="text-theme-sm text-gray-500 dark:text-gray-400">
      Add the signed installation certificate or site photos (PDF, JPG or PNG).
    </p>
  </section>
</template>
