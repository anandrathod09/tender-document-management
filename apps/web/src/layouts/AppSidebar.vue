<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useSidebar } from '@/composables/useSidebar'
import { PRODUCT_NAME } from '@/config'
import { useAuthStore } from '@/stores/auth'
import { useWorkflowStore } from '@/stores/workflow'
import { useWorkspaceStore } from '@/stores/workspace'
import { stageDotClasses } from '@/utils/tenders'
import { ownerMenu, tenantMenu, type MenuItem } from './menu'

const route = useRoute()
const auth = useAuthStore()
const workspace = useWorkspaceStore()
const workflow = useWorkflowStore()
const { isExpanded, isMobileOpen, isHovered, closeMobile } = useSidebar()

const isTenant = computed(() => workspace.info.kind === 'tenant')
onMounted(() => {
  if (isTenant.value) workflow.load().catch(() => undefined)
})

const wide = computed(() => isExpanded.value || isHovered.value || isMobileOpen.value)

const groups = computed(() => {
  const menu = isTenant.value
    ? tenantMenu(
        workflow.visibleStages,
        workflow.counts,
        workflow.total,
        auth.tenant?.role.key ?? '',
      )
    : ownerMenu
  return menu
    .map((g) => ({ ...g, items: g.items.filter((i) => !i.permission || auth.can(i.permission)) }))
    .filter((g) => g.items.length > 0)
})

const subtitle = computed(() =>
  workspace.info.kind === 'tenant'
    ? workspace.info.name
    : workspace.info.kind === 'owner'
      ? 'Owner panel'
      : '',
)

function isActive(item: MenuItem): boolean {
  const [path, query] = item.to.split('?')
  const stage = new URLSearchParams(query ?? '').get('stage')
  if (path === '/tenders') {
    return route.path === '/tenders' && (route.query.stage ?? null) === stage
  }
  return route.path === path || route.path.startsWith(`${path}/`)
}

const initial = PRODUCT_NAME.charAt(0).toUpperCase()
</script>

<template>
  <aside
    :class="[
      'fixed top-0 left-0 z-99999 flex h-screen flex-col border-r border-gray-200 bg-white px-4 transition-all duration-300 ease-in-out dark:border-gray-800 dark:bg-gray-900',
      wide ? 'w-(--sidebar-max)' : 'w-(--sidebar-min)',
      isMobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
    ]"
    aria-label="Main navigation"
    @mouseenter="!isExpanded && (isHovered = true)"
    @mouseleave="isHovered = false"
  >
    <div
      :class="['flex h-20 shrink-0 items-center gap-3', wide ? 'justify-start' : 'justify-center']"
    >
      <span
        class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-500 font-satoshi text-lg font-bold text-white"
        aria-hidden="true"
      >
        {{ initial }}
      </span>
      <div v-if="wide" class="min-w-0">
        <p class="truncate font-satoshi text-base font-bold text-gray-900 dark:text-white">
          {{ PRODUCT_NAME }}
        </p>
        <p class="truncate text-theme-xs text-gray-500 dark:text-gray-400">{{ subtitle }}</p>
      </div>
    </div>

    <nav class="no-scrollbar flex-1 overflow-y-auto pb-6">
      <div v-for="(group, gi) in groups" :key="gi" class="mb-5">
        <p
          v-if="group.title && wide"
          class="mb-2 px-3 text-theme-xs tracking-wide text-gray-400 uppercase"
        >
          {{ group.title }}
        </p>
        <div v-else-if="group.title" class="mx-auto mb-2 h-px w-6 bg-gray-200 dark:bg-gray-800" />
        <ul class="flex flex-col gap-0.5">
          <li v-for="item in group.items" :key="item.to">
            <RouterLink
              :to="item.to"
              :class="[
                'menu-item',
                isActive(item) ? 'menu-item-active' : 'menu-item-inactive',
                !wide && 'justify-center',
              ]"
              :title="wide ? undefined : item.label"
              :aria-current="isActive(item) ? 'page' : undefined"
              @click="closeMobile"
            >
              <component
                :is="item.icon"
                v-if="item.icon"
                class="size-5 shrink-0"
                aria-hidden="true"
              />
              <span
                v-else-if="item.dot"
                :class="['mx-1.5 size-2 shrink-0 rounded-full', stageDotClasses[item.dot]]"
                aria-hidden="true"
              />
              <template v-if="wide">
                <span class="min-w-0 flex-1 truncate">{{ item.label }}</span>
                <span
                  v-if="item.count"
                  class="text-theme-xs text-gray-500 tabular-nums dark:text-gray-400"
                >
                  {{ item.count }}
                </span>
              </template>
            </RouterLink>
          </li>
        </ul>
      </div>
    </nav>
  </aside>
</template>
