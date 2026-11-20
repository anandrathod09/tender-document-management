import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Router } from 'express'
import { esc } from '../../lib/email-templates'
import { notFound } from '../../lib/errors'
import { outboxDir, type Mail } from '../../lib/mailer'

/**
 * Local development only: lists the emails the app would have sent (saved
 * because no SMTP server is set up) and shows each one as it would arrive.
 * Mounted only when NODE_ENV=development.
 */
export const mailOutboxRouter = Router()

const NAME = /^[\w.-]+\.json$/

async function readMail(name: string): Promise<Mail & { at: string }> {
  if (!NAME.test(name)) throw notFound()
  try {
    return JSON.parse(await readFile(join(outboxDir(), name), 'utf8'))
  } catch {
    throw notFound()
  }
}

mailOutboxRouter.get('/', async (_req, res) => {
  let names: string[] = []
  try {
    names = (await readdir(outboxDir()))
      .filter((n) => NAME.test(n))
      .sort()
      .reverse()
      .slice(0, 200)
  } catch {
    // No emails yet.
  }
  const rows = await Promise.all(
    names.map(async (n) => {
      const m = await readMail(n)
      const when = new Date(m.at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
      return `<tr>
        <td style="padding:10px;border-bottom:1px solid #e5e7eb;white-space:nowrap;color:#6b7280;font-size:13px;">${esc(when)}</td>
        <td style="padding:10px;border-bottom:1px solid #e5e7eb;font-size:13px;">${esc(m.to)}</td>
        <td style="padding:10px;border-bottom:1px solid #e5e7eb;font-size:14px;"><a href="./${encodeURIComponent(n)}" style="color:#4F46E5;font-weight:bold;">${esc(m.subject)}</a></td>
        <td style="padding:10px;border-bottom:1px solid #e5e7eb;font-size:13px;"><a href="./${encodeURIComponent(n)}?text=1" style="color:#6b7280;">plain text</a></td>
      </tr>`
    }),
  )
  res.type('html')
    .send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Mail outbox</title></head>
<body style="margin:0;font-family:Arial,Helvetica,sans-serif;background:#f3f4f6;">
<div style="max-width:1000px;margin:24px auto;background:#fff;border:1px solid #e5e7eb;border-radius:6px;">
  <div style="padding:16px 20px;border-bottom:1px solid #e5e7eb;">
    <h1 style="margin:0;font-size:20px;">Mail outbox <span style="font-size:13px;font-weight:normal;color:#6b7280;">(development only)</span></h1>
    <p style="margin:6px 0 0 0;font-size:13px;color:#6b7280;">No SMTP server is set up, so emails are kept here instead of being sent. Newest first. Set SMTP_* in apps/api/.env to send real emails.</p>
  </div>
  <table style="width:100%;border-collapse:collapse;">
    <thead><tr style="background:#f9fafb;text-align:left;font-size:13px;">
      <th style="padding:10px;">Sent</th><th style="padding:10px;">To</th><th style="padding:10px;">Subject</th><th style="padding:10px;"></th>
    </tr></thead>
    <tbody>${rows.join('') || '<tr><td colspan="4" style="padding:24px;text-align:center;color:#6b7280;">No emails yet. Invite a user or use "Forgot password?" to see one.</td></tr>'}</tbody>
  </table>
</div></body></html>`)
})

mailOutboxRouter.get('/:name', async (req, res) => {
  const m = await readMail(req.params.name as string)
  if (req.query.text || !m.html) {
    res.type('text/plain; charset=utf-8').send(`To: ${m.to}\nSubject: ${m.subject}\n\n${m.text}`)
    return
  }
  res.type('html').send(m.html)
})
