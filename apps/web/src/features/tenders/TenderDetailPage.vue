<script setup lang="ts">
import { ArrowLeft, ExternalLink, History, RefreshCw } from 'lucide-vue-next'
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import type { CompanySummary, FileSummary, TenderDetail } from '@tdm/shared'
import { PERMISSIONS } from '@tdm/shared/permissions'
import StageBadge from '@/components/StageBadge.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiBadge from '@/components/ui/UiBadge.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiCard from '@/components/ui/UiCard.vue'
import { api, errorMessage } from '@/services/api'
import { useAuthStore } from '@/stores/auth'
import { useWorkflowStore } from '@/stores/workflow'
import { formatDateTime } from '@/utils/format'
import { deadlineHint, formatDeadline, formatINR } from '@/utils/tenders'
import AssignPanel from './AssignPanel.vue'
import CompanyPanel from './CompanyPanel.vue'
import CompliancePanel from './CompliancePanel.vue'
import DocumentsPanel from './DocumentsPanel.vue'
import InstallationPanel from './InstallationPanel.vue'
import MovePanel from './MovePanel.vue'

/**
 * Tender page laid out as in the original TMS: header card, overview and
 * documents on the left; assignment, status and audit trail on the right.
 */
const route = useRoute()
const auth = useAuthStore()
const workflow = useWorkflowStore()
const id = route.params.id as string

const tender = ref<TenderDetail | null>(null)
const loadError = ref('')
const refreshing = ref(false)
const companies = ref<CompanySummary[]>([])
const tenderDocs = ref<FileSummary[]>([])

async function loadTender() {
  refreshing.value = true
  try {
    tender.value = (await api.get<TenderDetail>(`/tenders/${id}`)).data
    loadError.value = ''
  } catch (err) {
    loadError.value = errorMessage(err)
  } finally {
    refreshing.value = false
  }
}

onMounted(async () => {
  await loadTender()
  workflow.load().catch(() => undefined)
  api
    .get<CompanySummary[]>('/companies')
    .then((r) => (companies.value = r.data))
    .catch(() => undefined)
})

function onChanged(updated: TenderDetail) {
  tender.value = updated
  void workflow.refreshCounts()
}

const facts = computed(() => {
  const t = tender.value
  if (!t) return []
  return [
    { label: 'Organization', value: t.buyerOrganization ?? 'N/A' },
    { label: 'Location', value: t.location ?? 'N/A' },
    { label: 'Estimated Cost', value: formatINR(t.estimatedCost) },
    { label: 'Document Fees', value: formatINR(t.documentFee) },
    { label: 'EMD Amount', value: formatINR(t.emd) },
    { label: 'Quantity / Scope', value: t.quantity ?? '—' },
    { label: 'MSME Exemption', value: t.msmeExemption ?? '—' },
    { label: 'Startup Exemption', value: t.startupExemption ?? '—' },
    ...(t.awardAmount !== null
      ? [
          { label: 'Award Amount', value: formatINR(t.awardAmount) },
          { label: 'Award / PO Number', value: t.awardNumber ?? '—' },
        ]
      : []),
  ]
})

const longTexts = computed(() => {
  const t = tender.value
  if (!t) return []
  return [
    { label: 'Eligibility Criteria', value: t.eligibilityCriteria },
    { label: 'Checklist', value: t.checklist },
    { label: 'Documents Required from Seller', value: t.documentsRequired },
  ].filter((x) => x.value)
})

const deadlineTone = (date: string) => {
  const tone = deadlineHint(date).tone
  if (tone === 'past') return 'text-red-600'
  if (tone === 'normal') return 'text-green-600'
  return 'text-orange-600'
}

const formatChange = (v: string | number | null | undefined, field: string) => {
  if (v === null || v === undefined || v === '') return 'empty'
  if (field === 'deadline' && typeof v === 'string') return formatDeadline(v)
  if (typeof v === 'number') return formatINR(v)
  return String(v)
}

const heading = 'text-sm font-semibold tracking-wider text-gray-700 uppercase dark:text-gray-300'
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <nav class="flex flex-wrap items-center gap-2 text-sm" aria-label="Breadcrumb">
        <RouterLink
          :to="tender ? `/tenders?stage=${tender.stage.id}` : '/tenders'"
          class="flex items-center gap-2 text-gray-600 transition-colors hover:text-blue-600 dark:text-gray-400 dark:hover:text-blue-400"
        >
          <ArrowLeft class="size-4" aria-hidden="true" />
          Back to {{ tender?.stage.label ?? 'Tenders' }}
        </RouterLink>
        <span class="text-gray-400">/</span>
        <span class="text-gray-800 dark:text-gray-300">Tender Details</span>
        <template v-if="tender">
          <span class="text-gray-400">/</span>
          <span class="font-medium text-blue-600 dark:text-blue-400">
            {{ tender.sourceTenderId ?? tender.referenceNo }}
          </span>
        </template>
      </nav>
      <UiButton size="sm" variant="secondary" :loading="refreshing" @click="loadTender">
        <RefreshCw v-if="!refreshing" class="size-4" aria-hidden="true" /> Refresh
      </UiButton>
    </div>

    <UiAlert v-if="loadError">{{ loadError }}</UiAlert>

    <template v-if="tender">
      <!-- Header -->
      <UiCard>
        <div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div class="min-w-0 flex-1">
            <h1 class="mb-2 text-xl text-gray-800 sm:text-2xl dark:text-white/90">
              {{ tender.buyerOrganization ?? tender.title }}
            </h1>
            <dl class="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <div class="flex items-center gap-2">
                <dt class="font-medium text-gray-600 dark:text-gray-400">Reference No:</dt>
                <dd class="font-semibold break-all text-blue-600 dark:text-blue-400">
                  {{ tender.referenceNo }}
                </dd>
              </div>
              <div v-if="tender.sourceTenderId" class="flex items-center gap-2">
                <dt class="font-medium text-gray-600 dark:text-gray-400">T247 ID:</dt>
                <dd class="font-semibold text-blue-600 dark:text-blue-400">
                  {{ tender.sourceTenderId }}
                </dd>
              </div>
              <div class="flex items-center gap-2">
                <dt class="font-medium text-gray-600 dark:text-gray-400">Deadline:</dt>
                <dd :class="['font-medium', deadlineTone(tender.deadline)]">
                  {{ formatDeadline(tender.deadline) }} ({{ deadlineHint(tender.deadline).text }})
                </dd>
              </div>
            </dl>
            <dl class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <div class="flex items-center gap-2">
                <dt class="font-medium text-gray-600 dark:text-gray-400">Estimated Cost:</dt>
                <dd class="font-semibold text-gray-800 dark:text-gray-300">
                  {{ formatINR(tender.estimatedCost) }}
                </dd>
              </div>
              <div class="flex items-center gap-2">
                <dt class="font-medium text-gray-600 dark:text-gray-400">MSME Exemption:</dt>
                <dd class="font-semibold text-gray-800 dark:text-gray-300">
                  {{ tender.msmeExemption ?? '—' }}
                </dd>
              </div>
              <div class="flex items-center gap-2">
                <dt class="font-medium text-gray-600 dark:text-gray-400">EMD Value:</dt>
                <dd class="font-semibold text-gray-800 dark:text-gray-300">
                  {{ formatINR(tender.emd) }}
                </dd>
              </div>
              <div class="flex items-center gap-2">
                <dt class="font-medium text-gray-600 dark:text-gray-400">Document Fees:</dt>
                <dd class="font-semibold text-gray-800 dark:text-gray-300">
                  {{ formatINR(tender.documentFee) }}
                </dd>
              </div>
            </dl>
          </div>
          <div class="flex flex-wrap gap-2">
            <UiBadge :color="tender.sheetType === 'gem' ? 'success' : 'info'">
              {{ tender.sheetType === 'gem' ? 'GeM' : 'Non-GeM' }}
            </UiBadge>
            <StageBadge :label="tender.stage.label" :color="tender.stage.color" />
          </div>
        </div>

        <UiAlert v-if="tender.excelUpdate" variant="warning" class="mt-4">
          <p class="font-medium">
            Updated from Excel on {{ formatDateTime(tender.excelUpdate.at) }}
            <template v-if="tender.excelUpdate.restoredTo">
              · deadline extended, moved back to {{ tender.excelUpdate.restoredTo }}
            </template>
          </p>
          <ul v-if="tender.excelUpdate.changes.length" class="mt-2 space-y-0.5">
            <li v-for="c in tender.excelUpdate.changes" :key="c.field">
              {{ c.label
              }}<template v-if="'from' in c"
                >: {{ formatChange(c.from, c.field) }} → {{ formatChange(c.to, c.field) }}</template
              >
              <template v-else> changed</template>
            </li>
          </ul>
        </UiAlert>
      </UiCard>

      <div class="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <!-- Left: overview and documents -->
        <div class="min-w-0 space-y-6 xl:col-span-2">
          <UiCard title="Tender Overview">
            <div class="space-y-6">
              <section class="space-y-4">
                <h3 :class="heading">Basic Information</h3>
                <dl class="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div v-for="f in facts" :key="f.label">
                    <dt class="mb-1 text-xs text-gray-500 dark:text-gray-400">{{ f.label }}</dt>
                    <dd class="text-sm font-medium break-words text-gray-800 dark:text-white">
                      {{ f.value }}
                    </dd>
                  </div>
                </dl>
              </section>

              <section>
                <div class="mb-3 flex items-center justify-between gap-3">
                  <h3 :class="heading">Tender Brief</h3>
                  <a
                    v-if="tender.briefUrl"
                    :href="tender.briefUrl"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline dark:text-blue-400"
                  >
                    Open tender document
                    <ExternalLink class="size-4 text-green-600" aria-hidden="true" />
                  </a>
                </div>
                <p class="text-sm leading-relaxed text-gray-600 dark:text-gray-400">
                  {{ tender.title }}
                </p>
              </section>

              <section v-for="t in longTexts" :key="t.label">
                <h3 :class="[heading, 'mb-3']">{{ t.label }}</h3>
                <p
                  class="text-sm leading-relaxed whitespace-pre-line text-gray-600 dark:text-gray-400"
                >
                  {{ t.value }}
                </p>
              </section>
            </div>
          </UiCard>

          <DocumentsPanel :tender-id="tender.id" @changed="tenderDocs = $event" />
          <CompliancePanel :tender="tender" :companies="companies" :tender-docs="tenderDocs" />
        </div>

        <!-- Right: who has it, where it is, what happened -->
        <div class="min-w-0 space-y-6">
          <AssignPanel
            :tender="tender"
            :can-assign="auth.can(PERMISSIONS.TENDER_ASSIGN)"
            @assigned="onChanged"
          />
          <MovePanel
            v-if="auth.can(PERMISSIONS.TENDER_MOVE_STAGE)"
            :tender="tender"
            @moved="onChanged"
          />
          <InstallationPanel
            v-if="['won', 'execution', 'closed'].includes(tender.stage.type)"
            :tender="tender"
          />
          <CompanyPanel
            :tender="tender"
            :companies="companies"
            :can-edit="auth.can(PERMISSIONS.TENDER_MOVE_STAGE)"
            @changed="onChanged"
          />

          <UiCard title="Audit Trail" :icon="History">
            <ol class="relative space-y-5 border-l border-gray-200 pl-5 dark:border-gray-800">
              <li v-for="h in tender.history" :key="h.id" class="relative">
                <span
                  class="absolute top-1.5 -left-[25px] size-2.5 rounded-full bg-blue-500 ring-4 ring-white dark:ring-gray-900"
                />
                <p class="text-sm text-gray-800 dark:text-white/90">
                  <template v-if="h.from">{{ h.from.label }} → </template
                  ><strong class="font-medium">{{ h.to.label }}</strong>
                </p>
                <p
                  v-if="h.comment"
                  class="mt-1 rounded-md bg-gray-50 p-2 text-sm whitespace-pre-line text-gray-600 dark:bg-white/5 dark:text-gray-400"
                >
                  {{ h.comment }}
                </p>
                <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {{ h.changedBy?.name ?? 'System' }} · {{ formatDateTime(h.at) }}
                </p>
              </li>
            </ol>
          </UiCard>
        </div>
      </div>
    </template>

    <div
      v-else-if="!loadError"
      class="flex items-center justify-center gap-2 py-12 text-sm text-gray-700 dark:text-gray-300"
      role="status"
    >
      <span
        class="size-6 animate-spin rounded-full border-2 border-blue-600 border-t-transparent"
        aria-hidden="true"
      />
      Loading tender details...
    </div>
  </div>
</template>
