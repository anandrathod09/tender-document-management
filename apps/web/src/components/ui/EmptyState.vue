<script setup lang="ts">
import { Inbox } from 'lucide-vue-next'
import type { Component } from 'vue'

/** "Nothing here" message of the original TMS: grey icon, title, optional button. */
defineProps<{ title: string; description?: string; icon?: Component }>()
</script>

<template>
  <div class="flex w-full flex-col items-center gap-2 px-6 py-8 text-center">
    <component :is="icon ?? Inbox" class="size-12 text-gray-400" aria-hidden="true" />
    <p class="text-lg font-medium text-gray-800 dark:text-white/90">{{ title }}</p>
    <p v-if="description" class="max-w-md text-sm text-gray-600 dark:text-gray-400">
      {{ description }}
    </p>
    <div v-if="$slots.default" class="mt-2"><slot /></div>
  </div>
</template>
