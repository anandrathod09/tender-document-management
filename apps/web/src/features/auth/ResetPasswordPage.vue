<script setup lang="ts">
import { ref } from 'vue'
import { useRoute } from 'vue-router'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiInput from '@/components/ui/UiInput.vue'
import { api, errorMessage, fieldErrors } from '@/services/api'

const route = useRoute()
const token = typeof route.query.token === 'string' ? route.query.token : ''

const password = ref('')
const confirm = ref('')
const done = ref(false)
const error = ref(
  token ? '' : 'This reset link is incomplete. Open the link from your email again.',
)
const errors = ref<Record<string, string>>({})
const saving = ref(false)

async function submit() {
  errors.value = {}
  error.value = ''
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
    await api.post('/auth/reset-password', { token, password: password.value })
    done.value = true
  } catch (err) {
    errors.value = fieldErrors(err)
    if (!Object.keys(errors.value).length) error.value = errorMessage(err)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div>
    <h1 class="mb-2 text-title-sm font-semibold text-gray-800 dark:text-white/90">
      Choose a new password
    </h1>

    <template v-if="done">
      <UiAlert variant="success">
        Your password has been changed. For your security, you have been signed out on all devices.
      </UiAlert>
      <RouterLink
        to="/signin"
        class="mt-6 inline-flex rounded-lg bg-brand-500 px-5 py-3 text-sm font-medium text-white hover:bg-brand-600"
      >
        Sign in
      </RouterLink>
    </template>

    <form v-else class="mt-6 space-y-5" novalidate @submit.prevent="submit">
      <UiAlert v-if="error">
        {{ error }}
        <RouterLink to="/forgot-password" class="ml-1 font-medium underline"
          >Ask for a new link</RouterLink
        >
      </UiAlert>
      <UiInput
        v-model="password"
        label="New password"
        type="password"
        autocomplete="new-password"
        hint="At least 8 characters"
        :error="errors.password"
        required
      />
      <UiInput
        v-model="confirm"
        label="Confirm new password"
        type="password"
        autocomplete="new-password"
        :error="errors.confirm"
        required
      />
      <UiButton type="submit" :loading="saving" :disabled="!token" block>Change password</UiButton>
    </form>
  </div>
</template>
