import { computed } from 'vue'
import type { StageSummary } from '@tdm/shared'
import { PERMISSIONS } from '@tdm/shared/permissions'
import { allowedNextStages, deadlineLocked } from '@tdm/shared/workflow'
import { useAuthStore } from '@/stores/auth'
import { useWorkflowStore } from '@/stores/workflow'
import { localToday } from '@/utils/tenders'

/** What a tender needs for the move rules. */
export interface MoveSubject {
  stage: { id: string }
  deadline: string
  reopenedAfterDeadline: boolean
}

/**
 * The client's move rules, as the API applies them: which stages this user
 * may move a tender to (an Agent's next steps, plus the admin's), and the
 * deadline rule that leaves only "Not bidded" once the deadline has passed.
 */
export function useMoveRules() {
  const workflow = useWorkflowStore()
  const auth = useAuthStore()
  const manager = computed(() => auth.can(PERMISSIONS.TENDER_ASSIGN))

  function locked(t: MoveSubject): boolean {
    const from = workflow.byId.get(t.stage.id)
    return !!from && deadlineLocked(from, t, localToday())
  }

  function nextFor(t: MoveSubject): StageSummary[] {
    const from = workflow.byId.get(t.stage.id)
    if (!from) return []
    return allowedNextStages(workflow.stages, from, { manager: manager.value, locked: locked(t) })
  }

  /** Stages every one of the tenders may move to (for bulk moves). */
  function commonNext(list: MoveSubject[]): StageSummary[] {
    if (!list.length) return []
    const [first, ...rest] = list.map((t) => new Set(nextFor(t).map((s) => s.id)))
    return workflow.stages.filter((s) => first!.has(s.id) && rest.every((r) => r.has(s.id)))
  }

  return { manager, locked, nextFor, commonNext }
}
