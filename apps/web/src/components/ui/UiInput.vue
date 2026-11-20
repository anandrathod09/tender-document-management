<script setup lang="ts">
import { useId } from 'vue'

const model = defineModel<string>({ default: '' })
defineProps<{
  label: string
  type?: string
  error?: string
  hint?: string
  placeholder?: string
  autocomplete?: string
  required?: boolean
  disabled?: boolean
}>()
const id = useId()
</script>

<template>
  <div>
    <label :for="id" class="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
      {{ label }}<span v-if="required" class="text-error-500"> *</span>
    </label>
    <input
      :id="id"
      v-model="model"
      :type="type ?? 'text'"
      :placeholder="placeholder"
      :autocomplete="autocomplete"
      :required="required"
      :disabled="disabled"
      :aria-invalid="error ? 'true' : undefined"
      :aria-describedby="error || hint ? `${id}-msg` : undefined"
      :class="[
        'form-field',
        error && 'border-error-300 focus:border-error-300 focus:ring-error-500/10',
      ]"
    />
    <p
      v-if="error || hint"
      :id="`${id}-msg`"
      :class="[
        'mt-1.5 text-theme-xs',
        error ? 'text-error-500' : 'text-gray-500 dark:text-gray-400',
      ]"
    >
      {{ error || hint }}
    </p>
  </div>
</template>
