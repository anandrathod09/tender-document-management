<script setup lang="ts">
import { BellRing, FileSpreadsheet, IndianRupee, Receipt } from 'lucide-vue-next'
import { computed, onMounted, ref, watch } from 'vue'
import type {
  OrganizationSummary,
  PaymentMethod,
  RevenueFollowUp,
  RevenueOverview,
  RevenuePayment,
  RevenueTotals,
} from '@tdm/shared'
import { ACTION_ICONS } from '@/components/ui/actions'
import DataTable from '@/components/ui/DataTable.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import IconButton from '@/components/ui/IconButton.vue'
import type { TableColumn } from '@/components/ui/table'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiBadge from '@/components/ui/UiBadge.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiCard from '@/components/ui/UiCard.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import { api, errorMessage } from '@/services/api'
import { downloadFromApi } from '@/services/files'
import type { BadgeColor } from '@/utils/format'
import { formatDate } from '@/utils/format'
import RevenueChart from './RevenueChart.vue'

/**
 * Money from all clients: what came in this month and this financial year
 * (April to March), month by month, every paid invoice, and the clients to
 * follow up before their paid period or trial runs out.
 */
const overview = ref<RevenueOverview | null>(null)
const list = ref<RevenuePayment[]>([])
const clients = ref<OrganizationSummary[]>([])
const loadingList = ref(true)
const error = ref('')
const exporting = ref(false)

const fy = ref('')
const clientId = ref('')
const method = ref<'' | PaymentMethod>('')

const filters = () => ({
  ...(fy.value && { fy: fy.value }),
  ...(clientId.value && { organizationId: clientId.value }),
  ...(method.value && { method: method.value }),
})

async function loadOverview() {
  try {
    overview.value = (
      await api.get<RevenueOverview>('/owner/revenue', { params: fy.value ? { fy: fy.value } : {} })
    ).data
    fy.value = overview.value.financialYear
  } catch (err) {
    error.value = errorMessage(err)
  }
}

async function loadList() {
  loadingList.value = true
  try {
    list.value = (
      await api.get<RevenuePayment[]>('/owner/revenue/payments', { params: filters() })
    ).data
  } catch (err) {
    error.value = errorMessage(err)
  } finally {
    loadingList.value = false
  }
}

onMounted(async () => {
  await loadOverview()
  await loadList()
  api
    .get<OrganizationSummary[]>('/owner/organizations')
    .then((r) => (clients.value = r.data))
    .catch(() => undefined)
})
watch(fy, (now, before) => {
  if (before && now !== before) void loadOverview().then(loadList)
})
watch([clientId, method], () => void loadList())

async function exportExcel() {
  error.value = ''
  exporting.value = true
  try {
    await downloadFromApi('/owner/revenue/invoices.xlsx', filters(), 'Invoices.xlsx')
  } catch (err) {
    error.value = errorMessage(err)
  } finally {
    exporting.value = false
  }
}

async function invoice(p: RevenuePayment) {
  error.value = ''
  try {
    await downloadFromApi(
      `/owner/organizations/${p.organization.id}/payments/${p.id}/invoice.pdf`,
      undefined,
      'Invoice.pdf',
    )
  } catch (err) {
    error.value = errorMessage(err)
  }
}

const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`
const gst = (t: Pick<RevenueTotals, 'cgst' | 'sgst' | 'igst'>) => t.cgst + t.sgst + t.igst
const monthName = new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric' }).format(
  new Date(),
)
const monthLong = new Intl.DateTimeFormat('en-IN', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
})
const fyLabel = (y: string) => `FY ${y}`

const tiles = computed(() => {
  const o = overview.value
  if (!o) return []
  return [
    {
      title: 'Collected this month',
      value: inr(o.thisMonth.totalAmount),
      note: `${monthName} · ${o.thisMonth.count} payment(s)`,
    },
    {
      title: `Collected in ${fyLabel(o.financialYear)}`,
      value: inr(o.year.totalAmount),
      note: `${inr(o.year.baseAmount)} before GST · ${o.year.count} payment(s)`,
    },
    {
      title: `GST in ${fyLabel(o.financialYear)}`,
      value: inr(gst(o.year)),
      note: `CGST ${inr(o.year.cgst)} · SGST ${inr(o.year.sgst)} · IGST ${inr(o.year.igst)}`,
    },
    {
      title: 'Paying clients',
      value: String(o.payingClients),
      note: 'With a paid period running today',
    },
  ]
})

const FOLLOW_UP: Record<RevenueFollowUp['kind'], { label: string; color: BadgeColor }> = {
  overdue: { label: 'Payment overdue', color: 'error' },
  trial_ended: { label: 'Trial ended', color: 'error' },
  renewal: { label: 'Renewal due', color: 'warning' },
  trial_ending: { label: 'Trial ending', color: 'info' },
}

const yearOptions = computed(() =>
  (overview.value?.years ?? []).map((y) => ({ value: y, label: fyLabel(y) })),
)
const clientOptions = computed(() => [
  { value: '', label: 'All clients' },
  ...clients.value.map((c) => ({ value: c.id, label: c.name })),
])
const methodOptions: { value: '' | PaymentMethod; label: string }[] = [
  { value: '', label: 'Online and manual' },
  { value: 'razorpay', label: 'Online' },
  { value: 'manual', label: 'Manual' },
]

// The table needs an id per row: one follow-up per client.
const followRows = computed(() =>
  (overview.value?.followUps ?? []).map((f) => ({ ...f, id: f.organization.id })),
)

const listTotal = computed(() => list.value.reduce((n, p) => n + p.totalAmount, 0))

const followColumns: TableColumn[] = [
  { key: 'client', label: 'Client', sticky: true, class: 'min-w-48' },
  { key: 'kind', label: 'Status' },
  { key: 'date', label: 'Date' },
  { key: 'plan', label: 'Plan' },
  { key: 'expected', label: 'Expected (before GST)', align: 'right' },
]
const paymentColumns: TableColumn[] = [
  { key: 'paidAt', label: 'Date' },
  { key: 'invoiceNumber', label: 'Invoice No' },
  { key: 'client', label: 'Client', class: 'min-w-44' },
  { key: 'plan', label: 'Plan' },
  { key: 'baseAmount', label: 'Before GST', align: 'right' },
  { key: 'gst', label: 'GST', align: 'right' },
  { key: 'totalAmount', label: 'Total', align: 'right' },
  { key: 'method', label: 'Paid By' },
]
</script>

<template>
  <div class="space-y-6">
    <UiAlert v-if="error">{{ error }}</UiAlert>

    <UiCard
      :level="1"
      title="Revenue"
      subtitle="Money received from all clients. Only paid invoices count; financial year April to March, by the paid date in India."
      :icon="IndianRupee"
    >
      <template #header>
        <UiSelect
          v-if="yearOptions.length"
          v-model="fy"
          :options="yearOptions"
          aria-label="Financial year"
          size="sm"
          fit
        />
      </template>

      <div v-if="overview" class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div
          v-for="t in tiles"
          :key="t.title"
          class="rounded-md border border-gray-200 p-4 dark:border-gray-800"
        >
          <p class="text-sm text-gray-600 dark:text-gray-400">{{ t.title }}</p>
          <p class="mt-1 text-2xl text-blue-500 tabular-nums">{{ t.value }}</p>
          <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">{{ t.note }}</p>
        </div>
      </div>

      <section v-if="overview" class="mt-6">
        <h2 class="mb-3 text-base font-medium text-gray-800 dark:text-white/90">
          Collected per month · {{ fyLabel(overview.financialYear) }}
        </h2>
        <RevenueChart :rows="overview.months" />
        <details class="mt-3">
          <summary class="cursor-pointer text-theme-sm font-medium text-brand-500">
            Show as a table
          </summary>
          <div class="custom-scrollbar mt-3 overflow-x-auto">
            <table class="min-w-full text-theme-sm">
              <thead
                class="bg-gray-50 text-left text-sm text-gray-800 dark:bg-gray-800 dark:text-white/90"
              >
                <tr>
                  <th class="px-2 py-2 font-medium">Month</th>
                  <th class="px-2 py-2 text-right font-medium">Payments</th>
                  <th class="px-2 py-2 text-right font-medium">Before GST</th>
                  <th class="px-2 py-2 text-right font-medium">GST</th>
                  <th class="px-2 py-2 text-right font-medium">Collected</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-100 tabular-nums dark:divide-gray-800">
                <tr
                  v-for="m in overview.months"
                  :key="m.month"
                  class="text-gray-700 dark:text-gray-300"
                >
                  <td class="px-2 py-2">
                    {{ monthLong.format(new Date(`${m.month}-01T00:00:00Z`)) }}
                  </td>
                  <td class="px-2 py-2 text-right">{{ m.count }}</td>
                  <td class="px-2 py-2 text-right">{{ inr(m.baseAmount) }}</td>
                  <td class="px-2 py-2 text-right">{{ inr(gst(m)) }}</td>
                  <td class="px-2 py-2 text-right">{{ inr(m.totalAmount) }}</td>
                </tr>
              </tbody>
              <tfoot>
                <tr class="font-medium text-gray-800 tabular-nums dark:text-white/90">
                  <td class="px-2 py-2">Total</td>
                  <td class="px-2 py-2 text-right">{{ overview.year.count }}</td>
                  <td class="px-2 py-2 text-right">{{ inr(overview.year.baseAmount) }}</td>
                  <td class="px-2 py-2 text-right">{{ inr(gst(overview.year)) }}</td>
                  <td class="px-2 py-2 text-right">{{ inr(overview.year.totalAmount) }}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </details>
      </section>
    </UiCard>

    <UiCard
      v-if="overview"
      title="Follow Up"
      subtitle="Clients whose paid period or trial ends in the next 30 days, or has already ended."
      :icon="BellRing"
    >
      <DataTable :columns="followColumns" :rows="followRows">
        <template #cell-client="{ row }">
          <RouterLink
            :to="`/organizations/${row.organization.id}`"
            class="font-medium text-gray-800 hover:text-blue-600 dark:text-white/90 dark:hover:text-blue-400"
          >
            {{ row.organization.name }}
          </RouterLink>
          <p class="text-xs text-gray-500">{{ row.organization.slug }}</p>
        </template>
        <template #cell-kind="{ row }">
          <UiBadge :color="FOLLOW_UP[row.kind].color">
            {{ FOLLOW_UP[row.kind].label }}
          </UiBadge>
          <p v-if="row.organization.status === 'suspended'" class="mt-1 text-xs text-gray-500">
            Suspended
          </p>
        </template>
        <template #cell-date="{ row }">
          <span class="text-sm whitespace-nowrap">{{ formatDate(row.date) }}</span>
        </template>
        <template #cell-plan="{ row }">
          <span class="text-sm">{{ row.plan }}</span>
          <span v-if="row.cycle" class="text-xs text-gray-500"> · {{ row.cycle }}</span>
        </template>
        <template #cell-expected="{ row }">
          <span class="text-sm tabular-nums">{{
            row.expectedBase === null ? 'On request' : inr(row.expectedBase)
          }}</span>
        </template>
        <template #empty>
          <EmptyState :icon="BellRing" title="Nobody to follow up right now" />
        </template>
      </DataTable>
    </UiCard>

    <UiCard
      v-if="overview"
      title="Payments"
      :subtitle="`Every paid invoice in ${fyLabel(overview.financialYear)}. The Excel file has the same rows, with GSTIN and the GST split, for your accountant.`"
      :icon="Receipt"
    >
      <template #header>
        <UiSelect
          v-model="clientId"
          :options="clientOptions"
          aria-label="Client"
          size="sm"
          class="w-48"
        />
        <UiSelect
          v-model="method"
          :options="methodOptions"
          aria-label="Paid by"
          size="sm"
          class="w-44"
        />
        <UiButton size="xs" variant="secondary" :loading="exporting" @click="exportExcel">
          <FileSpreadsheet class="size-4" aria-hidden="true" /> Export to Excel
        </UiButton>
      </template>
      <DataTable :columns="paymentColumns" :rows="list" :loading="loadingList">
        <template #cell-paidAt="{ row }">
          <span class="text-xs whitespace-nowrap">{{ formatDate(row.paidAt) }}</span>
        </template>
        <template #cell-invoiceNumber="{ row }">
          <span class="text-xs whitespace-nowrap">{{ row.invoiceNumber ?? '—' }}</span>
        </template>
        <template #cell-client="{ row }">
          <RouterLink
            :to="`/organizations/${row.organization.id}`"
            class="text-sm text-gray-800 hover:text-blue-600 dark:text-white/90 dark:hover:text-blue-400"
          >
            {{ row.organization.name }}
          </RouterLink>
          <p v-if="row.billToGstin" class="text-xs text-gray-500">GSTIN {{ row.billToGstin }}</p>
        </template>
        <template #cell-plan="{ row }">
          <span class="text-xs">{{ row.plan.name }} · {{ row.cycle }}</span>
        </template>
        <template #cell-baseAmount="{ row }">
          <span class="text-sm tabular-nums">{{ inr(row.baseAmount) }}</span>
        </template>
        <template #cell-gst="{ row }">
          <span class="text-sm tabular-nums">{{ inr(gst(row)) }}</span>
        </template>
        <template #cell-totalAmount="{ row }">
          <span class="font-medium whitespace-nowrap tabular-nums">{{ inr(row.totalAmount) }}</span>
        </template>
        <template #cell-method="{ row }">
          <UiBadge :color="row.method === 'razorpay' ? 'info' : 'gray'">
            {{ row.method === 'razorpay' ? 'Online' : 'Manual' }}
          </UiBadge>
          <p v-if="row.reference" class="mt-1 text-xs text-gray-500">{{ row.reference }}</p>
        </template>
        <template #actions="{ row }">
          <IconButton
            v-if="row.invoiceNumber"
            :icon="ACTION_ICONS.download"
            :label="`Download invoice ${row.invoiceNumber}`"
            @click="invoice(row)"
          />
        </template>
        <template #empty>
          <EmptyState :icon="Receipt" title="No paid invoices for these filters" />
        </template>
      </DataTable>
      <p
        v-if="list.length"
        class="mt-3 text-right text-sm text-gray-600 tabular-nums dark:text-gray-400"
      >
        {{ list.length }} payment(s) · total
        <strong class="text-gray-800 dark:text-white/90">{{ inr(listTotal) }}</strong>
      </p>
    </UiCard>
  </div>
</template>
