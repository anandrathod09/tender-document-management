<script setup lang="ts">
import { Mail, Phone } from 'lucide-vue-next'
import { computed, ref } from 'vue'
import type { TenderDetail } from '@tdm/shared'
import { agentLocked } from '@tdm/shared'
import { ACTION_ICONS } from '@/components/ui/actions'
import IconButton from '@/components/ui/IconButton.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiCard from '@/components/ui/UiCard.vue'
import { api, errorMessage } from '@/services/api'
import { formatDateTime } from '@/utils/format'
import { useWorkflowStore } from '@/stores/workflow'
import AssignTendersDialog from './AssignTendersDialog.vue'

/**
 * "Assignment" card of the original TMS tender page: who has the tender, how
 * to reach them, and a button that opens the same Assign popup as the list.
 */
const props = defineProps<{ tender: TenderDetail; canAssign: boolean }>()
const emit = defineEmits<{ assigned: [tender: TenderDetail] }>()

// Results (Won, Lost, Not fit…) keep the agent who handled the bid.
const workflow = useWorkflowStore()
const locked = computed(() =>
  agentLocked({ ...props.tender.stage, key: workflow.byId.get(props.tender.stage.id)?.key }),
)
const open = ref(false)
const notice = ref('')
const error = ref('')

async function done(message: string) {
  open.value = false
  notice.value = message
  try {
    emit('assigned', (await api.get<TenderDetail>(`/tenders/${props.tender.id}`)).data)
  } catch (err) {
    error.value = errorMessage(err)
  }
}
</script>

<template>
  <UiCard title="Assignment">
    <div class="flex flex-col gap-4">
      <UiAlert v-if="error">{{ error }}</UiAlert>
      <UiAlert v-if="notice" variant="success">{{ notice }}</UiAlert>
      <div class="flex items-end gap-2">
        <div class="flex-1">
          <label
            for="assigned-person"
            class="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400"
          >
            Assigned Agent
          </label>
          <input
            id="assigned-person"
            :value="tender.assignedAgent?.name ?? 'Not Assigned'"
            class="form-field"
            disabled
          />
        </div>
        <IconButton
          v-if="canAssign && !locked"
          class="mb-1.5"
          :icon="tender.assignedAgent ? ACTION_ICONS.edit : ACTION_ICONS.assign"
          :label="tender.assignedAgent ? 'Change Assignee' : 'Assign'"
          @click="open = true"
        />
      </div>
      <p v-if="canAssign && locked" class="-mt-2 text-xs text-gray-500 dark:text-gray-400">
        Locked in {{ tender.stage.label }}: the agent who handled the bid stays on the tender.
      </p>

      <div
        v-if="tender.assignedAgent"
        class="space-y-2 rounded-md border border-blue-200 bg-blue-50 p-4 text-sm dark:border-blue-800 dark:bg-blue-900/10"
      >
        <p class="flex items-center gap-2">
          <Mail class="size-4 shrink-0 text-gray-500" aria-hidden="true" />
          <a
            :href="`mailto:${tender.assignedAgent.email}`"
            class="truncate text-blue-600 hover:text-blue-800 hover:underline dark:text-blue-400"
          >
            {{ tender.assignedAgent.email }}
          </a>
        </p>
        <p class="flex items-center gap-2">
          <Phone class="size-4 shrink-0 text-gray-500" aria-hidden="true" />
          <a
            v-if="tender.assignedAgent.phone"
            :href="`tel:${tender.assignedAgent.phone}`"
            class="text-green-600 hover:text-green-800 hover:underline"
          >
            {{ tender.assignedAgent.phone }}
          </a>
          <span v-else class="text-gray-600 dark:text-gray-400">Not available</span>
        </p>
        <p
          v-if="tender.assignedAt"
          class="border-t border-blue-200 pt-2 text-gray-500 dark:border-blue-800 dark:text-gray-400"
        >
          <span class="font-medium">Assigned on:</span> {{ formatDateTime(tender.assignedAt) }}
        </p>
      </div>
    </div>

    <AssignTendersDialog :open="open" :tenders="[tender]" @close="open = false" @done="done" />
  </UiCard>
</template>
