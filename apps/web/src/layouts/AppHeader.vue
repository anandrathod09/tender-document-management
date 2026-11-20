<script setup lang="ts">
import { Menu, X } from 'lucide-vue-next'
import ThemeToggler from '@/components/ThemeToggler.vue'
import { useSidebar } from '@/composables/useSidebar'
import { useAuthStore } from '@/stores/auth'
import NotificationBell from './NotificationBell.vue'
import UserMenu from './UserMenu.vue'

const { toggle, isMobileOpen } = useSidebar()
const auth = useAuthStore()
</script>

<template>
  <header
    class="sticky top-0 z-9999 flex w-full border-b border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900"
  >
    <div class="flex grow items-center justify-between gap-3 px-3 py-3 lg:px-6 lg:py-4">
      <button
        type="button"
        class="flex size-10 items-center justify-center rounded-lg border border-gray-200 text-gray-500 lg:size-11 dark:border-gray-800 dark:text-gray-400"
        :aria-label="isMobileOpen ? 'Close menu' : 'Toggle menu'"
        @click="toggle"
      >
        <component :is="isMobileOpen ? X : Menu" class="size-5" aria-hidden="true" />
      </button>

      <div class="flex items-center gap-3">
        <ThemeToggler />
        <NotificationBell v-if="auth.tenant" />
        <UserMenu />
      </div>
    </div>
  </header>
</template>
