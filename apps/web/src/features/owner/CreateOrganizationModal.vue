<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { OrganizationDetail, PlanSummary } from '@tdm/shared'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiModal from '@/components/ui/UiModal.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import { api, errorMessage, fieldErrors } from '@/services/api'

const props = defineProps<{ open: boolean; plans: PlanSummary[] }>()
const emit = defineEmits<{
  close: []
  created: [result: { organization: OrganizationDetail; inviteUrl: string }]
}>()

const form = ref({
  name: '',
  slug: '',
  planId: '',
  timezone: 'Asia/Kolkata',
  trialDays: '14',
  adminName: '',
  adminEmail: '',
})
const slugEdited = ref(false)
const errors = ref<Record<string, string>>({})
const error = ref('')
const saving = ref(false)

const planOptions = computed(() =>
  props.plans.map((p) => ({ value: p.id, label: `${p.name} (up to ${p.maxUsers} users)` })),
)

watch(
  () => props.open,
  (open) => {
    if (!open) return
    form.value = {
      name: '',
      slug: '',
      planId: props.plans[0]?.id ?? '',
      timezone: 'Asia/Kolkata',
      trialDays: '14',
      adminName: '',
      adminEmail: '',
    }
    slugEdited.value = false
    errors.value = {}
    error.value = ''
  },
)

/** Suggests a subdomain from the client name until the user types their own. */
watch(
  () => form.value.name,
  (name) => {
    if (slugEdited.value) return
    form.value.slug = name
      .toLowerCase()
      .replace(/\b(private|pvt|limited|ltd|llp)\b\.?/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 63)
  },
)

async function submit() {
  errors.value = {}
  error.value = ''
  saving.value = true
  try {
    const { data } = await api.post('/owner/organizations', {
      ...form.value,
      trialDays: Number(form.value.trialDays) || 0,
    })
    emit('created', data)
  } catch (err) {
    errors.value = fieldErrors(err)
    if (!Object.keys(errors.value).length) error.value = errorMessage(err)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UiModal :open="open" title="New client" width="lg" @close="emit('close')">
    <form id="create-org" class="space-y-5" novalidate @submit.prevent="submit">
      <UiAlert v-if="error">{{ error }}</UiAlert>

      <div class="grid gap-4 sm:grid-cols-2">
        <UiInput v-model="form.name" label="Company name" :error="errors.name" required />
        <UiInput
          v-model="form.slug"
          label="Subdomain"
          :error="errors.slug"
          hint="Their address: subdomain.yourdomain. Lowercase letters, digits, hyphens."
          required
          @input="slugEdited = true"
        />
        <UiSelect
          v-model="form.planId"
          label="Plan"
          :options="planOptions"
          :error="errors.planId"
          required
        />
        <UiInput
          v-model="form.trialDays"
          label="Trial days"
          type="number"
          :error="errors.trialDays"
          hint="0 makes the client active straight away."
        />
        <UiInput v-model="form.timezone" label="Time zone" :error="errors.timezone" required />
      </div>

      <div class="border-t border-gray-200 pt-5 dark:border-gray-800">
        <p class="mb-4 text-sm font-medium text-gray-800 dark:text-white/90">First admin</p>
        <div class="grid gap-4 sm:grid-cols-2">
          <UiInput v-model="form.adminName" label="Full name" :error="errors.adminName" required />
          <UiInput
            v-model="form.adminEmail"
            label="Email"
            type="email"
            :error="errors.adminEmail"
            required
          />
        </div>
      </div>
    </form>
    <template #footer>
      <UiButton variant="secondary" @click="emit('close')">Cancel</UiButton>
      <UiButton type="submit" form="create-org" :loading="saving">Create client</UiButton>
    </template>
  </UiModal>
</template>
