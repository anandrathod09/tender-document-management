<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { RoleSummary, UserSummary } from '@tdm/shared'
import { isEngineerRole } from '@tdm/shared/permissions'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiModal from '@/components/ui/UiModal.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import { api, errorMessage, fieldErrors } from '@/services/api'

const props = defineProps<{ user: UserSummary | null; roles: RoleSummary[]; isSelf: boolean }>()
const emit = defineEmits<{ close: []; saved: [user: UserSummary] }>()

const name = ref('')
const roleId = ref('')
const phone = ref('')
const errors = ref<Record<string, string>>({})
const error = ref('')
const saving = ref(false)

const roleOptions = computed(() => props.roles.map((r) => ({ value: r.id, label: r.name })))
/** Engineers need a phone number: admins call them about installations. */
const phoneRequired = computed(() =>
  isEngineerRole(props.roles.find((r) => r.id === roleId.value)?.permissions ?? []),
)

watch(
  () => props.user,
  (u) => {
    if (!u) return
    name.value = u.name
    roleId.value = u.role.id
    phone.value = u.phone ?? ''
    errors.value = {}
    error.value = ''
  },
)

async function save(changes: Record<string, string | null>) {
  if (!props.user) return
  errors.value = {}
  error.value = ''
  saving.value = true
  try {
    const { data } = await api.patch<UserSummary>(`/users/${props.user.id}`, changes)
    emit('saved', data)
  } catch (err) {
    errors.value = fieldErrors(err)
    if (!Object.keys(errors.value).length) error.value = errorMessage(err)
  } finally {
    saving.value = false
  }
}

function submit() {
  const changes: Record<string, string | null> = {}
  if (name.value.trim() !== props.user?.name) changes.name = name.value
  if (phone.value.trim() !== (props.user?.phone ?? '')) changes.phone = phone.value.trim() || null
  if (roleId.value !== props.user?.role.id) changes.roleId = roleId.value
  if (!Object.keys(changes).length) return emit('close')
  void save(changes)
}
</script>

<template>
  <UiModal :open="!!user" title="Edit user" @close="emit('close')">
    <form id="edit-user" class="space-y-4" novalidate @submit.prevent="submit">
      <UiAlert v-if="error">{{ error }}</UiAlert>
      <UiInput v-model="name" label="Full name" :error="errors.name" required />
      <UiInput
        :model-value="user?.email ?? ''"
        label="Email"
        disabled
        hint="Email cannot be changed."
      />
      <UiInput
        v-model="phone"
        label="Phone number"
        type="tel"
        placeholder="Enter 10-digit number"
        :error="errors.phone"
        :required="phoneRequired"
        :hint="
          phoneRequired
            ? 'Required for engineers: shown to admins on installations so they can call them.'
            : undefined
        "
      />
      <UiSelect
        v-model="roleId"
        label="Role"
        :options="roleOptions"
        :error="errors.roleId"
        required
      />

      <div
        v-if="user && !isSelf && user.status !== 'invited'"
        class="rounded-lg border border-gray-200 p-4 dark:border-gray-800"
      >
        <p class="text-sm font-medium text-gray-800 dark:text-white/90">
          {{ user.status === 'suspended' ? 'Account suspended' : 'Account access' }}
        </p>
        <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {{
            user.status === 'suspended'
              ? 'This user cannot sign in. Reactivate to restore access.'
              : 'Suspending signs this user out immediately and blocks sign-in.'
          }}
        </p>
        <UiButton
          class="mt-3"
          size="sm"
          :variant="user.status === 'suspended' ? 'outline' : 'danger'"
          :loading="saving"
          @click="save({ status: user.status === 'suspended' ? 'active' : 'suspended' })"
        >
          {{ user.status === 'suspended' ? 'Reactivate user' : 'Suspend user' }}
        </UiButton>
      </div>
      <div
        v-else-if="user && !isSelf && user.status === 'invited'"
        class="rounded-lg border border-gray-200 p-4 dark:border-gray-800"
      >
        <p class="text-sm text-gray-500 dark:text-gray-400">
          This user has not accepted their invitation yet. Cancelling stops the invitation link from
          working.
        </p>
        <UiButton
          class="mt-3"
          size="sm"
          variant="danger"
          :loading="saving"
          @click="save({ status: 'suspended' })"
        >
          Cancel invitation
        </UiButton>
      </div>
    </form>
    <template #footer>
      <UiButton variant="secondary" @click="emit('close')">Cancel</UiButton>
      <UiButton type="submit" form="edit-user" :loading="saving">Save changes</UiButton>
    </template>
  </UiModal>
</template>
