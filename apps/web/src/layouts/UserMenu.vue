<script setup lang="ts">
import { ChevronDown, LogOut, ShieldCheck } from 'lucide-vue-next'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const router = useRouter()
const open = ref(false)
const root = ref<HTMLElement | null>(null)

const initials = computed(() => {
  const parts = (auth.user?.name ?? '').trim().split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || 'U'
})
const roleName = computed(() =>
  auth.tenant ? auth.tenant.role.name : auth.platform ? `Platform ${auth.platform.user.role}` : '',
)

function onClickOutside(e: MouseEvent) {
  if (root.value && !root.value.contains(e.target as Node)) open.value = false
}
onMounted(() => document.addEventListener('click', onClickOutside))
onBeforeUnmount(() => document.removeEventListener('click', onClickOutside))

async function signOut() {
  open.value = false
  await auth.logout()
  await router.push('/signin')
}
</script>

<template>
  <div ref="root" class="relative">
    <button
      type="button"
      class="flex items-center gap-3 text-gray-700 dark:text-gray-400"
      :aria-expanded="open"
      aria-haspopup="menu"
      @click="open = !open"
    >
      <span
        class="flex size-11 items-center justify-center rounded-full bg-brand-50 font-semibold text-brand-500 dark:bg-brand-500/15 dark:text-brand-400"
      >
        {{ initials }}
      </span>
      <span class="hidden text-left sm:block">
        <span class="block text-theme-sm font-medium text-gray-800 dark:text-white/90">{{
          auth.user?.name
        }}</span>
        <span class="block text-theme-xs text-gray-500 capitalize dark:text-gray-400">{{
          roleName
        }}</span>
      </span>
      <ChevronDown
        :class="['size-4 transition-transform', open && 'rotate-180']"
        aria-hidden="true"
      />
    </button>

    <div
      v-if="open"
      role="menu"
      class="absolute right-0 mt-4 w-64 rounded-2xl border border-gray-200 bg-white p-3 shadow-theme-lg dark:border-gray-800 dark:bg-gray-900"
    >
      <div class="border-b border-gray-200 px-2 pb-3 dark:border-gray-800">
        <p class="text-theme-sm font-medium text-gray-700 dark:text-gray-300">
          {{ auth.user?.name }}
        </p>
        <p class="mt-0.5 truncate text-theme-xs text-gray-500 dark:text-gray-400">
          {{ auth.user?.email }}
        </p>
      </div>
      <RouterLink
        to="/account/security"
        role="menuitem"
        class="mt-2 flex w-full items-center gap-3 rounded-lg px-2 py-2 text-theme-sm font-medium text-gray-700 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-white/5"
        @click="open = false"
      >
        <ShieldCheck class="size-5" aria-hidden="true" />
        My Security
        <span
          :class="[
            'ml-auto rounded px-1.5 py-0.5 text-[10px]',
            auth.session?.twoFactor.enabled
              ? 'bg-[#7AA90D] text-white'
              : 'bg-gray-200 text-gray-600 dark:bg-white/10 dark:text-gray-300',
          ]"
        >
          {{ auth.session?.twoFactor.enabled ? '2-step on' : '2-step off' }}
        </span>
      </RouterLink>
      <button
        type="button"
        role="menuitem"
        class="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-theme-sm font-medium text-gray-700 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-white/5"
        @click="signOut"
      >
        <LogOut class="size-5" aria-hidden="true" />
        Sign out
      </button>
    </div>
  </div>
</template>
