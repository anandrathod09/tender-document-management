<script setup lang="ts">
import { Bell } from 'lucide-vue-next'
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import type { NotificationList, NotificationSummary } from '@tdm/shared'
import { api } from '@/services/api'
import { formatDateTime } from '@/utils/format'

const router = useRouter()
const list = ref<NotificationList>({ items: [], unread: 0 })
const open = ref(false)
const root = ref<HTMLElement | null>(null)
let timer: ReturnType<typeof setInterval> | undefined

async function load() {
  try {
    list.value = (await api.get<NotificationList>('/notifications')).data
  } catch {
    // Signed out or offline: keep what we have.
  }
}

async function markAllRead() {
  await api.post('/notifications/read', { ids: 'all' })
  list.value = { items: list.value.items.map((n) => ({ ...n, read: true })), unread: 0 }
}

async function openItem(n: NotificationSummary) {
  open.value = false
  if (!n.read) {
    await api.post('/notifications/read', { ids: [n.id] }).catch(() => undefined)
    n.read = true
    list.value.unread = Math.max(0, list.value.unread - 1)
  }
  if (n.link) await router.push(n.link)
}

function toggle() {
  open.value = !open.value
  if (open.value) void load()
}

function onClickOutside(e: MouseEvent) {
  if (root.value && !root.value.contains(e.target as Node)) open.value = false
}

onMounted(() => {
  void load()
  // Checks for new notifications every minute (live updates can come later).
  timer = setInterval(() => void load(), 60_000)
  document.addEventListener('click', onClickOutside)
})
onBeforeUnmount(() => {
  clearInterval(timer)
  document.removeEventListener('click', onClickOutside)
})
</script>

<template>
  <div ref="root" class="relative">
    <button
      type="button"
      class="relative flex size-11 items-center justify-center rounded-full border border-gray-200 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
      :aria-label="list.unread ? `Notifications, ${list.unread} unread` : 'Notifications'"
      :aria-expanded="open"
      @click="toggle"
    >
      <Bell class="size-5" aria-hidden="true" />
      <span
        v-if="list.unread"
        class="absolute -top-0.5 -right-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-error-500 px-1 text-[11px] font-semibold text-white"
      >
        {{ list.unread > 9 ? '9+' : list.unread }}
      </span>
    </button>

    <div
      v-if="open"
      class="absolute right-0 mt-4 w-[340px] max-w-[calc(100vw-2rem)] rounded-2xl border border-gray-200 bg-white shadow-theme-lg dark:border-gray-800 dark:bg-gray-900"
    >
      <div
        class="flex items-center justify-between border-b border-gray-100 px-4 py-3 dark:border-gray-800"
      >
        <p class="text-sm font-semibold text-gray-800 dark:text-white/90">Notifications</p>
        <button
          v-if="list.unread"
          type="button"
          class="text-theme-xs font-medium text-brand-500 hover:text-brand-600"
          @click="markAllRead"
        >
          Mark all as read
        </button>
      </div>
      <ul class="custom-scrollbar max-h-96 overflow-y-auto">
        <li v-for="n in list.items" :key="n.id">
          <button
            type="button"
            class="flex w-full gap-3 px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-white/5"
            @click="openItem(n)"
          >
            <span
              :class="[
                'mt-1.5 size-2 shrink-0 rounded-full',
                n.read ? 'bg-transparent' : 'bg-brand-500',
              ]"
              aria-hidden="true"
            />
            <span class="min-w-0">
              <span class="block text-theme-sm font-medium text-gray-800 dark:text-white/90">{{
                n.title
              }}</span>
              <span
                v-if="n.body"
                class="line-clamp-2 block text-theme-xs text-gray-500 dark:text-gray-400"
                >{{ n.body }}</span
              >
              <span class="mt-0.5 block text-theme-xs text-gray-400">{{
                formatDateTime(n.createdAt)
              }}</span>
            </span>
          </button>
        </li>
        <li v-if="!list.items.length" class="px-4 py-8 text-center text-sm text-gray-500">
          No notifications yet.
        </li>
      </ul>
    </div>
  </div>
</template>
