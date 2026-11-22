<script setup lang="ts">
import UiCard from '@/components/ui/UiCard.vue'
import { Wrench } from 'lucide-vue-next'
import { computed, onMounted, ref } from 'vue'
import type { InstallationReport, TenderDetail } from '@tdm/shared'
import { ENGINEER_STATUS_LABELS } from '@tdm/shared'
import { PERMISSIONS } from '@tdm/shared/permissions'
import { api } from '@/services/api'
import { useAuthStore } from '@/stores/auth'

/** Summary of the installation report on the tender page (won tenders only). */
const props = defineProps<{ tender: TenderDetail }>()
const auth = useAuthStore()
const report = ref<InstallationReport | null>(null)
const loaded = ref(false)

onMounted(async () => {
  try {
    report.value = (
      await api.get<InstallationReport | null>(`/tenders/${props.tender.id}/installation-report`)
    ).data
  } finally {
    loaded.value = true
  }
})

const items = computed(() => report.value?.consignees.flatMap((c) => c.items) ?? [])
const totalItems = computed(() =>
  items.value.reduce((n, i) => n + Math.max(i.quantity, i.units.length), 0),
)
const installed = computed(
  () => items.value.flatMap((i) => i.units).filter((u) => u.installStatus === 'installed').length,
)
</script>

<template>
  <UiCard title="Installation" :icon="Wrench">
    <template v-if="loaded">
      <template v-if="report && report.consignees.length">
        <p class="text-theme-sm text-gray-700 dark:text-gray-300">
          {{ installed }} of {{ totalItems }} item(s) installed across
          {{ report.consignees.length }} consignee(s).
        </p>
        <ul class="mt-3 space-y-1.5">
          <li
            v-for="c in report.consignees"
            :key="c.id"
            class="text-theme-xs text-gray-500 dark:text-gray-400"
          >
            <span class="font-medium text-gray-700 dark:text-gray-300">{{ c.name }}</span>
            · {{ c.engineer?.name ?? 'no engineer' }} · {{ ENGINEER_STATUS_LABELS[c.status] }}
          </li>
        </ul>
      </template>
      <p v-else class="text-theme-sm text-gray-500 dark:text-gray-400">
        Record where the order is delivered, who installs it, and each unit's serial number and
        warranty.
      </p>
      <RouterLink
        :to="`/tenders/${tender.id}/installation`"
        class="mt-4 inline-flex h-10 w-full items-center justify-center rounded-md bg-gray-200 px-4 text-sm text-gray-700 hover:bg-gray-300 dark:bg-white/5 dark:text-white/90 dark:hover:bg-white/10"
      >
        {{
          report
            ? 'Open installation report'
            : auth.can(PERMISSIONS.INSTALLATION_MANAGE)
              ? 'Start installation report'
              : 'View'
        }}
      </RouterLink>
    </template>
  </UiCard>
</template>
