<script setup lang="ts">
import { PRODUCT_NAME } from '@/config'

/** A full-screen message: workspace not found, suspended, server unavailable, 404. */
defineProps<{ title: string; message: string; showHomeLink?: boolean }>()
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-white px-6 dark:bg-gray-900">
    <div class="max-w-md text-center">
      <p class="font-satoshi text-lg font-bold text-brand-500">{{ PRODUCT_NAME }}</p>
      <h1 class="mt-6 text-title-sm font-semibold text-gray-800 dark:text-white/90">{{ title }}</h1>
      <p class="mt-3 text-gray-500 dark:text-gray-400">{{ message }}</p>
      <RouterLink
        v-if="showHomeLink"
        to="/"
        class="mt-8 inline-flex rounded-lg bg-brand-500 px-5 py-3 text-sm font-medium text-white hover:bg-brand-600"
      >
        Go to home page
      </RouterLink>
    </div>
  </div>
</template>
