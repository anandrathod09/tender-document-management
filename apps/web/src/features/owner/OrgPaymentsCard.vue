<script setup lang="ts">
import { Plus, Receipt } from 'lucide-vue-next'
import { computed, onMounted, ref, watch } from 'vue'
import type { BillingCycle, OrganizationDetail, PaymentSummary, PlanDetail } from '@tdm/shared'
import { ACTION_ICONS } from '@/components/ui/actions'
import DataTable from '@/components/ui/DataTable.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import IconButton from '@/components/ui/IconButton.vue'
import ModalNote from '@/components/ui/ModalNote.vue'
import type { TableColumn } from '@/components/ui/table'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiBadge from '@/components/ui/UiBadge.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiCard from '@/components/ui/UiCard.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiModal from '@/components/ui/UiModal.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import UiTextarea from '@/components/ui/UiTextarea.vue'
import { api, errorMessage, fieldErrors } from '@/services/api'
import { downloadFromApi } from '@/services/files'
import { formatDate } from '@/utils/format'

/** A client's payments in the owner panel, and recording a bank transfer or cheque. */
const props = defineProps<{ org: OrganizationDetail; plans: PlanDetail[] }>()
const emit = defineEmits<{ changed: [] }>()

const list = ref<PaymentSummary[]>([])
const loading = ref(true)
const error = ref('')
const notice = ref('')

async function load() {
  try {
    list.value = (
      await api.get<PaymentSummary[]>(`/owner/organizations/${props.org.id}/payments`)
    ).data
  } catch (err) {
    error.value = errorMessage(err)
  } finally {
    loading.value = false
  }
}
onMounted(load)

// Recording a payment
const open = ref(false)
const form = ref({
  planId: '',
  cycle: 'yearly' as BillingCycle,
  total: '',
  reference: '',
  notes: '',
})
const errors = ref<Record<string, string>>({})
const formError = ref('')
const saving = ref(false)

function start() {
  form.value = {
    planId: props.org.plan.id,
    cycle: props.org.billingCycle ?? 'yearly',
    total: '',
    reference: '',
    notes: '',
  }
  errors.value = {}
  formError.value = ''
  open.value = true
}

const chosenPlan = computed(() => props.plans.find((p) => p.id === form.value.planId))
const listPrice = computed(() =>
  form.value.cycle === 'yearly'
    ? chosenPlan.value?.priceYearlyInr
    : chosenPlan.value?.priceMonthlyInr,
)
watch(
  () => form.value.planId,
  () => (errors.value = {}),
)

async function save() {
  errors.value = {}
  formError.value = ''
  saving.value = true
  try {
    const total = form.value.total.replace(/,/g, '').trim()
    const { data } = await api.post<PaymentSummary>(
      `/owner/organizations/${props.org.id}/payments`,
      {
        planId: form.value.planId,
        cycle: form.value.cycle,
        ...(total && { totalAmount: Number(total) }),
        reference: form.value.reference,
        notes: form.value.notes,
      },
    )
    open.value = false
    notice.value = `Payment recorded. Invoice ${data.invoiceNumber}; paid until ${formatDate(data.periodEnd)}.`
    await load()
    emit('changed')
  } catch (err) {
    errors.value = fieldErrors(err)
    if (!Object.keys(errors.value).length) formError.value = errorMessage(err)
  } finally {
    saving.value = false
  }
}

async function invoice(p: PaymentSummary) {
  error.value = ''
  try {
    await downloadFromApi(
      `/owner/organizations/${props.org.id}/payments/${p.id}/invoice.pdf`,
      undefined,
      'Invoice.pdf',
    )
  } catch (err) {
    error.value = errorMessage(err)
  }
}

const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`
const columns: TableColumn[] = [
  { key: 'paidAt', label: 'Date' },
  { key: 'invoiceNumber', label: 'Invoice No' },
  { key: 'plan', label: 'Plan' },
  { key: 'period', label: 'Period' },
  { key: 'totalAmount', label: 'Amount' },
  { key: 'method', label: 'Paid By' },
]
</script>

<template>
  <UiCard title="Billing & Payments" :icon="Receipt">
    <template #header>
      <UiButton size="xs" @click="start">
        <Plus class="size-4" aria-hidden="true" /> Record Payment
      </UiButton>
    </template>
    <UiAlert v-if="error" class="mb-3">{{ error }}</UiAlert>
    <UiAlert v-if="notice" variant="success" class="mb-3">{{ notice }}</UiAlert>
    <p class="mb-3 text-sm text-gray-600 dark:text-gray-400">
      <template v-if="org.paidUntil">
        Paid until <strong>{{ formatDate(org.paidUntil) }}</strong>
        <template v-if="org.billingCycle"> · billed {{ org.billingCycle }}</template>
      </template>
      <template v-else-if="org.trialEndsAt"
        >No payments yet · trial ends {{ formatDate(org.trialEndsAt) }}</template
      >
      <template v-else>No payments yet</template>
    </p>
    <DataTable :columns="columns" :rows="list" :loading="loading">
      <template #cell-paidAt="{ row }">
        <span class="text-xs whitespace-nowrap">{{ formatDate(row.paidAt ?? row.createdAt) }}</span>
      </template>
      <template #cell-invoiceNumber="{ row }">
        <span class="text-xs whitespace-nowrap">{{ row.invoiceNumber ?? '—' }}</span>
      </template>
      <template #cell-plan="{ row }">
        <span class="text-xs">{{ row.plan.name }} · {{ row.cycle }}</span>
      </template>
      <template #cell-period="{ row }">
        <span class="text-xs whitespace-nowrap">
          {{ formatDate(row.periodStart) }} – {{ formatDate(row.periodEnd) }}
        </span>
      </template>
      <template #cell-totalAmount="{ row }">
        <span class="font-medium whitespace-nowrap">{{ inr(row.totalAmount) }}</span>
      </template>
      <template #cell-method="{ row }">
        <UiBadge :color="row.method === 'razorpay' ? 'info' : 'gray'">
          {{ row.method === 'razorpay' ? 'Online' : 'Manual' }}
        </UiBadge>
        <p v-if="row.reference" class="mt-1 text-xs text-gray-500">{{ row.reference }}</p>
      </template>
      <template #actions="{ row }">
        <IconButton
          v-if="row.invoiceNumber"
          :icon="ACTION_ICONS.download"
          :label="`Download invoice ${row.invoiceNumber}`"
          @click="invoice(row)"
        />
      </template>
      <template #empty>
        <EmptyState :icon="Receipt" title="No payments yet" />
      </template>
    </DataTable>

    <UiModal :open="open" title="Record Payment" :busy="saving" @close="open = false">
      <form id="manual-payment" class="space-y-4" novalidate @submit.prevent="save">
        <UiAlert v-if="formError">{{ formError }}</UiAlert>
        <div class="grid gap-4 sm:grid-cols-2">
          <UiSelect
            v-model="form.planId"
            label="Plan"
            :options="plans.map((p) => ({ value: p.id, label: p.name }))"
            required
          />
          <UiSelect
            v-model="form.cycle"
            label="Period"
            :options="[
              { value: 'monthly', label: '1 month' },
              { value: 'yearly', label: '1 year' },
            ]"
            required
          />
        </div>
        <UiInput
          v-model="form.total"
          label="Amount received (₹, including GST)"
          :placeholder="
            listPrice ? `Leave empty for the plan price + GST` : 'Required for this plan'
          "
          :error="errors.totalAmount"
        />
        <UiInput
          v-model="form.reference"
          label="UTR / cheque number"
          :error="errors.reference"
          required
        />
        <UiTextarea v-model="form.notes" label="Notes" optional :rows="2" :maxlength="500" />
        <ModalNote>
          The paid period is added after the current one ends (or after the trial), the client is
          moved to this plan, and a GST invoice is numbered and ready to download.
        </ModalNote>
      </form>
      <template #footer>
        <UiButton variant="secondary" :disabled="saving" @click="open = false">Cancel</UiButton>
        <UiButton type="submit" form="manual-payment" :loading="saving">Record Payment</UiButton>
      </template>
    </UiModal>
  </UiCard>
</template>
