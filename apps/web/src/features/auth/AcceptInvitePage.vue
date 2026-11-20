<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiInput from '@/components/ui/UiInput.vue'
import { api, errorMessage, fieldErrors } from '@/services/api'
import { useAuthStore } from '@/stores/auth'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const token = typeof route.query.token === 'string' ? route.query.token : ''
const invite = ref<{ name: string; email: string; organizationName: string } | null>(null)
const loadError = ref('')
const password = ref('')
const confirm = ref('')
const errors = ref<Record<string, string>>({})
const submitError = ref('')
const saving = ref(false)

onMounted(async () => {
  if (!token) {
    loadError.value = 'This invitation link is incomplete. Open the link from your email again.'
    return
  }
  try {
    invite.value = (await api.get('/auth/invite', { params: { token } })).data
  } catch (err) {
    loadError.value = errorMessage(err)
  }
})

async function submit() {
  errors.value = {}
  submitError.value = ''
  if (password.value.length < 8) {
    errors.value.password = 'Password must be at least 8 characters'
    return
  }
  if (password.value !== confirm.value) {
    errors.value.confirm = 'Passwords do not match'
    return
  }
  saving.value = true
  try {
    await auth.acceptInvite(token, password.value)
    await router.replace('/')
  } catch (err) {
    errors.value = fieldErrors(err)
    if (!Object.keys(errors.value).length) submitError.value = errorMessage(err)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div>
    <template v-if="loadError">
      <h1 class="mb-4 text-title-sm font-semibold text-gray-800 dark:text-white/90">
        Invitation not valid
      </h1>
      <UiAlert>{{ loadError }}</UiAlert>
      <RouterLink
        to="/signin"
        class="mt-6 inline-block text-sm font-medium text-brand-500 hover:text-brand-600"
      >
        Go to sign in
      </RouterLink>
    </template>

    <template v-else-if="invite">
      <h1 class="mb-2 text-title-sm font-semibold text-gray-800 dark:text-white/90">
        Welcome, {{ invite.name }}
      </h1>
      <p class="mb-8 text-sm text-gray-500 dark:text-gray-400">
        Set a password to join {{ invite.organizationName }}. You will sign in with
        <strong class="font-medium text-gray-700 dark:text-gray-300">{{ invite.email }}</strong>.
      </p>
      <form class="space-y-5" novalidate @submit.prevent="submit">
        <UiAlert v-if="submitError">{{ submitError }}</UiAlert>
        <UiInput
          v-model="password"
          label="Password"
          type="password"
          autocomplete="new-password"
          hint="At least 8 characters"
          :error="errors.password"
          required
        />
        <UiInput
          v-model="confirm"
          label="Confirm password"
          type="password"
          autocomplete="new-password"
          :error="errors.confirm"
          required
        />
        <UiButton type="submit" :loading="saving" block>Set password and sign in</UiButton>
      </form>
    </template>

    <p v-else class="text-sm text-gray-500">Checking your invitation…</p>
  </div>
</template>
