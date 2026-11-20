<script setup lang="ts">
import { ArrowDown, ArrowLeft, ArrowUp, Eye, FileText, Plus } from 'lucide-vue-next'
import { computed, nextTick, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  COMPLIANCE_LETTERS,
  LETTER_BLOCK_KINDS,
  LETTER_FIELDS,
  type CompanySummary,
  type LetterBlock,
  type LetterContent,
  type LetterLibrary,
  type LetterTemplateSummary,
} from '@tdm/shared'
import { ACTION_ICONS } from '@/components/ui/actions'
import IconButton from '@/components/ui/IconButton.vue'
import ModalNote from '@/components/ui/ModalNote.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiCard from '@/components/ui/UiCard.vue'
import UiCheckbox from '@/components/ui/UiCheckbox.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import { api, errorMessage, fieldErrors } from '@/services/api'
import {
  fromEditable,
  newBlock,
  openLetterPreview,
  toEditable,
  type EditableBlock,
} from './letter-text'

/**
 * Writes or edits one of the client's own letters: title, options and the
 * text, with buttons that insert fill-in fields at the cursor.
 */
const route = useRoute()
const router = useRouter()
const id = typeof route.params.id === 'string' ? route.params.id : null
const fromKey = typeof route.query.from === 'string' ? route.query.from : null

const title = ref('')
const subtitle = ref('')
const companyId = ref('')
const addressed = ref(true)
const dateAtTop = ref(false)
const isActive = ref(true)
const basedOn = ref<string | null>(null)
const blocks = ref<EditableBlock[]>([newBlock()])
const companies = ref<CompanySummary[]>([])

const loading = ref(true)
const saving = ref(false)
const previewing = ref(false)
const error = ref('')
const errors = ref<Record<string, string>>({})

function apply(c: LetterContent) {
  title.value = c.title
  subtitle.value = c.subtitle ?? ''
  addressed.value = c.addressed
  dateAtTop.value = c.dateAtTop
  blocks.value = c.body.map(toEditable)
}

onMounted(async () => {
  try {
    const companiesRes = api.get<CompanySummary[]>('/companies')
    if (id) {
      const lib = (await api.get<LetterLibrary>('/letter-templates')).data
      const t = lib.templates.find((x: LetterTemplateSummary) => x.id === id)
      if (!t) throw new Error('This letter no longer exists.')
      apply(t)
      companyId.value = t.company?.id ?? ''
      isActive.value = t.isActive
      basedOn.value = t.basedOn
    } else if (fromKey) {
      const c = (await api.get<LetterContent>(`/letter-templates/builtin/${fromKey}`)).data
      apply(c)
      title.value = `${c.title} (our wording)`
      basedOn.value = fromKey
    }
    companies.value = (await companiesRes).data
  } catch (err) {
    error.value = err instanceof Error && !('response' in err) ? err.message : errorMessage(err)
  } finally {
    loading.value = false
  }
})

const heading = computed(() =>
  id
    ? 'Edit Letter'
    : fromKey
      ? `Copy of “${COMPLIANCE_LETTERS.find((l) => l.key === fromKey)?.title ?? fromKey}”`
      : 'New Letter',
)
const companyOptions = computed(() => [
  { value: '', label: 'All bidding companies' },
  ...companies.value.map((c) => ({
    value: c.id,
    label: `Only ${c.name}${c.isActive ? '' : ' (inactive)'}`,
  })),
])
const kindOptions = LETTER_BLOCK_KINDS.map((k) => ({ value: k.kind, label: k.label }))
const hint = (kind: LetterBlock['kind']) =>
  kind === 'numbered' || kind === 'bullets'
    ? 'One item per line.'
    : kind === 'fields'
      ? 'One per line, as Label: value (for example Tender Ref No.: {{tender_ref}}).'
      : ''

// --- Blocks ---------------------------------------------------------------------
function addBlock(kind: LetterBlock['kind'], after?: number) {
  const b = newBlock(kind)
  const i = after === undefined ? blocks.value.length : after + 1
  blocks.value.splice(i, 0, b)
  void nextTick(() => boxes.get(b.key)?.focus())
}
function move(i: number, by: -1 | 1) {
  const j = i + by
  if (j < 0 || j >= blocks.value.length) return
  const list = blocks.value
  ;[list[i], list[j]] = [list[j]!, list[i]!]
}
function remove(i: number) {
  blocks.value.splice(i, 1)
  if (!blocks.value.length) blocks.value.push(newBlock())
}

// --- Inserting fields at the cursor ------------------------------------------------
const boxes = new Map<number, HTMLTextAreaElement>()
let lastBox: { key: number; start: number; end: number } | null = null
function remember(key: number, e: Event) {
  const t = e.target as HTMLTextAreaElement
  lastBox = { key, start: t.selectionStart, end: t.selectionEnd }
}
function insertField(field: string) {
  const token = `{{${field}}}`
  const target = lastBox
    ? blocks.value.find((b) => b.key === lastBox!.key)
    : blocks.value[blocks.value.length - 1]
  if (!target) return
  const start = lastBox?.key === target.key ? lastBox.start : target.text.length
  const end = lastBox?.key === target.key ? lastBox.end : target.text.length
  target.text = target.text.slice(0, start) + token + target.text.slice(end)
  const caret = start + token.length
  lastBox = { key: target.key, start: caret, end: caret }
  void nextTick(() => {
    const el = boxes.get(target.key)
    el?.focus()
    el?.setSelectionRange(caret, caret)
  })
}

// --- Saving and preview --------------------------------------------------------------
const content = (): LetterContent & { companyId: string | null } => ({
  title: title.value,
  subtitle: subtitle.value || null,
  addressed: addressed.value,
  dateAtTop: dateAtTop.value,
  body: blocks.value.filter((b) => b.text.trim()).map(fromEditable),
  companyId: companyId.value || null,
})

async function preview() {
  error.value = ''
  previewing.value = true
  try {
    await openLetterPreview(content(), companyId.value || null)
  } catch (err) {
    error.value = err instanceof Error ? err.message : errorMessage(err)
  } finally {
    previewing.value = false
  }
}

async function save() {
  error.value = ''
  errors.value = {}
  saving.value = true
  try {
    const body = { ...content(), isActive: isActive.value, basedOn: basedOn.value }
    if (id) await api.put(`/letter-templates/${id}`, body)
    else await api.post('/letter-templates', body)
    await router.push('/settings/letters')
  } catch (err) {
    errors.value = fieldErrors(err)
    error.value = errors.value.body ?? (errors.value.title ? '' : errorMessage(err))
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="space-y-6">
    <nav class="flex flex-wrap items-center gap-2 text-sm" aria-label="Breadcrumb">
      <RouterLink
        to="/settings/letters"
        class="flex items-center gap-2 text-gray-600 transition-colors hover:text-blue-600 dark:text-gray-400 dark:hover:text-blue-400"
      >
        <ArrowLeft class="size-4" aria-hidden="true" /> Back to Letter Templates
      </RouterLink>
      <span class="text-gray-400">/</span>
      <span class="font-medium text-blue-600 dark:text-blue-400">{{ heading }}</span>
    </nav>

    <UiAlert v-if="error">{{ error }}</UiAlert>

    <div v-if="!loading" class="grid grid-cols-1 gap-6 xl:grid-cols-3">
      <div class="min-w-0 space-y-6 xl:col-span-2">
        <UiCard :level="1" :title="heading" :icon="FileText">
          <div class="space-y-4">
            <div class="grid gap-4 sm:grid-cols-2">
              <UiInput
                v-model="title"
                label="Title"
                placeholder="e.g. Undertaking for Site Visit"
                :error="errors.title"
                required
              />
              <UiInput
                v-model="subtitle"
                label="Line under the title"
                placeholder="e.g. (On bidder's letterhead)"
                :error="errors.subtitle"
              />
              <UiSelect v-model="companyId" label="Use for" :options="companyOptions" />
            </div>
            <div class="space-y-1 rounded-lg bg-gray-50 p-3 text-sm dark:bg-gray-900">
              <label class="flex items-center gap-2">
                <UiCheckbox v-model="addressed" label="Print the To, block" />
                Print the "To," block (buyer organization and department address)
              </label>
              <label class="flex items-center gap-2">
                <UiCheckbox v-model="dateAtTop" label="Date at the top" />
                Print the date above the title
              </label>
              <label class="flex items-center gap-2">
                <UiCheckbox v-model="isActive" label="In use" />
                Offer this letter when making compliance PDFs
              </label>
            </div>
          </div>
        </UiCard>

        <UiCard title="Letter Text">
          <template #header>
            <UiButton size="xs" variant="secondary" @click="addBlock('para')">
              <Plus class="size-4" aria-hidden="true" /> Add Block
            </UiButton>
          </template>
          <div class="space-y-3">
            <div
              v-for="(b, i) in blocks"
              :key="b.key"
              class="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-900"
            >
              <div class="mb-2 flex flex-wrap items-center gap-2">
                <select
                  v-model="b.kind"
                  class="form-field h-9! w-48! py-0! text-sm!"
                  :aria-label="`Kind of block ${i + 1}`"
                >
                  <option v-for="k in kindOptions" :key="k.value" :value="k.value">
                    {{ k.label }}
                  </option>
                </select>
                <span class="text-xs text-gray-500">{{ hint(b.kind) }}</span>
                <div class="ml-auto flex gap-1.5">
                  <IconButton
                    :icon="ArrowUp"
                    :label="`Move block ${i + 1} up`"
                    :disabled="i === 0"
                    @click="move(i, -1)"
                  />
                  <IconButton
                    :icon="ArrowDown"
                    :label="`Move block ${i + 1} down`"
                    :disabled="i === blocks.length - 1"
                    @click="move(i, 1)"
                  />
                  <IconButton
                    :icon="Plus"
                    :label="`Add a block after block ${i + 1}`"
                    @click="addBlock('para', i)"
                  />
                  <IconButton
                    :icon="ACTION_ICONS.delete"
                    :label="`Remove block ${i + 1}`"
                    variant="danger"
                    @click="remove(i)"
                  />
                </div>
              </div>
              <textarea
                :ref="
                  (el) => (el ? boxes.set(b.key, el as HTMLTextAreaElement) : boxes.delete(b.key))
                "
                v-model="b.text"
                :rows="b.kind === 'heading' || b.kind === 'center' ? 1 : 4"
                :class="[
                  'form-field h-auto bg-white! dark:bg-gray-800!',
                  (b.kind === 'heading' || b.kind === 'center') && 'font-semibold',
                  b.kind === 'center' && 'text-center',
                ]"
                :aria-label="`Text of block ${i + 1}`"
                :placeholder="
                  b.kind === 'para'
                    ? 'e.g. We, {{company_name}}, hereby declare that…'
                    : b.kind === 'fields'
                      ? 'Tender Ref No.: {{tender_ref}}'
                      : ''
                "
                @focus="remember(b.key, $event)"
                @click="remember(b.key, $event)"
                @keyup="remember(b.key, $event)"
                @select="remember(b.key, $event)"
              />
            </div>
          </div>
          <ModalNote class="mt-4">
            The company letterhead goes at the top, and the signature block ("Thanking You",
            signature, name and designation) at the end, just like the built-in letters.
          </ModalNote>
        </UiCard>
      </div>

      <div class="min-w-0 space-y-6">
        <UiCard title="Fill-in Fields" class="xl:sticky xl:top-24">
          <p class="mb-3 text-sm text-gray-600 dark:text-gray-400">
            Click to insert at the cursor. Each is replaced with the real value when the PDF is
            made; an empty value prints a blank line to fill by hand.
          </p>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="f in LETTER_FIELDS"
              :key="f.key"
              type="button"
              class="rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-xs text-blue-700 hover:bg-blue-100 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300"
              :title="`Example: ${f.sample}`"
              @mousedown.prevent
              @click="insertField(f.key)"
            >
              {{ f.label }}
            </button>
          </div>
          <div class="mt-5 flex flex-col gap-2 border-t border-gray-200 pt-4 dark:border-gray-800">
            <UiButton variant="secondary" :loading="previewing" @click="preview">
              <Eye class="size-4" aria-hidden="true" /> Preview PDF
            </UiButton>
            <UiButton :loading="saving" @click="save">Save Letter</UiButton>
            <p class="text-xs text-gray-500 dark:text-gray-400">
              The preview uses
              {{
                companyId
                  ? companies.find((c) => c.id === companyId)?.name
                  : 'your first active company'
              }}'s letterhead and sample tender details.
            </p>
          </div>
        </UiCard>
      </div>
    </div>
  </div>
</template>
