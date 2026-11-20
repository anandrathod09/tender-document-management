import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { StageCount, StageSummary } from '@tdm/shared'
import { api } from '@/services/api'

/** The client's workflow stages and how many tenders sit in each. */
export const useWorkflowStore = defineStore('workflow', () => {
  const stages = ref<StageSummary[]>([])
  const counts = ref<Record<string, number>>({})
  let loading: Promise<void> | null = null

  const visibleStages = computed(() => stages.value.filter((s) => s.isVisible))
  const byId = computed(() => new Map(stages.value.map((s) => [s.id, s])))
  const total = computed(() => Object.values(counts.value).reduce((a, b) => a + b, 0))

  async function refreshCounts() {
    const rows = (await api.get<StageCount[]>('/tenders/counts')).data
    counts.value = Object.fromEntries(rows.map((r) => [r.stageId, r.count]))
  }

  async function reloadStages() {
    stages.value = (await api.get<StageSummary[]>('/workflow/stages')).data
  }

  /** Loads stages and counts once per session; later calls reuse the result. */
  function load(): Promise<void> {
    loading ??= Promise.all([reloadStages(), refreshCounts()])
      .then(() => undefined)
      .catch((err) => {
        loading = null
        throw err
      })
    return loading
  }

  function replaceStage(stage: StageSummary) {
    stages.value = stages.value.map((s) => (s.id === stage.id ? stage : s))
  }

  function reset() {
    stages.value = []
    counts.value = {}
    loading = null
  }

  return {
    stages,
    counts,
    visibleStages,
    byId,
    total,
    load,
    reloadStages,
    refreshCounts,
    replaceStage,
    reset,
  }
})
