<script setup lang="ts">
import type { TenderSummary } from '@tdm/shared'

/** The list of selected tenders with a "Bulk Action" chip, from the original TMS popups. */
withDefaults(
  defineProps<{
    tenders: TenderSummary[]
    heading: string
    tone?: 'gray' | 'blue' | 'red'
  }>(),
  { tone: 'gray' },
)
const brief = (t: string) => (t.length > 30 ? `${t.slice(0, 30)}…` : t)

const boxes = {
  gray: 'bg-gray-50 dark:bg-gray-900',
  blue: 'border border-blue-200 bg-blue-50 dark:border-blue-500/30 dark:bg-blue-500/10',
  red: 'bg-gray-50 dark:bg-gray-900',
}
const chips = {
  gray: 'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-300',
  blue: 'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-300',
  red: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300',
}
</script>

<template>
  <div :class="['rounded-lg p-4', boxes[tone]]">
    <div class="mb-2 flex items-center justify-between gap-3">
      <h3
        :class="[
          'text-sm font-medium',
          tone === 'blue' ? 'text-blue-800 dark:text-blue-300' : 'text-gray-700 dark:text-gray-300',
        ]"
      >
        {{ heading }}
      </h3>
      <span :class="['rounded px-2 py-1 text-xs', chips[tone]]">Bulk Action</span>
    </div>
    <ul class="custom-scrollbar max-h-40 space-y-1 overflow-y-auto text-sm">
      <li
        v-for="t in tenders"
        :key="t.id"
        :class="[
          'flex justify-between gap-4 border-b py-1 last:border-0',
          tone === 'blue'
            ? 'border-blue-200 dark:border-blue-500/30'
            : 'border-gray-200 dark:border-gray-700',
        ]"
      >
        <span
          :class="[
            'break-all',
            tone === 'blue'
              ? 'text-blue-600 dark:text-blue-300'
              : 'text-gray-600 dark:text-gray-400',
          ]"
        >
          {{ t.referenceNo }}
        </span>
        <span
          :class="[
            'text-right font-medium',
            tone === 'blue'
              ? 'text-blue-800 dark:text-blue-200'
              : 'text-gray-800 dark:text-white/90',
          ]"
        >
          {{ brief(t.title) }}
        </span>
      </li>
    </ul>
  </div>
</template>
