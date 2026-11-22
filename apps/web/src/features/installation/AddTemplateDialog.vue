<script setup lang="ts">
import { ref, watch } from 'vue'
import type { SerialType } from '@tdm/shared'
import ModalNote from '@/components/ui/ModalNote.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiModal from '@/components/ui/UiModal.vue'
import { TEMPLATE_TYPES } from './installation-ui'

/** The old TMS "Select Report Template" popup: the template type and how many rows. */
const props = defineProps<{ open: boolean; consigneeName: string }>()
const emit = defineEmits<{ close: []; add: [type: SerialType, quantity: number] }>()

const type = ref<SerialType | ''>('')
const quantity = ref('1')
const error = ref('')

watch(
  () => props.open,
  (open) => {
    if (open) {
      type.value = ''
      quantity.value = '1'
      error.value = ''
    }
  },
)

function submit() {
  const qty = Number(quantity.value)
  if (!type.value) {
    error.value = 'Select a report template format.'
    return
  }
  if (!Number.isInteger(qty) || qty < 1 || qty > 500) {
    error.value = 'Number of items must be between 1 and 500.'
    return
  }
  emit('add', type.value, qty)
}
</script>

<template>
  <UiModal :open="open" title="Select Report Template" @close="emit('close')">
    <form id="add-template" class="flex flex-col gap-4" novalidate @submit.prevent="submit">
      <p class="text-sm text-gray-600 dark:text-gray-400">
        For <span class="font-medium text-gray-800 dark:text-white/90">{{ consigneeName }}</span>
      </p>
      <fieldset class="space-y-3">
        <legend class="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">
          Select Report Template Format <span class="text-error-500">*</span>
        </legend>
        <ModalNote tone="warning">
          Choose one template format. You can add another template for items that use the other
          format.
        </ModalNote>
        <label
          v-for="t in TEMPLATE_TYPES"
          :key="t.value"
          :class="[
            'flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors',
            type === t.value
              ? 'border-blue-300 bg-blue-50 dark:border-blue-700 dark:bg-blue-900/20'
              : 'border-gray-200 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-white/5',
          ]"
        >
          <input
            v-model="type"
            type="radio"
            name="template-type"
            :value="t.value"
            class="mt-1 accent-blue-600"
          />
          <span>
            <span class="block text-sm font-medium text-gray-800 dark:text-white/90">{{
              t.label
            }}</span>
            <span class="block text-xs text-gray-500 dark:text-gray-400">{{ t.description }}</span>
          </span>
        </label>
      </fieldset>
      <UiInput
        v-model="quantity"
        label="Number of Items"
        type="number"
        required
        hint="This many item rows will be created for this template (1 to 500). Empty rows are not saved as units until someone fills them in."
      />
      <p v-if="error" class="text-sm text-error-500" role="alert">{{ error }}</p>
    </form>
    <template #footer>
      <UiButton variant="secondary" @click="emit('close')">Cancel</UiButton>
      <UiButton type="submit" form="add-template">Add Template</UiButton>
    </template>
  </UiModal>
</template>
