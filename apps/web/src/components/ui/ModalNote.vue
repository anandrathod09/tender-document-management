<script setup lang="ts">
/** The small blue "Note: …" box at the bottom of the original TMS popups. */
withDefaults(defineProps<{ tone?: 'info' | 'warning' }>(), { tone: 'info' })
</script>

<template>
  <div
    :class="[
      'rounded-lg p-3 text-xs',
      tone === 'info'
        ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300'
        : 'border border-yellow-200 bg-yellow-50 text-yellow-800 dark:border-yellow-500/30 dark:bg-yellow-500/10 dark:text-yellow-300',
    ]"
  >
    <span class="font-medium">Note:</span> <slot />
  </div>
</template>
