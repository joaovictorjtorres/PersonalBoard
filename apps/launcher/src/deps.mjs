import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import readline from 'node:readline/promises'
import { isPortFree } from './ports.mjs'

async function ask(question) {
  if (!process.stdin.isTTY) {
    process.stdout.write(`${question}n (sem teclado)\n`)
    return 'n'
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  rl.on('SIGINT', () => {
    rl.close()
    process.exit(130)
  })
  try {
    return await rl.question(question)
  } finally {
    rl.close()
  }
}

/** @returns {import('./main.mjs').Deps} */
export function createRealDeps(launcherDir) {
  return {
    fs,
    spawn,
    fetch: (input, init) => globalThis.fetch(input, init),
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    sleepSync: (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms),
    setTimer: (fn, ms) => {
      const timer = setTimeout(fn, ms)
      return () => clearTimeout(timer)
    },
    platform: process.platform,
    env: process.env,
    homedir: os.homedir(),
    tmpdir: os.tmpdir(),
    execPath: process.execPath,
    launcherDir,
    isPortFree,
    ask,
    chdir: (dir) => process.chdir(dir),
    print: (line) => { process.stdout.write(`${line}\n`) },
    // SIGHUP = fechar a janela do console no Windows; SIGBREAK = Ctrl+Break.
    onExitSignal: (handler) => {
      for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) process.on(signal, handler)
    },
  }
}
