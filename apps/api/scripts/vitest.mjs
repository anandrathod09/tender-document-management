// Starts Vitest from this folder, spelled with an upper-case drive letter on Windows.
// Run from the repository root (npm test), npm hands over "d:\..." while other
// tools use "D:\..."; Vitest then loads its setup file twice and fails with
// "failed to find the current suite".
import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const upperDrive = (p) => (/^[a-z]:/.test(p) ? p[0].toUpperCase() + p.slice(1) : p)
const cwd = upperDrive(resolve(dirname(fileURLToPath(import.meta.url)), '..'))
const env = { ...process.env, INIT_CWD: cwd, PWD: cwd }
const child = spawn('npx', ['vitest', ...process.argv.slice(2)], {
  cwd,
  env,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})
child.on('exit', (code) => process.exit(code ?? 1))
