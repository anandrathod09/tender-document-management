<script setup lang="ts">
import {
  ExternalLink,
  FileSpreadsheet,
  Mail,
  Phone,
  RefreshCw,
  Search,
  Tag,
  Upload,
  X,
} from 'lucide-vue-next'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { StageSummary, TenderPage, TenderSummary } from '@tdm/shared'
import { PERMISSIONS } from '@tdm/shared/permissions'
import DeadlineCell from '@/components/DeadlineCell.vue'
import StageBadge from '@/components/StageBadge.vue'
import { ACTION_ICONS } from '@/components/ui/actions'
import DataTable from '@/components/ui/DataTable.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import IconButton from '@/components/ui/IconButton.vue'
import type { TableColumn } from '@/components/ui/table'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiBadge from '@/components/ui/UiBadge.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiCard from '@/components/ui/UiCard.vue'
import UiPagination from '@/components/ui/UiPagination.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import { vTooltip } from '@/directives/tooltip'
import { api, errorMessage } from '@/services/api'
import { downloadFromApi } from '@/services/files'
import { useAuthStore } from '@/stores/auth'
import { useWorkflowStore } from '@/stores/workflow'
import { formatDate } from '@/utils/format'
import { daysUntil, formatINR, formatINRShort } from '@/utils/tenders'
import AssignTendersDialog from './AssignTendersDialog.vue'
import type { MoveMode } from './move-mode'
import MoveTendersDialog from './MoveTendersDialog.vue'
import { useMoveRules } from './move-rules'

/** Rows per page, as offered by the original TMS. */
const PAGE_SIZES = [5, 10, 20, 50]
const DEFAULT_PAGE_SIZE = 20

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const workflow = useWorkflowStore()

const canViewAll = auth.can(PERMISSIONS.TENDER_VIEW_ALL)
const canImport = auth.can(PERMISSIONS.TENDER_IMPORT)
const canExport = auth.can(PERMISSIONS.REPORT_EXPORT)
const canAssign = auth.can(PERMISSIONS.TENDER_ASSIGN)
const canMove = auth.can(PERMISSIONS.TENDER_MOVE_STAGE)

const page = ref<TenderPage | null>(null)
const loading = ref(false)
const error = ref('')
const notice = ref('')
const selected = ref<string[]>([])

// Filters live in the URL so a filtered list can be bookmarked or shared.
const stageId = computed(() => (typeof route.query.stage === 'string' ? route.query.stage : ''))
const q = ref(typeof route.query.q === 'string' ? route.query.q : '')
const assignedTo = computed(() =>
  typeof route.query.assigned === 'string' ? route.query.assigned : '',
)
const sort = computed({
  get: () => (typeof route.query.sort === 'string' ? route.query.sort : 'deadline'),
  set: (value: string) => setQuery({ sort: value === 'deadline' ? undefined : value }),
})
const pageNo = computed(() => Math.max(1, Number(route.query.page) || 1))
const pageSize = computed(() => {
  const n = Number(route.query.size)
  return PAGE_SIZES.includes(n) ? n : DEFAULT_PAGE_SIZE
})
const stageType = computed(() => (typeof route.query.type === 'string' ? route.query.type : ''))
const stage = computed(() => (stageId.value ? workflow.byId.get(stageId.value) : undefined))
const title = computed(
  () =>
    stage.value?.label ??
    (stageType.value && typeof route.query.title === 'string' ? route.query.title : 'All tenders'),
)
const cardTitle = computed(() =>
  stage.value?.systemRole === 'intake'
    ? `${stage.value.label} Tender List (Unassigned)`
    : `${title.value === 'All tenders' ? 'All' : title.value} Tender List`,
)

function filters(): Record<string, string> {
  const params: Record<string, string> = { sort: sort.value }
  if (stageId.value) params.stageId = stageId.value
  if (stageType.value) params.stageType = stageType.value
  if (route.query.q) params.q = String(route.query.q)
  if (assignedTo.value) params.assignedTo = assignedTo.value
  return params
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const params = { ...filters(), page: pageNo.value, pageSize: pageSize.value }
    page.value = (await api.get<TenderPage>('/tenders', { params })).data
    // Keep only selections that are still on screen.
    const here = new Set(page.value.items.map((t) => t.id))
    selected.value = selected.value.filter((id) => here.has(id))
  } catch (err) {
    error.value = errorMessage(err)
  } finally {
    loading.value = false
  }
}

watch(
  () => route.fullPath,
  () => {
    selected.value = []
    void load()
  },
)
onMounted(() => {
  void load()
  workflow.load().catch(() => undefined)
})

function setQuery(changes: Record<string, string | undefined>) {
  const query = { ...route.query, ...changes }
  for (const k of Object.keys(query)) if (!query[k]) delete query[k]
  if (!('page' in changes)) delete query.page
  void router.replace({ query })
}

let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(q, (value) => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => setQuery({ q: value.trim() || undefined }), 350)
})

/** Downloads the list as shown: same stage, search, assignee and order. */
async function exportXlsx() {
  error.value = ''
  try {
    await downloadFromApi('/reports/export/tenders.xlsx', filters(), 'Tenders.xlsx')
  } catch (err) {
    error.value = errorMessage(err)
  }
}

function refresh() {
  void load()
  workflow.refreshCounts().catch(() => undefined)
}

// ---------------------------------------------------------------------------
// Table: the columns of the original TMS list. Assignee columns appear once
// tenders are being worked on; Watchlist and Rejected show when they got there.
// ---------------------------------------------------------------------------

const showAssignee = computed(() => stage.value?.type !== 'open')
const sinceLabel = computed(() => {
  const key = stage.value ? workflow.byId.get(stage.value.id)?.key : undefined
  if (key === 'watchlist') return `Added to ${stage.value!.label}`
  if (key === 'rejected') return 'Rejected On'
  if (stage.value?.type === 'closed') return `${stage.value.label} On`
  return ''
})
// Closed stages (Completed) show the note given when the tender was closed, as in the old TMS.
const showStageComment = computed(() => stage.value?.type === 'closed')

// Installation (Assigned to engineer) and finished (Completed) lists only open the tender, as
// in the old TMS: engineers are assigned in the installation report, and the move to
// Completed is made on the tender page after checking that report.
const viewOnly = computed(() => ['execution', 'closed'].includes(stage.value?.type ?? ''))

// After the win, the old "Engineer Tenders" columns: each consignee and its engineer.
const showInstallation = computed(
  () =>
    ['won', 'execution', 'closed'].includes(stage.value?.type ?? '') ||
    (page.value?.items ?? []).some((t) => t.consignees.length),
)

const columns = computed<TableColumn[]>(() => [
  {
    key: 'referenceNo',
    label: 'Reference No',
    sort: true,
    sticky: true,
    class: 'min-w-40 max-w-44',
  },
  ...(showInstallation.value
    ? ([
        { key: 'consignees', label: 'Consignees', class: 'min-w-40' },
        { key: 'engineers', label: 'Assigned Engineers', class: 'min-w-52' },
      ] as TableColumn[])
    : []),
  { key: 'deadline', label: 'Deadline', sort: true },
  { key: 'sheetType', label: 'Type', sort: true },
  ...(sinceLabel.value
    ? [{ key: 'stageChangedAt', label: sinceLabel.value, sort: true } as TableColumn]
    : []),
  ...(showStageComment.value
    ? [
        {
          key: 'stageComment',
          label: 'Completion Notes',
          class: 'min-w-56 max-w-xs',
        } as TableColumn,
      ]
    : []),
  { key: 'title', label: 'Description', sort: true, class: 'min-w-72 max-w-md' },
  { key: 'buyerOrganization', label: 'Organization', sort: true, class: 'min-w-40 max-w-56' },
  { key: 'location', label: 'Location', sort: true, class: 'min-w-32 max-w-48' },
  { key: 'estimatedCost', label: 'Estimated Cost', sort: true },
  { key: 'stage', label: 'Tender Status', sort: true },
  ...(showAssignee.value
    ? ([
        { key: 'assignedAgent', label: 'Assigned Agent', sort: true, class: 'min-w-48' },
        { key: 'assignedAt', label: 'Assigned Date', sort: true },
      ] as TableColumn[])
    : []),
])

/** Splits a reference after each "/" so long ones wrap there, not mid-number. */
const refParts = (ref: string) => ref.split(/(?<=\/)/)

const recentlyUpdated = (iso: string | null) =>
  !!iso && Date.now() - Date.parse(iso) < 7 * 86_400_000
const expiredInView = computed(
  () => (page.value?.items ?? []).filter((t) => daysUntil(t.deadline) < 0).length,
)

// ---------------------------------------------------------------------------
// Actions: the quick moves follow the client's own stages. Default stages keep
// their key when renamed, so "watchlist" and "rejected" still find them; a
// hidden stage simply has no button.
// ---------------------------------------------------------------------------

const visible = (find: (s: StageSummary) => boolean) => workflow.visibleStages.find(find)
const watchStage = computed(() => visible((s) => s.key === 'watchlist'))
const rejectStage = computed(() => visible((s) => s.key === 'rejected'))
const intakeStage = computed(() => visible((s) => s.systemRole === 'intake'))
const keyOf = (t: TenderSummary) => workflow.byId.get(t.stage.id)?.key
const rules = useMoveRules()
const canGo = (t: TenderSummary, stage: StageSummary | undefined) =>
  !!stage && rules.nextFor(t).some((s) => s.id === stage.id)

type QuickMove = 'watch' | 'unwatch' | 'reject'
function quickMoves(t: TenderSummary): QuickMove[] {
  if (!canMove || t.stage.type !== 'open') return []
  const key = keyOf(t)
  const out: QuickMove[] = []
  if (key !== 'watchlist' && canGo(t, watchStage.value)) out.push('watch')
  if (key === 'watchlist' && canGo(t, intakeStage.value)) out.push('unwatch')
  if (key !== 'rejected' && canGo(t, rejectStage.value)) out.push('reject')
  return out
}

const selectedTenders = computed(() =>
  (page.value?.items ?? []).filter((t) => selected.value.includes(t.id)),
)

const dialog = ref<{
  kind: 'move' | 'assign'
  mode?: MoveMode
  tenders: TenderSummary[]
  stageId?: string
} | null>(null)

function openAssign(list: TenderSummary[]) {
  dialog.value = { kind: 'assign', tenders: list }
}
function openMove(list: TenderSummary[]) {
  dialog.value = { kind: 'move', mode: 'move', tenders: list }
}
function openQuick(kind: QuickMove, list: TenderSummary[]) {
  const target =
    kind === 'watch' ? watchStage.value : kind === 'unwatch' ? intakeStage.value : rejectStage.value
  if (target) dialog.value = { kind: 'move', mode: kind, tenders: list, stageId: target.id }
}
const quickLabel = (kind: QuickMove, many = false) =>
  kind === 'watch'
    ? `Add ${many ? 'selected ' : ''}to ${watchStage.value?.label ?? 'Watchlist'}`
    : kind === 'unwatch'
      ? `Remove ${many ? 'selected ' : ''}from ${watchStage.value?.label ?? 'Watchlist'}`
      : many
        ? 'Reject selected'
        : 'Reject'
const quickIcon = (kind: QuickMove) =>
  kind === 'watch'
    ? ACTION_ICONS.watchlist
    : kind === 'unwatch'
      ? ACTION_ICONS.unwatch
      : ACTION_ICONS.reject

// Bulk buttons only offer what makes sense for every selected tender.
const bulkQuick = computed<QuickMove[]>(() => {
  const list = selectedTenders.value
  if (!list.length) return []
  return (['watch', 'unwatch', 'reject'] as QuickMove[]).filter((k) =>
    list.every((t) => quickMoves(t).includes(k)),
  )
})

let noticeTimer: ReturnType<typeof setTimeout> | undefined
function done(message: string) {
  dialog.value = null
  selected.value = []
  notice.value = message
  clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => (notice.value = ''), 5000)
  refresh()
}
onBeforeUnmount(() => {
  clearTimeout(noticeTimer)
  clearTimeout(searchTimer)
})
</script>

<template>
  <div>
    <UiAlert v-if="error" class="mb-4">
      {{ error }}
      <button type="button" class="ml-2 underline" @click="refresh">Retry</button>
    </UiAlert>
    <UiAlert v-if="notice" variant="success" class="mb-4">{{ notice }}</UiAlert>

    <UiCard
      :level="1"
      :title="cardTitle"
      :subtitle="page ? `${page.total} tender${page.total === 1 ? '' : 's'}` : undefined"
      :icon="Tag"
    >
      <template #header>
        <label class="relative w-full sm:w-64">
          <span class="sr-only">Search tenders</span>
          <Search
            class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-gray-400"
            aria-hidden="true"
          />
          <input
            v-model="q"
            type="search"
            :placeholder="
              showInstallation ? 'Search by tender, consignee, engineer...' : 'Search tenders...'
            "
            class="form-field h-9! py-1! pl-9! text-sm!"
          />
        </label>
        <UiSelect
          v-if="canViewAll"
          :model-value="assignedTo"
          aria-label="Filter by assignee"
          size="sm"
          fit
          :options="[
            { value: '', label: 'Anyone' },
            { value: 'me', label: 'Assigned to me' },
            { value: 'none', label: 'Unassigned' },
          ]"
          @update:model-value="(v) => setQuery({ assigned: v || undefined })"
        />

        <template v-if="selected.length">
          <IconButton
            v-for="k in bulkQuick"
            :key="k"
            :icon="quickIcon(k)"
            :label="quickLabel(k, true)"
            :variant="k === 'reject' ? 'danger' : 'primary'"
            @click="openQuick(k, selectedTenders)"
          />
          <IconButton
            v-if="canAssign"
            :icon="ACTION_ICONS.assign"
            label="Assign selected"
            variant="primary"
            @click="openAssign(selectedTenders)"
          />
          <IconButton
            v-if="canMove && rules.commonNext(selectedTenders).length"
            :icon="ACTION_ICONS.move"
            label="Move selected to another stage"
            variant="primary"
            @click="openMove(selectedTenders)"
          />
        </template>
        <IconButton
          v-if="canExport"
          :icon="FileSpreadsheet"
          label="Export to Excel"
          variant="primary"
          @click="exportXlsx"
        />
        <IconButton
          v-if="canImport"
          :icon="Upload"
          label="Upload Tenders"
          variant="primary"
          to="/tenders/import"
        />
        <IconButton
          :icon="RefreshCw"
          label="Refresh"
          variant="primary"
          :loading="loading"
          @click="refresh"
        />
      </template>

      <div
        v-if="selected.length"
        class="mb-3 flex flex-wrap items-center gap-3 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300"
        role="status"
      >
        <span class="font-medium">
          {{ selected.length }} tender{{ selected.length === 1 ? '' : 's' }} selected
        </span>
        <span class="text-xs">Use the buttons at the top right to act on all of them.</span>
        <UiButton size="xs" variant="ghost" class="ml-auto h-7!" @click="selected = []">
          <X class="size-4" aria-hidden="true" /> Clear
        </UiButton>
      </div>

      <DataTable
        v-model:sort="sort"
        v-model:selected="selected"
        :columns="columns"
        :rows="page?.items ?? []"
        :loading="loading"
        :selectable="!viewOnly && (canAssign || canMove)"
        :row-label="(t) => t.referenceNo"
        scroll-height="max(450px, calc(100vh - 380px))"
        loading-text="Loading tenders..."
      >
        <template #cell-referenceNo="{ row }">
          <div class="flex flex-col text-xs">
            <a
              v-if="row.briefUrl"
              v-tooltip="'Open on Tender247'"
              :href="row.briefUrl"
              target="_blank"
              rel="noopener noreferrer"
              class="inline-flex items-start gap-1 font-medium break-all text-gray-800 hover:underline dark:text-white/90"
            >
              <span
                ><template v-for="(part, i) in refParts(row.referenceNo)" :key="i"
                  >{{ part }}<wbr /></template
              ></span>
              <ExternalLink class="mt-0.5 size-3 shrink-0 text-green-600" aria-hidden="true" />
            </a>
            <span v-else class="font-medium break-all text-gray-800 dark:text-white/90">
              <template v-for="(part, i) in refParts(row.referenceNo)" :key="i"
                >{{ part }}<wbr
              /></template>
            </span>
            <span v-if="row.sourceTenderId" class="break-all text-gray-500 dark:text-gray-400">
              {{ row.sourceTenderId }}
            </span>
            <UiBadge
              v-if="recentlyUpdated(row.excelUpdatedAt)"
              color="warning"
              class="mt-1 self-start"
            >
              Updated from Excel
            </UiBadge>
          </div>
        </template>

        <template #cell-deadline="{ row }">
          <DeadlineCell :deadline="row.deadline" />
        </template>

        <template #cell-sheetType="{ row }">
          <UiBadge :color="row.sheetType === 'gem' ? 'success' : 'info'">
            {{ row.sheetType === 'gem' ? 'GeM' : 'Non-GeM' }}
          </UiBadge>
        </template>

        <template #cell-stageComment="{ row }">
          <p
            v-if="row.stageComment"
            class="line-clamp-3 text-xs whitespace-pre-line"
            :title="row.stageComment"
          >
            {{ row.stageComment }}
          </p>
          <span v-else class="text-xs text-gray-400">—</span>
        </template>

        <template #cell-stageChangedAt="{ row }">
          <span class="text-xs whitespace-nowrap">{{ formatDate(row.stageChangedAt) }}</span>
        </template>

        <template #cell-title="{ row }">
          <p v-tooltip.wide="row.title" class="line-clamp-2 cursor-help text-xs">
            {{ row.title }}
          </p>
        </template>

        <template #cell-buyerOrganization="{ row }">
          <p class="line-clamp-2 text-xs">{{ row.buyerOrganization ?? '—' }}</p>
        </template>

        <template #cell-location="{ row }">
          <p class="line-clamp-2 text-xs">{{ row.location ?? '—' }}</p>
        </template>

        <template #cell-estimatedCost="{ row }">
          <span
            v-tooltip="row.estimatedCost ? formatINR(row.estimatedCost) : null"
            class="font-medium whitespace-nowrap"
          >
            {{ formatINRShort(row.estimatedCost) }}
          </span>
        </template>

        <template #cell-stage="{ row }">
          <StageBadge :label="row.stage.label" :color="row.stage.color" />
        </template>

        <template #cell-assignedAgent="{ row }">
          <div v-if="row.assignedAgent" class="flex flex-col gap-1 text-xs">
            <span class="font-medium">{{ row.assignedAgent.name }}</span>
            <a
              :href="`mailto:${row.assignedAgent.email}`"
              class="flex items-center gap-1 text-gray-600 hover:text-blue-600 hover:underline dark:text-gray-400"
            >
              <Mail class="size-4 shrink-0" aria-hidden="true" />
              <span class="truncate">{{ row.assignedAgent.email }}</span>
            </a>
            <a
              v-if="row.assignedAgent.phone"
              :href="`tel:${row.assignedAgent.phone}`"
              class="flex items-center gap-1 text-gray-600 hover:text-green-600 hover:underline dark:text-gray-400"
            >
              <Phone class="size-4 shrink-0" aria-hidden="true" />
              {{ row.assignedAgent.phone }}
            </a>
          </div>
          <span v-else class="text-xs">Not Assigned</span>
        </template>

        <template #cell-consignees="{ row }">
          <ul v-if="row.consignees.length" class="space-y-3 text-xs">
            <li
              v-for="c in row.consignees"
              :key="c.id"
              class="border-b border-gray-100 pb-3 last:border-0 last:pb-0 dark:border-gray-800"
            >
              <span class="block font-medium">{{ c.name }}</span>
              <span v-if="c.designation" class="block text-gray-500 dark:text-gray-400"
                >({{ c.designation }})</span
              >
            </li>
          </ul>
          <span v-else class="text-xs text-gray-400">No consignees assigned</span>
        </template>

        <template #cell-engineers="{ row }">
          <ul v-if="row.consignees.length" class="space-y-3 text-xs">
            <li
              v-for="c in row.consignees"
              :key="c.id"
              class="flex flex-col gap-1 border-b border-gray-100 pb-3 last:border-0 last:pb-0 dark:border-gray-800"
            >
              <span class="font-medium">{{ c.engineer?.name ?? 'Not Assigned' }}</span>
              <a
                v-if="c.engineer?.email"
                :href="`mailto:${c.engineer.email}`"
                class="flex items-center gap-1 text-gray-600 hover:text-blue-600 hover:underline dark:text-gray-400"
              >
                <Mail class="size-4 shrink-0" aria-hidden="true" />
                <span class="truncate">{{ c.engineer.email }}</span>
              </a>
              <a
                v-if="c.engineer?.phone"
                :href="`tel:${c.engineer.phone}`"
                class="flex items-center gap-1 text-gray-600 hover:text-green-600 hover:underline dark:text-gray-400"
              >
                <Phone class="size-4 shrink-0" aria-hidden="true" />
                {{ c.engineer.phone }}
              </a>
            </li>
          </ul>
          <span v-else class="text-xs text-gray-400">No consignees assigned</span>
        </template>

        <template #cell-assignedAt="{ row }">
          <span class="text-xs whitespace-nowrap">
            {{ row.assignedAt ? formatDate(row.assignedAt) : 'N/A' }}
          </span>
        </template>

        <template #actions="{ row }">
          <IconButton :icon="ACTION_ICONS.view" label="View Details" :to="`/tenders/${row.id}`" />
          <template v-if="!viewOnly">
            <IconButton
              v-if="canAssign"
              :icon="ACTION_ICONS.assign"
              :label="row.assignedAgent ? `Change assignee (${row.assignedAgent.name})` : 'Assign'"
              :disabled="selected.length > 0"
              @click="openAssign([row])"
            />
            <template v-if="quickMoves(row).length">
              <IconButton
                v-for="k in quickMoves(row)"
                :key="k"
                :icon="quickIcon(k)"
                :label="quickLabel(k)"
                :variant="k === 'reject' ? 'danger' : 'default'"
                :disabled="selected.length > 0"
                @click="openQuick(k, [row])"
              />
            </template>
            <IconButton
              v-else-if="canMove && rules.nextFor(row).length"
              :icon="ACTION_ICONS.move"
              label="Move to another stage"
              :disabled="selected.length > 0"
              @click="openMove([row])"
            />
          </template>
        </template>

        <template #empty>
          <EmptyState
            :title="
              route.query.q
                ? 'No matching tenders'
                : stage?.systemRole === 'intake'
                  ? 'All tenders have been assigned or processed'
                  : 'No tenders here yet'
            "
            :description="route.query.q ? 'Try a different search.' : undefined"
          >
            <UiButton
              v-if="canImport && !route.query.q"
              size="sm"
              @click="router.push('/tenders/import')"
            >
              <Upload class="size-4" aria-hidden="true" /> Upload Tenders
            </UiButton>
          </EmptyState>
        </template>
      </DataTable>

      <template v-if="page && page.total > 0" #footer>
        <UiPagination
          :page="page.page"
          :page-size="page.pageSize"
          :total="page.total"
          :shown="page.items.length"
          :page-sizes="PAGE_SIZES"
          noun="tenders"
          @change="(p) => setQuery({ page: String(p) })"
          @page-size="(n) => setQuery({ size: n === DEFAULT_PAGE_SIZE ? undefined : String(n) })"
        >
          <template #extra>
            <span v-if="expiredInView" class="ml-2 text-yellow-600">
              ({{ expiredInView }} expired in view)
            </span>
          </template>
        </UiPagination>
      </template>
    </UiCard>

    <MoveTendersDialog
      :open="dialog?.kind === 'move'"
      :tenders="dialog?.tenders ?? []"
      :mode="dialog?.mode ?? 'move'"
      :stage-id="dialog?.stageId"
      @close="dialog = null"
      @done="done"
    />
    <AssignTendersDialog
      :open="dialog?.kind === 'assign'"
      :tenders="dialog?.tenders ?? []"
      @close="dialog = null"
      @done="done"
    />
  </div>
</template>
