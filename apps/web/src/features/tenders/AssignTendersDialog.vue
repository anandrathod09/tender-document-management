<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { BulkTenderResult, TenderSummary } from '@tdm/shared'
import UiButton from '@/components/ui/UiButton.vue'
import UiModal from '@/components/ui/UiModal.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import UiTextarea from '@/components/ui/UiTextarea.vue'
import { api, errorMessage } from '@/services/api'
import { useWorkflowStore } from '@/stores/workflow'
import { formatDate } from '@/utils/format'
import TenderBatchList from './TenderBatchList.vue'
import TenderFacts from './TenderFacts.vue'
import { useAssignees } from './useAssignees'

/**
 * "Assign Tender" / "Bulk Assign Tenders", as in the original TMS: the tender,
 * how many people are available, who has it now, the chosen person's contact
 * details, optional notes for them, and (in bulk) the list of selected tenders.
 */
const props = defineProps<{ open: boolean; tenders: TenderSummary[] }>()
const emit = defineEmits<{ close: []; done: [message: string] }>()
const { people, loaded, load } = useAssignees()
const workflow = useWorkflowStore()
const preparing = computed(() => workflow.stages.find((s) => s.type === 'preparing')?.label)

const NOBODY = '__nobody__'
const agentId = ref('')
const notes = ref('')
const loadError = ref('')
const error = ref('')
const selectError = ref('')
const saving = ref(false)
const loadingPeople = ref(false)

async function fetchPeople(force = false) {
  loadError.value = ''
  loadingPeople.value = true
  try {
    await load(force)
  } catch (err) {
    loadError.value = errorMessage(err)
  } finally {
    loadingPeople.value = false
  }
}

watch(
  () => props.open,
  (open) => {
    if (!open) return
    agentId.value = ''
    notes.value = ''
    error.value = ''
    selectError.value = ''
    void fetchPeople()
  },
)

const many = computed(() => props.tenders.length > 1)
const one = computed(() => (many.value ? undefined : props.tenders[0]))
/** The person every selected tender is assigned to, if they share one. */
const current = computed(() => {
  const ids = new Set(props.tenders.map((t) => t.assignedAgent?.id ?? ''))
  return ids.size === 1 && !ids.has('') ? props.tenders[0]!.assignedAgent : null
})
const available = computed(() => people.value.filter((p) => p.id !== current.value?.id))
const options = computed(() => [
  ...available.value.map((p) => ({ value: p.id, label: `${p.name} (${p.email}) - ${p.role}` })),
  ...(props.tenders.some((t) => t.assignedAgent)
    ? [{ value: NOBODY, label: 'Nobody (remove the assignment)' }]
    : []),
])
const chosen = computed(() => people.value.find((p) => p.id === agentId.value))
const willMove = computed(
  () => !!chosen.value && props.tenders.some((t) => t.stage.type === 'open'),
)
const title = computed(() => (many.value ? 'Bulk Assign Tenders' : 'Assign Tender'))

async function submit() {
  error.value = ''
  selectError.value = ''
  if (!agentId.value) {
    selectError.value = 'Please select a person'
    return
  }
  const target = agentId.value === NOBODY ? null : agentId.value
  const note = target && notes.value.trim() ? notes.value.trim() : undefined
  saving.value = true
  try {
    let changed = 1
    if (many.value) {
      const { data } = await api.post<BulkTenderResult>('/tenders/bulk', {
        action: 'assign',
        ids: props.tenders.map((t) => t.id),
        agentId: target,
        note,
      })
      changed = data.updated
    } else {
      await api.post(`/tenders/${props.tenders[0]!.id}/assign`, { agentId: target, note })
    }
    const name = chosen.value?.name
    emit(
      'done',
      !target
        ? `Assignment removed from ${changed === 1 ? '1 tender' : `${changed} tenders`}`
        : many.value
          ? `All ${changed} tenders assigned to ${name}!`
          : `"${name}" assigned successfully!`,
    )
  } catch (err) {
    error.value = errorMessage(err)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UiModal :open="open" :title="title" :busy="saving" @close="emit('close')">
    <form id="assign-tenders" class="flex flex-col gap-6" novalidate @submit.prevent="submit">
      <TenderFacts v-if="one" :tender="one" layout="grid" />

      <!-- Loading, failed or empty -->
      <div
        v-if="loadingPeople && !loaded"
        class="flex items-center justify-center gap-2 py-6 text-sm text-gray-700 dark:text-gray-300"
        role="status"
      >
        <span
          class="size-6 animate-spin rounded-full border-2 border-blue-600 border-t-transparent"
          aria-hidden="true"
        />
        Loading team members…
      </div>
      <div
        v-else-if="loadError"
        class="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-500/30 dark:bg-red-500/10"
      >
        <p class="mb-2 text-sm font-medium text-red-800 dark:text-red-300">
          Failed to load team members
        </p>
        <p class="mb-3 text-sm text-red-700 dark:text-red-300">{{ loadError }}</p>
        <UiButton size="xs" variant="secondary" @click="fetchPeople(true)">Retry</UiButton>
      </div>
      <div
        v-else-if="options.length === 0"
        class="rounded-lg border border-yellow-200 bg-yellow-50 p-4 dark:border-yellow-500/30 dark:bg-yellow-500/10"
      >
        <p class="mb-1 text-sm font-medium text-yellow-700 dark:text-yellow-300">
          {{ current ? 'Only the current person is available' : 'No team members available' }}
        </p>
        <p class="text-sm text-yellow-600 dark:text-yellow-300/80">
          {{
            current
              ? 'The only active team member already has this tender. Invite more people under Users to reassign it.'
              : 'There are no active team members yet. Invite people under Users before assigning tenders.'
          }}
        </p>
        <UiButton size="xs" variant="secondary" class="mt-2" @click="fetchPeople(true)">
          Refresh
        </UiButton>
      </div>

      <!-- Choosing the person -->
      <div v-else class="space-y-3">
        <div class="flex items-center justify-between gap-3">
          <span class="text-sm font-medium text-gray-700 dark:text-gray-300">
            Select Person <span class="text-red-500">*</span>
          </span>
          <span
            class="rounded bg-blue-100 px-2 py-1 text-xs text-blue-800 dark:bg-blue-500/20 dark:text-blue-300"
          >
            {{ available.length }} {{ available.length === 1 ? 'Person' : 'People' }} Available
          </span>
        </div>

        <div
          v-if="current"
          class="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-500/30 dark:bg-amber-500/10"
        >
          <p class="mb-1 text-sm font-medium text-amber-800 dark:text-amber-300">
            Currently Assigned:
          </p>
          <p class="text-sm text-amber-700 dark:text-amber-300">
            {{ current.name }} ({{ current.email }})
          </p>
          <p v-if="current.phone" class="text-xs text-amber-600 dark:text-amber-300/80">
            Phone: {{ current.phone }}
          </p>
          <p class="mt-1 text-xs text-amber-600 dark:text-amber-300/80">
            {{ many ? 'These tenders are' : 'This tender is' }} already assigned to this person.
            Choose someone else to reassign {{ many ? 'them' : 'it' }}.
          </p>
        </div>

        <UiSelect
          v-model="agentId"
          label="Person"
          class="[&>label]:sr-only"
          :options="options"
          placeholder="-- Select a person --"
          :error="selectError"
          required
        />

        <div
          v-if="chosen"
          class="rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-500/30 dark:bg-blue-500/10"
        >
          <p class="mb-1 text-sm font-medium text-blue-800 dark:text-blue-300">
            New Person to Assign:
          </p>
          <p class="text-sm text-blue-700 dark:text-blue-300">
            {{ chosen.name }} ({{ chosen.email }})
          </p>
          <p class="text-xs text-blue-600 dark:text-blue-300/80">Role: {{ chosen.role }}</p>
          <p class="text-xs text-blue-600 dark:text-blue-300/80">
            Phone: {{ chosen.phone ?? 'N/A' }}
          </p>
          <p class="text-xs text-blue-600 dark:text-blue-300/80">
            Member since: {{ formatDate(chosen.memberSince) }}
          </p>
        </div>
        <p v-if="willMove" class="text-xs text-gray-500 dark:text-gray-400">
          {{ many ? 'Selected tenders that are still new' : 'This tender' }} will move to
          {{ preparing ?? 'the first preparing stage' }}.
        </p>
      </div>

      <UiTextarea
        v-if="!loadError && options.length && agentId !== NOBODY"
        v-model="notes"
        label="Assignment Notes"
        optional
        :maxlength="1000"
        placeholder="Enter any notes about this assignment (optional)..."
        hint="These notes are sent to the assigned person with the notification."
      />

      <TenderBatchList
        v-if="many"
        :tenders="tenders"
        tone="blue"
        :heading="`Selected Tenders: ${tenders.length}`"
      />

      <div
        v-if="selectError || error"
        class="rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-900/20"
        role="alert"
      >
        <p class="mb-1 text-sm font-medium text-red-700 dark:text-red-300">
          {{ error ? 'Could not assign' : 'Please fix the following errors:' }}
        </p>
        <p class="text-xs text-red-600 dark:text-red-400">• {{ error || selectError }}</p>
      </div>
    </form>
    <template #footer>
      <UiButton variant="secondary" :disabled="saving" @click="emit('close')">Cancel</UiButton>
      <UiButton
        type="submit"
        form="assign-tenders"
        :disabled="!!loadError || options.length === 0"
        :loading="saving"
      >
        {{
          saving
            ? 'Assigning…'
            : agentId === NOBODY
              ? 'Remove Assignment'
              : many
                ? 'Assign to All Selected'
                : 'Assign Tender'
        }}
      </UiButton>
    </template>
  </UiModal>
</template>
