# PREREG: SCI-R2, Argo per-profile mixed-layer replay for one float, with and without QC flags

Written 2026-10-04T03:45Z (2026-10-03 local), BEFORE any data file was downloaded or opened.
At writing time `data/` is empty. What has been fetched is documentation only: the Argo user's
manual 3.44.0, the Argo QC manual 3.9, the NVS flag vocabularies RR2/RD2/RP2, Argo web pages,
the mixedlayer.ucsd.edu landing page, Crossref metadata for the two papers, and the published
MATLAB code of Holte & Talley (2009) (`jaot09_holte_mld_algorithm_files.zip`). The demo Argo
`.nc` files bundled inside that zip were NOT extracted or opened. HEAD requests (sizes, ETags) were
made on the database files; no byte of their content has been read.

This file is frozen once its sha256 is written to `PREREG.sha256`. Amendments go in a dated
AMENDMENTS section at the bottom and do not rewrite anything above it.

## Status: BLIND to the values, NOT blind to the method

I have never seen this database's values or any profile of the float that will be selected. The
float is chosen by a mechanical rule below. I have read the 2009 code, so I expect agreement where
the database used that code on the same bytes. The main risk I can name in advance is method
drift: the 2017 database may differ from the 2009 code (equation of state, QC screening). The
Wiley paper (Holte et al. 2017) returned HTTP 403 to every scripted request, so its methods
section is NOT read. Only its abstract (Crossref JSON) and the code are known.

## The claims under test

The publication: Holte, J., L. D. Talley, J. Gilson, and D. Roemmich (2017), An Argo mixed layer
climatology and database, Geophys. Res. Lett., 44, 5618-5626, doi:10.1002/2017GL073426.
Abstract, verbatim from Crossref: "A global climatology and database of mixed layer properties are
computed from nearly 1,250,000 Argo profiles." and "The individual profile results in the database
can be used to construct time series of mixed layer properties in specific regions of interest."

The published table: `Argo_mixedlayers_all_03192017.nc`, https://mixedlayer.ucsd.edu/data/Argo_mixedlayers_all_03192017.nc
(HEAD: 177,301,124 bytes; ETag "a916684-54bb9989f2076"; Last-Modified Mon, 27 Mar 2017 17:23:05 GMT).
This is the March 2017 version, the one contemporaneous with the paper. The 2022 version is
317 MB as netCDF, over the 200 MB cap, so it is not used.

- **C0, table-level count (decisive).** N_valid = number of database rows with a valid
  density-threshold MLD (finite, not 9999, not the variable's _FillValue). PASS if
  1,187,500 <= N_valid <= 1,250,000 ("nearly" read as at most 5% below, never above). FAIL otherwise.
  INSUFFICIENT if the density-threshold MLD variable cannot be identified unambiguously from the
  file's own variable names and attributes. N_all (all rows) is reported, not decisive.
- **C1, per-profile density-threshold MLD (decisive).** For float F (rule S below), let M be the
  set of profiles matched between the database (valid MLD) and pipeline P-QC (not rejected).
  A profile agrees if |MLD_QC - MLD_DB| <= max(2.0 dbar, 0.02 * MLD_DB).
  PASS if |M| >= 20 and at least 90% of M agree. FAIL if |M| >= 20 and fewer than 90% agree.
  INSUFFICIENT if |M| < 20, if F is absent from the database, or if the MLD variable cannot be
  identified.
- **C2, per-profile mixed-layer mean temperature over the density-threshold MLD (decisive).**
  Restricted to profiles of M that agree under C1 AND for which no admissible measured level lies
  between MLD_QC and MLD_DB (so both averages run over the same levels).
  A profile agrees if |MLT_QC - MLT_DB| <= 0.01 degC.
  PASS if that restricted set has >= 20 profiles and at least 90% agree. FAIL if >= 20 and fewer
  than 90% agree. INSUFFICIENT if fewer than 20.
  The temperature compared is chosen by the database variable's declared long_name/units, before
  looking at its values: "conservative" means Conservative Temperature, which needs TEOS-10; I have
  no TEOS-10 implementation permitted, so C2 is then INSUFFICIENT. "potential" means potential
  temperature referenced to 0 dbar (EOS-80 `ptmp`). Anything else means in-situ temperature, which
  is what the 2009 code averages.

## Inputs, pinned on download

- D1: the database file above. sha256 recorded in `MANIFEST.tsv`.
- D2: the GDAC profile index, https://data-argo.ifremer.fr/ar_index_global_prof.txt.gz (today's
  copy; it changes daily, so its sha256 is the pin).
- D3: float F's single-cycle core profile files, https://data-argo.ifremer.fr/dac/<dac>/<wmo>/profiles/<file>.
- D4 (screening only): candidate floats' multi-profile files, https://data-argo.ifremer.fr/dac/<dac>/<wmo>/<wmo>_prof.nc.
- Every downloaded file gets path, bytes, sha256, URL in `MANIFEST.tsv`. Nothing larger than 200 MB
  is saved.

## Float selection rule S (mechanical; every candidate examined is logged with its reason)

- S1. Parse D2. Keep core ascending profile files only: the file name is `[RD]<wmo>_<cycle>.nc`
  with no trailing `D` (descending) and no `B`/`S`/`M` prefix.
- S2. A float is eligible if ALL its kept profile files start with `D` (delayed mode), ALL have
  date_update earlier than 20170301000000 (so today's bytes are the bytes the March 2017 database
  read), and it has at least 30 kept profiles.
- S3. Order eligible floats by ascending WMO number. For each in order, require (a) at least 30 rows
  for that WMO in D1, and (b) in its multi-profile file D4, at least one level with PRES_ADJUSTED <=
  1000 dbar where any of PRES_ADJUSTED_QC, TEMP_ADJUSTED_QC, PSAL_ADJUSTED_QC is not '1' while the
  matching raw value (PRES, TEMP or PSAL) is not FillValue. Criterion (b) makes the QC control
  able to move; it says nothing about the direction of any result.
- S4. F is the first float meeting S3. At most 40 candidates are examined. If none meets S3(b),
  F is the first candidate meeting S3(a), and the report says the control could not move.
- S5. If no float is eligible under S2, relax the date_update cut to 20170319000000 and say so. If
  still none, the recompute is INSUFFICIENT for C1/C2 (C0 still runs).

## Profile reading (all pipelines)

- Use one profile per file: the N_PROF index whose VERTICAL_SAMPLING_SCHEME starts with
  "Primary sampling"; if that variable is absent, index 0.
- Match a database row to a file by WMO and CYCLE_NUMBER (if the database's profile number is
  the cycle number). Confirm with |dlat| <= 0.001 deg, |dlon| <= 0.001 deg (mod 360), and |dt| <=
  1 minute after converting the database date with its declared units. If the profile number is
  not the cycle number, match by date and position under the same tolerances. Unconfirmed or
  ambiguous rows are excluded and counted.

## The three pipelines

Threshold algorithm, shared, transcribed from the published 2009 `findmld.m`:
1. Reference index = the first level minimising (p - 10)^2. Drop levels above it.
2. sigma = pden(S, T, p, 0) - 1000, EOS-80 (`seawater` 3.3.5, vendored as source under
   `scratch/vendor/`, wheel sha256 765aa6b6a82db3d4e9232313420e4d665218d8863a383f5bc4dd49d5f1f0c1d1;
   self-test against its docstring example: max difference 4.8e-9 kg/m^3).
3. j = the first level with |sigma_ref - sigma_j| > 0.03; if none, j = the last level.
4. Fit a line through (p_{j-1}, sigma_ref - sigma_{j-1}) and (p_j, sigma_ref - sigma_j); evaluate on
   p_{j-1} : 0.5 : p_j (MATLAB colon semantics); MLD = the largest grid pressure with |fit| < 0.03.
5. MLT = mean of T over levels (after step 1) with p < MLD, ignoring NaN.

- **P-PUB (method replica, diagnostic, not decisive).** The 2009 `loadargo.m` exactly: adjusted
  P/T/S when PRES_ADJUSTED at the first level is not fill, else raw; truncate at the first fill in
  T, then S, then P (reject if that index, 1-based, is < 5); reject if fewer than 5 levels, if the
  first positive pressure is > 20 dbar, or if sum(p) == 0. No QC flag is read.
- **P-QC (decisive for C1/C2).** Argo's own recommendation for mixed-layer work (Argo data FAQ,
  quoted verbatim in the report): D-mode profiles only, ADJUSTED variables only, a level is
  admissible iff PRES_ADJUSTED_QC, TEMP_ADJUSTED_QC and PSAL_ADJUSTED_QC are all '1' and all three
  values are not fill; a profile whose PRES_ADJUSTED_ERROR exceeds 20 dbar at any admissible level is
  rejected. Non-admissible levels are dropped, not truncated. Reject if fewer than 5 admissible
  levels or if the shallowest admissible pressure is > 20 dbar.
- **P-RAW (the control: QC ignored).** Raw PRES/TEMP/PSAL, every level whose three values are not
  fill, no flag read, no adjustment. Same reject rules as P-QC.
- Reported, not decisive: P-QC12 (flags 1 and 2 admissible) and P-ADJ (adjusted values, no flag
  read, fills dropped) to separate the effect of the flags from the effect of the adjustment.

## What is reported for the control

For P-RAW and P-ADJ against P-QC and against the database: the number of profiles whose MLD moves
by more than the C1 tolerance, the median and maximum |dMLD|, the number whose MLT moves by more
than 0.01 degC, and the C1/C2 verdicts recomputed with the control in place of P-QC. These control
verdicts are descriptive; they do not replace C1/C2.

## Formal checks (diagnostic counts, not verdicts)

On F's profile files: PROFILE_<PARAM>_QC recomputed by reference table 2a; D-mode rule "whenever
<PARAM>_ADJUSTED_QC = '4', <PARAM>_ADJUSTED = FillValue and <PARAM>_ADJUSTED_ERROR = FillValue";
flag-1 values inside declared valid_min/valid_max; QC characters inside the reference-table set,
with no '6'/'7'; flag-1 pressures strictly increasing; DATA_MODE consistent with the file prefix;
DATA_STATE_INDICATOR '2C' or '2C+' in D files; units and conventions attributes as the manual
declares them. On D1: declared attributes against content.

## Outputs

`scratch/select_float.py`, `scratch/recompute.py`, `scratch/recompute-result.json`,
`plots/mld-timeseries.png` (database vs P-QC vs P-RAW, with differences), `plots/qc-profile.png`
(one profile where flags exclude levels).

## AMENDMENTS

(none at freeze)

### A1, 2026-10-04T04:05Z, after the frozen run. Diagnostics only; no decisive rule changes.

Decisive results as frozen, recorded before any diagnostic below was run:
C0 FAIL (N_valid 1,385,119), C1 INSUFFICIENT and C2 INSUFFICIENT (F = WMO 19019; P-QC admits
0 levels on all 269 profiles because every adjusted flag is '2', TNPD). These stand.

Seen after freeze, motivating the diagnostics: the database declares `dt_mld` in "meters" and its
smallest `tt_mld` is 0.99333, the depth of 1 dbar, so its MLDs are depths, not pressures. The
frozen comparison (dbar against the database number) is kept as the decisive form. The 2009 code
replica (P-PUB) agrees with the database on 100 of 259 MLDs and 0 of 100 MLTs. Its MLDs are
shallower in steps of 0.5 dbar, and its MLTs are always warmer, by 0.05 to 0.23 degC.

Post-hoc diagnostic variants, labelled as such wherever reported, never verdicts:
- D-depth: my MLD converted to depth (EOS-80 `dpth`, or TEOS-10 `z_from_p`, whichever
  reproduces the database's own pressure-to-depth conversion on rows where it can be inferred).
- D-TEOS: TEOS-10 via vendored pure-Python `gsw` 3.0.6 (PyPI sdist sha256
  ffe8496c61bb3cf488316f6444234a69f7cd6884fb04ff7b4889a773fbed4f44, workspace source only, nothing
  installed): sigma0 from (SA, CT) in place of EOS-80 pden, and MLT as the mean Conservative
  Temperature. Tested to see whether the database is replayable at all, and with what.
- If a variant reproduces the database, the same variant may be run on a second float chosen by
  rule S plus one added criterion written here before its files are downloaded: S3(c) at least
  20 profiles with >= 5 levels whose three adjusted flags are all '1'. Candidates continue in
  ascending WMO order after 19019. Its result is labelled post-hoc and does not replace C1/C2.

### A2, written before any second-float file is downloaded. Post-hoc; not a verdict.

A1's diagnostics found that no density definition tried reproduces the database's `dt_mld` (at most
1 of 259 exact). The temperature-threshold column `tt_mld` replays exactly (256 of 259) as the 2009
algorithm on Conservative Temperature, 0.2 degC, with TEOS-10 depth `-z_from_p`. The means `dt_mlt`,
`dt_mls`, `dt_mlpd` replay (about 190 of 259 to 1e-4) as the means of CT, Absolute Salinity and
TEOS-10 sigma0 above the database's own MLD.

So the second-float demonstration under A1 uses the column that replays:
- F2 = the first float after 19019 in the S2 list (ascending WMO) meeting S3(a), S3(b) and
  S3(c) (at least 20 profiles with >= 5 levels whose three adjusted flags are all '1').
- Each pipeline (P-PUB, P-QC, P-QC12, P-ADJ, P-RAW, level rules as frozen) computes the CT
  0.2 degC threshold MLD, converted with -z_from_p. Each is compared to `tt_mld` with the C1 form:
  agree if |d| <= max(2 m, 2%). "Replays" means at least 90% of at least 20 matched profiles agree.
  These are labels, not verdicts.
- The control is reported as frozen: how many profiles move beyond tolerance from P-QC to
  P-RAW, with the median and maximum |d|.

Erratum (appended at A2 time): A1's header time "04:05Z" was typed ahead of the clock. A1 was
written after the frozen run and before A2 (04:00Z by `date -u`); its hash line in `PREREG.sha256`
carries the same mistyped time. No content of A1 is changed.
