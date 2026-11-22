<script setup lang="ts">
import { ArrowLeft, FileDown, Plus, Save, Wrench } from 'lucide-vue-next'
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import type {
  CompanySummary,
  ConsigneeDocument,
  InstallationReport,
  InstallStatus,
  SerialType,
  TenderDetail,
} from '@tdm/shared'
import { ENGINEER_STATUS_LABELS, ENGINEER_STATUSES } from '@tdm/shared'
import { PERMISSIONS } from '@tdm/shared/permissions'
import { ACTION_ICONS } from '@/components/ui/actions'
import IconButton from '@/components/ui/IconButton.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiCard from '@/components/ui/UiCard.vue'
import UiCheckbox from '@/components/ui/UiCheckbox.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiModal from '@/components/ui/UiModal.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import UiTextarea from '@/components/ui/UiTextarea.vue'
import { api, errorMessage } from '@/services/api'
import { downloadFromApi } from '@/services/files'
import { useAuthStore } from '@/stores/auth'
import AddTemplateDialog from './AddTemplateDialog.vue'
import ConsigneeDocuments from './ConsigneeDocuments.vue'
import { INSTALLED_OPTIONS } from './installation-ui'

interface Row {
  id?: string
  serialNumber: string
  monitorSerial: string
  cpuSerial: string
  installStatus: InstallStatus
  installedOn: string
  remarks: string
}
interface Item {
  id?: string
  key: string
  itemName: string
  serialType: SerialType
  warrantyYears: string
  warrantyMonths: string
  rows: Row[]
}
interface Consignee {
  id?: string
  key: string
  name: string
  designation: string
  phone: string
  email: string
  fax: string
  engineerId: string
  engineerName: string
  status: (typeof ENGINEER_STATUSES)[number]
  callAlignedDate: string
  sameAsContact: boolean
  items: Item[]
  documents: ConsigneeDocument[]
}

const route = useRoute()
const auth = useAuthStore()
const tenderId = route.params.id as string
/** Admins edit everything; an engineer fills in the rows and status of their own consignees. */
const canManage = auth.can(PERMISSIONS.INSTALLATION_MANAGE)
const canWork = canManage || auth.can(PERMISSIONS.INSTALLATION_OWN)

const tender = ref<TenderDetail | null>(null)
const companies = ref<CompanySummary[]>([])
const engineers = ref<{ id: string; name: string }[]>([])
const header = ref({
  biddingCompanyId: '',
  poNumber: '',
  poDate: '',
  reportDate: '',
  customerName: '',
  customerAddress: '',
  stateOffice: '',
  contactPersonName: '',
  contactPersonDesignation: '',
  contactPersonPhone: '',
  department: '',
})
const consignees = ref<Consignee[]>([])
const hasReport = ref(false)
const loadError = ref('')
const error = ref('')
const saved = ref('')
const saving = ref(false)
const dirty = ref(false)

let keySeq = 0
const nextKey = () => `k${++keySeq}`
const s = (v: string | null | undefined) => v ?? ''

const blankRow = (): Row => ({
  serialNumber: '',
  monitorSerial: '',
  cpuSerial: '',
  installStatus: 'pending',
  installedOn: '',
  remarks: '',
})
const isMine = (c: Consignee) => !!c.engineerId && c.engineerId === auth.user?.id
const canEditRows = (c: Consignee) => canManage || (canWork && isMine(c) && !!c.id)

function fromReport(r: InstallationReport) {
  hasReport.value = true
  header.value = {
    biddingCompanyId: s(r.biddingCompanyId),
    poNumber: s(r.poNumber),
    poDate: s(r.poDate),
    reportDate: s(r.reportDate),
    customerName: s(r.customerName),
    customerAddress: s(r.customerAddress),
    stateOffice: s(r.stateOffice),
    contactPersonName: s(r.contactPersonName),
    contactPersonDesignation: s(r.contactPersonDesignation),
    contactPersonPhone: s(r.contactPersonPhone),
    department: s(r.department),
  }
  consignees.value = r.consignees.map((c) => ({
    id: c.id,
    key: nextKey(),
    name: c.name,
    designation: s(c.designation),
    phone: s(c.phone),
    email: s(c.email),
    fax: s(c.fax),
    engineerId: c.engineer?.id ?? '',
    engineerName: c.engineer?.name ?? '',
    status: c.status,
    callAlignedDate: s(c.callAlignedDate),
    sameAsContact: false,
    documents: c.documents,
    items: c.items.map((i) => {
      const rows: Row[] = i.units.map((u) => ({
        id: u.id,
        serialNumber: s(u.serialNumber),
        monitorSerial: s(u.monitorSerial),
        cpuSerial: s(u.cpuSerial),
        installStatus: u.installStatus,
        installedOn: s(u.installedOn),
        remarks: s(u.remarks),
      }))
      while (rows.length < i.quantity) rows.push(blankRow())
      return {
        id: i.id,
        key: nextKey(),
        itemName: i.itemName,
        serialType: i.serialType,
        warrantyYears: String(Math.floor(i.warrantyMonths / 12)),
        warrantyMonths: String(i.warrantyMonths % 12),
        rows,
      }
    }),
  }))
  dirty.value = false
}

async function load() {
  const [t, r, c, e] = await Promise.all([
    api.get<TenderDetail>(`/tenders/${tenderId}`),
    api.get<InstallationReport | null>(`/tenders/${tenderId}/installation-report`),
    canManage ? api.get<CompanySummary[]>('/companies') : Promise.resolve({ data: [] }),
    canManage
      ? api.get<{ id: string; name: string }[]>('/assets/engineers')
      : Promise.resolve({ data: [] }),
  ])
  tender.value = t.data
  companies.value = c.data
  engineers.value = e.data
  if (r.data) fromReport(r.data)
  else if (canManage) {
    // New report: start from what we know about the tender.
    header.value.biddingCompanyId = t.data.biddingCompany?.id ?? ''
    header.value.poNumber = t.data.awardNumber ?? ''
    header.value.customerName = t.data.buyerOrganization ?? ''
    addConsignee()
    dirty.value = false
  }
}
onMounted(() => load().catch((err) => (loadError.value = errorMessage(err))))

/** Documents changed: reload them without losing unsaved edits elsewhere. */
async function reloadDocuments() {
  const { data } = await api.get<InstallationReport | null>(
    `/tenders/${tenderId}/installation-report`,
  )
  for (const c of consignees.value) {
    c.documents = data?.consignees.find((x) => x.id === c.id)?.documents ?? []
  }
}

function addConsignee() {
  consignees.value.push({
    key: nextKey(),
    name: '',
    designation: '',
    phone: '',
    email: '',
    fax: '',
    engineerId: '',
    engineerName: '',
    status: 'assigned',
    callAlignedDate: '',
    sameAsContact: false,
    items: [],
    documents: [],
  })
  dirty.value = true
}

function removeConsignee(i: number) {
  const c = consignees.value[i]!
  const units = c.items.reduce((n, it) => n + it.rows.length, 0)
  const what = units ? ` with ${c.items.length} template(s) and ${units} item row(s)` : ''
  if (!confirm(`Remove ${c.name || `consignee #${i + 1}`}${what}?`)) return
  consignees.value.splice(i, 1)
  dirty.value = true
}

// "Same as Contact Person Details": the consignee follows the contact person.
function syncContact(c: Consignee) {
  if (!c.sameAsContact) return
  c.name = header.value.contactPersonName
  c.designation = header.value.contactPersonDesignation
  c.phone = header.value.contactPersonPhone
}
watch(
  () => [
    header.value.contactPersonName,
    header.value.contactPersonDesignation,
    header.value.contactPersonPhone,
  ],
  () => consignees.value.forEach(syncContact),
)

// Report templates
const templateFor = ref<Consignee | null>(null)
function addTemplate(type: SerialType, quantity: number) {
  templateFor.value!.items.push({
    key: nextKey(),
    itemName: '',
    serialType: type,
    warrantyYears: '0',
    warrantyMonths: '0',
    rows: Array.from({ length: quantity }, blankRow),
  })
  templateFor.value = null
  dirty.value = true
}
function removeTemplate(c: Consignee, index: number) {
  const it = c.items[index]!
  const filled = it.rows.filter((r) => r.id).length
  if (
    !confirm(
      `Remove Report Template ${index + 1}${filled ? ` and its ${filled} saved unit(s)` : ''}?`,
    )
  )
    return
  c.items.splice(index, 1)
  dirty.value = true
}
function addRow(it: Item) {
  it.rows.push(blankRow())
  dirty.value = true
}
function removeRow(it: Item, index: number) {
  it.rows.splice(index, 1)
  dirty.value = true
}

const engineerOptions = computed(() => [
  { value: '', label: 'Not assigned' },
  ...engineers.value.map((e) => ({ value: e.id, label: e.name })),
])
const companyOptions = computed(() => [
  { value: '', label: 'Same as the tender' },
  ...companies.value.map((c) => ({ value: c.id, label: c.name })),
])
const statusOptions = ENGINEER_STATUSES.map((v) => ({ value: v, label: ENGINEER_STATUS_LABELS[v] }))
const yearOptions = Array.from({ length: 11 }, (_, i) => ({ value: String(i), label: String(i) }))
const monthOptions = Array.from({ length: 12 }, (_, i) => ({ value: String(i), label: String(i) }))
const totalItems = computed(() =>
  consignees.value.reduce((n, c) => n + c.items.reduce((m, i) => m + i.rows.length, 0), 0),
)
const engineerName = (c: Consignee) =>
  engineers.value.find((e) => e.id === c.engineerId)?.name ?? c.engineerName

const toUnits = (rows: Row[]) => rows.map((r) => ({ ...r }))

async function save() {
  error.value = ''
  saved.value = ''
  if (canManage) {
    const missing = consignees.value.findIndex((c) => !c.name.trim())
    if (missing >= 0) {
      error.value = `Consignee #${missing + 1} needs a name.`
      return
    }
    for (const [ci, c] of consignees.value.entries()) {
      const k = c.items.findIndex((i) => !i.itemName.trim())
      if (k >= 0) {
        error.value = `Report Template ${k + 1} of consignee #${ci + 1} needs the item name and configuration.`
        return
      }
    }
  }
  saving.value = true
  try {
    let report: InstallationReport
    if (canManage) {
      report = (
        await api.put<InstallationReport>(`/tenders/${tenderId}/installation-report`, {
          ...header.value,
          biddingCompanyId: header.value.biddingCompanyId || null,
          consignees: consignees.value.map((c) => ({
            id: c.id,
            name: c.name,
            designation: c.designation,
            phone: c.phone,
            email: c.email,
            fax: c.fax,
            engineerId: c.engineerId || null,
            status: c.status,
            callAlignedDate: c.callAlignedDate,
            items: c.items.map((i) => ({
              id: i.id,
              itemName: i.itemName,
              serialType: i.serialType,
              warrantyMonths: Number(i.warrantyYears) * 12 + Number(i.warrantyMonths),
              quantity: Math.max(1, i.rows.length),
              units: toUnits(i.rows),
            })),
          })),
        })
      ).data
    } else {
      // The engineer saves each of their consignees.
      let last: InstallationReport | null = null
      for (const c of consignees.value.filter(canEditRows)) {
        last = (
          await api.patch<InstallationReport>(
            `/tenders/${tenderId}/installation-report/consignees/${c.id}`,
            {
              status: c.status,
              items: c.items.map((i) => ({ id: i.id, units: toUnits(i.rows) })),
            },
          )
        ).data
      }
      if (!last) return
      report = last
    }
    fromReport(report)
    saved.value = 'Installation report saved.'
  } catch (err) {
    error.value = errorMessage(err)
  } finally {
    saving.value = false
  }
}

// Generate PDF: all consignees, or pick one when there are several.
const pdfPicker = ref(false)
const pdfChoice = ref('')
const printable = computed(() => consignees.value.filter((c) => c.id))
function generatePdf() {
  if (printable.value.length > 1) {
    pdfChoice.value = ''
    pdfPicker.value = true
  } else void print(printable.value[0]?.id)
}
async function print(consigneeId?: string) {
  error.value = ''
  pdfPicker.value = false
  try {
    await downloadFromApi(
      `/tenders/${tenderId}/installation-report/pdf`,
      consigneeId ? { consignee: consigneeId } : undefined,
      'Installation_Report.pdf',
    )
  } catch (err) {
    error.value = errorMessage(err)
  }
}

const cell =
  'h-9 w-full rounded-md border border-gray-300 bg-transparent px-2 text-theme-sm disabled:bg-gray-50 disabled:text-gray-500 dark:border-gray-700 dark:text-white/90 dark:disabled:bg-white/5'
</script>

<template>
  <div class="pb-4" @input="dirty = true" @change="dirty = true">
    <nav class="mb-4 flex flex-wrap items-center gap-2 text-sm" aria-label="Breadcrumb">
      <RouterLink
        :to="`/tenders/${tenderId}`"
        class="flex items-center gap-2 text-gray-600 transition-colors hover:text-blue-600 dark:text-gray-400 dark:hover:text-blue-400"
      >
        <ArrowLeft class="size-4" aria-hidden="true" /> Back to Tender
      </RouterLink>
      <span class="text-gray-400">/</span>
      <span class="text-gray-800 dark:text-gray-300">Installation Report</span>
      <template v-if="tender">
        <span class="text-gray-400">/</span>
        <span class="font-medium text-blue-600 dark:text-blue-400">{{ tender.referenceNo }}</span>
      </template>
    </nav>

    <UiAlert v-if="loadError">{{ loadError }}</UiAlert>

    <template v-else-if="tender">
      <PageHeader
        title="Installation Report"
        :icon="Wrench"
        :description="`${tender.buyerOrganization ?? tender.referenceNo} · ${consignees.length} consignee(s)`"
      />

      <UiAlert v-if="error" class="mb-4">{{ error }}</UiAlert>
      <UiAlert v-else-if="saved && !dirty" variant="success" class="mb-4">{{ saved }}</UiAlert>
      <UiAlert v-if="dirty && canWork" variant="info" class="mb-4"
        >You have unsaved changes.</UiAlert
      >
      <UiAlert v-if="!canManage && canWork" variant="info" class="mb-4">
        You can fill in the serial numbers, installation status and remarks of the consignees
        assigned to you, and set your engineer status. An admin manages the rest of the report.
      </UiAlert>
      <UiAlert v-if="!hasReport && !canManage" variant="info" class="mb-4">
        No installation report has been created for this tender yet.
      </UiAlert>

      <div v-if="hasReport || canManage" class="space-y-6">
        <UiCard title="Details Form" accent="blue">
          <fieldset :disabled="!canManage" class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <UiInput :model-value="tender.referenceNo" label="Reference Number" disabled />
            <UiInput v-model="header.poNumber" label="Purchase Order Number" />
            <UiInput
              v-model="header.reportDate"
              label="Date"
              type="date"
              hint="Warranty starts here when a unit has no installation date."
            />
            <UiInput v-model="header.poDate" label="PO Date" type="date" />
            <UiInput v-model="header.customerName" label="Customer Name" />
            <UiInput v-model="header.customerAddress" label="Customer Address" />
            <UiInput v-model="header.stateOffice" label="State Office" />
            <UiInput v-model="header.contactPersonName" label="Contact Person Name" />
            <UiInput v-model="header.contactPersonDesignation" label="Contact Person Designation" />
            <UiInput v-model="header.contactPersonPhone" label="Contact Person Number" />
            <UiInput v-model="header.department" label="Department" />
            <UiSelect
              v-if="canManage"
              v-model="header.biddingCompanyId"
              label="Company (letterhead)"
              :options="companyOptions"
            />
          </fieldset>
        </UiCard>

        <template v-for="(c, ci) in consignees" :key="c.key">
          <UiCard
            :title="`Consignee #${ci + 1}${c.name ? ` - ${c.name}` : ''}`"
            :subtitle="`Assigned Engineer : ${engineerName(c) || 'Not assigned'}`"
            accent="red"
          >
            <template #header>
              <UiCheckbox
                v-if="canManage"
                v-model="c.sameAsContact"
                label="Same as Contact Person Details"
                show-label
                @update:model-value="syncContact(c)"
              />
              <IconButton
                v-if="c.id"
                :icon="ACTION_ICONS.download"
                :label="
                  dirty ? 'Save first to print this consignee' : 'Generate PDF for this consignee'
                "
                :disabled="dirty"
                @click="print(c.id)"
              />
              <IconButton
                v-if="canManage"
                :icon="ACTION_ICONS.delete"
                :label="`Remove consignee #${ci + 1}`"
                variant="danger"
                @click="removeConsignee(ci)"
              />
            </template>
            <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <fieldset :disabled="!canManage || c.sameAsContact" class="contents">
                <UiInput v-model="c.name" label="Consignee Name" required />
                <UiInput v-model="c.designation" label="Designation" />
                <UiInput v-model="c.phone" label="Contact Number" />
              </fieldset>
              <fieldset :disabled="!canManage" class="contents">
                <UiInput v-model="c.callAlignedDate" label="Call Aligned Date" type="date" />
                <UiInput v-model="c.email" label="Email ID" type="email" />
                <UiInput v-model="c.fax" label="FAX Number" />
              </fieldset>
              <UiSelect
                v-if="canManage"
                v-model="c.engineerId"
                label="Assign Engineer"
                :options="engineerOptions"
              />
              <UiInput
                v-else
                :model-value="engineerName(c) || 'Not assigned'"
                label="Engineer"
                disabled
              />
              <UiSelect
                v-model="c.status"
                label="Engineer status"
                :options="statusOptions"
                :disabled="!canEditRows(c)"
              />
            </div>
            <template v-if="canManage" #footer>
              <div class="flex justify-end">
                <UiButton size="sm" variant="secondary" @click="templateFor = c">
                  <Plus class="size-4" aria-hidden="true" /> Add Report Template
                </UiButton>
              </div>
            </template>
          </UiCard>

          <UiCard
            v-for="(it, k) in c.items"
            :key="it.key"
            :title="`Report Template ${k + 1} (${it.rows.length}/${totalItems} Total Items)`"
            :subtitle="`Consignee #${ci + 1}${c.name ? ` - ${c.name}` : ''} | Assigned Engineer : ${engineerName(c) || 'Not assigned'}`"
            accent="green"
          >
            <template v-if="canManage" #header>
              <IconButton
                :icon="ACTION_ICONS.delete"
                :label="`Remove Report Template ${k + 1}`"
                variant="danger"
                @click="removeTemplate(c, k)"
              />
            </template>
            <div class="space-y-4">
              <template v-if="canManage">
                <UiTextarea
                  v-model="it.itemName"
                  label="Item Name and Configuration"
                  placeholder="Enter item details here..."
                  :rows="3"
                  required
                />
                <div class="grid gap-4 sm:grid-cols-2">
                  <UiSelect
                    v-model="it.warrantyYears"
                    label="Warranty (Years)"
                    :options="yearOptions"
                  />
                  <UiSelect
                    v-model="it.warrantyMonths"
                    label="Warranty (Months)"
                    :options="monthOptions"
                  />
                </div>
              </template>
              <div
                v-else
                class="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800"
              >
                <h3 class="mb-2 text-sm font-semibold text-gray-700 dark:text-gray-300">
                  Item Name and Configuration
                </h3>
                <p class="text-sm whitespace-pre-wrap text-gray-600 dark:text-gray-400">
                  {{ it.itemName }}
                </p>
                <p class="mt-2 text-xs text-blue-600 dark:text-blue-400">
                  Warranty: {{ it.warrantyYears }} Year(s) {{ it.warrantyMonths }} Month(s)
                </p>
              </div>

              <div class="custom-scrollbar overflow-x-auto">
                <table class="w-full min-w-[760px] text-theme-sm">
                  <thead class="bg-gray-50 dark:bg-gray-800">
                    <tr
                      class="border-b border-gray-200 text-left text-sm text-gray-800 dark:border-gray-800 dark:text-white/90"
                    >
                      <th class="w-10 p-2 font-medium">#</th>
                      <template v-if="it.serialType === 'split'">
                        <th class="p-2 font-medium">Monitor Serial Number</th>
                        <th class="p-2 font-medium">CPU Serial Number</th>
                      </template>
                      <th v-else class="p-2 font-medium">Serial Number (Common)</th>
                      <th class="w-32 p-2 font-medium">Status</th>
                      <th class="w-40 p-2 font-medium">Installed on</th>
                      <th class="p-2 font-medium">Remarks</th>
                      <th v-if="canManage" class="w-10" />
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="(r, ri) in it.rows" :key="r.id ?? `${it.key}-${ri}`">
                      <td class="py-1 pr-2 text-gray-500 tabular-nums">{{ ri + 1 }}</td>
                      <template v-if="it.serialType === 'split'">
                        <td class="py-1 pr-2">
                          <input
                            v-model="r.monitorSerial"
                            :class="cell"
                            placeholder="Enter S/N"
                            :disabled="!canEditRows(c)"
                            :aria-label="`Monitor serial, row ${ri + 1}`"
                          />
                        </td>
                        <td class="py-1 pr-2">
                          <input
                            v-model="r.cpuSerial"
                            :class="cell"
                            placeholder="Enter S/N"
                            :disabled="!canEditRows(c)"
                            :aria-label="`CPU serial, row ${ri + 1}`"
                          />
                        </td>
                      </template>
                      <td v-else class="py-1 pr-2">
                        <input
                          v-model="r.serialNumber"
                          :class="cell"
                          placeholder="Enter S/N"
                          :disabled="!canEditRows(c)"
                          :aria-label="`Serial number, row ${ri + 1}`"
                        />
                      </td>
                      <td class="py-1 pr-2">
                        <UiSelect
                          v-model="r.installStatus"
                          :aria-label="`Status, row ${ri + 1}`"
                          size="sm"
                          :options="INSTALLED_OPTIONS"
                          :disabled="!canEditRows(c)"
                          @update:model-value="dirty = true"
                        />
                      </td>
                      <td class="py-1 pr-2">
                        <input
                          v-model="r.installedOn"
                          type="date"
                          :class="cell"
                          :disabled="!canEditRows(c)"
                          :aria-label="`Installed on, row ${ri + 1}`"
                        />
                      </td>
                      <td class="py-1 pr-2">
                        <input
                          v-model="r.remarks"
                          :class="cell"
                          placeholder="Enter remarks"
                          :disabled="!canEditRows(c)"
                          :aria-label="`Remarks, row ${ri + 1}`"
                        />
                      </td>
                      <td v-if="canManage" class="py-1">
                        <IconButton
                          :icon="ACTION_ICONS.delete"
                          :label="`Remove row ${ri + 1}`"
                          variant="danger"
                          @click="removeRow(it, ri)"
                        />
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
            <template v-if="canManage" #footer>
              <div class="flex justify-end">
                <UiButton size="sm" @click="addRow(it)">
                  <Plus class="size-4" aria-hidden="true" /> Add Item
                </UiButton>
              </div>
            </template>
          </UiCard>

          <ConsigneeDocuments
            v-if="c.id"
            :tender-id="tenderId"
            :consignee-id="c.id"
            :consignee-name="c.name"
            :documents="c.documents"
            :can-upload="canEditRows(c)"
            @changed="reloadDocuments"
          />
        </template>

        <UiButton v-if="canManage" @click="addConsignee">
          <Plus class="size-4" aria-hidden="true" /> Add Another Consignee
        </UiButton>
      </div>

      <!-- Action bar, as in the old report page. -->
      <div
        v-if="hasReport || canManage"
        class="sticky bottom-0 z-20 mt-6 -mx-4 flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 bg-white px-4 py-3 md:-mx-6 md:px-6 dark:border-gray-800 dark:bg-gray-900"
      >
        <span
          class="rounded-md bg-blue-100 px-3 py-1 text-sm font-medium text-blue-800 dark:bg-blue-500/15 dark:text-blue-300"
          >Total Items: {{ totalItems }}</span
        >
        <div class="flex gap-3">
          <UiButton
            variant="secondary"
            :disabled="dirty || !printable.length"
            :title="dirty ? 'Save first' : undefined"
            @click="generatePdf"
          >
            <FileDown class="size-4" aria-hidden="true" /> Generate PDF
          </UiButton>
          <UiButton
            v-if="canManage || consignees.some(canEditRows)"
            :loading="saving"
            :disabled="!dirty"
            @click="save"
          >
            <Save class="size-4" aria-hidden="true" /> Save Report
          </UiButton>
        </div>
      </div>
    </template>
    <p v-else class="text-sm text-gray-500">Loading…</p>

    <AddTemplateDialog
      :open="!!templateFor"
      :consignee-name="templateFor?.name || 'this consignee'"
      @close="templateFor = null"
      @add="addTemplate"
    />

    <UiModal :open="pdfPicker" title="Select Consignee for PDF" @close="pdfPicker = false">
      <div class="space-y-2">
        <label
          :class="[
            'flex cursor-pointer items-start gap-3 rounded-lg border p-3',
            pdfChoice === ''
              ? 'border-blue-300 bg-blue-50 dark:border-blue-700 dark:bg-blue-900/20'
              : 'border-gray-200 dark:border-gray-700',
          ]"
        >
          <input v-model="pdfChoice" type="radio" value="" class="mt-1 accent-blue-600" />
          <span>
            <span class="block text-sm font-medium text-gray-800 dark:text-white/90"
              >All Consignees</span
            >
            <span class="block text-xs text-gray-500 dark:text-gray-400"
              >One PDF with all {{ printable.length }} consignees</span
            >
          </span>
        </label>
        <p class="py-1 text-center text-xs text-gray-400">or select one</p>
        <label
          v-for="(c, i) in printable"
          :key="c.key"
          :class="[
            'flex cursor-pointer items-start gap-3 rounded-lg border p-3',
            pdfChoice === c.id
              ? 'border-blue-300 bg-blue-50 dark:border-blue-700 dark:bg-blue-900/20'
              : 'border-gray-200 dark:border-gray-700',
          ]"
        >
          <input v-model="pdfChoice" type="radio" :value="c.id" class="mt-1 accent-blue-600" />
          <span>
            <span class="block text-sm font-medium text-gray-800 dark:text-white/90"
              >#{{ i + 1 }} {{ c.name }}</span
            >
            <span class="block text-xs text-gray-500 dark:text-gray-400">
              {{ c.designation }} · {{ engineerName(c) || 'No engineer' }} ·
              {{ c.items.length }} template(s)
            </span>
          </span>
        </label>
      </div>
      <template #footer>
        <UiButton variant="secondary" @click="pdfPicker = false">Cancel</UiButton>
        <UiButton @click="print(pdfChoice || undefined)">
          <FileDown class="size-4" aria-hidden="true" />
          {{ pdfChoice ? 'Download Selected' : `Download All (${printable.length})` }}
        </UiButton>
      </template>
    </UiModal>
  </div>
</template>
