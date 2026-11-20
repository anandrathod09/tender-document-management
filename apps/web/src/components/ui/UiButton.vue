<script setup lang="ts">
import { LoaderCircle } from 'lucide-vue-next'

/**
 * Buttons in the style of the original TMS: blue for the main action, grey
 * for Cancel and other secondary actions, red for destructive ones.
 */
withDefaults(
  defineProps<{
    variant?: 'primary' | 'secondary' | 'outline' | 'danger' | 'success' | 'ghost'
    size?: 'xs' | 'sm' | 'md'
    type?: 'button' | 'submit'
    loading?: boolean
    disabled?: boolean
    block?: boolean
  }>(),
  { variant: 'primary', size: 'md', type: 'button' },
)

const variants = {
  primary: 'border-blue-500 bg-blue-500 text-white hover:border-blue-600 hover:bg-blue-600',
  secondary:
    'border-transparent bg-gray-200 text-gray-700 hover:bg-gray-300 hover:text-gray-800 dark:bg-white/5 dark:text-white/90 dark:hover:bg-white/10',
  outline:
    'border-gray-300 bg-white text-gray-700 hover:bg-gray-100 dark:border-white/10 dark:bg-transparent dark:text-gray-300 dark:hover:bg-white/10',
  danger: 'border-red-500 bg-red-500 text-white hover:border-red-600 hover:bg-red-600',
  success: 'border-green-500 bg-green-500 text-white hover:border-green-600 hover:bg-green-600',
  ghost:
    'border-transparent text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-white/5',
}
const sizes = {
  xs: 'h-9 px-3 text-xs',
  sm: 'h-10 px-4 text-sm',
  md: 'h-11 px-5 text-sm',
}
</script>

<template>
  <button
    :type="type"
    :disabled="disabled || loading"
    :aria-busy="loading || undefined"
    :class="[
      'inline-flex items-center justify-center gap-2 rounded-md border whitespace-nowrap transition disabled:cursor-not-allowed disabled:opacity-50',
      variants[variant],
      sizes[size],
      block && 'w-full',
    ]"
  >
    <LoaderCircle v-if="loading" class="size-4 animate-spin" aria-hidden="true" />
    <slot />
  </button>
</template>
