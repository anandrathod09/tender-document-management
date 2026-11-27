<script setup lang="ts">
import { CircleCheck, LifeBuoy } from 'lucide-vue-next'
import { computed, onMounted, ref } from 'vue'
import type {
  PublicAsset,
  PublicTicketResult,
  SupportPageInfo,
  WarrantyCover,
} from '@tdm/shared'
import ThemeToggler from '@/components/ThemeToggler.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiTextarea from '@/components/ui/UiTextarea.vue'
import { api, errorMessage, fieldErrors } from '@/services/api'
import { formatDate } from '@/utils/format'

/**
 * Public page (no sign-in): a customer finds their product by serial number,
 * sees the warranty, and raises a service request. The client turns it on in
 * Manage → Settings.
 */
const info = ref<SupportPageInfo | null>(null)
const loadError = ref('')

const serial = ref('')
const searchedSerial = ref('')
const searching = ref(false)
const searchError = ref('')
const searched = ref(false)
const assets = ref<PublicAsset[]>([])
const selectedId = ref<string | null>(null)
const selected = computed(() => assets.value.find((a) => a.id === selectedId.value) ?? null)

const blankForm = () => ({
  contactName: '',
  contactPhone: '',
  contactEmail: '',
  description: '',
  website: '',
})
const form = ref(blankForm())
const errors = ref<Record<string, string>>({})
const submitting = ref(false)
const submitError = ref('')
const raised = ref<PublicTicketResult | null>(null)

onMounted(async () => {
  try {
    info.value = (await api.get<SupportPageInfo>('/support')).data
    document.title = `Product Support · ${info.value.name}`
  } catch (err) {
    loadError.value = errorMessage(err)
  }
})

async function search() {
  const value = serial.value.trim()
  if (!value) {
    searchError.value = 'Enter the serial number'
    return
  }
  searching.value = true
  searchError.value = ''
  assets.value = []
  selectedId.value = null
  submitError.value = ''
  try {
    assets.value = (await api.get<PublicAsset[]>('/support/assets', { params: { serial: value } }))
      .data
    searchedSerial.value = value
    searched.value = true
    if (assets.value.length === 1) selectedId.value = assets.value[0]!.id
  } catch (err) {
    searchError.value = errorMessage(err)
  } finally {
    searching.value = false
  }
}

async function submit() {
  if (!selected.value) return
  submitting.value = true
  submitError.value = ''
  errors.value = {}
  try {
    raised.value = (
      await api.post<PublicTicketResult>('/support/tickets', {
        ...form.value,
        serial: searchedSerial.value,
        assetId: selected.value.id,
      })
    ).data
  } catch (err) {
    errors.value = fieldErrors(err)
    if (!Object.keys(errors.value).length) submitError.value = errorMessage(err)
  } finally {
    submitting.value = false
  }
}

function startOver() {
  serial.value = ''
  searchedSerial.value = ''
  searched.value = false
  assets.value = []
  selectedId.value = null
  raised.value = null
  submitError.value = ''
  errors.value = {}
  form.value = blankForm()
}

function remaining(a: PublicAsset): string {
  if (a.daysLeft === null) return '—'
  if (a.daysLeft < 0) return 'Ended'
  if (a.daysLeft === 0) return 'Ends today'
  return a.daysLeft === 1 ? '1 day' : `${a.daysLeft} days`
}

const COVER: Record<WarrantyCover, { label: string; badge: string }> = {
  in: {
    label: 'In warranty',
    badge: 'bg-green-50 text-green-700 dark:bg-green-500/15 dark:text-green-400',
  },
  out: {
    label: 'Out of warranty',
    badge: 'bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-400',
  },
  unknown: {
    label: 'Warranty not recorded',
    badge: 'bg-gray-100 text-gray-700 dark:bg-white/10 dark:text-gray-300',
  },
}

const card =
  'rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]'
</script>

<template>
  <div class="min-h-screen bg-gray-50 px-4 py-10 dark:bg-gray-950">
    <div class="mx-auto w-full max-w-xl">
      <header class="mb-6 text-center">
        <span
          class="mx-auto mb-3 flex size-11 items-center justify-center rounded-full bg-blue-50 text-blue-500 dark:bg-blue-500/10"
        >
          <LifeBuoy class="size-5" aria-hidden="true" />
        </span>
        <h1 class="text-2xl font-semibold text-gray-800 dark:text-white">Product Support</h1>
        <p v-if="info" class="mt-1 text-sm font-medium text-gray-600 dark:text-gray-300">
          {{ info.name }}
        </p>
        <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Check your product's warranty by serial number and raise a service request.
        </p>
      </header>

      <UiAlert v-if="loadError">{{ loadError }}</UiAlert>

      <div v-else-if="info && !info.enabled" :class="[card, 'text-center']">
        <p class="text-sm text-gray-600 dark:text-gray-300">
          {{ info.name }} does not take service requests online. Please contact them directly.
        </p>
      </div>

      <template v-else-if="info">
        <!-- Request raised -->
        <div
          v-if="raised"
          class="rounded-xl border border-green-200 bg-white p-6 text-center dark:border-green-500/30 dark:bg-white/[0.03]"
        >
          <CircleCheck class="mx-auto mb-2 size-8 text-green-500" aria-hidden="true" />
          <p class="text-sm text-gray-500 dark:text-gray-400">Your request has been registered</p>
          <p class="mt-1 text-2xl font-semibold text-gray-800 dark:text-white">
            {{ raised.ticketNo }}
          </p>
          <p class="mt-3 text-sm text-gray-600 dark:text-gray-300">
            Please keep this ticket number. Our team will contact you on the phone number you gave.
          </p>
          <p v-if="raised.warranty === 'out'" class="mt-2 text-sm text-red-600 dark:text-red-400">
            This product is out of warranty, so the service may be chargeable.
          </p>
          <UiButton variant="ghost" size="sm" class="mt-4" @click="startOver">
            Check another product
          </UiButton>
        </div>

        <template v-else>
          <!-- Step 1: serial number -->
          <form :class="card" novalidate @submit.prevent="search">
            <label for="serial" class="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
              Serial number
            </label>
            <div class="flex flex-col gap-2 sm:flex-row">
              <input
                id="serial"
                v-model="serial"
                type="text"
                maxlength="100"
                autocomplete="off"
                placeholder="e.g. SN-ABC-0001"
                class="form-field"
              />
              <UiButton type="submit" :loading="searching" class="shrink-0">Check</UiButton>
            </div>
            <p class="mt-1.5 text-xs text-gray-400">
              You'll find it on the sticker on the back or bottom of the product.
            </p>
            <p v-if="searchError" class="mt-2 text-sm text-red-600 dark:text-red-400">
              {{ searchError }}
            </p>
            <p
              v-else-if="searched && !assets.length"
              class="mt-2 text-sm text-red-600 dark:text-red-400"
            >
              No product with this serial number was found. Check the number and try again.
            </p>
          </form>

          <!-- Step 2: pick the product (only when one serial matches several) -->
          <div v-if="assets.length > 1" :class="[card, 'mt-4']">
            <p class="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">
              More than one product has this serial. Choose yours:
            </p>
            <label
              v-for="a in assets"
              :key="a.id"
              :class="[
                'mb-2 flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm last:mb-0',
                selectedId === a.id
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-500/10'
                  : 'border-gray-200 dark:border-gray-700',
              ]"
            >
              <input v-model="selectedId" type="radio" :value="a.id" class="mt-0.5" />
              <span>
                <span class="font-medium text-gray-800 dark:text-white">{{ a.itemName }}</span>
                <span class="block text-xs text-gray-500 dark:text-gray-400">
                  {{ a.customerName || 'Customer not recorded' }} · Installed
                  {{ formatDate(a.installedOn) }}
                </span>
              </span>
            </label>
          </div>

          <!-- Step 3: product and warranty -->
          <div v-if="selected" :class="[card, 'mt-4']">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div class="min-w-0">
                <p class="text-base font-semibold text-gray-800 dark:text-white">
                  {{ selected.itemName }}
                </p>
                <p class="text-xs break-all text-gray-500 dark:text-gray-400">
                  Serial: {{ selected.serialNumber }}
                </p>
              </div>
              <span
                :class="['rounded-full px-2.5 py-1 text-xs font-medium', COVER[selected.warranty].badge]"
              >
                {{ COVER[selected.warranty].label }}
              </span>
            </div>
            <dl class="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt class="text-gray-500 dark:text-gray-400">Customer</dt>
                <dd class="font-medium text-gray-800 dark:text-white/90">
                  {{ selected.customerName || '—' }}
                </dd>
              </div>
              <div>
                <dt class="text-gray-500 dark:text-gray-400">Installed on</dt>
                <dd class="font-medium text-gray-800 dark:text-white/90">
                  {{ formatDate(selected.installedOn) }}
                </dd>
              </div>
              <div>
                <dt class="text-gray-500 dark:text-gray-400">Warranty until</dt>
                <dd class="font-medium text-gray-800 dark:text-white/90">
                  {{ formatDate(selected.warrantyEnd) }}
                </dd>
              </div>
              <div>
                <dt class="text-gray-500 dark:text-gray-400">Remaining</dt>
                <dd class="font-medium text-gray-800 dark:text-white/90">
                  {{ remaining(selected) }}
                </dd>
              </div>
            </dl>
          </div>

          <!-- Step 4: the request -->
          <form v-if="selected" :class="[card, 'mt-4 space-y-4']" novalidate @submit.prevent="submit">
            <h2 class="text-base font-semibold text-gray-800 dark:text-white">
              Raise a service request
            </h2>
            <p
              v-if="selected.warranty === 'out'"
              class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-400"
            >
              This product is out of warranty. You can still raise a request, but the service may
              be chargeable.
            </p>
            <p
              v-else-if="selected.warranty === 'unknown'"
              class="rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-700 dark:bg-white/5 dark:text-gray-300"
            >
              We don't have the warranty details for this product yet. Our team will check them
              when they contact you.
            </p>

            <!-- Hidden from people; bots fill it in. -->
            <input
              v-model="form.website"
              type="text"
              name="website"
              tabindex="-1"
              autocomplete="off"
              class="hidden"
              aria-hidden="true"
            />

            <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <UiInput
                v-model="form.contactName"
                label="Your name"
                required
                autocomplete="name"
                :error="errors.contactName"
              />
              <UiInput
                v-model="form.contactPhone"
                label="Phone"
                type="tel"
                required
                autocomplete="tel"
                :error="errors.contactPhone"
              />
            </div>
            <UiInput
              v-model="form.contactEmail"
              label="Email (optional)"
              type="email"
              autocomplete="email"
              :error="errors.contactEmail"
            />
            <UiTextarea
              v-model="form.description"
              label="What's the problem?"
              required
              :rows="4"
              :maxlength="2000"
              :hint="`${form.description.length}/2000`"
              :error="errors.description"
            />

            <UiAlert v-if="submitError">{{ submitError }}</UiAlert>
            <UiButton type="submit" block :loading="submitting">Submit Request</UiButton>
          </form>
        </template>
      </template>
    </div>

    <div class="fixed right-6 bottom-6 z-50">
      <ThemeToggler />
    </div>
  </div>
</template>
