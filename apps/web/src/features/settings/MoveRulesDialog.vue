<script setup lang="ts">
import { RotateCcw } from 'lucide-vue-next'
import { computed, ref, watch } from 'vue'
import type { StageSummary } from '@tdm/shared'
import { stageDefaults } from '@tdm/shared/workflow'
import ModalNote from '@/components/ui/ModalNote.vue'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiModal from '@/components/ui/UiModal.vue'
import { api, errorMessage } from '@/services/api'
import { stageDotClasses } from '@/utils/tenders'

/**
 * Where a tender in this stage may be moved: the Agent's next steps, and the
 * extra moves only admins make (approvals, closing). Admins can always make
 * the Agent's moves too.
 */
const props = defineProps<{ open: boolean; stage: StageSummary | null; stages: StageSummary[] }>()
const emit = defineEmits<{ close: []; saved: [stage: StageSummary] }>()

interface Side {
  any: boolean
  keys: string[]
}
const agent = ref<Side>({ any: false, keys: [] })
const admin = ref<Side>({ any: false, keys: [] })
const error = ref('')
const saving = ref(false)

const toSide = (v: string[] | null): Side => ({ any: v === null, keys: v ?? [] })
const fromSide = (s: Side) => (s.any ? null : s.keys)

watch(
  () => props.open,
  (open) => {
    if (!open || !props.stage) return
    agent.value = toSide(props.stage.agentNext)
    admin.value = toSide(props.stage.managerNext)
    error.value = ''
  },
)

const others = computed(() => props.stages.filter((s) => s.id !== props.stage?.id))

function useDefaults() {
  if (!props.stage) return
  const d = stageDefaults(props.stage)
  agent.value = toSide(d.agentNext)
  admin.value = toSide(d.managerNext)
}

function toggle(side: Side, key: string) {
  side.keys = side.keys.includes(key) ? side.keys.filter((k) => k !== key) : [...side.keys, key]
}

async function save() {
  if (!props.stage) return
  error.value = ''
  saving.value = true
  try {
    const { data } = await api.patch<StageSummary>(`/workflow/stages/${props.stage.id}`, {
      agentNext: fromSide(agent.value),
      managerNext: fromSide(admin.value),
    })
    emit('saved', data)
  } catch (err) {
    error.value = errorMessage(err)
  } finally {
    saving.value = false
  }
}

const chip = (on: boolean) => [
  'flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm select-none',
  on
    ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300'
    : 'border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5',
]
const sides = computed(() => [
  {
    id: 'agent',
    side: agent.value,
    title: 'The Agent working on it can move it to',
    hint: 'Leave all unticked when the next step is decided by an admin.',
  },
  {
    id: 'admin',
    side: admin.value,
    title: 'Admins can also move it to',
    hint: 'For approvals and closing steps. Admins can always make the Agent’s moves too.',
  },
])
</script>

<template>
  <UiModal
    :open="open"
    :title="`Moves From: ${stage?.label ?? ''}`"
    width="lg"
    :busy="saving"
    @close="emit('close')"
  >
    <div class="space-y-5">
      <UiAlert v-if="error">{{ error }}</UiAlert>

      <fieldset v-for="s in sides" :key="s.id">
        <legend class="mb-1 text-sm font-medium text-gray-700 dark:text-gray-300">
          {{ s.title }}
        </legend>
        <p class="mb-2 text-xs text-gray-500 dark:text-gray-400">{{ s.hint }}</p>
        <div class="flex flex-wrap gap-2">
          <label :class="chip(s.side.any)">
            <input v-model="s.side.any" type="checkbox" class="sr-only" />
            Any stage
          </label>
          <template v-if="!s.side.any">
            <label
              v-for="o in others"
              :key="o.id"
              :class="[chip(s.side.keys.includes(o.key)), !o.isVisible && 'opacity-60']"
            >
              <input
                type="checkbox"
                class="sr-only"
                :checked="s.side.keys.includes(o.key)"
                @change="toggle(s.side, o.key)"
              />
              <span :class="['size-3 rounded-full', stageDotClasses[o.color]]" aria-hidden="true" />
              {{ o.label }}<span v-if="!o.isVisible" class="text-xs">(hidden)</span>
            </label>
          </template>
        </div>
      </fieldset>

      <ModalNote>
        Assigning, and the Excel upload, follow their own rules. When a tender still being prepared
        passes its deadline, it can only go to “Not bidded”, until an admin reopens it from there.
      </ModalNote>
    </div>
    <template #footer>
      <UiButton variant="ghost" class="mr-auto" :disabled="saving" @click="useDefaults">
        <RotateCcw class="size-4" aria-hidden="true" /> Use Default
      </UiButton>
      <UiButton variant="secondary" :disabled="saving" @click="emit('close')">Cancel</UiButton>
      <UiButton :loading="saving" @click="save">Save Moves</UiButton>
    </template>
  </UiModal>
</template>
