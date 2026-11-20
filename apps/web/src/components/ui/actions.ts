import {
  ArrowRightLeft,
  Ban,
  Bookmark,
  BookmarkX,
  Download,
  ExternalLink,
  Eye,
  KeyRound,
  LifeBuoy,
  Mail,
  Pencil,
  Power,
  Trash2,
  UserPlus,
} from 'lucide-vue-next'

/**
 * One icon per action, used by every table and button in the app, so the
 * same picture always means the same thing.
 */
export const ACTION_ICONS = {
  view: Eye,
  open: ExternalLink,
  assign: UserPlus,
  watchlist: Bookmark,
  unwatch: BookmarkX,
  reject: Ban,
  move: ArrowRightLeft,
  edit: Pencil,
  delete: Trash2,
  download: Download,
  resend: Mail,
  reset: KeyRound,
  toggle: Power,
  ticket: LifeBuoy,
} as const
