<script setup lang="ts">
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-vue-next'
import { computed } from 'vue'

/**
 * Paging footer of the original TMS: "Showing 1-20 of 57 tenders", round page
 * buttons and a rows-per-page choice. Shown even when everything fits on one page.
 */
const props = withDefaults(
  defineProps<{
    page: number
    pageSize: number
    total: number
    shown: number
    /** Plural name of the rows, e.g. "tenders". */
    noun?: string
    /** Offer a rows-per-page choice. */
    pageSizes?: number[]
  }>(),
  { noun: 'items', pageSizes: undefined },
)
const emit = defineEmits<{ change: [page: number]; pageSize: [size: number] }>()

const pages = computed(() => Math.max(1, Math.ceil(props.total / props.pageSize)))
const start = computed(() => (props.total === 0 ? 0 : (props.page - 1) * props.pageSize + 1))
const end = computed(() => (props.total === 0 ? 0 : start.value + props.shown - 1))

/** Up to five page numbers around the current page. */
const numbers = computed(() => {
  const count = Math.min(5, pages.value)
  let first = Math.max(1, props.page - 2)
  first = Math.min(first, pages.value - count + 1)
  return Array.from({ length: count }, (_, i) => first + i)
})

function go(p: number) {
  if (p >= 1 && p <= pages.value && p !== props.page) emit('change', p)
}

const btn =
  'inline-flex size-10 items-center justify-center rounded-full text-sm text-gray-600 transition hover:bg-gray-100 disabled:pointer-events-none disabled:opacity-40 dark:text-gray-300 dark:hover:bg-gray-800'
</script>

<template>
  <div class="flex w-full flex-wrap items-center justify-between gap-3">
    <p class="text-xs text-gray-500 dark:text-gray-400" aria-live="polite">
      Showing {{ start }}-{{ end }} of {{ total }} {{ noun }}
      <slot name="extra" />
    </p>
    <nav class="flex flex-wrap items-center gap-1" aria-label="Pages">
      <button
        type="button"
        :class="btn"
        :disabled="page <= 1"
        aria-label="First page"
        @click="go(1)"
      >
        <ChevronsLeft class="size-4" aria-hidden="true" />
      </button>
      <button
        type="button"
        :class="btn"
        :disabled="page <= 1"
        aria-label="Previous page"
        @click="go(page - 1)"
      >
        <ChevronLeft class="size-4" aria-hidden="true" />
      </button>
      <button
        v-for="n in numbers"
        :key="n"
        type="button"
        :class="[btn, n === page && 'bg-blue-500 text-white! hover:bg-blue-500']"
        :aria-current="n === page ? 'page' : undefined"
        :aria-label="`Page ${n}`"
        @click="go(n)"
      >
        {{ n }}
      </button>
      <button
        type="button"
        :class="btn"
        :disabled="page >= pages"
        aria-label="Next page"
        @click="go(page + 1)"
      >
        <ChevronRight class="size-4" aria-hidden="true" />
      </button>
      <button
        type="button"
        :class="btn"
        :disabled="page >= pages"
        aria-label="Last page"
        @click="go(pages)"
      >
        <ChevronsRight class="size-4" aria-hidden="true" />
      </button>
      <select
        v-if="pageSizes"
        :value="pageSize"
        class="form-field ml-1 h-10! w-auto! py-0! pr-8!"
        aria-label="Rows per page"
        @change="emit('pageSize', Number(($event.target as HTMLSelectElement).value))"
      >
        <option v-for="s in pageSizes" :key="s" :value="s">{{ s }}</option>
      </select>
    </nav>
  </div>
</template>
