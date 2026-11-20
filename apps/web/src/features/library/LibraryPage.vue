<script setup lang="ts">
import { FolderOpen, Upload } from 'lucide-vue-next'
import { computed, onMounted, ref } from 'vue'
import type { CompanySummary, FileSummary } from '@tdm/shared'
import { PERMISSIONS } from '@tdm/shared/permissions'
import { ACTION_ICONS } from '@/components/ui/actions'
import DataTable from '@/components/ui/DataTable.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import IconButton from '@/components/ui/IconButton.vue'
import { sortLocal, type TableColumn } from '@/components/ui/table'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiCard from '@/components/ui/UiCard.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiModal from '@/components/ui/UiModal.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import { api, errorMessage, fieldErrors } from '@/services/api'
import { downloadFile, formatBytes, openFile } from '@/services/files'
import { useAuthStore } from '@/stores/auth'
import { formatDate } from '@/utils/format'

const auth = useAuthStore()
const canManage = auth.can(PERMISSIONS.COMPANY_MANAGE)

const docs = ref<FileSummary[]>([])
const companies = ref<CompanySummary[]>([])
const companyFilter = ref('')
const loading = ref(true)
const error = ref('')

const uploadOpen = ref(false)
const title = ref('')
const companyId = ref('')
const file = ref<File | null>(null)
const errors = ref<Record<string, string>>({})
const uploadError = ref('')
const uploading = ref(false)
const deleting = ref<FileSummary | null>(null)

const companyName = (id: string | null) =>
  companies.value.find((c) => c.id === id)?.name ?? 'All companies'
const shown = computed(() =>
  companyFilter.value ? docs.value.filter((d) => d.companyId === companyFilter.value) : docs.value,
)
const sort = ref('-createdAt')
const columns: TableColumn[] = [
  { key: 'title', label: 'Document', sort: true, class: 'min-w-56' },
  { key: 'company', label: 'Company', sort: true },
  { key: 'sizeBytes', label: 'Size', sort: true, align: 'right' },
  { key: 'createdAt', label: 'Added', sort: true },
]
const rows = computed(() =>
  sortLocal(shown.value, sort.value, {
    title: (d) => d.title,
    company: (d) => (d.companyId ? companyName(d.companyId) : ''),
    sizeBytes: (d) => d.sizeBytes,
    createdAt: (d) => Date.parse(d.createdAt),
  }),
)
const companyOptions = computed(() => [
  { value: '', label: 'All companies (shared)' },
  ...companies.value.map((c) => ({ value: c.id, label: c.name })),
])

onMounted(async () => {
  try {
    const [d, c] = await Promise.all([
      api.get<FileSummary[]>('/library'),
      api.get<CompanySummary[]>('/companies'),
    ])
    docs.value = d.data
    companies.value = c.data
  } catch (err) {
    error.value = errorMessage(err)
  } finally {
    loading.value = false
  }
})

function startUpload() {
  title.value = ''
  companyId.value = companyFilter.value
  file.value = null
  errors.value = {}
  uploadError.value = ''
  uploadOpen.value = true
}

function chooseFile(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0] ?? null
  file.value = f
  if (f && !title.value) title.value = f.name.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ')
}

async function upload() {
  if (!file.value) {
    errors.value = { file: 'Choose a file' }
    return
  }
  errors.value = {}
  uploadError.value = ''
  uploading.value = true
  try {
    const body = new FormData()
    body.append('title', title.value)
    body.append('companyId', companyId.value)
    body.append('file', file.value)
    docs.value.unshift((await api.post<FileSummary>('/library', body, { timeout: 120_000 })).data)
    uploadOpen.value = false
  } catch (err) {
    errors.value = fieldErrors(err)
    if (!Object.keys(errors.value).length) uploadError.value = errorMessage(err)
  } finally {
    uploading.value = false
  }
}

async function confirmDelete() {
  const d = deleting.value
  if (!d) return
  try {
    await api.delete(`/files/${d.id}`)
    docs.value = docs.value.filter((x) => x.id !== d.id)
    deleting.value = null
  } catch (err) {
    error.value = errorMessage(err)
    deleting.value = null
  }
}

const act = (fn: () => Promise<void>) => fn().catch((err) => (error.value = errorMessage(err)))
</script>

<template>
  <div>
    <UiAlert v-if="error" class="mb-4">{{ error }}</UiAlert>

    <UiCard
      :level="1"
      title="Document Library"
      subtitle="Certificates and papers you attach to many tenders: GST, PAN, ISO, experience letters and so on."
      :icon="FolderOpen"
    >
      <template #header>
        <select
          v-if="companies.length"
          v-model="companyFilter"
          class="form-field h-9! w-auto! py-0! pr-9! text-sm!"
          aria-label="Filter by company"
        >
          <option value="">All documents</option>
          <option v-for="c in companies" :key="c.id" :value="c.id">{{ c.name }}</option>
        </select>
        <UiButton v-if="canManage" size="xs" @click="startUpload">
          <Upload class="size-4" aria-hidden="true" /> Upload
        </UiButton>
      </template>
      <DataTable
        v-model:sort="sort"
        :columns="columns"
        :rows="rows"
        :loading="loading"
        loading-text="Loading documents…"
      >
        <template #cell-title="{ row }">
          <p class="font-medium text-gray-800 dark:text-white/90">{{ row.title }}</p>
          <p class="text-theme-xs text-gray-500 dark:text-gray-400">{{ row.originalName }}</p>
        </template>
        <template #cell-company="{ row }">{{ companyName(row.companyId) }}</template>
        <template #cell-sizeBytes="{ row }">
          <span class="whitespace-nowrap tabular-nums">{{ formatBytes(row.sizeBytes) }}</span>
        </template>
        <template #cell-createdAt="{ row }">
          <span class="whitespace-nowrap text-gray-500 dark:text-gray-400">
            {{ formatDate(row.createdAt)
            }}<template v-if="row.uploadedBy"> · {{ row.uploadedBy.name }}</template>
          </span>
        </template>
        <template #actions="{ row }">
          <IconButton
            v-if="row.mimeType === 'application/pdf' || row.mimeType.startsWith('image/')"
            :icon="ACTION_ICONS.view"
            :label="`Open ${row.title}`"
            @click="act(() => openFile(row.id))"
          />
          <IconButton
            :icon="ACTION_ICONS.download"
            :label="`Download ${row.title}`"
            @click="act(() => downloadFile(row.id))"
          />
          <IconButton
            v-if="canManage"
            :icon="ACTION_ICONS.delete"
            :label="`Delete ${row.title}`"
            variant="danger"
            @click="deleting = row"
          />
        </template>
        <template #empty>
          <EmptyState
            title="No documents yet"
            description="Upload the certificates you attach to tenders once, then pick them when building a compliance PDF."
          />
        </template>
      </DataTable>
    </UiCard>

    <UiModal :open="uploadOpen" title="Upload to the library" @close="uploadOpen = false">
      <form id="library-upload" class="space-y-4" novalidate @submit.prevent="upload">
        <UiAlert v-if="uploadError">{{ uploadError }}</UiAlert>
        <div>
          <label
            class="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400"
            for="lib-file"
            >File *</label
          >
          <input
            id="lib-file"
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,.docx,.xlsx,.doc,.xls,.zip"
            class="block w-full text-sm text-gray-700 file:mr-4 file:rounded-lg file:border-0 file:bg-brand-50 file:px-4 file:py-2 file:text-sm file:font-medium file:text-brand-600 dark:text-gray-300"
            @change="chooseFile"
          />
          <p class="mt-1.5 text-theme-xs" :class="errors.file ? 'text-error-500' : 'text-gray-500'">
            {{
              errors.file ?? 'PDF or image files can be merged into compliance PDFs. Up to 25 MB.'
            }}
          </p>
        </div>
        <UiInput v-model="title" label="Title" :error="errors.title" required />
        <UiSelect v-model="companyId" label="Belongs to" :options="companyOptions" />
      </form>
      <template #footer>
        <UiButton variant="secondary" @click="uploadOpen = false">Cancel</UiButton>
        <UiButton type="submit" form="library-upload" :loading="uploading">Upload</UiButton>
      </template>
    </UiModal>

    <UiModal :open="!!deleting" title="Delete this document?" @close="deleting = null">
      <p class="text-sm text-gray-600 dark:text-gray-400">
        “{{ deleting?.title }}” will be removed from the library. Compliance PDFs already built are
        not affected.
      </p>
      <template #footer>
        <UiButton variant="secondary" @click="deleting = null">Cancel</UiButton>
        <UiButton variant="danger" @click="confirmDelete">Delete</UiButton>
      </template>
    </UiModal>
  </div>
</template>
