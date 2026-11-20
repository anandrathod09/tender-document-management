<script setup lang="ts">
import type { Component } from 'vue'

/** Count tile of the original TMS: icon and title on the left, the number in blue on the right. */
defineProps<{ title: string; value: number | string; icon?: Component; active?: boolean }>()
</script>

<template>
  <div
    :class="[
      'flex items-center justify-between gap-3 rounded-md border bg-white p-4 dark:bg-white/[0.03]',
      active
        ? 'border-blue-400 ring-1 ring-blue-400 dark:border-blue-500'
        : 'border-gray-200 dark:border-gray-800',
    ]"
  >
    <p class="flex flex-1 items-center gap-2 text-gray-700 dark:text-gray-300">
      <component :is="icon" v-if="icon" class="size-7 shrink-0" aria-hidden="true" />
      {{ title }}
    </p>
    <p class="text-2xl text-blue-500">{{ value }}</p>
  </div>
</template>
