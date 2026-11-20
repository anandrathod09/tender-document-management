<script setup lang="ts">
import { Check, CreditCard, Mail, Pencil, Receipt } from 'lucide-vue-next'
import { computed, onMounted, ref } from 'vue'
import {
  GST_STATES,
  type BillingCycle,
  type BillingOverview,
  type CheckoutOrder,
  type PaymentSummary,
  type PlanDetail,
  type PriceBreakdown,
} from '@tdm/shared'
import { ACTION_ICONS } from '@/components/ui/actions'
import DataTable from '@/components/ui/DataTable.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import IconButton from '@/components/ui/IconButton.vue'
import ModalCallout from '@/components/ui/ModalCallout.vue'
import ModalNote from '@/components/ui/ModalNote.vue'
import type { TableColumn } from '@/components/ui/table'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiBadge from '@/components/ui/UiBadge.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiCard from '@/components/ui/UiCard.vue'
import UiModal from '@/components/ui/UiModal.vue'
import { api, errorMessage } from '@/services/api'
import { downloadFromApi, formatBytes } from '@/services/files'
import { formatDate } from '@/utils/format'
import BillingDetailsDialog from './BillingDetailsDialog.vue'
import { payWithRazorpay } from './razorpay'

/**
 * The client's plan, usage, renewal and invoices. Online payment goes through
 * Razorpay; without it (or for plans without a price) we ask them to contact us.
 */
const data = ref<BillingOverview | null>(null)
const loading = ref(true)
const error = ref('')
const notice = ref('')
const cycle = ref<BillingCycle>('monthly')
const detailsOpen = ref(false)

// Paying
const chosen = ref<PlanDetail | null>(null)
const breakdown = ref<PriceBreakdown | null>(null)
const paying = ref(false)
const payError = ref('')
/** Opened after saving details, when someone wanted to pay first. */
const payAfterDetails = ref<PlanDetail | null>(null)

async function load() {
  try {
    data.value = (await api.get<BillingOverview>('/billing')).data
    if (data.value.cycle) cycle.value = data.value.cycle
  } catch (err) {
    error.value = errorMessage(err)
  } finally {
    loading.value = false
  }
}
onMounted(load)

const GB = 1024 ** 3
const meters = computed(() => {
  const d = data.value
  if (!d) return []
  return [
    {
      label: 'Users',
      used: d.usage.users,
      max: d.plan.maxUsers,
      text: `${d.usage.users} of ${d.plan.maxUsers}`,
    },
    {
      label: 'Storage',
      used: d.usage.storageBytes / GB,
      max: d.plan.maxStorageGb,
      text: `${formatBytes(d.usage.storageBytes)} of ${d.plan.maxStorageGb} GB`,
    },
    {
      label: 'Tenders added this month',
      used: d.usage.tendersThisMonth,
      max: d.plan.maxTendersPerMonth,
      text: `${d.usage.tendersThisMonth.toLocaleString('en-IN')} of ${d.plan.maxTendersPerMonth.toLocaleString('en-IN')}`,
    },
    {
      label: 'Bidding companies',
      used: d.usage.companies,
      max: d.plan.maxCompanies,
      text: `${d.usage.companies} of ${d.plan.maxCompanies}`,
    },
  ]
})
const pct = (used: number, max: number) => Math.min(100, Math.round((used / max) * 100))

const daysLeft = computed(() =>
  data.value?.endsAt ? Math.ceil((Date.parse(data.value.endsAt) - Date.now()) / 86_400_000) : null,
)

const price = (p: PlanDetail) => (cycle.value === 'yearly' ? p.priceYearlyInr : p.priceMonthlyInr)
const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`
const hasYearly = computed(() => data.value?.plans.some((p) => p.priceYearlyInr) ?? false)
const isCurrent = (p: PlanDetail) => p.id === data.value?.plan.id
const stateName = (code: string | null) =>
  code ? (GST_STATES.find((s) => s.code === code)?.name ?? code) : '—'
const contactHref = computed(() =>
  data.value?.supportEmail
    ? `mailto:${data.value.supportEmail}?subject=${encodeURIComponent('Plan renewal')}`
    : '',
)

async function choose(p: PlanDetail) {
  payError.value = ''
  notice.value = ''
  const d = data.value
  if (!d) return
  if (!d.details.billingName || !d.details.billingStateCode) {
    payAfterDetails.value = p
    detailsOpen.value = true
    return
  }
  chosen.value = p
  breakdown.value = null
  try {
    breakdown.value = (
      await api.post<PriceBreakdown>('/billing/quote', { planId: p.id, cycle: cycle.value })
    ).data
  } catch (err) {
    payError.value = errorMessage(err)
  }
}

async function pay() {
  const p = chosen.value
  if (!p) return
  payError.value = ''
  paying.value = true
  try {
    const order = (
      await api.post<CheckoutOrder>('/billing/checkout', { planId: p.id, cycle: cycle.value })
    ).data
    const proof = await payWithRazorpay(order)
    if (!proof) return // closed the payment window
    const { data: paid } = await api.post<PaymentSummary>('/billing/confirm', {
      paymentId: order.paymentId,
      razorpayOrderId: proof.razorpay_order_id,
      razorpayPaymentId: proof.razorpay_payment_id,
      razorpaySignature: proof.razorpay_signature,
    })
    chosen.value = null
    notice.value = `Payment of ${inr(paid.totalAmount)} received. Thank you! Invoice ${paid.invoiceNumber} is ready below.`
    await load()
  } catch (err) {
    payError.value = errorMessage(err)
  } finally {
    paying.value = false
  }
}

function onDetailsSaved(overview: BillingOverview) {
  data.value = overview
  detailsOpen.value = false
  notice.value = 'Billing details saved.'
  const next = payAfterDetails.value
  payAfterDetails.value = null
  if (next) void choose(next)
}

async function downloadInvoice(p: PaymentSummary) {
  error.value = ''
  try {
    await downloadFromApi(`/billing/payments/${p.id}/invoice.pdf`, undefined, 'Invoice.pdf')
  } catch (err) {
    error.value = errorMessage(err)
  }
}

const historyColumns: TableColumn[] = [
  { key: 'paidAt', label: 'Date' },
  { key: 'invoiceNumber', label: 'Invoice No' },
  { key: 'plan', label: 'Plan' },
  { key: 'period', label: 'Period' },
  { key: 'totalAmount', label: 'Amount' },
  { key: 'method', label: 'Paid By' },
  { key: 'status', label: 'Status' },
]
</script>

<template>
  <div class="space-y-6">
    <UiAlert v-if="error">{{ error }}</UiAlert>
    <UiAlert v-if="notice" variant="success">{{ notice }}</UiAlert>

    <div
      v-if="loading"
      class="flex items-center justify-center gap-2 py-12 text-sm text-gray-700 dark:text-gray-300"
      role="status"
    >
      <span
        class="size-6 animate-spin rounded-full border-2 border-blue-600 border-t-transparent"
        aria-hidden="true"
      />
      Loading billing...
    </div>

    <template v-else-if="data">
      <!-- Status and usage -->
      <UiCard
        :level="1"
        title="Billing"
        subtitle="Your plan, usage, renewals and invoices."
        :icon="CreditCard"
      >
        <div class="space-y-5">
          <ModalCallout
            v-if="data.state === 'trial'"
            tone="info"
            :lead="data.endsAt ? 'Free trial: ' : 'Free trial'"
          >
            <template v-if="data.endsAt">
              ends on {{ formatDate(data.endsAt) }} ({{ daysLeft }} day{{
                daysLeft === 1 ? '' : 's'
              }}
              left). Choose a plan below to keep going without interruption.
            </template>
          </ModalCallout>
          <ModalCallout v-else-if="data.state === 'grace'" tone="warning" lead="Renewal due: ">
            your plan ended on {{ formatDate(data.endsAt) }}. Please renew before
            {{ formatDate(data.graceEndsAt) }} to avoid interruption.
          </ModalCallout>
          <ModalCallout v-else-if="data.state === 'expired'" tone="danger" lead="Expired: ">
            your plan ended on {{ formatDate(data.endsAt) }}. Renew below to continue.
          </ModalCallout>

          <div class="grid gap-6 lg:grid-cols-3">
            <div class="rounded-lg bg-gray-50 p-4 dark:bg-gray-900">
              <p class="text-xs text-gray-500 dark:text-gray-400">Current plan</p>
              <p class="mt-1 flex items-center gap-2 text-xl text-gray-800 dark:text-white/90">
                {{ data.plan.name }}
                <UiBadge
                  :color="
                    data.state === 'active'
                      ? 'success'
                      : data.state === 'trial'
                        ? 'info'
                        : data.state === 'grace'
                          ? 'warning'
                          : 'error'
                  "
                >
                  {{
                    data.state === 'active'
                      ? 'Active'
                      : data.state === 'trial'
                        ? 'Trial'
                        : data.state === 'grace'
                          ? 'Renewal due'
                          : 'Expired'
                  }}
                </UiBadge>
              </p>
              <p class="mt-2 text-sm text-gray-600 dark:text-gray-400">
                <template v-if="data.state === 'active' && data.endsAt">
                  Paid until <strong>{{ formatDate(data.endsAt) }}</strong>
                  <template v-if="data.cycle"> · billed {{ data.cycle }}</template>
                </template>
                <template v-else-if="data.endsAt">
                  {{ data.state === 'trial' ? 'Trial ends' : 'Ended' }}
                  {{ formatDate(data.endsAt) }}
                </template>
              </p>
            </div>
            <div class="space-y-4 lg:col-span-2">
              <div v-for="m in meters" :key="m.label">
                <div class="mb-1 flex justify-between text-sm">
                  <span class="text-gray-700 dark:text-gray-300">{{ m.label }}</span>
                  <span class="text-gray-500 dark:text-gray-400">{{ m.text }}</span>
                </div>
                <div
                  class="h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800"
                  role="meter"
                  :aria-label="m.label"
                  :aria-valuenow="pct(m.used, m.max)"
                  aria-valuemin="0"
                  aria-valuemax="100"
                >
                  <div
                    :class="[
                      'h-full rounded-full',
                      pct(m.used, m.max) >= 90
                        ? 'bg-red-500'
                        : pct(m.used, m.max) >= 75
                          ? 'bg-orange-500'
                          : 'bg-blue-500',
                    ]"
                    :style="{ width: `${pct(m.used, m.max)}%` }"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </UiCard>

      <!-- Plans -->
      <UiCard
        title="Choose a Plan"
        :subtitle="`Prices ${data.pricesIncludeGst ? 'include' : 'are before'} GST (${data.gstRatePercent}%). Paying adds a full period after your current one ends.`"
      >
        <template v-if="hasYearly" #header>
          <div
            class="inline-flex rounded-md bg-gray-100 p-1 dark:bg-gray-900"
            role="radiogroup"
            aria-label="Billing cycle"
          >
            <button
              v-for="c in ['monthly', 'yearly'] as const"
              :key="c"
              type="button"
              role="radio"
              :aria-checked="cycle === c"
              :class="[
                'rounded px-3 py-1.5 text-sm capitalize',
                cycle === c
                  ? 'bg-white text-gray-900 shadow-theme-xs dark:bg-gray-800 dark:text-white'
                  : 'text-gray-500 hover:text-gray-800 dark:text-gray-400',
              ]"
              @click="cycle = c"
            >
              {{ c }}
            </button>
          </div>
        </template>

        <ModalCallout v-if="!data.onlinePayment" tone="info" lead="Renewals: " class="mb-4">
          online payment is not switched on yet. To renew or change plan,
          <a v-if="contactHref" :href="contactHref" class="font-medium underline">
            write to {{ data.supportEmail }}
          </a>
          <template v-else>contact us</template>, and we will send you the bank details.
        </ModalCallout>

        <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <div
            v-for="p in data.plans"
            :key="p.id"
            :class="[
              'flex flex-col rounded-lg border p-5',
              isCurrent(p)
                ? 'border-blue-400 ring-1 ring-blue-400'
                : 'border-gray-200 dark:border-gray-800',
            ]"
          >
            <div class="flex items-center justify-between gap-2">
              <h3 class="text-lg font-medium text-gray-800 dark:text-white/90">{{ p.name }}</h3>
              <UiBadge v-if="isCurrent(p)" color="info">Current</UiBadge>
            </div>
            <p v-if="p.description" class="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {{ p.description }}
            </p>
            <p class="mt-4 text-3xl text-gray-800 dark:text-white/90">
              <template v-if="price(p)">
                {{ inr(price(p)!) }}
                <span class="text-sm text-gray-500"
                  >/{{ cycle === 'yearly' ? 'year' : 'month' }}</span
                >
              </template>
              <span v-else class="text-xl">Price on request</span>
            </p>
            <ul class="mt-4 flex-1 space-y-1.5 text-sm text-gray-600 dark:text-gray-400">
              <li
                v-for="f in [
                  `Up to ${p.maxUsers} users`,
                  `${p.maxStorageGb} GB storage`,
                  `${p.maxTendersPerMonth.toLocaleString('en-IN')} tenders a month`,
                  `${p.maxCompanies} bidding ${p.maxCompanies === 1 ? 'company' : 'companies'}`,
                ]"
                :key="f"
                class="flex items-center gap-2"
              >
                <Check class="size-4 shrink-0 text-[#7AA90D]" aria-hidden="true" /> {{ f }}
              </li>
            </ul>
            <div class="mt-5">
              <UiButton
                v-if="data.onlinePayment && price(p)"
                block
                :variant="isCurrent(p) ? 'primary' : 'secondary'"
                @click="choose(p)"
              >
                {{ isCurrent(p) ? 'Renew' : 'Choose' }} · {{ inr(price(p)!) }}
              </UiButton>
              <a
                v-else
                :href="contactHref || undefined"
                class="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-gray-200 text-sm text-gray-700 hover:bg-gray-300 dark:bg-white/5 dark:text-white/90"
              >
                <Mail class="size-4" aria-hidden="true" /> Contact us
              </a>
            </div>
          </div>
        </div>
      </UiCard>

      <!-- Bill to -->
      <UiCard title="Billing Details" :icon="Receipt">
        <template #header>
          <UiButton size="xs" variant="secondary" @click="detailsOpen = true">
            <Pencil class="size-4" aria-hidden="true" /> Edit
          </UiButton>
        </template>
        <dl
          v-if="data.details.billingName"
          class="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4"
        >
          <div>
            <dt class="text-xs text-gray-500 dark:text-gray-400">Company name</dt>
            <dd class="font-medium text-gray-800 dark:text-white/90">
              {{ data.details.billingName }}
            </dd>
            <dd
              v-if="data.details.billingAddress"
              class="whitespace-pre-line text-gray-600 dark:text-gray-400"
            >
              {{ data.details.billingAddress }}
            </dd>
          </div>
          <div>
            <dt class="text-xs text-gray-500 dark:text-gray-400">GSTIN</dt>
            <dd class="font-medium text-gray-800 dark:text-white/90">
              {{ data.details.billingGstin ?? 'Not registered' }}
            </dd>
          </div>
          <div>
            <dt class="text-xs text-gray-500 dark:text-gray-400">State</dt>
            <dd class="font-medium text-gray-800 dark:text-white/90">
              {{ stateName(data.details.billingStateCode) }}
            </dd>
          </div>
          <div>
            <dt class="text-xs text-gray-500 dark:text-gray-400">Invoices and reminders to</dt>
            <dd class="font-medium text-gray-800 dark:text-white/90">
              {{ data.details.billingEmail ?? 'Admins only' }}
            </dd>
          </div>
        </dl>
        <p v-else class="text-sm text-gray-600 dark:text-gray-400">
          Add your company name, state and GSTIN so we can issue proper GST invoices.
        </p>
      </UiCard>

      <!-- History -->
      <UiCard title="Payment History">
        <DataTable :columns="historyColumns" :rows="data.payments">
          <template #cell-paidAt="{ row }">
            <span class="text-xs whitespace-nowrap">{{
              formatDate(row.paidAt ?? row.createdAt)
            }}</span>
          </template>
          <template #cell-invoiceNumber="{ row }">
            <span class="text-xs font-medium whitespace-nowrap">{{
              row.invoiceNumber ?? '—'
            }}</span>
          </template>
          <template #cell-plan="{ row }">
            <span class="text-xs">{{ row.plan.name }} · {{ row.cycle }}</span>
          </template>
          <template #cell-period="{ row }">
            <span class="text-xs whitespace-nowrap">
              {{ formatDate(row.periodStart) }} – {{ formatDate(row.periodEnd) }}
            </span>
          </template>
          <template #cell-totalAmount="{ row }">
            <span class="font-medium whitespace-nowrap">{{ inr(row.totalAmount) }}</span>
          </template>
          <template #cell-method="{ row }">
            <span class="text-xs">{{
              row.method === 'razorpay' ? 'Online' : 'Bank / cheque'
            }}</span>
          </template>
          <template #cell-status="{ row }">
            <UiBadge :color="row.status === 'paid' ? 'success' : 'error'">
              {{ row.status === 'paid' ? 'Paid' : 'Failed' }}
            </UiBadge>
          </template>
          <template #actions="{ row }">
            <IconButton
              v-if="row.status === 'paid' && row.invoiceNumber"
              :icon="ACTION_ICONS.download"
              :label="`Download invoice ${row.invoiceNumber}`"
              @click="downloadInvoice(row)"
            />
          </template>
          <template #empty>
            <EmptyState
              :icon="Receipt"
              title="No payments yet"
              description="Your invoices will appear here."
            />
          </template>
        </DataTable>
      </UiCard>
    </template>

    <BillingDetailsDialog
      v-if="data"
      :open="detailsOpen"
      :details="data.details"
      :fallback-name="data.details.billingName ?? ''"
      @close="((detailsOpen = false), (payAfterDetails = null))"
      @saved="onDetailsSaved"
    />

    <!-- Confirm and pay -->
    <UiModal
      :open="!!chosen"
      :title="`${chosen && isCurrent(chosen) ? 'Renew' : 'Change to'} ${chosen?.name ?? ''} Plan`"
      :busy="paying"
      @close="chosen = null"
    >
      <div class="space-y-4">
        <UiAlert v-if="payError">{{ payError }}</UiAlert>
        <div class="rounded-lg bg-gray-50 p-4 dark:bg-gray-900">
          <h3 class="mb-3 text-sm font-semibold text-gray-700 dark:text-gray-300">Order Summary</h3>
          <dl v-if="breakdown" class="space-y-1 text-sm">
            <div class="flex justify-between">
              <dt class="text-gray-600 dark:text-gray-400">
                {{ chosen?.name }} plan, 1 {{ cycle === 'yearly' ? 'year' : 'month' }}
              </dt>
              <dd class="font-medium">{{ inr(breakdown.baseAmount) }}</dd>
            </div>
            <template v-if="breakdown.igst">
              <div class="flex justify-between">
                <dt class="text-gray-600 dark:text-gray-400">
                  IGST @ {{ breakdown.gstRatePercent }}%
                </dt>
                <dd>{{ inr(breakdown.igst) }}</dd>
              </div>
            </template>
            <template v-else>
              <div class="flex justify-between">
                <dt class="text-gray-600 dark:text-gray-400">
                  CGST @ {{ breakdown.gstRatePercent / 2 }}%
                </dt>
                <dd>{{ inr(breakdown.cgst) }}</dd>
              </div>
              <div class="flex justify-between">
                <dt class="text-gray-600 dark:text-gray-400">
                  SGST @ {{ breakdown.gstRatePercent / 2 }}%
                </dt>
                <dd>{{ inr(breakdown.sgst) }}</dd>
              </div>
            </template>
            <div
              class="flex justify-between border-t border-gray-200 pt-2 text-base dark:border-gray-700"
            >
              <dt class="font-medium">Total</dt>
              <dd class="font-semibold">{{ inr(breakdown.totalAmount) }}</dd>
            </div>
          </dl>
          <p v-else class="text-sm text-gray-500">Working out the price…</p>
        </div>
        <ModalNote>
          The new plan starts now. The paid {{ cycle === 'yearly' ? 'year' : 'month' }} is added
          after your current period ends<template v-if="data?.endsAt">
            ({{ formatDate(data.endsAt) }})</template
          >. A GST invoice is ready as soon as the payment goes through.
        </ModalNote>
      </div>
      <template #footer>
        <UiButton variant="secondary" :disabled="paying" @click="chosen = null">Cancel</UiButton>
        <UiButton :loading="paying" :disabled="!breakdown" @click="pay">
          Pay {{ breakdown ? inr(breakdown.totalAmount) : '' }}
        </UiButton>
      </template>
    </UiModal>
  </div>
</template>
