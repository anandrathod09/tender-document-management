<script setup lang="ts">
import { X } from 'lucide-vue-next'
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'

/**
 * Popup in the style of the original TMS: title bar with a line under it,
 * a body that scrolls when long, and buttons in a footer with a line above.
 */
const props = defineProps<{
  open: boolean
  title: string
  width?: 'md' | 'lg' | 'xl'
  /** Dims the body with a spinner while the action runs. */
  busy?: boolean
}>()
const emit = defineEmits<{ close: [] }>()
const panel = ref<HTMLElement | null>(null)

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && !props.busy) emit('close')
}
function close() {
  if (!props.busy) emit('close')
}

watch(
  () => props.open,
  async (open) => {
    if (open) {
      document.addEventListener('keydown', onKey)
      await nextTick()
      panel.value
        ?.querySelector<HTMLElement>(
          '.modal-body input, .modal-body select, .modal-body textarea, .modal-body [role=combobox]',
        )
        ?.focus()
    } else {
      document.removeEventListener('keydown', onKey)
    }
  },
  { immediate: true },
)
onBeforeUnmount(() => document.removeEventListener('keydown', onKey))

const widths = { md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' }
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition-opacity duration-200"
      leave-active-class="transition-opacity duration-200"
      enter-from-class="opacity-0"
      leave-to-class="opacity-0"
    >
      <div
        v-if="open"
        class="fixed inset-0 z-99999 flex items-center justify-center bg-gray-400/50 p-4 backdrop-blur-[25px] dark:bg-gray-950/60"
        @click.self="close"
      >
        <div
          ref="panel"
          role="dialog"
          aria-modal="true"
          :aria-label="title"
          :class="[
            'relative flex max-h-[calc(100vh-40px)] w-full flex-col rounded-lg bg-white py-6 shadow-lg dark:bg-gray-800',
            widths[width ?? 'md'],
          ]"
        >
          <div
            class="mx-6 flex items-center justify-between gap-4 border-b border-gray-300 pb-4 dark:border-gray-700"
          >
            <h2 class="text-xl text-gray-900 dark:text-white">{{ title }}</h2>
            <button
              type="button"
              class="flex size-7 shrink-0 items-center justify-center rounded-full text-gray-500 hover:bg-gray-200 dark:text-white dark:hover:bg-gray-700"
              aria-label="Close"
              :disabled="busy"
              @click="close"
            >
              <X class="size-5" />
            </button>
          </div>

          <div class="modal-body custom-scrollbar my-2 flex-1 overflow-auto px-6 py-4">
            <slot />
          </div>

          <div
            v-if="busy"
            class="absolute inset-x-0 top-0 bottom-[85px] z-10 flex items-center justify-center rounded-lg bg-white/80 backdrop-blur-[2px] dark:bg-gray-800/80"
            aria-hidden="true"
          >
            <div
              class="size-6 animate-spin rounded-full border-2 border-blue-600 border-t-transparent"
            />
          </div>

          <div
            v-if="$slots.footer"
            class="mx-6 flex flex-wrap justify-end gap-3 border-t border-gray-300 pt-4 dark:border-gray-700"
          >
            <slot name="footer" />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
