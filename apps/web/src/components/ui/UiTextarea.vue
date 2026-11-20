<script setup lang="ts">
import { useId } from 'vue'

/** Multi-line text box with the label, "(Optional)" marker and hint of the original TMS. */
const model = defineModel<string>({ default: '' })
defineProps<{
  label: string
  required?: boolean
  /** Shows "(Optional)" after the label. */
  optional?: boolean
  hint?: string
  error?: string
  placeholder?: string
  rows?: number
  maxlength?: number
}>()
const id = useId()
</script>

<template>
  <div class="space-y-2">
    <label :for="id" class="block text-sm font-medium text-gray-700 dark:text-gray-300">
      {{ label }}
      <span v-if="required" class="text-red-500">*</span>
      <span v-else-if="optional" class="text-xs font-normal text-gray-400">(Optional)</span>
    </label>
    <textarea
      :id="id"
      v-model="model"
      :rows="rows ?? 4"
      :maxlength="maxlength"
      :placeholder="placeholder"
      :aria-invalid="error ? 'true' : undefined"
      :aria-describedby="error || hint ? `${id}-hint` : undefined"
      :class="['form-field h-auto', error && 'border-error-300']"
    />
    <p
      v-if="error || hint"
      :id="`${id}-hint`"
      :class="['text-xs', error ? 'text-error-500' : 'text-gray-500 dark:text-gray-400']"
    >
      {{ error ?? hint }}
    </p>
  </div>
</template>
