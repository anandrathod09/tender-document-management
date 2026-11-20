<script setup lang="ts">
import { ShieldCheck } from 'lucide-vue-next'
import { computed, nextTick, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiInput from '@/components/ui/UiInput.vue'
import { errorCode, errorMessage } from '@/services/api'
import { useAuthStore } from '@/stores/auth'
import { useWorkspaceStore } from '@/stores/workspace'

const auth = useAuthStore()
const workspace = useWorkspaceStore()
const route = useRoute()
const router = useRouter()

const email = ref('')
const password = ref('')
const error = ref('')
const loading = ref(false)

// Second step, when the account has two-step login.
const challenge = ref<string | null>(null)
const code = ref('')
const useBackup = ref(false)
const codeBox = ref<HTMLElement | null>(null)

const heading = computed(() =>
  workspace.info.kind === 'tenant'
    ? `Sign in to ${workspace.info.name}`
    : 'Sign in to the owner panel',
)

async function goOn() {
  const redirect =
    typeof route.query.redirect === 'string' && route.query.redirect.startsWith('/')
      ? route.query.redirect
      : '/'
  await router.replace(redirect)
}

async function submit() {
  error.value = ''
  loading.value = true
  try {
    const result = await auth.login(email.value, password.value)
    if (result) {
      challenge.value = result.challengeToken
      code.value = ''
      await nextTick()
      codeBox.value?.querySelector('input')?.focus()
      return
    }
    await goOn()
  } catch (err) {
    error.value = errorMessage(err)
  } finally {
    loading.value = false
  }
}

async function submitCode() {
  if (!challenge.value) return
  error.value = ''
  loading.value = true
  try {
    await auth.loginTwoFactor(challenge.value, code.value)
    await goOn()
  } catch (err) {
    error.value = errorMessage(err)
    // The 5 minutes ran out: start again with the password.
    if (errorCode(err) === 'CHALLENGE_INVALID') backToPassword()
  } finally {
    loading.value = false
  }
}

function backToPassword() {
  challenge.value = null
  code.value = ''
  password.value = ''
  useBackup.value = false
}
</script>

<template>
  <div>
    <template v-if="!challenge">
      <h1 class="mb-2 text-title-sm font-semibold text-gray-800 dark:text-white/90">
        {{ heading }}
      </h1>
      <p class="mb-8 text-sm text-gray-500 dark:text-gray-400">Enter your email and password.</p>

      <form class="space-y-5" novalidate @submit.prevent="submit">
        <UiAlert v-if="error">{{ error }}</UiAlert>
        <UiInput v-model="email" label="Email" type="email" autocomplete="username" required />
        <UiInput
          v-model="password"
          label="Password"
          type="password"
          autocomplete="current-password"
          required
        />
        <div class="flex justify-end">
          <RouterLink
            to="/forgot-password"
            class="text-sm font-medium text-brand-500 hover:text-brand-600"
          >
            Forgot password?
          </RouterLink>
        </div>
        <UiButton type="submit" :loading="loading" block>Sign in</UiButton>
      </form>
    </template>

    <template v-else>
      <div class="mb-6 flex items-center gap-3">
        <span
          class="flex size-12 items-center justify-center rounded-full bg-blue-50 text-blue-500 dark:bg-blue-500/15"
        >
          <ShieldCheck class="size-6" aria-hidden="true" />
        </span>
        <div>
          <h1 class="text-title-sm font-semibold text-gray-800 dark:text-white/90">
            Two-step login
          </h1>
          <p class="text-sm text-gray-500 dark:text-gray-400">{{ email }}</p>
        </div>
      </div>
      <p class="mb-6 text-sm text-gray-600 dark:text-gray-400">
        <template v-if="!useBackup">
          Open your authenticator app and enter the 6-digit code for this account.
        </template>
        <template v-else>
          Enter one of the backup codes you saved when you set up two-step login. Each code works
          once.
        </template>
      </p>

      <form ref="codeBox" class="space-y-5" novalidate @submit.prevent="submitCode">
        <UiAlert v-if="error">{{ error }}</UiAlert>
        <UiInput
          v-model="code"
          :label="useBackup ? 'Backup code' : 'Code from your app'"
          :placeholder="useBackup ? 'e.g. k7m2-x9qp' : '123456'"
          :autocomplete="useBackup ? 'off' : 'one-time-code'"
          required
        />
        <UiButton type="submit" :loading="loading" :disabled="code.trim().length < 6" block>
          Verify and sign in
        </UiButton>
      </form>

      <div class="mt-5 flex flex-wrap justify-between gap-3 text-sm">
        <button
          type="button"
          class="font-medium text-brand-500 hover:text-brand-600"
          @click="((useBackup = !useBackup), (code = ''), (error = ''))"
        >
          {{ useBackup ? 'Use the code from my app' : 'Lost your phone? Use a backup code' }}
        </button>
        <button
          type="button"
          class="text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-white/90"
          @click="backToPassword"
        >
          Back
        </button>
      </div>
    </template>
  </div>
</template>
