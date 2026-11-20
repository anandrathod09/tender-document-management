import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// On Windows the same folder can be reached as d:\ or D:\ (VS Code terminals
// often give the lower-case form). Vitest then loads the setup file twice and
// fails with "failed to find the current suite", so use one spelling for all paths.
const upperDrive = (p: string) => (/^[a-z]:/.test(p) ? p[0]!.toUpperCase() + p.slice(1) : p)
const root = upperDrive(dirname(fileURLToPath(import.meta.url)))
if (process.platform === 'win32') process.chdir(upperDrive(process.cwd()))

export default defineConfig({
  root,
  test: {
    globalSetup: [resolve(root, 'test/global-setup.ts')],
    setupFiles: [resolve(root, 'test/setup.ts')],
    // Tests share one MySQL test database, so files run one at a time.
    fileParallelism: false,
    pool: 'forks',
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
})
