import multer from 'multer'
import { MAX_UPLOAD_MB } from '@tdm/shared'

/**
 * Multipart uploads are held in memory only for the length of the request;
 * the service checks the real file type and writes it to file storage.
 */
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
})
