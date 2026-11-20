<script setup lang="ts">
import { Copy, FileText, Plus } from 'lucide-vue-next'
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  COMPLIANCE_LETTERS,
  type LetterContent,
  type LetterLibrary,
  type LetterTemplateSummary,
} from '@tdm/shared'
import { ACTION_ICONS } from '@/components/ui/actions'
import DataTable from '@/components/ui/DataTable.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import IconButton from '@/components/ui/IconButton.vue'
import ModalCallout from '@/components/ui/ModalCallout.vue'
import type { TableColumn } from '@/components/ui/table'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiBadge from '@/components/ui/UiBadge.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiCard from '@/components/ui/UiCard.vue'
import UiModal from '@/components/ui/UiModal.vue'
import { api, errorMessage } from '@/services/api'
import { formatDate } from '@/utils/format'
import { openLetterPreview } from './letter-text'

/** The client's own declaration letters, and the built-in ones they can hide or copy. */
const router = useRouter()
const lib = ref<LetterLibrary | null>(null)
const loading = ref(true)
const error = ref('')
const notice = ref('')
const deleting = ref<LetterTemplateSummary | null>(null)
const busy = ref(false)

async function load() {
  try {
    lib.value = (await api.get<LetterLibrary>('/letter-templates')).data
  } catch (err) {
    error.value = errorMessage(err)
  } finally {
    loading.value = false
  }
}
onMounted(load)

const builtinTitle = (key: string | null) =>
  key ? (COMPLIANCE_LETTERS.find((l) => l.key === key)?.title ?? key) : null

async function preview(letter: LetterContent, companyId: string | null = null) {
  error.value = ''
  try {
    await openLetterPreview(letter, companyId)
  } catch (err) {
    error.value = err instanceof Error ? err.message : errorMessage(err)
  }
}

async function previewBuiltin(key: string) {
  error.value = ''
  try {
    const { data } = await api.get<LetterContent>(`/letter-templates/builtin/${key}`)
    await preview(data)
  } catch (err) {
    error.value = errorMessage(err)
  }
}

async function toggleHidden(key: string, hide: boolean) {
  if (!lib.value) return
  error.value = ''
  const keys = lib.value.builtins.filter((b) => (b.key === key ? hide : b.hidden)).map((b) => b.key)
  try {
    lib.value = (await api.put<LetterLibrary>('/letter-templates/hidden', { keys })).data
  } catch (err) {
    error.value = errorMessage(err)
  }
}

async function confirmDelete() {
  const t = deleting.value
  if (!t) return
  busy.value = true
  try {
    await api.delete(`/letter-templates/${t.id}`)
    notice.value = `Letter “${t.title}” deleted.`
    await load()
  } catch (err) {
    error.value = errorMessage(err)
  } finally {
    busy.value = false
    deleting.value = null
  }
}

const ownColumns: TableColumn[] = [
  { key: 'title', label: 'Letter', sticky: true, class: 'min-w-72' },
  { key: 'company', label: 'Used For' },
  { key: 'basedOn', label: 'Copied From' },
  { key: 'updatedAt', label: 'Last Changed' },
  { key: 'isActive', label: 'Status' },
]
const builtinColumns: TableColumn[] = [
  { key: 'title', label: 'Letter', sticky: true, class: 'min-w-72' },
  { key: 'hidden', label: 'Shown in the Compliance PDF List' },
]
</script>

<template>
  <div class="space-y-6">
    <UiAlert v-if="error">{{ error }}</UiAlert>
    <UiAlert v-if="notice" variant="success">{{ notice }}</UiAlert>

    <UiCard
      :level="1"
      title="Letter Templates"
      subtitle="Your own declaration letters for compliance PDFs. They print on the bidding company's letterhead with its signature, like the built-in letters."
      :icon="FileText"
    >
      <template #header>
        <UiButton size="xs" @click="router.push('/settings/letters/new')">
          <Plus class="size-4" aria-hidden="true" /> New Letter
        </UiButton>
      </template>
      <DataTable
        :columns="ownColumns"
        :rows="lib?.templates ?? []"
        :loading="loading"
        loading-text="Loading letters..."
      >
        <template #cell-title="{ row }">
          <RouterLink
            :to="`/settings/letters/${row.id}`"
            class="text-sm font-medium text-gray-800 hover:text-blue-600 hover:underline dark:text-white/90"
          >
            {{ row.title }}
          </RouterLink>
          <p v-if="row.subtitle" class="text-xs text-gray-500 dark:text-gray-400">
            {{ row.subtitle }}
          </p>
        </template>
        <template #cell-company="{ row }">
          <span class="text-xs">{{ row.company?.name ?? 'All companies' }}</span>
        </template>
        <template #cell-basedOn="{ row }">
          <span class="text-xs">{{ builtinTitle(row.basedOn) ?? '—' }}</span>
        </template>
        <template #cell-updatedAt="{ row }">
          <span class="text-xs whitespace-nowrap">{{ formatDate(row.updatedAt) }}</span>
        </template>
        <template #cell-isActive="{ row }">
          <UiBadge :color="row.isActive ? 'success' : 'gray'">
            {{ row.isActive ? 'In use' : 'Off' }}
          </UiBadge>
        </template>
        <template #actions="{ row }">
          <IconButton
            :icon="ACTION_ICONS.view"
            label="Preview PDF"
            @click="preview(row, row.company?.id ?? null)"
          />
          <IconButton
            :icon="ACTION_ICONS.edit"
            :label="`Edit ${row.title}`"
            :to="`/settings/letters/${row.id}`"
          />
          <IconButton
            :icon="ACTION_ICONS.delete"
            :label="`Delete ${row.title}`"
            variant="danger"
            @click="deleting = row"
          />
        </template>
        <template #empty>
          <EmptyState
            :icon="FileText"
            title="No letters of your own yet"
            description="Write a new letter, or copy one of the built-in letters below and change its wording."
          />
        </template>
      </DataTable>
    </UiCard>

    <UiCard
      title="Built-in Letters"
      subtitle="The standard letters from the original TMS. Hide the ones you never use, or copy one to change its wording (the original stays as it is)."
    >
      <DataTable
        :columns="builtinColumns"
        :rows="(lib?.builtins ?? []).map((b) => ({ ...b, id: b.key }))"
      >
        <template #cell-title="{ row }">
          <span :class="['text-sm', row.hidden && 'text-gray-400 line-through']">
            {{ row.title }}
          </span>
        </template>
        <template #cell-hidden="{ row }">
          <button
            type="button"
            role="switch"
            :aria-checked="!row.hidden"
            :aria-label="`Show ${row.title} in the compliance list`"
            :class="[
              'relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors',
              !row.hidden ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-700',
            ]"
            @click="toggleHidden(row.key, !row.hidden)"
          >
            <span
              :class="[
                'absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow-theme-sm transition-transform',
                !row.hidden && 'translate-x-5',
              ]"
            />
          </button>
        </template>
        <template #actions="{ row }">
          <IconButton
            :icon="ACTION_ICONS.view"
            label="Preview PDF"
            @click="previewBuiltin(row.key)"
          />
          <IconButton
            :icon="Copy"
            label="Copy and edit"
            :to="`/settings/letters/new?from=${row.key}`"
          />
        </template>
      </DataTable>
    </UiCard>

    <UiModal
      :open="!!deleting"
      :title="`Delete Letter: ${deleting?.title ?? ''}`"
      :busy="busy"
      @close="deleting = null"
    >
      <ModalCallout tone="warning" lead="Warning: ">
        “{{ deleting?.title }}” will no longer be offered for compliance PDFs. PDFs already made
        keep their copy of the letter.
      </ModalCallout>
      <template #footer>
        <UiButton variant="secondary" :disabled="busy" @click="deleting = null">Cancel</UiButton>
        <UiButton variant="danger" :loading="busy" @click="confirmDelete">Delete Letter</UiButton>
      </template>
    </UiModal>
  </div>
</template>
