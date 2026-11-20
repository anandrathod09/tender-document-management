<script setup lang="ts">
import { useId } from 'vue'

const model = defineModel<string>({ default: '' })
defineProps<{
  label: string
  options: { value: string; label: string }[]
  error?: string
  placeholder?: string
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
    <select
      :id="id"
      v-model="model"
      :required="required"
      :disabled="disabled"
      :aria-invalid="error ? 'true' : undefined"
      :class="[
        'form-field appearance-none bg-[length:16px] bg-[right_1rem_center] bg-no-repeat pr-10',
        error && 'border-error-300',
      ]"
      style="
        background-image: url(&quot;data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='%23667085'%3E%3Cpath d='M5.3 7.3a1 1 0 0 1 1.4 0L10 10.6l3.3-3.3a1 1 0 1 1 1.4 1.4l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 0 1 0-1.4z'/%3E%3C/svg%3E&quot;);
      "
    >
      <option v-if="placeholder" value="" disabled>{{ placeholder }}</option>
      <option v-for="o in options" :key="o.value" :value="o.value">{{ o.label }}</option>
    </select>
    <p v-if="error" class="mt-1.5 text-theme-xs text-error-500">{{ error }}</p>
  </div>
</template>
