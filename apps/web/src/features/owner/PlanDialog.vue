<script setup lang="ts">
import { ref, watch } from 'vue'
import type { PlanDetail } from '@tdm/shared'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiCheckbox from '@/components/ui/UiCheckbox.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiModal from '@/components/ui/UiModal.vue'
import { api, errorMessage, fieldErrors } from '@/services/api'

/** Adds or edits a plan. Prices are whole rupees before GST; empty means "not sold that way". */
const props = defineProps<{ open: boolean; plan: PlanDetail | null }>()
const emit = defineEmits<{ close: []; saved: [plan: PlanDetail] }>()

const empty = () => ({
  code: '',
  name: '',
  description: '',
  maxUsers: '5',
  maxStorageGb: '5',
  maxTendersPerMonth: '1000',
  maxCompanies: '3',
  priceMonthlyInr: '',
  priceYearlyInr: '',
  sortOrder: '0',
  isPublic: true,
  isActive: true,
})
const form = ref(empty())
const errors = ref<Record<string, string>>({})
const error = ref('')
const saving = ref(false)

watch(
  () => props.open,
  (open) => {
    if (!open) return
    errors.value = {}
    error.value = ''
    const p = props.plan
    form.value = p
      ? {
          code: p.code,
          name: p.name,
          description: p.description ?? '',
          maxUsers: String(p.maxUsers),
          maxStorageGb: String(p.maxStorageGb),
          maxTendersPerMonth: String(p.maxTendersPerMonth),
          maxCompanies: String(p.maxCompanies),
          priceMonthlyInr: p.priceMonthlyInr === null ? '' : String(p.priceMonthlyInr),
          priceYearlyInr: p.priceYearlyInr === null ? '' : String(p.priceYearlyInr),
          sortOrder: String(p.sortOrder),
          isPublic: p.isPublic,
          isActive: p.isActive,
        }
      : empty()
  },
)

const num = (v: string) => Number(v.replace(/,/g, '').trim())
const money = (v: string) => (v.trim() === '' ? null : num(v))

async function save() {
  errors.value = {}
  error.value = ''
  saving.value = true
  const f = form.value
  const body = {
    code: f.code,
    name: f.name,
    description: f.description,
    maxUsers: num(f.maxUsers),
    maxStorageGb: num(f.maxStorageGb),
    maxTendersPerMonth: num(f.maxTendersPerMonth),
    maxCompanies: num(f.maxCompanies),
    priceMonthlyInr: money(f.priceMonthlyInr),
    priceYearlyInr: money(f.priceYearlyInr),
    sortOrder: num(f.sortOrder) || 0,
    isPublic: f.isPublic,
    isActive: f.isActive,
  }
  try {
    const { data } = props.plan
      ? await api.put<PlanDetail>(`/owner/plans/${props.plan.id}`, body)
      : await api.post<PlanDetail>('/owner/plans', body)
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
  <UiModal
    :open="open"
    :title="plan ? `Edit Plan: ${plan.name}` : 'Add Plan'"
    width="lg"
    :busy="saving"
    @close="emit('close')"
  >
    <form id="plan-form" class="space-y-4" novalidate @submit.prevent="save">
      <UiAlert v-if="error">{{ error }}</UiAlert>
      <div class="grid gap-4 sm:grid-cols-2">
        <UiInput v-model="form.name" label="Name" :error="errors.name" required />
        <UiInput
          v-model="form.code"
          label="Code"
          placeholder="e.g. standard"
          hint="Lowercase letters, digits and hyphens."
          :error="errors.code"
          required
        />
        <div class="sm:col-span-2">
          <UiInput
            v-model="form.description"
            label="Short description"
            placeholder="Shown to clients on their billing page"
            :error="errors.description"
          />
        </div>
        <UiInput
          v-model="form.priceMonthlyInr"
          label="Price per month (₹)"
          hint="Before GST. Empty: not sold monthly."
          :error="errors.priceMonthlyInr"
        />
        <UiInput
          v-model="form.priceYearlyInr"
          label="Price per year (₹)"
          hint="Before GST. Empty: not sold yearly."
          :error="errors.priceYearlyInr"
        />
        <UiInput v-model="form.maxUsers" label="Users" :error="errors.maxUsers" required />
        <UiInput
          v-model="form.maxStorageGb"
          label="Storage (GB)"
          :error="errors.maxStorageGb"
          required
        />
        <UiInput
          v-model="form.maxTendersPerMonth"
          label="Tenders per month"
          :error="errors.maxTendersPerMonth"
          required
        />
        <UiInput
          v-model="form.maxCompanies"
          label="Bidding companies"
          hint="Active companies (letterheads) the client can have."
          :error="errors.maxCompanies"
          required
        />
        <UiInput
          v-model="form.sortOrder"
          label="Display order"
          hint="Lower numbers are shown first."
          :error="errors.sortOrder"
        />
      </div>
      <div class="space-y-1 rounded-lg bg-gray-50 p-3 text-sm dark:bg-gray-900">
        <label class="flex items-center gap-2">
          <UiCheckbox v-model="form.isPublic" label="Offered to clients" />
          Offered to clients on their billing page
        </label>
        <label class="flex items-center gap-2">
          <UiCheckbox v-model="form.isActive" label="Available" />
          Available (untick to retire: current clients keep it, nobody new can choose it)
        </label>
      </div>
    </form>
    <template #footer>
      <UiButton variant="secondary" :disabled="saving" @click="emit('close')">Cancel</UiButton>
      <UiButton type="submit" form="plan-form" :loading="saving">
        {{ plan ? 'Save Plan' : 'Add Plan' }}
      </UiButton>
    </template>
  </UiModal>
</template>
