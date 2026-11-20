<script setup lang="ts">
import { ImageOff } from 'lucide-vue-next'
import { ref, watch } from 'vue'
import { fileLink } from '@/services/files'

/** Shows a stored image (logo, signature) through a short-lived link. */
const props = defineProps<{ fileId: string | null; alt: string }>()
const src = ref('')
const failed = ref(false)

watch(
  () => props.fileId,
  async (id) => {
    src.value = ''
    failed.value = false
    if (!id) return
    try {
      src.value = await fileLink(id, true)
    } catch {
      failed.value = true
    }
  },
  { immediate: true },
)
</script>

<template>
  <img
    v-if="src"
    :src="src"
    :alt="alt"
    class="max-h-full max-w-full object-contain"
    @error="failed = true"
  />
  <ImageOff
    v-else-if="failed"
    class="size-5 text-gray-400"
    :aria-label="`${alt} could not be loaded`"
  />
</template>
