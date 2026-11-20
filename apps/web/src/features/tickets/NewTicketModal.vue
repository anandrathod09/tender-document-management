<script setup lang="ts">
import { ref, watch } from 'vue'
import type { AssetListItem, TicketDetail } from '@tdm/shared'
import { TICKET_PRIORITIES, TICKET_TYPES } from '@tdm/shared'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiModal from '@/components/ui/UiModal.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import { api, errorMessage, fieldErrors } from '@/services/api'

/** Records client feedback or a service request, optionally about one installed unit. */
const props = defineProps<{ open: boolean; asset?: AssetListItem | null }>()
const emit = defineEmits<{ close: []; created: [ticket: TicketDetail] }>()

const form = ref({
  title: '',
  description: '',
  type: 'complaint',
  priority: 'medium',
  customerName: '',
  contactName: '',
  contactPhone: '',
  contactEmail: '',
  assignedTo: '',
})
const people = ref<{ id: string; name: string }[]>([])
const errors = ref<Record<string, string>>({})
const error = ref('')
const saving = ref(false)

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

watch(
  () => props.open,
  async (open) => {
    if (!open) return
    form.value = {
      title: props.asset
        ? `${props.asset.itemName}${props.asset.serialNumber ? ` (${props.asset.serialNumber})` : ''}: `
        : '',
      description: '',
      type: 'complaint',
      priority: 'medium',
      customerName: props.asset?.customerName ?? '',
      contactName: '',
      contactPhone: '',
      contactEmail: '',
      assignedTo: props.asset?.engineer?.id ?? '',
    }
    errors.value = {}
    error.value = ''
    try {
      people.value = (await api.get('/assets/engineers')).data
    } catch {
      people.value = []
    }
  },
)

async function submit() {
  errors.value = {}
  error.value = ''
  saving.value = true
  try {
    const { data } = await api.post<TicketDetail>('/tickets', {
      ...form.value,
      assignedTo: form.value.assignedTo || null,
      assetId: props.asset?.id ?? null,
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
  <UiModal :open="open" title="New ticket" width="lg" @close="emit('close')">
    <form id="new-ticket" class="space-y-4" novalidate @submit.prevent="submit">
      <UiAlert v-if="error">{{ error }}</UiAlert>
      <p
        v-if="asset"
        class="rounded-lg bg-gray-50 px-3 py-2 text-theme-sm text-gray-600 dark:bg-white/5 dark:text-gray-400"
      >
        About <strong class="font-medium">{{ asset.itemName }}</strong>
        <template v-if="asset.serialNumber"> · serial {{ asset.serialNumber }}</template> ·
        {{ asset.tender.referenceNo }}
      </p>
      <UiInput v-model="form.title" label="Title" :error="errors.title" required />
      <div>
        <label
          for="ticket-desc"
          class="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400"
        >
          What happened<span class="text-error-500"> *</span>
        </label>
        <textarea
          id="ticket-desc"
          v-model="form.description"
          rows="4"
          maxlength="5000"
          :class="['form-field h-auto', errors.description && 'border-error-300']"
        />
        <p v-if="errors.description" class="mt-1.5 text-theme-xs text-error-500">
          {{ errors.description }}
        </p>
      </div>
      <div class="grid gap-4 sm:grid-cols-3">
        <UiSelect
          v-model="form.type"
          label="Type"
          :options="TICKET_TYPES.map((t) => ({ value: t, label: cap(t) }))"
        />
        <UiSelect
          v-model="form.priority"
          label="Priority"
          :options="TICKET_PRIORITIES.map((p) => ({ value: p, label: cap(p) }))"
        />
        <UiSelect
          v-model="form.assignedTo"
          label="Assign to"
          :options="[
            { value: '', label: 'Nobody yet' },
            ...people.map((p) => ({ value: p.id, label: p.name })),
          ]"
        />
      </div>
      <div class="grid gap-4 sm:grid-cols-2">
        <UiInput v-model="form.customerName" label="Customer" />
        <UiInput v-model="form.contactName" label="Contact person" />
        <UiInput v-model="form.contactPhone" label="Phone" />
        <UiInput
          v-model="form.contactEmail"
          label="Email"
          type="email"
          :error="errors.contactEmail"
        />
      </div>
    </form>
    <template #footer>
      <UiButton variant="secondary" @click="emit('close')">Cancel</UiButton>
      <UiButton type="submit" form="new-ticket" :loading="saving">Create ticket</UiButton>
    </template>
  </UiModal>
</template>
