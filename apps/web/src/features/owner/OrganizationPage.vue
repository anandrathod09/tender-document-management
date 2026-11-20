<script setup lang="ts">
import { ArrowLeft, Building2, ExternalLink, Send } from 'lucide-vue-next'
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import type { OrganizationDetail, PlanDetail } from '@tdm/shared'
import CopyField from '@/components/ui/CopyField.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiBadge from '@/components/ui/UiBadge.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiCard from '@/components/ui/UiCard.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiModal from '@/components/ui/UiModal.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import { api, errorMessage } from '@/services/api'
import { formatDate, orgStatusBadge, userStatusBadge } from '@/utils/format'
import OrgPaymentsCard from './OrgPaymentsCard.vue'

const route = useRoute()
const id = route.params.id as string

const org = ref<OrganizationDetail | null>(null)
const plans = ref<PlanDetail[]>([])
const loadError = ref('')
const name = ref('')
const planId = ref('')
const saving = ref(false)
const saveError = ref('')
const saved = ref(false)
const confirmSuspend = ref(false)
const inviteLink = ref<string | null>(null)

const planOptions = computed(() => plans.value.map((p) => ({ value: p.id, label: p.name })))
const dirty = computed(
  () => !!org.value && (name.value !== org.value.name || planId.value !== org.value.plan.id),
)

function apply(detail: OrganizationDetail) {
  org.value = detail
  name.value = detail.name
  planId.value = detail.plan.id
}

onMounted(async () => {
  try {
    const [o, p] = await Promise.all([
      api.get<OrganizationDetail>(`/owner/organizations/${id}`),
      api.get<PlanDetail[]>('/owner/plans'),
    ])
    apply(o.data)
    plans.value = p.data
  } catch (err) {
    loadError.value = errorMessage(err)
  }
})

async function update(changes: Record<string, string>) {
  saving.value = true
  saveError.value = ''
  saved.value = false
  try {
    apply((await api.patch<OrganizationDetail>(`/owner/organizations/${id}`, changes)).data)
    saved.value = true
  } catch (err) {
    saveError.value = errorMessage(err)
  } finally {
    saving.value = false
    confirmSuspend.value = false
  }
}

function saveDetails() {
  if (!org.value) return
  const changes: Record<string, string> = {}
  if (name.value !== org.value.name) changes.name = name.value
  if (planId.value !== org.value.plan.id) changes.planId = planId.value
  void update(changes)
}

async function reloadOrg() {
  try {
    apply((await api.get<OrganizationDetail>(`/owner/organizations/${id}`)).data)
  } catch (err) {
    saveError.value = errorMessage(err)
  }
}

async function resendInvite(userId: string) {
  saveError.value = ''
  try {
    const { data } = await api.post<{ inviteUrl: string }>(
      `/owner/organizations/${id}/users/${userId}/resend-invite`,
    )
    inviteLink.value = data.inviteUrl
  } catch (err) {
    saveError.value = errorMessage(err)
  }
}
</script>

<template>
  <div>
    <RouterLink
      to="/organizations"
      class="mb-4 inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-white/90"
    >
      <ArrowLeft class="size-4" aria-hidden="true" /> All clients
    </RouterLink>

    <UiAlert v-if="loadError">{{ loadError }}</UiAlert>

    <template v-else-if="org">
      <PageHeader
        :icon="Building2"
        :title="org.name"
        :description="`Created ${formatDate(org.createdAt)}`"
      >
        <template #actions>
          <UiBadge :color="orgStatusBadge[org.status].color">{{
            orgStatusBadge[org.status].label
          }}</UiBadge>
          <a
            :href="org.url"
            target="_blank"
            rel="noopener"
            class="inline-flex items-center gap-1.5 text-sm font-medium text-brand-500 hover:text-brand-600"
          >
            Open workspace <ExternalLink class="size-4" aria-hidden="true" />
          </a>
        </template>
      </PageHeader>

      <UiAlert v-if="saveError" class="mb-4">{{ saveError }}</UiAlert>
      <UiAlert v-else-if="saved" variant="success" class="mb-4">Changes saved.</UiAlert>

      <div class="grid gap-6 xl:grid-cols-3">
        <UiCard title="Details" class="xl:col-span-2">
          <form class="space-y-4" @submit.prevent="saveDetails">
            <div class="grid gap-4 sm:grid-cols-2">
              <UiInput v-model="name" label="Company name" required />
              <UiSelect v-model="planId" label="Plan" :options="planOptions" />
              <UiInput :model-value="org.url" label="Web address" disabled />
              <UiInput :model-value="org.timezone" label="Time zone" disabled />
            </div>
            <p
              v-if="org.trialEndsAt && org.status === 'trial'"
              class="text-sm text-gray-500 dark:text-gray-400"
            >
              Trial ends {{ formatDate(org.trialEndsAt) }}.
            </p>
            <UiButton type="submit" :disabled="!dirty" :loading="saving">Save changes</UiButton>
          </form>
        </UiCard>

        <UiCard title="Access">
          <p class="mb-4 text-sm text-gray-500 dark:text-gray-400">
            {{
              org.status === 'suspended'
                ? 'Suspended: nobody at this client can sign in. Their data is kept.'
                : 'Suspending signs out everyone at this client and blocks sign-in. Their data is kept.'
            }}
          </p>
          <UiButton
            v-if="org.status === 'suspended'"
            variant="outline"
            :loading="saving"
            @click="update({ status: 'active' })"
          >
            Reactivate client
          </UiButton>
          <UiButton
            v-else-if="org.status !== 'closed'"
            variant="danger"
            @click="confirmSuspend = true"
          >
            Suspend client
          </UiButton>
          <div v-if="org.status === 'trial'" class="mt-3">
            <UiButton variant="outline" :loading="saving" @click="update({ status: 'active' })"
              >End trial, make active</UiButton
            >
          </div>

          <h2 class="mt-8 mb-3 text-base font-semibold text-gray-800 dark:text-white/90">
            Admins
            <span class="font-normal text-gray-400">· {{ org.userCount }} users in total</span>
          </h2>
          <ul class="space-y-3">
            <li v-for="a in org.admins" :key="a.id" class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <p class="truncate text-theme-sm font-medium text-gray-800 dark:text-white/90">
                  {{ a.name }}
                </p>
                <p class="truncate text-theme-xs text-gray-500 dark:text-gray-400">{{ a.email }}</p>
              </div>
              <div class="flex shrink-0 items-center gap-2">
                <UiBadge :color="userStatusBadge[a.status].color">{{
                  userStatusBadge[a.status].label
                }}</UiBadge>
                <button
                  v-if="a.status === 'invited'"
                  type="button"
                  class="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:hover:bg-white/5"
                  :aria-label="`Resend invitation to ${a.name}`"
                  title="Resend invitation"
                  @click="resendInvite(a.id)"
                >
                  <Send class="size-4" />
                </button>
              </div>
            </li>
            <li v-if="!org.admins.length" class="text-sm text-gray-500">No active admins.</li>
          </ul>
        </UiCard>
      </div>

      <OrgPaymentsCard class="mt-6" :org="org" :plans="plans" @changed="reloadOrg" />

      <UiModal :open="confirmSuspend" title="Suspend this client?" @close="confirmSuspend = false">
        <p class="text-sm text-gray-600 dark:text-gray-400">
          Everyone at {{ org.name }} will be signed out and unable to sign in until you reactivate
          the client. No data is deleted.
        </p>
        <template #footer>
          <UiButton variant="secondary" @click="confirmSuspend = false">Cancel</UiButton>
          <UiButton variant="danger" :loading="saving" @click="update({ status: 'suspended' })"
            >Suspend client</UiButton
          >
        </template>
      </UiModal>

      <UiModal :open="!!inviteLink" title="Invitation sent" @close="inviteLink = null">
        <p class="mb-4 text-sm text-gray-600 dark:text-gray-400">
          A new invitation email is on its way. The previous link no longer works.
        </p>
        <CopyField v-if="inviteLink" :value="inviteLink" label="Invitation link (valid 72 hours)" />
        <template #footer>
          <UiButton @click="inviteLink = null">Done</UiButton>
        </template>
      </UiModal>
    </template>
  </div>
</template>
