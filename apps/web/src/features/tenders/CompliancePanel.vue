<script setup lang="ts">
import { AlertTriangle, FileStack, LoaderCircle } from 'lucide-vue-next'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { CompanySummary, CompliancePackSummary, FileSummary, TenderDetail } from '@tdm/shared'
import { ACTION_ICONS } from '@/components/ui/actions'
import IconButton from '@/components/ui/IconButton.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiCard from '@/components/ui/UiCard.vue'
import UiButton from '@/components/ui/UiButton.vue'
import { api, errorMessage } from '@/services/api'
import { downloadFile, formatBytes, openFile } from '@/services/files'
import { formatDateTime } from '@/utils/format'
import ComplianceModal from './ComplianceModal.vue'

const props = defineProps<{
  tender: TenderDetail
  companies: CompanySummary[]
  tenderDocs: FileSummary[]
}>()

const packs = ref<CompliancePackSummary[]>([])
const error = ref('')
const modalOpen = ref(false)
let poll: ReturnType<typeof setInterval> | undefined

const building = computed(() => packs.value.some((p) => p.status === 'queued'))

async function load() {
  try {
    packs.value = (
      await api.get<CompliancePackSummary[]>(`/tenders/${props.tender.id}/compliance-packs`)
    ).data
  } catch (err) {
    error.value = errorMessage(err)
  }
  // Check every few seconds while a PDF is being built.
  if (building.value && !poll) poll = setInterval(() => void load(), 3000)
  if (!building.value && poll) {
    clearInterval(poll)
    poll = undefined
  }
}
onMounted(load)
onBeforeUnmount(() => clearInterval(poll))

function onRequested(pack: CompliancePackSummary) {
  modalOpen.value = false
  packs.value = [pack, ...packs.value]
  void load()
}

const act = (fn: () => Promise<void>) => fn().catch((err) => (error.value = errorMessage(err)))
</script>

<template>
  <UiCard title="Compliance Documents">
    <template #header>
      <UiButton size="xs" :disabled="!companies.some((c) => c.isActive)" @click="modalOpen = true">
        <FileStack class="size-4" aria-hidden="true" /> Generate PDF
      </UiButton>
    </template>
    <p class="mb-4 text-theme-sm text-gray-500 dark:text-gray-400">
      Declaration letters on your company letterhead, signed, followed by the certificates and
      documents you choose, in one PDF.
    </p>
    <UiAlert v-if="!companies.some((c) => c.isActive)" variant="info" class="mb-3">
      Add a bidding company with its logo and signature first (Manage → Bidding companies).
    </UiAlert>
    <UiAlert v-if="error" class="mb-3">{{ error }}</UiAlert>

    <ul v-if="packs.length" class="divide-y divide-gray-100 dark:divide-gray-800">
      <li v-for="p in packs" :key="p.id" class="py-3">
        <div class="flex items-center gap-3">
          <LoaderCircle
            v-if="p.status === 'queued'"
            class="size-5 shrink-0 animate-spin text-brand-500"
            aria-hidden="true"
          />
          <AlertTriangle
            v-else-if="p.status === 'failed'"
            class="size-5 shrink-0 text-error-500"
            aria-hidden="true"
          />
          <FileStack v-else class="size-5 shrink-0 text-success-600" aria-hidden="true" />
          <div class="min-w-0 flex-1">
            <p class="text-theme-sm font-medium text-gray-800 dark:text-white/90">
              {{ p.company.name }}
              <span class="font-normal text-gray-500">
                · {{ p.request.letters.length }} letter{{
                  p.request.letters.length === 1 ? '' : 's'
                }},
                {{ p.request.libraryFileIds.length + p.request.tenderFileIds.length }} document(s)
              </span>
            </p>
            <p class="text-theme-xs text-gray-500 dark:text-gray-400">
              <template v-if="p.status === 'queued'"
                >Building… you will get a notification when it is ready.</template
              >
              <template v-else-if="p.status === 'failed'">{{ p.error }}</template>
              <template v-else>
                {{ p.pageCount }} pages · {{ formatBytes(p.file?.sizeBytes ?? 0) }} ·
                {{ p.requestedBy.name }},
                {{ formatDateTime(p.createdAt) }}
              </template>
            </p>
          </div>
          <template v-if="p.status === 'ready' && p.file">
            <IconButton
              :icon="ACTION_ICONS.view"
              label="Open compliance PDF"
              @click="act(() => openFile(p.file!.id))"
            />
            <IconButton
              :icon="ACTION_ICONS.download"
              label="Download compliance PDF"
              @click="act(() => downloadFile(p.file!.id))"
            />
          </template>
        </div>
        <ul
          v-if="p.warnings.length"
          class="mt-2 ml-8 list-disc space-y-0.5 pl-4 text-theme-xs text-warning-700 dark:text-orange-400"
        >
          <li v-for="(w, i) in p.warnings" :key="i">{{ w }}</li>
        </ul>
      </li>
    </ul>

    <ComplianceModal
      :open="modalOpen"
      :tender="tender"
      :companies="companies"
      :tender-docs="tenderDocs"
      @close="modalOpen = false"
      @requested="onRequested"
    />
  </UiCard>
</template>
