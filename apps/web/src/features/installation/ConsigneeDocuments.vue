<script setup lang="ts">
import { FileImage, FileText, Upload } from 'lucide-vue-next'
import { ref } from 'vue'
import type { ConsigneeDocument } from '@tdm/shared'
import { PERMISSIONS } from '@tdm/shared/permissions'
import { ACTION_ICONS } from '@/components/ui/actions'
import IconButton from '@/components/ui/IconButton.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiCard from '@/components/ui/UiCard.vue'
import { api, errorMessage } from '@/services/api'
import { downloadFile, formatBytes, openFile } from '@/services/files'
import { useAuthStore } from '@/stores/auth'
import { formatDateTime } from '@/utils/format'

/**
 * Installation certificates and site photos for one consignee (the old
 * "Uploaded Documents" card). PDF, JPG or PNG; several at once.
 */
const props = defineProps<{
  tenderId: string
  consigneeId: string
  consigneeName: string
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
  if (!confirm(`Delete “${d.originalName}”? This removes the file for everyone.`)) return
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
  <UiCard
    v-if="documents.length || canUpload"
    title="Uploaded Documents"
    :subtitle="consigneeName"
    accent="purple"
  >
    <template v-if="canUpload" #header>
      <label
        class="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md bg-gray-200 px-3 text-sm text-gray-700 hover:bg-gray-300 dark:bg-white/5 dark:text-white/90 dark:hover:bg-white/10"
      >
        <Upload class="size-4" aria-hidden="true" />
        {{ uploading ? 'Uploading…' : 'Upload Documents' }}
        <input
          type="file"
          multiple
          accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
          class="sr-only"
          :disabled="uploading"
          @change="upload"
        />
      </label>
    </template>
    <UiAlert v-if="error" class="mb-3">{{ error }}</UiAlert>
    <ul v-if="documents.length" class="grid gap-3">
      <li
        v-for="d in documents"
        :key="d.id"
        class="flex items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800"
      >
        <component
          :is="d.mimeType.startsWith('image/') ? FileImage : FileText"
          class="size-8 shrink-0 text-gray-500 dark:text-gray-400"
          aria-hidden="true"
        />
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
            {{ d.originalName }}
          </p>
          <p class="text-xs text-gray-500 dark:text-gray-400">
            {{ formatBytes(d.sizeBytes) }} · Uploaded {{ formatDateTime(d.createdAt) }}
            <template v-if="d.uploadedBy"> · By {{ d.uploadedBy.name }}</template>
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
      Add the signed installation certificate or site photos. PDF, JPG or PNG.
    </p>
  </UiCard>
</template>
