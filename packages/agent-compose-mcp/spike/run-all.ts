/**
 * Runs every spike script in sequence and reports pass/fail.
 *
 * Run: node --experimental-strip-types spike/run-all.ts
 */
import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

const SCRIPTS = [
  'spike-client.ts',
  'spike-server.ts',
  'spike-lowlevel.ts',
  'spike-auth.ts',
  'spike-transports.ts',
  'spike-jsonschema.ts',
  'spike-http-wiring.ts',
  'spike-details.ts',
  'spike-upstream-client.ts',
]

function run(script: string): Promise<{ script: string; code: number; output: string }> {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, ['--experimental-strip-types', resolve(here, script)], {
      cwd: resolve(here, '..'),
    })
    let output = ''
    child.stdout.on('data', (chunk) => {
      output += String(chunk)
    })
    child.stderr.on('data', (chunk) => {
      output += String(chunk)
    })
    child.on('close', (code) => resolvePromise({ script, code: code ?? 1, output }))
  })
}

const results: { script: string; code: number; output: string }[] = []
for (const script of SCRIPTS) {
  results.push(await run(script))
}

let failed = 0
for (const result of results) {
  const status = result.code === 0 ? 'PASS' : 'FAIL'
  if (result.code !== 0) {
    failed += 1
    console.error(`\n===== ${result.script}: ${status} =====\n${result.output}`)
  }
  console.log(`${result.script}: ${status}`)
}

console.log(`\n${results.length - failed}/${results.length} spike scripts passed.`)
process.exitCode = failed === 0 ? 0 : 1
