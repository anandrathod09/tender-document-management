<script setup lang="ts">
import { Copy, Download, KeyRound, ShieldCheck, Smartphone } from 'lucide-vue-next'
import qrcode from 'qrcode-generator'
import { computed, onMounted, ref } from 'vue'
import type { TwoFactorSetup, TwoFactorStatus } from '@tdm/shared'
import CopyField from '@/components/ui/CopyField.vue'
import ModalCallout from '@/components/ui/ModalCallout.vue'
import ModalNote from '@/components/ui/ModalNote.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiBadge from '@/components/ui/UiBadge.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiCard from '@/components/ui/UiCard.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiModal from '@/components/ui/UiModal.vue'
import { PRODUCT_NAME } from '@/config'
import { api, errorMessage } from '@/services/api'
import { useAuthStore } from '@/stores/auth'

/**
 * The signed-in person's own security: turn two-step login on (QR code and a
 * code from the app), keep backup codes, or turn it off.
 */
const auth = useAuthStore()
const status = ref<TwoFactorStatus | null>(null)
const error = ref('')
const notice = ref('')

// Setting up
const setup = ref<TwoFactorSetup | null>(null)
const setupCode = ref('')
const busy = ref(false)
/** Shown once, right after turning on or renewing. */
const freshCodes = ref<string[] | null>(null)

// Renew codes / turn off
const renewOpen = ref(false)
const renewCode = ref('')
const offOpen = ref(false)
const offPassword = ref('')
const dialogError = ref('')

async function load() {
  try {
    status.value = (await api.get<TwoFactorStatus>('/auth/2fa')).data
  } catch (err) {
    error.value = errorMessage(err)
  }
}
onMounted(load)

const qrImage = computed(() => {
  if (!setup.value) return ''
  const qr = qrcode(0, 'M')
  qr.addData(setup.value.otpauthUrl)
  qr.make()
  return qr.createDataURL(5, 4)
})

async function startSetup() {
  error.value = ''
  notice.value = ''
  busy.value = true
  try {
    setup.value = (await api.post<TwoFactorSetup>('/auth/2fa/setup')).data
    setupCode.value = ''
  } catch (err) {
    error.value = errorMessage(err)
  } finally {
    busy.value = false
  }
}

async function confirmSetup() {
  error.value = ''
  busy.value = true
  try {
    const { data } = await api.post<{ recoveryCodes: string[] }>('/auth/2fa/enable', {
      code: setupCode.value,
    })
    freshCodes.value = data.recoveryCodes
    setup.value = null
    auth.setTwoFactorEnabled(true)
    await load()
  } catch (err) {
    error.value = errorMessage(err)
  } finally {
    busy.value = false
  }
}

async function renew() {
  dialogError.value = ''
  busy.value = true
  try {
    const { data } = await api.post<{ recoveryCodes: string[] }>('/auth/2fa/recovery-codes', {
      code: renewCode.value,
    })
    freshCodes.value = data.recoveryCodes
    renewOpen.value = false
    await load()
  } catch (err) {
    dialogError.value = errorMessage(err)
  } finally {
    busy.value = false
  }
}

async function turnOff() {
  dialogError.value = ''
  busy.value = true
  try {
    await api.post('/auth/2fa/disable', { password: offPassword.value })
    offOpen.value = false
    auth.setTwoFactorEnabled(false)
    notice.value = 'Two-step login is now off for your account.'
    await load()
  } catch (err) {
    dialogError.value = errorMessage(err)
  } finally {
    busy.value = false
  }
}

function openRenew() {
  renewCode.value = ''
  dialogError.value = ''
  renewOpen.value = true
}
function openOff() {
  offPassword.value = ''
  dialogError.value = ''
  offOpen.value = true
}

const copied = ref(false)
async function copyCodes() {
  try {
    await navigator.clipboard.writeText((freshCodes.value ?? []).join('\n'))
    copied.value = true
    setTimeout(() => (copied.value = false), 2000)
  } catch {
    // Clipboard blocked: the codes are on screen and can be selected by hand.
  }
}

function downloadCodes() {
  if (!freshCodes.value) return
  const who = auth.user?.email ?? ''
  const text = [
    `${PRODUCT_NAME} backup codes for ${who}`,
    `Made on ${new Date().toLocaleString()}`,
    '',
    'Each code can be used once instead of the code from your app.',
    '',
    ...freshCodes.value,
    '',
  ].join('\n')
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
  const a = document.createElement('a')
  a.href = url
  a.download = 'backup-codes.txt'
  a.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <div class="space-y-6">
    <UiAlert v-if="error">{{ error }}</UiAlert>
    <UiAlert v-if="notice" variant="success">{{ notice }}</UiAlert>

    <UiCard
      :level="1"
      title="My Security"
      subtitle="Protect your account with a second step when you sign in."
      :icon="ShieldCheck"
    >
      <div class="space-y-5">
        <ModalCallout v-if="auth.mustSetUpTwoFactor" tone="warning" lead="Required: ">
          Your workspace requires two-step login. Set it up below to continue using the app.
        </ModalCallout>

        <div class="flex flex-wrap items-center justify-between gap-4">
          <div class="flex items-start gap-3">
            <Smartphone class="mt-0.5 size-6 shrink-0 text-gray-500" aria-hidden="true" />
            <div>
              <p class="flex items-center gap-2 font-medium text-gray-800 dark:text-white/90">
                Two-step login
                <UiBadge v-if="status" :color="status.enabled ? 'success' : 'gray'">
                  {{ status.enabled ? 'On' : 'Off' }}
                </UiBadge>
              </p>
              <p class="mt-1 max-w-2xl text-sm text-gray-600 dark:text-gray-400">
                After your password, you also enter a 6-digit code from an authenticator app on your
                phone (Google Authenticator, Microsoft Authenticator, Authy or similar). Even if
                someone learns your password, they cannot sign in without your phone.
              </p>
              <p v-if="status?.enabled" class="mt-2 text-sm text-gray-600 dark:text-gray-400">
                Backup codes left:
                <strong
                  :class="
                    status.recoveryCodesLeft <= 3
                      ? 'text-red-600'
                      : 'text-gray-800 dark:text-white/90'
                  "
                  >{{ status.recoveryCodesLeft }}</strong
                >
                <template v-if="status.recoveryCodesLeft <= 3"> · make new ones soon</template>
              </p>
            </div>
          </div>
          <div v-if="status" class="flex flex-wrap gap-2">
            <template v-if="status.enabled">
              <UiButton size="sm" variant="secondary" @click="openRenew">
                <KeyRound class="size-4" aria-hidden="true" /> New Backup Codes
              </UiButton>
              <UiButton v-if="!status.required" size="sm" variant="danger" @click="openOff">
                Turn Off
              </UiButton>
            </template>
            <UiButton v-else-if="!setup" size="sm" :loading="busy" @click="startSetup">
              <ShieldCheck class="size-4" aria-hidden="true" /> Set Up Two-Step Login
            </UiButton>
          </div>
        </div>
        <p v-if="status?.enabled && status.required" class="text-xs text-gray-500">
          Your workspace requires two-step login, so it cannot be turned off.
        </p>
      </div>
    </UiCard>

    <!-- Setting up -->
    <UiCard v-if="setup" title="Set Up Two-Step Login">
      <ol class="grid gap-6 lg:grid-cols-3">
        <li>
          <p class="mb-2 text-sm font-semibold text-gray-800 dark:text-white/90">
            1. Get an authenticator app
          </p>
          <p class="text-sm text-gray-600 dark:text-gray-400">
            Install Google Authenticator, Microsoft Authenticator or Authy on your phone, if you do
            not have one yet.
          </p>
        </li>
        <li>
          <p class="mb-2 text-sm font-semibold text-gray-800 dark:text-white/90">
            2. Scan this QR code with the app
          </p>
          <div class="inline-block rounded-lg border border-gray-200 bg-white p-2">
            <img
              :src="qrImage"
              alt="QR code to add this account to your authenticator app"
              class="size-44"
            />
          </div>
          <p class="mt-3 mb-1 text-xs text-gray-500 dark:text-gray-400">
            Can't scan it? Type this key into the app instead:
          </p>
          <CopyField :value="setup.secret" label="Setup key" />
        </li>
        <li>
          <form class="space-y-3" novalidate @submit.prevent="confirmSetup">
            <p class="text-sm font-semibold text-gray-800 dark:text-white/90">
              3. Enter the code the app shows
            </p>
            <UiInput
              v-model="setupCode"
              label="6-digit code"
              autocomplete="one-time-code"
              placeholder="123456"
              required
            />
            <div class="flex gap-2">
              <UiButton type="submit" :loading="busy" :disabled="setupCode.trim().length < 6">
                Turn On
              </UiButton>
              <UiButton variant="secondary" :disabled="busy" @click="setup = null">
                Cancel
              </UiButton>
            </div>
          </form>
        </li>
      </ol>
    </UiCard>

    <!-- Backup codes, shown once -->
    <UiModal :open="!!freshCodes" title="Save Your Backup Codes" @close="freshCodes = null">
      <div class="space-y-4">
        <ModalCallout tone="warning" lead="Important: ">
          Keep these codes somewhere safe, such as a password manager or a printed copy. If you lose
          your phone, each code lets you sign in once. They will not be shown again.
        </ModalCallout>
        <ul
          class="grid grid-cols-2 gap-2 rounded-lg bg-gray-50 p-4 font-mono text-sm text-gray-800 dark:bg-gray-900 dark:text-white/90"
        >
          <li v-for="c in freshCodes ?? []" :key="c">{{ c }}</li>
        </ul>
        <div class="flex flex-wrap gap-2">
          <UiButton size="sm" variant="secondary" @click="downloadCodes">
            <Download class="size-4" aria-hidden="true" /> Download .txt
          </UiButton>
          <UiButton size="sm" variant="secondary" @click="copyCodes">
            <Copy class="size-4" aria-hidden="true" /> {{ copied ? 'Copied' : 'Copy All' }}
          </UiButton>
        </div>
      </div>
      <template #footer>
        <UiButton @click="freshCodes = null">I Have Saved Them</UiButton>
      </template>
    </UiModal>

    <!-- New backup codes -->
    <UiModal :open="renewOpen" title="New Backup Codes" :busy="busy" @close="renewOpen = false">
      <form id="renew-codes" class="space-y-4" novalidate @submit.prevent="renew">
        <UiAlert v-if="dialogError">{{ dialogError }}</UiAlert>
        <p class="text-sm text-gray-600 dark:text-gray-400">
          Your old backup codes stop working. Enter the current code from your app to continue.
        </p>
        <UiInput v-model="renewCode" label="6-digit code" autocomplete="one-time-code" required />
      </form>
      <template #footer>
        <UiButton variant="secondary" :disabled="busy" @click="renewOpen = false">
          Cancel
        </UiButton>
        <UiButton type="submit" form="renew-codes" :loading="busy">Make New Codes</UiButton>
      </template>
    </UiModal>

    <!-- Turn off -->
    <UiModal :open="offOpen" title="Turn Off Two-Step Login" :busy="busy" @close="offOpen = false">
      <form id="turn-off" class="space-y-4" novalidate @submit.prevent="turnOff">
        <UiAlert v-if="dialogError">{{ dialogError }}</UiAlert>
        <ModalCallout tone="warning" lead="Warning: ">
          Your account will be protected by your password only.
        </ModalCallout>
        <UiInput
          v-model="offPassword"
          label="Your password"
          type="password"
          autocomplete="current-password"
          required
        />
        <ModalNote>You can turn it on again at any time from this page.</ModalNote>
      </form>
      <template #footer>
        <UiButton variant="secondary" :disabled="busy" @click="offOpen = false"> Cancel </UiButton>
        <UiButton type="submit" form="turn-off" variant="danger" :loading="busy">
          Turn Off
        </UiButton>
      </template>
    </UiModal>
  </div>
</template>
