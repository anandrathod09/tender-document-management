<script setup lang="ts">
import { CircleAlert, CircleCheck, Info } from 'lucide-vue-next'
import { computed } from 'vue'

const props = withDefaults(defineProps<{ variant?: 'error' | 'success' | 'info' | 'warning' }>(), {
  variant: 'error',
})

const styles = {
  error: 'border-error-500/30 bg-error-50 text-error-700 dark:bg-error-500/15 dark:text-error-300',
  success:
    'border-success-500/30 bg-success-50 text-success-700 dark:bg-success-500/15 dark:text-success-500',
  info: 'border-blue-light-500/30 bg-blue-light-50 text-blue-light-700 dark:bg-blue-light-500/15 dark:text-blue-light-500',
  warning:
    'border-warning-500/30 bg-warning-50 text-warning-700 dark:bg-warning-500/15 dark:text-warning-500',
}
const icon = computed(() =>
  props.variant === 'success' ? CircleCheck : props.variant === 'error' ? CircleAlert : Info,
)
</script>

<template>
  <div
    :role="variant === 'error' ? 'alert' : 'status'"
    :class="['flex gap-3 rounded-lg border p-4 text-sm', styles[variant]]"
  >
    <component :is="icon" class="mt-0.5 size-5 shrink-0" aria-hidden="true" />
    <div class="min-w-0 flex-1"><slot /></div>
  </div>
</template>
