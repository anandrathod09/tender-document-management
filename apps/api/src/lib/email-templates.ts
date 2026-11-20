import { env } from '../config/env'

/**
 * HTML emails in the style of the original TMS: a coloured header band, a
 * light content box, a big button, a details box and a footer. Built with
 * tables and inline styles, which every email program (Gmail, Outlook,
 * phones) shows the same way. Every value put into an email is escaped.
 */

export const esc = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

export const COLORS = { blue: '#4F46E5', red: '#DC2626', green: '#16A34A', amber: '#D97706' }

/** A paragraph of plain text (escaped). */
export const p = (text: string) =>
  `<p style="margin:0 0 14px 0;font-size:15px;line-height:1.6;color:#333333;">${esc(text)}</p>`

/** The main call-to-action button. */
export function button(url: string, label: string, color: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:22px auto;">
  <tr><td style="border-radius:6px;background:${color};">
    <a href="${esc(url)}" target="_blank" style="display:inline-block;padding:12px 28px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:6px;">${esc(label)}</a>
  </td></tr>
</table>`
}

/** A white box with a coloured left border, listing label/value pairs. */
export function details(title: string, rows: [string, string][], color: string): string {
  const lines = rows
    .map(
      ([label, value]) =>
        `<p style="margin:4px 0;font-size:14px;color:#333333;"><strong>${esc(label)}:</strong> ${esc(value)}</p>`,
    )
    .join('')
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0;">
  <tr><td style="background:#ffffff;border-left:4px solid ${color};border-radius:4px;padding:14px 16px;">
    <p style="margin:0 0 8px 0;font-size:14px;font-weight:bold;color:${color};">${esc(title)}</p>
    ${lines}
  </td></tr>
</table>`
}

/** A highlighted note: yellow for "important", red-tinted for warnings. */
export function note(label: string, text: string, tone: 'yellow' | 'red' = 'yellow'): string {
  const [bg, border] = tone === 'yellow' ? ['#fff3cd', '#ffeaa7'] : ['#fee2e2', '#fecaca']
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0;">
  <tr><td style="background:${bg};border:1px solid ${border};border-radius:4px;padding:10px 14px;font-size:14px;color:#333333;">
    <strong>${esc(label)}</strong> ${esc(text)}
  </td></tr>
</table>`
}

/** The link written out, for people whose email program hides buttons. */
export const fallbackLink = (url: string) =>
  `<p style="margin:0 0 14px 0;font-size:12px;line-height:1.5;color:#666666;">If the button does not work, copy this link into your browser:<br><a href="${esc(url)}" style="color:#4F46E5;word-break:break-all;">${esc(url)}</a></p>`

export function layout(opts: {
  /** Big title in the coloured band. */
  heading: string
  /** Smaller line under it, e.g. the client's name. */
  subheading: string
  color: string
  /** Hidden preview line shown in the inbox list. */
  preheader: string
  body: string
}): string {
  const year = new Date().getFullYear()
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${esc(opts.heading)}</title>
</head>
<body style="margin:0;padding:0;background:#eef0f4;font-family:Arial,Helvetica,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(opts.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eef0f4;">
  <tr><td align="center" style="padding:24px 12px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">
      <tr><td style="background:${opts.color};color:#ffffff;padding:22px 24px;text-align:center;border-radius:8px 8px 0 0;">
        <h1 style="margin:0;font-size:22px;line-height:1.3;font-weight:bold;color:#ffffff;">${esc(opts.heading)}</h1>
        <p style="margin:6px 0 0 0;font-size:14px;color:#ffffff;opacity:0.9;">${esc(opts.subheading)}</p>
      </td></tr>
      <tr><td style="background:#f9f9f9;padding:28px 28px 20px 28px;border-radius:0 0 8px 8px;">
        ${opts.body}
      </td></tr>
      <tr><td style="text-align:center;padding:20px 12px 0 12px;font-size:12px;line-height:1.6;color:#666666;">
        <p style="margin:0;">This is an automated email from ${esc(env.PRODUCT_NAME)}.</p>
        <p style="margin:4px 0 0 0;">&copy; ${year} ${esc(env.PRODUCT_NAME)}. All rights reserved.</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`
}
