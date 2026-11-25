<script setup lang="ts">
import { ArrowDown, ArrowUp, Plus, RotateCcw, Workflow } from 'lucide-vue-next'
import { onMounted, reactive, ref } from 'vue'
import type { CommentMode, RoleSummary, StageSummary } from '@tdm/shared'
import { STAGE_COLORS, STAGE_TYPE_LABELS, type StageColor } from '@tdm/shared/workflow'
import { ACTION_ICONS } from '@/components/ui/actions'
import DataTable from '@/components/ui/DataTable.vue'
import IconButton from '@/components/ui/IconButton.vue'
import ModalCallout from '@/components/ui/ModalCallout.vue'
import type { TableColumn } from '@/components/ui/table'
import UiAlert from '@/components/ui/UiAlert.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiCard from '@/components/ui/UiCard.vue'
import UiModal from '@/components/ui/UiModal.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import { api, errorMessage } from '@/services/api'
import { useWorkflowStore } from '@/stores/workflow'
import { stageDotClasses } from '@/utils/tenders'
import AddStageDialog from './AddStageDialog.vue'
import MenuRolesDialog from './MenuRolesDialog.vue'
import MoveRulesDialog from './MoveRulesDialog.vue'
import ResetWorkflowDialog from './ResetWorkflowDialog.vue'
import { COLOR_LABELS } from './stage-ui'

/**
 * The client's workflow: rename, recolour, reorder, show/hide stages, choose
 * when a comment is needed, and add or delete stages of their own.
 */
const workflow = useWorkflowStore()
const loadError = ref('')
/** Name being typed per stage, saved on blur or Enter. */
const drafts = reactive<Record<string, string>>({})
const rowErrors = reactive<Record<string, string>>({})
const saving = reactive<Record<string, boolean>>({})
const notice = ref('')
const error = ref('')
const adding = ref(false)
const deleting = ref<StageSummary | null>(null)
const deletingBusy = ref(false)
const moving = ref(false)
const editingMoves = ref<StageSummary | null>(null)
const editingMenu = ref<StageSummary | null>(null)
const resetting = ref(false)
const roles = ref<RoleSummary[]>([])

function onMenuSaved(stage: StageSummary) {
  workflow.replaceStage(stage)
  editingMenu.value = null
  notice.value = `Saved who sees “${stage.label}” in the menu.`
}

function onReset(stages: StageSummary[]) {
  workflow.stages = stages
  syncDrafts()
  resetting.value = false
  notice.value = 'The chosen settings are back to default.'
}

/** "Admin, Agent, Viewer" for role keys; null = everyone. */
function rolesOf(keys: string[] | null): string {
  if (keys === null) return 'Everyone'
  if (!keys.length) return 'Nobody'
  return roles.value
    .filter((r) => keys.includes(r.key))
    .map((r) => r.name)
    .join(', ')
}

function onMovesSaved(stage: StageSummary) {
  workflow.replaceStage(stage)
  editingMoves.value = null
  notice.value = `Saved the moves from “${stage.label}”.`
}

/** "In progress, Price review" for a list of stage keys; null = any stage. */
function namesOf(keys: string[] | null): string {
  if (keys === null) return 'Any stage'
  const names = keys
    .map((k) => workflow.stages.find((s) => s.key === k)?.label)
    .filter((n): n is string => !!n)
  return names.join(', ')
}

onMounted(async () => {
  try {
    await workflow.reloadStages()
    await workflow.refreshCounts()
    syncDrafts()
    roles.value = (await api.get<RoleSummary[]>('/roles')).data
  } catch (err) {
    loadError.value = errorMessage(err)
  }
})

function syncDrafts() {
  for (const s of workflow.stages) drafts[s.id] = s.label
}

async function save(
  stage: StageSummary,
  changes: {
    label?: string | null
    commentMode?: CommentMode
    isVisible?: boolean
    color?: StageColor
  },
) {
  rowErrors[stage.id] = ''
  notice.value = ''
  saving[stage.id] = true
  try {
    const { data } = await api.patch<StageSummary>(`/workflow/stages/${stage.id}`, changes)
    workflow.replaceStage(data)
    drafts[stage.id] = data.label
    notice.value = `Saved “${data.label}”.`
  } catch (err) {
    rowErrors[stage.id] = errorMessage(err)
    drafts[stage.id] = stage.label
  } finally {
    saving[stage.id] = false
  }
}

function saveLabel(stage: StageSummary) {
  const label = (drafts[stage.id] ?? '').trim()
  if (!label) {
    drafts[stage.id] = stage.label
    return
  }
  if (label !== stage.label) void save(stage, { label })
}

/** Moves a stage one place up or down. */
async function shift(index: number, by: -1 | 1) {
  const ids = workflow.stages.map((s) => s.id)
  const to = index + by
  if (to < 0 || to >= ids.length) return
  ;[ids[index], ids[to]] = [ids[to]!, ids[index]!]
  error.value = ''
  moving.value = true
  try {
    workflow.stages = (await api.put<StageSummary[]>('/workflow/stages/order', { ids })).data
  } catch (err) {
    error.value = errorMessage(err)
  } finally {
    moving.value = false
  }
}

async function onAdded(stage: StageSummary) {
  adding.value = false
  await workflow.reloadStages()
  syncDrafts()
  notice.value = `Stage “${stage.label}” added.`
}

async function confirmDelete() {
  const s = deleting.value
  if (!s) return
  error.value = ''
  deletingBusy.value = true
  try {
    await api.delete(`/workflow/stages/${s.id}`)
    await workflow.reloadStages()
    notice.value = `Stage “${s.label}” deleted.`
  } catch (err) {
    error.value = errorMessage(err)
  } finally {
    deletingBusy.value = false
    deleting.value = null
  }
}

const commentOptions: { value: CommentMode; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'optional', label: 'Optional' },
  { value: 'required', label: 'Required' },
]
const colorOptions: { value: StageColor; label: string; dot: string }[] = STAGE_COLORS.map((c) => ({
  value: c,
  label: COLOR_LABELS[c],
  dot: stageDotClasses[c],
}))
const columns: TableColumn[] = [
  { key: 'order', label: '#', class: 'w-10' },
  { key: 'label', label: 'Stage Name', sticky: true, class: 'min-w-64' },
  { key: 'type', label: 'Kind' },
  { key: 'color', label: 'Colour' },
  { key: 'moves', label: 'Can Move To' },
  { key: 'menu', label: 'In Menu For' },
  { key: 'commentMode', label: 'Comment' },
  { key: 'count', label: 'Tenders', align: 'right' },
  { key: 'isVisible', label: 'Shown' },
]
const small = 'form-field h-9! py-0! text-sm!'
const indexOf = (s: StageSummary) => workflow.stages.findIndex((x) => x.id === s.id)
</script>

<template>
  <div>
    <UiAlert v-if="loadError" class="mb-4">{{ loadError }}</UiAlert>
    <UiAlert v-if="error" class="mb-4">{{ error }}</UiAlert>
    <UiAlert v-if="notice" variant="success" class="mb-4">{{ notice }}</UiAlert>

    <UiCard
      :level="1"
      title="Workflow Stages"
      subtitle="Rename, recolour and reorder stages, choose when a comment is needed, hide the ones you do not use, or add your own."
      :icon="Workflow"
    >
      <template #header>
        <UiButton size="xs" variant="secondary" @click="resetting = true">
          <RotateCcw class="size-4" aria-hidden="true" /> Reset to Default
        </UiButton>
        <UiButton size="xs" @click="adding = true">
          <Plus class="size-4" aria-hidden="true" /> Add Stage
        </UiButton>
      </template>

      <DataTable :columns="columns" :rows="workflow.stages" loading-text="Loading stages...">
        <template #cell-order="{ row }">
          <span class="text-xs text-gray-500">{{ indexOf(row) + 1 }}</span>
        </template>
        <template #cell-label="{ row }">
          <div :class="['flex items-center gap-2', !row.isVisible && 'opacity-60']">
            <span
              :class="['size-2.5 shrink-0 rounded-full', stageDotClasses[row.color]]"
              aria-hidden="true"
            />
            <input
              v-model="drafts[row.id]"
              :aria-label="`Name of stage ${row.defaultLabel}`"
              maxlength="30"
              :class="[small, 'min-w-44 bg-white! py-1! dark:bg-gray-900!']"
              @blur="saveLabel(row)"
              @keydown.enter.prevent="($event.target as HTMLInputElement).blur()"
            />
            <IconButton
              v-if="!row.isCustom && row.label !== row.defaultLabel"
              :icon="RotateCcw"
              :label="`Reset name to “${row.defaultLabel}”`"
              @click="save(row, { label: null })"
            />
          </div>
          <p
            v-if="!row.isCustom && row.label !== row.defaultLabel"
            class="mt-1 ml-4.5 text-xs text-gray-400"
          >
            Default: {{ row.defaultLabel }}
          </p>
          <p v-if="rowErrors[row.id]" class="mt-1 ml-4.5 text-xs text-error-500" role="alert">
            {{ rowErrors[row.id] }}
          </p>
        </template>
        <template #cell-type="{ row }">
          <span class="text-sm whitespace-nowrap">{{ STAGE_TYPE_LABELS[row.type] }}</span>
          <span v-if="row.isCustom" class="ml-1 text-xs text-blue-600 dark:text-blue-400">
            (yours)
          </span>
          <span v-if="row.systemRole" class="block text-xs text-gray-400">
            {{
              row.systemRole === 'intake'
                ? 'Imported tenders arrive here'
                : 'Missed deadlines go here'
            }}
          </span>
        </template>
        <template #cell-color="{ row }">
          <UiSelect
            :model-value="row.color"
            :options="colorOptions"
            :aria-label="`Colour of ${row.label}`"
            :disabled="saving[row.id]"
            size="sm"
            class="w-32"
            @update:model-value="(c) => c && c !== row.color && save(row, { color: c })"
          />
        </template>
        <template #cell-moves="{ row }">
          <button
            type="button"
            class="block max-w-72 text-left text-xs leading-5 hover:text-blue-600 dark:hover:text-blue-400"
            :aria-label="`Edit moves from ${row.label}`"
            @click="editingMoves = row"
          >
            <span v-if="namesOf(row.agentNext)" class="block">
              <span class="font-medium text-gray-700 dark:text-gray-300">Agent:</span>
              {{ namesOf(row.agentNext) }}
            </span>
            <span v-if="namesOf(row.managerNext)" class="block">
              <span class="font-medium text-gray-700 dark:text-gray-300">Admin:</span>
              {{ namesOf(row.managerNext) }}
            </span>
            <span v-if="!namesOf(row.agentNext) && !namesOf(row.managerNext)" class="text-gray-400">
              Nowhere (final stage)
            </span>
          </button>
        </template>
        <template #cell-menu="{ row }">
          <button
            type="button"
            class="block max-w-44 text-left text-xs leading-5 text-gray-700 hover:text-blue-600 dark:text-gray-300 dark:hover:text-blue-400"
            :aria-label="`Edit who sees ${row.label} in the menu`"
            @click="editingMenu = row"
          >
            {{ rolesOf(row.menuRoles) }}
          </button>
        </template>
        <template #cell-commentMode="{ row }">
          <UiSelect
            :model-value="row.commentMode"
            :options="commentOptions"
            :aria-label="`Comment setting for ${row.label}`"
            :disabled="saving[row.id]"
            size="sm"
            class="w-32"
            @update:model-value="(m) => m && m !== row.commentMode && save(row, { commentMode: m })"
          />
        </template>
        <template #cell-count="{ row }">
          <span class="text-sm tabular-nums">{{ workflow.counts[row.id] ?? 0 }}</span>
        </template>
        <template #cell-isVisible="{ row }">
          <button
            type="button"
            role="switch"
            :aria-checked="row.isVisible"
            :aria-label="`Show ${row.label}`"
            :disabled="saving[row.id]"
            :class="[
              'relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50',
              row.isVisible ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-700',
            ]"
            @click="save(row, { isVisible: !row.isVisible })"
          >
            <span
              :class="[
                'absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow-theme-sm transition-transform',
                row.isVisible && 'translate-x-5',
              ]"
            />
          </button>
        </template>
        <template #actions="{ row }">
          <IconButton
            :icon="ACTION_ICONS.edit"
            :label="`Edit moves from ${row.label}`"
            @click="editingMoves = row"
          />
          <IconButton
            :icon="ArrowUp"
            :label="`Move ${row.label} up`"
            :disabled="moving || indexOf(row) === 0"
            @click="shift(indexOf(row), -1)"
          />
          <IconButton
            :icon="ArrowDown"
            :label="`Move ${row.label} down`"
            :disabled="moving || indexOf(row) === workflow.stages.length - 1"
            @click="shift(indexOf(row), 1)"
          />
          <IconButton
            v-if="row.isCustom"
            :icon="ACTION_ICONS.delete"
            :label="`Delete ${row.label}`"
            variant="danger"
            @click="deleting = row"
          />
        </template>
      </DataTable>
    </UiCard>

    <p class="mt-4 text-xs text-gray-500 dark:text-gray-400">
      A stage can be hidden only when no tenders are in it. Default stages can be hidden but not
      deleted; your own stages can be deleted until a tender has used them. Reports and deadline
      rules use each stage's kind, so renaming or reordering never breaks them. “Can move to” lists
      the next steps the Agent working on a tender may choose, and the extra ones only admins may
      choose; “In menu for” is who sees the stage in their sidebar. Click either to change it, or
      use Reset to Default to put things back.
    </p>

    <MenuRolesDialog
      :open="!!editingMenu"
      :stage="editingMenu"
      :roles="roles"
      @close="editingMenu = null"
      @saved="onMenuSaved"
    />

    <ResetWorkflowDialog :open="resetting" @close="resetting = false" @done="onReset" />

    <MoveRulesDialog
      :open="!!editingMoves"
      :stage="editingMoves"
      :stages="workflow.stages"
      @close="editingMoves = null"
      @saved="onMovesSaved"
    />

    <AddStageDialog
      :open="adding"
      :stages="workflow.stages"
      @close="adding = false"
      @added="onAdded"
    />

    <UiModal
      :open="!!deleting"
      :title="`Delete Stage: ${deleting?.label ?? ''}`"
      :busy="deletingBusy"
      @close="deleting = null"
    >
      <ModalCallout tone="warning" lead="Warning: ">
        “{{ deleting?.label }}” will be removed from your workflow. This only works while no tender
        has ever been in it; otherwise hide it instead.
      </ModalCallout>
      <template #footer>
        <UiButton variant="secondary" :disabled="deletingBusy" @click="deleting = null">
          Cancel
        </UiButton>
        <UiButton variant="danger" :loading="deletingBusy" @click="confirmDelete">
          Delete Stage
        </UiButton>
      </template>
    </UiModal>
  </div>
</template>
