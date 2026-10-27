/**
 * Per-value quality-flag schemes (engine 0.5.0, 2026-10-04; docs/CHOICES.md, docs/EVIDENCE.md).
 *
 * A value may carry its own quality flag in its provenance (`qc: { scheme, flag, meaning? }`). The scheme says what each flag
 * means, quoted from its source; a ruleset's flags choice says which flags compute, hold or strike. A flag grades the
 * MEASUREMENT, a tier grades the READING: the two are separate axes, and a flag never changes a tier.
 *
 * Each scheme lives in a JSON file beside this module (./argo-qc.json), the human-readable source of truth. This module carries a
 * verbatim copy of it, so the built engine reads no file at run time; test/cena-choice-ledger.test.ts keeps the two equal and
 * pins the file's sha256. The first scheme is Argo's Reference table 2.
 */

export interface QcFlagMeaning { meaning: string; real_time: string; delayed_mode: string }
export interface QcScheme {
  scheme: string
  title: string
  source: { citation: string; doi: string; url: string; pdf_sha256: string; text: { made_by: string; sha256: string; lines: string }; vocabularies: string[]; quoted_as: string }
  flags: Record<string, QcFlagMeaning>
}

/** Argo's quality control flag scale, Reference table 2 of the Argo user's manual v3.44.0 (a copy of ./argo-qc.json). */
export const ARGO_QC: QcScheme = {
  "scheme": "argo",
  "title": "Argo quality control flag scale (Reference table 2)",
  "source": {
    "citation": "Argo Data Management Team, Argo user's manual, version 3.44.0, July 2025, Section 3.2.1 \"Reference table 2: quality control flag scale\", page 76",
    "doi": "10.13155/29825",
    "url": "https://archimer.ifremer.fr/doc/00187/29825/120885.pdf",
    "pdf_sha256": "03012315be2f1fd9814c083268e630981ccc94ec2728adb3b24256e3758dabf1",
    "text": {
      "made_by": "pdftotext 4.00 -raw (default Latin1 encoding) of the PDF above; CRLF line ends",
      "sha256": "efc8295d68440bc8e2b3305632c306fb2a99809daaca7004cce31f885af1fc40",
      "lines": "5533-5594"
    },
    "vocabularies": [
      "https://vocab.nerc.ac.uk/collection/RR2/current",
      "https://vocab.nerc.ac.uk/collection/RD2/current"
    ],
    "quoted_as": "each text is the table cell as the extraction prints it, its line breaks joined by one space; nothing else is changed"
  },
  "flags": {
    "0": {
      "meaning": "No QC is performed",
      "real_time": "No QC is performed.",
      "delayed_mode": "No QC is performed."
    },
    "1": {
      "meaning": "Good data",
      "real_time": "Good data. All Argo real-time QC tests passed. These measurements are good within the limits of the Argo real-time QC tests.",
      "delayed_mode": "Good data. No adjustment is needed, or the adjusted value is statistically consistent with good quality reference data. An error estimate is supplied."
    },
    "2": {
      "meaning": "Probably good data",
      "real_time": "Probably good data. These measurements are to be used with caution.",
      "delayed_mode": "Probably good data. Delayed-mode evaluation is based on insufficient information. An error estimate is supplied."
    },
    "3": {
      "meaning": "Probably bad data that are potentially adjustable",
      "real_time": "Probably bad data. These measurements are not to be used without scientific adjustment, e.g. data affected by sensor drift but may be adjusted in delayed-mode.",
      "delayed_mode": "Probably bad data. An adjustment may (or may not) have been applied, but the value may still be bad. An error estimate is supplied."
    },
    "4": {
      "meaning": "Bad data",
      "real_time": "Bad data. These measurements are not to be used. A flag '4' indicates that a relevant real-time qc test has failed. A flag '4' may also be assigned for bad measurements that are known to be not adjustable, e.g. due to sensor failure.",
      "delayed_mode": "Bad data. Not adjustable. Adjusted data are replaced by FillValue."
    },
    "5": {
      "meaning": "Value changed",
      "real_time": "Value changed",
      "delayed_mode": "Value changed"
    },
    "6": {
      "meaning": "Not used",
      "real_time": "Not used",
      "delayed_mode": "Not used"
    },
    "7": {
      "meaning": "Not used",
      "real_time": "Not used",
      "delayed_mode": "Not used"
    },
    "8": {
      "meaning": "Estimated value",
      "real_time": "Estimated value (interpolated, extrapolated or other estimation).",
      "delayed_mode": "Estimated value (interpolated, extrapolated or other estimation)."
    },
    "9": {
      "meaning": "Missing value",
      "real_time": "Missing value. Data parameter will record FillValue.",
      "delayed_mode": "Missing value. Data parameter will record FillValue."
    },
    " ": {
      "meaning": "FillValue",
      "real_time": "Empty space in NetCDF file.",
      "delayed_mode": "Empty space in NetCDF file*."
    }
  }
}

/** Every scheme this build carries, by name. */
export const QC_SCHEMES: Readonly<Record<string, QcScheme>> = Object.freeze({ argo: ARGO_QC })

/** A flag as a scheme keys it: a number 0-9 or a one-character string, as text (4 and "4" are flag "4"). */
export function qcFlagKey(flag: unknown): string | undefined {
  if (typeof flag === 'number' && Number.isInteger(flag) && flag >= 0 && flag <= 9) return String(flag)
  if (typeof flag === 'string' && flag.length === 1) return flag
  return undefined
}
