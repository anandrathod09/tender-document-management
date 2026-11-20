import {
  computed,
  inject,
  onMounted,
  onUnmounted,
  provide,
  ref,
  type ComputedRef,
  type Ref,
} from 'vue'

interface SidebarContext {
  /** Full width with labels (desktop). */
  isExpanded: ComputedRef<boolean>
  /** Open as an overlay (mobile). */
  isMobileOpen: Ref<boolean>
  isHovered: Ref<boolean>
  toggle: () => void
  closeMobile: () => void
}

const KEY = Symbol('sidebar')

/** Call once in the admin layout; children use useSidebar(). */
export function provideSidebar(): SidebarContext {
  const expanded = ref(true)
  const isMobileOpen = ref(false)
  const isHovered = ref(false)
  const isMobile = ref(false)

  const onResize = () => {
    isMobile.value = window.innerWidth < 1024
    if (!isMobile.value) isMobileOpen.value = false
  }
  onMounted(() => {
    onResize()
    window.addEventListener('resize', onResize)
  })
  onUnmounted(() => window.removeEventListener('resize', onResize))

  const ctx: SidebarContext = {
    isExpanded: computed(() => !isMobile.value && expanded.value),
    isMobileOpen,
    isHovered,
    toggle: () => {
      if (isMobile.value) isMobileOpen.value = !isMobileOpen.value
      else expanded.value = !expanded.value
    },
    closeMobile: () => {
      isMobileOpen.value = false
    },
  }
  provide(KEY, ctx)
  return ctx
}

export function useSidebar(): SidebarContext {
  const ctx = inject<SidebarContext>(KEY)
  if (!ctx) throw new Error('useSidebar must be used inside AdminLayout')
  return ctx
}
