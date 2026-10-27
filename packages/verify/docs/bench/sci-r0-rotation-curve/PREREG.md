# PREREG: SCI-R0 rotation-curve recompute (NGC 3198)

Written 2026-10-04T02:59Z (2026-10-03 local), BEFORE any SPARC rotation-curve or Table1 data file
was downloaded. At writing time `data/` held only `sparc-index.html` (the SPARC landing page).
This file is frozen once its sha256 is recorded in the report; amendments go in a dated AMENDMENTS
section at the bottom and do not rewrite anything above it.

## Status: DEMONSTRATION, NOT A BLIND TEST

The author knows from prior reading that NGC 3198 is the textbook flat-rotation-curve galaxy
(van Albada et al. 1985), with an outer velocity near 150 km/s and a curve that is flat from roughly
10 kpc outward. The thresholds below are therefore chosen by someone who already expects a PASS.
What the prereg buys is that the thresholds, the radius, the formula, and the abstain conditions are
fixed in writing before the numbers are computed, so the verdict cannot be tuned afterwards.

## Target and inputs

- Galaxy: NGC 3198. Fallback: NGC 2403 if NGC 3198 is absent from the archive.
- Primary input: `NGC3198_rotmod.dat` from `Rotmod_LTG.zip`, https://astroweb.case.edu/SPARC/Rotmod_LTG.zip
  (Lelli, McGaugh & Schombert 2016, AJ 152, 157; arXiv:1606.09251).
- Secondary input: `SPARC_Lelli2016c.mrt` (Table1) for the published distance and V_flat.
- Every downloaded file gets its URL and sha256 recorded.

## Formula and fiducial mass-to-light ratios

- Baryonic velocity, SPARC paper eq. (2):
  V_bar = sqrt( |V_gas| V_gas + Y_disk |V_disk| V_disk + Y_bul |V_bul| V_bul ).
- Y_disk = 0.5 and Y_bul = 0.7 M_sun/L_sun at 3.6 um. Source: SPARC paper Section 5.3.1 and the
  Figure 5 caption ("adopting Y_disk = 0.5 M_sun/L_sun and Y_bul = 0.7 M_sun/L_sun").
- Assumption to be confirmed from the file header or Table2 ReadMe: the tabulated V_disk and V_bul are
  computed for Y = 1. If the file states a different normalisation, rescale accordingly and log it.
  If the normalisation cannot be determined from the files, C2 is INSUFFICIENT.

## Fixed parameters

- R = 10 kpc.
- X = 10 km/s (flatness tolerance).
- Y = 30 km/s (minimum baryonic excess).
- N_min = 5 points at radius >= R, else INSUFFICIENT.

## Claims and decision rules (central values decide)

Let S = all rows with Rad >= R.

- **C1 flatness.** "The observed rotation curve of NGC 3198 is flat within X = 10 km/s beyond
  R = 10 kpc." Let m = median(V_obs over S). PASS if max over S of |V_obs - m| <= 10 km/s.
  FAIL otherwise. INSUFFICIENT if |S| < 5 or the Rad/Vobs columns are missing or non-numeric.
- **C2 baryonic excess.** "The observed velocity exceeds the baryonic prediction (Y_disk = 0.5,
  Y_bul = 0.7) by at least Y = 30 km/s at every point beyond R = 10 kpc." PASS if
  min over S of (V_obs - V_bar) >= 30 km/s. FAIL otherwise. INSUFFICIENT if |S| < 5, any of
  Vgas/Vdisk/Vbul is missing, or the normalisation question above is unresolved.
- **C3 published V_flat replay.** Recompute V_f for NGC 3198 from the V_obs column with the algorithm
  of Lelli, McGaugh & Schombert 2016, ApJL 816, L14 (arXiv:1512.04543) Section 2.2: start with the
  mean of the two outermost points; while |V_(next inward) - mean| / mean <= 0.05, include that point in
  the mean and step inward; return the mean when the condition fails. Reading of "includes V_N-2 in the
  estimate": the running mean is recomputed over all included points. PASS if
  |V_f(recomputed) - V_flat(Table1)| <= 1.0 km/s. FAIL otherwise. INSUFFICIENT if Table1 lacks the
  galaxy or the first iteration fails (the paper rejects such curves).

## Reported but NOT decisive

- C1e: error-aware flatness, |V_obs - m| <= X + errV per point.
- C2e: conservative excess, (V_obs - errV) - V_bar >= Y per point.
- C2s: C2 recomputed at Y_disk = 0.7 (the paper's mean maximum-disk value for bright galaxies) to show
  how the verdict depends on the mass-to-light ratio.
- C0: the distance in the rotmod header vs Table1 distance (consistency only).

## Outputs

- `plots/ngc3198-rotation-curve.png`: V_obs with error bars, V_gas, Y-scaled V_disk and V_bul, V_bar,
  a vertical line at R, and the C1 band m +/- X.
- `scratch/recompute.py` plus its JSON result `scratch/recompute-result.json`.

## AMENDMENTS

(none at freeze)

- 2026-10-04T03:1xZ, parser only, no claim or threshold changed. Table1 (`SPARC_Lelli2016c.mrt`)
  declares a 113-byte fixed-width layout with Vflat at bytes 87-91, but all 175 data rows are
  131 bytes and the fields sit at other offsets. A byte-offset read failed on NGC 3198
  (`ValueError: could not convert string to float: '5  13.'`). Every row splits into exactly
  19 whitespace fields in the declared label order, so Table1 is parsed by whitespace. The
  frozen-at-writing sha256 of this file (before this amendment) was
  47209b9d0a446201ca8564d4487287578bcc52022eb925ecc8f1cdd551ce722d.
