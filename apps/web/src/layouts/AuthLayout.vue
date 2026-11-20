<script setup lang="ts">
import { computed } from 'vue'
import ThemeToggler from '@/components/ThemeToggler.vue'
import { PRODUCT_NAME } from '@/config'
import { useWorkspaceStore } from '@/stores/workspace'

const workspace = useWorkspaceStore()
const tagline = computed(() =>
  workspace.info.kind === 'tenant'
    ? workspace.info.name
    : workspace.info.kind === 'owner'
      ? 'Owner panel'
      : 'Tender management for bidding teams',
)
</script>

<template>
  <div class="relative z-1 bg-white dark:bg-gray-900">
    <div class="relative flex min-h-screen w-full flex-col lg:flex-row">
      <div class="flex flex-1 flex-col justify-center px-6 py-10 lg:w-1/2">
        <div class="mx-auto w-full max-w-md">
          <RouterView />
        </div>
      </div>

      <div
        class="relative hidden items-center justify-center overflow-hidden bg-brand-950 lg:flex lg:w-1/2 dark:bg-white/5"
      >
        <svg class="absolute inset-0 size-full opacity-[0.08]" aria-hidden="true">
          <defs>
            <pattern id="auth-grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M40 0H0V40" fill="none" stroke="white" stroke-width="1" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#auth-grid)" />
        </svg>
        <div class="relative z-1 max-w-xs text-center">
          <p class="font-satoshi text-3xl font-bold text-white">{{ PRODUCT_NAME }}</p>
          <p class="mt-3 text-gray-400">{{ tagline }}</p>
        </div>
      </div>

      <div class="fixed right-6 bottom-6 z-50">
        <ThemeToggler />
      </div>
    </div>
  </div>
</template>
