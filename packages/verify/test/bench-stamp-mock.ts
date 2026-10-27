/**
 * A local, offline mock of an RFC 3161 timestamp authority, for the stamp tests (not a test file itself). OpenSSL makes a
 * throwaway CA and a TSA certificate (extendedKeyUsage critical timeStamping) in a temporary folder, and answers a query
 * with `openssl ts -reply`. No socket is opened and nothing leaves the machine.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Submitter } from '../src/bench/timestamp'

export const opensslAvailable = (): boolean => {
  const p = spawnSync(process.env.RIPOSTE_OPENSSL || 'openssl', ['version'], { encoding: 'utf8', windowsHide: true })
  return p.status === 0 && /OpenSSL/i.test(p.stdout ?? '')
}

function ossl(cwd: string, args: string[]): void {
  const p = spawnSync(process.env.RIPOSTE_OPENSSL || 'openssl', args, { cwd, encoding: 'utf8', windowsHide: true })
  if (p.status !== 0) throw new Error(`openssl ${args.slice(0, 2).join(' ')} failed: ${(p.stderr ?? '').trim()}`)
}

export interface MockTsa { dir: string; ca: string; submit: Submitter }

/** A CA and a TSA in `dir`; `name` keeps two authorities apart (a second one is a wrong CA for the first one's replies). */
export function mockTsa(dir: string, name = 'Mock TSA'): MockTsa {
  const fwd = (p: string): string => p.split('\\').join('/')
  const cnf = join(dir, 'tsa.cnf')
  writeFileSync(cnf, [
    '[ req ]', 'distinguished_name = dn', 'prompt = no', '[ dn ]', `CN = ${name} CA`,
    '[ v3_ca ]', 'basicConstraints = critical,CA:true', 'keyUsage = critical,keyCertSign,cRLSign', 'subjectKeyIdentifier = hash',
    '[ v3_tsa ]', 'basicConstraints = critical,CA:false', 'extendedKeyUsage = critical,timeStamping', 'keyUsage = critical,digitalSignature',
    'subjectKeyIdentifier = hash', 'authorityKeyIdentifier = keyid',
    '[ tsa_config ]', `serial = ${fwd(join(dir, 'serial'))}`, `signer_cert = ${fwd(join(dir, 'tsa.crt'))}`, `certs = ${fwd(join(dir, 'ca.crt'))}`,
    `signer_key = ${fwd(join(dir, 'tsa.key'))}`, 'signer_digest = sha256', 'default_policy = 1.2.3.4.1', 'digests = sha256',
    'accuracy = secs:1', 'ordering = no', 'tsa_name = no', 'ess_cert_id_chain = no', 'ess_cert_id_alg = sha256', '',
  ].join('\n'))
  writeFileSync(join(dir, 'serial'), '01\n')
  const ec = ['-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes']
  ossl(dir, ['req', '-x509', ...ec, '-keyout', 'ca.key', '-out', 'ca.crt', '-days', '3650', '-config', cnf, '-extensions', 'v3_ca'])
  ossl(dir, ['req', '-new', ...ec, '-keyout', 'tsa.key', '-out', 'tsa.csr', '-config', cnf, '-subj', `/CN=${name}`])
  ossl(dir, ['x509', '-req', '-in', 'tsa.csr', '-CA', 'ca.crt', '-CAkey', 'ca.key', '-set_serial', '2', '-out', 'tsa.crt', '-days', '3650', '-extfile', cnf, '-extensions', 'v3_tsa'])
  const submit: Submitter = (queryPath, replyPath) => {
    const p = spawnSync(process.env.RIPOSTE_OPENSSL || 'openssl', ['ts', '-reply', '-config', cnf, '-section', 'tsa_config', '-queryfile', queryPath, '-out', replyPath], { cwd: dir, encoding: 'utf8', windowsHide: true })
    return { ok: p.status === 0 && existsSync(replyPath), message: (p.stderr ?? '').trim() }
  }
  return { dir, ca: join(dir, 'ca.crt'), submit }
}
