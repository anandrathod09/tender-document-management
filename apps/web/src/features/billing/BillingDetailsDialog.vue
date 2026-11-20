<script setup lang="ts">
import { ref, watch } from 'vue'
import { GST_STATES, type BillingDetails, type BillingOverview } from '@tdm/shared'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiModal from '@/components/ui/UiModal.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import UiTextarea from '@/components/ui/UiTextarea.vue'
import { api, errorMessage, fieldErrors } from '@/services/api'

/** "Bill to" details printed on invoices; GST depends on the state. */
const props = defineProps<{ open: boolean; details: BillingDetails; fallbackName: string }>()
const emit = defineEmits<{ close: []; saved: [overview: BillingOverview] }>()

const form = ref({ name: '', address: '', gstin: '', state: '', email: '' })
const errors = ref<Record<string, string>>({})
const error = ref('')
const saving = ref(false)

watch(
  () => props.open,
  (open) => {
    if (!open) return
    const d = props.details
    form.value = {
      name: d.billingName ?? props.fallbackName,
      address: d.billingAddress ?? '',
      gstin: d.billingGstin ?? '',
      state: d.billingStateCode ?? '',
      email: d.billingEmail ?? '',
    }
    errors.value = {}
    error.value = ''
  },
)

// The first two digits of a GSTIN are the state.
watch(
  () => form.value.gstin,
  (g) => {
    const code = g.trim().slice(0, 2)
    if (/^\d{2}$/.test(code) && GST_STATES.some((s) => s.code === code)) form.value.state = code
  },
)

const stateOptions = GST_STATES.map((s) => ({ value: s.code, label: `${s.name} (${s.code})` }))

async function save() {
  errors.value = {}
  error.value = ''
  saving.value = true
  try {
    const { data } = await api.put<BillingOverview>('/billing/details', {
      billingName: form.value.name,
      billingAddress: form.value.address,
      billingGstin: form.value.gstin,
      billingStateCode: form.value.state,
      billingEmail: form.value.email,
    })
    emit('saved', data)
  } catch (err) {
    errors.value = fieldErrors(err)
    if (!Object.keys(errors.value).length) error.value = errorMessage(err)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UiModal :open="open" title="Billing Details" :busy="saving" @close="emit('close')">
    <form id="billing-details" class="space-y-4" novalidate @submit.prevent="save">
      <UiAlert v-if="error">{{ error }}</UiAlert>
      <p class="text-sm text-gray-600 dark:text-gray-400">
        These appear on your invoices. Add your GSTIN to claim input tax credit.
      </p>
      <UiInput v-model="form.name" label="Company name" :error="errors.billingName" required />
      <UiTextarea
        v-model="form.address"
        label="Address"
        optional
        :rows="3"
        :maxlength="500"
        :error="errors.billingAddress"
      />
      <UiInput
        v-model="form.gstin"
        label="GSTIN"
        placeholder="e.g. 27AAACA1234A1Z5"
        :error="errors.billingGstin"
        hint="Optional. Leave empty if you are not registered for GST."
      />
      <UiSelect
        v-model="form.state"
        label="State"
        :options="stateOptions"
        placeholder="-- Choose the state --"
        :error="errors.billingStateCode"
        required
      />
      <UiInput
        v-model="form.email"
        label="Email for invoices and reminders"
        type="email"
        :error="errors.billingEmail"
        hint="Optional. Admins are always told as well."
      />
    </form>
    <template #footer>
      <UiButton variant="secondary" :disabled="saving" @click="emit('close')">Cancel</UiButton>
      <UiButton type="submit" form="billing-details" :loading="saving">Save Details</UiButton>
    </template>
  </UiModal>
</template>
