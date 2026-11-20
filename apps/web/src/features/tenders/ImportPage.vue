<script setup lang="ts">
import { FileSpreadsheet, Plus, Upload } from 'lucide-vue-next'
import { computed, onMounted, ref } from 'vue'
import {
  IMPORT_FIELDS,
  type ImportColumns,
  type ImportInspectResult,
  type ImportProfileSummary,
  type ImportResult,
} from '@tdm/shared'
import DataTable from '@/components/ui/DataTable.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import IconButton from '@/components/ui/IconButton.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiCard from '@/components/ui/UiCard.vue'
import UiModal from '@/components/ui/UiModal.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import { ACTION_ICONS } from '@/components/ui/actions'
import type { TableColumn } from '@/components/ui/table'
import { api, errorCode, errorMessage } from '@/services/api'
import { useWorkflowStore } from '@/stores/workflow'
import { formatDate } from '@/utils/format'
import ImportLayoutDialog from './ImportLayoutDialog.vue'

const TENDER247 = ''

const workflow = useWorkflowStore()
const file = ref<File | null>(null)
const dragging = ref(false)
const uploading = ref(false)
const error = ref('')
const columnsNotFound = ref(false)
const result = ref<ImportResult | null>(null)
const input = ref<HTMLInputElement | null>(null)

// Saved layouts (import profiles) and the one used for this upload.
const profiles = ref<ImportProfileSummary[]>([])
const loadingProfiles = ref(true)
const layout = ref(TENDER247)
const inspected = ref<ImportInspectResult | null>(null)
const detecting = ref(false)
const detectNote = ref<{ text: string; ok: boolean } | null>(null)
const notice = ref('')

const editorOpen = ref(false)
const editing = ref<ImportProfileSummary | null>(null)
const opening = ref(false)
const deleting = ref<ImportProfileSummary | null>(null)

onMounted(async () => {
  try {
    profiles.value = (await api.get<ImportProfileSummary[]>('/import-profiles')).data
  } catch (err) {
    error.value = errorMessage(err)
  } finally {
    loadingProfiles.value = false
  }
})

const layoutOptions = computed(() => [
  { value: TENDER247, label: 'Tender247 export' },
  ...profiles.value.map((p) => ({ value: p.id, label: p.name })),
])

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toUpperCase()

/** True when one sheet of the file has every column the layout uses. */
function fits(columns: ImportColumns, info: ImportInspectResult): boolean {
  const wanted = Object.values(columns).filter(Boolean).map(norm)
  return info.sheets.some((s) => {
    const have = new Set(s.headings.map(norm))
    return wanted.every((h) => have.has(h))
  })
}

/** Reads the file's column headings and picks the layout that matches it. */
async function detect(f: File) {
  detecting.value = true
  detectNote.value = null
  try {
    const form = new FormData()
    form.append('file', f)
    const info = (await api.post<ImportInspectResult>('/tenders/import/inspect', form)).data
    if (file.value !== f) return
    inspected.value = info
    const s = info.suggested
    const match = profiles.value.find((p) => fits(p.columns, info))
    if (match) {
      layout.value = match.id
      detectNote.value = { text: `Matches your “${match.name}” layout.`, ok: true }
    } else if (s.title && s.deadline && (s.referenceNo || s.sourceTenderId)) {
      layout.value = TENDER247
      detectNote.value = { text: 'Recognised as a Tender247 export.', ok: true }
    } else {
      detectNote.value = {
        text: 'The columns of this file do not match Tender247 or a saved layout. Set up its layout before importing.',
        ok: false,
      }
    }
  } catch (err) {
    if (file.value === f) error.value = errorMessage(err)
  } finally {
    detecting.value = false
  }
}

function choose(f: File | undefined | null) {
  error.value = ''
  columnsNotFound.value = false
  notice.value = ''
  result.value = null
  inspected.value = null
  detectNote.value = null
  if (!f) return
  if (!/\.xlsx$/i.test(f.name)) {
    error.value = 'Choose an Excel file (.xlsx).'
    return
  }
  if (f.size > 10 * 1024 * 1024) {
    error.value = 'The file is larger than 10 MB.'
    return
  }
  file.value = f
  void detect(f)
}

function onDrop(e: DragEvent) {
  dragging.value = false
  choose(e.dataTransfer?.files[0])
}

async function upload() {
  if (!file.value) return
  error.value = ''
  columnsNotFound.value = false
  notice.value = ''
  uploading.value = true
  try {
    const form = new FormData()
    if (layout.value) form.append('profileId', layout.value)
    form.append('file', file.value)
    result.value = (
      await api.post<ImportResult>('/tenders/import', form, { timeout: 120_000 })
    ).data
    file.value = null
    inspected.value = null
    detectNote.value = null
    if (input.value) input.value.value = ''
    void workflow.refreshCounts()
  } catch (err) {
    error.value = errorMessage(err)
    columnsNotFound.value = errorCode(err) === 'COLUMNS_NOT_FOUND'
  } finally {
    uploading.value = false
  }
}

/** Opens the layout editor, with the chosen file's columns to pick from. */
async function openEditor(profile: ImportProfileSummary | null) {
  error.value = ''
  notice.value = ''
  if (file.value && !inspected.value) {
    opening.value = true
    await detect(file.value)
    opening.value = false
    if (!inspected.value) return
  }
  editing.value = profile
  editorOpen.value = true
}

function onSaved(p: ImportProfileSummary) {
  const isNew = !profiles.value.some((x) => x.id === p.id)
  profiles.value = [...profiles.value.filter((x) => x.id !== p.id), p].sort((a, b) =>
    a.name.localeCompare(b.name),
  )
  editorOpen.value = false
  if (isNew && file.value) {
    layout.value = p.id
    columnsNotFound.value = false
    error.value = ''
    detectNote.value = { text: `Using your new “${p.name}” layout.`, ok: true }
  }
  notice.value = isNew ? `Layout “${p.name}” saved.` : `Layout “${p.name}” updated.`
}

async function confirmDelete() {
  const p = deleting.value
  if (!p) return
  deleting.value = null
  try {
    await api.delete(`/import-profiles/${p.id}`)
    profiles.value = profiles.value.filter((x) => x.id !== p.id)
    if (layout.value === p.id) layout.value = TENDER247
    notice.value = `Layout “${p.name}” deleted.`
  } catch (err) {
    error.value = errorMessage(err)
  }
}

const skippedTotal = (r: ImportResult) =>
  r.skipped.expired + r.skipped.noReference + r.skipped.duplicateInFile + r.skipped.invalid

const layoutColumns: TableColumn[] = [
  { key: 'name', label: 'Layout', class: 'min-w-44' },
  { key: 'columns', label: 'Main columns', class: 'min-w-72' },
  { key: 'updatedAt', label: 'Last changed' },
]
const LABELS = Object.fromEntries(IMPORT_FIELDS.map((f) => [f.key, f.label]))
const mainColumns = (c: ImportColumns) => {
  const keys = (['referenceNo', 'sourceTenderId', 'title', 'deadline'] as const).filter((k) => c[k])
  return keys.map((k) => ({ label: LABELS[k], heading: c[k]! }))
}
const otherCount = (c: ImportColumns) =>
  Object.values(c).filter(Boolean).length - mainColumns(c).length
</script>

<template>
  <div>
    <UiAlert v-if="notice" variant="success" class="mb-4">{{ notice }}</UiAlert>

    <UiCard
      :level="1"
      title="Import from Excel"
      subtitle="Upload the tender list exported from Tender247, or from another portal using a saved layout."
      :icon="Upload"
    >
      <label
        :class="[
          'flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-10 text-center transition',
          dragging
            ? 'border-brand-500 bg-brand-50 dark:bg-brand-500/10'
            : 'border-gray-300 hover:border-brand-300 dark:border-gray-700',
        ]"
        @dragover.prevent="dragging = true"
        @dragleave.prevent="dragging = false"
        @drop.prevent="onDrop"
      >
        <input
          ref="input"
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          class="sr-only"
          @change="choose(($event.target as HTMLInputElement).files?.[0])"
        />
        <component
          :is="file ? FileSpreadsheet : Upload"
          class="mb-3 size-8 text-gray-400"
          aria-hidden="true"
        />
        <p v-if="file" class="text-sm font-medium text-gray-800 dark:text-white/90">
          {{ file.name }}
        </p>
        <p v-else class="text-sm font-medium text-gray-800 dark:text-white/90">
          Drop the Excel file here, or click to choose it
        </p>
        <p class="mt-1 text-theme-xs text-gray-500 dark:text-gray-400">.xlsx, up to 10 MB</p>
      </label>

      <div class="mt-5 flex flex-wrap items-end gap-3">
        <UiSelect
          v-model="layout"
          label="File layout"
          :options="layoutOptions"
          :disabled="loadingProfiles"
          class="w-full sm:w-80"
        />
        <span v-tooltip="file ? undefined : 'Choose a file first, to pick from its columns'">
          <UiButton
            variant="outline"
            :disabled="!file"
            :loading="opening"
            @click="openEditor(null)"
          >
            <Plus class="size-4" aria-hidden="true" /> New layout
          </UiButton>
        </span>
      </div>
      <p v-if="detecting" class="mt-2 text-theme-xs text-gray-500 dark:text-gray-400" role="status">
        Reading the file's columns…
      </p>
      <p
        v-else-if="detectNote"
        role="status"
        :class="[
          'mt-2 text-theme-xs',
          detectNote.ok
            ? 'text-success-600 dark:text-success-500'
            : 'text-warning-600 dark:text-orange-400',
        ]"
      >
        {{ detectNote.text }}
      </p>

      <UiAlert v-if="error" class="mt-4">
        {{ error }}
        <button
          v-if="columnsNotFound && file"
          type="button"
          class="mt-2 block font-medium underline underline-offset-2"
          @click="openEditor(null)"
        >
          Set up this file's layout
        </button>
      </UiAlert>

      <div class="mt-5 flex flex-wrap items-center justify-between gap-3">
        <p class="max-w-xl text-theme-xs text-gray-500 dark:text-gray-400">
          Tenders already in your list are matched by reference number: their details are refreshed
          and their stage stays the same. Rows whose deadline has passed are skipped. Rows without a
          reference number use the portal's tender ID instead.
        </p>
        <UiButton :disabled="!file || detecting" :loading="uploading" @click="upload">
          {{ uploading ? 'Importing…' : 'Import tenders' }}
        </UiButton>
      </div>
    </UiCard>

    <UiCard
      v-if="result"
      class="mt-6"
      :title="`Imported ${result.fileName}`"
      :subtitle="`Layout: ${result.layout}`"
    >
      <div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div class="rounded-lg bg-success-50 p-4 dark:bg-success-500/10">
          <p class="text-title-sm font-bold text-success-700 dark:text-success-500">
            {{ result.created }}
          </p>
          <p class="text-theme-sm text-gray-600 dark:text-gray-400">New tenders</p>
        </div>
        <div class="rounded-lg bg-warning-50 p-4 dark:bg-warning-500/10">
          <p class="text-title-sm font-bold text-warning-700 dark:text-orange-400">
            {{ result.updated }}
          </p>
          <p class="text-theme-sm text-gray-600 dark:text-gray-400">Updated</p>
        </div>
        <div class="rounded-lg bg-gray-100 p-4 dark:bg-white/5">
          <p class="text-title-sm font-bold text-gray-800 dark:text-white/90">
            {{ result.unchanged }}
          </p>
          <p class="text-theme-sm text-gray-600 dark:text-gray-400">Already up to date</p>
        </div>
        <div class="rounded-lg bg-gray-100 p-4 dark:bg-white/5">
          <p class="text-title-sm font-bold text-gray-800 dark:text-white/90">
            {{ skippedTotal(result) }}
          </p>
          <p class="text-theme-sm text-gray-600 dark:text-gray-400">Skipped</p>
        </div>
      </div>

      <ul class="mt-5 space-y-1 text-theme-sm text-gray-600 dark:text-gray-400">
        <li v-if="result.restored">
          {{ result.restored }} tender(s) had missed their deadline; the new sheet extended it, so
          they went back to their earlier stage.
        </li>
        <li v-if="result.skipped.expired">
          {{ result.skipped.expired }} skipped: deadline already passed.
        </li>
        <li v-if="result.skipped.noReference">
          {{ result.skipped.noReference }} skipped: no reference number or tender ID.
        </li>
        <li v-if="result.skipped.duplicateInFile">
          {{ result.skipped.duplicateInFile }} skipped: same reference number appears twice in the
          file.
        </li>
        <li v-if="result.skipped.invalid">
          {{ result.skipped.invalid }} skipped: details could not be read (listed below).
        </li>
      </ul>

      <div v-if="result.issues.length" class="custom-scrollbar mt-5 max-h-80 overflow-auto">
        <table class="min-w-full text-theme-sm">
          <thead
            class="sticky top-0 bg-white text-left text-theme-xs text-gray-500 dark:bg-gray-900 dark:text-gray-400"
          >
            <tr>
              <th class="py-2 pr-4 font-medium">Sheet</th>
              <th class="py-2 pr-4 font-medium">Row</th>
              <th class="py-2 font-medium">Problem</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100 dark:divide-gray-800">
            <tr v-for="(i, n) in result.issues" :key="n">
              <td class="py-2 pr-4 text-gray-700 dark:text-gray-300">{{ i.sheet }}</td>
              <td class="py-2 pr-4 text-gray-700 tabular-nums dark:text-gray-300">{{ i.row }}</td>
              <td class="py-2 text-gray-700 dark:text-gray-300">{{ i.message }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <RouterLink
        to="/tenders"
        class="mt-5 inline-block text-sm font-medium text-brand-500 hover:text-brand-600"
      >
        View tenders
      </RouterLink>
    </UiCard>

    <UiCard
      class="mt-6"
      title="Saved Layouts"
      subtitle="For files from other portals or your own sheets. Tender247 exports need no layout."
    >
      <DataTable
        :columns="layoutColumns"
        :rows="profiles"
        :loading="loadingProfiles"
        loading-text="Loading layouts…"
      >
        <template #cell-name="{ row }">
          <span class="font-medium text-gray-800 dark:text-white/90">{{ row.name }}</span>
        </template>
        <template #cell-columns="{ row }">
          <p class="text-theme-xs text-gray-600 dark:text-gray-400">
            <template v-for="(c, n) in mainColumns(row.columns)" :key="c.label">
              <template v-if="n > 0"> · </template>{{ c.label }}:
              <span class="text-gray-800 dark:text-white/90">{{ c.heading }}</span>
            </template>
            <template v-if="otherCount(row.columns) > 0">
              · {{ otherCount(row.columns) }} more</template
            >
          </p>
        </template>
        <template #cell-updatedAt="{ row }">
          <span class="whitespace-nowrap text-gray-500 dark:text-gray-400">
            {{ formatDate(row.updatedAt) }}
          </span>
        </template>
        <template #actions="{ row }">
          <IconButton
            :icon="ACTION_ICONS.edit"
            :label="`Edit ${row.name}`"
            @click="openEditor(row)"
          />
          <IconButton
            :icon="ACTION_ICONS.delete"
            :label="`Delete ${row.name}`"
            variant="danger"
            @click="deleting = row"
          />
        </template>
        <template #empty>
          <EmptyState
            title="No saved layouts"
            description="Choose a file from another portal and click New layout to say which column holds each detail."
          />
        </template>
      </DataTable>
    </UiCard>

    <ImportLayoutDialog
      :open="editorOpen"
      :profile="editing"
      :sheets="inspected?.sheets ?? []"
      :suggested="inspected?.suggested ?? {}"
      :file-name="inspected ? file?.name : undefined"
      @close="editorOpen = false"
      @saved="onSaved"
    />

    <UiModal :open="!!deleting" title="Delete this layout?" @close="deleting = null">
      <p class="text-sm text-gray-600 dark:text-gray-400">
        “{{ deleting?.name }}” will be removed. Tenders already imported with it are not affected.
      </p>
      <template #footer>
        <UiButton variant="secondary" @click="deleting = null">Cancel</UiButton>
        <UiButton variant="danger" @click="confirmDelete">Delete</UiButton>
      </template>
    </UiModal>
  </div>
</template>
