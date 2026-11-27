<script setup lang="ts">
import { Mail } from 'lucide-vue-next'
import { computed, onMounted, ref } from 'vue'
import { EMAIL_EVENT_INFO, type EmailEvent, type EmailPreferences } from '@tdm/shared'
import { PERMISSIONS } from '@tdm/shared/permissions'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiCard from '@/components/ui/UiCard.vue'
import { api, errorMessage } from '@/services/api'
import { useAuthStore } from '@/stores/auth'
import SettingSwitch from '@/features/settings/SettingSwitch.vue'

/**
 * The person's own choice of emails. The in-app bell keeps every
 * notification either way; this only decides what also arrives by email.
 */
const auth = useAuthStore()
const prefs = ref<EmailPreferences | null>(null)
const error = ref('')
const saving = ref<EmailEvent | null>(null)

// Only the events that can happen to this person's role.
const events = computed<EmailEvent[]>(() =>
  (
    [
      ['tender_assigned', true],
      [
        'engineer_assigned',
        auth.can(PERMISSIONS.INSTALLATION_OWN) || auth.can(PERMISSIONS.INSTALLATION_MANAGE),
      ],
      ['ticket_assigned', auth.can(PERMISSIONS.TICKET_MANAGE)],
    ] as const
  )
    .filter(([, shown]) => shown)
    .map(([event]) => event),
)

onMounted(async () => {
  try {
    prefs.value = (await api.get<EmailPreferences>('/account/email-preferences')).data
  } catch (err) {
    error.value = errorMessage(err)
  }
})

async function toggle(event: EmailEvent) {
  if (!prefs.value) return
  error.value = ''
  saving.value = event
  try {
    prefs.value = (
      await api.patch<EmailPreferences>('/account/email-preferences', {
        [event]: !prefs.value[event],
      })
    ).data
  } catch (err) {
    error.value = errorMessage(err)
  } finally {
    saving.value = null
  }
}
</script>

<template>
  <div>
    <UiAlert v-if="error" class="mb-4">{{ error }}</UiAlert>
    <UiCard
      :level="1"
      title="My Email Notifications"
      subtitle="Choose what also comes to you by email. The bell in the app keeps showing everything."
      :icon="Mail"
    >
      <div v-if="prefs" class="max-w-3xl divide-y divide-gray-100 dark:divide-gray-800">
        <SettingSwitch
          v-for="event in events"
          :key="event"
          :title="EMAIL_EVENT_INFO[event].title"
          :description="EMAIL_EVENT_INFO[event].description"
          :on="prefs[event]"
          :disabled="saving === event"
          @toggle="toggle(event)"
        />
      </div>
      <p class="mt-4 max-w-3xl text-theme-xs text-gray-500 dark:text-gray-400">
        Emails go to {{ auth.user?.email }}. You never get an email about something you did
        yourself.
      </p>
    </UiCard>
  </div>
</template>
