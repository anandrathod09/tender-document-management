<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { CompanySummary, TenderDetail } from '@tdm/shared'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiCard from '@/components/ui/UiCard.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import { api, errorMessage } from '@/services/api'

const props = defineProps<{ tender: TenderDetail; companies: CompanySummary[]; canEdit: boolean }>()
const emit = defineEmits<{ changed: [tender: TenderDetail] }>()

const selected = ref(props.tender.biddingCompany?.id ?? '')
const error = ref('')
const saving = ref(false)

watch(
  () => props.tender.biddingCompany?.id,
  (id) => (selected.value = id ?? ''),
)

const options = computed(() => [
  { value: '', label: 'Not chosen yet' },
  ...props.companies
    .filter((c) => c.isActive || c.id === props.tender.biddingCompany?.id)
    .map((c) => ({ value: c.id, label: c.name })),
])

watch(selected, async (id) => {
  if (id === (props.tender.biddingCompany?.id ?? '')) return
  error.value = ''
  saving.value = true
  try {
    emit(
      'changed',
      (
        await api.patch<TenderDetail>(`/tenders/${props.tender.id}`, {
          biddingCompanyId: id || null,
        })
      ).data,
    )
  } catch (err) {
    error.value = errorMessage(err)
    selected.value = props.tender.biddingCompany?.id ?? ''
  } finally {
    saving.value = false
  }
})
</script>

<template>
  <UiCard title="Bidding Company">
    <UiAlert v-if="error" class="mb-3">{{ error }}</UiAlert>
    <UiSelect
      v-if="canEdit"
      v-model="selected"
      label="Bid under"
      :options="options"
      :disabled="saving"
    />
    <p v-else class="text-theme-sm text-gray-700 dark:text-gray-300">
      {{ tender.biddingCompany?.name ?? 'Not chosen yet' }}
    </p>
    <p
      v-if="canEdit && !companies.length"
      class="mt-2 text-theme-xs text-gray-500 dark:text-gray-400"
    >
      No companies yet. An admin can add them under Manage → Bidding companies.
    </p>
  </UiCard>
</template>
