# PREREG: SCI-R1, all of SPARC under one preregistration

Written 2026-10-04 (UTC) about 03:45Z by lane SCI-R1 (model `claude-opus-5-5`, attested from this agent's own
transcript). Frozen when its sha256 is written to `PREREG.sha256`. Amendments go in the AMENDMENTS section at the
bottom with a timestamp and never rewrite anything above it. Every script in `scratch/` checks this file's sha256
against `PREREG.sha256` before computing and records the hash it saw.

## 0. State of knowledge at writing (disclosure)

- **Not blind.** The author knows the published radial acceleration relation (RAR) result before running:
  g† = 1.20e-10 m s^-2 and an rms scatter of 0.13 dex (both read tonight in the fetched paper, and known from prior
  reading). The author also knows R0's NGC 3198 result (all three claims PASS). The tolerances below were set by
  someone who expects the replay to land near the published numbers. What this prereg buys is that the sample cuts,
  the formula, the fit method, the weights, the tolerances and the abstain rules are fixed before any per-galaxy
  number is computed, so none of them can be tuned afterwards.
- **What has been computed so far in this lane:** nothing per-galaxy. The three SPARC files were copied from R0 and
  their sha256 checked against R0's MANIFEST; the archive was re-fetched and the bytes are identical; the zip's member
  names were listed (175 `*_rotmod.dat` files). No rotmod file has been parsed in this lane. No Table1 column has
  been tabulated (so the counts of Q = 3 galaxies, face-on galaxies, rows and precision-cut rows are unknown to the
  author in this lane; the papers' own counts are quoted below as the expectation).
- This is a **reproduction of a known result and a validation of replay-at-scale as a method**. It is not a
  discovery and not a dark-matter position.

## 1. Inputs (bytes pinned)

| file | sha256 | origin |
|---|---|---|
| `data/Rotmod_LTG.zip` (175 members) | `0a80cc90714828cc28b7dd57923576714d209f2490328c087c4a4ad607faf588` | https://astroweb.case.edu/SPARC/Rotmod_LTG.zip |
| `data/SPARC_Lelli2016c.mrt` (Table1) | `5aa0501f6b0d881fa579030e315e7b5b6ef561a5bd3a07472f9929c7e5728243` | https://astroweb.case.edu/SPARC/SPARC_Lelli2016c.mrt |
| `data/MassModels_Lelli2016c.mrt` (Table2) | `9108994b12cc401b94a1768beca61c53ec354779385c9c9cc571049f3043244c` | https://astroweb.case.edu/SPARC/MassModels_Lelli2016c.mrt |
| `papers/mcgaugh2016-rar-1609.05917.pdf` | `80357e5b689f1ae7c087359ff936a4543ad09bd4619498026d9e0bcf828fe8a8` | https://arxiv.org/pdf/1609.05917 (PRL 117, 201101; DOI 10.1103/PhysRevLett.117.201101) |
| `papers/mcgaugh2016-rar-1609.05917.eprint` (LaTeX source, gzip) | `e2388620c02cacbcb3935e4c5db3b348a11f56702ffc630b08f8ccf430c4cba7` | https://arxiv.org/e-print/1609.05917 |
| SPARC paper PDF (R0 copy) | `d089215877213661e40965543ee7e05736619082ad16d95e65ec059029588c63` | https://arxiv.org/pdf/1606.09251 |
| BTFR paper PDF (R0 copy) | `750465eb6e09a3c4af2de6eaccd7ca8e664c38ee1cc16c0dbc8200328148963c` | https://arxiv.org/pdf/1512.04543 |

**Parsers.** Rotmod files: comment lines start with `#`; `# Distance = <x> Mpc`, then the column-name line, then the
unit line; data rows are whitespace-separated floats. Table1: R0's whitespace parser (19 fields per data row in the
declared label order: Galaxy T D e_D f_D Inc e_Inc L e_L Reff SBeff Rdisk SBdisk MHI RHI Vflat e_Vflat Q Ref),
because the declared byte layout is wrong (R0 finding). Table2: whitespace split, galaxy name in bytes 1-11. Any row
that does not parse is logged with file, line number and text; it is never silently dropped or defaulted.

## 2. Quotes that fix the method (from fetched text only)

- **RAR functional form**, LaTeX source of arXiv:1609.05917 (`PRL_RAR_arXiv.tex`, eq. `eq:RFRfit`), verbatim:
  `\gobs = {\cal F}(\gbar) = \frac{\gbar}{1-e^{-\sqrt{\gbar/\azero}}}`, i.e. g_obs = g_bar / (1 − exp(−sqrt(g_bar/g†))).
  (pdftotext of the PDF drops the radical sign; the source is quoted instead.)
- **Published parameter**, verbatim: "For our adopted \ML, we find $\azero = 1.20 \pm 0.02$ (random) $\pm 0.24$
  (systematic) $\times 10^{-10}\;\accunits$. The random error is a $1 \sigma$ value, while the systematic uncertainty
  represents the 20\% normalization uncertainty in \ML." (`\accunits` = m s^-2.)
- **Published scatter**, verbatim: "Residuals from the fit are well described by a Gaussian of width 0.11 dex
  (Fig.\ \ref{RFR}). The rms scatter is 0.13 dex owing to the inevitable outliers."
- **Fit method**, verbatim (Fig. 3 caption): "The solid line is the fit of eq.~\ref{eq:RFRfit} to the unbinned data
  using an orthogonal-distance-regression algorithm that considers errors on both variables."
- **Sample cuts**, verbatim: "Ten face-on galaxies with $i < 30^{\circ}$ are rejected to minimize $\sin(i)$
  corrections to the observed velocities. Twelve galaxies with asymmetric rotation curves that manifestly do not trace
  the equilibrium gravitational potential are rejected. This leaves a sample of 153 galaxies. Of the many resolved
  points along the rotation curves of these galaxies, we require a minimum {precision} of 10\% in velocity. This
  retains 2693 data points out of 3149."
- **SPARC quality flag**, SPARC paper (arXiv:1606.09251) Sect. 3.2, from the pdftotext of the R0 copy: "Q = 1 for
  galaxies with high quality H I data or hybrid H/H I rotation curves (99 objects); Q = 2 for galaxies with minor
  asymmetries and/or H I data of lower quality (64 objects); Q = 3 for galaxies with major asymmetries, strong
  non-circular motions, and/or off-sets between H I and stellar distributions (12 objects). Galaxies with Q = 3 are not
  suited for detailed dynamical studies: we build mass models for completeness but do not consider them in our
  analysis. Similarly, we provide mass models for face-on galaxies with i < 30 but exclude them in our analysis. [...]
  Our final science sample is made of 153 galaxies." (pdftotext drops the alpha in "H"; the hyphenation is joined.)
- **Fiducial mass-to-light ratios**: RAR LaTeX source, verbatim: "Here we adopt $\ML^{[3.6]} = 0.50\;\MLsun$
  \cite{SMpaper3} as representative of all disks of all morphological types." and "$\ML^{[3.6]} = 0.7\;\MLsun$ for
  bulges \cite{SMpaper3}." (`\ML` = Upsilon_star.) Same values in the SPARC paper Fig. 5 caption (R0). Table2 ReadMe Note (3):
  "Vdisk and Vbul are given for M/L = 1 solMass/solLum at [3.6]."
- **Baryonic velocity**, SPARC paper eq. (2): V_bar² = |V_gas|V_gas + Υ_disk|V_disk|V_disk + Υ_bul|V_bul|V_bul.
- **V_flat algorithm**, Lelli, McGaugh & Schombert 2016 ApJL 816 L14 (arXiv:1512.04543) Sect. 2.2, pdftotext of R0's
  copy: "We start by calculating the mean of the two outermost points of the RC: V = 1/2 (VN + VN-1), (1) and require
  that |VN-2 - V| / V <= 0.05. (2) If the condition is fulfilled, the algorithm includes VN-2 in the estimate of V and
  iterates to the next velocity point. When the condition is falsified, the algorithm returns Vf = V. [...] Galaxies
  that do not satifsy the condition at the first iteration are rejected, hence we only consider RCs that are flat
  within 5% over at least three velocity-points." (The comparison sign is lost by pdftotext; "within 5%" fixes it as
  <=.) SPARC paper Table1 note: "we assign Vf = 0 to rotation curves that do not reach a flat part".

## 3. Constants

- Υ_disk = 0.50, Υ_bul = 0.70 (decisive). Sensitivity only: Υ_disk = 0.70.
- 1 kpc = 3.0856775814913673e19 m. g = (V[km/s]·1e3)² / (R[kpc]·3.0856775814913673e19) in m s^-2.
- Random seed for every permutation: 20261004.

## 4. Step 1: inventory (computed after freeze, before any claim)

Per galaxy: rotmod file name, file sha256, data-row count, rotmod header distance, Table1 D, e_D, f_D, Inc, e_Inc,
L[3.6], Vflat, e_Vflat, Q; whether the rotmod rows equal Table2's rows cell by cell; whether the radius is strictly
increasing; whether the unit line reads kpc and km/s. Written to `out/inventory.tsv`.

**Exclusions recorded before running.**
- **Per-galaxy claims (C1-C3): no galaxy is excluded.** All 175 galaxies get a verdict. Each is tagged with
  `science_sample` = (Q != 3 and Inc >= 30). Counts are reported for all 175 and for the science sample separately.
- **RAR primary sample:** the paper's cuts, applied mechanically from Table1 and the rotmod rows:
  (a) drop galaxies with Inc < 30 deg; (b) drop galaxies with Q = 3 (the paper's "Twelve galaxies with asymmetric
  rotation curves" are read as SPARC's 12 Q = 3 objects, whose definition is "major asymmetries, strong non-circular
  motions"); (c) drop rows with errV / Vobs > 0.10 (keep <= 0.10); (d) drop rows with Vobs <= 0, R <= 0, or
  V_bar² <= 0 (log undefined). Every row dropped by (d) is logged as a miss with its galaxy and radius.
  The paper's counts (153 galaxies, 3149 rows before the precision cut, 2693 after) are the expectation. A mismatch is
  reported as a finding (sub-check R-N, not decisive). The count under the strict reading (errV / Vobs < 0.10) is also
  reported.
- No post hoc exclusion. If any becomes necessary (for example a file that cannot be read), it is labelled POST HOC in
  the report with the reason.

## 5. Step 2: per-galaxy replay of the three R0 claims, generalised

For each galaxy, order rows by radius (the file order; strict increase is checked in Step 1).

**V_flat replay (shared by C1-C3).** Run the Sect. 2.2 algorithm on the full V_obs column, exactly as R0 did: start
with the two outermost points; while |V_next − mean| / mean <= 0.05 (mean = running mean of all included points),
include V_next and step inward; stop at the first failure or when no rows remain. If the first test fails the curve is
**rejected** (no flat part). Otherwise V_f(rec) = mean of the included points, and **R_flat** = radius of the innermost
included point. S = the included rows (all rows with R >= R_flat), n_S = |S|.

**C1 flatness beyond R_flat.** Claim: "the observed curve is flat beyond R_flat".
- INSUFFICIENT if the curve is rejected (reason: "no flat part by the algorithm: rising or irregular outer curve"),
  or if n_S < 5 (reason: "too few outer rows, n_S = k").
- Otherwise PASS iff both (a) max over S of |V_obs − V_f(rec)| / V_f(rec) <= 0.10 and (b) |s| <= 0.10, where s is the
  ordinary-least-squares slope of log10 V_obs on log10 R over S. FAIL otherwise (reason names which part failed).
- **Circularity, declared.** Part (a) is nearly guaranteed by the algorithm (each included point was within 5% of the
  running mean when it was included). Part (b) is not: a slow steady rise of under 5% per step passes the algorithm and
  can fail (b). (b) is the informative half.
- Not decisive: (b') |s| <= 2 × its OLS standard error (slope consistent with zero).

**C2 baryonic excess beyond R_flat.** Claim: "the observed velocity exceeds the baryonic prediction with fiducial
Υ beyond R_flat". V_bar = sign(V_bar²)·sqrt(|V_bar²|).
- INSUFFICIENT if the curve is rejected or n_S < 5 (same reasons as C1).
- Otherwise PASS iff for every row in S, V_obs − V_bar >= 2·errV. FAIL otherwise (reason: the worst row, its excess
  and its errV).
- Not decisive: (i) R0's absolute bar, V_obs − V_bar >= 30 km/s at every row in S; (ii) fractional bar,
  V_bar / V_obs <= 0.8 at every row in S; (iii) the decisive rule at Υ_disk = 0.7.

**C3 V_flat replay vs Table1.**
- Table1 Vflat > 0 and the curve is not rejected: PASS iff |V_f(rec) − Vflat(Table1)| <= 1.0 km/s, else FAIL.
- Table1 Vflat > 0 and the curve is rejected: FAIL ("Table1 publishes a Vflat; the stated algorithm rejects the curve").
- Table1 Vflat = 0 and the curve is rejected: PASS, counted separately as **PASS-absent** (both say no flat part).
- Table1 Vflat = 0 and the curve is not rejected: FAIL ("the stated algorithm finds a flat part; Table1 says none").
- INSUFFICIENT only if the galaxy is missing from Table1 or its rotmod file has fewer than 3 rows.
- Not decisive: the same with "<" instead of "<=" at the 5% step, to show boundary sensitivity.

**Output:** `out/claims.tsv` (one row per galaxy, every verdict and reason) and the counts table.

## 6. Step 3: the aggregate relation (decisive test)

- g_obs = V_obs² / R and g_bar = V_bar² / R per row, in m s^-2, on the RAR primary sample (Sect. 4).
- **Fit:** scipy.odr orthogonal distance regression of y = log10 g_obs on x = log10 g_bar with model
  y = log10 F(10^x; g†), one parameter b where g† = b × 1e-10 m s^-2, starting value b = 1.0.
- **Weights (primary):** σ_y² = (2·errV / (V_obs·ln10))² + (2·cot(i)·e_Inc[rad] / ln10)² + (e_D / (D·ln10))²
  (velocity, inclination and distance errors, the three "measurement uncertainties in gobs" the paper lists;
  g_bar is distance-independent to first order, so distance enters y only). σ_x = 0.11 dex × f_star, floored at
  0.01 dex, where f_star = (Υ_disk|V_disk|V_disk + Υ_bul|V_bul|V_bul) / V_bar², clipped to [0, 1] (the paper's
  "Intrinsic scatter about the mean mass-to-light ratio is anticipated to be 0.11 dex" applied to the stellar share
  of g_bar; the 0.01 dex floor is the paper's HI flux calibration entry in Table I).
- **Residuals:** vertical Δ_v = log10 g_obs − log10 F(g_bar; g†_fit). Orthogonal Δ_o = signed Euclidean distance in
  the (log10 g_bar, log10 g_obs) plane from the point to the fitted curve (sign of Δ_v), found by a bounded scalar
  minimisation per point.
- **Decisive bars (all three verdicts reported; the headline is A and S-v):**
  - **A:** PASS iff |g†_fit − 1.20| <= 0.10 (×1e-10 m s^-2). The tolerance is five times the published random error
    and under half the published systematic, chosen to absorb differences in weighting that the letter does not
    specify. The systematic does not apply: this replay uses the same Υ.
  - **S-v:** PASS iff |rms(Δ_v) − 0.13| <= 0.02 dex.
  - **S-o:** PASS iff |rms(Δ_o) − 0.13| <= 0.02 dex. **Declared problem with the brief:** the brief asks for the
    orthogonal scatter. The paper does not say whether its 0.13 dex is vertical or orthogonal. Its scatter budget
    treats the residual as a quantity in g_obs ("Measurement uncertainties in \gobs\ follow from...") and converts the
    g_bar term "after accounting for the variable slope of the relation", which reads as a vertical residual. So S-v is
    the like-for-like test and decides the headline. S-o is computed and reported with its verdict exactly as the
    brief asks. Geometry predicts rms(Δ_o) below rms(Δ_v) by a factor between 1.12 (slope 0.5) and 1.41 (slope 1).
  - **Headline:** aggregate PASS iff A PASS and S-v PASS. FAIL otherwise. S-o is never hidden.
- **Not decisive, reported:** robust σ = 1.4826 × MAD(Δ_v) against the published Gaussian width 0.11 dex; the fit with
  (i) velocity-only σ_y, (ii) unweighted ODR, (iii) ordinary least squares in y, (iv) no precision cut, (v) all 175
  galaxies with the precision cut; the random error on b from ODR; the count sub-check R-N.
- **Plot:** `plots/rar-sparc.png`: all primary-sample points, the fitted curve, the published curve (g† = 1.20), the
  line of unity, binned means, and a residual panel. Its sha256 goes in the report.

## 7. Step 4: residuals as data

- Per galaxy in the primary sample: n rows, mean Δ_v, SD Δ_v. Written to `out/residuals-per-galaxy.tsv`.
- **Five largest outliers:** the five galaxies with the largest |mean Δ_v| among those with n >= 3 in the primary
  sample, with their Table1 metadata (D, f_D, Inc, Q, L, Vflat). For each, whether the SPARC paper flagged it: Q = 2
  (minor asymmetries) is the only flag possible inside the science sample; a name search in the SPARC paper text is
  also run and its hits quoted.
- **Second list, not decisive:** the same top five over all 175 galaxies (precision cut applied, residuals against the
  primary fit), with how many of the 22 excluded galaxies (Q = 3 or Inc < 30) land in the top ten. This tests whether
  the paper's own quality flags pick out the misfits.
- **Shuffle control (house rule):** permute galaxy labels across the primary-sample rows, keeping each galaxy's row
  count, 2000 permutations, seed 20261004. Statistics: T1 = SD over galaxies (n >= 3) of mean Δ_v; T2 = η² =
  between-galaxy sum of squares / total sum of squares; T3 = max over galaxies (n >= 3) of |mean Δ_v|.
  p = (1 + #{perm >= real}) / 2001. Pre-stated reading: residuals are expected to be galaxy-coherent because distance,
  inclination and Υ errors act per galaxy. A significant T1/T2 therefore says the scatter is not row-independent
  noise. It is NOT evidence of new physics. T3 says whether the top outlier is beyond what row-level noise produces.
- **Islands contrast (house rule: "the islands contrast is what caught the false positives";
  `logs/agent-outputs/husk-trajectory-gauge-2026-09-17.md`, where scattered islands mimicked drift).** The worry here is
  that the RAR's tightness could come from the shared 1/R in both axes and each galaxy's own radial trend, not from
  the coupling of a galaxy's dynamics to its own baryons. Islands: each primary-sample galaxy i keeps its own g_obs
  rows. Its g_bar is replaced by a partner galaxy j's own g_bar profile at the same normalised radius
  (x = R / R_max,i; j's V_bar² interpolated linearly at x·R_max,j, clamped to j's radial range; g_bar' = V_bar,j² /
  (x·R_max,j)). Rows where the interpolated V_bar² <= 0 are dropped and counted.
  - **Random islands (decisive for the contrast):** j drawn as a random derangement of the primary sample, 200
    draws, seed 20261004. Refit g† with the same ODR and weights (σ_x taken from partner j), compute rms(Δ_v).
    The relation counts as **separating from islands** iff the real rms(Δ_v) is below all 200 island values.
  - **Matched islands (not decisive):** j drawn uniformly from the 5 nearest neighbours of i in log10 L[3.6]
    (excluding i), 200 draws. This keeps the luminosity scale and cuts only the galaxy-specific link. Reported as
    median and range of rms(Δ_v) and g†.
  - Pre-stated reading: if random islands come within 0.03 dex of the real rms, the tightness is not discriminating
    and the aggregate result is labelled "method reproduces the number; the number does not discriminate". If matched
    islands come close to the real rms, the per-row coupling adds little beyond luminosity scaling, and that is said.

## 8. Step 5: our misses (all reported)

Every parse failure; every row the reader could not handle; every row dropped by rule (d); every galaxy excluded post
hoc (expected: none); the Table1 byte-layout defect (re-confirmed on the 131-byte rows in this lane); every
discrepancy between Table1 and the rotmod files (distance header vs D) and between rotmod and Table2 (cell level);
the count sub-check R-N; every C3 FAIL with its reason.

## 9. Step 6: the honest paragraph

Replay, inference and novelty kept separate. Quotes only from fetched bytes (curl and pdftotext or the LaTeX source).
No WebFetch summaries are quoted; any that are used are marked UNVERIFIED.

## AMENDMENTS

(none at freeze)

### Amendment 1 (2026-10-04T03:48Z): solver only. No weight, cut, tolerance, claim or threshold changed.

- **What happened.** Run 1 (summary kept as `out/run1-summary-ODR-DID-NOT-MOVE.json`, sha256 `b7d64ec0…1e54`) returned
  g† = 1.0 exactly, sd 0, ODR info 21 ("Problem is not full rank at solution") for the primary fit, variants (i), (iv),
  (v) and all 400 island fits. Run 1 therefore produced **no** measurement of g†. Its "A FAIL" is void.
- **Cause, isolated.** In this install (scipy 1.14.1, Anaconda base) scipy.odr fails whenever a per-point `sy` (or
  `we`) array is supplied. Even `sy = ones(n)`, which must equal the unweighted fit, returns the start value, while the
  unweighted call returns 1.1363 and the `sx`-only call returns 1.1598. Analytic Jacobians, rescaling, 2-D weight
  shapes and shifting x to O(1) do not help.
- **Fix.** The weighted fit minimises the identical ODR objective directly: chi²(b) = sum over rows of
  min over t of [ ((y − log10 F(10^t; b))/σ_y)² + ((t − x)/σ_x)² ]. The inner minimisation is a vectorised
  Gauss-Newton iteration per row (the ODRPACK inner step), checked against a two-stage dense grid. The outer
  minimisation over b is bounded scalar minimisation on log b. σ(b) is reported from the curvature
  (Δchi² = 1), and also scaled by sqrt(chi²/dof) as ODRPACK's sd_beta is.
- **Validation gate (must pass before the A verdict counts).** The direct solver must reproduce scipy.odr within
  1e-3 in b in the two configurations scipy handles: unweighted (σ_x = σ_y = 1) and σ_x-only (σ_y = 1).
- **Disclosure.** Before writing this amendment the author ran a slow brute-force version of the same objective on
  the primary sample and saw b ≈ 1.098, which is outside the ±0.10 tolerance. The amendment changes only the solver.
  The weights, sample, tolerance and headline rule above stay as frozen. The A verdict is decided by the frozen rule
  on the validated solver's value, whatever side of the line it lands.

### Amendment 2 (2026-10-04T03:53Z): implementation only, written after run 2. No decisive rule changed.

- **What happened.** In run 2 (summary kept as `out/run2-summary-islands-at-bound.json`) the direct solver's search
  interval for b was [0.3, 3.0]. The random-island fits ran into the upper bound (median b = 2.97, max 3.00). Their
  rms values are therefore not the rms at the island's own best fit.
- **Fix.** The search interval becomes [0.01, 100] for every direct fit (primary, variants, islands); the vertical
  least-squares variant's interval becomes log10 b in [-2, 2]. The primary fit (b = 1.0989, interior) must not move;
  that is checked and reported.
- **Added, POST HOC, not decisive:** for each island draw, the best-case vertical rms over all b (least squares in y),
  so the islands contrast is also read against the islands' most favourable fit; the count of island fits that still
  touch a bound; and, for the all-175 outlier list, the hypergeometric probability of seeing at least the observed
  number of paper-excluded galaxies in the top ten, given their share among galaxies with n >= 3.

### Amendment 3 (2026-10-04T03:56Z): one POST HOC control added after run 3. Not decisive. Nothing above changed.

- **Gap found in my own control.** Section 7 names the worry as "the shared 1/R in both axes", but the frozen islands
  compute g_bar' at the partner's own radius, which removes the shared 1/R as well as the galaxy-specific link. So the
  frozen contrast cannot tell "tightness from shared R" apart from "tightness from coupling".
- **Added, POST HOC, not decisive: shared-R islands.** Same partners and draws as the frozen contrast (random
  derangement and matched-luminosity, 200 each), but g_bar' = V_bar,j²(x·R_max,j) / R_i: the partner's baryonic
  velocity at the matched normalised radius, divided by the host's own radius, so both axes share 1/R_i. If these
  islands also come out far looser than the real data, the shared 1/R is not what makes the relation tight.
