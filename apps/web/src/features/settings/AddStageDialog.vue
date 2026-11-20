<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { CommentMode, StageSummary } from '@tdm/shared'
import {
  STAGE_COLORS,
  STAGE_TYPE_LABELS,
  STAGE_TYPES,
  type StageColor,
  type StageType,
} from '@tdm/shared/workflow'
import ModalNote from '@/components/ui/ModalNote.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiModal from '@/components/ui/UiModal.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import { api, errorMessage, fieldErrors } from '@/services/api'
import { stageDotClasses } from '@/utils/tenders'
import { COLOR_LABELS, TYPE_HINTS } from './stage-ui'

/** Adds a stage of the client's own, placed after a chosen stage. */
const props = defineProps<{ open: boolean; stages: StageSummary[] }>()
const emit = defineEmits<{ close: []; added: [stage: StageSummary] }>()

const label = ref('')
const type = ref<StageType>('review')
const color = ref<StageColor>('purple')
const commentMode = ref<CommentMode>('optional')
const afterStageId = ref('')
const errors = ref<Record<string, string>>({})
const error = ref('')
const saving = ref(false)

watch(
  () => props.open,
  (open) => {
    if (!open) return
    label.value = ''
    type.value = 'review'
    color.value = 'purple'
    commentMode.value = 'optional'
    suggestPlace(type.value)
    errors.value = {}
    error.value = ''
  },
)

/** Suggests a place: after the last stage of the chosen kind, else at the end. */
function suggestPlace(t: StageType) {
  const last = [...props.stages].reverse().find((s) => s.type === t)
  afterStageId.value = last?.id ?? props.stages.at(-1)?.id ?? ''
}
watch(type, suggestPlace)

const typeOptions = STAGE_TYPES.map((t) => ({ value: t, label: STAGE_TYPE_LABELS[t] }))
const afterOptions = computed(() => props.stages.map((s) => ({ value: s.id, label: s.label })))

async function submit() {
  errors.value = {}
  error.value = ''
  if (!label.value.trim()) {
    errors.value.label = 'Name is required'
    return
  }
  saving.value = true
  try {
    const { data } = await api.post<StageSummary>('/workflow/stages', {
      label: label.value,
      type: type.value,
      color: color.value,
      commentMode: commentMode.value,
      afterStageId: afterStageId.value || undefined,
    })
    emit('added', data)
  } catch (err) {
    errors.value = fieldErrors(err)
    if (!Object.keys(errors.value).length) error.value = errorMessage(err)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UiModal :open="open" title="Add Stage" :busy="saving" @close="emit('close')">
    <form id="add-stage" class="space-y-4" novalidate @submit.prevent="submit">
      <UiAlert v-if="error">{{ error }}</UiAlert>
      <UiInput
        v-model="label"
        label="Stage name"
        placeholder="e.g. Technical review"
        :error="errors.label"
        required
      />
      <div>
        <UiSelect v-model="type" label="Kind" :options="typeOptions" required />
        <p class="mt-1.5 text-xs text-gray-500 dark:text-gray-400">{{ TYPE_HINTS[type] }}</p>
      </div>

      <fieldset>
        <legend class="mb-1.5 text-sm font-medium text-gray-700 dark:text-gray-400">Colour</legend>
        <div class="flex flex-wrap gap-2">
          <label
            v-for="c in STAGE_COLORS"
            :key="c"
            :class="[
              'flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm',
              color === c
                ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300'
                : 'border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5',
            ]"
          >
            <input v-model="color" type="radio" name="stage-color" :value="c" class="sr-only" />
            <span :class="['size-3 rounded-full', stageDotClasses[c]]" aria-hidden="true" />
            {{ COLOR_LABELS[c] }}
          </label>
        </div>
      </fieldset>

      <UiSelect
        v-model="commentMode"
        label="Comment when moving here"
        :options="[
          { value: 'off', label: 'Off' },
          { value: 'optional', label: 'Optional' },
          { value: 'required', label: 'Required' },
        ]"
      />
      <UiSelect v-model="afterStageId" label="Place after" :options="afterOptions" />

      <ModalNote>
        Reports, the dashboard and the deadline rules treat the stage by its kind, so choose the
        kind that matches what the stage means.
      </ModalNote>
    </form>
    <template #footer>
      <UiButton variant="secondary" :disabled="saving" @click="emit('close')">Cancel</UiButton>
      <UiButton type="submit" form="add-stage" :loading="saving">Add Stage</UiButton>
    </template>
  </UiModal>
</template>
