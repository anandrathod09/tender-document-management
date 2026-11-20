<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { TenderDetail } from '@tdm/shared'
import StageBadge from '@/components/StageBadge.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiCard from '@/components/ui/UiCard.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import UiTextarea from '@/components/ui/UiTextarea.vue'
import { api, errorMessage, fieldErrors } from '@/services/api'
import { useWorkflowStore } from '@/stores/workflow'

const props = defineProps<{ tender: TenderDetail }>()
const emit = defineEmits<{ moved: [tender: TenderDetail] }>()
const workflow = useWorkflowStore()

const stageId = ref('')
const comment = ref('')
const awardAmount = ref('')
const awardNumber = ref('')
const errors = ref<Record<string, string>>({})
const error = ref('')
const saving = ref(false)

const options = computed(() =>
  workflow.visibleStages
    .filter((s) => s.id !== props.tender.stage.id)
    .map((s) => ({ value: s.id, label: s.label })),
)
const target = computed(() => (stageId.value ? workflow.byId.get(stageId.value) : undefined))

watch(
  () => props.tender.stage.id,
  () => {
    stageId.value = ''
    comment.value = ''
    awardAmount.value = ''
    awardNumber.value = ''
  },
)

async function submit() {
  if (!target.value) return
  errors.value = {}
  error.value = ''
  if (target.value.commentMode === 'required' && !comment.value.trim()) {
    errors.value.comment = 'A comment is required for this stage'
    return
  }
  const amount = awardAmount.value.replace(/,/g, '')
  if (target.value.type === 'won' && !(Number(amount) >= 0 && amount !== '')) {
    errors.value.awardAmount = 'Enter the award amount'
    return
  }
  saving.value = true
  try {
    const { data } = await api.post<TenderDetail>(`/tenders/${props.tender.id}/move`, {
      stageId: stageId.value,
      ...(target.value.commentMode !== 'off' && comment.value.trim() && { comment: comment.value }),
      ...(target.value.type === 'won' && {
        awardAmount: Number(amount),
        awardNumber: awardNumber.value || undefined,
      }),
    })
    emit('moved', data)
  } catch (err) {
    errors.value = fieldErrors(err)
    if (!Object.keys(errors.value).length) error.value = errorMessage(err)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UiCard title="Tender Status">
    <form class="space-y-4" novalidate @submit.prevent="submit">
      <UiAlert v-if="error">{{ error }}</UiAlert>
      <div class="flex items-center justify-between gap-3">
        <span class="text-sm font-medium text-gray-700 dark:text-gray-300">Workflow Status</span>
        <StageBadge :label="tender.stage.label" :color="tender.stage.color" />
      </div>

      <UiSelect
        v-model="stageId"
        label="Update Workflow Status"
        :options="options"
        placeholder="Select Workflow Status"
      />

      <template v-if="target?.type === 'won'">
        <UiInput
          v-model="awardAmount"
          label="Award amount (₹)"
          :error="errors.awardAmount"
          required
        />
        <UiInput v-model="awardNumber" label="Award / PO number" :error="errors.awardNumber" />
      </template>

      <div
        v-if="target && target.commentMode !== 'off'"
        class="border-t border-gray-200 pt-3 dark:border-gray-800"
      >
        <UiTextarea
          v-model="comment"
          :label="`${target.label} Notes`"
          :required="target.commentMode === 'required'"
          :optional="target.commentMode !== 'required'"
          :rows="3"
          :maxlength="2000"
          :error="errors.comment"
          :placeholder="`Enter notes for ${target.label}...${target.commentMode === 'required' ? ' (Required)' : ''}`"
          :hint="
            target.commentMode === 'required'
              ? `Required when changing to ${target.label}.`
              : 'Saved in the audit trail.'
          "
        />
      </div>

      <UiButton type="submit" :disabled="!stageId" :loading="saving" block>
        {{ target ? `Update to ${target.label}` : 'Update Status' }}
      </UiButton>
    </form>
  </UiCard>
</template>
