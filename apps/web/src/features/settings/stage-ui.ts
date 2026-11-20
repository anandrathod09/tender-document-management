import type { StageColor, StageType } from '@tdm/shared/workflow'

export const COLOR_LABELS: Record<StageColor, string> = {
  gray: 'Grey',
  blue: 'Blue',
  indigo: 'Indigo',
  amber: 'Orange',
  teal: 'Teal',
  green: 'Green',
  red: 'Red',
  purple: 'Purple',
}

/** What each kind of stage means to the system, shown when adding a stage. */
export const TYPE_HINTS: Record<StageType, string> = {
  open: 'Not started yet, like New and Watchlist.',
  preparing: 'Being worked on. Moves to the missed-deadline stage if the deadline passes.',
  review: 'Checked before bidding (price, criteria). Deadline rules apply as for preparing.',
  submitted: 'Bid sent, waiting for the result.',
  won: 'Won. Asks for the award amount and opens the installation report.',
  lost: 'Lost. Counts in the win rate.',
  dropped: 'Not pursued (not fit, rejected, not bidded).',
  execution: 'Work after winning, such as installation.',
  closed: 'Finished.',
}
