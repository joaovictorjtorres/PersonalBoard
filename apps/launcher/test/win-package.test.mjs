import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  PINS, assertSha256, assetName, serverPackageJson, serverWranglerConfig, sha256File, stripJsonComments, toCrlf,
} from '../../../scripts/win-package/lib.mjs'
import { UPDATE_EXIT_CODE } from '../src/swap.mjs'
import { STAGING_DIR_NAME } from '../src/update.mjs'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const read = (...p) => fs.readFileSync(path.join(repo, ...p), 'utf8')

describe('pins', () => {
  it('Node portátil na mesma major do projeto; versões nas URLs; SHA-256 em hex', () => {
    expect(PINS.node.version.split('.')[0]).toBe(process.versions.node.split('.')[0])
    expect(PINS.node.url).toBe(`https://nodejs.org/dist/v${PINS.node.version}/node-v${PINS.node.version}-win-x64.zip`)
    expect(PINS.node.dir).toBe(`node-v${PINS.node.version}-win-x64`)
    expect(PINS.cloudflared.url).toBe(
      `https://github.com/cloudflare/cloudflared/releases/download/${PINS.cloudflared.version}/cloudflared-windows-amd64.exe`,
    )
    for (const pin of [PINS.node, PINS.cloudflared]) expect(pin.sha256).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('checksum', () => {
  it('sha256File + assertSha256', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesa-sha-'))
    const file = path.join(dir, 'abc.txt')
    fs.writeFileSync(file, 'abc')
    const digest = await sha256File(file)
    expect(digest).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(() => assertSha256(digest, digest.toUpperCase(), 'abc.txt')).not.toThrow()
    expect(() => assertSha256(digest, '0'.repeat(64), 'abc.txt')).toThrow(
      `checksum de abc.txt não confere: esperado ${'0'.repeat(64)}, obtido ${digest}`,
    )
    fs.rmSync(dir, { recursive: true, force: true })
  })
})

describe('configuração do servidor no pacote', () => {
  it('stripJsonComments tira comentários e vírgulas sobrando, mas preserva "//" dentro de strings', () => {
    const text = '{\n  // comentário\n  "url": "https://x//y", /* bloco */ "a": [1, 2,],\n}'
    expect(JSON.parse(stripJsonComments(text))).toEqual({ url: 'https://x//y', a: [1, 2] })
  })

  it('wrangler.jsonc do pacote aponta para o bundle e para web/, mantendo bindings', () => {
    const source = JSON.parse(stripJsonComments(read('apps', 'worker', 'wrangler.jsonc')))
    const cfg = serverWranglerConfig(read('apps', 'worker', 'wrangler.jsonc'))
    expect(cfg.$schema).toBeUndefined()
    expect(cfg.main).toBe('worker/index.js')
    expect(cfg.assets).toEqual({ ...source.assets, directory: 'web' })
    expect(cfg.durable_objects).toEqual(source.durable_objects)
    expect(cfg.migrations).toEqual(source.migrations)
    expect(cfg.r2_buckets).toEqual(source.r2_buckets)
    expect(cfg.compatibility_date).toBe(source.compatibility_date)
  })

  it('package.json do servidor depende só do wrangler na versão exata instalada', () => {
    const installed = JSON.parse(read('apps', 'worker', 'node_modules', 'wrangler', 'package.json')).version
    expect(installed).toMatch(/^4\.148\./)
    expect(serverPackageJson(installed)).toEqual({
      name: 'mesa-virtual-server', version: '0.0.0', private: true, type: 'module', dependencies: { wrangler: installed },
    })
  })
})

describe('Iniciar Mesa.cmd (contrato congelado com o launcher)', () => {
  const cmd = read('scripts', 'win', 'Iniciar Mesa.cmd')

  it('só ASCII e CRLF depois de toCrlf', () => {
    expect(cmd).toMatch(/^[\x00-\x7F]*$/)
    expect(toCrlf('a\nb\r\nc\n')).toBe('a\r\nb\r\nc\r\n')
    expect(toCrlf(cmd).split('\r\n').every((l) => !l.includes('\n'))).toBe(true)
  })

  it('roda o launcher com --root e aplica a atualização pelo %TEMP% no código 75', () => {
    expect(cmd).toContain('"app\\node\\node.exe" "app\\launcher\\launcher.mjs" --root "%~dp0." %*')
    expect(cmd).toContain(`if "%CODE%"=="${UPDATE_EXIT_CODE}" (`)
    expect(cmd).toContain(
      `"%TEMP%\\${STAGING_DIR_NAME}\\node.exe" "%TEMP%\\${STAGING_DIR_NAME}\\launcher\\launcher.mjs" --root "%~dp0." --apply-update`,
    )
    expect(cmd).toContain('if not exist "app\\node\\node.exe" if exist "app.old\\node\\node.exe" ren "app.old" "app"')
    expect(cmd).toContain('pause')
  })

  it('console em UTF-8 antes do node; Ctrl+C (130 e 0xC000013A) é saída normal, sem pausa', () => {
    const lines = cmd.split(/\r?\n/)
    const chcp = lines.findIndex((l) => l.trim() === 'chcp 65001 >nul')
    const node = lines.findIndex((l) => l.startsWith('"app\\node\\node.exe"'))
    expect(chcp).toBeGreaterThanOrEqual(0)
    expect(chcp).toBeLessThan(node)
    expect(cmd).toContain('if "%CODE%"=="130" set "CODE=0"')
    expect(cmd).toContain('if "%CODE%"=="-1073741510" set "CODE=0"')
    expect(cmd.indexOf('"-1073741510"')).toBeLessThan(cmd.indexOf('pause'))
  })

  it('setlocal sem expansão atrasada; pushd/popd em vez de cd; aviso se a troca falhar', () => {
    const lines = cmd.split(/\r?\n/)
    expect(lines).toContain('setlocal EnableExtensions DisableDelayedExpansion')
    expect(cmd).not.toContain('cd /d')
    expect(lines).toContain('pushd "%~dp0"')
    const popd = lines.findIndex((l) => l.trim() === 'popd')
    const exit = lines.findIndex((l) => l.startsWith('endlocal & exit /b %CODE%'))
    expect(popd).toBeGreaterThan(0)
    expect(popd).toBeLessThan(exit)
    const apply = lines.findIndex((l) => l.includes('--apply-update'))
    expect(lines[apply + 1].trim()).toBe(
      'if errorlevel 1 echo [Mesa Virtual] A atualizacao nao pode ser aplicada; continuando na versao atual.',
    )
    expect(lines.indexOf('pushd "%~dp0"')).toBeLessThan(lines.findIndex((l) => l.startsWith('"app\\node\\node.exe"')))
  })

  it('--apply-update roda do node preparado em %TEMP% (fora de app\\)', () => {
    const line = cmd.split(/\r?\n/).find((l) => l.includes('--apply-update'))
    expect(line.trim().startsWith(`"%TEMP%\\${STAGING_DIR_NAME}\\node.exe"`)).toBe(true)
    expect(line).not.toContain('app\\')
  })
})

describe('versão e build', () => {
  it('version.txt = "version" do package.json raiz; nome do zip', () => {
    const version = read('version.txt').trim()
    expect(version).toMatch(/^\d+\.\d+\.\d+$/)
    expect(JSON.parse(read('package.json')).version).toBe(version)
    expect(assetName(version)).toBe(`MesaVirtual-v${version}-win64.zip`)
  })

  it.skipIf(process.platform === 'win32')('fora do Windows o build recusa com mensagem clara', () => {
    const r = spawnSync(process.execPath, [path.join(repo, 'scripts', 'build-win-package.mjs')], { encoding: 'utf8' })
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('monte o pacote no Windows')
  })
})
