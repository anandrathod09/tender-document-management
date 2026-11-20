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

export interface DefaultStage {
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
  },
  { key: 'watchlist', label: 'Watchlist', type: 'open', color: 'indigo', commentMode: 'optional' },
  { key: 'assigned', label: 'Assigned', type: 'preparing', color: 'blue', commentMode: 'optional' },
  {
    key: 'in-progress',
    label: 'In progress',
    type: 'preparing',
    color: 'blue',
    commentMode: 'optional',
  },
  {
    key: 'price-review',
    label: 'Price review',
    type: 'review',
    color: 'amber',
    commentMode: 'optional',
  },
  {
    key: 'criteria-review',
    label: 'Criteria review',
    type: 'review',
    color: 'amber',
    commentMode: 'optional',
  },
  {
    key: 'ready-to-bid',
    label: 'Ready to bid',
    type: 'preparing',
    color: 'teal',
    commentMode: 'optional',
  },
  {
    key: 'submitted',
    label: 'Submitted',
    type: 'submitted',
    color: 'purple',
    commentMode: 'optional',
  },
  {
    key: 'under-query',
    label: 'Under query',
    type: 'submitted',
    color: 'purple',
    commentMode: 'optional',
  },
  { key: 'won', label: 'Won', type: 'won', color: 'green', commentMode: 'optional' },
  { key: 'lost', label: 'Lost', type: 'lost', color: 'red', commentMode: 'required' },
  {
    key: 'assigned-to-engineer',
    label: 'Assigned to engineer',
    type: 'execution',
    color: 'teal',
    commentMode: 'optional',
  },
  { key: 'completed', label: 'Completed', type: 'closed', color: 'green', commentMode: 'optional' },
  { key: 'not-fit', label: 'Not fit', type: 'dropped', color: 'gray', commentMode: 'required' },
  {
    key: 'not-bidded',
    label: 'Not bidded',
    type: 'dropped',
    color: 'gray',
    commentMode: 'required',
    systemRole: 'missed_deadline',
  },
  { key: 'rejected', label: 'Rejected', type: 'dropped', color: 'red', commentMode: 'required' },
]

/** Longest stage name, so it fits in the sidebar. */
export const STAGE_LABEL_MAX = 30
