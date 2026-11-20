<script setup lang="ts">
import type { Component } from 'vue'

/** Page heading of the original TMS: an icon and the title, with optional buttons on the right. */
defineProps<{ title: string; description?: string; icon?: Component }>()
</script>

<template>
  <div class="flex flex-wrap items-center justify-between gap-4 pb-6">
    <div class="min-w-0">
      <h1 class="flex items-center gap-3 text-2xl text-gray-800 sm:text-3xl dark:text-white/90">
        <component :is="icon" v-if="icon" class="size-8 shrink-0" aria-hidden="true" />
        {{ title }}
      </h1>
      <p v-if="description" class="mt-2 text-sm font-light text-gray-600 dark:text-gray-400">
        {{ description }}
      </p>
    </div>
    <div v-if="$slots.actions" class="flex flex-wrap items-center gap-3">
      <slot name="actions" />
    </div>
  </div>
</template>
