<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { RoleSummary, UserSummary } from '@tdm/shared'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiModal from '@/components/ui/UiModal.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import { api, errorMessage, fieldErrors } from '@/services/api'

const props = defineProps<{ open: boolean; roles: RoleSummary[] }>()
const emit = defineEmits<{
  close: []
  invited: [result: { user: UserSummary; inviteUrl: string }]
}>()

const name = ref('')
const email = ref('')
const phone = ref('')
const roleId = ref('')
const errors = ref<Record<string, string>>({})
const error = ref('')
const saving = ref(false)

const roleOptions = computed(() => props.roles.map((r) => ({ value: r.id, label: r.name })))

watch(
  () => props.open,
  (open) => {
    if (!open) return
    name.value = ''
    email.value = ''
    phone.value = ''
    roleId.value = props.roles.find((r) => r.key === 'agent')?.id ?? props.roles[0]?.id ?? ''
    errors.value = {}
    error.value = ''
  },
)

async function submit() {
  errors.value = {}
  error.value = ''
  saving.value = true
  try {
    const { data } = await api.post('/users', {
      name: name.value,
      email: email.value,
      phone: phone.value || undefined,
      roleId: roleId.value,
    })
    emit('invited', data)
  } catch (err) {
    errors.value = fieldErrors(err)
    if (!Object.keys(errors.value).length) error.value = errorMessage(err)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UiModal :open="open" title="Invite user" @close="emit('close')">
    <form id="invite-user" class="space-y-4" novalidate @submit.prevent="submit">
      <UiAlert v-if="error">{{ error }}</UiAlert>
      <UiInput v-model="name" label="Full name" autocomplete="off" :error="errors.name" required />
      <UiInput
        v-model="email"
        label="Email"
        type="email"
        autocomplete="off"
        :error="errors.email"
        required
      />
      <UiInput
        v-model="phone"
        label="Phone number"
        type="tel"
        autocomplete="off"
        placeholder="Enter 10-digit number"
        :error="errors.phone"
        hint="Shown to admins when assigning tenders."
      />
      <UiSelect
        v-model="roleId"
        label="Role"
        :options="roleOptions"
        :error="errors.roleId"
        required
      />
    </form>
    <template #footer>
      <UiButton variant="secondary" @click="emit('close')">Cancel</UiButton>
      <UiButton type="submit" form="invite-user" :loading="saving">Send invitation</UiButton>
    </template>
  </UiModal>
</template>
