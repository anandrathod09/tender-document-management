<script setup lang="ts">
import { ref, watch } from 'vue'
import type { StageSummary } from '@tdm/shared'
import type { WorkflowResetPart } from '@tdm/shared/workflow'
import ModalCallout from '@/components/ui/ModalCallout.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiModal from '@/components/ui/UiModal.vue'
import { api, errorMessage } from '@/services/api'

/** Puts chosen parts of the whole workflow back to how they were at the start. */
defineProps<{ open: boolean }>()
const emit = defineEmits<{
  close: []
  done: [stages: StageSummary[], parts: WorkflowResetPart[]]
}>()

const PARTS: { key: WorkflowResetPart; label: string; hint: string }[] = [
  { key: 'menus', label: 'Sidebar menus', hint: 'Which roles see each stage in their menu.' },
  { key: 'moves', label: 'Can move to', hint: 'The next steps agents and admins can choose.' },
  {
    key: 'look',
    label: 'Names and colours',
    hint: 'Renamed stages get their original names back.',
  },
  { key: 'order', label: 'Order', hint: 'Your own stages go after the last stage of their kind.' },
  {
    key: 'settings',
    label: 'Comment rules and hidden stages',
    hint: 'Comment settings go back to default; hidden default stages are shown again.',
  },
]

const chosen = ref<WorkflowResetPart[]>([])
const error = ref('')
const saving = ref(false)

watch(
  () => chosen.value.length,
  () => (error.value = ''),
)

async function reset() {
  error.value = ''
  saving.value = true
  try {
    const { data } = await api.post<StageSummary[]>('/workflow/stages/reset', {
      parts: chosen.value,
    })
    emit('done', data, [...chosen.value])
    chosen.value = []
  } catch (err) {
    error.value = errorMessage(err)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UiModal :open="open" title="Reset Workflow to Default" :busy="saving" @close="emit('close')">
    <div class="space-y-4">
      <UiAlert v-if="error">{{ error }}</UiAlert>
      <p class="text-sm text-gray-700 dark:text-gray-300">Choose what to put back:</p>
      <div class="space-y-2">
        <label
          v-for="p in PARTS"
          :key="p.key"
          class="flex cursor-pointer items-start gap-3 rounded-md border border-gray-200 px-3 py-2.5 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-white/5"
        >
          <input
            v-model="chosen"
            type="checkbox"
            :value="p.key"
            class="mt-0.5 size-4 shrink-0 accent-blue-500"
          />
          <span>
            <span class="block text-sm font-medium text-gray-800 dark:text-white/90">
              {{ p.label }}
            </span>
            <span class="block text-xs text-gray-500 dark:text-gray-400">{{ p.hint }}</span>
          </span>
        </label>
      </div>
      <ModalCallout tone="warning" lead="Note: ">
        Tenders stay where they are, and your own stages are kept. Only the settings you tick are
        changed.
      </ModalCallout>
    </div>
    <template #footer>
      <UiButton variant="secondary" :disabled="saving" @click="emit('close')">Cancel</UiButton>
      <UiButton variant="danger" :disabled="!chosen.length" :loading="saving" @click="reset">
        Reset Selected
      </UiButton>
    </template>
  </UiModal>
</template>
