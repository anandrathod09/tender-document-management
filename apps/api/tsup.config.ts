import { defineConfig } from 'tsup'

export default defineConfig({
  entry: [
    'src/server.ts',
    'src/db/migrate.ts',
    'src/db/seed.ts',
    'src/db/migrate-from-tms.ts',
    'src/db/copy-files-to-s3.ts',
  ],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // Bundle the shared workspace package; leave real npm packages external.
  noExternal: ['@tdm/shared'],
})
