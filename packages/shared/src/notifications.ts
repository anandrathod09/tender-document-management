import { z } from 'zod'

/**
 * Events that also send an email (besides the in-app bell). Each person can
 * switch each one off for themselves; all are on by default. Nobody gets an
 * email about their own action.
 */
export const EMAIL_EVENTS = ['tender_assigned', 'engineer_assigned', 'ticket_assigned'] as const
export type EmailEvent = (typeof EMAIL_EVENTS)[number]

export const EMAIL_EVENT_INFO: Record<EmailEvent, { title: string; description: string }> = {
  tender_assigned: {
    title: 'A tender is assigned to me',
    description:
      'Reference number, title, buyer and deadline. Several tenders assigned at once come in one email.',
  },
  engineer_assigned: {
    title: 'I am made the engineer on an installation',
    description: 'The tender, the customer and the consignee (delivery location) you are put on.',
  },
  ticket_assigned: {
    title: 'A service ticket is assigned to me',
    description: 'The ticket number, the problem, the priority and the customer.',
  },
}

/** true = send the email. */
export type EmailPreferences = Record<EmailEvent, boolean>

export const emailPreferencesSchema = z
  .object(Object.fromEntries(EMAIL_EVENTS.map((e) => [e, z.boolean()])) as Record<EmailEvent, z.ZodBoolean>)
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update')
export type EmailPreferencesInput = z.infer<typeof emailPreferencesSchema>

/** Fills in the default (on) for events the person never changed. */
export function emailPreferencesFrom(stored: Partial<Record<string, boolean>> | null | undefined): EmailPreferences {
  return Object.fromEntries(
    EMAIL_EVENTS.map((e) => [e, stored?.[e] !== false]),
  ) as EmailPreferences
}
