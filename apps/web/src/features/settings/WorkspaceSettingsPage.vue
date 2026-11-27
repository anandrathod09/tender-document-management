<script setup lang="ts">
import { Settings } from 'lucide-vue-next'
import { computed, onMounted, ref } from 'vue'
import type { WorkspaceSettings, WorkspaceSettingsInput } from '@tdm/shared'
import { DEFAULT_CLEANUP_DAYS, MAX_CLEANUP_DAYS } from '@tdm/shared/workflow'
import CopyField from '@/components/ui/CopyField.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiCard from '@/components/ui/UiCard.vue'
import { api, errorMessage } from '@/services/api'
import { useWorkflowStore } from '@/stores/workflow'
import SettingSwitch from './SettingSwitch.vue'

/**
 * Company-wide switches in one place: two-step login, what agents see, the
 * automatic cleanup of tenders nobody picked up, and the public support page.
 */
const settings = ref<WorkspaceSettings | null>(null)
const loadError = ref('')
const error = ref('')
const notice = ref('')
const saving = ref(false)
// The days box: Vue hands back a number from a number input, or '' while empty.
const draft = ref<string | number>(String(DEFAULT_CLEANUP_DAYS))

// The client's own name for the stage imported tenders arrive in ("New" by default).
const workflow = useWorkflowStore()
const intake = computed(
  () => workflow.stages.find((s) => s.systemRole === 'intake')?.label ?? 'New',
)

// The support emails box: addresses separated by commas.
const emailsDraft = ref('')
const supportUrl = `${location.origin}/support`

onMounted(async () => {
  workflow.load().catch(() => undefined)
  try {
    settings.value = (await api.get<WorkspaceSettings>('/workspace/settings')).data
    if (settings.value.cleanupDays !== null) draft.value = String(settings.value.cleanupDays)
    emailsDraft.value = settings.value.supportEmails.join(', ')
  } catch (err) {
    loadError.value = errorMessage(err)
  }
})

async function save(change: WorkspaceSettingsInput, done: (s: WorkspaceSettings) => string) {
  error.value = ''
  notice.value = ''
  saving.value = true
  try {
    const { data } = await api.patch<WorkspaceSettings>('/workspace/settings', change)
    settings.value = data
    if (data.cleanupDays !== null) draft.value = String(data.cleanupDays)
    emailsDraft.value = data.supportEmails.join(', ')
    notice.value = done(data)
  } catch (err) {
    error.value = errorMessage(err)
  } finally {
    saving.value = false
  }
}

const setTwoFactor = (on: boolean) =>
  save({ requireTwoFactor: on }, () =>
    on
      ? 'Two-step login is now required. People without it will be asked to set it up when they next use the app.'
      : 'Two-step login is no longer required.',
  )

const setAgentsSeeAssets = (on: boolean) =>
  save({ agentsSeeAssets: on }, () =>
    on
      ? 'Agents can now see Installed assets (after they reload the page).'
      : 'Installed assets is now hidden from agents.',
  )

const setAgentsSeeInstallation = (on: boolean) =>
  save({ agentsSeeInstallation: on }, () =>
    on
      ? 'Agents can now see the installation report of their tenders (after they reload the page).'
      : 'Installation reports are now hidden from agents.',
  )

const dayText = (n: number) => (n === 1 ? '1 day' : `${n} days`)

function cleanupSaved(s: WorkspaceSettings) {
  return s.cleanupDays === null
    ? `Cleanup turned off. Unassigned “${intake.value}” tenders stay until someone deletes them.`
    : `Unassigned “${intake.value}” tenders are deleted ${dayText(s.cleanupDays)} after the deadline.`
}

function parsedDays(): number | null {
  const n = Number(draft.value)
  return Number.isInteger(n) && n >= 1 && n <= MAX_CLEANUP_DAYS ? n : null
}

function toggleCleanup() {
  const on = settings.value?.cleanupDays !== null
  void save({ cleanupDays: on ? null : (parsedDays() ?? DEFAULT_CLEANUP_DAYS) }, cleanupSaved)
}

function saveDays() {
  const current = settings.value?.cleanupDays
  if (current === null || current === undefined) return
  const n = parsedDays()
  if (n === null) {
    error.value = `Enter a whole number of days from 1 to ${MAX_CLEANUP_DAYS}.`
    draft.value = String(current)
    return
  }
  if (n !== current) void save({ cleanupDays: n }, cleanupSaved)
}

const setSupportPage = (on: boolean) =>
  save({ supportPage: on }, () =>
    on
      ? 'The support page is on. Share its link with your customers.'
      : 'The support page is off. Customers who open it are told to contact you directly.',
  )

function saveEmails() {
  const list = emailsDraft.value
    .split(/[,;\s]+/)
    .map((e) => e.trim())
    .filter(Boolean)
  const current = settings.value?.supportEmails ?? []
  if (list.join(',').toLowerCase() === current.join(',')) return
  void save({ supportEmails: list }, (s) =>
    s.supportEmails.length
      ? `New support requests are emailed to ${s.supportEmails.join(', ')}.`
      : 'New support requests are emailed to the admins.',
  )
}

const sectionTitle =
  'pt-6 text-xs font-semibold tracking-wide text-gray-500 uppercase first:pt-0 dark:text-gray-400'
</script>

<template>
  <div>
    <UiAlert v-if="loadError" class="mb-4">{{ loadError }}</UiAlert>
    <UiAlert v-if="error" class="mb-4">{{ error }}</UiAlert>
    <UiAlert v-if="notice" variant="success" class="mb-4">{{ notice }}</UiAlert>

    <UiCard
      :level="1"
      title="Settings"
      subtitle="Company-wide rules for everyone in this workspace. Changes are saved straight away."
      :icon="Settings"
    >
      <div v-if="settings" class="max-w-3xl">
        <h2 :class="sectionTitle">Security</h2>
        <SettingSwitch
          title="Require two-step login"
          description="Everyone must enter a code from an authenticator app when signing in. Turn it on for your own account first (My Security)."
          :on="settings.requireTwoFactor"
          :disabled="saving"
          @toggle="setTwoFactor(!settings.requireTwoFactor)"
        />

        <h2 :class="sectionTitle">What agents see</h2>
        <div class="divide-y divide-gray-100 dark:divide-gray-800">
          <SettingSwitch
            title="Installed assets"
            description="Show the Installed assets page (every installed unit, its serial number and warranty) to users with the Agent role."
            :on="settings.agentsSeeAssets"
            :disabled="saving"
            @toggle="setAgentsSeeAssets(!settings.agentsSeeAssets)"
          />
          <SettingSwitch
            title="Installation report"
            description="Show the installation report (consignees, engineers, serial numbers) on the tenders an agent handled, and the consignee columns in their lists."
            :on="settings.agentsSeeInstallation"
            :disabled="saving"
            @toggle="setAgentsSeeInstallation(!settings.agentsSeeInstallation)"
          />
        </div>

        <h2 :class="sectionTitle">Automatic cleanup</h2>
        <SettingSwitch
          :title="`Delete unassigned “${intake}” tenders`"
          :description="`Tenders still in “${intake}” with no agent assigned are deleted a few days after their deadline, so the list stays short. Watchlist tenders, assigned tenders and tenders in any later stage are never deleted.`"
          :on="settings.cleanupDays !== null"
          :disabled="saving"
          @toggle="toggleCleanup"
        >
          <label
            :class="[
              'mt-3 flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300',
              settings.cleanupDays === null && 'opacity-50',
            ]"
          >
            Delete
            <input
              v-model="draft"
              type="number"
              inputmode="numeric"
              min="1"
              :max="MAX_CLEANUP_DAYS"
              aria-label="Days after the deadline"
              :disabled="settings.cleanupDays === null || saving"
              class="form-field h-9! w-20! py-0! text-sm!"
              @blur="saveDays"
              @keydown.enter.prevent="($event.target as HTMLInputElement).blur()"
            />
            days after the deadline
          </label>
        </SettingSwitch>

        <h2 :class="sectionTitle">Support page</h2>
        <SettingSwitch
          title="Let customers raise service requests"
          description="A public page, no sign-in needed, where a customer enters a product's serial number, sees its warranty and raises a service request. Each request becomes a service ticket, and everyone who handles tickets gets a notification."
          :on="settings.supportPage"
          :disabled="saving"
          @toggle="setSupportPage(!settings.supportPage)"
        >
          <div v-if="settings.supportPage" class="mt-3 max-w-xl space-y-4">
            <CopyField :value="supportUrl" label="Link for your customers" />
            <div>
              <label
                for="support-emails"
                class="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400"
              >
                Email new requests to
              </label>
              <input
                id="support-emails"
                v-model="emailsDraft"
                type="text"
                placeholder="service@yourcompany.com, manager@yourcompany.com"
                :disabled="saving"
                class="form-field"
                @blur="saveEmails"
                @keydown.enter.prevent="($event.target as HTMLInputElement).blur()"
              />
              <p class="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                Up to 5 addresses, separated by commas. Leave empty to email the admins.
              </p>
            </div>
          </div>
        </SettingSwitch>
      </div>
    </UiCard>
  </div>
</template>
