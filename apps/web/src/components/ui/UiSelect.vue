<script setup lang="ts" generic="T extends string | number">
import { Check, ChevronDown, Search } from 'lucide-vue-next'
import {
  ListboxContent,
  ListboxFilter,
  ListboxItem,
  ListboxRoot,
  PopoverContent,
  PopoverPortal,
  PopoverRoot,
  PopoverTrigger,
} from 'reka-ui'
import { computed, ref, useId, watch } from 'vue'

/**
 * Dropdown in the style of the original TMS: a field that opens a panel of
 * options, the chosen one in blue, with a search box at the top of long lists.
 * Keyboard: arrows, Enter, type a letter to jump, Escape to close.
 */
export interface SelectOption<V> {
  value: V
  label: string
  disabled?: boolean
  /** Classes for a small colour dot before the label (stage colours). */
  dot?: string
}

const model = defineModel<T>()
const props = withDefaults(
  defineProps<{
    options: SelectOption<T>[]
    /** Shown above the field. Leave out for filter bars and give `ariaLabel` instead. */
    label?: string
    ariaLabel?: string
    error?: string
    placeholder?: string
    required?: boolean
    disabled?: boolean
    /** md: form fields; sm: filter bars and table cells. */
    size?: 'md' | 'sm'
    /** As wide as the longest option, instead of the full width. */
    fit?: boolean
    /** Search box at the top. By default only for lists longer than 8. */
    search?: boolean
  }>(),
  { size: 'md', search: undefined },
)

const id = useId()
const open = ref(false)
const query = ref('')
const listbox = ref<{ highlightSelected: () => Promise<void> } | null>(null)
const trigger = ref<HTMLButtonElement | null>(null)

const current = computed(() => props.options.find((o) => o.value === model.value))
const searchable = computed(() => props.search ?? props.options.length > 8)
const shown = computed(() => {
  const q = query.value.trim().toLowerCase()
  return q ? props.options.filter((o) => o.label.toLowerCase().includes(q)) : props.options
})

watch(open, (isOpen) => {
  if (!isOpen) query.value = ''
})

function pick(value: unknown) {
  if (value !== undefined && value !== null) model.value = value as T
  open.value = false
}

function onOpened(event: Event) {
  // The search box focuses itself; without one, focus the chosen option.
  event.preventDefault()
  if (!searchable.value) listbox.value?.highlightSelected()
}

const sizes = {
  md: 'h-11 px-4 text-sm',
  sm: 'h-9 px-3 text-sm',
}
</script>

<template>
  <div>
    <label
      v-if="label"
      :id="`${id}-label`"
      class="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400"
      @click="trigger?.focus()"
    >
      {{ label }}<span v-if="required" class="text-error-500"> *</span>
    </label>

    <PopoverRoot v-model:open="open">
      <PopoverTrigger as-child>
        <button
          :id="id"
          ref="trigger"
          type="button"
          role="combobox"
          aria-haspopup="listbox"
          :aria-expanded="open"
          :aria-labelledby="label ? `${id}-label ${id}` : undefined"
          :aria-label="label ? undefined : ariaLabel"
          :aria-required="required || undefined"
          :aria-invalid="error ? 'true' : undefined"
          :aria-describedby="error ? `${id}-msg` : undefined"
          :disabled="disabled"
          :class="[
            'flex items-center gap-2 rounded-lg border bg-transparent text-left text-gray-800 shadow-theme-xs focus:ring-3 focus:outline-hidden disabled:cursor-not-allowed disabled:bg-gray-50 dark:bg-gray-900 dark:text-white/90 dark:disabled:bg-gray-800',
            sizes[size],
            fit ? 'w-auto max-w-full' : 'w-full',
            error
              ? 'border-error-300 focus:ring-error-500/10'
              : open
                ? 'border-brand-300 ring-3 ring-brand-500/10 dark:border-brand-800'
                : 'border-gray-300 focus:border-brand-300 focus:ring-brand-500/10 dark:border-gray-700 dark:focus:border-brand-800',
          ]"
          @keydown.down.prevent="open = true"
          @keydown.up.prevent="open = true"
        >
          <!-- The hidden copies keep a "fit" field as wide as its longest option. -->
          <span class="grid min-w-0 flex-1">
            <template v-if="fit">
              <span
                v-for="o in options"
                :key="`w-${o.value}`"
                class="invisible col-start-1 row-start-1 h-0 overflow-hidden whitespace-nowrap"
                :class="o.dot && 'pl-5'"
                aria-hidden="true"
                >{{ o.label }}</span
              >
            </template>
            <span
              :class="[
                'col-start-1 row-start-1 flex min-w-0 items-center gap-2',
                !current && 'text-gray-400 dark:text-white/30',
              ]"
            >
              <span
                v-if="current?.dot"
                :class="['size-3 shrink-0 rounded-full', current.dot]"
                aria-hidden="true"
              />
              <span class="truncate">{{ current?.label ?? placeholder ?? '' }}</span>
            </span>
          </span>
          <ChevronDown
            :class="[
              'size-4 shrink-0 text-gray-500 transition-transform dark:text-gray-400',
              open && 'rotate-180',
            ]"
            aria-hidden="true"
          />
        </button>
      </PopoverTrigger>

      <PopoverPortal>
        <PopoverContent
          side="bottom"
          align="start"
          :side-offset="4"
          :collision-padding="8"
          class="z-100000 max-h-(--reka-popover-content-available-height) w-(--reka-popover-trigger-width) min-w-44 overflow-hidden rounded-lg border border-gray-200 bg-white p-1.5 shadow-theme-lg dark:border-gray-800 dark:bg-gray-900"
          @open-auto-focus="onOpened"
          @keydown.esc.stop.prevent="open = false"
        >
          <ListboxRoot
            ref="listbox"
            :model-value="model"
            highlight-on-hover
            class="flex flex-col"
            @update:model-value="pick"
          >
            <div v-if="searchable" class="relative mb-1.5">
              <Search
                class="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-gray-400"
                aria-hidden="true"
              />
              <ListboxFilter
                v-model="query"
                auto-focus
                placeholder="Search"
                aria-label="Search options"
                class="h-8 w-full rounded-md border border-gray-300 bg-transparent pr-2 pl-8 text-sm text-gray-800 placeholder:text-gray-400 focus:border-brand-300 focus:ring-3 focus:ring-brand-500/10 focus:outline-hidden dark:border-gray-700 dark:text-white/90 dark:placeholder:text-white/30 dark:focus:border-brand-800"
              />
            </div>
            <ListboxContent
              class="custom-scrollbar flex max-h-60 flex-col gap-0.5 overflow-y-auto focus:outline-hidden"
            >
              <ListboxItem
                v-for="o in shown"
                :key="String(o.value)"
                :value="o.value"
                :disabled="o.disabled"
                class="group flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-theme-sm font-medium text-gray-700 outline-hidden select-none data-disabled:cursor-not-allowed data-disabled:opacity-50 data-highlighted:bg-gray-100 data-[state=checked]:bg-blue-500 data-[state=checked]:text-white dark:text-gray-400 dark:data-highlighted:bg-white/5 dark:data-[state=checked]:bg-blue-500 dark:data-[state=checked]:text-white"
              >
                <span
                  v-if="o.dot"
                  :class="[
                    'size-3 shrink-0 rounded-full group-data-[state=checked]:ring-2 group-data-[state=checked]:ring-white/70',
                    o.dot,
                  ]"
                  aria-hidden="true"
                />
                <span class="min-w-0 flex-1 truncate">{{ o.label }}</span>
                <Check
                  class="hidden size-4 shrink-0 group-data-[state=checked]:block"
                  aria-hidden="true"
                />
              </ListboxItem>
              <p v-if="!shown.length" class="px-2 py-2 text-theme-sm text-gray-500">
                Nothing matches “{{ query }}”
              </p>
            </ListboxContent>
          </ListboxRoot>
        </PopoverContent>
      </PopoverPortal>
    </PopoverRoot>

    <p v-if="error" :id="`${id}-msg`" class="mt-1.5 text-theme-xs text-error-500">{{ error }}</p>
  </div>
</template>
