<script setup lang="ts">
import { ref, watch } from 'vue'
import type { SerialType } from '@tdm/shared'
import UiButton from '@/components/ui/UiButton.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiModal from '@/components/ui/UiModal.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import UiTextarea from '@/components/ui/UiTextarea.vue'
import { SERIAL_TYPE_OPTIONS, type NewItem } from './installation-ui'

/**
 * Adds an item to a consignee (the old TMS "Add Report Template"): what it
 * is, how its serial numbers are recorded, how many units, and the warranty.
 */
const props = defineProps<{ open: boolean; consigneeName: string }>()
const emit = defineEmits<{ close: []; add: [item: NewItem] }>()

const itemName = ref('')
const serialType = ref<SerialType>('common')
const quantity = ref('1')
const years = ref('1')
const months = ref('0')
const errors = ref<Record<string, string>>({})

watch(
  () => props.open,
  (open) => {
    if (!open) return
    itemName.value = ''
    serialType.value = 'common'
    quantity.value = '1'
    years.value = '1'
    months.value = '0'
    errors.value = {}
  },
)

const yearOptions = Array.from({ length: 11 }, (_, i) => ({ value: String(i), label: `${i}` }))
const monthOptions = Array.from({ length: 12 }, (_, i) => ({ value: String(i), label: `${i}` }))

function submit() {
  errors.value = {}
  const qty = Number(quantity.value)
  if (!itemName.value.trim()) errors.value.itemName = 'Enter the item name and configuration'
  if (!Number.isInteger(qty) || qty < 1 || qty > 500)
    errors.value.quantity = 'Enter a number from 1 to 500'
  if (Object.keys(errors.value).length) return
  emit('add', {
    itemName: itemName.value.trim(),
    serialType: serialType.value,
    quantity: qty,
    warrantyMonths: Number(years.value) * 12 + Number(months.value),
  })
}
</script>

<template>
  <UiModal :open="open" title="Add item" @close="emit('close')">
    <form id="add-item" class="flex flex-col gap-4" novalidate @submit.prevent="submit">
      <p class="text-sm text-gray-600 dark:text-gray-400">
        For <span class="font-medium text-gray-800 dark:text-white/90">{{ consigneeName }}</span>
      </p>
      <UiTextarea
        v-model="itemName"
        label="Item name and configuration"
        placeholder="e.g. Desktop computer, i5, 16GB RAM, 512GB SSD, 22 inch monitor"
        :rows="3"
        :error="errors.itemName"
        required
      />
      <fieldset>
        <legend class="mb-1.5 text-sm font-medium text-gray-700 dark:text-gray-400">
          Serial numbers
        </legend>
        <div class="grid gap-2 sm:grid-cols-2">
          <label
            v-for="t in SERIAL_TYPE_OPTIONS"
            :key="t.value"
            :class="[
              'flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 transition-colors',
              serialType === t.value
                ? 'border-blue-300 bg-blue-50 dark:border-blue-700 dark:bg-blue-900/20'
                : 'border-gray-200 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-white/5',
            ]"
          >
            <input
              v-model="serialType"
              type="radio"
              name="serial-type"
              :value="t.value"
              class="mt-0.5 accent-blue-600"
            />
            <span>
              <span class="block text-sm font-medium text-gray-800 dark:text-white/90">{{
                t.label
              }}</span>
              <span class="block text-xs text-gray-500 dark:text-gray-400">{{ t.hint }}</span>
            </span>
          </label>
        </div>
      </fieldset>
      <div class="grid gap-4 sm:grid-cols-3">
        <UiInput
          v-model="quantity"
          label="Number of units"
          type="number"
          :error="errors.quantity"
          required
        />
        <UiSelect v-model="years" label="Warranty (years)" :options="yearOptions" />
        <UiSelect v-model="months" label="Warranty (months)" :options="monthOptions" />
      </div>
      <p class="text-xs text-gray-500 dark:text-gray-400">
        One row is added per unit. The engineer fills in the serial numbers; rows left empty are not
        counted as installed assets.
      </p>
    </form>
    <template #footer>
      <UiButton variant="secondary" @click="emit('close')">Cancel</UiButton>
      <UiButton type="submit" form="add-item">Add item</UiButton>
    </template>
  </UiModal>
</template>
