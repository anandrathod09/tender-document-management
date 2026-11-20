import { z } from 'zod'

/**
 * Fill-in fields for declaration letters, written {{company_name}} in the
 * text. Each is replaced when the compliance PDF is made.
 */
export const LETTER_FIELDS = [
  { key: 'company_name', label: 'Company name', sample: 'Demo Infra Pvt Ltd' },
  { key: 'company_address', label: 'Company address', sample: 'Plot 12, MIDC, Nashik 422010' },
  { key: 'company_gstin', label: 'Company GSTIN', sample: '27AAACD1234E1Z5' },
  { key: 'company_pan', label: 'Company PAN', sample: 'AAACD1234E' },
  { key: 'company_email', label: 'Company email', sample: 'tenders@demoinfra.in' },
  { key: 'company_phone', label: 'Company phone', sample: '0253 2350000' },
  { key: 'signatory_name', label: 'Signatory name', sample: 'Anil Deshmukh' },
  { key: 'designation', label: 'Signatory designation', sample: 'Director' },
  { key: 'authorized_person', label: 'Authorized person', sample: 'Rahul Patil' },
  { key: 'authorized_position', label: 'Authorized person position', sample: 'Tender Manager' },
  { key: 'local_content_percent', label: 'Local content %', sample: '60' },
  { key: 'local_value_location', label: 'Local value addition location', sample: 'Nashik' },
  { key: 'buyer_organization', label: 'Buyer organization', sample: 'Public Works Department' },
  {
    key: 'department_address',
    label: 'Department address',
    sample: 'Office of the Executive Engineer, PWD Nashik',
  },
  { key: 'tender_ref', label: 'Tender reference', sample: 'PWD/NSK/2026/118' },
  { key: 'tender_brief', label: 'Tender brief', sample: 'Road resurfacing work, Nashik ring road' },
  { key: 'date', label: 'Date (DD-MM-YYYY)', sample: '20-11-2026' },
] as const
export type LetterFieldKey = (typeof LETTER_FIELDS)[number]['key']
export type LetterValues = Record<LetterFieldKey, string>

const FIELD_KEYS = new Set<string>(LETTER_FIELDS.map((f) => f.key))
const PLACEHOLDER = /\{\{\s*([a-z_]+)\s*\}\}/g

/** Fields used in a text that do not exist (typos), e.g. ["compnay_name"]. */
export function unknownLetterFields(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER)].map((m) => m[1]!).filter((k) => !FIELD_KEYS.has(k))
}

/** Replaces {{field}} with its value; an empty value prints a blank line to fill by hand. */
export function fillLetterFields(text: string, values: LetterValues): string {
  return text.replace(PLACEHOLDER, (whole, key: string) => {
    if (!FIELD_KEYS.has(key)) return whole
    const v = values[key as LetterFieldKey]?.trim()
    return v || '________'
  })
}

/** The building blocks of a letter body (the same ones the built-in letters use). */
export type LetterBlock =
  | { kind: 'para'; text: string }
  | { kind: 'heading'; text: string }
  /** A bold, centred line. */
  | { kind: 'center'; text: string }
  | { kind: 'numbered'; items: string[] }
  | { kind: 'bullets'; items: string[] }
  /** "Label: value" lines with a bold label. */
  | { kind: 'fields'; rows: [string, string][] }

export const LETTER_BLOCK_KINDS = [
  { kind: 'para', label: 'Paragraph' },
  { kind: 'heading', label: 'Heading' },
  { kind: 'center', label: 'Centred bold line' },
  { kind: 'numbered', label: 'Numbered list' },
  { kind: 'bullets', label: 'Bullet list' },
  { kind: 'fields', label: 'Label: value lines' },
] as const

/** What a letter looks like: printed on the company letterhead, ending with the signature. */
export interface LetterContent {
  title: string
  subtitle: string | null
  /** Print the "To," block with the buyer organization and department address. */
  addressed: boolean
  /** Print the date above the title. */
  dateAtTop: boolean
  body: LetterBlock[]
}

const text = (max: number) => z.string().trim().min(1, 'Cannot be empty').max(max)
const items = z.array(text(3000)).min(1, 'Add at least one line').max(50)

export const letterBlockSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('para'), text: text(5000) }),
  z.object({ kind: z.literal('heading'), text: text(300) }),
  z.object({ kind: z.literal('center'), text: text(300) }),
  z.object({ kind: z.literal('numbered'), items }),
  z.object({ kind: z.literal('bullets'), items }),
  z.object({
    kind: z.literal('fields'),
    rows: z
      .array(z.tuple([text(100), z.string().trim().max(1000)]))
      .min(1, 'Add at least one line')
      .max(30),
  }),
])

const blockTexts = (b: LetterBlock): string[] =>
  b.kind === 'numbered' || b.kind === 'bullets'
    ? b.items
    : b.kind === 'fields'
      ? b.rows.flat()
      : [b.text]

export const letterTemplateSchema = z
  .object({
    title: text(200),
    subtitle: z
      .string()
      .trim()
      .max(200)
      .transform((v) => v || null)
      .nullable()
      .optional(),
    addressed: z.boolean().default(true),
    dateAtTop: z.boolean().default(false),
    /** Only for this bidding company; empty means all companies. */
    companyId: z.uuid().nullable().default(null),
    body: z.array(letterBlockSchema).min(1, 'Add some text to the letter').max(60),
    isActive: z.boolean().default(true),
    /** The built-in letter this one was copied from, if any. */
    basedOn: z.string().max(40).nullable().optional(),
  })
  .superRefine((v, ctx) => {
    const all = [v.title, v.subtitle ?? '', ...v.body.flatMap(blockTexts)]
    const unknown = [...new Set(all.flatMap(unknownLetterFields))]
    if (unknown.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['body'],
        message: `Unknown field ${unknown.map((k) => `{{${k}}}`).join(', ')}. Use the field buttons to insert fields.`,
      })
    }
  })
export type LetterTemplateInput = z.input<typeof letterTemplateSchema>

/** Letters to preview: the content being edited, on a company's letterhead. */
export const letterPreviewSchema = z.object({
  letter: letterTemplateSchema,
  /** Whose letterhead; the first active company when left out. */
  companyId: z.uuid().nullable().optional(),
})

/** Built-in letters a client does not use, hidden from the compliance list. */
export const hiddenLettersSchema = z.object({ keys: z.array(z.string().max(40)).max(50) })

export interface LetterTemplateSummary extends LetterContent {
  id: string
  company: { id: string; name: string } | null
  isActive: boolean
  basedOn: string | null
  updatedAt: string
}

export interface LetterLibrary {
  /** The built-in letters, with whether this client hides them. */
  builtins: { key: string; title: string; hidden: boolean }[]
  /** The client's own letters. */
  templates: LetterTemplateSummary[]
}
