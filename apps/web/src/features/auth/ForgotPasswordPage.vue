<script setup lang="ts">
import { ref } from 'vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiInput from '@/components/ui/UiInput.vue'
import { api, errorMessage, fieldErrors } from '@/services/api'

const email = ref('')
const sent = ref(false)
const error = ref('')
const errors = ref<Record<string, string>>({})
const loading = ref(false)

async function submit() {
  error.value = ''
  errors.value = {}
  loading.value = true
  try {
    await api.post('/auth/forgot-password', { email: email.value })
    sent.value = true
  } catch (err) {
    errors.value = fieldErrors(err)
    if (!Object.keys(errors.value).length) error.value = errorMessage(err)
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div>
    <h1 class="mb-2 text-title-sm font-semibold text-gray-800 dark:text-white/90">
      Forgot your password?
    </h1>

    <template v-if="sent">
      <UiAlert variant="success">
        If <strong>{{ email }}</strong> has an account here, we have emailed a link to choose a new
        password. It works for 60 minutes.
      </UiAlert>
      <p class="mt-6 text-sm text-gray-500 dark:text-gray-400">
        No email after a few minutes? Check your spam folder, or ask your workspace admin to send
        you a new invitation.
      </p>
    </template>

    <template v-else>
      <p class="mb-8 text-sm text-gray-500 dark:text-gray-400">
        Enter the email you sign in with and we will send you a link to choose a new password.
      </p>
      <form class="space-y-5" novalidate @submit.prevent="submit">
        <UiAlert v-if="error">{{ error }}</UiAlert>
        <UiInput
          v-model="email"
          label="Email"
          type="email"
          autocomplete="username"
          :error="errors.email"
          required
        />
        <UiButton type="submit" :loading="loading" block>Send reset link</UiButton>
      </form>
    </template>

    <RouterLink
      to="/signin"
      class="mt-6 inline-block text-sm font-medium text-brand-500 hover:text-brand-600"
    >
      Back to sign in
    </RouterLink>
  </div>
</template>
