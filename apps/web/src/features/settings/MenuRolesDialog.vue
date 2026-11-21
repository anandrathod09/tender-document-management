<script setup lang="ts">
import { RotateCcw } from 'lucide-vue-next'
import { computed, ref, watch } from 'vue'
import type { RoleSummary, StageSummary } from '@tdm/shared'
import { stageDefaults } from '@tdm/shared/workflow'
import ModalNote from '@/components/ui/ModalNote.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiModal from '@/components/ui/UiModal.vue'
import { api, errorMessage } from '@/services/api'

/** Who sees a stage in their sidebar menu. Only tidies the menu: "All tenders" still lists everything they may see. */
const props = defineProps<{ open: boolean; stage: StageSummary | null; roles: RoleSummary[] }>()
const emit = defineEmits<{ close: []; saved: [stage: StageSummary] }>()

const everyone = ref(true)
const keys = ref<string[]>([])
const error = ref('')
const saving = ref(false)

function fill(value: string[] | null) {
  everyone.value = value === null
  keys.value = value ?? []
}

watch(
  () => props.open,
  (open) => {
    if (!open || !props.stage) return
    fill(props.stage.menuRoles)
    error.value = ''
  },
)

const defaults = computed(() => (props.stage ? stageDefaults(props.stage).menuRoles : null))
const isDefault = computed(() => {
  const d = defaults.value
  if (d === null) return everyone.value
  return !everyone.value && d.length === keys.value.length && d.every((k) => keys.value.includes(k))
})

function toggle(key: string) {
  keys.value = keys.value.includes(key) ? keys.value.filter((k) => k !== key) : [...keys.value, key]
}

async function save() {
  if (!props.stage) return
  error.value = ''
  saving.value = true
  try {
    const { data } = await api.patch<StageSummary>(`/workflow/stages/${props.stage.id}`, {
      menuRoles: everyone.value ? null : keys.value,
    })
    emit('saved', data)
  } catch (err) {
    error.value = errorMessage(err)
  } finally {
    saving.value = false
  }
}

const chip = (on: boolean) => [
  'flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm select-none',
  on
    ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300'
    : 'border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5',
]
</script>

<template>
  <UiModal
    :open="open"
    :title="`Menu: ${stage?.label ?? ''}`"
    :busy="saving"
    @close="emit('close')"
  >
    <div class="space-y-5">
      <UiAlert v-if="error">{{ error }}</UiAlert>

      <fieldset>
        <legend class="mb-1 text-sm font-medium text-gray-700 dark:text-gray-300">
          Show this stage in the sidebar menu for
        </legend>
        <p class="mb-2 text-xs text-gray-500 dark:text-gray-400">
          Untick the roles that never work with tenders in this stage, so their menu stays short.
        </p>
        <div class="flex flex-wrap gap-2">
          <label :class="chip(everyone)">
            <input v-model="everyone" type="checkbox" class="sr-only" />
            Everyone
          </label>
          <template v-if="!everyone">
            <label v-for="r in roles" :key="r.id" :class="chip(keys.includes(r.key))">
              <input
                type="checkbox"
                class="sr-only"
                :checked="keys.includes(r.key)"
                @change="toggle(r.key)"
              />
              {{ r.name }}
            </label>
          </template>
        </div>
      </fieldset>

      <ModalNote>
        This only tidies the menu. Everyone still finds every tender they are allowed to see under
        “All tenders”, and the stage stays in the status lists.
      </ModalNote>
    </div>
    <template #footer>
      <UiButton
        variant="ghost"
        class="mr-auto"
        :disabled="saving || isDefault"
        @click="fill(defaults)"
      >
        <RotateCcw class="size-4" aria-hidden="true" /> Use Default
      </UiButton>
      <UiButton variant="secondary" :disabled="saving" @click="emit('close')">Cancel</UiButton>
      <UiButton :loading="saving" @click="save">Save Menu</UiButton>
    </template>
  </UiModal>
</template>
