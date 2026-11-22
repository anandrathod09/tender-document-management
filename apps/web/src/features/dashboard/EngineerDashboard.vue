<script setup lang="ts">
import {
  Building2,
  CalendarDays,
  CheckCircle2,
  Clock,
  Mail,
  PackageCheck,
  Phone,
  RefreshCw,
  Sigma,
  Wrench,
} from 'lucide-vue-next'
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import type { InstallationSite } from '@tdm/shared'
import { ENGINEER_STATUS_LABELS } from '@tdm/shared'
import { ACTION_ICONS } from '@/components/ui/actions'
import DataTable from '@/components/ui/DataTable.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import IconButton from '@/components/ui/IconButton.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import { sortLocal, type TableColumn } from '@/components/ui/table'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiBadge from '@/components/ui/UiBadge.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiCard from '@/components/ui/UiCard.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import UiStatCard from '@/components/ui/UiStatCard.vue'
import { api, errorMessage } from '@/services/api'
import { formatDate, type BadgeColor } from '@/utils/format'
import { formatINRShort } from '@/utils/tenders'

/**
 * The engineer's dashboard from the old TMS, "My Assigned Installations":
 * every consignee assigned to them, with its tender and installation progress.
 */
type Progress = 'pending' | 'partial' | 'installed'
type Row = InstallationSite & { progress: Progress }

const router = useRouter()
const sites = ref<Row[]>([])
const loading = ref(true)
const error = ref('')
const status = ref('')
const search = ref('')
const sort = ref('')

const progressOf = (s: InstallationSite): Progress =>
  s.totalItems > 0 && s.installedItems >= s.totalItems
    ? 'installed'
    : s.installedItems > 0
      ? 'partial'
      : 'pending'
const PROGRESS: Record<Progress, { label: string; color: BadgeColor }> = {
  pending: { label: 'Pending', color: 'warning' },
  partial: { label: 'Partial', color: 'info' },
  installed: { label: 'Installed', color: 'success' },
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const { data } = await api.get<InstallationSite[]>('/assets/sites')
    sites.value = data.map((s) => ({ ...s, progress: progressOf(s) }))
  } catch (err) {
    error.value = errorMessage(err)
  } finally {
    loading.value = false
  }
}
onMounted(load)

const statusOptions = [
  { value: '', label: 'All Consignees' },
  { value: 'pending', label: 'Pending Installation' },
  { value: 'partial', label: 'Partially Installed' },
  { value: 'installed', label: 'Installed' },
  { value: 'completed', label: 'Completed' },
]

const shown = computed(() => {
  const q = search.value.trim().toLowerCase()
  const rows = sites.value.filter((s) => {
    if (
      status.value === 'completed'
        ? s.status !== 'completed'
        : status.value && s.progress !== status.value
    )
      return false
    if (!q) return true
    return [
      s.name,
      s.designation,
      s.tender.referenceNo,
      s.tender.buyerOrganization,
      s.tender.location,
    ]
      .filter(Boolean)
      .some((v) => v!.toLowerCase().includes(q))
  })
  return sortLocal(rows, sort.value, {
    name: (s) => s.name,
    tender: (s) => s.tender.referenceNo,
    location: (s) => s.tender.location,
    progress: (s) => (s.totalItems ? s.installedItems / s.totalItems : 0),
    value: (s) => s.tender.value,
  })
})

const count = (p: Progress) => sites.value.filter((s) => s.progress === p).length
const totalItems = computed(() => sites.value.reduce((n, s) => n + s.totalItems, 0))
const installedItems = computed(() => sites.value.reduce((n, s) => n + s.installedItems, 0))
const overall = computed(() =>
  totalItems.value ? Math.round((installedItems.value / totalItems.value) * 100) : 0,
)
const pct = (s: InstallationSite) =>
  s.totalItems ? Math.round((s.installedItems / s.totalItems) * 100) : 0

const columns: TableColumn[] = [
  { key: 'name', label: 'Consignee', sort: true, sticky: true, class: 'min-w-48' },
  { key: 'tender', label: 'Tender Reference', sort: true, class: 'min-w-48' },
  { key: 'location', label: 'Location', sort: true },
  { key: 'contact', label: 'Contact', class: 'min-w-44' },
  { key: 'progress', label: 'Progress', sort: true, class: 'min-w-36' },
  { key: 'status', label: 'Status' },
  { key: 'engineerStatus', label: 'Engineer Status' },
  {
    key: 'value',
    label: 'Contract Value',
    sort: true,
    align: 'right',
    class: 'min-w-32 whitespace-nowrap',
  },
]

const clear = () => {
  status.value = ''
  search.value = ''
}
</script>

<template>
  <div>
    <PageHeader title="My Assigned Installations" :icon="Wrench" />
    <UiAlert v-if="error" class="mb-4">{{ error }}</UiAlert>

    <div class="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
      <UiStatCard title="Total Consignees" :value="sites.length" :icon="Building2" />
      <UiStatCard title="Pending" :value="count('pending')" :icon="Clock" />
      <UiStatCard title="Partial" :value="count('partial')" :icon="Clock" />
      <UiStatCard title="Installed" :value="count('installed')" :icon="CheckCircle2" />
      <UiStatCard title="Total Items" :value="totalItems" :icon="Sigma" />
    </div>

    <UiCard title="Installation Progress" :icon="PackageCheck" class="mb-6">
      <div class="space-y-2">
        <div class="flex justify-between text-sm">
          <span class="text-gray-600 dark:text-gray-400">Overall Progress</span>
          <span class="font-medium text-gray-800 dark:text-white/90">{{ overall }}%</span>
        </div>
        <div
          class="h-2.5 w-full rounded-full bg-gray-200 dark:bg-gray-700"
          role="progressbar"
          :aria-valuenow="overall"
          aria-valuemin="0"
          aria-valuemax="100"
          aria-label="Overall installation progress"
        >
          <div
            class="h-2.5 rounded-full bg-green-600 transition-all duration-300"
            :style="{ width: `${overall}%` }"
          />
        </div>
        <div class="flex justify-between text-xs text-gray-500 dark:text-gray-400">
          <span>{{ installedItems }} installed</span>
          <span>{{ totalItems - installedItems }} remaining</span>
        </div>
      </div>
    </UiCard>

    <UiCard title="Assigned Consignees" flush>
      <template #header>
        <UiSelect
          v-model="status"
          aria-label="Filter by status"
          size="sm"
          :options="statusOptions"
          class="w-48"
        />
        <input
          v-model="search"
          type="search"
          class="form-field h-9 w-64"
          placeholder="Search by consignee, tender, location..."
          aria-label="Search consignees"
        />
        <UiButton v-if="status || search" size="xs" variant="ghost" @click="clear"
          >Clear Filters</UiButton
        >
        <UiButton
          size="sm"
          variant="secondary"
          :loading="loading"
          aria-label="Refresh"
          @click="load"
        >
          <RefreshCw v-if="!loading" class="size-4" aria-hidden="true" />
        </UiButton>
      </template>

      <DataTable
        v-model:sort="sort"
        :columns="columns"
        :rows="shown"
        :loading="loading"
        loading-text="Loading assigned consignees..."
        scroll-height="560px"
      >
        <template #empty>
          <EmptyState
            v-if="!sites.length"
            title="No consignees assigned to you"
            description="Consignees appear here once an admin assigns them to you in a tender's installation report."
          />
          <EmptyState
            v-else
            title="No matching consignees"
            description="No consignees match your filters. Try adjusting them."
          />
        </template>
        <template #cell-name="{ row }">
          <span class="block font-medium text-gray-800 dark:text-white/90">{{ row.name }}</span>
          <span class="block text-xs text-gray-500 dark:text-gray-400">{{ row.designation }}</span>
        </template>
        <template #cell-tender="{ row }">
          <span class="block text-sm">{{ row.tender.referenceNo }}</span>
          <span class="block text-xs text-gray-500 dark:text-gray-400">{{
            row.tender.buyerOrganization
          }}</span>
        </template>
        <template #cell-location="{ row }">{{ row.tender.location ?? '—' }}</template>
        <template #cell-contact="{ row }">
          <span class="flex items-center gap-1 text-xs"
            ><Phone class="size-3 text-gray-500" aria-hidden="true" />{{ row.phone || 'N/A' }}</span
          >
          <span class="flex items-center gap-1 text-xs"
            ><Mail class="size-3 text-gray-500" aria-hidden="true" /><span
              class="max-w-40 truncate"
              >{{ row.email || 'N/A' }}</span
            ></span
          >
          <span class="flex items-center gap-1 text-xs"
            ><CalendarDays class="size-3 text-gray-500" aria-hidden="true" />{{
              row.callAlignedDate ? formatDate(row.callAlignedDate) : 'N/A'
            }}</span
          >
        </template>
        <template #cell-progress="{ row }">
          <span class="flex justify-between text-xs">
            <span>{{ row.installedItems }}/{{ row.totalItems }}</span>
            <span>{{ pct(row) }}%</span>
          </span>
          <span class="mt-1 block h-1.5 w-full rounded-full bg-gray-200 dark:bg-gray-700">
            <span
              class="block h-1.5 rounded-full bg-green-600"
              :style="{ width: `${pct(row)}%` }"
            />
          </span>
        </template>
        <template #cell-status="{ row }">
          <UiBadge :color="PROGRESS[row.progress].color">{{
            PROGRESS[row.progress].label
          }}</UiBadge>
        </template>
        <template #cell-engineerStatus="{ row }">{{ ENGINEER_STATUS_LABELS[row.status] }}</template>
        <template #cell-value="{ row }">
          <span class="font-medium">{{ formatINRShort(row.tender.value) }}</span>
        </template>
        <template #actions="{ row }">
          <IconButton
            :icon="ACTION_ICONS.view"
            label="View Installation Details"
            @click="router.push(`/tenders/${row.tender.id}`)"
          />
        </template>
        <template v-if="shown.length" #footer>
          <div
            class="flex flex-wrap justify-between gap-2 text-xs text-gray-500 dark:text-gray-400"
          >
            <span>Showing {{ shown.length }} of {{ sites.length }} consignees</span>
            <span>Total Items: {{ totalItems }} | Installed: {{ installedItems }}</span>
          </div>
        </template>
      </DataTable>
    </UiCard>
  </div>
</template>
