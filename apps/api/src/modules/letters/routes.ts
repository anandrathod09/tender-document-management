import { Router } from 'express'
import {
  hiddenLettersSchema,
  letterPreviewSchema,
  letterTemplateSchema,
  PERMISSIONS,
} from '@tdm/shared'
import { parse } from '../../lib/validate'
import { authenticateTenant, requirePermission, tenantAuth } from '../../middleware/auth'
import {
  builtinContent,
  createLetter,
  deleteLetter,
  listLetterLibrary,
  previewLetter,
  setHiddenLetters,
  updateLetter,
} from './service'

/** Letter templates. Everyone can list them (for compliance PDFs); company managers edit them. */
export const lettersRouter = Router()
lettersRouter.use(authenticateTenant)

lettersRouter.get('/', async (req, res) => {
  res.json(await listLetterLibrary(tenantAuth(req).org.id))
})

const manage = requirePermission(PERMISSIONS.COMPANY_MANAGE)

lettersRouter.get('/builtin/:key', manage, (req, res) => {
  res.json(builtinContent(req.params.key as string))
})

lettersRouter.put('/hidden', manage, async (req, res) => {
  const { keys } = parse(hiddenLettersSchema, req.body)
  res.json(await setHiddenLetters(tenantAuth(req), keys))
})

lettersRouter.post('/preview', manage, async (req, res) => {
  const { letter, companyId } = parse(letterPreviewSchema, req.body)
  const pdf = await previewLetter(tenantAuth(req), letter, companyId)
  res.type('application/pdf').setHeader('Content-Disposition', 'inline; filename="Preview.pdf"')
  res.send(Buffer.from(pdf))
})

lettersRouter.post('/', manage, async (req, res) => {
  res.status(201).json(await createLetter(tenantAuth(req), parse(letterTemplateSchema, req.body)))
})

lettersRouter.put('/:id', manage, async (req, res) => {
  const input = parse(letterTemplateSchema, req.body)
  res.json(await updateLetter(tenantAuth(req), req.params.id as string, input))
})

lettersRouter.delete('/:id', manage, async (req, res) => {
  await deleteLetter(tenantAuth(req), req.params.id as string)
  res.status(204).end()
})
