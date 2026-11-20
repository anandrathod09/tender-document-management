<script setup lang="ts">
import { LoaderCircle } from 'lucide-vue-next'
import type { Component } from 'vue'
import type { RouteLocationRaw } from 'vue-router'
import { vTooltip } from '@/directives/tooltip'

/**
 * The small square button used for row actions in every table. The label
 * shows on hover and is read out by screen readers. Use the same icon for
 * the same action everywhere (see `components/ui/actions.ts`).
 */
withDefaults(
  defineProps<{
    icon: Component
    label: string
    variant?: 'default' | 'primary' | 'danger'
    /** Makes it a link instead of a button. */
    to?: RouteLocationRaw
    href?: string
    disabled?: boolean
    loading?: boolean
  }>(),
  { variant: 'default' },
)

// The original TMS row buttons: filled grey, blue for the main action, red to reject or delete.
const variants = {
  default:
    'bg-gray-200 text-gray-700 hover:bg-gray-300 hover:text-gray-900 dark:bg-white/10 dark:text-white/90 dark:hover:bg-white/20',
  primary: 'bg-blue-500 text-white hover:bg-blue-600',
  danger: 'bg-red-500 text-white hover:bg-red-600',
}
const base =
  'inline-flex size-8 shrink-0 items-center justify-center rounded-md transition focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-500'
</script>

<template>
  <RouterLink
    v-if="to && !disabled"
    v-tooltip="label"
    :to="to"
    :aria-label="label"
    :class="[base, variants[variant]]"
  >
    <component :is="icon" class="size-4" aria-hidden="true" />
  </RouterLink>
  <a
    v-else-if="href && !disabled"
    v-tooltip="label"
    :href="href"
    target="_blank"
    rel="noopener noreferrer"
    :aria-label="label"
    :class="[base, variants[variant]]"
  >
    <component :is="icon" class="size-4" aria-hidden="true" />
  </a>
  <button
    v-else
    v-tooltip="label"
    type="button"
    :aria-label="label"
    :disabled="disabled || loading"
    :class="[base, variants[variant], 'disabled:cursor-not-allowed disabled:opacity-50']"
  >
    <LoaderCircle v-if="loading" class="size-4 animate-spin" aria-hidden="true" />
    <component :is="icon" v-else class="size-4" aria-hidden="true" />
  </button>
</template>
