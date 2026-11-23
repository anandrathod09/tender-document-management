// Prints docs/tender-flow/tender-flow.html to docs/Tender-Flow.pdf with the
// Chrome (or Edge) already installed on this computer. Run: npm run docs:pdf
// Set CHROME_PATH if the browser is somewhere else.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const source = join(here, 'tender-flow.html')
const output = resolve(here, '..', 'Tender-Flow.pdf')

const candidates = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean)
const browser = candidates.find((p) => existsSync(p))
if (!browser) {
  console.error('Chrome or Edge not found. Set CHROME_PATH to the browser program.')
  process.exit(1)
}

// A throwaway profile, so an open browser window doesn't get in the way.
const profile = mkdtempSync(join(tmpdir(), 'tender-flow-'))
try {
  execFileSync(
    browser,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      `--user-data-dir=${profile}`,
      '--no-pdf-header-footer',
      `--print-to-pdf=${output}`,
      pathToFileURL(source).href,
    ],
    { stdio: 'ignore', timeout: 120_000 },
  )
} finally {
  rmSync(profile, { recursive: true, force: true })
}
console.log(`Wrote ${output} (${Math.round(statSync(output).size / 1024)} KB)`)
