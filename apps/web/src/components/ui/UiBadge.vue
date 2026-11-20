<script setup lang="ts">
import type { BadgeColor } from '@/utils/format'

withDefaults(defineProps<{ color?: BadgeColor }>(), { color: 'gray' })

// Solid badges with the colours of the original TMS.
const colors: Record<BadgeColor, string> = {
  success: 'bg-[#7AA90D]',
  warning: 'bg-[#FC9A1D]',
  error: 'bg-[#C40233]',
  info: 'bg-blue-400',
  gray: 'bg-[#7F7F7F]',
}
</script>

<template>
  <span
    :class="[
      'inline-flex min-w-[50px] items-center justify-center rounded-sm px-1.5 py-1 text-[10px] leading-none font-normal whitespace-nowrap text-white',
      colors[color],
    ]"
  >
    <slot />
  </span>
</template>
