<script setup lang="ts" generic="T extends { id: string }">
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-vue-next'
import { computed } from 'vue'
import UiCheckbox from './UiCheckbox.vue'
import { nextSort, sortState, type TableColumn } from './table'

/**
 * The table used on every list page, styled like the original TMS: grey
 * heading row, sortable headings, optional tick boxes, and grey pinned columns
 * (tick box + first column on the left, actions on the right) that stay in
 * view while the table scrolls sideways. Put it inside a UiCard.
 *
 * Cells: `<template #cell-title="{ row }">`; without a slot the value is shown as text.
 * Row actions: `<template #actions="{ row }">` with IconButtons.
 */
const props = withDefaults(
  defineProps<{
    columns: TableColumn[]
    rows: T[]
    loading?: boolean
    /** Shows tick boxes; use with v-model:selected. */
    selectable?: boolean
    /** Name read out for a row's tick box, e.g. its reference number. */
    rowLabel?: (row: T) => string
    emptyText?: string
    loadingText?: string
    /** Limits the height; the heading row then stays in view while scrolling down. */
    scrollHeight?: string
  }>(),
  {
    emptyText: 'Nothing here yet',
    loadingText: 'Loading…',
    rowLabel: undefined,
    scrollHeight: undefined,
  },
)
const sort = defineModel<string>('sort', { default: '' })
const selected = defineModel<string[]>('selected', { default: () => [] })
const slots = defineSlots<
  {
    actions?: (p: { row: T }) => unknown
    empty?: () => unknown
    toolbar?: () => unknown
    footer?: () => unknown
  } & Record<`cell-${string}`, (p: { row: T; value: unknown }) => unknown>
>()

const chosen = computed(() => new Set(selected.value))
const pageIds = computed(() => props.rows.map((r) => r.id))
const allChosen = computed(
  () => pageIds.value.length > 0 && pageIds.value.every((id) => chosen.value.has(id)),
)
const someChosen = computed(() => pageIds.value.some((id) => chosen.value.has(id)))

function toggleAll(on: boolean) {
  const others = selected.value.filter((id) => !pageIds.value.includes(id))
  selected.value = on ? [...others, ...pageIds.value] : others
}
function toggleRow(id: string, on: boolean) {
  selected.value = on ? [...selected.value, id] : selected.value.filter((x) => x !== id)
}

const stickyLeft = computed(() => (props.selectable ? '48px' : '0'))
const align = (c: TableColumn) =>
  c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : 'text-left'
const sortKey = (c: TableColumn) => (c.sort === true ? c.key : (c.sort ?? ''))
const sorted = (c: TableColumn) => !!c.sort && sortState(sort.value, sortKey(c)) !== 'none'
const cellValue = (row: T, key: string) => (row as Record<string, unknown>)[key]
const showValue = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : String(v))
</script>

<template>
  <div class="dt">
    <slot name="toolbar" />
    <div
      class="custom-scrollbar overflow-auto"
      :style="scrollHeight ? { maxHeight: scrollHeight } : undefined"
    >
      <table class="min-w-full border-separate border-spacing-0">
        <thead>
          <tr>
            <th v-if="selectable" scope="col" class="dt-head dt-sticky dt-check">
              <UiCheckbox
                label="Select every row on this page"
                :model-value="allChosen"
                :indeterminate="someChosen"
                :disabled="rows.length === 0"
                @update:model-value="toggleAll"
              />
            </th>
            <th
              v-for="c in columns"
              :key="c.key"
              scope="col"
              :aria-sort="c.sort ? sortState(sort, sortKey(c)) : undefined"
              :class="[
                'dt-head',
                align(c),
                c.sticky && 'dt-sticky dt-pinned',
                sorted(c) && 'dt-sorted',
              ]"
              :style="c.sticky ? { '--dt-left': stickyLeft } : undefined"
            >
              <button
                v-if="c.sort"
                type="button"
                :class="[
                  'inline-flex items-center gap-2 text-left',
                  c.align === 'right' && 'flex-row-reverse',
                ]"
                @click="sort = nextSort(sort, sortKey(c))"
              >
                {{ c.label }}
                <ArrowUp
                  v-if="sortState(sort, sortKey(c)) === 'ascending'"
                  class="size-4 shrink-0"
                  aria-hidden="true"
                />
                <ArrowDown
                  v-else-if="sortState(sort, sortKey(c)) === 'descending'"
                  class="size-4 shrink-0"
                  aria-hidden="true"
                />
                <ArrowUpDown v-else class="dt-sort-icon size-4 shrink-0" aria-hidden="true" />
              </button>
              <template v-else>{{ c.label }}</template>
            </th>
            <th v-if="slots.actions" scope="col" class="dt-head dt-sticky dt-actions text-left">
              Actions
            </th>
          </tr>
        </thead>
        <tbody :class="loading && rows.length > 0 && 'opacity-60'">
          <tr v-for="row in rows" :key="row.id" :class="chosen.has(row.id) && 'dt-selected'">
            <td v-if="selectable" class="dt-cell dt-sticky dt-check">
              <UiCheckbox
                :label="`Select ${rowLabel ? rowLabel(row) : 'row'}`"
                :model-value="chosen.has(row.id)"
                @update:model-value="(on: boolean) => toggleRow(row.id, on)"
              />
            </td>
            <td
              v-for="c in columns"
              :key="c.key"
              :class="['dt-cell', align(c), c.sticky && 'dt-sticky dt-pinned', c.class]"
              :style="c.sticky ? { '--dt-left': stickyLeft } : undefined"
            >
              <slot :name="`cell-${c.key}`" :row="row" :value="cellValue(row, c.key)">
                {{ showValue(cellValue(row, c.key)) }}
              </slot>
            </td>
            <td v-if="slots.actions" class="dt-cell dt-sticky dt-actions">
              <div class="flex items-center gap-2">
                <slot name="actions" :row="row" />
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      <div
        v-if="loading && rows.length === 0"
        class="flex items-center justify-center gap-2 px-6 py-8 text-sm text-gray-700 dark:text-gray-300"
        role="status"
      >
        <span
          class="size-6 animate-spin rounded-full border-2 border-blue-600 border-t-transparent"
          aria-hidden="true"
        />
        {{ loadingText }}
      </div>
      <template v-else-if="!loading && rows.length === 0">
        <slot name="empty">
          <p class="px-6 py-10 text-center text-sm text-gray-500 dark:text-gray-400">
            {{ emptyText }}
          </p>
        </slot>
      </template>
    </div>
    <slot name="footer" />
  </div>
</template>

<style>
/* Not scoped: the cells come from slots. Pinned cells need a solid background. */
.dt {
  --dt-head: var(--color-gray-50);
  --dt-head-hover: var(--color-gray-100);
  --dt-bg: #fff;
  --dt-pinned: var(--color-gray-100);
  --dt-selected: var(--color-blue-50);
  --dt-pinned-selected: color-mix(in srgb, var(--color-blue-500) 12%, var(--color-gray-100));
  --dt-line: var(--color-gray-200);
}
.dark .dt {
  --dt-head: var(--color-gray-800);
  --dt-head-hover: color-mix(in srgb, #fff 4%, var(--color-gray-800));
  --dt-bg: color-mix(in srgb, #fff 3%, var(--color-gray-950));
  --dt-pinned: var(--color-gray-900);
  --dt-selected: color-mix(in srgb, var(--color-blue-500) 12%, var(--color-gray-950));
  --dt-pinned-selected: color-mix(in srgb, var(--color-blue-500) 16%, var(--color-gray-900));
  --dt-line: var(--color-gray-800);
}
.dt-head {
  padding: 0.5rem;
  border-bottom: 1px solid var(--dt-line);
  background: var(--dt-head);
  font-size: 0.875rem;
  font-weight: 500;
  white-space: nowrap;
  color: var(--color-gray-800);
  transition: background-color 0.3s;
}
.dt-head:hover {
  background: var(--dt-head-hover);
}
.dark .dt-head {
  color: rgb(255 255 255 / 0.9);
}
.dt-sort-icon {
  color: #64748b;
}
.dt-head.dt-sorted,
.dt-head.dt-sorted .dt-sort-icon {
  color: var(--color-blue-500);
}
.dt-cell {
  padding: 0.5rem;
  border-bottom: 1px solid var(--dt-line);
  background: var(--dt-bg);
  vertical-align: middle;
  font-size: 0.875rem;
  font-weight: 300;
  color: var(--color-gray-800);
}
.dark .dt-cell {
  color: var(--color-gray-300);
}
.dt-cell.dt-sticky {
  background: var(--dt-pinned);
}
.dt tbody tr.dt-selected .dt-cell {
  background: var(--dt-selected);
}
.dt tbody tr.dt-selected .dt-cell.dt-sticky {
  background: var(--dt-pinned-selected);
}
.dt-check {
  width: 48px;
  min-width: 48px;
  padding-left: 0.375rem;
  padding-right: 0.25rem;
}
.dt-actions {
  width: 1%;
  white-space: nowrap;
}
/* The heading row stays in view when the table has a height limit. */
.dt thead th {
  position: sticky;
  top: 0;
  z-index: 3;
}
/* On a phone there is no room to pin columns; the whole table scrolls. */
@media (min-width: 768px) {
  .dt-sticky {
    position: sticky;
    left: var(--dt-left, 0);
    z-index: 2;
  }
  .dt thead th.dt-sticky {
    z-index: 4;
  }
  .dt-actions {
    left: auto;
    right: 0;
  }
}
</style>
