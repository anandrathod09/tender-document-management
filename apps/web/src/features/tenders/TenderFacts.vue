<script setup lang="ts">
import type { TenderSummary } from '@tdm/shared'
import StageBadge from '@/components/StageBadge.vue'
import UiBadge from '@/components/ui/UiBadge.vue'
import { deadlineHint, formatDeadline, formatINR, formatINRShort } from '@/utils/tenders'

/**
 * The grey "Tender Details" box of the original TMS popups.
 * - grid: four facts in two columns (assign)
 * - rows: label on the left, value on the right (watchlist, reject)
 * - full: everything, for confirming a removal
 */
defineProps<{ tender: TenderSummary; layout?: 'grid' | 'rows' | 'full' }>()
const brief = (t: string, n: number) => (t.length > n ? `${t.slice(0, n)}…` : t)
</script>

<template>
  <div class="rounded-lg bg-gray-50 p-4 dark:bg-gray-900">
    <h3 class="mb-3 text-sm font-semibold text-gray-700 dark:text-gray-300">Tender Details</h3>

    <dl v-if="(layout ?? 'grid') === 'grid'" class="grid grid-cols-2 gap-3">
      <div>
        <dt class="text-xs text-gray-500 dark:text-gray-400">Reference No</dt>
        <dd class="text-sm font-medium break-all text-gray-800 dark:text-white/90">
          {{ tender.referenceNo }}
        </dd>
      </div>
      <div>
        <dt class="text-xs text-gray-500 dark:text-gray-400">Deadline</dt>
        <dd class="text-sm font-medium text-gray-800 dark:text-white/90">
          {{ formatDeadline(tender.deadline) }} · {{ deadlineHint(tender.deadline).text }}
        </dd>
      </div>
      <div>
        <dt class="text-xs text-gray-500 dark:text-gray-400">Organization</dt>
        <dd class="text-sm font-medium text-gray-800 dark:text-white/90">
          {{ tender.buyerOrganization ?? 'N/A' }}
        </dd>
      </div>
      <div>
        <dt class="text-xs text-gray-500 dark:text-gray-400">Estimated Cost</dt>
        <dd class="text-sm font-medium text-gray-800 dark:text-white/90">
          {{ formatINRShort(tender.estimatedCost) }}
        </dd>
      </div>
    </dl>

    <dl v-else-if="layout === 'rows'" class="space-y-1 text-sm">
      <div class="flex justify-between gap-4">
        <dt class="shrink-0 text-gray-600 dark:text-gray-400">Reference No:</dt>
        <dd class="text-right font-medium break-all text-gray-800 dark:text-white/90">
          {{ tender.referenceNo }}
        </dd>
      </div>
      <div class="flex justify-between gap-4">
        <dt class="shrink-0 text-gray-600 dark:text-gray-400">Description:</dt>
        <dd class="text-right font-medium text-gray-800 dark:text-white/90">
          {{ brief(tender.title, 50) }}
        </dd>
      </div>
      <div class="flex justify-between gap-4">
        <dt class="shrink-0 text-gray-600 dark:text-gray-400">Organization:</dt>
        <dd class="text-right font-medium text-gray-800 dark:text-white/90">
          {{ tender.buyerOrganization ?? 'N/A' }}
        </dd>
      </div>
      <div class="flex justify-between gap-4">
        <dt class="shrink-0 text-gray-600 dark:text-gray-400">Estimated Cost:</dt>
        <dd class="text-right font-medium text-gray-800 dark:text-white/90">
          {{ formatINR(tender.estimatedCost) }}
        </dd>
      </div>
    </dl>

    <div v-else class="space-y-3">
      <div>
        <p class="text-lg font-medium break-all text-gray-800 dark:text-white/90">
          {{ tender.referenceNo }}
        </p>
        <p v-if="tender.sourceTenderId" class="text-sm text-gray-500 dark:text-gray-400">
          {{ tender.sourceTenderId }}
        </p>
      </div>
      <dl class="grid grid-cols-2 gap-2 text-sm">
        <div class="flex items-center gap-2">
          <dt class="text-gray-600 dark:text-gray-400">Type:</dt>
          <dd>
            <UiBadge :color="tender.sheetType === 'gem' ? 'success' : 'info'">
              {{ tender.sheetType === 'gem' ? 'GeM' : 'Non-GeM' }}
            </UiBadge>
          </dd>
        </div>
        <div class="flex items-center gap-2">
          <dt class="text-gray-600 dark:text-gray-400">Status:</dt>
          <dd><StageBadge :label="tender.stage.label" :color="tender.stage.color" /></dd>
        </div>
        <div class="flex flex-wrap gap-x-2">
          <dt class="text-gray-600 dark:text-gray-400">Deadline:</dt>
          <dd
            :class="[
              'font-medium',
              deadlineHint(tender.deadline).tone === 'past'
                ? 'text-red-600'
                : 'text-gray-800 dark:text-white/90',
            ]"
          >
            {{ formatDeadline(tender.deadline) }}
            <span v-if="deadlineHint(tender.deadline).tone === 'past'" class="text-xs">
              (Expired)
            </span>
          </dd>
        </div>
        <div class="flex flex-wrap gap-x-2">
          <dt class="text-gray-600 dark:text-gray-400">Est. Cost:</dt>
          <dd class="font-medium text-gray-800 dark:text-white/90">
            {{ formatINR(tender.estimatedCost) }}
          </dd>
        </div>
      </dl>
      <p
        class="line-clamp-2 border-t border-gray-200 pt-2 text-sm text-gray-700 dark:border-gray-700 dark:text-gray-300"
      >
        {{ tender.title }}
      </p>
      <div
        v-if="tender.buyerOrganization"
        class="border-t border-gray-200 pt-2 text-sm dark:border-gray-700"
      >
        <span class="text-gray-600 dark:text-gray-400">Organization:</span>
        <p class="mt-1 font-medium text-gray-800 dark:text-white/90">
          {{ tender.buyerOrganization }}
        </p>
      </div>
      <div
        v-if="tender.location"
        class="border-t border-gray-200 pt-2 text-sm dark:border-gray-700"
      >
        <span class="text-gray-600 dark:text-gray-400">Location:</span>
        <p class="mt-1 font-medium text-gray-800 dark:text-white/90">{{ tender.location }}</p>
      </div>
      <div class="border-t border-gray-200 pt-2 text-sm dark:border-gray-700">
        <slot name="action" />
      </div>
    </div>
  </div>
</template>
