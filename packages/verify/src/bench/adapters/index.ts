/** The run-shape adapters, by the name a spec gives (`adapter`). */

import type { AdapterName } from '../spec.js'
import { itemsAdapter } from './items.js'
import { nativeAdapter } from './native.js'
import type { Adapter } from './shape.js'
import { summaryAdapter } from './summary.js'
import { transcribedAdapter } from './transcribed.js'

export const ADAPTERS: Readonly<Record<AdapterName, Adapter>> = {
  items: itemsAdapter,
  summary: summaryAdapter,
  transcribed: transcribedAdapter,
  native: nativeAdapter,
}

export type { Adapter, AdapterContext, AdapterOutput, RowDraft } from './shape.js'
