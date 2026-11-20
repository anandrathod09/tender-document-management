<script setup lang="ts">
import { computed } from 'vue'
import { deadlineHint, formatDeadline } from '@/utils/tenders'

/** Deadline as the original TMS shows it: the date coloured by urgency, days left below. */
const props = defineProps<{ deadline: string; muted?: boolean }>()
const hint = computed(() => deadlineHint(props.deadline))
const tones = {
  past: 'text-red-600 dark:text-red-400',
  urgent: 'text-orange-600 dark:text-orange-400',
  soon: 'text-orange-600 dark:text-orange-400',
  normal: 'text-green-600 dark:text-green-500',
}
</script>

<template>
  <div class="flex flex-col text-xs whitespace-nowrap">
    <span :class="['font-medium', muted ? 'text-gray-700 dark:text-gray-300' : tones[hint.tone]]">
      {{ formatDeadline(deadline) }}
    </span>
    <span v-if="!muted" class="text-gray-500 dark:text-gray-400">{{ hint.text }}</span>
  </div>
</template>
