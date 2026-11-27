import type { Organization } from '../../db/schema'

/** The support-page settings kept in organizations.settings. */
export function supportSettingsOf(org: Pick<Organization, 'settings'>): {
  enabled: boolean
  emails: string[]
} {
  const s = org.settings ?? {}
  const emails = Array.isArray(s.supportEmails)
    ? s.supportEmails.filter((e): e is string => typeof e === 'string')
    : []
  return { enabled: s.supportPage === true, emails }
}
