<script setup lang="ts">
import { Check, Minus } from 'lucide-vue-next'
import { computed, ref, watchEffect } from 'vue'

/** Tick box of the original TMS: a 24px white box that fills blue when ticked. */
const props = defineProps<{ label: string; indeterminate?: boolean; disabled?: boolean }>()
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
      'inline-flex cursor-pointer items-center justify-center p-1',
      disabled && 'cursor-not-allowed opacity-60',
    ]"
  >
    <span class="sr-only">{{ label }}</span>
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
  </label>
</template>
