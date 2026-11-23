<script setup lang="ts">
import { FileSpreadsheet, PackageCheck, Search } from 'lucide-vue-next'
import { onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { AssetListItem, AssetPage, WarrantyStatus } from '@tdm/shared'
import { WARRANTY_LABELS, WARRANTY_STATUSES } from '@tdm/shared'
import { PERMISSIONS } from '@tdm/shared/permissions'
import { ACTION_ICONS } from '@/components/ui/actions'
import DataTable from '@/components/ui/DataTable.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import IconButton from '@/components/ui/IconButton.vue'
import type { TableColumn } from '@/components/ui/table'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiBadge from '@/components/ui/UiBadge.vue'
import UiCard from '@/components/ui/UiCard.vue'
import UiPagination from '@/components/ui/UiPagination.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import { api, errorMessage } from '@/services/api'
import { downloadFromApi } from '@/services/files'
import { useAuthStore } from '@/stores/auth'
import type { BadgeColor } from '@/utils/format'
import { formatDeadline } from '@/utils/tenders'
import NewTicketModal from '../tickets/NewTicketModal.vue'

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()
const canExport = auth.can(PERMISSIONS.REPORT_EXPORT)
const canTicket = auth.can(PERMISSIONS.TICKET_MANAGE)
// Engineers only see their own units, so the engineer filter is for admins and viewers.
const canFilterEngineer = !(
  auth.can(PERMISSIONS.INSTALLATION_OWN) && !auth.can(PERMISSIONS.INSTALLATION_MANAGE)
)

const page = ref<AssetPage | null>(null)
const q = ref('')
// ?warranty=expiring_30 opens the page already filtered (links from Reports).
const fromQuery = String(route.query.warranty ?? '')
const warranty = ref<WarrantyStatus | ''>(
  (WARRANTY_STATUSES as readonly string[]).includes(fromQuery) ? (fromQuery as WarrantyStatus) : '',
)
const installStatus = ref('')
const engineerId = ref('')
const engineers = ref<{ id: string; name: string }[]>([])
const pageNo = ref(1)
const pageSize = ref(20)
const loading = ref(false)
const error = ref('')
const ticketFor = ref<AssetListItem | null>(null)

const warrantyColor: Record<WarrantyStatus, BadgeColor> = {
  expired: 'error',
  expiring_30: 'warning',
  expiring_90: 'warning',
  active: 'success',
  not_set: 'gray',
}

/** The filters on screen, shared by the list and the Excel export. */
function filters(): Record<string, string> {
  const f: Record<string, string> = {}
  if (q.value.trim()) f.q = q.value.trim()
  if (warranty.value) f.warranty = warranty.value
  if (installStatus.value) f.installStatus = installStatus.value
  if (engineerId.value) f.engineerId = engineerId.value
  return f
}

/** The warranty follow-up tiles: click one to show only those units. */
const followUps: { status: WarrantyStatus; label: string; hint: string; tone: string }[] = [
  {
    status: 'expiring_30',
    label: 'Ending in 30 days',
    hint: 'Call the customer about renewal (AMC)',
    tone: 'text-warning-700 dark:text-warning-500',
  },
  {
    status: 'expiring_90',
    label: 'Ending in 31–90 days',
    hint: 'Plan the renewal follow-up',
    tone: 'text-gray-800 dark:text-white/90',
  },
  {
    status: 'expired',
    label: 'Expired',
    hint: 'Out of warranty: offer an AMC',
    tone: 'text-error-600 dark:text-error-500',
  },
]
const toggleWarranty = (s: WarrantyStatus) => (warranty.value = warranty.value === s ? '' : s)

async function load() {
  loading.value = true
  error.value = ''
  try {
    const params = { ...filters(), page: pageNo.value, pageSize: pageSize.value }
    page.value = (await api.get<AssetPage>('/assets', { params })).data
  } catch (err) {
    error.value = errorMessage(err)
  } finally {
    loading.value = false
  }
}
onMounted(() => {
  void load()
  if (canFilterEngineer)
    api
      .get<{ id: string; name: string }[]>('/assets/engineers')
      .then((r) => (engineers.value = r.data))
      .catch(() => undefined)
})

let timer: ReturnType<typeof setTimeout> | undefined
watch(q, () => {
  clearTimeout(timer)
  timer = setTimeout(() => {
    pageNo.value = 1
    void load()
  }, 350)
})
watch([warranty, installStatus, engineerId], () => {
  pageNo.value = 1
  void load()
})
watch(pageNo, load)
watch(pageSize, () => (pageNo.value === 1 ? load() : (pageNo.value = 1)))

const columns: TableColumn[] = [
  { key: 'itemName', label: 'Unit', class: 'min-w-48 max-w-xs' },
  { key: 'serial', label: 'Serial' },
  { key: 'customer', label: 'Customer / consignee', class: 'min-w-48' },
  { key: 'engineer', label: 'Engineer' },
  { key: 'warranty', label: 'Warranty' },
]

async function exportXlsx() {
  try {
    await downloadFromApi('/reports/export/assets.xlsx', filters(), 'Installed_assets.xlsx')
  } catch (err) {
    error.value = errorMessage(err)
  }
}

const daysText = (a: AssetListItem) =>
  a.daysLeft === null ? '' : a.daysLeft < 0 ? `${-a.daysLeft} days ago` : `${a.daysLeft} days left`
</script>

<template>
  <div>
    <UiAlert v-if="error" class="mb-4">{{ error }}</UiAlert>

    <UiCard
      :level="1"
      title="Installed Assets"
      subtitle="Every installed unit, with its serial numbers and warranty."
      :icon="PackageCheck"
    >
      <template #header>
        <label class="relative w-full sm:w-64">
          <span class="sr-only">Search assets</span>
          <Search
            class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-gray-400"
            aria-hidden="true"
          />
          <input
            v-model="q"
            type="search"
            placeholder="Search customer, item, serial, engineer..."
            class="form-field h-9! py-1! pl-9! text-sm!"
          />
        </label>
        <UiSelect
          v-model="warranty"
          aria-label="Warranty"
          size="sm"
          fit
          :options="[
            { value: '', label: 'Any warranty' },
            ...WARRANTY_STATUSES.map((w) => ({ value: w, label: WARRANTY_LABELS[w] })),
          ]"
        />
        <UiSelect
          v-model="installStatus"
          aria-label="Installation"
          size="sm"
          fit
          :options="[
            { value: '', label: 'Installed or not' },
            { value: 'installed', label: 'Installed' },
            { value: 'not_installed', label: 'Not installed' },
            { value: 'pending', label: 'Pending' },
          ]"
        />
        <UiSelect
          v-if="canFilterEngineer && engineers.length"
          v-model="engineerId"
          aria-label="Engineer"
          size="sm"
          fit
          :options="[
            { value: '', label: 'All Engineers' },
            ...engineers.map((e) => ({ value: e.id, label: e.name })),
          ]"
        />
        <IconButton
          v-if="canExport"
          :icon="FileSpreadsheet"
          :label="
            q || warranty || installStatus || engineerId
              ? 'Export these units to Excel'
              : 'Export to Excel'
          "
          variant="primary"
          @click="exportXlsx"
        />
      </template>

      <div class="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <button
          v-for="f in followUps"
          :key="f.status"
          type="button"
          :aria-pressed="warranty === f.status"
          class="rounded-lg border px-4 py-3 text-left transition-colors"
          :class="
            warranty === f.status
              ? 'border-brand-500 bg-brand-50 dark:border-brand-400 dark:bg-brand-500/10'
              : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-white/5'
          "
          @click="toggleWarranty(f.status)"
        >
          <span class="block text-theme-sm text-gray-600 dark:text-gray-400">{{ f.label }}</span>
          <span
            class="mt-1 block text-2xl font-semibold tabular-nums"
            :class="page?.warrantyCounts[f.status] ? f.tone : 'text-gray-400 dark:text-gray-500'"
          >
            {{ page?.warrantyCounts[f.status] ?? '–' }}
          </span>
          <span class="mt-0.5 block text-theme-xs text-gray-500 dark:text-gray-400">{{
            f.hint
          }}</span>
        </button>
      </div>

      <DataTable
        :columns="columns"
        :rows="page?.items ?? []"
        :loading="loading"
        loading-text="Loading units…"
      >
        <template #cell-itemName="{ row }">
          <p class="font-medium text-gray-800 dark:text-white/90">{{ row.itemName }}</p>
          <RouterLink
            :to="`/tenders/${row.tender.id}`"
            class="text-theme-xs text-brand-500 hover:text-brand-600"
          >
            {{ row.tender.referenceNo }}
          </RouterLink>
        </template>
        <template #cell-serial="{ row }">
          <div class="font-mono text-theme-xs">
            <template v-if="row.monitorSerial || row.cpuSerial">
              <div>Monitor: {{ row.monitorSerial ?? '—' }}</div>
              <div>CPU: {{ row.cpuSerial ?? '—' }}</div>
            </template>
            <template v-else>{{ row.serialNumber ?? '—' }}</template>
          </div>
        </template>
        <template #cell-customer="{ row }">
          <p>{{ row.customerName ?? '—' }}</p>
          <p class="text-theme-xs text-gray-500 dark:text-gray-400">{{ row.consignee.name }}</p>
        </template>
        <template #cell-engineer="{ row }">{{ row.engineer?.name ?? '—' }}</template>
        <template #cell-warranty="{ row }">
          <UiBadge :color="warrantyColor[row.warrantyStatus]">
            {{ WARRANTY_LABELS[row.warrantyStatus] }}
          </UiBadge>
          <p
            v-if="row.warrantyEnd"
            class="mt-1 text-theme-xs whitespace-nowrap text-gray-500 dark:text-gray-400"
          >
            Ends {{ formatDeadline(row.warrantyEnd) }} · {{ daysText(row) }}
          </p>
        </template>
        <template #actions="{ row }">
          <IconButton
            :icon="ACTION_ICONS.view"
            :label="`View tender ${row.tender.referenceNo}`"
            :to="`/tenders/${row.tender.id}`"
          />
          <IconButton
            v-if="canTicket"
            :icon="ACTION_ICONS.ticket"
            label="Raise a service ticket"
            @click="ticketFor = row"
          />
        </template>
        <template #empty>
          <EmptyState
            :title="
              q || warranty || installStatus
                ? 'No units match these filters'
                : 'No installed units yet'
            "
            description="Units appear here when serial numbers are added to a won tender's installation report."
          />
        </template>
      </DataTable>
      <template v-if="page && page.total > 0" #footer>
        <UiPagination
          :page="page.page"
          :page-size="page.pageSize"
          :total="page.total"
          :shown="page.items.length"
          :page-sizes="[5, 10, 20, 50]"
          noun="units"
          @change="(p) => (pageNo = p)"
          @page-size="(n) => (pageSize = n)"
        />
      </template>
    </UiCard>

    <NewTicketModal
      :open="!!ticketFor"
      :asset="ticketFor"
      @close="ticketFor = null"
      @created="(t) => router.push(`/tickets/${t.id}`)"
    />
  </div>
</template>
