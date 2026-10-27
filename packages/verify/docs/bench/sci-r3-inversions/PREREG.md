# SCI-R3 PREREGISTRATION: two gravity inversions, one above and one below

Frozen 2026-10-04T03:40Z by lane SCI-R3 (resolved model `claude-opus-5-5`, read from this agent's transcript).
Frozen BEFORE: the galaxy-selection rule is executed, the ocean region scan is run, any rotation-curve inversion or
halo fit is computed, and any depth comparison is computed. At freeze time the lane has downloaded only reference
texts (READMEs, the Li+2020 PDF, the img reader source). No bathymetry or gravity data bytes have been read.

What I already know (disclosed): NGC 3198 is a classic flat curve near 150 km/s (from R0). I know from memory that
satellite-predicted depth is generally said to be accurate to "a few hundred metres"; I hold no number from a fetched
source and set no threshold from it. This is a METHODS study. Nothing below is a physics claim.

---------------------------------------------------------------------------------------------------------------------
## A. ABOVE: rotation curve to enclosed mass to halo

**Inputs (pinned, from R0).** `../r0-astro/data/Rotmod_LTG.zip` sha256 `0a80cc90…f588`;
`../r0-astro/data/SPARC_Lelli2016c.mrt` sha256 `5aa0501f…8243` (parsed by whitespace, 19 fields, as R0 amended);
`../r0-astro/data/MassModels_Lelli2016c.mrt` sha256 `9108994b…244c`. The zip's sha256 is re-verified before use.

**A1. Galaxy selection rule (executed after freeze).** Candidates = Table1 rows with Q = 1, Inc >= 30 deg, Vflat > 0,
and >= 25 rows in the galaxy's `_rotmod.dat` inside the zip; NGC3198 excluded from the candidate list (it is fixed).
Select (i) the candidate with the HIGHEST Vflat and (ii) the candidate with the LOWEST Vflat. Ties: alphabetical by
Galaxy name. Rationale, stated before seeing the result: span the mass range, one baryon-heavy, one dark-dominated.
Result: NGC3198 + the two selected = three galaxies.

**A2. The inversion (per galaxy, per row).**
- G from `astropy.constants.G`, converted to kpc (km/s)^2 / Msun.
- M_obs(<R) = Vobs^2 R / G.
- Vbar^2 = |Vgas|Vgas + Yd |Vdisk|Vdisk + Yb |Vbul|Vbul (SPARC eq. 2, quoted in the R0 report), Yd = 0.5, Yb = 0.7
  (Lelli+2016 fiducial, quoted in R0; Li+2020 text: "fiducial values (disk=0.5 and bul=0.7 according to McGaugh et al.
  2016; Lelli et al. 2017)", Greek Upsilon dropped by pdftotext).
- M_bar(<R) = Vbar^2 R / G (the spherical-equivalent baryonic mass; for a disk this is NOT the true enclosed disk mass;
  stated as a limitation).
- M_DM(<R) = M_obs - M_bar. sigma_M = 2 Vobs errV R / G (errV only; Y, D, i held fixed in the decisive fit).
- All rows kept, including any with M_DM < 0 (reported, not dropped).

**A3. Halo forms (source: Li, Lelli, McGaugh & Schombert 2020, ApJS 247, 31, DOI 10.3847/1538-4365/ab700e,
arXiv:2001.10538, PDF sha256 `43a906c9…b272`; equations transcribed from the rendered PDF pages 2-3, PNG sha256
`55e351e2…` and `054518e3…`, because pdftotext drops the Greek):**
- **Decisive form: pseudo-isothermal (pISO), Li+2020 eq. (2)-(3):** rho = rho_s / (1 + (r/r_s)^2);
  M_pISO(<r) = 4 pi rho_s r_s^3 [x - arctan(x)], x = r/r_s.
- **Non-decisive comparison form: NFW, Li+2020 eq. (8)-(9):** rho = rho_s / ((r/r_s)(1 + r/r_s)^2);
  M_NFW(<r) = 4 pi rho_s r_s^3 [ln(1+x) - x/(1+x)].
- Parameters fitted: log10 rho_s [Msun/kpc^3] in [3, 11], log10 r_s [kpc] in [-2, 2.7]. Li+2020 fit (V200, C200)
  with priors on Y, D, i by MCMC; my fit is a fixed-Y weighted least squares. It is NOT a replay of Li+2020.

**A4. Decisive fit.** Weighted least squares of M_DM(<R) against M_pISO(<R) with sigma_M, in linear mass space.
Start from the best point of a 60 x 60 log grid over the bounds, then `scipy.optimize.least_squares` (trf, bounds).
Report: best-fit params, 1-sigma from the Jacobian covariance scaled by nothing (formal), chi2, dof = N - 2,
chi2_nu, per-row normalised residuals, and the literal sentence "no ground truth exists for this inversion".
**Fit FAILED** if: the optimiser reports no convergence, OR a parameter sits within 0.01 dex of a bound. A failed fit
is reported as failed, not refit with new bounds.

**A5. Non-decisive variants (reported, never substituted for the decisive fit).**
- NFW, same procedure.
- Velocity-space fit (Vobs vs sqrt(Vbar^2 + V_halo^2), sigma = errV) for pISO and NFW, as a cross-check.
- Yd in {0.3, 0.7} (Yb unchanged): M_DM(<R_last) and refit pISO.
- Distance D +/- e_D (Table1): R and M scale as R' = R D'/D, Vgas, Vdisk, Vbul scale as sqrt(D'/D), Vobs unchanged.
- Inclination Inc +/- e_Inc (Table1): Vobs' = Vobs sin(i)/sin(i'), errV likewise.
- Extrapolation: M_DM at 2 R_last under the pISO fit and the NFW fit; spread = |pISO - NFW| / mean.
- **Systematic-to-formal ratio** for M_DM(<R_last): (max - min of M_DM(<R_last) over the Y, D, i variants) / (2 x the
  formal sigma_M at R_last). This is the above-side number the calibration argument uses.

---------------------------------------------------------------------------------------------------------------------
## B. BELOW: satellite-predicted depth against later ship measurements

**Data (to be downloaded after freeze, by HTTP byte range from topex.ucsd.edu; the full-file Content-Length, ETag and
Last-Modified are recorded so the ranged read is pinned to one file version):**
- OLD prediction: `https://topex.ucsd.edu/pub/global_topo_1min/topo_19.1.img` (released 2019-01).
- NEW measurements: `https://topex.ucsd.edu/pub/global_topo_1min/topo_27.1.img` (released 2025-12).
- Gravity (for B5 only): `https://topex.ucsd.edu/pub/global_grav_1min/grav_34.1.img` (free-air anomaly, mGal x 10).
- Format, from the fetched README_V19.1 (sha256 `3c5a9030…`) and img2xyz_80.f (sha256 `6c617672…`): 21600 x 17280
  big-endian int16, spherical Mercator, 1 arcmin in longitude, south edge -80.738, row centre latitude
  2 atan(exp(rad dln (nlt - i + .5) + ln tan(45 + rlt0/2))) - 90, column centre lon = dln (j - .5).
  Type flag, README verbatim: "An odd depth of say -2001m signifies that this pixel was constrained by a real depth
  sounding while an even depth of say -2000m is a predicted depth." Value read as idat - abs(mod(idat,2)) (the reader's
  own rule). The parity rule is documented for V9.1 onward; that it still holds in V27.1 is an ASSUMPTION, checked
  empirically by the odd fraction over deep ocean (reported).

**B1. Region selection rule (executed after freeze).** Scan rows i = 15, 45, 75, … (every 30th Mercator row) of both
topo files, all columns. A cell is NEWLY MEASURED if OLD is even (predicted) and NEW is odd (measured), and both OLD
and NEW values are <= -1000 m. Tile the sea between 60S and 60N into 2 x 2 degree boxes on even-degree corners.
Score = count of newly measured cells in the box's sampled rows x 30 (an estimate of the box's count). The **decisive
box** = the highest score; ties to the southernmost, then westernmost. **Replication boxes** = the next two highest that
share no edge or corner with a higher-ranked selected box. The scan reads parity and NEW depth only; it computes no
OLD - NEW difference.

**B2. The decisive comparison (in the decisive box).** For every newly measured cell: e = OLD_predicted - NEW_measured
(metres, on elevations; depths are negative elevations, so e > 0 means the prediction is shallower than the
measurement). Report: N, mean (bias), median, std, RMS, robust sigma = 1.4826 x MAD,
percentiles 5/25/50/75/95, and the fractions with |e| <= 50, 100, 250, 500 m.
- **By depth**: bins of NEW depth [-1000,-2000), [-2000,-3000), [-3000,-4000), [-4000,-5000), [-5000,-6000), < -6000.
- **By distance from the nearest OLD sounding** (nearest OLD-odd cell, great-circle km between cell centres, searched
  within the box padded by 1.5 deg): bins 0-2, 2-5, 5-10, 10-20, 20-50, 50-100, > 100 km (the last bin = "no OLD
  sounding inside the pad").
- **Skill**: 1 - MSE(e) / Var(NEW_measured) over the same cells (a constant-depth baseline).
- **Measurement floor (non-decisive)**: for cells odd in BOTH versions, d = OLD - NEW; same statistics. This bounds how
  much two "measured" values for the same cell disagree (new data, re-editing, re-gridding).
- Plots (PNG, sha256 in MANIFEST): error histogram; |e| vs depth (binned); |e| vs distance (binned); a map of the box
  showing OLD-odd, NEW-only-odd, and predicted cells.

**B3. Replication.** B2 repeated on the two replication boxes. Non-decisive; reported in a table.

**B4. Not apples-to-apples, declared now.** (a) NEW "measured" cells are cell medians of soundings, possibly including
gridded compilations, not raw pings. (b) OLD predicted cells near OLD soundings were splined toward them (README:
"the difference is splined"), so they are not gravity-only; the distance covariate is how this is exposed. (c) SIO edits
soundings that disagree with gravity (README V6.2 note on a removed false seamount); new soundings that strongly
disagreed may have been edited out, which biases toward agreement. (d) The gravity behind topo_19.1 is an older model
than grav_34.1.

**B5. Secondary, non-decisive: my own gravity inversion (one method on both sides).** In the decisive box (+1 deg pad):
- Ground truth = NEW-odd cells. Spatial split: 0.25-deg checkerboard, block parity (floor(lat/0.25)+floor(lon/0.25)) even
  = TRAIN, odd = TEST. Padding cells are TRAIN only.
- Regional depth d_reg = Gaussian-weighted mean of TRAIN depths, sigma = 40 km, computed at every cell; cells with total
  weight from fewer than 5 TRAIN cells within 80 km are excluded.
- Gravity grav_34.1 (mGal) on the same Mercator cells, treated as a square local Cartesian grid with spacing
  1 arcmin x cos(box-centre latitude) x 111.195 km (Mercator is locally conformal; the +/- few % scale change across the
  padded box is an accepted approximation). Remove mean and best-fit plane, 10% cosine taper on each edge, FFT.
- Transfer: h_bp(k) = g(k) W_hp(k) W_dc(k) / (2 pi G drho exp(-2 pi |k| d)), with drho = 1670 kg/m^3 (2700 - 1030),
  d = median(-d_reg) in the box (m), W_hp = 1 - exp(-ln2 (|k| lambda_hp)^2), a Gaussian high-pass with 0.5 gain at
  lambda_hp = 160 km, W_dc = 1 / (1 + A |k|^4 exp(4 pi |k| d)) with A set so W_dc = 0.5 at 1/lambda_lp, where
  lambda_lp is linearly interpolated in d from the README_V19.1 V20.1 column (2 km: 10.5 km; 4 km: 14.0 km; 6 km:
  17.5 km). This filter form is MY choice; only the 0.5-gain wavelengths come from the README.
- Fit (NEW - d_reg) = s h_bp + c on TRAIN by least squares; predict pred = d_reg + s h_bp + c on TEST.
- Report: s, implied effective density contrast drho/s, TRAIN RMS, TEST RMS, **inflation ratio TEST RMS / TRAIN RMS**,
  the B2 statistics on TEST, TEST error by distance to the nearest TRAIN cell, and the **no-gravity baseline** (pred =
  d_reg + c, s = 0) TEST RMS. Gravity adds skill only if TEST RMS(full) < TEST RMS(baseline).

---------------------------------------------------------------------------------------------------------------------
## C. What the calibration argument may and may not use

- Below-side numbers: the B2 error distribution and its growth with distance from ground truth; the B4 caveats; the B5
  inflation ratio, fitted density contrast, and baseline comparison.
- Above-side numbers: formal fit errors, the systematic-to-formal ratio, the halo-form extrapolation spread.
- The argument is a bound on METHOD reliability, never on whether dark matter exists or Newtonian gravity holds at
  galactic scales. No threshold below is a pass/fail on physics; the outputs are descriptive.
- Any change to this file after freeze is appended as a dated AMENDMENT section with its reason, and PREREG.sha256
  keeps the original hash.

---------------------------------------------------------------------------------------------------------------------
## AMENDMENT 1 (2026-10-04T04:05Z, AFTER the decisive A and B results were seen; everything here is POST-HOC)

Reason: the preregistered box rule (most newly measured cells) picked boxes already crossed by many 2019 tracks. In the
decisive box no newly measured cell is more than about 20 km from a 2019 sounding, so the far field, where the
prediction is gravity-only, is unsampled. Also, the B5 0.25-deg checkerboard leaves every TEST cell within about 9 km
of TRAIN. These additions are labelled POST-HOC in every output and never replace a preregistered number.

- **P1 far-field box.** From the existing scan rows, for each newly measured cell (B1 criteria), compute the along-row
  distance to the nearest OLD-odd cell in the same sampled row (row-limited, so it is only a screening proxy). Box score =
  30 x count of newly measured cells whose along-row distance exceeds 50 km. Select the top box between 60S and 60N not
  among the three already selected and not adjacent to them. Download with a 2.5-deg pad. Run B2 unchanged, with true
  2-D distances, plus an extra distance bin split of the > 100 km bin into 100-150 and > 150 km (censored at the pad).
- **P2 hold-out geometry.** Repeat B5 with checkerboard blocks of 0.5 deg and 1.0 deg (same rule otherwise).
- **P3 interpolation baseline.** For every B5 split, also predict each TEST cell by the nearest TRAIN cell's measured
  depth, and report its TEST RMS by distance to TRAIN.
- **QA (not a result).** Check the decoded topo_27.1 geolocation against ERDDAP GEBCO_2020 at sample points in the
  decisive box, including row/column shifts of -2..+2, to confirm the Mercator decoding is not misregistered.

ERRATUM to AMENDMENT 1 (appended 2026-10-04T04:02Z): the AMENDMENT 1 header time "04:05Z" is wrong; it was an estimate.
The file's modification time shows AMENDMENT 1 was appended at 2026-10-04T03:49:17Z (23:49:17 local, UTC-4). Likewise the
header line "Frozen 2026-10-04T03:40Z" is when drafting began; the hash was frozen at 03:42:06Z, as PREREG.sha256 records.
Both preregistered first-run outputs (scratch/above-result.run1.json, scratch/below-result.run1.json) record the frozen
hash 4c493f6c… as the then-current PREREG.md, i.e. they ran before AMENDMENT 1. No result changes.
