import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { gitProblems, parseReleaseVersion, recoveryHint, setPackageVersion } from '../../../scripts/release-lib.mjs'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

describe('parseReleaseVersion', () => {
  it('aceita X.Y.Z maior que a atual', () => {
    expect(parseReleaseVersion('0.4.0', '0.3.0')).toBe('0.4.0')
    expect(parseReleaseVersion('0.10.0', '0.9.0')).toBe('0.10.0')
  })

  it('formato errado → mensagem de uso', () => {
    for (const input of [undefined, '', 'v0.4.0', '0.4', '0.4.0-beta', '01.2.3', '1.02.3', '1.2.03']) {
      expect(() => parseReleaseVersion(input, '0.3.0')).toThrow('uso: pnpm release X.Y.Z')
    }
  })

  it('igual ou menor → recusa', () => {
    expect(() => parseReleaseVersion('0.3.0', '0.3.0')).toThrow('a versão 0.3.0 precisa ser maior que a atual (0.3.0)')
    expect(() => parseReleaseVersion('0.2.9', '0.3.0')).toThrow('precisa ser maior')
  })
})

describe('gitProblems', () => {
  it('main limpa e em dia → nenhum problema', () => {
    expect(gitProblems({ status: '', branch: 'main', behind: 0, tagExists: false })).toEqual([])
  })

  it('lista cada problema', () => {
    expect(gitProblems({ status: ' M README.md\n', branch: 'feature', behind: 2, tagExists: true })).toEqual([
      'há alterações não commitadas (git status não está limpo)',
      'você está no branch "feature"; publique a partir da main',
      'a main local está 2 commit(s) atrás de origin/main; rode git pull',
      'a tag já existe',
    ])
  })
})

describe('recoveryHint', () => {
  it('antes do commit → nada publicado', () => {
    for (const step of ['write', 'add', 'commit']) expect(recoveryHint(step, '0.4.0')).toContain('nada foi publicado')
  })
  it('falha na tag → reset do commit local', () => {
    expect(recoveryHint('tag', '0.4.0')).toBe('o commit de release existe só localmente; para desfazer: git reset --hard HEAD~1')
  })
  it('falha no push → publicar ou desistir', () => {
    const hint = recoveryHint('push', '0.4.0')
    expect(hint).toContain('git push --atomic origin main v0.4.0')
    expect(hint).toContain('git tag -d v0.4.0 && git reset --hard HEAD~1')
  })
})

describe('setPackageVersion', () => {
  it('insere "version" logo depois de "name" e preserva o resto', () => {
    const text = '{\n  "name": "x",\n  "private": true,\n  "scripts": { "a": "b" }\n}\n'
    const next = setPackageVersion(text, '0.4.0')
    expect(Object.keys(JSON.parse(next))).toEqual(['name', 'version', 'private', 'scripts'])
    expect(JSON.parse(next)).toEqual({ name: 'x', version: '0.4.0', private: true, scripts: { a: 'b' } })
    expect(next.endsWith('}\n')).toBe(true)
    expect(next).toContain('\n  "version": "0.4.0",\n')
  })

  it('substitui a versão existente do package.json real', () => {
    const real = fs.readFileSync(path.join(repo, 'package.json'), 'utf8')
    const next = JSON.parse(setPackageVersion(real, '9.9.9'))
    expect(next.version).toBe('9.9.9')
    expect(next.scripts).toEqual(JSON.parse(real).scripts)
  })
})

describe('scripts/release.mjs', () => {
  it('sem versão → código 1 e uso, antes de qualquer comando git', () => {
    const r = spawnSync(process.execPath, [path.join(repo, 'scripts', 'release.mjs')], { encoding: 'utf8' })
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('✗ uso: pnpm release X.Y.Z')
  })

  it('package.json tem o script release', () => {
    expect(JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8')).scripts.release).toBe('node scripts/release.mjs')
  })
})
