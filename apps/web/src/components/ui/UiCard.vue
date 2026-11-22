<script setup lang="ts">
import type { Component } from 'vue'

/**
 * The card of the original TMS: a title bar (icon, title and tools on the
 * right) with a line under it, the body, and an optional footer.
 */
defineProps<{
  title?: string
  subtitle?: string
  icon?: Component
  /** No padding around the body, for tables that run edge to edge. */
  flush?: boolean
  /** 1 when the card title is the page's own title (list pages). */
  level?: 1 | 2
  /** Coloured left edge on the header, as in the old TMS report pages. */
  accent?: 'blue' | 'red' | 'green' | 'purple'
}>()

const ACCENTS = {
  blue: 'border-l-4 border-l-blue-500',
  red: 'border-l-4 border-l-red-500',
  green: 'border-l-4 border-l-green-500',
  purple: 'border-l-4 border-l-purple-500',
} as const
</script>

<template>
  <section
    class="flex flex-col rounded-md border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]"
  >
    <header
      v-if="title || $slots.header"
      :class="[
        'flex flex-wrap items-center gap-x-6 gap-y-3 rounded-t-md border-b border-gray-200 p-4 dark:border-gray-800',
        accent && ACCENTS[accent],
      ]"
    >
      <component
        :is="level === 1 ? 'h1' : 'h2'"
        v-if="title"
        :class="[
          'flex flex-1 items-center gap-2 font-medium text-gray-800 dark:text-white/90',
          level === 1 ? 'text-xl' : 'text-lg',
        ]"
      >
        <component :is="icon" v-if="icon" class="size-7 shrink-0" aria-hidden="true" />
        <span class="flex min-w-0 flex-col">
          <span class="sm:whitespace-nowrap">{{ title }}</span>
          <span v-if="subtitle" class="text-sm font-normal text-gray-500 dark:text-gray-400">
            {{ subtitle }}
          </span>
        </span>
      </component>
      <div v-if="$slots.header" class="flex flex-wrap items-center gap-2">
        <slot name="header" />
      </div>
    </header>
    <div :class="['min-w-0', !flush && 'p-4']">
      <slot />
    </div>
    <footer v-if="$slots.footer" class="border-t border-gray-200 p-4 dark:border-gray-800">
      <slot name="footer" />
    </footer>
  </section>
</template>
