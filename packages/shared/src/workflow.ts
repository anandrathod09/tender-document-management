/**
 * Every stage belongs to one of these fixed types. The system's behaviour
 * (reports, deadline handling, win rate) depends only on the type, so a
 * client can rename stages without breaking anything.
 */
export const STAGE_TYPES = [
  'open',
  'preparing',
  'review',
  'submitted',
  'won',
  'lost',
  'dropped',
  'execution',
  'closed',
] as const
export type StageType = (typeof STAGE_TYPES)[number]

export const STAGE_TYPE_LABELS: Record<StageType, string> = {
  open: 'Open',
  preparing: 'Preparing',
  review: 'Review',
  submitted: 'Submitted',
  won: 'Won',
  lost: 'Lost',
  dropped: 'Dropped',
  execution: 'Execution',
  closed: 'Closed',
}

/** Stage types whose tenders move to the missed-deadline stage when the deadline passes. */
export const DEADLINE_BOUND_TYPES: readonly StageType[] = ['preparing', 'review']

/** Whether the comment box is shown when a tender moves into the stage. */
export const COMMENT_MODES = ['off', 'optional', 'required'] as const
export type CommentMode = (typeof COMMENT_MODES)[number]

/**
 * Stages the system itself uses:
 *  - intake: where imported tenders land
 *  - missed_deadline: where tenders being prepared go when their deadline passes
 */
export const STAGE_SYSTEM_ROLES = ['intake', 'missed_deadline'] as const
export type StageSystemRole = (typeof STAGE_SYSTEM_ROLES)[number]

export const STAGE_COLORS = [
  'gray',
  'blue',
  'indigo',
  'amber',
  'teal',
  'green',
  'red',
  'purple',
] as const
export type StageColor = (typeof STAGE_COLORS)[number]

/**
 * Where a tender in a stage may be moved, as stage keys. null means any stage.
 *  - agentNext: the person working on the tender (an Agent)
 *  - managerNext: extra moves for admins (users who can assign tenders), who
 *    can also make every agent move
 * The defaults are the rules of the original TMS; each client can change them.
 */
export interface StageMoveRules {
  agentNext: string[] | null
  managerNext: string[] | null
}

export interface DefaultStage extends StageMoveRules {
  key: string
  label: string
  type: StageType
  color: StageColor
  commentMode: CommentMode
  systemRole?: StageSystemRole
}

/** Copied into every new client; matches the stages of the original TMS. */
export const DEFAULT_STAGES: DefaultStage[] = [
  {
    key: 'new',
    label: 'New',
    type: 'open',
    color: 'gray',
    commentMode: 'optional',
    systemRole: 'intake',
    agentNext: [],
    managerNext: ['watchlist', 'rejected'],
  },
  {
    key: 'watchlist',
    label: 'Watchlist',
    type: 'open',
    color: 'indigo',
    commentMode: 'optional',
    agentNext: [],
    managerNext: ['new', 'rejected'],
  },
  {
    key: 'assigned',
    label: 'Assigned',
    type: 'preparing',
    color: 'blue',
    commentMode: 'optional',
    agentNext: ['in-progress'],
    managerNext: [],
  },
  {
    key: 'in-progress',
    label: 'In progress',
    type: 'preparing',
    color: 'blue',
    commentMode: 'optional',
    agentNext: ['price-review', 'criteria-review'],
    managerNext: [],
  },
  {
    key: 'price-review',
    label: 'Price review',
    type: 'review',
    color: 'amber',
    commentMode: 'optional',
    agentNext: [],
    managerNext: ['ready-to-bid', 'not-fit'],
  },
  {
    key: 'criteria-review',
    label: 'Criteria review',
    type: 'review',
    color: 'amber',
    commentMode: 'optional',
    agentNext: [],
    managerNext: ['ready-to-bid', 'not-fit'],
  },
  {
    key: 'ready-to-bid',
    label: 'Ready to bid',
    type: 'preparing',
    color: 'teal',
    commentMode: 'optional',
    agentNext: ['submitted'],
    managerNext: [],
  },
  {
    key: 'submitted',
    label: 'Submitted',
    type: 'submitted',
    color: 'purple',
    commentMode: 'optional',
    agentNext: ['under-query', 'won', 'lost'],
    managerNext: [],
  },
  {
    key: 'under-query',
    label: 'Under query',
    type: 'submitted',
    color: 'purple',
    commentMode: 'optional',
    agentNext: ['won', 'lost'],
    managerNext: [],
  },
  {
    key: 'won',
    label: 'Won',
    type: 'won',
    color: 'green',
    commentMode: 'optional',
    agentNext: [],
    managerNext: ['assigned-to-engineer'],
  },
  {
    key: 'lost',
    label: 'Lost',
    type: 'lost',
    color: 'red',
    commentMode: 'required',
    agentNext: [],
    managerNext: [],
  },
  {
    key: 'assigned-to-engineer',
    label: 'Assigned to engineer',
    type: 'execution',
    color: 'teal',
    commentMode: 'optional',
    agentNext: [],
    managerNext: ['completed'],
  },
  {
    key: 'completed',
    label: 'Completed',
    type: 'closed',
    color: 'green',
    commentMode: 'optional',
    agentNext: [],
    managerNext: [],
  },
  {
    key: 'not-fit',
    label: 'Not fit',
    type: 'dropped',
    color: 'gray',
    commentMode: 'required',
    agentNext: [],
    managerNext: [],
  },
  {
    key: 'not-bidded',
    label: 'Not bidded',
    type: 'dropped',
    color: 'gray',
    commentMode: 'required',
    systemRole: 'missed_deadline',
    agentNext: [],
    managerNext: null,
  },
  {
    key: 'rejected',
    label: 'Rejected',
    type: 'dropped',
    color: 'red',
    commentMode: 'required',
    agentNext: [],
    managerNext: [],
  },
]

/** Longest stage name, so it fits in the sidebar. */
export const STAGE_LABEL_MAX = 30

/** The stage fields the move rules need (both the API and the web app have them). */
export interface MovableStage extends StageMoveRules {
  id: string
  key: string
  type: StageType
  isVisible: boolean
  systemRole: StageSystemRole | null
}

/**
 * Whether the deadline rule of the original TMS applies: a tender still being
 * prepared or reviewed after its deadline day can only go to the missed-
 * deadline stage ("Not bidded"), unless an admin has already reopened it.
 * Dates are YYYY-MM-DD in the client's time zone.
 */
export function deadlineLocked(
  stage: Pick<MovableStage, 'type'>,
  tender: { deadline: string; reopenedAfterDeadline: boolean },
  today: string,
): boolean {
  return (
    DEADLINE_BOUND_TYPES.includes(stage.type) &&
    tender.deadline < today &&
    !tender.reopenedAfterDeadline
  )
}

/** The stages a tender in `from` may be moved to by this user, in workflow order. */
export function allowedNextStages<S extends MovableStage>(
  stages: S[],
  from: S,
  opts: { manager: boolean; locked: boolean },
): S[] {
  const others = stages.filter((s) => s.isVisible && s.id !== from.id)
  if (opts.locked) return others.filter((s) => s.systemRole === 'missed_deadline')
  const lists = opts.manager ? [from.agentNext, from.managerNext] : [from.agentNext]
  if (lists.some((l) => l === null)) return others
  const keys = new Set(lists.flatMap((l) => l ?? []))
  return others.filter((s) => keys.has(s.key))
}
