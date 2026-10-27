/**
 * The algorithm registry (engine 0.4.0, 2026-10-04; docs/RULESETS.md "Engine 0.4.0").
 *
 * A named algorithm (a published procedure such as SPARC's V_flat) is a claim too: a ruleset that relies on it relies on that
 * procedure, as its source states it, implemented in exactly these bytes. So an entry pins:
 *   - its id and version (a changed procedure is a new version, never an edit);
 *   - its quoted source: the citation, the DOI, the URL, the sha256 of the fetched PDF and of the fetched text, the verbatim
 *     quote (and its sha256), and the reading taken where the text is loose;
 *   - its implementation: one file of deterministic code, pinned by the sha256 of its bytes with CRLF folded to LF
 *     (`implementation_sha256`; test/scir4-algorithms.test.ts recomputes it from the file).
 *
 * A ruleset names an entry by ref (`"algorithm": "sparc.vflat@1"` in its `algorithms` block). The ruleset's input identity
 * carries each named entry's pin (declarative/types.ts rulesetIdentity), so the verdict_id moves when the implementation or the
 * source does. The verdict lists the pins (`algorithms`), and replay refuses a verdict whose pin this build's registry does not
 * carry byte for byte (protocol/replay.ts).
 */

import { hashOf } from '../verdict/canonical.js'
import type { AlgorithmPin } from '../verdict/schema.js'
import { sparcVflat } from './sparc-vflat.js'
import { rarFit, type RarWeighting } from './rar-fit.js'

/** One input series of an algorithm: one value per row of the table, in the table's order. */
export interface AlgorithmInput { name: string; what: string }
export interface AlgorithmOutput { name: string; what: string }
/**
 * Engine 0.5.0: a parameter of an algorithm, which a ruleset may give only from a choice slot (`params: { name: SLOT }`),
 * so every free parameter is on the choice ledger. `values` lists what the procedure takes.
 */
export interface AlgorithmParam { name: string; what: string; values: readonly string[] }

export interface AlgorithmSource {
  citation: string
  doi: string
  url: string
  /** sha256 of the PDF as fetched from `url` */
  pdf_sha256: string
  /** the text the quote is taken from: how it was made, and its sha256 */
  text: { made_by: string; sha256: string; lines: string }
  /** an earlier extraction of the same PDF, when one exists (e.g. a layout extraction that drops glyphs), and its sha256 */
  also?: { made_by: string; sha256: string }
  /** the passage, verbatim (line ends folded to LF) */
  quote: string
  /** sha256 of `quote` (UTF-8) */
  quote_sha256: string
  /** how the implementation reads the passage where the text is loose */
  reading: string
  /**
   * Engine 0.5.0: when the procedure's details come from a reading the source does not state (a fit's weights and
   * solver), the program that first implemented that reading, by its sha256 (a reference, not part of the build).
   */
  reference_implementation?: { made_by: string; sha256: string; functions: string }
}

export type AlgorithmRun = (series: Record<string, readonly number[]>, params?: Record<string, string>) => { ok: true; outputs: Record<string, number> } | { ok: false; reason: string }

export interface AlgorithmEntry {
  id: string
  version: string
  title: string
  inputs: readonly AlgorithmInput[]
  outputs: readonly AlgorithmOutput[]
  /** the output a ruleset role takes when it names none */
  primary: string
  /** engine 0.5.0: the parameters, each given by a choice slot (none for an entry without them) */
  params?: readonly AlgorithmParam[]
  /** engine 0.5.0: the first engine that carries the entry (absent: 0.4.0, when the registry began); an earlier engine refuses it */
  since?: string
  source: AlgorithmSource
  implementation: { file: string; sha256: string }
  run: AlgorithmRun
}

/**
 * What a verdict carries for each algorithm its ruleset names, and what replay compares: the ref, the implementation hash, and
 * the source's hashes. `carried: false` records a ref this build's registry does not carry. (The type lives in verdict/schema.ts.)
 */
export type { AlgorithmPin }

const SPARC_VFLAT_1: AlgorithmEntry = {
  id: 'sparc.vflat',
  version: '1',
  title: 'The velocity along the flat part of a rotation curve (V_f), by the automated outer-in mean of Lelli, McGaugh & Schombert 2016',
  inputs: [
    { name: 'rad', what: 'galactocentric radius per row, strictly increasing' },
    { name: 'v', what: 'observed rotation velocity per row' },
  ],
  outputs: [
    { name: 'vflat', what: 'V_f, the mean of the included velocities (the units of v)' },
    { name: 'n_used', what: 'how many outer rows the mean includes' },
    { name: 'r_inner', what: 'the radius of the innermost included row (the units of rad)' },
  ],
  primary: 'vflat',
  source: {
    citation: 'Lelli, F., McGaugh, S. S. & Schombert, J. M. 2016, "The Small Scatter of the Baryonic Tully-Fisher Relation", ApJL 816, L14, Section 2.2 (Rotation Velocity), eqs. (1)-(2)',
    doi: '10.3847/2041-8205/816/1/L14',
    url: 'https://arxiv.org/pdf/1512.04543',
    pdf_sha256: '750465eb6e09a3c4af2de6eaccd7ca8e664c38ee1cc16c0dbc8200328148963c',
    text: { made_by: 'pdftotext 4.00 -enc UTF-8 (reading order) of the PDF above', sha256: '501a8f87a8a64f912cda5ddb3dba631901a387e72c2dc9af8359d5f38a0bf3d6', lines: '34-52' },
    also: { made_by: 'pdftotext -layout of the same PDF (it drops the ≤, the minus signs and the overbar on V)', sha256: '52a9c385d64898e85b53bb3bffb98f95c034116eac58efe403e74e7bb783256e' },
    quote:
      'We estimate Vf using a simple automated algorithm. We start by calculating the mean of the two outermost points of the RC:\n' +
      '\n' +
      '1\n' +
      '\n' +
      'V = 2 (VN + VN−1),\n' +
      '\n' +
      '(1)\n' +
      '\n' +
      'and require that\n' +
      '\n' +
      '|VN−2 − V | ≤ 0.05.\n' +
      '\n' +
      '(2)\n' +
      '\n' +
      'V\n' +
      '\n' +
      'If the condition is fulﬁlled, the algorithm includes VN−2\n' +
      'in the estimate of V and iterates to the next velocity point. When the condition is falsiﬁed, the algorithm re-\n' +
      'turns Vf = V . This algorithm returns similar values of Vf as previously employed techniques based on the logarithmic slope ∆ log(V )/∆ log(R) (Stark et al. 2009), but is more stable against small radial variations in the RC. Galaxies that do not satifsy the condition at the ﬁrst iteration are rejected, hence we only consider RCs that are ﬂat within ∼5% over at least three velocity-points.',
    quote_sha256: 'decb0fefddab5b06dadaa029f37baa829ef916db16cc83d56620b43a31aa6a94',
    reading:
      'The text extraction loses the typesetting of eqs. (1)-(2): they read V-bar = (1/2)(V_N + V_N-1) and |V_N-2 - V-bar| / V-bar <= 0.05, ' +
      'with V-bar the running mean. "Includes V_N-2 in the estimate of V-bar" is read as: the mean is recomputed over every included point ' +
      '(the reading SCI-R0 preregistered). The rows are taken in the table\'s order and must have strictly increasing radius, so "outermost" ' +
      'is the last rows. A first-test failure, fewer than three points, or a radius that is not strictly increasing returns no value with the reason. ' +
      'The mean is summed outermost first. The engine rounds every output to 9 decimal places.',
  },
  implementation: { file: 'src/algorithms/sparc-vflat.ts', sha256: 'd11017f6c0440ec6abbcb7e84f66a5a27a8fca302599e761e4fdecfa1375266d' },
  run: (series) => {
    const r = sparcVflat({ rad: series.rad ?? [], v: series.v ?? [] })
    return r.ok ? { ok: true, outputs: { ...r.outputs } } : r
  },
}

const RAR_FIT_1: AlgorithmEntry = {
  id: 'rar.fit',
  version: '1',
  title: 'The one-parameter fit of the radial acceleration relation, g_obs = g_bar / (1 - e^-sqrt(g_bar/g†)), by weighted orthogonal distance regression in log space',
  inputs: [
    { name: 'x', what: 'log10 of the baryonic acceleration g_bar (m s^-2) per row' },
    { name: 'y', what: 'log10 of the observed acceleration g_obs (m s^-2) per row' },
    { name: 'sx', what: 'the 1σ uncertainty of x per row, in dex (read only with the weighting "errors")' },
    { name: 'sy', what: 'the 1σ uncertainty of y per row, in dex (read only with the weighting "errors")' },
  ],
  outputs: [
    { name: 'g_dagger', what: 'g†, the acceleration scale, in units of 1e-10 m s^-2' },
    { name: 'rms_v', what: 'the rms of the vertical residuals y - logF(x) about the fit, in dex' },
    { name: 'chi2', what: 'the orthogonal-distance chi-square at the fit' },
    { name: 'sd_curvature', what: 'the 1σ error of g† from the curvature of chi-square (Δchi² = 1), in 1e-10 m s^-2' },
    { name: 'n_used', what: 'how many rows the fit used' },
  ],
  primary: 'g_dagger',
  since: '0.5.0',
  params: [
    { name: 'weighting', what: 'how the rows are weighted: "errors" takes sx and sy as each row\'s 1σ; "unweighted" gives every row σ = 1 on both axes. The paper does not state its weights, so this is a choice slot of kind weights', values: ['errors', 'unweighted'] },
  ],
  source: {
    citation: 'McGaugh, S. S., Lelli, F. & Schombert, J. M. 2016, "Radial Acceleration Relation in Rotationally Supported Galaxies", PRL 117, 201101: the fit of eq. (RFRfit) (Fig. 1 caption); the weights and the solver are SCI-R1\'s preregistered reading, because the paper states neither',
    doi: '10.1103/PhysRevLett.117.201101',
    url: 'https://arxiv.org/pdf/1609.05917',
    pdf_sha256: '80357e5b689f1ae7c087359ff936a4543ad09bd4619498026d9e0bcf828fe8a8',
    text: { made_by: 'the arXiv LaTeX source (https://arxiv.org/e-print/1609.05917, gzip of tar, sha256 e2388620c02cacbcb3935e4c5db3b348a11f56702ffc630b08f8ccf430c4cba7), file PRL_RAR_arXiv.tex', sha256: '45ec63024e6a77b1c53ea92bf4305edf81bc069ebbd85a7d6da0eb897fbee9e2', lines: '200-201' },
    quote:
      'The solid line is the fit of eq.~\\ref{eq:RFRfit} to the \n' +
      'unbinned data using an orthogonal-distance-regression algorithm that considers errors on both variables.',
    quote_sha256: 'a11d9b5bee2e0ffebe4ebc8583029b06aff2022c9240d278100cc2978a599e6b',
    reading:
      'The paper states the function (g_obs = g_bar / (1 - exp(-sqrt(g_bar/g†)))), that the fit is orthogonal distance regression ' +
      'on unbinned data, and that it considers errors on both variables. It does not state the weights or the solver. The reading ' +
      '(SCI-R1\'s preregistration): in log space, x = log10 g_bar, y = log10 g_obs; the objective is the orthogonal-distance chi-square ' +
      'sum_i min_t ((y_i - logF(t))/sy_i)^2 + ((t - x_i)/sx_i)^2; the inner minimum by Gauss-Newton (all rows together, from t = x, at ' +
      'most 60 steps, stopping when the largest step is below 1e-13); the outer minimum over ln g† by Brent\'s bounded method on ' +
      '[ln 0.01, ln 100] with xatol 1e-8 (SciPy minimize_scalar, method bounded). The weights are a parameter (weighting) the ruleset ' +
      'gives from a choice slot: with "errors", the sx and sy series as given (SCI-R1: sy from velocity, inclination and distance ' +
      'errors in quadrature; sx = 0.11 dex times the stellar share of g_bar, floor 0.01 dex). A fit at the solver bound returns no ' +
      'value. The engine rounds every output to 9 decimal places.',
    reference_implementation: { made_by: 'SCI-R1\'s preregistered script r1_sparc.py (Python, numpy and SciPy)', sha256: 'c332cce0b57823c663ea1996e7c3a3ff591c6bc630daf0d78c8ed597798fc63d', functions: 'logF, dlogF_dx, inner_gn, wodr_fit' },
  },
  implementation: { file: 'src/algorithms/rar-fit.ts', sha256: '27e5fa1deea1557165da1124dd7e96fd55228591760a03118bcd73b990cb2ca0' },
  run: (series, params) => {
    const r = rarFit({ x: series.x ?? [], y: series.y ?? [], sx: series.sx ?? [], sy: series.sy ?? [] }, (params?.weighting ?? 'errors') as RarWeighting)
    return r.ok ? { ok: true, outputs: { ...r.outputs } } : r
  },
}

/** Every algorithm this build carries, by ref (`id@version`). */
export const ALGORITHMS: Readonly<Record<string, AlgorithmEntry>> = Object.freeze({
  'sparc.vflat@1': SPARC_VFLAT_1,
  'rar.fit@1': RAR_FIT_1,
})

/** The entry a ref names, or undefined when this build does not carry it. */
export function resolveAlgorithm(ref: unknown): AlgorithmEntry | undefined {
  return typeof ref === 'string' && Object.prototype.hasOwnProperty.call(ALGORITHMS, ref) ? ALGORITHMS[ref] : undefined
}

/** The pin a verdict carries for a ref: this build's entry's identity, or `{ ref, carried: false }`. */
export function algorithmPin(ref: string): AlgorithmPin {
  const e = resolveAlgorithm(ref)
  if (!e) return { ref, carried: false }
  return {
    ref, id: e.id, version: e.version, implementation_sha256: e.implementation.sha256,
    source: {
      doi: e.source.doi, url: e.source.url, pdf_sha256: e.source.pdf_sha256, text_sha256: e.source.text.sha256, quote_sha256: e.source.quote_sha256,
      // engine 0.5.0: only an entry that names a reference implementation carries its hash (sparc.vflat@1's pin keeps its bytes)
      ...(e.source.reference_implementation !== undefined ? { reference_sha256: e.source.reference_implementation.sha256 } : {}),
    },
  }
}

/** The first way a verdict's pin differs from this build's registry, or undefined when it is carried byte for byte. */
export function pinProblem(pin: unknown): string | undefined {
  if (pin === null || typeof pin !== 'object' || typeof (pin as { ref?: unknown }).ref !== 'string') return 'an algorithm pin without a ref'
  const ref = (pin as { ref: string }).ref
  const mine = algorithmPin(ref)
  if (hashOf(mine) === hashOf(pin)) return undefined
  if ('carried' in mine) return `the verdict pins algorithm ${ref}, which this build's registry does not carry`
  if ('carried' in (pin as object)) return `the verdict was made without algorithm ${ref} (not carried then), and this build carries it`
  const p = pin as Extract<AlgorithmPin, { implementation_sha256: string }>
  if (p.implementation_sha256 !== mine.implementation_sha256) return `the verdict pins ${ref} with implementation sha256 ${String(p.implementation_sha256)}, and this build's registry carries ${mine.implementation_sha256}: the implementation changed`
  return `the verdict's pin of ${ref} differs from this build's registry in its source (${hashOf(p.source ?? null).slice(0, 12)} vs ${hashOf(mine.source).slice(0, 12)})`
}
