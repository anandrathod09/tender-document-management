<script setup lang="ts">
import { Check, Minus } from 'lucide-vue-next'
import { computed, ref, watchEffect } from 'vue'

/** Tick box of the original TMS: a 24px white box that fills blue when ticked. */
const props = defineProps<{
  label: string
  indeterminate?: boolean
  disabled?: boolean
  /** Shows the label next to the box (tables keep it for screen readers only). */
  showLabel?: boolean
}>()
const model = defineModel<boolean>({ default: false })
const input = ref<HTMLInputElement | null>(null)
const partial = computed(() => !!props.indeterminate && !model.value)

// "Some selected" can only be set from script.
watchEffect(() => {
  if (input.value) input.value.indeterminate = partial.value
})
</script>

<template>
  <label
    :class="[
      'inline-flex cursor-pointer items-center justify-center gap-2 p-1',
      disabled && 'cursor-not-allowed opacity-60',
    ]"
  >
    <span v-if="!showLabel" class="sr-only">{{ label }}</span>
    <input ref="input" v-model="model" type="checkbox" :disabled="disabled" class="peer sr-only" />
    <span
      :class="[
        'flex size-6 items-center justify-center rounded border transition peer-focus-visible:ring-3 peer-focus-visible:ring-brand-500/30',
        model || partial
          ? 'border-brand-500 bg-brand-500 text-white'
          : 'border-gray-300 bg-white hover:border-brand-400 dark:border-gray-600 dark:bg-gray-800',
      ]"
      aria-hidden="true"
    >
      <Check v-if="model" class="size-4" stroke-width="3" />
      <Minus v-else-if="partial" class="size-4" stroke-width="3" />
    </span>
    <span v-if="showLabel" class="text-sm text-gray-600 dark:text-gray-400">{{ label }}</span>
  </label>
</template>
