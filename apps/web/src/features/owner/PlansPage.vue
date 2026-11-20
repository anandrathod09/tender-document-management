<script setup lang="ts">
import { CreditCard, Plus } from 'lucide-vue-next'
import { onMounted, ref } from 'vue'
import type { PlanDetail } from '@tdm/shared'
import { ACTION_ICONS } from '@/components/ui/actions'
import DataTable from '@/components/ui/DataTable.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import IconButton from '@/components/ui/IconButton.vue'
import type { TableColumn } from '@/components/ui/table'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiBadge from '@/components/ui/UiBadge.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiCard from '@/components/ui/UiCard.vue'
import { api, errorMessage } from '@/services/api'
import PlanDialog from './PlanDialog.vue'

/** Plans clients can be on: limits and prices (before GST). */
const plans = ref<PlanDetail[]>([])
const loading = ref(true)
const error = ref('')
const notice = ref('')
const editing = ref<PlanDetail | null>(null)
const dialogOpen = ref(false)

async function load() {
  try {
    plans.value = (await api.get<PlanDetail[]>('/owner/plans')).data
  } catch (err) {
    error.value = errorMessage(err)
  } finally {
    loading.value = false
  }
}
onMounted(load)

function open(plan: PlanDetail | null) {
  editing.value = plan
  dialogOpen.value = true
}
async function onSaved(p: PlanDetail) {
  dialogOpen.value = false
  notice.value = `Plan “${p.name}” saved.`
  await load()
}

const inr = (n: number | null) => (n === null ? '—' : `₹${n.toLocaleString('en-IN')}`)
const columns: TableColumn[] = [
  { key: 'name', label: 'Plan', sticky: true, class: 'min-w-56' },
  { key: 'price', label: 'Price (before GST)' },
  { key: 'limits', label: 'Limits' },
  { key: 'clientCount', label: 'Clients', align: 'right' },
  { key: 'status', label: 'Status' },
]
</script>

<template>
  <div>
    <UiAlert v-if="error" class="mb-4">{{ error }}</UiAlert>
    <UiAlert v-if="notice" variant="success" class="mb-4">{{ notice }}</UiAlert>
    <UiCard
      :level="1"
      title="Plans"
      subtitle="Limits and prices. Changing a price affects the next payment, not past invoices."
      :icon="CreditCard"
    >
      <template #header>
        <UiButton size="xs" @click="open(null)">
          <Plus class="size-4" aria-hidden="true" /> Add Plan
        </UiButton>
      </template>
      <DataTable
        :columns="columns"
        :rows="plans"
        :loading="loading"
        loading-text="Loading plans..."
      >
        <template #cell-name="{ row }">
          <p class="text-sm font-medium">{{ row.name }}</p>
          <p class="text-xs text-gray-500 dark:text-gray-400">
            {{ row.code }}<template v-if="row.description"> · {{ row.description }}</template>
          </p>
        </template>
        <template #cell-price="{ row }">
          <p class="text-xs whitespace-nowrap">{{ inr(row.priceMonthlyInr) }} / month</p>
          <p class="text-xs whitespace-nowrap text-gray-500">
            {{ inr(row.priceYearlyInr) }} / year
          </p>
        </template>
        <template #cell-limits="{ row }">
          <p class="text-xs whitespace-nowrap">
            {{ row.maxUsers }} users · {{ row.maxStorageGb }} GB ·
            {{ row.maxTendersPerMonth.toLocaleString('en-IN') }} tenders/month ·
            {{ row.maxCompanies }} {{ row.maxCompanies === 1 ? 'company' : 'companies' }}
          </p>
        </template>
        <template #cell-clientCount="{ row }">
          <span class="text-sm tabular-nums">{{ row.clientCount }}</span>
        </template>
        <template #cell-status="{ row }">
          <div class="flex gap-1">
            <UiBadge :color="row.isActive ? 'success' : 'gray'">
              {{ row.isActive ? 'Available' : 'Retired' }}
            </UiBadge>
            <UiBadge :color="row.isPublic ? 'info' : 'gray'">
              {{ row.isPublic ? 'Public' : 'Private' }}
            </UiBadge>
          </div>
        </template>
        <template #actions="{ row }">
          <IconButton :icon="ACTION_ICONS.edit" :label="`Edit ${row.name}`" @click="open(row)" />
        </template>
        <template #empty>
          <EmptyState :icon="CreditCard" title="No plans yet" description="Add the first plan." />
        </template>
      </DataTable>
    </UiCard>

    <PlanDialog :open="dialogOpen" :plan="editing" @close="dialogOpen = false" @saved="onSaved" />
  </div>
</template>
