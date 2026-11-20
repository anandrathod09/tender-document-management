<script setup lang="ts">
import { provideSidebar } from '@/composables/useSidebar'
import AppHeader from './AppHeader.vue'
import AppSidebar from './AppSidebar.vue'

const { isExpanded, isHovered, isMobileOpen, closeMobile } = provideSidebar()
</script>

<template>
  <div class="min-h-screen xl:flex">
    <AppSidebar />
    <div
      v-if="isMobileOpen"
      class="fixed inset-0 z-9999 bg-gray-900/50 lg:hidden"
      @click="closeMobile"
    />
    <div
      :class="[
        'min-w-0 flex-1 transition-all duration-300 ease-in-out',
        isExpanded || isHovered ? 'lg:ml-(--sidebar-max)' : 'lg:ml-(--sidebar-min)',
      ]"
    >
      <AppHeader />
      <main class="mx-auto max-w-(--breakpoint-2xl) p-4 md:p-6">
        <RouterView />
      </main>
    </div>
  </div>
</template>
