/**
 * Engine 0.7.0 (2026-10-13): which engines read an emailed bill the 0.7.0 way.
 *
 * The 0.7.0 readings of the text path: the sender is the address in angle brackets, never a display name; a signature line is
 * not vendor evidence; a hyphen the vendor's name does not carry is a look-alike; payment-instruction sentences are read as
 * sentences; a partial bill is ordinary; a billed line that matches no purchase-order line, or does not name its item, is
 * named; a tax line is read and checked against the rate the purchase order states; a suffixed invoice number is read whole,
 * and a near number is said to be similar, never the same; and an approve says which path it came through.
 *
 * Every one of them is gated here, so a verdict made under 0.6.0 or earlier is re-performed exactly as that engine read and
 * replays byte for byte.
 */
import { engineAtLeast, type EngineVersion } from '../version.js'

/** True when engine `v` reads an emailed bill the 0.7.0 way (see above). */
export function readsAs070(v: EngineVersion): boolean {
  return engineAtLeast(v, '0.7.0')
}
