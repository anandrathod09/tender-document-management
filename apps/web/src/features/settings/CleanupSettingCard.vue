<script setup lang="ts">
import { CalendarX } from 'lucide-vue-next'
import { computed, onMounted, ref } from 'vue'
import type { WorkspaceSettings } from '@tdm/shared'
import { DEFAULT_CLEANUP_DAYS, MAX_CLEANUP_DAYS } from '@tdm/shared/workflow'
import UiCard from '@/components/ui/UiCard.vue'
import { api, errorMessage } from '@/services/api'
import { useWorkflowStore } from '@/stores/workflow'

/**
 * "Delete unassigned New tenders N days after the deadline", or never.
 * Saved with the client's settings; the hourly deadline job reads it.
 */
const days = ref<number | null>(null)
// A number input: Vue hands back a number, or '' while empty.
const draft = ref<string | number>(String(DEFAULT_CLEANUP_DAYS))
const loaded = ref(false)
const saving = ref(false)
const error = ref('')
const notice = ref('')

onMounted(async () => {
  try {
    const { data } = await api.get<WorkspaceSettings>('/workspace/settings')
    days.value = data.cleanupDays
    if (data.cleanupDays !== null) draft.value = String(data.cleanupDays)
    loaded.value = true
  } catch (err) {
    error.value = errorMessage(err)
  }
})

async function save(value: number | null) {
  error.value = ''
  notice.value = ''
  saving.value = true
  try {
    const { data } = await api.patch<WorkspaceSettings>('/workspace/settings', {
      cleanupDays: value,
    })
    days.value = data.cleanupDays
    if (data.cleanupDays !== null) draft.value = String(data.cleanupDays)
    notice.value =
      data.cleanupDays === null
        ? `Turned off. Unassigned “${intake.value}” tenders stay until someone deletes them.`
        : `Saved. Unassigned “${intake.value}” tenders are deleted ${dayText(data.cleanupDays)} after the deadline.`
  } catch (err) {
    error.value = errorMessage(err)
  } finally {
    saving.value = false
  }
}

function toggle() {
  if (days.value === null) void save(parsed() ?? DEFAULT_CLEANUP_DAYS)
  else void save(null)
}

function parsed(): number | null {
  const n = Number(draft.value)
  return Number.isInteger(n) && n >= 1 && n <= MAX_CLEANUP_DAYS ? n : null
}

function saveDays() {
  if (days.value === null) return
  const n = parsed()
  if (n === null) {
    error.value = `Enter a whole number of days from 1 to ${MAX_CLEANUP_DAYS}.`
    draft.value = String(days.value)
    return
  }
  if (n !== days.value) void save(n)
}

const dayText = (n: number) => (n === 1 ? '1 day' : `${n} days`)

// The client's own name for the stage imported tenders arrive in ("New" by default).
const workflow = useWorkflowStore()
const intake = computed(
  () => workflow.stages.find((s) => s.systemRole === 'intake')?.label ?? 'New',
)
const subtitle = computed(
  () =>
    `Tenders still in “${intake.value}” with no agent assigned are deleted a few days after their deadline, so the list stays short. Watchlist tenders, assigned tenders and tenders in any later stage are never deleted.`,
)
</script>

<template>
  <UiCard :level="1" title="Automatic Cleanup" :subtitle="subtitle" :icon="CalendarX">
    <p v-if="error" class="mb-3 text-sm text-error-500" role="alert">{{ error }}</p>
    <p v-if="notice" class="mb-3 text-sm text-success-600 dark:text-success-500" role="status">
      {{ notice }}
    </p>

    <div v-if="loaded" class="flex flex-wrap items-center gap-x-6 gap-y-3">
      <label class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
        <button
          type="button"
          role="switch"
          :aria-checked="days !== null"
          :disabled="saving"
          :class="[
            'relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50',
            days !== null ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-700',
          ]"
          @click="toggle"
        >
          <span
            :class="[
              'absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow-theme-sm transition-transform',
              days !== null && 'translate-x-5',
            ]"
          />
        </button>
        Delete unassigned “{{ intake }}” tenders automatically
      </label>

      <label
        :class="[
          'flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300',
          days === null && 'opacity-50',
        ]"
      >
        Delete
        <input
          v-model="draft"
          type="number"
          inputmode="numeric"
          min="1"
          :max="MAX_CLEANUP_DAYS"
          aria-label="Days after the deadline"
          :disabled="days === null || saving"
          class="form-field h-9! w-20! py-0! text-sm!"
          @blur="saveDays"
          @keydown.enter.prevent="($event.target as HTMLInputElement).blur()"
        />
        days after the deadline
      </label>
    </div>
  </UiCard>
</template>
