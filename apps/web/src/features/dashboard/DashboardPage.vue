<script setup lang="ts">
import {
  Bookmark,
  CalendarClock,
  ChartColumn,
  CircleX,
  FileSpreadsheet,
  IndianRupee,
  LayoutDashboard,
  Tag,
  Trophy,
} from 'lucide-vue-next'
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import type { DashboardData, StageSummary, StageType } from '@tdm/shared'
import { PERMISSIONS } from '@tdm/shared/permissions'
import DeadlineCell from '@/components/DeadlineCell.vue'
import StageBadge from '@/components/StageBadge.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiCard from '@/components/ui/UiCard.vue'
import UiStatCard from '@/components/ui/UiStatCard.vue'
import { api, errorMessage } from '@/services/api'
import { useAuthStore } from '@/stores/auth'
import { useWorkflowStore } from '@/stores/workflow'
import { formatDate } from '@/utils/format'
import { formatINRShort } from '@/utils/tenders'
import EngineerDashboard from './EngineerDashboard.vue'

/**
 * Dashboard of the original TMS: notices at the top, then a count card for
 * every stage (grouped as in the old screen) that opens that stage's list.
 */
const auth = useAuthStore()
const workflow = useWorkflowStore()
const router = useRouter()
const data = ref<DashboardData | null>(null)
const error = ref('')
/** Engineers get their own dashboard, "My Assigned Installations", as in the old TMS. */
const engineerView =
  auth.can(PERMISSIONS.INSTALLATION_OWN) &&
  !auth.can(PERMISSIONS.INSTALLATION_MANAGE) &&
  !auth.can(PERMISSIONS.TENDER_VIEW_ALL) &&
  !auth.can(PERMISSIONS.TENDER_MOVE_STAGE)

onMounted(async () => {
  if (engineerView) return
  workflow.load().catch(() => undefined)
  void workflow.refreshCounts().catch(() => undefined)
  try {
    data.value = (await api.get<DashboardData>('/tenders/dashboard')).data
  } catch (err) {
    error.value = errorMessage(err)
  }
})

const count = (s: StageSummary) => workflow.counts[s.id] ?? 0
const stageByKey = (key: string) => workflow.visibleStages.find((s) => s.key === key)
const watch = computed(() => stageByKey('watchlist'))
const rejected = computed(() => stageByKey('rejected'))

const GROUPS: { title: string; types: StageType[]; type: string }[] = [
  { title: 'Tender Overview', types: ['open'], type: 'open' },
  { title: 'Team Pipeline', types: ['preparing'], type: 'preparing' },
  { title: 'Under Review', types: ['review'], type: 'review' },
  { title: 'Outcomes', types: ['submitted', 'won', 'lost', 'dropped'], type: '' },
  { title: 'After the Win', types: ['execution', 'closed'], type: 'execution,closed' },
]
const groups = computed(() =>
  GROUPS.map((g) => {
    const stages = workflow.visibleStages.filter((s) => g.types.includes(s.type))
    return { ...g, stages, total: stages.reduce((n, s) => n + count(s), 0) }
  }).filter((g) => g.stages.length),
)
const percent = (n: number | null) => (n === null ? '—' : `${Math.round(n * 100)}%`)
const canImport = auth.can(PERMISSIONS.TENDER_IMPORT)
</script>

<template>
  <EngineerDashboard v-if="engineerView" />
  <div v-else>
    <PageHeader title="Dashboard" :icon="LayoutDashboard" />
    <UiAlert v-if="error" class="mb-4">{{ error }}</UiAlert>

    <div class="space-y-8">
      <!-- Notices -->
      <div class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div
          v-if="data && data.upcoming.length"
          class="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-500/30 dark:bg-red-500/10"
        >
          <CalendarClock class="mt-0.5 size-8 shrink-0 text-red-400" aria-hidden="true" />
          <div>
            <h3 class="text-sm font-medium text-red-800 dark:text-red-300">Closing This Week</h3>
            <p class="mt-1 text-sm text-red-700 dark:text-red-300">
              <span class="font-medium">{{ data.upcoming.length }}</span> tender(s) close in the
              next 7 days.
            </p>
          </div>
        </div>
        <div
          class="flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-500/30 dark:bg-blue-500/10"
        >
          <FileSpreadsheet class="mt-0.5 size-8 shrink-0 text-blue-400" aria-hidden="true" />
          <div>
            <h3 class="text-sm font-medium text-blue-800 dark:text-blue-300">Last Excel Upload</h3>
            <p class="mt-1 text-sm text-blue-700 dark:text-blue-300">
              <template v-if="data?.lastImport">
                Uploaded on <span class="font-medium">{{ formatDate(data.lastImport.at) }}</span> ·
                {{ data.lastImport.created }} new
              </template>
              <template v-else>No upload yet</template>
            </p>
            <RouterLink
              v-if="canImport"
              to="/tenders/import"
              class="mt-0.5 inline-block text-xs text-blue-600 hover:underline dark:text-blue-400"
            >
              Upload new data →
            </RouterLink>
          </div>
        </div>
        <div
          v-if="rejected && count(rejected) > 0"
          class="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-500/30 dark:bg-amber-500/10"
        >
          <CircleX class="mt-0.5 size-8 shrink-0 text-amber-400" aria-hidden="true" />
          <div>
            <h3 class="text-sm font-medium text-amber-800 dark:text-amber-300">
              {{ rejected.label }} Tenders
            </h3>
            <p class="mt-1 text-sm text-amber-700 dark:text-amber-300">
              <span class="font-medium">{{ count(rejected) }}</span> tender(s) rejected.
            </p>
            <RouterLink
              :to="`/tenders?stage=${rejected.id}`"
              class="mt-0.5 inline-block text-xs font-medium text-amber-700 hover:underline dark:text-amber-300"
            >
              View {{ rejected.label }} Tenders →
            </RouterLink>
          </div>
        </div>
        <div
          v-if="watch && count(watch) > 0"
          class="flex items-start gap-3 rounded-lg border border-purple-200 bg-purple-50 p-4 dark:border-purple-500/30 dark:bg-purple-500/10"
        >
          <Bookmark class="mt-0.5 size-8 shrink-0 text-purple-400" aria-hidden="true" />
          <div>
            <h3 class="text-sm font-medium text-purple-800 dark:text-purple-300">
              {{ watch.label }}
            </h3>
            <p class="mt-1 text-sm text-purple-700 dark:text-purple-300">
              <span class="font-medium">{{ count(watch) }}</span> tender(s) in {{ watch.label }}.
            </p>
            <RouterLink
              :to="`/tenders?stage=${watch.id}`"
              class="mt-0.5 inline-block text-xs font-medium text-purple-700 hover:underline dark:text-purple-300"
            >
              View {{ watch.label }} →
            </RouterLink>
          </div>
        </div>
      </div>

      <!-- A count card for every stage, grouped as in the original dashboard -->
      <section v-for="g in groups" :key="g.title">
        <div class="mb-3 flex items-center justify-between">
          <h2 class="text-base font-semibold text-gray-700 dark:text-gray-200">{{ g.title }}</h2>
          <RouterLink
            v-if="g.type"
            :to="{ path: '/tenders', query: { type: g.type, title: g.title } }"
            class="text-xs font-medium text-blue-600 hover:underline"
          >
            View &amp; Manage →
          </RouterLink>
        </div>
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <UiStatCard
            v-if="g.stages.length > 1"
            :title="`Total ${g.title === 'Tender Overview' ? 'Open' : g.title}`"
            :value="g.total"
            :icon="ChartColumn"
          />
          <RouterLink
            v-for="s in g.stages"
            :key="s.id"
            :to="`/tenders?stage=${s.id}`"
            class="group block rounded-md transition hover:ring-2 hover:ring-blue-400"
          >
            <UiStatCard :title="s.label" :value="count(s)" :icon="Tag" />
          </RouterLink>
          <template v-if="g.title === 'Outcomes' && data">
            <UiStatCard
              title="Total Winning Amount"
              :value="formatINRShort(data.wonValue)"
              :icon="IndianRupee"
            />
            <UiStatCard title="Win Rate" :value="percent(data.winRate)" :icon="Trophy" />
          </template>
        </div>
      </section>

      <!-- Deadlines -->
      <UiCard title="Deadlines in the Next 7 Days" :icon="CalendarClock">
        <template #header>
          <RouterLink to="/tenders" class="text-xs font-medium text-blue-600 hover:underline">
            All tenders →
          </RouterLink>
        </template>
        <div v-if="data" class="custom-scrollbar overflow-x-auto">
          <table v-if="data.upcoming.length" class="min-w-full">
            <tbody class="divide-y divide-gray-200 dark:divide-gray-800">
              <tr
                v-for="t in data.upcoming"
                :key="t.id"
                class="cursor-pointer hover:bg-gray-50 dark:hover:bg-white/[0.02]"
                @click="router.push(`/tenders/${t.id}`)"
              >
                <td class="max-w-md py-2 pr-4">
                  <p class="line-clamp-1 text-sm font-medium text-gray-800 dark:text-white/90">
                    {{ t.title }}
                  </p>
                  <p class="text-xs text-gray-500 dark:text-gray-400">{{ t.referenceNo }}</p>
                </td>
                <td class="px-4 py-2">
                  <StageBadge :label="t.stage.label" :color="t.stage.color" />
                </td>
                <td class="px-4 py-2 text-sm font-medium whitespace-nowrap">
                  {{ formatINRShort(t.estimatedCost) }}
                </td>
                <td class="py-2 pl-4"><DeadlineCell :deadline="t.deadline" /></td>
              </tr>
            </tbody>
          </table>
          <EmptyState
            v-else
            :icon="CalendarClock"
            title="No deadlines this week"
            description="Open and in-progress tenders due in the next 7 days show here."
          />
        </div>
      </UiCard>
    </div>
  </div>
</template>
