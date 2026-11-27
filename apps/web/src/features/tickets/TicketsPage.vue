<script setup lang="ts">
import { LifeBuoy, Plus, Search } from 'lucide-vue-next'
import { onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import type { TicketPage } from '@tdm/shared'
import { TICKET_PRIORITIES, TICKET_STATUS_LABELS, TICKET_STATUSES } from '@tdm/shared'
import { ACTION_ICONS } from '@/components/ui/actions'
import DataTable from '@/components/ui/DataTable.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import IconButton from '@/components/ui/IconButton.vue'
import type { TableColumn } from '@/components/ui/table'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiBadge from '@/components/ui/UiBadge.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiCard from '@/components/ui/UiCard.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import { api, errorMessage } from '@/services/api'
import { formatDateTime } from '@/utils/format'
import NewTicketModal from './NewTicketModal.vue'
import { cap, priorityColor, statusColor, ticketNo } from './ticketUi'

const router = useRouter()
const page = ref<TicketPage | null>(null)
const status = ref('open')
const priority = ref('')
const mine = ref(false)
const q = ref('')
const error = ref('')
const loading = ref(false)
const creating = ref(false)

const columns: TableColumn[] = [
  { key: 'title', label: 'Ticket', class: 'min-w-64 max-w-md' },
  { key: 'customerName', label: 'Customer' },
  { key: 'priority', label: 'Priority' },
  { key: 'status', label: 'Status' },
  { key: 'assignedTo', label: 'Assigned to' },
  { key: 'updatedAt', label: 'Updated' },
]

async function load() {
  loading.value = true
  error.value = ''
  try {
    const params: Record<string, string | number> = { pageSize: 50 }
    if (status.value) params.status = status.value
    if (priority.value) params.priority = priority.value
    if (mine.value) params.assignedTo = 'me'
    if (q.value.trim()) params.q = q.value.trim()
    page.value = (await api.get<TicketPage>('/tickets', { params })).data
  } catch (err) {
    error.value = errorMessage(err)
  } finally {
    loading.value = false
  }
}
onMounted(load)
watch([status, priority, mine], load)
let timer: ReturnType<typeof setTimeout> | undefined
watch(q, () => {
  clearTimeout(timer)
  timer = setTimeout(load, 350)
})
</script>

<template>
  <div>
    <UiAlert v-if="error" class="mb-4">{{ error }}</UiAlert>

    <UiCard
      :level="1"
      title="Service Tickets"
      subtitle="Client feedback, complaints and service requests after installation."
      :icon="LifeBuoy"
    >
      <template #header>
        <label class="relative w-full sm:w-56">
          <span class="sr-only">Search tickets</span>
          <Search
            class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-gray-400"
            aria-hidden="true"
          />
          <input
            v-model="q"
            type="search"
            placeholder="Search tickets..."
            class="form-field h-9! py-1! pl-9! text-sm!"
          />
        </label>
        <UiSelect
          v-model="status"
          aria-label="Status"
          size="sm"
          fit
          :options="[
            { value: 'open', label: 'Open tickets' },
            { value: '', label: 'All tickets' },
            ...TICKET_STATUSES.map((s) => ({ value: s, label: TICKET_STATUS_LABELS[s] })),
          ]"
        />
        <UiSelect
          v-model="priority"
          aria-label="Priority"
          size="sm"
          fit
          :options="[
            { value: '', label: 'Any priority' },
            ...TICKET_PRIORITIES.map((p) => ({ value: p, label: cap(p) })),
          ]"
        />
        <label class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
          <input
            v-model="mine"
            type="checkbox"
            class="size-4 rounded border-gray-300 accent-brand-500"
          />
          Assigned to me
        </label>
        <UiButton size="xs" @click="creating = true">
          <Plus class="size-4" aria-hidden="true" /> New Ticket
        </UiButton>
      </template>

      <DataTable
        :columns="columns"
        :rows="page?.items ?? []"
        :loading="loading"
        loading-text="Loading tickets…"
      >
        <template #cell-title="{ row }">
          <RouterLink
            :to="`/tickets/${row.id}`"
            class="font-medium text-gray-800 hover:text-brand-500 dark:text-white/90"
          >
            {{ row.title }}
          </RouterLink>
          <p class="text-theme-xs text-gray-500 dark:text-gray-400">
            {{ ticketNo(row.number) }} · {{ cap(row.type)
            }}<template v-if="row.asset">
              · {{ row.asset.serialNumber ?? row.asset.itemName }}</template
            ><template v-if="row.source === 'support_page'"> · From support page</template>
          </p>
        </template>
        <template #cell-customerName="{ row }">{{ row.customerName ?? '—' }}</template>
        <template #cell-priority="{ row }">
          <UiBadge :color="priorityColor[row.priority]">{{ cap(row.priority) }}</UiBadge>
        </template>
        <template #cell-status="{ row }">
          <UiBadge :color="statusColor[row.status]">{{ TICKET_STATUS_LABELS[row.status] }}</UiBadge>
        </template>
        <template #cell-assignedTo="{ row }">{{ row.assignedTo?.name ?? '—' }}</template>
        <template #cell-updatedAt="{ row }">
          <span class="whitespace-nowrap text-gray-500 dark:text-gray-400">
            {{ formatDateTime(row.updatedAt) }}
          </span>
        </template>
        <template #actions="{ row }">
          <IconButton
            :icon="ACTION_ICONS.view"
            :label="`Open ${ticketNo(row.number)}`"
            :to="`/tickets/${row.id}`"
          />
        </template>
        <template #empty>
          <EmptyState
            :title="status === 'open' ? 'No open tickets' : 'No tickets found'"
            description="Create a ticket when a client reports a problem or gives feedback. From Installed assets you can open one for a specific unit."
          />
        </template>
      </DataTable>
    </UiCard>

    <NewTicketModal
      :open="creating"
      @close="creating = false"
      @created="(t) => router.push(`/tickets/${t.id}`)"
    />
  </div>
</template>
