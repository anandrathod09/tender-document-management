<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import {
  IMPORT_FIELDS,
  type ImportColumns,
  type ImportField,
  type ImportProfileSummary,
  type ImportSheetInfo,
} from '@tdm/shared'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiModal from '@/components/ui/UiModal.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import { api, errorMessage, fieldErrors } from '@/services/api'

/**
 * Says which column of a client's own Excel file holds each tender detail,
 * and saves that as a reusable layout (import profile).
 */
const props = defineProps<{
  open: boolean
  /** The layout being changed; empty for a new one. */
  profile: ImportProfileSummary | null
  /** Sheets of the chosen file, when there is one. */
  sheets: ImportSheetInfo[]
  /** Columns recognised in the file, used to start a new layout. */
  suggested: ImportColumns
  fileName?: string
}>()
const emit = defineEmits<{ close: []; saved: [profile: ImportProfileSummary] }>()

const name = ref('')
const columns = reactive<Record<ImportField, string>>(
  Object.fromEntries(IMPORT_FIELDS.map((f) => [f.key, ''])) as Record<ImportField, string>,
)
const error = ref('')
const errors = ref<Record<string, string>>({})
const saving = ref(false)

watch(
  () => props.open,
  (open) => {
    if (!open) return
    error.value = ''
    errors.value = {}
    name.value = props.profile?.name ?? ''
    const start = props.profile?.columns ?? props.suggested
    for (const f of IMPORT_FIELDS) columns[f.key] = start[f.key] ?? ''
  },
)

/** Headings from the file, plus any the layout already uses (so nothing disappears). */
const headings = computed(() => {
  const all = new Set(props.sheets.flatMap((s) => s.headings))
  for (const h of Object.values(props.profile?.columns ?? {})) if (h) all.add(h)
  return [...all]
})
const options = computed(() => [
  { value: '', label: '— Not in this file —' },
  ...headings.value.map((h) => ({ value: h, label: h })),
])

/** The same heading picked for two details is almost always a slip. */
const repeated = computed(() => {
  const seen = new Map<string, number>()
  for (const v of Object.values(columns)) if (v) seen.set(v, (seen.get(v) ?? 0) + 1)
  return new Set([...seen].filter(([, n]) => n > 1).map(([h]) => h))
})

const missing = computed(() => {
  const out: string[] = []
  if (!columns.title) out.push('tender brief')
  if (!columns.deadline) out.push('deadline')
  if (!columns.referenceNo && !columns.sourceTenderId) out.push('reference number or tender ID')
  return out
})

const title = computed(() =>
  props.profile ? `Edit layout: ${props.profile.name}` : 'New Excel layout',
)

async function save() {
  error.value = ''
  errors.value = {}
  if (missing.value.length) {
    error.value = `Choose the column for the ${missing.value.join(', ')}.`
    return
  }
  saving.value = true
  try {
    const body = {
      name: name.value,
      columns: Object.fromEntries(Object.entries(columns).filter(([, h]) => h)),
    }
    const { data } = props.profile
      ? await api.put<ImportProfileSummary>(`/import-profiles/${props.profile.id}`, body)
      : await api.post<ImportProfileSummary>('/import-profiles', body)
    emit('saved', data)
  } catch (err) {
    errors.value = fieldErrors(err)
    error.value = errors.value.name ? '' : errorMessage(err)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UiModal :open="open" :title="title" width="lg" @close="emit('close')">
    <form id="import-layout" class="space-y-4" @submit.prevent="save">
      <UiAlert v-if="error">{{ error }}</UiAlert>
      <UiInput
        v-model="name"
        label="Layout name"
        placeholder="e.g. GeM portal export"
        required
        :error="errors.name"
      />
      <p class="text-theme-sm text-gray-500 dark:text-gray-400">
        <template v-if="fileName">
          For each tender detail, pick the column of <strong>{{ fileName }}</strong> that holds it.
        </template>
        <template v-else>
          Choose a file on the import page to pick from its columns. Without one, only the columns
          this layout already uses are listed.
        </template>
        Every sheet with these columns is read; the column names must match the first row.
      </p>

      <div
        class="custom-scrollbar -mx-1 max-h-[52vh] overflow-y-auto px-1 pb-1"
        role="group"
        aria-label="Columns"
      >
        <div class="grid gap-x-4 gap-y-3 sm:grid-cols-2">
          <div v-for="f in IMPORT_FIELDS" :key="f.key">
            <UiSelect
              v-model="columns[f.key]"
              :label="f.label"
              :options="options"
              :required="f.key === 'title' || f.key === 'deadline'"
              :error="
                columns[f.key] && repeated.has(columns[f.key])
                  ? 'Also picked for another detail'
                  : undefined
              "
            />
            <p
              v-if="'hint' in f && !(columns[f.key] && repeated.has(columns[f.key]))"
              class="mt-1 text-theme-xs text-gray-500 dark:text-gray-400"
            >
              {{ f.hint }}
            </p>
          </div>
        </div>
      </div>
      <p class="text-theme-xs text-gray-500 dark:text-gray-400">
        A reference number or a tender ID is needed to recognise tenders when the same file is
        uploaded again.
      </p>
    </form>
    <template #footer>
      <UiButton variant="secondary" @click="emit('close')">Cancel</UiButton>
      <UiButton type="submit" form="import-layout" :loading="saving">Save layout</UiButton>
    </template>
  </UiModal>
</template>
