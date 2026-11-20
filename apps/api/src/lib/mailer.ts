import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import nodemailer, { type Transporter } from 'nodemailer'
import { env } from '../config/env'
import type { DbOrTx } from '../db/client'
import { enqueue, registerJob } from '../modules/jobs/queue'
import { logger } from './logger'

export interface Mail {
  to: string
  subject: string
  /** Plain-text version (always sent too, for email programs that prefer it). */
  text: string
  /** The designed version (lib/email-templates.ts). */
  html?: string
  /** Shown as the sender name, e.g. the client's name. */
  fromName?: string
  /** Where replies go, e.g. the client's own address. */
  replyTo?: string
}

/** Emails "sent" during tests, so tests can read invitation and reset links. */
export const testOutbox: Mail[] = []

/**
 * SMTP works with every provider we are considering (Amazon SES, Brevo,
 * Postmark): only the host, port and login change.
 */
let transporter: Transporter | null = null
if (env.SMTP_HOST) {
  transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
  })
}

/**
 * Queues an email. Pass the transaction of the action that triggers it: the
 * email goes out only if that action is saved. Sending is retried up to
 * five times by the job worker.
 */
export async function queueMail(conn: DbOrTx, mail: Mail, organizationId?: string | null) {
  await enqueue(conn, 'email.send', { ...mail }, { organizationId })
}

/** Actually sends (or, without SMTP, prints) an email. Throws on failure so the job retries. */
export async function deliverMail(mail: Mail): Promise<void> {
  if (env.NODE_ENV === 'test') {
    testOutbox.push(mail)
    return
  }
  if (!transporter) {
    // No email server set up (local development): keep a copy to look at instead.
    const file = await saveToOutbox(mail)
    logger.info(
      { to: mail.to, subject: mail.subject, file },
      'Email (not sent, no SMTP configured)',
    )
    console.log(
      `\n----- EMAIL to ${mail.to} -----\nSubject: ${mail.subject}\n\n${mail.text}\n` +
        `View it designed: ${env.PUBLIC_URL_TEMPLATE.replace('{slug}', env.OWNER_SUBDOMAIN)}/api/dev/mail\n-----\n`,
    )
    return
  }
  const from = `"${(mail.fromName ?? env.PRODUCT_NAME).replace(/["<>\r\n]/g, '')}" <${env.MAIL_FROM_ADDRESS}>`
  await transporter.sendMail({
    from,
    to: mail.to,
    replyTo: mail.replyTo,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
  })
}

/** Where emails go when no SMTP server is configured: STORAGE_DIR/mail-outbox. */
export const outboxDir = () => resolve(process.cwd(), env.STORAGE_DIR, 'mail-outbox')

async function saveToOutbox(mail: Mail): Promise<string> {
  const dir = outboxDir()
  await mkdir(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const slug = mail.subject
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 50)
  const name = `${stamp}_${slug}.json`
  await writeFile(join(dir, name), JSON.stringify({ ...mail, at: new Date().toISOString() }))
  return name
}

registerJob('email.send', async (payload) => {
  await deliverMail(payload as unknown as Mail)
})
