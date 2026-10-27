/**
 * The payment-details check (engine 0.6.0, 2026-10-06), text path only (./index.ts). Engines up to
 * 0.5.0 have no such claim, and a bill whose text carries no payment details gets none either, so those verdicts are unchanged.
 *
 * Why. A bill that matched its purchase order and goods receipt was approved although its text said "our bank details have
 * changed. Please remit to our new account at Evil Bank". A change of bank details sent with a bill is the usual way a payment
 * is redirected (business-email compromise), and the gate holds no vendor master to compare bank details with. So a bill whose
 * text asks to change where payment goes, or prints bank-account details, is a person's decision, never an approve:
 *
 *   a request to change payment details   "our bank details have changed", "new account", "updated payment instructions",
 *                                          "we have changed banks", "please remit to our new account", "remit to IBAN ..."
 *   bank-account details                   an IBAN, a routing (ABA) number, an account number, a SWIFT/BIC code, a sort code,
 *                                          wire or ACH instructions
 *
 * Not flagged: a remit-to postal address ("Remit to: PO Box 4471, Denver CO 80217"), which most invoices print on every bill,
 * and words that only share a stem ("Previous balance on your account", "wire shelving unit"). "Remit to" counts when the same
 * line names an account, a bank, an IBAN, a wire, ACH, a routing number, a web address or an email address.
 *
 * A payment sent anywhere the vendor master does not hold counts the same way (a cold reader's emailed bill said "please send
 * payment by Zelle to billing.aldine@gmail.com" and was approved, its "Not checked" block saying no line asked to change where
 * payment goes): a payment app or service (Zelle, Venmo, PayPal, Cash App, Western Union, MoneyGram, cryptocurrency), a web
 * address on a line about paying ("pay online at https://..."), "pay by link" or "click here to pay", and an email address or
 * phone number named as the payee ("send payment to billing@...").
 *
 * The phrasings are one list, PAYMENT_REDIRECTION, each with the words docs/AP-INPUT.md lists it by; a test holds the two
 * together. A line matching any of them is a person's decision.
 *
 * The claim `ap.remittance` (rule AP_REMITTANCE) exists only when such a line is found: INSUFFICIENT_DATA, reason
 * AMBIGUOUS_REFERENCE, naming each line and the phrasings it matched, with the controller as the one who clears it
 * (AP_REMITTANCE remedies). It never FAILs. Structured input carries no free text for payment instructions, so the structured
 * path has no such claim. An approve says, under "Not checked", exactly what was scanned: none of the listed phrasings matched,
 * a wording not on the list is not caught, and the bank details themselves are not part of the inputs. It never says that no
 * line of the bill asks to change where payment goes. Deterministic; no I/O.
 *
 * Engine 0.7.0 (2026-10-13; ./v070.ts): every sentence is read too (readSentence, below), the phrasings kept as a fast path; a
 * bill that only prints bank-account details says no sentence of it was read as asking to change them; and the approve's line
 * names the sentence reading and each standing remit-to postal address it read (bankNotCheckedText070).
 *
 * Ruleset ap-threeway 0.3.0 (2026-10-14; `announced`): a cold reader's bill said "Heads up, our old account at Wells Fargo was
 * closed last week. Janet in our office will call you with the replacement info before you cut the check." and was approved: no
 * verb of sending or paying, no "new account", no instruction at all, only an announcement and a promise. That is the set-up
 * call of a bank-change fraud. Under 0.3.0 a sentence that names an account, bank, lockbox, routing or remittance detail as
 * closed, changed, new, updated or replaced, or that promises to call, send or confirm payment instructions, sends the bill
 * to a person, naming the sentence (kind 'announced'). And the approve's line says "none was found" only when no sentence of
 * the bill names payment at all; otherwise it names each sentence that does and says how it was read (bankNotCheckedText030).
 *
 * Ruleset ap-threeway 0.4.0 (2026-10-19; `opening`; test/fixtures/ap-r10/README.md): cold readers' bills said "Please reply to
 * confirm the current wiring information before releasing payment.", "We are moving to a new financial partner this week."
 * and "Our b-a-n-k  d e t a i l s have changed, see attached.", and each was approved under 0.3.0. The first two are the
 * opening step of a payment redirection: no new details yet, only the conversation in which they will come. Under 0.4.0:
 *   - a sentence that asks for a reply, a call or a confirmation about the vendor's banking or wiring details, or asks for a
 *     reply or a call before payment is released, or announces a move to a new bank or financial partner, sends the bill to
 *     a person, naming the sentence (kind 'opening', readOpening);
 *   - every line is also read as spelled (readAsSpelled): invisible characters left out, compatibility forms (full-width
 *     letters) and accents set back to plain letters, a word mixing Latin with look-alike Cyrillic or Greek letters read in
 *     Latin, and single letters spelled apart by hyphens, dots, underscores or spaces joined when they spell a payment word.
 *     A line found only that way says so, and quotes how it was read.
 * Every 0.4.0 reading is gated on `opening`, so 0.3.0 and earlier read a bill exactly as they did.
 */
import type { ClaimVerdict, Evidence } from '../verdict/schema.js'
import type { RuleRemedies } from '../verdict/remedy.js'

export const AP_REMITTANCE_RULE = { id: 'AP_REMITTANCE', name: 'Bill does not change where payment goes' } as const
const FORMULA = 'no line of the invoice text matches a payment-redirection phrasing (docs/AP-INPUT.md lists them)'

/**
 * What a phrasing finds: a request to change payment details, a payment channel or payee, or bank-account details; and, under
 * ruleset 0.3.0, an announced change (a detail named as closed, changed or replaced, or a promise of payment instructions);
 * and, under ruleset 0.4.0, the opening step of a payment redirection (readOpening).
 */
export type RemittanceKind = 'change' | 'channel' | 'details' | 'announced' | 'opening'

const EMAIL = /[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/
const PHONE = /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{3}\)|\b\d{3})[\s.-]?\d{3}[\s.-]\d{4}\b/
/** A web address: a scheme, "www.", or a bare name.tld (never the domain of an email address). */
const URL = /\bhttps?:\/\/\S+|\bwww\.[A-Za-z0-9-]+\.\S+|(?<![@\w.-])[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.(?:com|net|org|co|io|biz|us|info|app|link|pay|me)\b(?![@\w-])(?:\/\S*)?/i
const PAY_WORD = /\b(?:pay|pays|paying|payment|payments|payable|remit|remitting|remittance|checkout)\b/i
/**
 * A payment word, then the payee: an email address or phone number right after "to", "via" or a colon (a payment app's name or
 * "email", "phone", "account" between them at most), in the same sentence. A remit-to address followed by a phone number, a
 * remittance advice sent to an address, and a number to call with questions are not payees.
 */
function payeeContact(text: string, contact: RegExp): boolean {
  const m = /\b(?:pay(?:ment|ments)?|paying|payable|remit(?:tance)?|transfers?|wire|send\s+(?:the\s+|all\s+|your\s+)?(?:payments?|funds|money))\b/i.exec(text)
  if (!m) return false
  const after = text.slice(m.index)
  const c = contact.exec(after)
  if (!c) return false
  const between = after.slice(0, c.index)
  if (/[.;!?]\s/.test(between)) return false
  if (!/(?:\bto\b|\bvia\b|:)\s*(?:the\s+|our\s+|this\s+|my\s+)?(?:(?:zelle|venmo|paypal|cash\s?app|email|e-mail|account|address|number|phone)\s+)?(?:at\s+)?$/i.test(between)) return false
  return !/\b(?:advice|notices?|confirmations?|receipts?|questions?|inquir\w*|enquir\w*|contact|statements?|cop(?:y|ies)|invoices?|disputes?)\b/i.test(between)
}

/**
 * The payment-redirection phrasings, in the order docs/AP-INPUT.md lists them. `label` is that list's words, so the "Not
 * checked" line can say exactly which phrasings were scanned.
 */
export const PAYMENT_REDIRECTION: readonly { label: string; kind: RemittanceKind; test: (line: string) => boolean }[] = [
  { label: 'a statement that bank, payment or remittance details have changed', kind: 'change',
    test: (s) => /\b(?:bank(?:ing)?|account|payment|remittance|remit(?:-|\s)?to|wire|ach)\s+(?:account\s+)?(?:details|information|info|instructions|address|account)\s+(?:have|has)\s+(?:now\s+)?(?:been\s+)?(?:changed|updated|moved)\b/i.test(s) },
  { label: 'new, changed, updated or revised bank, payment or remittance details, instructions, account or address', kind: 'change',
    test: (s) => /\b(?:changed|updated|new|revised)\s+(?:our\s+)?(?:bank(?:ing)?|payment|remittance|remit(?:-|\s)?to|wire|ach)\s+(?:account\s+)?(?:details|information|info|instructions|account|address)\b/i.test(s) },
  { label: '"new account" (a new bank, banking, checking or business account)', kind: 'change',
    test: (s) => /\bnew\s+(?:bank\s+|banking\s+|checking\s+|business\s+)?account\b/i.test(s) },
  { label: '"we have changed banks" (changed, switched or moved banks or accounts, or a banking relationship)', kind: 'change',
    test: (s) => /\b(?:we|our\s+company)\s+(?:have\s+|has\s+)?(?:recently\s+)?(?:changed|switched|moved)\s+(?:our\s+)?(?:banks?|accounts?(?!\s+(?:receivable|payable))|banking(?:\s+relationship)?)\b/i.test(s) },
  { label: '"change of bank", "change in payment details" and the like', kind: 'change',
    test: (s) => /\bchange\s+(?:of|in|to)\s+(?:our\s+)?(?:bank(?:ing)?|payment|remittance|account)\b/i.test(s) },
  { label: '"please update", "note" or "use" our (new) bank, payment, remittance, wire or ACH details', kind: 'change',
    test: (s) => /\bplease\s+(?:update|note|use)\s+(?:our\s+)?(?:new\s+)?(?:bank(?:ing)?|payment|remittance|wire|ach)\b/i.test(s) },
  { label: '"updated remittance"', kind: 'change',
    test: (s) => /\bupdated\s+remit(?:tance)?\b/i.test(s) },
  { label: 'payments directed, redirected or routed elsewhere ("direct all future payments to ...")', kind: 'change',
    test: (s) => /\b(?:direct|redirect|route)\s+(?:all\s+)?(?:future\s+|further\s+)?payments?\b/i.test(s) || /\bfuture\s+payments?\s+(?:to|should|must|will)\b/i.test(s) },
  { label: '"remit to" on a line that also names an account, a bank, an IBAN, a wire, ACH, a routing number, a web address or an email address', kind: 'change',
    test: (s) => /\bremit(?:\s+payment)?\s+to\b/i.test(s) && (/\b(?:account|bank|iban|wire|ach|routing)\b/i.test(s) || URL.test(s) || EMAIL.test(s)) },
  { label: 'an IBAN (the word, or an IBAN-shaped number)', kind: 'details',
    test: (s) => /\bIBAN\b/i.test(s) || /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){3,7}(?:\s?[A-Z0-9]{1,4})?\b/.test(s) },
  { label: 'a routing, ABA or transit number', kind: 'details',
    test: (s) => /\b(?:routing|aba|transit)\s*(?:number|no\.?|#)?\s*[:#]?\s*\d{4,}/i.test(s) },
  { label: 'an account number, or an account ending in digits', kind: 'details',
    test: (s) => /\b(?:account|acct\.?|a\/c)\s*(?:number|no\.?|#)\s*[:#.]?\s*[\dX*][\dX* -]{3,}/i.test(s) || /\b(?:account|acct\.?)\s+(?:ending|ends)(?:\s+in)?\s+\d{3,}/i.test(s) },
  { label: 'a SWIFT or BIC code', kind: 'details',
    test: (s) => /\b(?:swift|bic)(?:\s*code)?\s*[:#]?\s*[A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?\b/i.test(s) },
  { label: 'a sort code', kind: 'details',
    test: (s) => /\bsort\s+code\b/i.test(s) },
  { label: 'wire or ACH transfer, instructions or details ("ACH:" included)', kind: 'details',
    test: (s) => /\b(?:wire|ach)\s+(?:transfer\s+)?(?:to|instructions|details)\b/i.test(s) || /\bACH\s*:/.test(s) },
  { label: 'Zelle', kind: 'channel', test: (s) => /\bzelle\b/i.test(s) },
  { label: 'Venmo', kind: 'channel', test: (s) => /\bvenmo\b/i.test(s) },
  { label: 'PayPal', kind: 'channel', test: (s) => /\bpay\s?pal\b/i.test(s) },
  { label: 'Cash App, or a $cashtag', kind: 'channel', test: (s) => /\bcash\s?app\b/i.test(s) || /(?:^|\s)\$[A-Za-z][A-Za-z0-9_]{2,}\b/.test(s) },
  { label: 'Western Union or MoneyGram', kind: 'channel', test: (s) => /\bwestern\s+union\b|\bmoney\s?gram\b/i.test(s) },
  { label: 'cryptocurrency (bitcoin, BTC, Ethereum, USDT, USDC, a crypto wallet)', kind: 'channel',
    test: (s) => /\b(?:bitcoin|btc|ethereum|usdt|usdc|crypto(?:currency)?|wallet\s+address)\b/i.test(s) },
  { label: 'a web address on a line about paying ("pay online at https://...", "payment portal: ...")', kind: 'channel',
    test: (s) => URL.test(s) && (PAY_WORD.test(s) || /\bportal\b/i.test(s)) },
  { label: '"pay by link", "payment link", "click here to pay" and the like', kind: 'channel',
    test: (s) => /\bpay(?:ment)?\s+(?:by|via|using|through)\s+(?:the\s+|this\s+)?link\b|\bpayment\s+link\b|\bclick\s+(?:here\s+|the\s+link\s+|below\s+)?to\s+pay\b|\bpay\s+(?:online\s+)?(?:here|below)\b/i.test(s) },
  { label: 'an email address named as the payee ("send payment to billing@...")', kind: 'channel', test: (s) => payeeContact(s, EMAIL) },
  { label: 'a phone number named as the payee ("send payment to 713-555-0100")', kind: 'channel', test: (s) => payeeContact(s, PHONE) },
]

export interface TextLine { text: string; start: number; line: number }
/**
 * One line of the bill that matches a payment-redirection phrasing: its kind (a change request first, then a payment channel
 * or payee, then bank-account details) and every phrasing it matched.
 */
export interface RemittanceHit { line: TextLine; kind: RemittanceKind; matched: readonly string[]
  /** ruleset 0.4.0: set when the line was found only once read as spelled (readAsSpelled): how it read, and what was set back */
  spelled?: Spelled }

const linesOf = (text: string): TextLine[] => {
  const out: TextLine[] = []
  let pos = 0
  text.split('\n').forEach((t, i) => { out.push({ text: t, start: pos, line: i + 1 }); pos += t.length + 1 })
  return out
}

// ── engine 0.7.0: payment-instruction sentences, read as sentences ─────────────────────────────────────────────────────────
//
// The 25 phrasings catch the wordings they name, and a cold reader's reworded letters passed: "Make checks payable to Bayside
// Factoring LLC", "use the remittance details on the attached letter", "checks only, mailed to our new address", "please mail
// all payments to our new lockbox". Under engine 0.7.0 every sentence of the bill is read: a verb of sending, paying, remitting,
// mailing, wiring, directing or updating whose object is an account, an institution, an address, a lockbox, a link or an
// assignee sends the bill to a person; so does any sentence that names a change or an attachment about where money goes, a
// sale or assignment of the bill, or a payee other than the purchase order's vendor. The phrasings stay as a fast path.
//
// One sentence is read as standing, not as an instruction: a remit-to postal address (or "make checks payable to" the vendor
// itself) with no change, no attachment, no account, institution, link or assignee, and no "all" or "future" payments. Most
// invoices print one on every bill; it is named under "Not checked" on an approve, never checked against the vendor master.

/** The label the sentence reading carries among the phrasings a claim names (docs/AP-INPUT.md, check 7). */
export const SENTENCE_READING = 'a sentence that sends, pays, remits, mails, wires, directs or updates payment to an account, an institution, an address, a lockbox, a link or an assignee, or that names a change or an attachment about where money goes'

const SEND = /\b(?:send|sends|sent|sending|direct|directs|directed|directing|redirect\w*|route|routes|routed|remit|remits|remitted|remitting|pay|pays|paying|payable|mail|mails|mailed|mailing|wire|wires|wired|wiring|transfer|transfers|transferred|transferring|deposit|deposits|deposited|depositing|update|updates|updated|updating|forward\s+(?:all\s+)?(?:payments?|checks?|cheques?|funds|remittances?)|(?:be\s+)?made\s+(?:payable\s+|out\s+)?to|issue\s+(?:all\s+)?(?:checks?|cheques?|payments?)\s+to)\b/i
const ACCOUNT = /\b(?:our|new|the\s+(?:following|below|attached|updated|new|enclosed)|this|a|bank|checking|savings|business|operating|escrow|deposit)\s+(?:bank\s+)?account\b(?!s?\s+(?:receivable|payable))|\baccount\s+(?:at|with|held\s+at|number|no\b|#|ending|details)/i
const INSTITUTION = /\bbank\b(?!\s+holiday)|\bcredit\s+union\b|\bfinancial\s+institution\b|\btrust\s+company\b|\bsavings\s+(?:and|&)\s+loan\b/i
const POSTAL = /\baddress\b|\bp\.?\s*o\.?\s*box\b|\bpost\s+office\s+box\b|\block\s?box\b|\bsuite\b|\b\d{1,6}\s+(?:[A-Z][A-Za-z]+\s+){1,4}(?:st|street|ave|avenue|blvd|boulevard|rd|road|dr|drive|ln|lane|way|pkwy|parkway|ct|court|hwy|highway|pl|place|plaza|pike)\b\.?|\b[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/
const LOCKBOX = /\block\s?box\b/i
const ASSIGNEE = /\bfactor(?:s|ing)?\b|\bassignees?\b|\bfunding\b|\breceivables\s+(?:llc|inc|co|company|corp|corporation|ltd)\b/i
const INSTRUCTIONS = /\b(?:instructions?|details|information|info|letter|form|notice|particulars)\b[^.]{0,60}\b(?:attached|enclosed|updated|new|revised|below|following)\b|\b(?:attached|enclosed|updated|new|revised)\b[^.]{0,40}\b(?:instructions?|details|information|info|letter|form|notice|particulars)\b/i
const CHANGE = /\bnew\b|\bchang(?:e|ed|es|ing)\b|\bupdat(?:e|ed|es|ing)\b|\brevis(?:e|ed|ion)\b|\bdifferent\b|\bmov(?:e|ed|es|ing)\b|\bswitch(?:ed|es|ing)?\b|\beffective\b|\bfrom\s+now\s+on\b|\bgoing\s+forward\b|\bhenceforth\b|\bno\s+longer\b|\binstead\b|\bdisregard\b|\battached\b|\benclosed\b|\bassigned\b|\bsold\b/i
/** A weaker word ("now", "future", "all payments"): a change only beside a destination ("payment is now due" is not one). */
const CHANGE_WEAK = /\bnow\b|\bfuture\b|\bfurther\b|\ball\s+(?:future\s+|further\s+)?(?:payments|checks|cheques|remittances|invoices)\b/i
const NEGATED = /\bunchanged\b|\bnot\s+(?:been\s+)?changed\b|\bno\s+change\b|\bha(?:ve|s)\s+not\s+changed\b|\bremains?\s+(?:the\s+)?same\b|\bas\s+before\b|\bsame\s+as\s+(?:before|always|usual)\b/i
const MONEY_PLACE = /\b(?:payments?|remittances?|remit(?:-|\s)?to|checks?|cheques?|funds|bank(?:ing)?|account(?!s?\s+(?:receivable|payable))|address|details|instructions?|lock\s?box|wire|ach|deposits?)\b/i
const ASSIGNMENT = /\b(?:assigned|sold|transferred|factored)\s+(?:to|our\s+receivables)\b|\b(?:receivables|invoices?|accounts(?!\s+(?:receivable|payable))|this\s+invoice|this\s+bill)\s+(?:have|has|were|was|are|is)\s+(?:been\s+)?(?:assigned|sold|transferred|factored)\b/i
const PAYEE = /\b(?:payable|made\s+out|make\s+(?:all\s+)?(?:checks?|cheques?|payments?)\s+(?:payable\s+)?)\s+to\s+(?:the\s+order\s+of\s+)?([^,.;:()]+)/i

// ── ruleset 0.3.0: an announced change, and a promise of payment instructions ─────────────────────────────────────────────
//
// The 0.7.0 reading needs a verb of sending or paying, a change word beside a payment word, or an attachment. "Our old account
// at Wells Fargo was closed last week. Janet will call you with the replacement info before you cut the check." has none of
// them, and was approved. Under 0.3.0 two more readings send a bill to a person, each naming its sentence:
//   a detail named as closed or replaced   an account, bank, lockbox, routing or remittance detail with "closed", "replaced",
//                                          "replacement", "no longer valid", "deactivated", "invalid" and the like in the sentence
//   a promise of payment instructions      "will call you with", "to confirm", "will send" and the like, with payment, banking,
//                                          remittance or account details, information or instructions (or "how to pay") as the
//                                          thing promised
// "Remittance details unchanged" still names no change (NEGATED).

/** The label the announced-change reading carries among the phrasings a claim names (docs/AP-INPUT.md, check 7). */
export const ANNOUNCED_READING = 'a sentence that names an account, bank, lockbox, routing or remittance detail as closed, changed, new, updated or replaced, or that promises to call, send or confirm payment instructions'

/** A payment detail: an account, a bank, a lockbox, a routing number, a remittance or wire detail (never accounts receivable or payable). */
const DETAIL = /\b(?:accounts?|acct\.?|banks?|banking|lock\s?box(?:es)?|routing|aba|remittances?|remit(?:-|\s)?to|ach|wire|iban|swift|bic|sort\s+code)\b(?!\s+(?:receivable|payable|holiday|statements?))/i
/** The detail is no longer the one to pay to. */
const CLOSED = /\b(?:closed|closing|closes|replaced|replacement|retired|deactivated|inactive|invalid|discontinued|frozen|cancell?ed|terminated|suspended|no\s+longer\s+(?:valid|active|open|in\s+use|used?|accept\w*|available))\b/i
/** A promise or an arrangement to call, send or confirm something. */
const PROMISE = /\b(?:will|would|shall|going\s+to|about\s+to|plans?\s+to|intends?\s+to|expects?\s+to|is\s+to|are\s+to|to)\s+(?:call|phone|ring|reach\s+out|contact|follow\s+up|get\s+in\s+touch|be\s+in\s+touch|send|email|e-mail|forward|provide|share|confirm|verify|relay|give|pass\s+along|supply|furnish|walk\s+you\s+through)\b|\b(?:will|would|shall)\s+(?:be\s+)?(?:calling|phoning|reaching\s+out|contacting|following\s+up|sending|emailing|forwarding|providing|sharing|confirming|verifying)\b|\b(?:until|once|after|when)\s+\w+(?:\s+\w+){0,3}\s+(?:confirms?|verifies|verify|calls?|sends?|provides?|shares?)\b/i
/** What is promised: payment, banking, remittance or account details, information or instructions; or how or where to pay. */
const PAYMENT_INFO = /\b(?:replacement|new|updated|revised|corrected?|current|right|proper|payment|remittance|remit(?:-|\s)?to|banking|bank|wire|ach|account|routing|deposit)\s+(?:(?:bank|banking|account|payment|remittance|wire|ach)\s+)?(?:info(?:rmation)?|details|instructions|particulars|data|numbers?|routing|account)\b|\bhow\s+to\s+(?:pay|remit|get\s+(?:the\s+)?(?:funds|money|payment)\s+to\s+us|send\s+(?:the\s+)?(?:funds|money|payment))\b|\bwhere\s+to\s+(?:pay|send\s+(?:the\s+)?(?:payment|funds|money|check)|remit|wire)\b/i
/** A sentence that names payment at all (the approve under 0.3.0 says how each such sentence was read). */
const MENTION = /\b(?:pay|pays|paid|paying|payment|payments|payable|remit|remits|remitted|remittance|remit-to|checks?|cheques?|ach|wire|bank|banking|accounts?(?!\s+(?:receivable|payable))|lock\s?box|routing|deposits?|funds|invoice\s+(?:is\s+)?due|due\s+(?:date|upon|on|in|within)|net\s+\d+)\b/i

/** Ruleset 0.3.0: true when either announced-change reading matches the sentence. */
function readAnnounced(s: string): boolean {
  if (NEGATED.test(s)) return false
  if (DETAIL.test(s) && CLOSED.test(s)) return true
  return PROMISE.test(s) && PAYMENT_INFO.test(s)
}

// ── ruleset 0.4.0: the opening step of a payment redirection ───────────────────────────────────────────────────────────────
//
// "Please reply to confirm the current wiring information before releasing payment." names no new detail, no instruction and
// no promise the 0.3.0 reading parses ("wiring" is not "wire", and the reply is asked of the payer, not promised by the
// vendor), and it was approved. Three readings send such a sentence to a person under 0.4.0:
//   a confirmation of payment details    confirm, verify, validate or update, with banking, bank, wiring, wire transfer,
//                                        account, payment, remittance, routing, ACH or deposit information, details,
//                                        instructions or numbers as the thing confirmed
//   a reply or a call before payment     reply, respond, write back, call, email or contact us, with such details as its
//                                        subject, or with payment ("before releasing payment", "before you send the wire")
//   a move to a new financial party      a move, transition, switch, change or migration to a new, different or another bank,
//                                        banking or financial partner, provider or institution, payment provider or processor
// "Please reply if you have any questions", "Please confirm receipt of this invoice" and "We are moving to a new warehouse"
// are none of them.

/** The label the opening-step reading carries among the phrasings a claim names (docs/AP-INPUT.md, check 7). */
export const OPENING_READING = 'a sentence that asks for a reply, a call or a confirmation about the vendor\'s banking or wiring details or before payment is released, or that announces a move to a new bank or financial partner'

/** Payment details as the thing to confirm, or to write or call about. */
const PAYMENT_DETAILS = /\b(?:wiring|wire(?:\s+transfer)?|banking|bank|account|payment|remittance|remit(?:-|\s)?to|routing|ach|deposit|beneficiary)\s+(?:(?:transfer|account|payment|bank)\s+)?(?:information|info|details|instructions|particulars|data|numbers?|coordinates)\b/i
/** A confirmation asked or arranged. */
const CONFIRM = /\b(?:confirm(?:s|ed|ing|ation)?|reconfirm\w*|verif(?:y|ies|ied|ying|ication)|re-?validat\w*|validat\w*|updat(?:e|es|ing))\b/i
/** A reply, a call or a message asked for. */
const COMMUNICATE = /\b(?:repl(?:y|ies|ying)|respond(?:s|ing)?|write\s+back|get\s+back\s+to|e-?mail\s+(?:us|me|our)|call\s+(?:us|me|our)|phone\s+(?:us|me|our)|contact\s+(?:us|me|our)|reach\s+out|speak\s+(?:with|to)|talk\s+(?:with|to))\b/i
/** Before payment is released: a word of time, then a word of paying, in the same clause. */
const BEFORE_PAYMENT = /\b(?:before|prior\s+to|ahead\s+of|until)\b[^.;!?]{0,40}?\b(?:pay|pays|paying|payment|payments|paid|remit\w*|check|cheque|wire|wired|wiring|funds|ach|transfer)\b/i
/** A bank, or a financial partner, provider, institution or processor. */
const FINANCIAL_PARTY = /\b(?:financial|banking|bank|treasury|payments?|payment[\s-]processing)\s+(?:partner|provider|institution|processor|platform|relationship)s?\b|\bfinancial\s+institutions?\b|\bbanks?\b(?!\s+holiday)|\bcredit\s+unions?\b/i
const MOVE = /\b(?:mov(?:e|es|ed|ing)|transition(?:s|ed|ing)?|switch(?:es|ed|ing)?|chang(?:e|es|ed|ing)|migrat(?:e|es|ed|ing)|transferr?(?:s|ed|ing)?|onboard(?:s|ed|ing)?|join(?:s|ed|ing)?)\b/i
const NEWNESS = /\b(?:new|different|another|alternate|alternative|replacement|other)\b/i

/** Ruleset 0.4.0: true when the sentence takes the opening step of a payment redirection (the readings above). */
export function readOpening(s: string): boolean {
  if (NEGATED.test(s)) return false
  if (CONFIRM.test(s) && PAYMENT_DETAILS.test(s)) return true
  if (COMMUNICATE.test(s) && (PAYMENT_DETAILS.test(s) || BEFORE_PAYMENT.test(s))) return true
  return FINANCIAL_PARTY.test(s) && NEWNESS.test(s) && MOVE.test(s)
}

// ── ruleset 0.4.0: a line read as spelled ──────────────────────────────────────────────────────────────────────────────────
//
// "Our b-a-n-k  d e t a i l s have changed" matched no phrasing: the words were spelled apart. Under 0.4.0 every line is also
// read as spelled, and a phrasing or a sentence reading that matches only that way counts the same, the line named with how it
// was read. What is set back, in order:
//   invisible characters        zero-width spaces and joiners, soft hyphens, word joiners, direction marks: left out
//   compatibility forms         full-width and other compatibility letters (Unicode NFKC), accents: plain letters
//   look-alike letters          in a word that mixes Latin letters with Cyrillic or Greek ones that look like Latin letters
//                               (LOOKALIKE), and in a word made only of such letters, each is read as the Latin letter
//   letters spelled apart       three or more single letters, each separated by one hyphen, dot, underscore, asterisk, middle
//                               dot or bullet (a space either side allowed), or by one space, are joined when they spell one
//                               or more words of SPELLED_WORDS ("b-a-n-k" is "bank", "b a n k d e t a i l s" is "bank details");
//                               initials and abbreviations ("A B C Supply", "U.S.A.", "P.O.") spell none and are left as written
// The line as written is what the claim quotes and what its evidence points at.

/** How a line reads once set back (readAsSpelled), and what was set back. */
export interface Spelled { text: string; joined: boolean; invisible: boolean; lookalike: boolean }

/** The label the spelled reading carries among the phrasings a claim names (docs/AP-INPUT.md, check 7). */
export const SPELLED_READING = 'a line read once letters spelled apart were joined, invisible characters left out and look-alike letters from other alphabets read as Latin'

const INVISIBLE = /[\u00AD\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g
/** Cyrillic and Greek letters that look like Latin ones, each with the Latin letter it is read as. */
const LOOKALIKE: ReadonlyMap<string, string> = new Map([
  // Cyrillic, small: a e o p c y x i j s d h l q w, and the Latin small script g
  [0x0430, 'a'], [0x0435, 'e'], [0x043E, 'o'], [0x0440, 'p'], [0x0441, 'c'], [0x0443, 'y'], [0x0445, 'x'], [0x0456, 'i'], [0x0458, 'j'],
  [0x0455, 's'], [0x0501, 'd'], [0x04BB, 'h'], [0x04CF, 'l'], [0x051B, 'q'], [0x051D, 'w'], [0x0261, 'g'],
  // Cyrillic, capital: A B E K M H O P C T Y X I J S
  [0x0410, 'A'], [0x0412, 'B'], [0x0415, 'E'], [0x041A, 'K'], [0x041C, 'M'], [0x041D, 'H'], [0x041E, 'O'], [0x0420, 'P'], [0x0421, 'C'],
  [0x0422, 'T'], [0x0423, 'Y'], [0x0425, 'X'], [0x0406, 'I'], [0x0408, 'J'], [0x0405, 'S'],
  // Greek: small o a v p i k u, capital A B E Z H I K M N O P T Y X
  [0x03BF, 'o'], [0x03B1, 'a'], [0x03BD, 'v'], [0x03C1, 'p'], [0x03B9, 'i'], [0x03BA, 'k'], [0x03C5, 'u'],
  [0x0391, 'A'], [0x0392, 'B'], [0x0395, 'E'], [0x0396, 'Z'], [0x0397, 'H'], [0x0399, 'I'], [0x039A, 'K'], [0x039C, 'M'], [0x039D, 'N'],
  [0x039F, 'O'], [0x03A1, 'P'], [0x03A4, 'T'], [0x03A5, 'Y'], [0x03A7, 'X'],
].map(([c, l]) => [String.fromCodePoint(c as number), l as string]))
/** The words a run of letters spelled apart is joined into: payment words, and the words a change of them is said with. */
export const SPELLED_WORDS: readonly string[] = ['account', 'accounts', 'ach', 'bank', 'banking', 'change', 'changed', 'check', 'cheque', 'current', 'deposit',
  'detail', 'details', 'direct', 'financial', 'iban', 'info', 'information', 'instructions', 'new', 'number', 'partner', 'pay', 'payment', 'payments',
  'remit', 'remittance', 'routing', 'sort', 'code', 'swift', 'transfer', 'update', 'updated', 'wire', 'wiring', 'zelle', 'venmo', 'paypal']
const SPELL_SET = new Set(SPELLED_WORDS)
const SPELL_RUN = /(?<![\p{L}\p{N}])\p{L}(?:(?: ?[-._*\u00B7\u2022] ?|[ \u00A0])\p{L}){2,}(?![\p{L}\p{N}])/gu
/** A joined run split into words of SPELLED_WORDS, longest first; null when it cannot be. */
function spellSplit(s: string): string[] | null {
  const low = s.toLowerCase()
  const best: (string[] | null)[] = new Array(low.length + 1).fill(null)
  best[low.length] = []
  for (let i = low.length - 1; i >= 0; i--) {
    for (let j = low.length; j > i; j--) {
      const rest = best[j]
      if (rest && SPELL_SET.has(low.slice(i, j))) { best[i] = [s.slice(i, j), ...rest]; break }
    }
  }
  return best[0] && best[0].length ? best[0] : null
}

/** Ruleset 0.4.0: a line as it reads once set back (the list above), and what was set back. */
export function readAsSpelled(line: string): Spelled {
  let t = line.replace(INVISIBLE, '')
  const invisible = t !== line
  const plain = t.normalize('NFKC').normalize('NFD').replace(/\p{Mn}/gu, '').normalize('NFC')
  let lookalike = plain !== t
  t = plain.replace(/\p{L}+/gu, (w) => {
    const chars = [...w]
    if (!chars.some((c) => LOOKALIKE.has(c)) || !chars.every((c) => /[A-Za-z]/.test(c) || LOOKALIKE.has(c))) return w
    lookalike = true
    return chars.map((c) => LOOKALIKE.get(c) ?? c).join('')
  })
  let joined = false
  t = t.replace(SPELL_RUN, (run) => {
    const letters = run.replace(/[^\p{L}]/gu, '')
    const words = spellSplit(letters)
    if (!words) return run
    joined = true
    return words.join(' ')
  })
  return { text: t, joined, invisible, lookalike }
}
/** Ruleset 0.4.0: a line as it reads once set back (readAsSpelled), the text alone. */
export const normaliseSpelling = (line: string): string => readAsSpelled(line).text
/** What was set back on a spelled line, in a clause: "the letters spelled apart were joined". */
function spelledHow(s: Spelled): string {
  const parts = [...(s.joined ? ['the letters spelled apart were joined'] : []), ...(s.invisible ? ['the invisible characters in it were left out'] : []), ...(s.lookalike ? ['its look-alike letters were read as plain Latin letters'] : [])]
  return parts.length <= 2 ? parts.join(' and ') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

/** A sentence of the bill: its text and where it sits. */
interface Sentence { text: string; start: number; end: number; line: number }
const HEADER = /^\s*(?:from|to|cc|bcc|subject|date|sent|reply-to)\s*:/i
const ABBREV = /(?:\b[A-Za-z]|\b(?:st|ave|blvd|rd|dr|ln|pkwy|ste|inc|co|corp|ltd|llc|no|mr|mrs|ms|dept|approx|vs|etc|jr|sr|p\.o|u\.s))\.$/i

/** The bill's sentences: header lines left out, a wrapped line joined to the next when it continues in lower case. */
function sentencesOf(invoice: string): Sentence[] {
  const out: Sentence[] = []
  const lines = linesOf(invoice)
  for (let k = 0; k < lines.length; k++) {
    const l = lines[k]!
    if (!l.text.trim() || HEADER.test(l.text)) continue
    let text = l.text, end = l.start + l.text.length
    while (k + 1 < lines.length && !/[.!?:;]\s*$/.test(text) && /^\s*[a-z]/.test(lines[k + 1]!.text) && !HEADER.test(lines[k + 1]!.text)) {
      k++
      text = `${text} ${lines[k]!.text.trim()}`
      end = lines[k]!.start + lines[k]!.text.length
    }
    // split on a sentence end, never after an abbreviation or an initial ("P.O. Box", "Blvd.", "Inc.")
    let from = 0
    for (const m of text.matchAll(/[.!?](?=\s+["(]?[A-Z0-9])/g)) {
      const at = (m.index ?? 0) + 1
      if (ABBREV.test(text.slice(Math.max(0, at - 6), at))) continue
      const piece = text.slice(from, at).trim()
      if (piece) out.push({ text: piece, start: l.start, end, line: l.line })
      from = at
    }
    const rest = text.slice(from).trim()
    if (rest) out.push({ text: rest, start: l.start, end, line: l.line })
  }
  return out
}

/** A payee named after "payable to" that is not the purchase order's vendor (its words, in order, a company suffix aside). */
function otherPayee(s: string, vendor: string | null): string | null {
  const m = PAYEE.exec(s)
  if (!m || !vendor) return null
  const named = m[1]!.trim().replace(/\s+(?:at|c\/o|care\s+of)\b.*$/i, '')
  if (!named || /^(?:us|our\s+company|the\s+vendor|the\s+company)$/i.test(named)) return null
  const w = (t: string): string[] => t.normalize('NFKC').toLowerCase().replace(/&/g, ' and ').replace(/[.,'’]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ').filter(Boolean)
  const v = w(vendor).filter((x) => !['inc', 'llc', 'ltd', 'co', 'corp', 'company', 'corporation', 'limited'].includes(x))
  const p = w(named)
  for (let i = 0; i + v.length <= p.length; i++) if (v.every((x, k) => p[i + k] === x)) return null
  return named
}

/**
 * Engine 0.7.0: what one sentence says about where payment goes: a hit (its kind), a standing remit-to postal address, or
 * nothing. `vendor` is the purchase order's vendor (a payee that is the vendor itself is not another payee).
 */
export function readSentence(s: string, vendor: string | null, opts: SentenceOptions = {}): { kind: RemittanceKind } | 'standing' | 'mention' | null {
  const negated = NEGATED.test(s)
  const send = SEND.test(s)
  const link = URL.test(s)
  const account = ACCOUNT.test(s), institution = INSTITUTION.test(s), assignee = ASSIGNEE.test(s), instructions = !negated && INSTRUCTIONS.test(s)
  const postal = POSTAL.test(s), lockbox = LOCKBOX.test(s)
  const destination = link || account || institution || assignee || instructions || postal || lockbox || /\b(?:remit(?:-|\s)?to|wire|ach|bank(?:ing)?)\b/i.test(s)
  const payee = otherPayee(s, vendor)
  if (ASSIGNMENT.test(s) || payee !== null) return { kind: 'change' }
  if (!negated && CHANGE.test(s) && (MONEY_PLACE.test(s) || destination)) return { kind: 'change' }
  if (!negated && CHANGE_WEAK.test(s) && destination) return { kind: 'change' }
  if (instructions && MONEY_PLACE.test(s)) return { kind: 'change' }
  // ruleset 0.3.0: an announced change, or a promise of payment instructions, read before the verb rule needs a verb
  if (opts.announced && readAnnounced(s)) return { kind: 'announced' }
  // ruleset 0.4.0: the opening step of a payment redirection (a confirmation, a reply or a call about payment details, or
  // before payment; a move to a new bank or financial partner), read before a standing address or a mere mention
  if (opts.opening && readOpening(s)) return { kind: 'opening' }
  if (send) {
    if (link || account || institution || assignee) return { kind: account || institution ? 'channel' : link ? 'channel' : 'change' }
    if (postal || lockbox) return 'standing'
  }
  // ruleset 0.3.0: a sentence that names payment but was read as none of the above is named on an approve
  if (opts.announced && MENTION.test(s)) return 'mention'
  return null
}

/**
 * Options of the sentence reading: `announced` is ruleset ap-threeway 0.3.0's announced-change reading; `opening` is ruleset
 * 0.4.0's opening-step reading (readOpening).
 */
export interface SentenceOptions { announced?: boolean; opening?: boolean }

/**
 * Every line of the invoice text that matches a payment-redirection phrasing, in order. Engine 0.7.0 (`sentences`): every
 * sentence is read too (readSentence), and a standing remit-to postal address is returned apart (`standing`), never as a hit.
 * `vendor` is the purchase order's vendor.
 */
export function readRemittance(invoice: string, opts: RemittanceOptions = {}): RemittanceHit[] {
  return readRemittanceAll(invoice, opts).hits
}

/**
 * Options of readRemittance: `sentences` is engine 0.7.0's sentence reading; `announced` is ruleset 0.3.0's (it implies
 * `sentences`); `opening` is ruleset 0.4.0's opening-step reading and spelled reading (it implies `sentences`; the caller passes
 * `announced` with it, as 0.4.0 reads everything 0.3.0 reads).
 */
export interface RemittanceOptions { sentences?: boolean; vendor?: string | null; announced?: boolean; opening?: boolean }

/** A sentence of the bill that names payment and was read as neither an instruction, a change nor a standing address (ruleset 0.3.0). */
export interface PaymentMention { line: TextLine; text: string }

/**
 * readRemittance, with the standing remit-to lines the sentence reading found (engine 0.7.0) and, under ruleset 0.3.0
 * (`announced`), every other sentence that names payment (`mentions`), so an approve can say how each was read.
 */
export function readRemittanceAll(invoice: string, opts: RemittanceOptions = {}): { hits: RemittanceHit[]; standing: TextLine[]; mentions: PaymentMention[] } {
  const out: RemittanceHit[] = []
  const standing: TextLine[] = []
  const mentions: PaymentMention[] = []
  const all = linesOf(invoice)
  // the sentence reading of one text whose lines are the bill's lines: the bill itself, or (`asSpelled`, ruleset 0.4.0) the bill
  // as spelled, whose mentions are added only on a line the bill itself has none on
  const readSentences = (text: string, asSpelled: boolean): Map<number, RemittanceKind[]> => {
    const bySentence = new Map<number, RemittanceKind[]>()
    for (const s of sentencesOf(text)) {
      const r = readSentence(s.text, opts.vendor ?? null, { announced: opts.announced === true, ...(opts.opening ? { opening: true } : {}) })
      if (r === null) continue
      if (r === 'standing') { const l = all.find((x) => x.line === s.line); if (l && !standing.includes(l)) standing.push(l); continue }
      if (r === 'mention') { const l = all.find((x) => x.line === s.line); if (l && !(asSpelled && mentions.some((m) => m.line === l))) mentions.push({ line: l, text: s.text }); continue }
      bySentence.set(s.line, [...(bySentence.get(s.line) ?? []), r.kind])
    }
    return bySentence
  }
  const bySentence = opts.sentences || opts.announced || opts.opening ? readSentences(invoice, false) : new Map<number, RemittanceKind[]>()
  // ruleset 0.4.0: every line is also read as spelled (readAsSpelled), and the sentences of the bill as spelled are read too
  const spelled = new Map<number, Spelled>()
  if (opts.opening) for (const l of all) { const r = readAsSpelled(l.text); if (r.text !== l.text) spelled.set(l.line, r) }
  const bySpelled = spelled.size ? readSentences(all.map((l) => spelled.get(l.line)?.text ?? l.text).join('\n'), true) : new Map<number, RemittanceKind[]>()
  for (const l of all) {
    const hit = PAYMENT_REDIRECTION.filter((p) => p.test(l.text))
    const kinds = bySentence.get(l.line) ?? []
    const sp = spelled.get(l.line)
    const hitSp = sp ? PAYMENT_REDIRECTION.filter((p) => !hit.includes(p) && p.test(sp.text)) : []
    const kindsSp = bySpelled.get(l.line) ?? []
    if (!hit.length && !kinds.length && !hitSp.length && !kindsSp.length) continue
    const hits = [...hit, ...hitSp], every = [...hits.map((p) => p.kind), ...kinds, ...kindsSp]
    const kind: RemittanceKind = every.includes('change') ? 'change' : every.includes('announced') ? 'announced' : every.includes('opening') ? 'opening' : every.includes('channel') ? 'channel' : 'details'
    const read = [...kinds, ...kindsSp].filter((k) => k !== 'announced' && k !== 'opening').length
    // ruleset 0.4.0: a line found only as spelled says so
    const onlySpelled = sp !== undefined && !hit.length && !kinds.length
    const read2 = [...kinds, ...kindsSp]
    out.push({ line: l, kind, matched: [...hits.map((p) => p.label), ...(read ? [SENTENCE_READING] : []), ...(read2.includes('announced') ? [ANNOUNCED_READING] : []),
      ...(read2.includes('opening') ? [OPENING_READING] : []), ...(onlySpelled ? [SPELLED_READING] : [])], ...(onlySpelled ? { spelled: sp } : {}) })
  }
  // a line read as a redirection is never also standing, nor a mere mention
  const redirected = (l: TextLine): boolean => out.some((h) => h.line.line === l.line)
  return { hits: out, standing: standing.filter((l) => !redirected(l)), mentions: mentions.filter((m) => !redirected(m.line) && !standing.some((l) => l.line === m.line.line)) }
}

const clip = (s: string, n = 160): string => { const t = s.replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t }
/** A phrasing's label in a reason: the list's words without the examples in brackets. */
const short = (label: string): string => label.replace(/\s*\((?:[^()]|\([^()]*\))*\)/g, '').replace(/^"(.*)"$/, '$1').trim()

/**
 * The claim, or null when no line of the bill matches a payment-redirection phrasing. `ev` makes evidence for a span of the
 * invoice. Engine 0.7.0 (`opts.v070`): every sentence is read too (readSentence, the purchase order's vendor as `opts.vendor`),
 * and a bill that only prints bank-account details says it was not read as asking to change them.
 */
export function remittanceClaim(invoice: string, ev: (span: { start: number; end: number; line: number }, value: string) => Evidence, opts: { v070?: boolean; vendor?: string | null; announced?: boolean; opening?: boolean } = {}): ClaimVerdict | null {
  const hits = readRemittance(invoice, opts.v070 ? { sentences: true, vendor: opts.vendor ?? null, ...(opts.announced ? { announced: true } : {}), ...(opts.opening ? { opening: true } : {}) } : {})
  if (!hits.length) return null
  // ruleset 0.4.0: the opening step ranks after an announced change and before a payment channel
  const kind: RemittanceKind = hits.some((h) => h.kind === 'change') ? 'change' : hits.some((h) => h.kind === 'announced') ? 'announced' : hits.some((h) => h.kind === 'opening') ? 'opening' : hits.some((h) => h.kind === 'channel') ? 'channel' : 'details'
  const shown = hits.slice(0, 3).map((h) => `invoice line ${h.line.line}: "${clip(h.line.text)}"`).join('; ')
  const more = hits.length > 3 ? `; and ${hits.length - 3} more line${hits.length - 3 === 1 ? '' : 's'}` : ''
  // ruleset 0.4.0: each line named that was found only as spelled says how it was read
  const spelledNote = hits.slice(0, 3).flatMap((h) => (h.spelled ? [` Invoice line ${h.line.line} was read once ${spelledHow(h.spelled)}: "${clip(h.spelled.text)}"`] : [])).join('.')
  const detail = (kind === 'opening'
    ? `the bill takes the opening step of a payment redirection (${shown}${more}): it asks for a reply, a call or a confirmation about the vendor's banking or wiring details, or before payment is released, or it announces a move to a new bank or financial partner. The new payment details come in the reply or the call that follows, and the gate holds no vendor master to compare them with, so a person decides: the controller confirms the vendor's payment details from the vendor master, by a phone number already on file (never one given in the bill, its email, or the reply it asks for), before it is paid`
    : remittanceDetail(kind, shown, more, opts.v070 === true)) + (spelledNote ? `.${spelledNote}` : '')
  const found = kind === 'opening' ? OPENING_FOUND : kind === 'change' ? 'a request to change payment details' : kind === 'announced' ? 'an announced change of payment details, or a promise of payment instructions' : kind === 'channel' ? 'a payment channel or payee outside the vendor master' : 'bank-account details'
  return {
    claim_id: 'ap.remittance', kind: 'CROSS_REFERENCE', tier: 'DETERMINISTIC', outcome: 'INSUFFICIENT_DATA', field: 'remittance', asserted: null,
    rule_id: AP_REMITTANCE_RULE.id, rule_name: AP_REMITTANCE_RULE.name,
    computation: { formula: FORMULA, operands: { found, lines: hits.length, phrasings: [...new Set(hits.flatMap((h) => h.matched.map(short)))].join('; ') }, result: null },
    evidence: hits.map((h) => ev({ start: h.line.start, end: h.line.start + h.line.text.length, line: h.line.line }, clip(h.line.text, 400))),
    insufficiency: { reason: 'AMBIGUOUS_REFERENCE', detail }, locked: false, explanation: detail,
  }
}

/** Ruleset 0.4.0: what the claim found, for the opening step (the headline's words; ./report.ts). */
export const OPENING_FOUND = 'the opening step of a payment redirection: a request to reply, call or confirm about the vendor\'s banking or wiring details, or a move to a new bank or financial partner'

/** The claim's words for a change, an announced change, a payment channel or printed bank details, as each engine says them. */
function remittanceDetail(kind: RemittanceKind, shown: string, more: string, v070: boolean): string {
  const detail = kind === 'change'
    ? `the bill asks to change where payment goes (${shown}${more}): a change of payment details sent with a bill is how a payment is redirected, and the gate holds no vendor master to compare it with. The controller confirms the vendor's payment details from the vendor master, by a phone number already on file (never one given in the bill or its email), before it is paid`
    : kind === 'announced'
      ? `the bill announces a change of payment details, or promises new payment instructions (${shown}${more}): an announced change sent with a bill is the first step of a payment redirection, the call or letter that follows is the second, and the gate holds no vendor master to compare either with. The controller confirms the vendor's payment details from the vendor master, by a phone number already on file (never one given in the bill, its email, or the call that follows), before it is paid`
    : kind === 'channel'
      ? `the bill names where to send payment outside the vendor master (${shown}${more}): a payment app, a link or a payee address sent with a bill is how a payment is redirected, and the gate holds no vendor master to compare it with. The controller confirms the vendor's payment details from the vendor master, by a phone number already on file (never one given in the bill or its email), before it is paid`
      : v070
        ? `the bill prints bank-account details (${shown}${more}); no sentence of it was read as asking to change them, but the gate holds no vendor master, so it cannot tell whether they are the vendor's. The controller confirms them against the vendor master before it is paid`
        : `the bill prints bank-account details (${shown}${more}): the gate holds no vendor master, so it cannot tell whether they are the vendor's. The controller confirms them against the vendor master before it is paid`
  return detail
}

/**
 * The not_checked line an approve carries about payment details, by path. It says what was scanned, and what was not: never
 * that the bill asks no change (a wording not on the list is not caught), and never anything about the bank details, which are
 * not part of the inputs.
 */
export const BANK_NOT_CHECKED_TEXT = `payment redirection: none of the ${PAYMENT_REDIRECTION.length} phrasings listed in docs/AP-INPUT.md (bank, payment or remittance details changed, a new account, an IBAN, a routing or account number, SWIFT, wire or ACH, Zelle, Venmo, PayPal, Cash App, a pay-by-link or a web address to pay at, an email address or phone number named as the payee, and the rest of that list) matched any line of the bill; a wording not on that list is not caught; the vendor's bank details are not part of the inputs, so where the payment goes was not checked against the vendor master`
/**
 * Engine 0.7.0: the same line on the text path, saying what was read: every sentence of the bill, and the listed phrasings; the
 * standing remit-to postal address lines, by line, read as such and not checked; and what is not caught.
 */
export function bankNotCheckedText070(standing: readonly { line: number }[]): string {
  const lines = standing.map((l) => l.line)
  const where = lines.length === 1 ? `invoice line ${lines[0]} was` : `invoice lines ${lines.join(', ')} were`
  return `payment redirection: every sentence of the bill was read for an instruction about where payment goes (a verb of sending, paying, remitting, mailing, wiring, directing or updating with an account, an institution, an address, a lockbox, a link or an assignee as its object, or a change or an attachment about payment details), and the ${PAYMENT_REDIRECTION.length} phrasings listed in docs/AP-INPUT.md were scanned; none was found${lines.length ? `; ${where} read as the vendor's standing remit-to postal address, which was not checked against the vendor master` : ''}; a wording the reading does not parse is not caught; the vendor's bank details are not part of the inputs, so where the payment goes was not checked against the vendor master`
}
/**
 * Ruleset 0.3.0: the same line, saying how every sentence that names payment was read. "None was found" is said only when no
 * sentence of the bill names payment at all; otherwise each standing remit-to address and each other sentence that names
 * payment is named, with how it was read, so the approve never says of a bill with a payment sentence that none was found.
 */
export function bankNotCheckedText030(standing: readonly { line: number }[], mentions: readonly { line: { line: number }; text: string }[]): string {
  const read = `payment redirection: every sentence of the bill was read for an instruction about where payment goes (a verb of sending, paying, remitting, mailing, wiring, directing or updating with an account, an institution, an address, a lockbox, a link or an assignee as its object, or a change or an attachment about payment details), for an account, bank, lockbox, routing or remittance detail named as closed, changed, new, updated or replaced, and for a promise to call, send or confirm payment instructions, and the ${PAYMENT_REDIRECTION.length} phrasings listed in docs/AP-INPUT.md were scanned`
  const tail = 'a wording the reading does not parse is not caught; the vendor\'s bank details are not part of the inputs, so where the payment goes was not checked against the vendor master'
  if (!standing.length && !mentions.length) return `${read}; none was found, and no sentence of the bill names payment at all; ${tail}`
  const lines = standing.map((l) => l.line)
  const where = lines.length === 1 ? `invoice line ${lines[0]} was` : `invoice lines ${lines.join(', ')} were`
  const named = [
    ...(lines.length ? [`${where} read as the vendor's standing remit-to postal address, which was not checked against the vendor master`] : []),
    ...mentions.slice(0, 4).map((m) => `invoice line ${m.line.line}, "${clip(m.text, 120)}", names payment and was read as neither an instruction about where payment goes, a change of payment details nor a promise of one`),
    ...(mentions.length > 4 ? [`and ${mentions.length - 4} more sentence${mentions.length - 4 === 1 ? '' : 's'} naming payment, read the same way`] : []),
  ]
  const n = standing.length + mentions.length
  return `${read}; no sentence was read as an instruction, a change or a promise, though ${n === 1 ? 'one sentence names' : `${n} sentences name`} payment: ${named.join('; ')}; ${tail}`
}
/**
 * Ruleset 0.4.0: the same line, saying what 0.4.0 reads besides: the opening step of a payment redirection, and every line as
 * spelled. As under 0.3.0, "none was found" is said only when no sentence of the bill names payment at all.
 */
export function bankNotCheckedText040(standing: readonly { line: number }[], mentions: readonly { line: { line: number }; text: string }[]): string {
  const read = `payment redirection: every sentence of the bill was read for an instruction about where payment goes (a verb of sending, paying, remitting, mailing, wiring, directing or updating with an account, an institution, an address, a lockbox, a link or an assignee as its object, or a change or an attachment about payment details), for an account, bank, lockbox, routing or remittance detail named as closed, changed, new, updated or replaced, for a promise to call, send or confirm payment instructions, for a request to reply, call or confirm about the vendor's banking or wiring details, or to reply or call before payment is released, and for a move to a new bank or financial partner; every line was also read with letters spelled apart joined, invisible characters left out and look-alike letters from other alphabets read as Latin; and the ${PAYMENT_REDIRECTION.length} phrasings listed in docs/AP-INPUT.md were scanned`
  const tail = 'a wording the reading does not parse is not caught; the vendor\'s bank details are not part of the inputs, so where the payment goes was not checked against the vendor master'
  if (!standing.length && !mentions.length) return `${read}; none was found, and no sentence of the bill names payment at all; ${tail}`
  const lines = standing.map((l) => l.line)
  const where = lines.length === 1 ? `invoice line ${lines[0]} was` : `invoice lines ${lines.join(', ')} were`
  const named = [
    ...(lines.length ? [`${where} read as the vendor's standing remit-to postal address, which was not checked against the vendor master`] : []),
    ...mentions.slice(0, 4).map((m) => `invoice line ${m.line.line}, "${clip(m.text, 120)}", names payment and was read as none of these`),
    ...(mentions.length > 4 ? [`and ${mentions.length - 4} more sentence${mentions.length - 4 === 1 ? '' : 's'} naming payment, read the same way`] : []),
  ]
  const n = standing.length + mentions.length
  return `${read}; no sentence was read as any of these, though ${n === 1 ? 'one sentence names' : `${n} sentences name`} payment: ${named.join('; ')}; ${tail}`
}
export const BANK_NOT_CHECKED_STRUCTURED ='payment redirection: the structured input has no field for payment instructions or bank details, so where the payment goes was not checked against the vendor master'

/** Remedies for AP_REMITTANCE (engine 0.6.0's AP table, ./index.ts AP_REMEDIES_V060): the controller, and only the controller. */
export const REMITTANCE_REMEDIES: RuleRemedies = {
  abstain: [
    { kind: 'authority', authority: 'ap-controller', when: ['AMBIGUOUS_REFERENCE'],
      detail: 'The bill names where to pay, and the gate cannot check it. The controller confirms the vendor\'s payment details against the vendor master, calling the vendor on a number already on file (never one given in the bill or its email), for this verdict only.' },
  ],
}
