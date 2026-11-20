<script setup lang="ts">
import { Building2, Plus } from 'lucide-vue-next'
import { computed, onMounted, ref } from 'vue'
import type { OrganizationDetail, OrganizationSummary, PlanDetail } from '@tdm/shared'
import { ACTION_ICONS } from '@/components/ui/actions'
import CopyField from '@/components/ui/CopyField.vue'
import DataTable from '@/components/ui/DataTable.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import IconButton from '@/components/ui/IconButton.vue'
import { sortLocal, type TableColumn } from '@/components/ui/table'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiBadge from '@/components/ui/UiBadge.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiCard from '@/components/ui/UiCard.vue'
import UiModal from '@/components/ui/UiModal.vue'
import { api, errorMessage } from '@/services/api'
import { formatDate, orgStatusBadge } from '@/utils/format'
import CreateOrganizationModal from './CreateOrganizationModal.vue'

const orgs = ref<OrganizationSummary[]>([])
const plans = ref<PlanDetail[]>([])
const loading = ref(true)
const loadError = ref('')
const createOpen = ref(false)
const created = ref<{ organization: OrganizationDetail; inviteUrl: string } | null>(null)

const sort = ref('-createdAt')
const columns: TableColumn[] = [
  { key: 'name', label: 'Client', sort: true },
  { key: 'status', label: 'Status', sort: true },
  { key: 'plan', label: 'Plan', sort: true },
  { key: 'userCount', label: 'Users', sort: true, align: 'right' },
  { key: 'paidUntil', label: 'Paid Until', sort: true },
  { key: 'createdAt', label: 'Created', sort: true },
]
const rows = computed(() =>
  sortLocal(orgs.value, sort.value, {
    name: (o) => o.name,
    status: (o) => orgStatusBadge[o.status].label,
    plan: (o) => o.plan.name,
    userCount: (o) => o.userCount,
    paidUntil: (o) => (o.paidUntil ? Date.parse(o.paidUntil) : null),
    createdAt: (o) => Date.parse(o.createdAt),
  }),
)

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const [o, p] = await Promise.all([
      api.get<OrganizationSummary[]>('/owner/organizations'),
      api.get<PlanDetail[]>('/owner/plans'),
    ])
    orgs.value = o.data
    // Retired plans cannot be given to new clients.
    plans.value = p.data.filter((plan) => plan.isActive)
  } catch (err) {
    loadError.value = errorMessage(err)
  } finally {
    loading.value = false
  }
}
onMounted(load)

function onCreated(result: { organization: OrganizationDetail; inviteUrl: string }) {
  createOpen.value = false
  orgs.value.unshift(result.organization)
  created.value = result
}
</script>

<template>
  <div>
    <UiAlert v-if="loadError" class="mb-4">{{ loadError }}</UiAlert>
    <UiAlert v-else-if="!loading && !plans.length" variant="warning" class="mb-4">
      No plans exist yet. Run <code>npm run db:seed</code> to create the default plan.
    </UiAlert>

    <UiCard
      :level="1"
      title="Clients"
      subtitle="Every client workspace on the platform."
      :icon="Building2"
    >
      <template #header>
        <UiButton size="xs" :disabled="!plans.length" @click="createOpen = true">
          <Plus class="size-4" aria-hidden="true" /> New Client
        </UiButton>
      </template>
      <DataTable
        v-model:sort="sort"
        :columns="columns"
        :rows="rows"
        :loading="loading"
        loading-text="Loading clients…"
      >
        <template #cell-name="{ row }">
          <RouterLink
            :to="`/organizations/${row.id}`"
            class="font-medium text-gray-800 hover:text-brand-500 dark:text-white/90"
          >
            {{ row.name }}
          </RouterLink>
          <p class="text-theme-xs text-gray-500 dark:text-gray-400">
            {{ row.url.replace(/^https?:\/\//, '') }}
          </p>
        </template>
        <template #cell-status="{ row }">
          <UiBadge :color="orgStatusBadge[row.status].color">
            {{ orgStatusBadge[row.status].label }}
          </UiBadge>
        </template>
        <template #cell-plan="{ row }">{{ row.plan.name }}</template>
        <template #cell-userCount="{ row }">
          <span class="tabular-nums">{{ row.userCount }}</span>
        </template>
        <template #cell-paidUntil="{ row }">
          <span class="text-xs whitespace-nowrap">
            <template v-if="row.paidUntil">{{ formatDate(row.paidUntil) }}</template>
            <template v-else-if="row.trialEndsAt"
              >Trial to {{ formatDate(row.trialEndsAt) }}</template
            >
            <template v-else>—</template>
          </span>
        </template>
        <template #cell-createdAt="{ row }">
          <span class="whitespace-nowrap text-gray-500 dark:text-gray-400">
            {{ formatDate(row.createdAt) }}
          </span>
        </template>
        <template #actions="{ row }">
          <IconButton
            :icon="ACTION_ICONS.view"
            :label="`Manage ${row.name}`"
            :to="`/organizations/${row.id}`"
          />
          <IconButton
            :icon="ACTION_ICONS.open"
            :label="`Open ${row.name}'s workspace`"
            :href="row.url"
          />
        </template>
        <template #empty>
          <EmptyState
            v-if="!loadError"
            title="No clients yet"
            description="Create the first client workspace. Its admin gets an email to set their password."
          />
        </template>
      </DataTable>
    </UiCard>

    <CreateOrganizationModal
      :open="createOpen"
      :plans="plans"
      @close="createOpen = false"
      @created="onCreated"
    />

    <UiModal :open="!!created" title="Client created" @close="created = null">
      <template v-if="created">
        <p class="mb-4 text-sm text-gray-600 dark:text-gray-400">
          {{ created.organization.name }} is ready. We emailed
          {{ created.organization.admins[0]?.email }} an invitation to set their password.
        </p>
        <div class="space-y-4">
          <CopyField :value="created.organization.url" label="Client web address" />
          <CopyField :value="created.inviteUrl" label="Admin invitation link (valid 72 hours)" />
        </div>
      </template>
      <template #footer>
        <UiButton @click="created = null">Done</UiButton>
      </template>
    </UiModal>
  </div>
</template>
