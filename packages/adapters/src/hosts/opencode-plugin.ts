/**
 * The OpenCode plugin module: copy the built file into `.opencode/plugins/` (one project) or `~/.config/opencode/plugins/`
 * (every project). OpenCode treats every export of a plugin file as a plugin function, so this module exports exactly one.
 * See ./opencode.ts for the check and its contract. The ledger is RIPOSTE_LEDGER, else ~/.riposte/receipts.jsonl.
 *
 * With any RIPOSTE_GOV_* variable set when the plugin loads, it also returns `tool.execute.before`: the fleet's governance
 * check before every tool call, which throws (blocks the tool) on a refusal and on any error. Receipts go to
 * RIPOSTE_GOV_RECEIPTS (required: a plugin has no --ledger). With none set, the plugin returns exactly the hooks it did.
 */
import { defaultLedger, governanceReceiptWriter, ledgerOpener } from './bin-io.js'
import { GovernanceDenied, openCodeIdle, openCodeToolBefore, sendBackBody, type OpenCodeMessage } from './opencode.js'
import { governanceFromEnv, scrubHookEnv } from '../governance.js'

// 2026-10-04: drop inherited RIPOSTE_* settings that weaken the lock (in-host: RIPOSTE_LEDGER_UNLOCKED only).
scrubHookEnv(process.env, 'opencode')

interface Client {
  session: {
    messages(o: { path: { id: string } }): Promise<{ data?: unknown; error?: unknown }>
    promptAsync(o: { path: { id: string }; body: ReturnType<typeof sendBackBody> }): Promise<{ error?: unknown } | unknown>
  }
  app?: { log?(o: { body: { service: string; level: string; message: string } }): unknown }
}

export const RipostePlugin = async ({ client }: { client: Client }) => {
  const checked = new Set<string>()
  const log = (level: 'info' | 'warn' | 'error', message: string) => {
    try { void Promise.resolve(client?.app?.log?.({ body: { service: 'riposte', level, message } })).catch(() => undefined) } catch { /* logging never fails the hook */ }
  }
  const hooks: Record<string, unknown> = {
    event: async ({ event }: { event?: { type?: string; properties?: { sessionID?: unknown } } }) => {
      try {
        if (event?.type !== 'session.idle' || typeof event.properties?.sessionID !== 'string') return
        const id = event.properties.sessionID
        const r = await openCodeIdle({
          env: process.env, checked, defaultLedger: defaultLedger(), openLedger: ledgerOpener(process.env),
          messages: async () => {
            const res = await client.session.messages({ path: { id } })
            if (res?.error) throw new Error(`session.messages failed: ${JSON.stringify(res.error).slice(0, 200)}`)
            return res?.data as OpenCodeMessage[]
          },
          sendBack: async (text) => {
            const res = await client.session.promptAsync({ path: { id }, body: sendBackBody(text) }) as { error?: unknown } | undefined
            if (res && typeof res === 'object' && res.error) throw new Error(JSON.stringify(res.error).slice(0, 200))
          },
        })
        for (const p of r.problems) log('warn', `riposte: ${p}`)
        if (r.error) log(r.code ? 'error' : 'warn', `riposte: ${r.error}`)
      } catch (e) {
        log('error', `riposte: ${(e as Error).message}`)
      }
    },
  }
  if (governanceFromEnv(process.env).on) {
    hooks['tool.execute.before'] = async (input: { tool?: unknown; sessionID?: unknown; callID?: unknown }, output: { args?: unknown }) => {
      try {
        await openCodeToolBefore(input, output, { env: process.env, writeReceipt: governanceReceiptWriter(process.env) })
      } catch (e) {
        if (e instanceof GovernanceDenied) { log('warn', `riposte governance: denied ${e.verdict.tool}: ${e.verdict.code}`); throw e }
        log('error', `riposte governance: ${(e as Error).message}`)
        throw new Error(`Riposte governance: governance.error: ${(e as Error).message}`)
      }
    }
  }
  return hooks
}
