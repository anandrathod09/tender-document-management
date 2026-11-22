<script setup lang="ts">
import { ArrowLeft, FileDown, Mail, Phone, Plus, Save, Wrench } from 'lucide-vue-next'
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
import { formatDate } from '@/utils/format'
import AddItemDialog from './AddItemDialog.vue'
import ConsigneeDocuments from './ConsigneeDocuments.vue'
import {
  INSTALLED_OPTIONS,
  type NewItem,
  SECTION_HEADING,
  SERIAL_TYPE_SHORT,
  warrantyText,
} from './installation-ui'

/**
 * The installation report editor. Each consignee (delivery location) has its
 * engineer and one or more items; each item is a list of units with serial
 * numbers, recorded either as one serial or as monitor + CPU serials.
 * Admins edit everything; an engineer fills in the units and status of the
 * consignees assigned to them.
 */
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
  engineer: { name: string; email: string; phone: string | null } | null
  status: (typeof ENGINEER_STATUSES)[number]
  callAlignedDate: string
  sameAsContact: boolean
  items: Item[]
  documents: ConsigneeDocument[]
}

const route = useRoute()
const auth = useAuthStore()
const tenderId = route.params.id as string
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
/** Units and status: admins on every consignee, an engineer on their own saved ones. */
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
    engineer: c.engineer,
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

/** Documents changed: refresh them without losing unsaved edits elsewhere. */
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
    engineer: null,
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
  const what = units ? ` and its ${c.items.length} item(s)` : ''
  if (!confirm(`Remove ${c.name || `consignee ${i + 1}`}${what}?`)) return
  consignees.value.splice(i, 1)
  dirty.value = true
}

// "Same as contact person": the consignee follows the order's contact person.
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

// Items
const itemFor = ref<Consignee | null>(null)
function addItem(n: NewItem) {
  itemFor.value!.items.push({
    key: nextKey(),
    itemName: n.itemName,
    serialType: n.serialType,
    warrantyYears: String(Math.floor(n.warrantyMonths / 12)),
    warrantyMonths: String(n.warrantyMonths % 12),
    rows: Array.from({ length: n.quantity }, blankRow),
  })
  itemFor.value = null
  dirty.value = true
}
function removeItem(c: Consignee, index: number) {
  const it = c.items[index]!
  const filled = it.rows.filter((r) => r.id).length
  if (!confirm(`Remove item ${index + 1}${filled ? ` and its ${filled} saved unit(s)` : ''}?`))
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
const yearOptions = Array.from({ length: 11 }, (_, i) => ({ value: String(i), label: `${i}` }))
const monthOptions = Array.from({ length: 12 }, (_, i) => ({ value: String(i), label: `${i}` }))
const filled = (r: Row) =>
  !!(r.serialNumber || r.monitorSerial || r.cpuSerial || r.remarks || r.installedOn) ||
  r.installStatus !== 'pending'
const installedOf = (rows: Row[]) => rows.filter((r) => r.installStatus === 'installed').length
const totalRows = computed(() =>
  consignees.value.reduce((n, c) => n + c.items.reduce((m, i) => m + i.rows.length, 0), 0),
)
const engineerName = (c: Consignee) =>
  engineers.value.find((e) => e.id === c.engineerId)?.name ?? c.engineer?.name ?? ''

const toUnits = (rows: Row[]) => rows.map((r) => ({ ...r }))

async function save() {
  error.value = ''
  saved.value = ''
  if (canManage) {
    const missing = consignees.value.findIndex((c) => !c.name.trim())
    if (missing >= 0) {
      error.value = `Consignee ${missing + 1} needs a name.`
      return
    }
    for (const [ci, c] of consignees.value.entries()) {
      const k = c.items.findIndex((i) => !i.itemName.trim())
      if (k >= 0) {
        error.value = `Item ${k + 1} of consignee ${ci + 1} needs its name and configuration.`
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
            { status: c.status, items: c.items.map((i) => ({ id: i.id, units: toUnits(i.rows) })) },
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

// PDF: all consignees, or pick one when there are several.
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

const orderFacts = computed(() => {
  const h = header.value
  return [
    { label: 'Purchase Order Number', value: h.poNumber },
    { label: 'PO Date', value: h.poDate && formatDate(h.poDate) },
    { label: 'Report Date', value: h.reportDate && formatDate(h.reportDate) },
    { label: 'Customer Name', value: h.customerName },
    { label: 'State Office', value: h.stateOffice },
    { label: 'Department', value: h.department },
    { label: 'Customer Address', value: h.customerAddress },
    {
      label: 'Contact Person',
      value: [h.contactPersonName, h.contactPersonDesignation, h.contactPersonPhone]
        .filter(Boolean)
        .join(' · '),
    },
  ]
})

const cell =
  'h-9 w-full rounded-md border border-gray-300 bg-transparent px-2 text-theme-sm disabled:bg-gray-50 disabled:text-gray-500 dark:border-gray-700 dark:text-white/90 dark:disabled:bg-white/5'
</script>

<template>
  <div @input="dirty = true" @change="dirty = true">
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
        :description="`${tender.buyerOrganization ?? tender.referenceNo} · ${consignees.length} consignee(s) · ${totalRows} unit(s)`"
      >
        <template #actions>
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
            <Save class="size-4" aria-hidden="true" /> Save
          </UiButton>
        </template>
      </PageHeader>

      <UiAlert v-if="error" class="mb-4">{{ error }}</UiAlert>
      <UiAlert v-else-if="saved && !dirty" variant="success" class="mb-4">{{ saved }}</UiAlert>
      <UiAlert v-if="!canManage && canWork" variant="info" class="mb-4">
        Fill in the serial numbers, installation status and remarks of your consignees, and set your
        engineer status. An admin manages the rest of the report.
      </UiAlert>
      <UiAlert v-if="!hasReport && !canManage" variant="info" class="mb-4">
        No installation report has been created for this tender yet.
      </UiAlert>

      <div v-if="hasReport || canManage" class="space-y-6">
        <UiCard title="Order Details">
          <div v-if="canManage" class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <UiInput v-model="header.poNumber" label="Purchase order number" />
            <UiInput v-model="header.poDate" label="PO date" type="date" />
            <UiInput
              v-model="header.reportDate"
              label="Report date"
              type="date"
              hint="Warranty starts here when a unit has no installation date."
            />
            <UiInput v-model="header.customerName" label="Customer name" />
            <UiInput v-model="header.stateOffice" label="State office" />
            <UiInput v-model="header.department" label="Department" />
            <div class="sm:col-span-2 xl:col-span-3">
              <UiInput v-model="header.customerAddress" label="Customer address" />
            </div>
            <UiInput v-model="header.contactPersonName" label="Contact person" />
            <UiInput v-model="header.contactPersonDesignation" label="Contact designation" />
            <UiInput v-model="header.contactPersonPhone" label="Contact number" />
            <UiSelect
              v-model="header.biddingCompanyId"
              label="Letterhead"
              :options="companyOptions"
            />
          </div>
          <dl v-else class="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div v-for="f in orderFacts" :key="f.label">
              <dt class="mb-1 text-xs text-gray-500 dark:text-gray-400">{{ f.label }}</dt>
              <dd class="text-sm font-medium break-words text-gray-800 dark:text-white">
                {{ f.value || '—' }}
              </dd>
            </div>
          </dl>
        </UiCard>

        <UiCard
          v-for="(c, ci) in consignees"
          :key="c.key"
          :title="`Consignee ${ci + 1}${c.name ? `: ${c.name}` : ''}`"
          :subtitle="`Engineer: ${engineerName(c) || 'not assigned'} · ${ENGINEER_STATUS_LABELS[c.status]}`"
        >
          <template #header>
            <IconButton
              v-if="c.id"
              :icon="ACTION_ICONS.download"
              :label="dirty ? 'Save first to print this consignee' : 'PDF of this consignee'"
              :disabled="dirty"
              @click="print(c.id)"
            />
            <IconButton
              v-if="canManage"
              :icon="ACTION_ICONS.delete"
              :label="`Remove consignee ${ci + 1}`"
              variant="danger"
              @click="removeConsignee(ci)"
            />
          </template>

          <div class="space-y-6">
            <!-- Details -->
            <section v-if="canManage" class="space-y-4">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <h3 :class="SECTION_HEADING">Delivery and engineer</h3>
                <UiCheckbox
                  v-model="c.sameAsContact"
                  label="Same as the order's contact person"
                  show-label
                  @update:model-value="syncContact(c)"
                />
              </div>
              <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                <fieldset :disabled="c.sameAsContact" class="contents">
                  <UiInput v-model="c.name" label="Consignee name" required />
                  <UiInput v-model="c.designation" label="Designation" />
                  <UiInput v-model="c.phone" label="Contact number" />
                </fieldset>
                <UiInput v-model="c.email" label="Email" type="email" />
                <UiInput v-model="c.fax" label="Fax" />
                <UiInput v-model="c.callAlignedDate" label="Call aligned date" type="date" />
                <UiSelect v-model="c.engineerId" label="Engineer" :options="engineerOptions" />
                <UiSelect v-model="c.status" label="Engineer status" :options="statusOptions" />
              </div>
            </section>
            <section v-else class="space-y-3">
              <h3 :class="SECTION_HEADING">Delivery</h3>
              <p class="text-sm text-gray-800 dark:text-white/90">
                <span class="font-medium">{{ c.name }}</span><span
                  v-if="c.designation"
                  class="text-gray-500 dark:text-gray-400"
                >
                  · {{ c.designation }}</span
                >
              </p>
              <p
                class="flex flex-wrap gap-x-4 gap-y-1 text-theme-sm text-gray-600 dark:text-gray-400"
              >
                <a
                  v-if="c.phone"
                  :href="`tel:${c.phone}`"
                  class="inline-flex items-center gap-1 hover:underline"
                  ><Phone class="size-4" aria-hidden="true" />{{ c.phone }}</a
                >
                <a
                  v-if="c.email"
                  :href="`mailto:${c.email}`"
                  class="inline-flex items-center gap-1 hover:underline"
                  ><Mail class="size-4" aria-hidden="true" />{{ c.email }}</a
                >
                <span v-if="c.fax">Fax {{ c.fax }}</span>
                <span v-if="c.callAlignedDate"
                  >Call aligned {{ formatDate(c.callAlignedDate) }}</span
                >
              </p>
              <div class="max-w-xs">
                <UiSelect
                  v-model="c.status"
                  label="Engineer status"
                  :options="statusOptions"
                  :disabled="!canEditRows(c)"
                  @update:model-value="dirty = true"
                />
              </div>
            </section>

            <!-- Items -->
            <section class="space-y-3">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <h3 :class="SECTION_HEADING">Items ({{ c.items.length }})</h3>
                <UiButton v-if="canManage" size="sm" variant="secondary" @click="itemFor = c">
                  <Plus class="size-4" aria-hidden="true" /> Add item
                </UiButton>
              </div>
              <p v-if="!c.items.length" class="text-theme-sm text-gray-500 dark:text-gray-400">
                {{
                  canManage
                    ? 'Add what is delivered here: the item, how its serial numbers are recorded, and how many units.'
                    : 'No items yet.'
                }}
              </p>

              <div
                v-for="(it, k) in c.items"
                :key="it.key"
                class="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800"
              >
                <div
                  class="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-800 dark:bg-white/5"
                >
                  <span class="text-sm font-medium text-gray-800 dark:text-white/90"
                    >Item {{ k + 1 }}</span
                  >
                  <span class="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
                    <span>{{ SERIAL_TYPE_SHORT[it.serialType] }}</span>
                    <span>{{ it.rows.filter(filled).length }} of {{ it.rows.length }} filled</span>
                    <span>{{ installedOf(it.rows) }} installed</span>
                    <IconButton
                      v-if="canManage"
                      :icon="ACTION_ICONS.delete"
                      :label="`Remove item ${k + 1}`"
                      variant="danger"
                      @click="removeItem(c, k)"
                    />
                  </span>
                </div>
                <div class="space-y-3 p-3">
                  <div v-if="canManage" class="grid gap-3 lg:grid-cols-[1fr_8rem_8rem]">
                    <UiTextarea
                      v-model="it.itemName"
                      label="Item name and configuration"
                      :rows="2"
                      required
                    />
                    <UiSelect
                      v-model="it.warrantyYears"
                      label="Warranty (years)"
                      :options="yearOptions"
                    />
                    <UiSelect
                      v-model="it.warrantyMonths"
                      label="Warranty (months)"
                      :options="monthOptions"
                    />
                  </div>
                  <div v-else>
                    <p class="text-sm whitespace-pre-line text-gray-800 dark:text-white/90">
                      {{ it.itemName }}
                    </p>
                    <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      Warranty
                      {{ warrantyText(Number(it.warrantyYears) * 12 + Number(it.warrantyMonths)) }}
                    </p>
                  </div>

                  <div class="custom-scrollbar overflow-x-auto">
                    <table class="w-full min-w-[720px] text-theme-sm">
                      <thead>
                        <tr
                          class="border-b border-gray-200 text-left text-xs text-gray-500 dark:border-gray-800 dark:text-gray-400"
                        >
                          <th class="w-8 py-2 pr-2 font-medium">#</th>
                          <template v-if="it.serialType === 'split'">
                            <th class="py-2 pr-2 font-medium">Monitor serial</th>
                            <th class="py-2 pr-2 font-medium">CPU serial</th>
                          </template>
                          <th v-else class="py-2 pr-2 font-medium">Serial number</th>
                          <th class="w-32 py-2 pr-2 font-medium">Installed</th>
                          <th class="w-40 py-2 pr-2 font-medium">Installed on</th>
                          <th class="py-2 pr-2 font-medium">Remarks</th>
                          <th v-if="canManage" class="w-10" />
                        </tr>
                      </thead>
                      <tbody>
                        <tr v-for="(r, ri) in it.rows" :key="r.id ?? `${it.key}-${ri}`">
                          <td class="py-1 pr-2 text-gray-400 tabular-nums">{{ ri + 1 }}</td>
                          <template v-if="it.serialType === 'split'">
                            <td class="py-1 pr-2">
                              <input
                                v-model="r.monitorSerial"
                                :class="cell"
                                :disabled="!canEditRows(c)"
                                :aria-label="`Monitor serial, item ${k + 1}, unit ${ri + 1}`"
                              />
                            </td>
                            <td class="py-1 pr-2">
                              <input
                                v-model="r.cpuSerial"
                                :class="cell"
                                :disabled="!canEditRows(c)"
                                :aria-label="`CPU serial, item ${k + 1}, unit ${ri + 1}`"
                              />
                            </td>
                          </template>
                          <td v-else class="py-1 pr-2">
                            <input
                              v-model="r.serialNumber"
                              :class="cell"
                              :disabled="!canEditRows(c)"
                              :aria-label="`Serial number, item ${k + 1}, unit ${ri + 1}`"
                            />
                          </td>
                          <td class="py-1 pr-2">
                            <UiSelect
                              v-model="r.installStatus"
                              :aria-label="`Installed, item ${k + 1}, unit ${ri + 1}`"
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
                              :aria-label="`Installed on, item ${k + 1}, unit ${ri + 1}`"
                            />
                          </td>
                          <td class="py-1 pr-2">
                            <input
                              v-model="r.remarks"
                              :class="cell"
                              :disabled="!canEditRows(c)"
                              :aria-label="`Remarks, item ${k + 1}, unit ${ri + 1}`"
                            />
                          </td>
                          <td v-if="canManage" class="py-1">
                            <IconButton
                              :icon="ACTION_ICONS.delete"
                              :label="`Remove unit ${ri + 1} of item ${k + 1}`"
                              variant="danger"
                              @click="removeRow(it, ri)"
                            />
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <UiButton v-if="canManage" size="xs" variant="ghost" @click="addRow(it)">
                    <Plus class="size-3.5" aria-hidden="true" /> Add unit
                  </UiButton>
                </div>
              </div>
            </section>

            <ConsigneeDocuments
              v-if="c.id"
              :tender-id="tenderId"
              :consignee-id="c.id"
              :documents="c.documents"
              :can-upload="canEditRows(c)"
              @changed="reloadDocuments"
            />
          </div>
        </UiCard>

        <UiButton v-if="canManage" variant="secondary" @click="addConsignee">
          <Plus class="size-4" aria-hidden="true" /> Add consignee
        </UiButton>
      </div>

      <!-- Unsaved changes stay in view while scrolling a long report. -->
      <div
        v-if="dirty && canWork"
        class="sticky bottom-4 z-20 mt-6 flex items-center justify-between gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 shadow-theme-lg dark:border-blue-500/30 dark:bg-gray-900"
      >
        <span class="text-sm text-blue-800 dark:text-blue-300">You have unsaved changes.</span>
        <UiButton size="sm" :loading="saving" @click="save">
          <Save class="size-4" aria-hidden="true" /> Save
        </UiButton>
      </div>
    </template>
    <p v-else class="text-sm text-gray-500">Loading…</p>

    <AddItemDialog
      :open="!!itemFor"
      :consignee-name="itemFor?.name || 'this consignee'"
      @close="itemFor = null"
      @add="addItem"
    />

    <UiModal :open="pdfPicker" title="Generate PDF" @close="pdfPicker = false">
      <div class="space-y-2">
        <label
          v-for="opt in [
            { id: '', title: 'All consignees', sub: `One PDF with ${printable.length} consignees` },
            ...printable.map((c, i) => ({
              id: c.id!,
              title: `${i + 1}. ${c.name}`,
              sub: `${engineerName(c) || 'No engineer'} · ${c.items.length} item(s)`,
            })),
          ]"
          :key="opt.id"
          :class="[
            'flex cursor-pointer items-start gap-3 rounded-lg border p-3',
            pdfChoice === opt.id
              ? 'border-blue-300 bg-blue-50 dark:border-blue-700 dark:bg-blue-900/20'
              : 'border-gray-200 dark:border-gray-700',
          ]"
        >
          <input v-model="pdfChoice" type="radio" :value="opt.id" class="mt-1 accent-blue-600" />
          <span>
            <span class="block text-sm font-medium text-gray-800 dark:text-white/90">{{
              opt.title
            }}</span>
            <span class="block text-xs text-gray-500 dark:text-gray-400">{{ opt.sub }}</span>
          </span>
        </label>
      </div>
      <template #footer>
        <UiButton variant="secondary" @click="pdfPicker = false">Cancel</UiButton>
        <UiButton @click="print(pdfChoice || undefined)">
          <FileDown class="size-4" aria-hidden="true" /> Download
        </UiButton>
      </template>
    </UiModal>
  </div>
</template>
