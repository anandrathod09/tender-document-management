<script setup lang="ts">
import type { StageColor } from '@tdm/shared/workflow'
import { stageColorClasses } from '@/utils/tenders'

defineProps<{ label: string; color: StageColor }>()
</script>

<template>
  <span
    :class="[
      'inline-flex min-w-[50px] items-center justify-center rounded-sm px-1.5 py-1 text-[10px] leading-none whitespace-nowrap',
      stageColorClasses[color],
    ]"
  >
    {{ label }}
  </span>
</template>
