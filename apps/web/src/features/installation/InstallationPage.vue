<script setup lang="ts">
import { ArrowLeft, FileDown, Plus, Save, Wrench } from 'lucide-vue-next'
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import type { CompanySummary, InstallationReport, TenderDetail } from '@tdm/shared'
import { ENGINEER_STATUS_LABELS, ENGINEER_STATUSES, INSTALL_STATUSES } from '@tdm/shared'
import { PERMISSIONS } from '@tdm/shared/permissions'
import { ACTION_ICONS } from '@/components/ui/actions'
import IconButton from '@/components/ui/IconButton.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiCard from '@/components/ui/UiCard.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import { api, errorMessage } from '@/services/api'
import { downloadFromApi } from '@/services/files'
import { useAuthStore } from '@/stores/auth'

interface Unit {
  id?: string
  itemName: string
  makeModel: string
  serialNumber: string
  monitorSerial: string
  cpuSerial: string
  installStatus: (typeof INSTALL_STATUSES)[number]
  installedOn: string
  warrantyMonths: number
  remarks: string
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
  status: (typeof ENGINEER_STATUSES)[number]
  callAlignedDate: string
  showSplitSerials: boolean
  assets: Unit[]
}

const route = useRoute()
const auth = useAuthStore()
const tenderId = route.params.id as string
const canEdit = auth.can(PERMISSIONS.INSTALLATION_MANAGE)

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
const loadError = ref('')
const error = ref('')
const saved = ref('')
const saving = ref(false)
const dirty = ref(false)

let keySeq = 0
const nextKey = () => `c${++keySeq}`

const s = (v: string | null | undefined) => v ?? ''
const blankUnit = (itemName = '', warrantyMonths = 0): Unit => ({
  itemName,
  makeModel: '',
  serialNumber: '',
  monitorSerial: '',
  cpuSerial: '',
  installStatus: 'pending',
  installedOn: '',
  warrantyMonths,
  remarks: '',
})

function fromReport(r: InstallationReport) {
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
    status: c.status,
    callAlignedDate: s(c.callAlignedDate),
    showSplitSerials: c.assets.some((a) => a.monitorSerial || a.cpuSerial),
    assets: c.assets.map((a) => ({
      id: a.id,
      itemName: a.itemName,
      makeModel: s(a.makeModel),
      serialNumber: s(a.serialNumber),
      monitorSerial: s(a.monitorSerial),
      cpuSerial: s(a.cpuSerial),
      installStatus: a.installStatus,
      installedOn: s(a.installedOn),
      warrantyMonths: a.warrantyMonths,
      remarks: s(a.remarks),
    })),
  }))
  dirty.value = false
}

onMounted(async () => {
  try {
    const [t, r, c, e] = await Promise.all([
      api.get<TenderDetail>(`/tenders/${tenderId}`),
      api.get<InstallationReport | null>(`/tenders/${tenderId}/installation-report`),
      api.get<CompanySummary[]>('/companies'),
      api.get<{ id: string; name: string }[]>('/assets/engineers'),
    ])
    tender.value = t.data
    companies.value = c.data
    engineers.value = e.data
    if (r.data) fromReport(r.data)
    else {
      // New report: start from what we know about the tender.
      header.value.biddingCompanyId = t.data.biddingCompany?.id ?? ''
      header.value.poNumber = t.data.awardNumber ?? ''
      header.value.customerName = t.data.buyerOrganization ?? ''
      addConsignee()
      dirty.value = false
    }
  } catch (err) {
    loadError.value = errorMessage(err)
  }
})

function addConsignee() {
  consignees.value.push({
    key: nextKey(),
    name: '',
    designation: '',
    phone: '',
    email: '',
    fax: '',
    engineerId: '',
    status: 'assigned',
    callAlignedDate: '',
    showSplitSerials: false,
    assets: [],
  })
  dirty.value = true
}

/** Adds several units of the same item at once (one row per serial number). */
const quick = ref<Record<string, { item: string; qty: number; warrantyYears: number }>>({})
function quickOf(key: string) {
  return (quick.value[key] ??= { item: '', qty: 1, warrantyYears: 1 })
}
function addUnits(c: Consignee) {
  const q = quickOf(c.key)
  const qty = Math.min(Math.max(1, Math.floor(q.qty) || 1), 500)
  for (let i = 0; i < qty; i++)
    c.assets.push(blankUnit(q.item.trim() || 'Item', Math.max(0, q.warrantyYears) * 12))
  q.item = ''
  q.qty = 1
  dirty.value = true
}

function removeUnit(c: Consignee, index: number) {
  c.assets.splice(index, 1)
  dirty.value = true
}

function removeConsignee(i: number) {
  const c = consignees.value[i]!
  if (
    c.assets.length &&
    !confirm(`Remove ${c.name || 'this consignee'} and its ${c.assets.length} unit(s)?`)
  )
    return
  consignees.value.splice(i, 1)
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
const totalUnits = computed(() => consignees.value.reduce((n, c) => n + c.assets.length, 0))

async function save() {
  error.value = ''
  saved.value = ''
  const missing = consignees.value.findIndex((c) => !c.name.trim())
  if (missing >= 0) {
    error.value = `Consignee ${missing + 1} needs a name.`
    return
  }
  saving.value = true
  try {
    const { data } = await api.put<InstallationReport>(`/tenders/${tenderId}/installation-report`, {
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
        assets: c.assets.map((a) => ({ ...a, warrantyMonths: Number(a.warrantyMonths) || 0 })),
      })),
    })
    fromReport(data)
    saved.value = 'Installation report saved.'
  } catch (err) {
    error.value = errorMessage(err)
  } finally {
    saving.value = false
  }
}

async function print(consigneeId?: string) {
  error.value = ''
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
  'h-9 w-full rounded-md border border-gray-300 bg-transparent px-2 text-theme-sm dark:border-gray-700 dark:text-white/90'
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
        :description="`${tender.buyerOrganization ?? tender.referenceNo} · ${consignees.length} consignee(s), ${totalUnits} unit(s)`"
      >
        <template #actions>
          <UiButton
            variant="secondary"
            :disabled="dirty || !consignees.some((c) => c.id)"
            @click="print()"
          >
            <FileDown class="size-4" aria-hidden="true" /> Print Report
          </UiButton>
          <UiButton v-if="canEdit" :loading="saving" :disabled="!dirty" @click="save">
            <Save class="size-4" aria-hidden="true" /> Save
          </UiButton>
        </template>
      </PageHeader>

      <UiAlert v-if="error" class="mb-4">{{ error }}</UiAlert>
      <UiAlert v-else-if="saved && !dirty" variant="success" class="mb-4">{{ saved }}</UiAlert>
      <UiAlert v-if="dirty && canEdit" variant="info" class="mb-4"
        >You have unsaved changes.</UiAlert
      >

      <fieldset :disabled="!canEdit" class="space-y-6">
        <UiCard title="Order Details">
          <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <UiInput v-model="header.poNumber" label="Purchase order no." />
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
            <UiInput v-model="header.contactPersonDesignation" label="Designation" />
            <UiInput v-model="header.contactPersonPhone" label="Phone" />
            <UiSelect
              v-model="header.biddingCompanyId"
              label="Letterhead"
              :options="companyOptions"
            />
          </div>
        </UiCard>

        <UiCard
          v-for="(c, ci) in consignees"
          :key="c.key"
          :title="`Consignee ${ci + 1}${c.name ? `: ${c.name}` : ''}`"
        >
          <template #header>
            <IconButton
              v-if="c.id"
              :icon="ACTION_ICONS.download"
              :label="dirty ? 'Save first to print this consignee' : 'Print this consignee'"
              :disabled="dirty"
              @click="print(c.id)"
            />
            <IconButton
              v-if="canEdit"
              :icon="ACTION_ICONS.delete"
              :label="`Remove consignee ${ci + 1}`"
              variant="danger"
              @click="removeConsignee(ci)"
            />
          </template>
          <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <UiInput v-model="c.name" label="Name" required />
            <UiInput v-model="c.designation" label="Designation" />
            <UiInput v-model="c.phone" label="Contact number" />
            <UiInput v-model="c.email" label="Email" type="email" />
            <UiInput v-model="c.fax" label="Fax" />
            <UiInput v-model="c.callAlignedDate" label="Call aligned date" type="date" />
            <UiSelect v-model="c.engineerId" label="Engineer" :options="engineerOptions" />
            <UiSelect v-model="c.status" label="Engineer status" :options="statusOptions" />
          </div>

          <div class="mt-6 flex flex-wrap items-center justify-between gap-3">
            <h3
              class="text-sm font-semibold tracking-wider text-gray-700 uppercase dark:text-gray-300"
            >
              Installed Units ({{ c.assets.length }})
            </h3>
            <label class="flex items-center gap-2 text-theme-sm text-gray-600 dark:text-gray-400">
              <input
                v-model="c.showSplitSerials"
                type="checkbox"
                class="size-4 rounded border-gray-300"
              />
              Separate monitor and CPU serial numbers
            </label>
          </div>

          <div v-if="c.assets.length" class="custom-scrollbar mt-3 overflow-x-auto">
            <table class="min-w-[960px] text-theme-sm">
              <thead class="bg-gray-50 dark:bg-gray-800">
                <tr
                  class="border-b border-gray-200 text-left text-sm text-gray-800 dark:border-gray-800 dark:text-white/90"
                >
                  <th class="w-10 p-2 font-medium">#</th>
                  <th class="p-2 font-medium">Item</th>
                  <th class="p-2 font-medium">Make / model</th>
                  <template v-if="c.showSplitSerials">
                    <th class="p-2 font-medium">Monitor serial</th>
                    <th class="p-2 font-medium">CPU serial</th>
                  </template>
                  <th v-else class="p-2 font-medium">Serial number</th>
                  <th class="w-32 p-2 font-medium">Installed</th>
                  <th class="w-36 p-2 font-medium">Installed on</th>
                  <th class="w-24 p-2 font-medium">Warranty (months)</th>
                  <th class="p-2 font-medium">Remarks</th>
                  <th class="w-10" />
                </tr>
              </thead>
              <tbody>
                <tr v-for="(a, ai) in c.assets" :key="a.id ?? `n${ai}`">
                  <td class="py-1 pr-2 text-gray-500 tabular-nums">{{ ai + 1 }}</td>
                  <td class="py-1 pr-2">
                    <input v-model="a.itemName" :class="cell" aria-label="Item" />
                  </td>
                  <td class="py-1 pr-2">
                    <input v-model="a.makeModel" :class="cell" aria-label="Make and model" />
                  </td>
                  <template v-if="c.showSplitSerials">
                    <td class="py-1 pr-2">
                      <input v-model="a.monitorSerial" :class="cell" aria-label="Monitor serial" />
                    </td>
                    <td class="py-1 pr-2">
                      <input v-model="a.cpuSerial" :class="cell" aria-label="CPU serial" />
                    </td>
                  </template>
                  <td v-else class="py-1 pr-2">
                    <input v-model="a.serialNumber" :class="cell" aria-label="Serial number" />
                  </td>
                  <td class="py-1 pr-2">
                    <UiSelect
                      v-model="a.installStatus"
                      aria-label="Installed"
                      size="sm"
                      :options="[
                        { value: 'pending', label: 'Pending' },
                        { value: 'installed', label: 'Yes' },
                        { value: 'not_installed', label: 'No' },
                      ]"
                    />
                  </td>
                  <td class="py-1 pr-2">
                    <input
                      v-model="a.installedOn"
                      type="date"
                      :class="cell"
                      aria-label="Installed on"
                    />
                  </td>
                  <td class="py-1 pr-2">
                    <input
                      v-model.number="a.warrantyMonths"
                      type="number"
                      min="0"
                      max="240"
                      :class="cell"
                      aria-label="Warranty months"
                    />
                  </td>
                  <td class="py-1 pr-2">
                    <input v-model="a.remarks" :class="cell" aria-label="Remarks" />
                  </td>
                  <td class="py-1">
                    <IconButton
                      v-if="canEdit"
                      :icon="ACTION_ICONS.delete"
                      :label="`Remove unit ${ai + 1}`"
                      variant="danger"
                      @click="removeUnit(c, ai)"
                    />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div
            v-if="canEdit"
            class="mt-4 flex flex-wrap items-end gap-3 rounded-lg bg-gray-50 p-3 dark:bg-white/5"
          >
            <div class="min-w-56 flex-1">
              <label
                class="mb-1 block text-theme-xs font-medium text-gray-600 dark:text-gray-400"
                :for="`q-item-${c.key}`"
                >Add units: item</label
              >
              <input
                :id="`q-item-${c.key}`"
                v-model="quickOf(c.key).item"
                class="form-field h-9"
                placeholder="e.g. Desktop i5 16GB"
              />
            </div>
            <div class="w-24">
              <label
                class="mb-1 block text-theme-xs font-medium text-gray-600 dark:text-gray-400"
                :for="`q-qty-${c.key}`"
                >Quantity</label
              >
              <input
                :id="`q-qty-${c.key}`"
                v-model.number="quickOf(c.key).qty"
                type="number"
                min="1"
                max="500"
                class="form-field h-9"
              />
            </div>
            <div class="w-32">
              <label
                class="mb-1 block text-theme-xs font-medium text-gray-600 dark:text-gray-400"
                :for="`q-w-${c.key}`"
                >Warranty (years)</label
              >
              <input
                :id="`q-w-${c.key}`"
                v-model.number="quickOf(c.key).warrantyYears"
                type="number"
                min="0"
                max="20"
                class="form-field h-9"
              />
            </div>
            <UiButton size="sm" variant="secondary" @click="addUnits(c)"
              ><Plus class="size-4" aria-hidden="true" /> Add</UiButton
            >
          </div>
        </UiCard>
      </fieldset>

      <UiButton v-if="canEdit" class="mt-6" @click="addConsignee">
        <Plus class="size-4" aria-hidden="true" /> Add consignee
      </UiButton>
    </template>
    <p v-else class="text-sm text-gray-500">Loading…</p>
  </div>
</template>
