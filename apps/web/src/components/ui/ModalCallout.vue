<script setup lang="ts">
import { Bookmark, Info, TriangleAlert, type LucideIcon } from 'lucide-vue-next'
import { computed } from 'vue'

/**
 * The coloured strip with a thick left border that opens the original TMS
 * popups: "Info: …", "Warning: …".
 */
const props = defineProps<{
  tone: 'info' | 'warning' | 'danger'
  /** Bold lead-in, e.g. "Warning:". */
  lead?: string
  icon?: LucideIcon
}>()

const tones = {
  info: 'border-blue-400 bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300',
  warning:
    'border-yellow-400 bg-yellow-50 text-yellow-700 dark:bg-yellow-500/10 dark:text-yellow-300',
  danger: 'border-red-400 bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300',
}
const iconTones = { info: 'text-blue-400', warning: 'text-yellow-400', danger: 'text-red-400' }
const shown = computed(
  () =>
    props.icon ??
    (props.tone === 'info' ? Bookmark : props.tone === 'warning' ? TriangleAlert : Info),
)
</script>

<template>
  <div :class="['flex gap-3 border-l-4 p-4', tones[tone]]">
    <component :is="shown" :class="['size-5 shrink-0', iconTones[tone]]" aria-hidden="true" />
    <p class="text-sm">
      <span v-if="lead" class="font-medium">{{ lead }}</span>
      <slot />
    </p>
  </div>
</template>
