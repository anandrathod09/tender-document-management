<script setup lang="ts">
import { Mail, Pencil, Phone, Wrench } from 'lucide-vue-next'
import { computed, onMounted, ref } from 'vue'
import type { ConsigneeRow, InstallationReport, TenderDetail } from '@tdm/shared'
import { ENGINEER_STATUS_LABELS } from '@tdm/shared'
import { PERMISSIONS } from '@tdm/shared/permissions'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiBadge from '@/components/ui/UiBadge.vue'
import UiCard from '@/components/ui/UiCard.vue'
import { api, errorMessage } from '@/services/api'
import { useAuthStore } from '@/stores/auth'
import { formatDate } from '@/utils/format'
import ConsigneeDocuments from './ConsigneeDocuments.vue'
import {
  INSTALL_BADGE,
  rowsOf,
  SECTION_HEADING,
  SERIAL_TYPE_SHORT,
  warrantyText,
} from './installation-ui'

/**
 * The installation report on the tender page, read only: order details, then
 * each consignee with its items and documents. Engineers see only their own
 * consignees. Editing happens on the Installation Report page.
 */
const props = defineProps<{ tender: TenderDetail }>()
const auth = useAuthStore()
const report = ref<InstallationReport | null>(null)
const loaded = ref(false)
const error = ref('')

const canManage = auth.can(PERMISSIONS.INSTALLATION_MANAGE)
const canWork = canManage || auth.can(PERMISSIONS.INSTALLATION_OWN)
const canUpload = (c: ConsigneeRow) =>
  canManage || (canWork && !!c.engineer && c.engineer.id === auth.user?.id)

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

const count = (c: ConsigneeRow) => ({
  total: c.items.reduce((n, i) => n + rowsOf(i).length, 0),
  installed: c.items.flatMap((i) => i.units).filter((u) => u.installStatus === 'installed').length,
})
const totals = computed(() =>
  (report.value?.consignees ?? [])
    .map(count)
    .reduce((a, b) => ({ total: a.total + b.total, installed: a.installed + b.installed }), {
      total: 0,
      installed: 0,
    }),
)
const orderFacts = computed(() => {
  const r = report.value
  if (!r) return []
  return [
    { label: 'Purchase Order Number', value: r.poNumber },
    { label: 'PO Date', value: r.poDate && formatDate(r.poDate) },
    { label: 'Report Date', value: r.reportDate && formatDate(r.reportDate) },
    { label: 'Customer Name', value: r.customerName },
    { label: 'State Office', value: r.stateOffice },
    { label: 'Department', value: r.department },
    { label: 'Customer Address', value: r.customerAddress },
    {
      label: 'Contact Person',
      value: [r.contactPersonName, r.contactPersonDesignation, r.contactPersonPhone]
        .filter(Boolean)
        .join(' · '),
    },
  ]
})
const contact = (c: ConsigneeRow) =>
  [
    c.phone,
    c.email,
    c.fax && `Fax ${c.fax}`,
    c.callAlignedDate && `Call aligned ${formatDate(c.callAlignedDate)}`,
  ].filter(Boolean)
</script>

<template>
  <UiAlert v-if="error">{{ error }}</UiAlert>
  <UiCard v-else-if="loaded" title="Installation Report" :icon="Wrench">
    <template #header>
      <span v-if="report?.consignees.length" class="text-sm text-gray-600 dark:text-gray-400">
        {{ totals.installed }} of {{ totals.total }} item(s) installed
      </span>
      <RouterLink
        v-if="canWork && (report || canManage)"
        :to="`/tenders/${tender.id}/installation`"
        class="inline-flex h-9 items-center gap-2 rounded-md bg-blue-500 px-3 text-xs text-white hover:bg-blue-600"
      >
        <Pencil class="size-4" aria-hidden="true" />
        {{ canManage ? (report ? 'Edit report' : 'Start report') : 'Update installation' }}
      </RouterLink>
    </template>

    <p
      v-if="!report || !report.consignees.length"
      class="text-theme-sm text-gray-500 dark:text-gray-400"
    >
      {{
        report?.ownOnly
          ? "You haven't been assigned to any consignee of this tender yet."
          : 'No installation report yet. It records where the order is delivered, who installs it, and each unit’s serial number and warranty.'
      }}
    </p>

    <div v-else class="space-y-6">
      <section class="space-y-4">
        <h3 :class="SECTION_HEADING">Order Details</h3>
        <dl class="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div v-for="f in orderFacts" :key="f.label">
            <dt class="mb-1 text-xs text-gray-500 dark:text-gray-400">{{ f.label }}</dt>
            <dd class="text-sm font-medium break-words text-gray-800 dark:text-white">
              {{ f.value || '—' }}
            </dd>
          </div>
        </dl>
      </section>

      <section
        v-for="(c, ci) in report.consignees"
        :id="`consignee-${c.id}`"
        :key="c.id"
        class="space-y-4 border-t border-gray-200 pt-6 dark:border-gray-800"
      >
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0">
            <h3 :class="SECTION_HEADING">Consignee {{ ci + 1 }}</h3>
            <p class="mt-1 text-base font-medium text-gray-800 dark:text-white/90">
              {{ c.name
              }}<span v-if="c.designation" class="font-normal text-gray-500 dark:text-gray-400">
                · {{ c.designation }}</span
              >
            </p>
            <p
              v-if="contact(c).length"
              class="mt-0.5 text-theme-xs text-gray-500 dark:text-gray-400"
            >
              {{ contact(c).join(' · ') }}
            </p>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-xs text-gray-500 dark:text-gray-400"
              >{{ count(c).installed }}/{{ count(c).total }} installed</span
            >
            <UiBadge :color="c.status === 'completed' ? 'success' : 'info'">
              {{ ENGINEER_STATUS_LABELS[c.status] }}
            </UiBadge>
          </div>
        </div>

        <div
          class="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md bg-gray-50 px-3 py-2 text-sm dark:bg-white/5"
        >
          <span class="text-gray-500 dark:text-gray-400">Engineer</span>
          <span class="font-medium text-gray-800 dark:text-white/90">{{
            c.engineer?.name ?? 'Not assigned'
          }}</span>
          <a
            v-if="c.engineer?.email"
            :href="`mailto:${c.engineer.email}`"
            class="inline-flex items-center gap-1 text-gray-600 hover:text-blue-600 hover:underline dark:text-gray-400"
          >
            <Mail class="size-4" aria-hidden="true" />{{ c.engineer.email }}
          </a>
          <a
            v-if="c.engineer?.phone"
            :href="`tel:${c.engineer.phone}`"
            class="inline-flex items-center gap-1 text-gray-600 hover:text-green-600 hover:underline dark:text-gray-400"
          >
            <Phone class="size-4" aria-hidden="true" />{{ c.engineer.phone }}
          </a>
        </div>

        <div
          v-for="(it, k) in c.items"
          :key="it.id"
          class="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800"
        >
          <div
            class="flex flex-wrap items-start justify-between gap-2 border-b border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-800 dark:bg-white/5"
          >
            <p class="min-w-0 text-sm whitespace-pre-line text-gray-800 dark:text-white/90">
              <span class="font-medium">Item {{ k + 1 }}:</span> {{ it.itemName }}
            </p>
            <p class="text-xs text-gray-500 dark:text-gray-400">
              {{ SERIAL_TYPE_SHORT[it.serialType] }} · Warranty
              {{ warrantyText(it.warrantyMonths) }}
            </p>
          </div>
          <div class="custom-scrollbar overflow-x-auto">
            <table class="w-full min-w-[560px] text-sm">
              <thead>
                <tr
                  class="border-b border-gray-200 text-left text-xs text-gray-500 dark:border-gray-800 dark:text-gray-400"
                >
                  <th class="w-10 px-3 py-2 font-medium">#</th>
                  <template v-if="it.serialType === 'split'">
                    <th class="px-3 py-2 font-medium">Monitor serial</th>
                    <th class="px-3 py-2 font-medium">CPU serial</th>
                  </template>
                  <th v-else class="px-3 py-2 font-medium">Serial number</th>
                  <th class="px-3 py-2 font-medium">Status</th>
                  <th class="px-3 py-2 font-medium">Installed on</th>
                  <th class="px-3 py-2 font-medium">Remarks</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-100 dark:divide-gray-800">
                <tr
                  v-for="(u, ri) in rowsOf(it)"
                  :key="u?.id ?? `empty-${ri}`"
                  class="text-gray-700 dark:text-gray-300"
                >
                  <td class="px-3 py-2 text-gray-400 tabular-nums">{{ ri + 1 }}</td>
                  <template v-if="it.serialType === 'split'">
                    <td class="px-3 py-2">{{ u?.monitorSerial || '—' }}</td>
                    <td class="px-3 py-2">{{ u?.cpuSerial || '—' }}</td>
                  </template>
                  <td v-else class="px-3 py-2">{{ u?.serialNumber || '—' }}</td>
                  <td class="px-3 py-2">
                    <UiBadge :color="INSTALL_BADGE[u?.installStatus ?? 'pending'].color">
                      {{ INSTALL_BADGE[u?.installStatus ?? 'pending'].label }}
                    </UiBadge>
                  </td>
                  <td class="px-3 py-2">{{ u?.installedOn ? formatDate(u.installedOn) : '—' }}</td>
                  <td class="px-3 py-2">{{ u?.remarks || '—' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <p v-if="!c.items.length" class="text-theme-sm text-gray-500 dark:text-gray-400">
          No items yet.
        </p>

        <ConsigneeDocuments
          :tender-id="tender.id"
          :consignee-id="c.id"
          :documents="c.documents"
          :can-upload="canUpload(c)"
          @changed="load"
        />
      </section>
    </div>
  </UiCard>
</template>
