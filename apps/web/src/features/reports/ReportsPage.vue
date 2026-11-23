<script setup lang="ts">
import { ChartColumn, FileSpreadsheet } from 'lucide-vue-next'
import { computed, onMounted, ref, watch } from 'vue'
import type { ReportSummary } from '@tdm/shared'
import { PERMISSIONS } from '@tdm/shared/permissions'
import PageHeader from '@/components/ui/PageHeader.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiButton from '@/components/ui/UiButton.vue'
import { api, errorMessage } from '@/services/api'
import { downloadFromApi } from '@/services/files'
import { useAuthStore } from '@/stores/auth'
import { formatINR } from '@/utils/tenders'
import MonthlyChart from './MonthlyChart.vue'

const auth = useAuthStore()
const canExport = auth.can(PERMISSIONS.REPORT_EXPORT)
const canTickets = auth.can(PERMISSIONS.TICKET_MANAGE)

const pad = (n: number) => String(n).padStart(2, '0')
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const now = new Date()
/** Indian financial year: April to March. */
const fyStart = new Date(now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1, 3, 1)

const presets = [
  {
    key: 'fy',
    label: `FY ${fyStart.getFullYear()}–${String(fyStart.getFullYear() + 1).slice(2)}`,
    from: iso(fyStart),
  },
  {
    key: '12m',
    label: 'Last 12 months',
    from: iso(new Date(now.getFullYear(), now.getMonth() - 11, 1)),
  },
  {
    key: '3m',
    label: 'Last 3 months',
    from: iso(new Date(now.getFullYear(), now.getMonth() - 2, 1)),
  },
]
const preset = ref('fy')
const from = ref(presets[0]!.from)
const to = ref(iso(now))

const data = ref<ReportSummary | null>(null)
const error = ref('')
const loading = ref(false)

async function load() {
  if (!from.value || !to.value) return
  loading.value = true
  error.value = ''
  try {
    data.value = (
      await api.get<ReportSummary>('/reports/summary', {
        params: { from: from.value, to: to.value },
      })
    ).data
  } catch (err) {
    error.value = errorMessage(err)
  } finally {
    loading.value = false
  }
}
onMounted(load)
watch(preset, (p) => {
  const found = presets.find((x) => x.key === p)
  if (found) {
    from.value = found.from
    to.value = iso(now)
  }
})
watch([from, to], load)

const pct = (n: number | null) => (n === null ? '—' : `${Math.round(n * 100)}%`)
const kpis = computed(() => {
  const t = data.value?.totals
  if (!t) return []
  return [
    { label: 'Tenders added', value: String(t.added) },
    { label: 'Bids submitted', value: String(t.submitted) },
    { label: 'Won', value: String(t.won), hint: formatINR(t.wonValue) },
    { label: 'Lost', value: String(t.lost) },
    { label: 'Win rate', value: pct(t.winRate), hint: `${t.won} of ${t.won + t.lost} decided` },
  ]
})

const monthLong = new Intl.DateTimeFormat('en-IN', {
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})

async function exportTenders() {
  try {
    await downloadFromApi('/reports/export/tenders.xlsx', { sort: '-createdAt' }, 'Tenders.xlsx')
  } catch (err) {
    error.value = errorMessage(err)
  }
}
</script>

<template>
  <div>
    <PageHeader
      title="Reports"
      :icon="ChartColumn"
      description="How bidding is going: bids, wins and each agent's results."
    >
      <template v-if="canExport" #actions>
        <UiButton variant="outline" @click="exportTenders">
          <FileSpreadsheet class="size-4" aria-hidden="true" /> Export all tenders
        </UiButton>
      </template>
    </PageHeader>

    <!-- Filters in one row above the charts. -->
    <div class="mb-6 flex flex-wrap items-end gap-3">
      <div
        class="inline-flex rounded-lg bg-gray-100 p-1 dark:bg-white/5"
        role="group"
        aria-label="Period"
      >
        <button
          v-for="p in presets"
          :key="p.key"
          type="button"
          :class="[
            'rounded-md px-3 py-1.5 text-theme-sm font-medium',
            preset === p.key
              ? 'bg-white text-gray-900 shadow-theme-xs dark:bg-gray-800 dark:text-white'
              : 'text-gray-500 dark:text-gray-400',
          ]"
          :aria-pressed="preset === p.key"
          @click="preset = p.key"
        >
          {{ p.label }}
        </button>
      </div>
      <label class="text-theme-xs text-gray-500 dark:text-gray-400">
        From
        <input v-model="from" type="date" class="form-field mt-1 h-9" @change="preset = 'custom'" />
      </label>
      <label class="text-theme-xs text-gray-500 dark:text-gray-400">
        To
        <input v-model="to" type="date" class="form-field mt-1 h-9" @change="preset = 'custom'" />
      </label>
    </div>

    <UiAlert v-if="error" class="mb-4">{{ error }}</UiAlert>

    <template v-if="data">
      <div class="grid grid-cols-2 gap-4 md:gap-6 xl:grid-cols-5" :class="loading && 'opacity-60'">
        <div
          v-for="k in kpis"
          :key="k.label"
          class="rounded-md border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]"
        >
          <p class="text-sm text-gray-500 dark:text-gray-400">{{ k.label }}</p>
          <p class="mt-2 text-title-sm font-bold text-gray-800 tabular-nums dark:text-white/90">
            {{ k.value }}
          </p>
          <p v-if="k.hint" class="mt-1 truncate text-theme-xs text-gray-500 dark:text-gray-400">
            {{ k.hint }}
          </p>
        </div>
      </div>

      <div class="mt-4 flex flex-wrap gap-3 text-theme-sm">
        <RouterLink
          v-if="canTickets"
          to="/tickets"
          class="rounded-full bg-gray-100 px-3 py-1 text-gray-700 hover:bg-gray-200 dark:bg-white/5 dark:text-gray-300"
        >
          {{ data.openTickets }} open service ticket(s)
        </RouterLink>
        <RouterLink
          to="/assets?warranty=expiring_30"
          class="rounded-full bg-gray-100 px-3 py-1 text-gray-700 hover:bg-gray-200 dark:bg-white/5 dark:text-gray-300"
        >
          {{ data.warrantiesEndingSoon }} warranty(ies) ending in the next 90 days
        </RouterLink>
      </div>

      <section
        class="mt-6 rounded-md border border-gray-200 bg-white p-5 md:p-6 dark:border-gray-800 dark:bg-white/[0.03]"
      >
        <h2 class="mb-4 text-base font-semibold text-gray-800 dark:text-white/90">
          Bids per month
        </h2>
        <MonthlyChart :rows="data.monthly" />
        <details class="mt-4">
          <summary class="cursor-pointer text-theme-sm font-medium text-brand-500">
            Show as a table
          </summary>
          <div class="custom-scrollbar mt-3 overflow-x-auto">
            <table class="min-w-full text-theme-sm">
              <thead
                class="bg-gray-50 text-left text-sm text-gray-800 dark:bg-gray-800 dark:text-white/90"
              >
                <tr>
                  <th class="py-2 pr-4 font-medium">Month</th>
                  <th class="py-2 pr-4 text-right font-medium">Added</th>
                  <th class="py-2 pr-4 text-right font-medium">Submitted</th>
                  <th class="py-2 pr-4 text-right font-medium">Won</th>
                  <th class="py-2 pr-4 text-right font-medium">Lost</th>
                  <th class="py-2 text-right font-medium">Won value</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-100 tabular-nums dark:divide-gray-800">
                <tr
                  v-for="r in data.monthly"
                  :key="r.month"
                  class="text-gray-700 dark:text-gray-300"
                >
                  <td class="py-2 pr-4">
                    {{ monthLong.format(new Date(`${r.month}-01T00:00:00Z`)) }}
                  </td>
                  <td class="py-2 pr-4 text-right">{{ r.added }}</td>
                  <td class="py-2 pr-4 text-right">{{ r.submitted }}</td>
                  <td class="py-2 pr-4 text-right">{{ r.won }}</td>
                  <td class="py-2 pr-4 text-right">{{ r.lost }}</td>
                  <td class="py-2 text-right">{{ formatINR(r.wonValue) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </details>
      </section>

      <section
        class="mt-6 rounded-md border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]"
      >
        <h2 class="px-5 pt-5 text-base font-semibold text-gray-800 sm:px-6 dark:text-white/90">
          Agent performance
        </h2>
        <p class="px-5 text-theme-sm text-gray-500 sm:px-6 dark:text-gray-400">
          Tenders assigned in this period, by where they are now.
        </p>
        <div class="custom-scrollbar mt-3 overflow-x-auto">
          <table v-if="data.agents.length" class="min-w-full">
            <thead
              class="border-b border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-800"
            >
              <tr class="text-left text-sm font-medium text-gray-800 dark:text-white/90">
                <th class="px-5 py-3 sm:px-6">Agent</th>
                <th class="px-5 py-3 text-right">Assigned</th>
                <th class="px-5 py-3 text-right">In progress</th>
                <th class="px-5 py-3 text-right">Submitted</th>
                <th class="px-5 py-3 text-right">Won</th>
                <th class="px-5 py-3 text-right">Lost</th>
                <th class="px-5 py-3 text-right">Win rate</th>
                <th class="px-5 py-3 text-right">Won value</th>
              </tr>
            </thead>
            <tbody
              class="divide-y divide-gray-100 text-theme-sm text-gray-700 tabular-nums dark:divide-gray-800 dark:text-gray-300"
            >
              <tr v-for="a in data.agents" :key="a.agent.id">
                <td class="px-5 py-3 font-medium text-gray-800 sm:px-6 dark:text-white/90">
                  {{ a.agent.name }}
                </td>
                <td class="px-5 py-3 text-right">{{ a.assigned }}</td>
                <td class="px-5 py-3 text-right">{{ a.inProgress }}</td>
                <td class="px-5 py-3 text-right">{{ a.submitted }}</td>
                <td class="px-5 py-3 text-right">{{ a.won }}</td>
                <td class="px-5 py-3 text-right">{{ a.lost }}</td>
                <td class="px-5 py-3 text-right">{{ pct(a.winRate) }}</td>
                <td class="px-5 py-3 text-right whitespace-nowrap">{{ formatINR(a.wonValue) }}</td>
              </tr>
            </tbody>
          </table>
          <p v-else class="px-5 pb-6 text-theme-sm text-gray-500 sm:px-6">
            No tenders were assigned in this period.
          </p>
        </div>
      </section>
    </template>
    <p v-else-if="!error" class="text-sm text-gray-500">Loading…</p>
  </div>
</template>
