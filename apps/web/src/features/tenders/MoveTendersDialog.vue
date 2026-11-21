<script setup lang="ts">
import { Bookmark, BookmarkX } from 'lucide-vue-next'
import { computed, ref, watch } from 'vue'
import type { BulkTenderResult, TenderSummary } from '@tdm/shared'
import ModalCallout from '@/components/ui/ModalCallout.vue'
import ModalNote from '@/components/ui/ModalNote.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiModal from '@/components/ui/UiModal.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import UiTextarea from '@/components/ui/UiTextarea.vue'
import { api, errorMessage, fieldErrors } from '@/services/api'
import { useWorkflowStore } from '@/stores/workflow'
import { stageDotClasses } from '@/utils/tenders'
import { useMoveRules } from './move-rules'
import TenderBatchList from './TenderBatchList.vue'
import TenderFacts from './TenderFacts.vue'

import type { MoveMode } from './move-mode'

/**
 * Moves one or more tenders, with the popups of the original TMS:
 * - watch: Add to Watchlist (bulk too)
 * - unwatch: Remove from Watchlist, back to the intake stage
 * - reject: Reject Tender, a reason of at least 10 characters
 * - move: any other stage, picked from a list
 * Stage names follow the client's own stages; the comment box follows the
 * target stage's comment setting (reject always asks for a reason).
 */
const props = defineProps<{
  open: boolean
  tenders: TenderSummary[]
  mode: MoveMode
  /** The target for watch, unwatch and reject. */
  stageId?: string
}>()
const emit = defineEmits<{ close: []; done: [message: string] }>()
const workflow = useWorkflowStore()
const rules = useMoveRules()

const REASON_MIN = 10

const chosen = ref('')
const comment = ref('')
const awardAmount = ref('')
const awardNumber = ref('')
const errors = ref<Record<string, string>>({})
const error = ref('')
const saving = ref(false)

watch(
  () => props.open,
  (open) => {
    if (!open) return
    chosen.value = props.mode === 'move' ? '' : (props.stageId ?? '')
    comment.value = ''
    awardAmount.value = ''
    awardNumber.value = ''
    errors.value = {}
    error.value = ''
  },
)

const many = computed(() => props.tenders.length > 1)
const one = computed(() => props.tenders[0])
const count = computed(() => props.tenders.length)
// Only stages the client's rules allow for every selected tender.
const options = computed(() =>
  rules
    .commonNext(props.tenders)
    // Won needs an award amount per tender, so it is one at a time.
    .filter((s) => !(many.value && s.type === 'won'))
    .map((s) => ({ value: s.id, label: s.label, dot: stageDotClasses[s.color] })),
)
const target = computed(() => (chosen.value ? workflow.byId.get(chosen.value) : undefined))
const watchLabel = computed(
  () =>
    workflow.stages.find((s) => s.key === 'watchlist')?.label ??
    (props.mode === 'watch' ? (target.value?.label ?? 'Watchlist') : 'Watchlist'),
)
const pastDeadline = computed(() => props.tenders.some((t) => t.deadline < today()))
function today() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const title = computed(() => {
  switch (props.mode) {
    case 'watch':
      return `Add to ${watchLabel.value}${many.value ? ' (Bulk)' : ''}`
    case 'unwatch':
      return `Remove from ${watchLabel.value}${many.value ? ' (Bulk)' : ''}`
    case 'reject':
      return many.value ? `Reject ${count.value} Tenders` : 'Reject Tender'
    default:
      return many.value ? `Move ${count.value} Tenders` : 'Move Tender'
  }
})
const button = computed(() => {
  switch (props.mode) {
    case 'watch':
      return many.value ? `Add ${count.value} to ${watchLabel.value}` : `Add to ${watchLabel.value}`
    case 'unwatch':
      return many.value ? 'Remove Selected' : `Remove from ${watchLabel.value}`
    case 'reject':
      return many.value ? `Reject ${count.value} Tenders` : 'Reject Tender'
    default:
      return target.value ? `Move to ${target.value.label}` : 'Move'
  }
})
const commentShown = computed(
  () => props.mode === 'reject' || (!!target.value && target.value.commentMode !== 'off'),
)
const commentRequired = computed(
  () => props.mode === 'reject' || target.value?.commentMode === 'required',
)
const commentLabel = computed(() => {
  if (props.mode === 'reject') return 'Reason for Rejection'
  if (props.mode === 'watch') return `${watchLabel.value} Notes`
  return 'Comment'
})

async function submit() {
  const stage = target.value
  errors.value = {}
  error.value = ''
  if (!stage) {
    errors.value.stage = 'Choose a stage'
    return
  }
  const text = comment.value.trim()
  if (props.mode === 'reject' && text.length < REASON_MIN) {
    errors.value.comment = `Please give a reason of at least ${REASON_MIN} characters`
    return
  }
  if (commentRequired.value && !text) {
    errors.value.comment = 'A comment is required for this stage'
    return
  }
  const amount = awardAmount.value.replace(/,/g, '')
  if (stage.type === 'won' && !(amount !== '' && Number(amount) >= 0)) {
    errors.value.awardAmount = 'Enter the award amount'
    return
  }
  const note = commentShown.value && text ? text : undefined
  saving.value = true
  try {
    let moved = 1
    if (many.value) {
      const { data } = await api.post<BulkTenderResult>('/tenders/bulk', {
        action: 'move',
        ids: props.tenders.map((t) => t.id),
        stageId: stage.id,
        comment: note,
      })
      moved = data.updated
    } else {
      await api.post(`/tenders/${one.value!.id}/move`, {
        stageId: stage.id,
        comment: note,
        ...(stage.type === 'won' && {
          awardAmount: Number(amount),
          awardNumber: awardNumber.value || undefined,
        }),
      })
    }
    const n = moved === 1 ? '1 tender' : `${moved} tenders`
    const message =
      props.mode === 'watch'
        ? `${n} added to ${watchLabel.value} successfully!`
        : props.mode === 'unwatch'
          ? `${n} removed from ${watchLabel.value}`
          : props.mode === 'reject'
            ? `${n} rejected successfully!`
            : `${n} moved to ${stage.label}`
    emit('done', message)
  } catch (err) {
    errors.value = fieldErrors(err)
    if (!Object.keys(errors.value).length) error.value = errorMessage(err)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UiModal :open="open" :title="title" :busy="saving" @close="emit('close')">
    <form id="move-tenders" class="space-y-4" novalidate @submit.prevent="submit">
      <UiAlert v-if="error">{{ error }}</UiAlert>

      <!-- Opening strip -->
      <ModalCallout
        v-if="mode === 'watch'"
        tone="info"
        :icon="Bookmark"
        :lead="many ? `${watchLabel} Action: ` : 'Info: '"
      >
        <template v-if="many"
          >You are adding {{ count }} tenders to your {{ watchLabel }}.</template
        >
        <template v-else
          >This tender will be added to your {{ watchLabel }} for future reference.</template
        >
      </ModalCallout>
      <ModalCallout
        v-else-if="mode === 'unwatch'"
        :tone="pastDeadline ? 'danger' : 'warning'"
        :icon="BookmarkX"
        :lead="pastDeadline ? 'Remove Expired Tender: ' : `Remove from ${watchLabel}: `"
      >
        <template v-if="many">
          Are you sure you want to remove <strong>{{ count }}</strong> tenders from your
          {{ watchLabel }}?
        </template>
        <template v-else-if="pastDeadline">
          This tender has expired and will be removed from your {{ watchLabel }}.
        </template>
        <template v-else>
          Are you sure you want to remove this tender from your {{ watchLabel }}?
        </template>
      </ModalCallout>
      <ModalCallout v-else-if="mode === 'reject'" tone="warning" lead="Warning: ">
        {{ many ? 'The selected tenders will' : 'This tender will' }} be marked as rejected and
        moved to {{ target?.label ?? 'Rejected' }}.
      </ModalCallout>

      <!-- The tender(s) -->
      <template v-if="many">
        <TenderBatchList
          :tenders="tenders"
          :tone="mode === 'reject' ? 'red' : 'gray'"
          :heading="
            mode === 'watch'
              ? `Adding ${count} Tenders to ${watchLabel}:`
              : mode === 'unwatch'
                ? `Removing ${count} Tenders from ${watchLabel}:`
                : mode === 'reject'
                  ? `Rejecting ${count} Tenders:`
                  : `Moving ${count} Tenders:`
          "
        />
      </template>
      <TenderFacts
        v-else-if="one"
        :tender="one"
        :layout="mode === 'unwatch' ? 'full' : mode === 'move' ? 'grid' : 'rows'"
      >
        <template #action>
          <div class="flex items-center gap-2">
            <span class="text-gray-600 dark:text-gray-400">Action:</span>
            <span
              class="rounded border border-purple-200 bg-purple-100 px-2 py-0.5 text-xs text-purple-800 dark:border-purple-500/30 dark:bg-purple-500/15 dark:text-purple-300"
            >
              Will be removed from {{ watchLabel }} and go back to {{ target?.label }}
            </span>
          </div>
        </template>
      </TenderFacts>

      <!-- Where to (generic move) -->
      <template v-if="mode === 'move'">
        <UiSelect
          v-model="chosen"
          label="Move to"
          :options="options"
          placeholder="-- Choose a stage --"
          :error="errors.stage"
          required
        />
        <p v-if="many" class="text-xs text-gray-500 dark:text-gray-400">
          Won is not offered for several tenders at once, because each needs its award amount.
        </p>
      </template>

      <template v-if="target?.type === 'won'">
        <UiInput
          v-model="awardAmount"
          label="Award amount (₹)"
          :error="errors.awardAmount"
          required
        />
        <UiInput v-model="awardNumber" label="Award / PO number" :error="errors.awardNumber" />
      </template>

      <UiTextarea
        v-if="commentShown"
        v-model="comment"
        :label="commentLabel"
        :required="commentRequired"
        :optional="!commentRequired"
        :error="errors.comment"
        :maxlength="2000"
        :placeholder="
          mode === 'reject'
            ? 'Please provide the reason for rejecting this tender...'
            : mode === 'watch'
              ? 'Why are you watching this tender? (optional)'
              : 'Add a comment for the tender history...'
        "
        :hint="
          mode === 'reject'
            ? `Minimum ${REASON_MIN} characters. This reason is stored with the tender's history for future reference.`
            : many
              ? 'The same comment is saved on each tender.'
              : 'Saved in the tender history.'
        "
      />

      <!-- Closing note -->
      <ModalNote v-if="mode === 'watch'">
        Tenders in your {{ watchLabel }} are kept for later. You can see them all in the
        {{ watchLabel }} section.
      </ModalNote>
      <ModalNote v-else-if="mode === 'unwatch'" :tone="many ? 'warning' : 'info'">
        The {{ many ? 'tenders go' : 'tender goes' }} back to {{ target?.label ?? 'New' }}; you can
        add {{ many ? 'them' : 'it' }} to the {{ watchLabel }} again at any time.
      </ModalNote>
      <ModalNote v-else-if="mode === 'reject'">
        Rejected tenders are listed under {{ target?.label ?? 'Rejected' }}, where they can still be
        opened or moved back.
      </ModalNote>
    </form>
    <template #footer>
      <UiButton variant="secondary" :disabled="saving" @click="emit('close')">Cancel</UiButton>
      <UiButton
        type="submit"
        form="move-tenders"
        :variant="mode === 'reject' || target?.type === 'dropped' ? 'danger' : 'primary'"
        :loading="saving"
      >
        <BookmarkX v-if="mode === 'unwatch' && !saving" class="size-4" aria-hidden="true" />
        <Bookmark v-else-if="mode === 'watch' && !saving" class="size-4" aria-hidden="true" />
        {{ button }}
      </UiButton>
    </template>
  </UiModal>
</template>
