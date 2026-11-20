<script setup lang="ts">
import { Check, Copy } from 'lucide-vue-next'
import { ref } from 'vue'

const props = defineProps<{ value: string; label?: string }>()
const copied = ref(false)

async function copy() {
  try {
    await navigator.clipboard.writeText(props.value)
    copied.value = true
    setTimeout(() => (copied.value = false), 2000)
  } catch {
    // Clipboard blocked: the text is selectable, so the user can copy it by hand.
  }
}
</script>

<template>
  <div>
    <p v-if="label" class="mb-1.5 text-sm font-medium text-gray-700 dark:text-gray-400">
      {{ label }}
    </p>
    <div class="flex items-stretch gap-2">
      <input
        :value="value"
        readonly
        class="form-field font-mono text-xs"
        @focus="($event.target as HTMLInputElement).select()"
      />
      <button
        type="button"
        class="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-gray-700 ring-1 ring-gray-300 ring-inset hover:bg-gray-50 dark:text-gray-300 dark:ring-gray-700 dark:hover:bg-white/5"
        @click="copy"
      >
        <component :is="copied ? Check : Copy" class="size-4" aria-hidden="true" />
        {{ copied ? 'Copied' : 'Copy' }}
      </button>
    </div>
  </div>
</template>
