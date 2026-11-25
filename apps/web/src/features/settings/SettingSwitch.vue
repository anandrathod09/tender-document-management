<script setup lang="ts">
/** One on/off setting: the switch, its name, and a line on what it does. */
defineProps<{ title: string; description: string; on: boolean; disabled?: boolean }>()
defineEmits<{ toggle: [] }>()
</script>

<template>
  <div class="flex items-start gap-3 py-4">
    <button
      type="button"
      role="switch"
      :aria-checked="on"
      :aria-label="title"
      :disabled="disabled"
      :class="[
        'relative mt-0.5 inline-flex h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50',
        on ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-700',
      ]"
      @click="$emit('toggle')"
    >
      <span
        :class="[
          'absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow-theme-sm transition-transform',
          on && 'translate-x-5',
        ]"
      />
    </button>
    <div class="min-w-0 flex-1">
      <p class="text-sm font-medium text-gray-800 dark:text-white/90">{{ title }}</p>
      <p class="mt-0.5 text-sm text-gray-500 dark:text-gray-400">{{ description }}</p>
      <slot />
    </div>
  </div>
</template>
