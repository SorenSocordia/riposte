import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ENGINE_VERSION, RULESET, verify } from '../src/index'
import { FIXED_NOW, clean } from './fixtures/invoices'

describe('version pinning', () => {
  it('ENGINE_VERSION matches package.json — a verdict must name the exact build that produced it', () => {
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string }
    expect(ENGINE_VERSION).toBe(pkg.version)
  })

  it('every verdict records engine and ruleset versions', () => {
    const v = verify(clean, { now: FIXED_NOW })
    expect(v.engine_version).toBe(ENGINE_VERSION)
    expect(v.ruleset).toEqual({ id: RULESET.id, version: RULESET.version, domain: RULESET.domain })
  })
})
