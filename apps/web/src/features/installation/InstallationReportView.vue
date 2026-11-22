<script setup lang="ts">
import { Mail, Pencil, Phone } from 'lucide-vue-next'
import { computed, onMounted, ref } from 'vue'
import type { InstallationReport, TenderDetail } from '@tdm/shared'
import { ENGINEER_STATUS_LABELS } from '@tdm/shared'
import { PERMISSIONS } from '@tdm/shared/permissions'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiBadge from '@/components/ui/UiBadge.vue'
import UiCard from '@/components/ui/UiCard.vue'
import { api, errorMessage } from '@/services/api'
import { useAuthStore } from '@/stores/auth'
import { formatDate } from '@/utils/format'
import ConsigneeDocuments from './ConsigneeDocuments.vue'
import { INSTALL_BADGE, rowsOf, warrantyText } from './installation-ui'

/**
 * The installation report shown read-only on the tender page, as in the old
 * TMS: tender details, then each consignee with its report templates and
 * uploaded documents. Engineers see only their own consignees.
 */
const props = defineProps<{ tender: TenderDetail }>()
const auth = useAuthStore()
const report = ref<InstallationReport | null>(null)
const loaded = ref(false)
const error = ref('')

const canManage = auth.can(PERMISSIONS.INSTALLATION_MANAGE)
const canWork = canManage || auth.can(PERMISSIONS.INSTALLATION_OWN)
const canUpload = (engineerId: string | undefined) =>
  canManage || (canWork && !!engineerId && engineerId === auth.user?.id)

async function load() {
  try {
    report.value = (
      await api.get<InstallationReport | null>(`/tenders/${props.tender.id}/installation-report`)
    ).data
  } catch (err) {
    error.value = errorMessage(err)
  } finally {
    loaded.value = true
  }
}
onMounted(load)

const totalItems = computed(
  () =>
    report.value?.consignees.reduce(
      (n, c) => n + c.items.reduce((m, i) => m + rowsOf(i).length, 0),
      0,
    ) ?? 0,
)
const dash = (v: string | null | undefined) => v || 'N/A'
const field = 'text-sm font-medium text-gray-700 dark:text-gray-300'
const value = 'py-2 text-sm text-gray-800 dark:text-white/90 break-words'
</script>

<template>
  <UiAlert v-if="error">{{ error }}</UiAlert>
  <template v-else-if="loaded">
    <UiCard v-if="!report || !report.consignees.length" title="Installation" accent="blue">
      <template v-if="canWork" #header>
        <RouterLink
          :to="`/tenders/${tender.id}/installation`"
          class="inline-flex h-9 items-center gap-2 rounded-md bg-gray-200 px-3 text-sm text-gray-700 hover:bg-gray-300 dark:bg-white/5 dark:text-white/90 dark:hover:bg-white/10"
        >
          <Pencil class="size-4" aria-hidden="true" />
          {{
            canManage ? (report ? 'Edit Installation Report' : 'Start Installation Report') : 'Open'
          }}
        </RouterLink>
      </template>
      <p class="text-sm text-gray-500 dark:text-gray-400">
        {{
          report?.ownOnly
            ? "You haven't been assigned to any consignee of this tender yet."
            : 'No installation report has been created for this tender yet.'
        }}
      </p>
    </UiCard>

    <div v-else class="space-y-6">
      <UiCard title="Tender Details" accent="blue">
        <template v-if="canWork" #header>
          <span
            class="rounded-md bg-blue-100 px-3 py-1 text-sm font-medium text-blue-800 dark:bg-blue-500/15 dark:text-blue-300"
            >Total Items: {{ totalItems }}</span
          >
          <RouterLink
            :to="`/tenders/${tender.id}/installation`"
            class="inline-flex h-9 items-center gap-2 rounded-md bg-blue-500 px-3 text-sm text-white hover:bg-blue-600"
          >
            <Pencil class="size-4" aria-hidden="true" />
            {{ canManage ? 'Edit Installation Report' : 'Update Installation' }}
          </RouterLink>
        </template>
        <dl class="grid grid-cols-1 gap-x-4 gap-y-2 md:grid-cols-3">
          <div>
            <dt :class="field">Reference Number</dt>
            <dd :class="value">{{ tender.referenceNo }}</dd>
          </div>
          <div>
            <dt :class="field">Purchase Order Number</dt>
            <dd :class="value">{{ dash(report.poNumber) }}</dd>
          </div>
          <div>
            <dt :class="field">Report Date</dt>
            <dd :class="value">{{ report.reportDate ? formatDate(report.reportDate) : 'N/A' }}</dd>
          </div>
          <div>
            <dt :class="field">PO Date</dt>
            <dd :class="value">{{ report.poDate ? formatDate(report.poDate) : 'N/A' }}</dd>
          </div>
          <div>
            <dt :class="field">Customer Name</dt>
            <dd :class="value">{{ dash(report.customerName) }}</dd>
          </div>
          <div>
            <dt :class="field">Customer Address</dt>
            <dd :class="value">{{ dash(report.customerAddress) }}</dd>
          </div>
          <div>
            <dt :class="field">State Office</dt>
            <dd :class="value">{{ dash(report.stateOffice) }}</dd>
          </div>
          <div>
            <dt :class="field">Contact Person</dt>
            <dd :class="value">
              {{
                [report.contactPersonName, report.contactPersonDesignation]
                  .filter(Boolean)
                  .join(' - ') || 'N/A'
              }}
              <template v-if="report.contactPersonPhone"
                ><br />{{ report.contactPersonPhone }}</template
              >
            </dd>
          </div>
          <div>
            <dt :class="field">Department</dt>
            <dd :class="value">{{ dash(report.department) }}</dd>
          </div>
        </dl>
      </UiCard>

      <template v-for="c in report.consignees" :key="c.id">
        <UiCard :title="`Consignee: ${c.name}`" :subtitle="c.designation ?? undefined" accent="red">
          <template #header>
            <UiBadge :color="c.status === 'completed' ? 'success' : 'info'">
              {{ ENGINEER_STATUS_LABELS[c.status] }}
            </UiBadge>
          </template>
          <dl class="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2 xl:grid-cols-4">
            <div>
              <dt :class="field">Contact Number</dt>
              <dd :class="value">{{ dash(c.phone) }}</dd>
            </div>
            <div>
              <dt :class="field">Email ID</dt>
              <dd :class="value">{{ dash(c.email) }}</dd>
            </div>
            <div>
              <dt :class="field">FAX Number</dt>
              <dd :class="value">{{ dash(c.fax) }}</dd>
            </div>
            <div>
              <dt :class="field">Call Aligned Date</dt>
              <dd :class="value">
                {{ c.callAlignedDate ? formatDate(c.callAlignedDate) : 'N/A' }}
              </dd>
            </div>
            <div class="sm:col-span-2 xl:col-span-4">
              <dt :class="field">Assigned Engineer</dt>
              <dd :class="[value, 'flex flex-wrap items-center gap-x-4 gap-y-1']">
                <span>{{ c.engineer?.name ?? 'Not assigned' }}</span>
                <a
                  v-if="c.engineer?.email"
                  :href="`mailto:${c.engineer.email}`"
                  class="inline-flex items-center gap-1 text-blue-600 hover:underline dark:text-blue-400"
                >
                  <Mail class="size-4" aria-hidden="true" />{{ c.engineer.email }}
                </a>
                <a
                  v-if="c.engineer?.phone"
                  :href="`tel:${c.engineer.phone}`"
                  class="inline-flex items-center gap-1 text-green-600 hover:underline dark:text-green-400"
                >
                  <Phone class="size-4" aria-hidden="true" />{{ c.engineer.phone }}
                </a>
              </dd>
            </div>
          </dl>
        </UiCard>

        <UiCard
          v-for="(it, k) in c.items"
          :key="it.id"
          :title="`Report Template ${k + 1}`"
          :subtitle="[c.name, c.designation].filter(Boolean).join(' - ')"
          accent="green"
        >
          <div class="space-y-4">
            <div
              class="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800"
            >
              <h3 class="mb-2 text-sm font-semibold text-gray-700 dark:text-gray-300">
                Item Name and Configuration
              </h3>
              <p class="text-sm whitespace-pre-wrap text-gray-600 dark:text-gray-400">
                {{ it.itemName || 'N/A' }}
              </p>
              <p v-if="it.warrantyMonths" class="mt-2 text-xs text-blue-600 dark:text-blue-400">
                Warranty: {{ warrantyText(it.warrantyMonths) }}
              </p>
            </div>
            <div class="custom-scrollbar overflow-x-auto">
              <table
                class="w-full min-w-[560px] border border-gray-200 text-sm dark:border-gray-800"
              >
                <thead class="bg-gray-50 dark:bg-gray-800">
                  <tr class="text-left text-xs text-gray-700 dark:text-gray-300">
                    <template v-if="it.serialType === 'split'">
                      <th class="px-3 py-2 font-medium">Monitor Serial Number</th>
                      <th class="px-3 py-2 font-medium">CPU Serial Number</th>
                    </template>
                    <th v-else class="px-3 py-2 font-medium">Serial Number (Common)</th>
                    <th class="px-3 py-2 font-medium">Status</th>
                    <th class="px-3 py-2 font-medium">Installed on</th>
                    <th class="px-3 py-2 font-medium">Remarks</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-gray-100 dark:divide-gray-800">
                  <tr
                    v-for="(u, ri) in rowsOf(it)"
                    :key="u?.id ?? `empty-${ri}`"
                    class="even:bg-gray-50/60 dark:even:bg-white/[0.02]"
                  >
                    <template v-if="it.serialType === 'split'">
                      <td class="px-3 py-2">{{ u?.monitorSerial || '-' }}</td>
                      <td class="px-3 py-2">{{ u?.cpuSerial || '-' }}</td>
                    </template>
                    <td v-else class="px-3 py-2">{{ u?.serialNumber || '-' }}</td>
                    <td class="px-3 py-2">
                      <UiBadge :color="INSTALL_BADGE[u?.installStatus ?? 'pending'].color">
                        {{ INSTALL_BADGE[u?.installStatus ?? 'pending'].label }}
                      </UiBadge>
                    </td>
                    <td class="px-3 py-2">
                      {{ u?.installedOn ? formatDate(u.installedOn) : '-' }}
                    </td>
                    <td class="px-3 py-2">{{ u?.remarks || '-' }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </UiCard>

        <ConsigneeDocuments
          :tender-id="tender.id"
          :consignee-id="c.id"
          :consignee-name="c.name"
          :documents="c.documents"
          :can-upload="canUpload(c.engineer?.id)"
          @changed="load"
        />
      </template>
    </div>
  </template>
</template>
