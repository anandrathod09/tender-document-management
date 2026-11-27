import { eq } from 'drizzle-orm'
import { Router } from 'express'
import {
  emailPreferencesFrom,
  emailPreferencesSchema,
  type EmailPreferences,
} from '@tdm/shared'
import { db } from '../../db/client'
import { orgWhere } from '../../db/scope'
import { users } from '../../db/schema'
import { parse } from '../../lib/validate'
import { authenticateTenant, tenantAuth } from '../../middleware/auth'

/** The signed-in person's own settings (every role has these). */
export const accountRouter = Router()
accountRouter.use(authenticateTenant)

/** Which event emails the person gets (all on until they switch one off). */
accountRouter.get('/email-preferences', (req, res) => {
  const prefs: EmailPreferences = emailPreferencesFrom(tenantAuth(req).user.emailPrefs)
  res.json(prefs)
})

accountRouter.patch('/email-preferences', async (req, res) => {
  const auth = tenantAuth(req)
  const input = parse(emailPreferencesSchema, req.body)
  const where = orgWhere(users, auth.org.id, eq(users.id, auth.user.id))
  const prefs = await db.transaction(async (tx) => {
    const [current] = await tx.select({ prefs: users.emailPrefs }).from(users).where(where).for('update')
    const next = { ...current?.prefs, ...input }
    await tx.update(users).set({ emailPrefs: next }).where(where)
    return emailPreferencesFrom(next)
  })
  res.json(prefs)
})
