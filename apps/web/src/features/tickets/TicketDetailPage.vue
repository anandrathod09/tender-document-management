<script setup lang="ts">
import { ArrowLeft, History, Star } from 'lucide-vue-next'
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import type { TicketDetail, TicketStatus } from '@tdm/shared'
import { TICKET_PRIORITIES, TICKET_STATUS_LABELS } from '@tdm/shared'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiBadge from '@/components/ui/UiBadge.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiCard from '@/components/ui/UiCard.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import { api, errorMessage, fieldErrors } from '@/services/api'
import { formatDateTime } from '@/utils/format'
import { cap, priorityColor, statusColor, ticketNo } from './ticketUi'

const route = useRoute()
const id = route.params.id as string
const ticket = ref<TicketDetail | null>(null)
const people = ref<{ id: string; name: string }[]>([])
const loadError = ref('')
const error = ref('')
const errors = ref<Record<string, string>>({})
const saving = ref(false)

const status = ref<TicketStatus>('new')
const priority = ref('medium')
const assignedTo = ref('')
const oemReference = ref('')
const resolutionNotes = ref('')
const note = ref('')

function apply(t: TicketDetail) {
  ticket.value = t
  status.value = t.status
  priority.value = t.priority
  assignedTo.value = t.assignedTo?.id ?? ''
  oemReference.value = t.oemReference ?? ''
  resolutionNotes.value = t.resolutionNotes ?? ''
  note.value = ''
}

onMounted(async () => {
  try {
    const [t, p] = await Promise.all([
      api.get<TicketDetail>(`/tickets/${id}`),
      api.get('/assets/engineers'),
    ])
    apply(t.data)
    people.value = p.data
  } catch (err) {
    loadError.value = errorMessage(err)
  }
})

/** A closed ticket can only be reopened. */
const statusOptions = computed(() => {
  const all: TicketStatus[] =
    ticket.value?.status === 'closed'
      ? ['closed', 'reopened']
      : [
          'new',
          'assigned_to_oem',
          'in_progress',
          'resolved',
          'closed',
          ...(ticket.value?.status === 'reopened' ? (['reopened'] as const) : []),
        ]
  return all.map((s) => ({ value: s, label: TICKET_STATUS_LABELS[s] }))
})

async function save(extra: Record<string, unknown> = {}) {
  if (!ticket.value) return
  errors.value = {}
  error.value = ''
  saving.value = true
  try {
    const t = ticket.value
    const changes: Record<string, unknown> = { ...extra }
    if (status.value !== t.status) changes.status = status.value
    if (priority.value !== t.priority) changes.priority = priority.value
    if (assignedTo.value !== (t.assignedTo?.id ?? '')) changes.assignedTo = assignedTo.value || null
    if (oemReference.value !== (t.oemReference ?? '')) changes.oemReference = oemReference.value
    if (resolutionNotes.value !== (t.resolutionNotes ?? ''))
      changes.resolutionNotes = resolutionNotes.value
    if (note.value.trim()) changes.note = note.value
    if (!Object.keys(changes).length) return
    apply((await api.patch<TicketDetail>(`/tickets/${id}`, changes)).data)
  } catch (err) {
    errors.value = fieldErrors(err)
    if (!Object.keys(errors.value).length) error.value = errorMessage(err)
  } finally {
    saving.value = false
  }
}

const rated = computed(
  () => ticket.value && (ticket.value.status === 'resolved' || ticket.value.status === 'closed'),
)
</script>

<template>
  <div>
    <nav class="mb-4 flex flex-wrap items-center gap-2 text-sm" aria-label="Breadcrumb">
      <RouterLink
        to="/tickets"
        class="flex items-center gap-2 text-gray-600 transition-colors hover:text-blue-600 dark:text-gray-400 dark:hover:text-blue-400"
      >
        <ArrowLeft class="size-4" aria-hidden="true" /> Back to Service Tickets
      </RouterLink>
      <span class="text-gray-400">/</span>
      <span class="text-gray-800 dark:text-gray-300">Ticket Details</span>
      <template v-if="ticket">
        <span class="text-gray-400">/</span>
        <span class="font-medium text-blue-600 dark:text-blue-400">{{
          ticketNo(ticket.number)
        }}</span>
      </template>
    </nav>

    <UiAlert v-if="loadError">{{ loadError }}</UiAlert>
    <template v-else-if="ticket">
      <UiCard class="mb-6">
        <div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div class="min-w-0">
            <h1 class="mb-2 text-xl text-gray-800 sm:text-2xl dark:text-white/90">
              {{ ticket.title }}
            </h1>
            <dl class="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <div class="flex items-center gap-2">
                <dt class="font-medium text-gray-600 dark:text-gray-400">Ticket No:</dt>
                <dd class="font-semibold text-blue-600 dark:text-blue-400">
                  {{ ticketNo(ticket.number) }}
                </dd>
              </div>
              <div class="flex items-center gap-2">
                <dt class="font-medium text-gray-600 dark:text-gray-400">Opened by:</dt>
                <dd class="font-semibold text-gray-800 dark:text-gray-300">
                  {{ ticket.createdBy.name }}, {{ formatDateTime(ticket.createdAt) }}
                </dd>
              </div>
            </dl>
          </div>
          <div class="flex flex-wrap gap-2">
            <UiBadge :color="statusColor[ticket.status]">{{
              TICKET_STATUS_LABELS[ticket.status]
            }}</UiBadge>
            <UiBadge :color="priorityColor[ticket.priority]"
              >{{ cap(ticket.priority) }} priority</UiBadge
            >
            <UiBadge>{{ cap(ticket.type) }}</UiBadge>
          </div>
        </div>
      </UiCard>

      <div class="grid gap-6 xl:grid-cols-3">
        <div class="space-y-6 xl:col-span-2">
          <UiCard title="Ticket Details">
            <p class="text-sm whitespace-pre-line text-gray-700 dark:text-gray-300">
              {{ ticket.description }}
            </p>
            <dl
              class="mt-5 grid gap-4 border-t border-gray-100 pt-5 text-theme-sm sm:grid-cols-2 dark:border-gray-800"
            >
              <div>
                <dt class="text-theme-xs text-gray-500">Customer</dt>
                <dd class="text-gray-800 dark:text-white/90">{{ ticket.customerName ?? '—' }}</dd>
              </div>
              <div>
                <dt class="text-theme-xs text-gray-500">Contact</dt>
                <dd class="text-gray-800 dark:text-white/90">
                  {{
                    [ticket.contactName, ticket.contactPhone, ticket.contactEmail]
                      .filter(Boolean)
                      .join(' · ') || '—'
                  }}
                </dd>
              </div>
              <div v-if="ticket.tender">
                <dt class="text-theme-xs text-gray-500">Tender</dt>
                <dd>
                  <RouterLink
                    :to="`/tenders/${ticket.tender.id}`"
                    class="text-blue-600 hover:underline dark:text-blue-400"
                    >{{ ticket.tender.referenceNo }}</RouterLink
                  >
                </dd>
              </div>
              <div v-if="ticket.asset">
                <dt class="text-theme-xs text-gray-500">Unit</dt>
                <dd class="text-gray-800 dark:text-white/90">
                  {{ ticket.asset.itemName
                  }}<template v-if="ticket.asset.serialNumber">
                    · {{ ticket.asset.serialNumber }}</template
                  >
                </dd>
              </div>
            </dl>
          </UiCard>

          <UiCard title="Ticket History" :icon="History">
            <ol class="relative space-y-5 border-l border-gray-200 pl-5 dark:border-gray-800">
              <li v-for="u in [...ticket.updates].reverse()" :key="u.id" class="relative">
                <span
                  class="absolute top-1.5 -left-[25px] size-2.5 rounded-full bg-blue-500 ring-4 ring-white dark:ring-gray-900"
                />
                <p v-if="u.status" class="text-theme-sm text-gray-800 dark:text-white/90">
                  Status: <strong class="font-medium">{{ TICKET_STATUS_LABELS[u.status] }}</strong>
                </p>
                <p
                  v-if="u.note"
                  class="text-theme-sm whitespace-pre-line text-gray-600 dark:text-gray-400"
                >
                  {{ u.note }}
                </p>
                <p class="mt-0.5 text-theme-xs text-gray-500">
                  {{ u.by.name }} · {{ formatDateTime(u.at) }}
                </p>
              </li>
            </ol>
          </UiCard>
        </div>

        <UiCard title="Update Ticket" class="h-fit">
          <form class="space-y-4" novalidate @submit.prevent="save()">
            <UiAlert v-if="error">{{ error }}</UiAlert>
            <UiSelect v-model="status" label="Status" :options="statusOptions" />
            <UiSelect
              v-model="priority"
              label="Priority"
              :options="TICKET_PRIORITIES.map((p) => ({ value: p, label: cap(p) }))"
            />
            <UiSelect
              v-model="assignedTo"
              label="Assigned to"
              :options="[
                { value: '', label: 'Nobody' },
                ...people.map((p) => ({ value: p.id, label: p.name })),
              ]"
            />
            <UiInput
              v-if="status === 'assigned_to_oem' || oemReference"
              v-model="oemReference"
              label="OEM complaint no."
            />
            <div v-if="status === 'resolved' || status === 'closed' || resolutionNotes">
              <label
                for="resolution"
                class="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400"
              >
                Resolution<span v-if="status === 'resolved'" class="text-error-500"> *</span>
              </label>
              <textarea
                id="resolution"
                v-model="resolutionNotes"
                rows="3"
                maxlength="5000"
                :class="['form-field h-auto', errors.resolutionNotes && 'border-error-300']"
              />
              <p v-if="errors.resolutionNotes" class="mt-1.5 text-theme-xs text-error-500">
                {{ errors.resolutionNotes }}
              </p>
            </div>
            <div>
              <label
                for="ticket-note"
                class="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400"
                >Add a note</label
              >
              <textarea
                id="ticket-note"
                v-model="note"
                rows="2"
                maxlength="2000"
                class="form-field h-auto"
                placeholder="Visible in the history"
              />
            </div>
            <UiButton type="submit" :loading="saving" block>Save</UiButton>
          </form>

          <div v-if="rated" class="mt-6 border-t border-gray-100 pt-5 dark:border-gray-800">
            <p class="mb-2 text-sm font-medium text-gray-800 dark:text-white/90">
              Client satisfaction
            </p>
            <div class="flex gap-1" role="radiogroup" aria-label="Client satisfaction, 1 to 5">
              <button
                v-for="n in 5"
                :key="n"
                type="button"
                role="radio"
                :aria-checked="ticket.satisfaction === n"
                :aria-label="`${n} out of 5`"
                class="rounded p-1 text-warning-500 hover:bg-gray-100 dark:hover:bg-white/5"
                @click="save({ satisfaction: n })"
              >
                <Star
                  class="size-5"
                  :fill="(ticket.satisfaction ?? 0) >= n ? 'currentColor' : 'none'"
                />
              </button>
            </div>
          </div>
        </UiCard>
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
      Loading ticket...
    </div>
  </div>
</template>
