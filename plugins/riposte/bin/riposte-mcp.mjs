#!/usr/bin/env node
import { createRequire as __riposteRequire } from 'node:module'; const require = __riposteRequire(import.meta.url);

// packages/receipts/src/stdio.ts
import { createInterface } from "node:readline";
import { readFileSync as readFileSync3 } from "node:fs";
import { join } from "node:path";

// packages/receipts/src/mcp.ts
import { readFileSync } from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";

// packages/verify/src/binding/forensic-normalizer.ts
function normalizeDate(value, options = {}) {
  const { locale = "US", trackAmbiguity = true } = options;
  if (value === null || value === void 0 || value === "") {
    return null;
  }
  const transformations = [];
  let originalValue = null;
  if (value instanceof Date) {
    originalValue = value;
    if (isNaN(value.getTime())) {
      return {
        original: originalValue,
        normalized: "",
        transformations: ["invalid_date_object"],
        success: false,
        error: "Invalid Date object"
      };
    }
    transformations.push("date_object_converted");
    return {
      original: originalValue,
      normalized: formatDateISO(value),
      transformations,
      success: true
    };
  }
  if (typeof value === "number") {
    originalValue = value;
    const date = new Date(value);
    if (isNaN(date.getTime())) {
      return {
        original: originalValue,
        normalized: "",
        transformations: ["invalid_timestamp"],
        success: false,
        error: "Invalid timestamp"
      };
    }
    transformations.push("timestamp_converted");
    return {
      original: originalValue,
      normalized: formatDateISO(date),
      transformations,
      success: true
    };
  }
  if (typeof value !== "string") {
    return null;
  }
  originalValue = value;
  const input = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    return finishDate(originalValue, input, ["already_iso"]);
  }
  const isoWithTimeMatch = input.match(/^(\d{4}-\d{2}-\d{2})T/);
  if (isoWithTimeMatch) {
    transformations.push("time_stripped");
    return finishDate(originalValue, isoWithTimeMatch[1], transformations);
  }
  const usMatch = input.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (usMatch) {
    const [, first, second, yearPart] = usMatch;
    const year = yearPart.length === 2 ? `20${yearPart}` : yearPart;
    const f = parseInt(first, 10);
    const s2 = parseInt(second, 10);
    if (f > 12 && s2 <= 12) {
      transformations.push("european_format_parsed");
      return finishDate(originalValue, `${year}-${second.padStart(2, "0")}-${first.padStart(2, "0")}`, transformations);
    }
    if (f > 12 || s2 > 31) {
      return { original: originalValue, normalized: "", transformations: ["parse_failed"], success: false, error: `Could not parse date: ${input}` };
    }
    const ambiguous = f <= 12 && s2 <= 12 && f !== s2;
    if (ambiguous && trackAmbiguity) transformations.push("AMBIGUOUS_DATE");
    if (locale === "EU" && s2 <= 12) {
      transformations.push("european_format_applied");
      return finishDate(originalValue, `${year}-${second.padStart(2, "0")}-${first.padStart(2, "0")}`, transformations);
    }
    transformations.push("us_format_parsed");
    return finishDate(originalValue, `${year}-${first.padStart(2, "0")}-${second.padStart(2, "0")}`, transformations);
  }
  const euroMatch = input.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/);
  if (euroMatch) {
    const [, first, second, year] = euroMatch;
    const firstNum = parseInt(first, 10);
    const secondNum = parseInt(second, 10);
    if (firstNum > 12) {
      transformations.push("european_format_parsed");
      return finishDate(originalValue, `${year}-${second.padStart(2, "0")}-${first.padStart(2, "0")}`, transformations);
    }
    if (secondNum > 12) {
      transformations.push("us_format_parsed");
      return finishDate(originalValue, `${year}-${first.padStart(2, "0")}-${second.padStart(2, "0")}`, transformations);
    }
    const isAmbiguous = firstNum <= 12 && secondNum <= 12 && firstNum !== secondNum;
    if (isAmbiguous && trackAmbiguity) {
      transformations.push("AMBIGUOUS_DATE");
    }
    if (locale === "EU") {
      transformations.push("european_format_applied");
      return finishDate(originalValue, `${year}-${second.padStart(2, "0")}-${first.padStart(2, "0")}`, transformations);
    } else {
      transformations.push("us_format_defaulted");
      return finishDate(originalValue, `${year}-${first.padStart(2, "0")}-${second.padStart(2, "0")}`, transformations);
    }
  }
  const textMonthMatch = input.match(
    /^(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})$/i
  );
  if (textMonthMatch) {
    const [, monthName, day, year] = textMonthMatch;
    const month = parseMonthName(monthName);
    if (month) {
      transformations.push("text_month_parsed");
      return finishDate(originalValue, `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`, transformations);
    }
  }
  const parsed = new Date(input);
  if (!isNaN(parsed.getTime())) {
    transformations.push("native_date_parsed");
    return {
      original: originalValue,
      normalized: formatDateISO(parsed),
      transformations,
      success: true
    };
  }
  return {
    original: originalValue,
    normalized: "",
    transformations: ["parse_failed"],
    success: false,
    error: `Could not parse date: ${input}`
  };
}
function finishDate(original, iso2, transformations) {
  const t = Date.parse(iso2);
  if (isNaN(t) || new Date(t).toISOString().slice(0, 10) !== iso2) {
    return { original, normalized: "", transformations: [...transformations, "invalid_calendar_date"], success: false, error: `Not a calendar date: ${iso2}` };
  }
  return { original, normalized: iso2, transformations, success: true };
}
function parseMonthName(name) {
  const months = {
    jan: "01",
    january: "01",
    feb: "02",
    february: "02",
    mar: "03",
    march: "03",
    apr: "04",
    april: "04",
    may: "05",
    jun: "06",
    june: "06",
    jul: "07",
    july: "07",
    aug: "08",
    august: "08",
    sep: "09",
    sept: "09",
    september: "09",
    oct: "10",
    october: "10",
    nov: "11",
    november: "11",
    dec: "12",
    december: "12"
  };
  return months[name.toLowerCase()] || null;
}
function formatDateISO(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
function normalizeReference(value) {
  if (value === null || value === void 0 || value === "") {
    return null;
  }
  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }
  const original = String(value);
  const transformations = [];
  let normalized = original.trim();
  if (normalized !== original) {
    transformations.push("whitespace_trimmed");
  }
  const uppercased = normalized.toUpperCase();
  if (uppercased !== normalized) {
    transformations.push("uppercased");
    normalized = uppercased;
  }
  const cleaned = normalized.replace(/[^A-Z0-9]/g, "");
  if (cleaned !== normalized) {
    transformations.push("special_chars_removed");
    normalized = cleaned;
  }
  if (normalized.length === 0) {
    return {
      original,
      normalized: "",
      transformations: ["empty_after_normalization"],
      success: false,
      error: "Reference is empty after normalization"
    };
  }
  return {
    original,
    normalized,
    transformations: transformations.length > 0 ? transformations : ["no_changes"],
    success: true
  };
}
function foldDigits(s) {
  let folded = false;
  const out = Array.from(s, (ch) => {
    const c = ch.codePointAt(0);
    if (c >= 65296 && c <= 65305) {
      folded = true;
      return String(c - 65296);
    }
    if (c >= 1632 && c <= 1641) {
      folded = true;
      return String(c - 1632);
    }
    if (c >= 1776 && c <= 1785) {
      folded = true;
      return String(c - 1776);
    }
    if (c >= 2406 && c <= 2415) {
      folded = true;
      return String(c - 2406);
    }
    if (c >= 2534 && c <= 2543) {
      folded = true;
      return String(c - 2534);
    }
    if (c >= 3664 && c <= 3673) {
      folded = true;
      return String(c - 3664);
    }
    if (c === 65294) {
      folded = true;
      return ".";
    }
    if (c === 65292) {
      folded = true;
      return ",";
    }
    return ch;
  }).join("");
  return { text: out, folded };
}
var CJK_DIGIT = {
  "\u3007": 0,
  "\u96F6": 0,
  "\u4E00": 1,
  "\u58F9": 1,
  "\u4E8C": 2,
  "\u8CB3": 2,
  "\u8D30": 2,
  "\u5169": 2,
  "\u4E24": 2,
  "\u4E09": 3,
  "\u53C3": 3,
  "\u53C1": 3,
  "\u53C4": 3,
  "\u56DB": 4,
  "\u8086": 4,
  "\u4E94": 5,
  "\u4F0D": 5,
  "\u516D": 6,
  "\u9678": 6,
  "\u9646": 6,
  "\u4E03": 7,
  "\u67D2": 7,
  "\u516B": 8,
  "\u634C": 8,
  "\u4E5D": 9,
  "\u7396": 9
};
var CJK_SMALL = { "\u5341": 10, "\u62FE": 10, "\u767E": 100, "\u4F70": 100, "\u5343": 1e3, "\u4EDF": 1e3 };
var CJK_BIG = { "\u4E07": 1e4, "\u842C": 1e4, "\u5104": 1e8, "\u4EBF": 1e8, "\u5146": 1e12 };
var CJK_STRIP = /[円圓圆元圜￥¥整正也\s,]/g;
function parseCjkNumeral(input) {
  const s = input.replace(CJK_STRIP, "");
  if (s === "") return null;
  let hasCjk = false;
  for (const ch of s) if (ch in CJK_DIGIT || ch in CJK_SMALL || ch in CJK_BIG) {
    hasCjk = true;
    break;
  }
  if (!hasCjk) return null;
  let total = 0, section = 0, num4 = 0;
  let lastBig = Infinity, lastSmall = Infinity;
  for (const ch of s) {
    if (ch >= "0" && ch <= "9") {
      num4 = num4 * 10 + (ch.charCodeAt(0) - 48);
      continue;
    }
    if (ch in CJK_DIGIT) {
      num4 = num4 * 10 + CJK_DIGIT[ch];
      continue;
    }
    if (ch in CJK_SMALL) {
      const u = CJK_SMALL[ch];
      if (u >= lastSmall) return null;
      lastSmall = u;
      section += (num4 === 0 ? 1 : num4) * u;
      num4 = 0;
      continue;
    }
    if (ch in CJK_BIG) {
      const b = CJK_BIG[ch];
      if (b >= lastBig) return null;
      lastBig = b;
      section += num4;
      if (section === 0) return null;
      total += section * b;
      section = 0;
      num4 = 0;
      lastSmall = Infinity;
      continue;
    }
    return null;
  }
  section += num4;
  total += section;
  return Number.isFinite(total) ? total : null;
}
function normalizeAmount(value) {
  return parseMoney(value, true);
}
function normalizePrice(value) {
  return parseMoney(value, false);
}
function parseMoney(value, toCents) {
  if (value === null || value === void 0 || value === "") {
    return null;
  }
  const transformations = [];
  let original = null;
  if (typeof value === "number") {
    original = value;
    if (isNaN(value)) {
      return {
        original,
        normalized: 0,
        transformations: ["invalid_nan"],
        success: false,
        error: "Value is NaN"
      };
    }
    const rounded2 = toCents ? Math.round(value * 100) / 100 : value;
    if (rounded2 !== value) {
      transformations.push("rounded_to_2_decimals");
    }
    return {
      original,
      normalized: rounded2,
      transformations: transformations.length > 0 ? transformations : ["already_number"],
      success: true
    };
  }
  if (typeof value !== "string") {
    return null;
  }
  original = value;
  let cleaned = value.trim();
  {
    const fd = foldDigits(cleaned);
    cleaned = fd.text;
    if (fd.folded) transformations.push("non_ascii_digits_folded");
  }
  {
    const cjk = parseCjkNumeral(cleaned);
    if (cjk !== null) {
      cleaned = String(cjk);
      transformations.push("cjk_numerals_parsed");
    }
  }
  let isNegative = false;
  if (cleaned.startsWith("(") && cleaned.endsWith(")")) {
    isNegative = true;
    cleaned = cleaned.slice(1, -1);
    transformations.push("parentheses_negative");
  }
  if (cleaned.endsWith("-")) {
    isNegative = true;
    cleaned = cleaned.slice(0, -1);
    transformations.push("trailing_minus");
  }
  if (cleaned.startsWith("-")) {
    isNegative = true;
    cleaned = cleaned.slice(1);
    transformations.push("leading_minus");
  }
  const beforeCurrency = cleaned;
  cleaned = cleaned.replace(/^[^0-9.\-,]+|[^0-9.\-,]+$/g, "");
  if (cleaned !== beforeCurrency) {
    transformations.push("currency_symbols_removed");
  }
  const lastComma = cleaned.lastIndexOf(",");
  const lastPeriod = cleaned.lastIndexOf(".");
  let detectedLocale = "unknown";
  if (lastComma > lastPeriod) {
    const afterComma = cleaned.substring(lastComma + 1);
    if (/^\d{1,2}$/.test(afterComma)) {
      detectedLocale = "EU";
    } else if (/^\d{3}$/.test(afterComma)) {
      detectedLocale = "US";
    }
  } else if (lastPeriod > lastComma) {
    const afterPeriod = cleaned.substring(lastPeriod + 1);
    if (/^\d{1,2}$/.test(afterPeriod)) {
      detectedLocale = "US";
    } else if (/^\d{3}$/.test(afterPeriod)) {
      if (/^0\./.test(cleaned)) {
        detectedLocale = "US";
      } else {
        detectedLocale = "EU";
      }
    }
  }
  if (detectedLocale === "unknown") {
    if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(cleaned)) {
      detectedLocale = "EU";
    } else if (/^\d+,\d{1,2}$/.test(cleaned)) {
      detectedLocale = "EU";
    } else {
      detectedLocale = "US";
    }
  }
  if (detectedLocale === "EU") {
    cleaned = cleaned.replace(/\./g, "");
    cleaned = cleaned.replace(",", ".");
    transformations.push("european_format_converted");
  } else {
    const beforeCommaRemoval = cleaned;
    cleaned = cleaned.replace(/,/g, "");
    if (cleaned !== beforeCommaRemoval) {
      transformations.push("thousands_separators_removed");
    }
  }
  const parts = cleaned.split(".");
  if (parts.length > 2) {
    cleaned = parts.slice(0, -1).join("") + "." + parts[parts.length - 1];
    transformations.push("multiple_decimals_fixed");
  }
  const parsed = parseFloat(cleaned);
  if (isNaN(parsed)) {
    return {
      original,
      normalized: 0,
      transformations: ["parse_failed"],
      success: false,
      error: `Could not parse amount: ${value}`
    };
  }
  let result = isNegative ? -parsed : parsed;
  const rounded = toCents ? Math.round(result * 100) / 100 : result;
  if (rounded !== result) {
    transformations.push("rounded_to_2_decimals");
    result = rounded;
  }
  return {
    original,
    normalized: result,
    transformations,
    success: true
  };
}
function normalizeQuantity(value) {
  if (value === null || value === void 0 || value === "") {
    return null;
  }
  const transformations = [];
  let original = null;
  if (typeof value === "number") {
    original = value;
    if (isNaN(value)) {
      return {
        original,
        normalized: 0,
        transformations: ["invalid_nan"],
        success: false,
        error: "Value is NaN"
      };
    }
    return {
      original,
      normalized: value,
      transformations: ["already_number"],
      success: true
    };
  }
  if (typeof value !== "string") {
    return null;
  }
  original = value;
  let cleaned = value.trim().toLowerCase();
  {
    const fd = foldDigits(cleaned);
    cleaned = fd.text;
    if (fd.folded) transformations.push("non_ascii_digits_folded");
  }
  {
    const cjk = parseCjkNumeral(cleaned);
    if (cjk !== null) {
      cleaned = String(cjk);
      transformations.push("cjk_numerals_parsed");
    }
  }
  const fractionMatch = cleaned.match(/^(\d+)\/(\d+)/);
  if (fractionMatch) {
    const numerator = parseInt(fractionMatch[1], 10);
    const denominator = parseInt(fractionMatch[2], 10);
    if (denominator !== 0) {
      transformations.push("fraction_converted");
      return {
        original,
        normalized: numerator / denominator,
        transformations,
        success: true
      };
    }
  }
  const rangeMatch = cleaned.match(/^(\d+(?:\.\d+)?)\s*[-–—to]\s*\d+/);
  if (rangeMatch) {
    transformations.push("range_first_value_used");
    return {
      original,
      normalized: parseFloat(rangeMatch[1]),
      transformations,
      success: true
    };
  }
  const unitSuffixes = [
    "hours?",
    "hrs?",
    "hr",
    "days?",
    "d",
    "minutes?",
    "mins?",
    "min",
    "units?",
    "un",
    "each",
    "ea",
    "pieces?",
    "pcs?",
    "pc",
    "pounds?",
    "lbs?",
    "lb",
    "gallons?",
    "gal",
    "miles?",
    "mi",
    "tons?"
  ];
  const unitPattern = new RegExp(`\\s*(${unitSuffixes.join("|")})\\s*$`, "i");
  const withoutUnit = cleaned.replace(unitPattern, "");
  if (withoutUnit !== cleaned) {
    transformations.push("unit_suffix_removed");
    cleaned = withoutUnit;
  }
  const numMatch = cleaned.match(/^-?\d*\.?\d+/);
  if (numMatch) {
    return {
      original,
      normalized: parseFloat(numMatch[0]),
      transformations: transformations.length > 0 ? transformations : ["number_extracted"],
      success: true
    };
  }
  return {
    original,
    normalized: 0,
    transformations: ["parse_failed"],
    success: false,
    error: `Could not parse quantity: ${value}`
  };
}
function normalizeRate(value) {
  if (value === null || value === void 0 || value === "") {
    return null;
  }
  const transformations = [];
  let original = null;
  let parsed;
  if (typeof value === "number") {
    original = value;
    if (isNaN(value)) {
      return { original, normalized: 0, transformations: ["invalid_nan"], success: false, error: "Value is NaN" };
    }
    parsed = value;
    transformations.push("already_number");
  } else if (typeof value === "string") {
    original = value;
    let cleaned = value.trim();
    {
      const fd = foldDigits(cleaned);
      cleaned = fd.text;
      if (fd.folded) transformations.push("non_ascii_digits_folded");
    }
    const hasPercentSign = cleaned.includes("%");
    if (hasPercentSign) {
      cleaned = cleaned.replace(/%/g, "");
      transformations.push("percent_sign_removed");
    }
    const beforeStrip = cleaned;
    cleaned = cleaned.replace(/[^0-9.,\-]/g, "");
    if (cleaned !== beforeStrip) transformations.push("non_numeric_removed");
    if (cleaned.includes(",") && !cleaned.includes(".")) {
      cleaned = cleaned.replace(",", ".");
      transformations.push("decimal_comma_converted");
    } else if (cleaned.includes(",")) {
      cleaned = cleaned.replace(/,/g, "");
      transformations.push("thousands_separators_removed");
    }
    parsed = parseFloat(cleaned);
    if (isNaN(parsed)) {
      return { original, normalized: 0, transformations: ["parse_failed"], success: false, error: `Could not parse rate: ${value}` };
    }
    if (hasPercentSign) {
      parsed = parsed / 100;
      transformations.push("percent_to_fraction");
    }
  } else {
    return null;
  }
  if (parsed > 1) {
    parsed = parsed / 100;
    transformations.push("percent_to_fraction_heuristic");
  }
  if (parsed < 0) {
    return { original, normalized: parsed, transformations: [...transformations, "negative_rate"], success: false, error: `Negative rate: ${value}` };
  }
  const normalized = Math.round(parsed * 1e9) / 1e9;
  return {
    original,
    normalized,
    transformations,
    success: true
  };
}

// node_modules/jsonpath-plus/dist/index-node-esm.js
import vm from "vm";
var Hooks = class {
  /**
   * @callback HookCallback
   * @this {*|Jsep} this
   * @param {Jsep} env
   * @returns: void
   */
  /**
   * Adds the given callback to the list of callbacks for the given hook.
   *
   * The callback will be invoked when the hook it is registered for is run.
   *
   * One callback function can be registered to multiple hooks and the same hook multiple times.
   *
   * @param {string|object} name The name of the hook, or an object of callbacks keyed by name
   * @param {HookCallback|boolean} callback The callback function which is given environment variables.
   * @param {?boolean} [first=false] Will add the hook to the top of the list (defaults to the bottom)
   * @public
   */
  add(name, callback, first) {
    if (typeof arguments[0] != "string") {
      for (let name2 in arguments[0]) {
        this.add(name2, arguments[0][name2], arguments[1]);
      }
    } else {
      (Array.isArray(name) ? name : [name]).forEach(function(name2) {
        this[name2] = this[name2] || [];
        if (callback) {
          this[name2][first ? "unshift" : "push"](callback);
        }
      }, this);
    }
  }
  /**
   * Runs a hook invoking all registered callbacks with the given environment variables.
   *
   * Callbacks will be invoked synchronously and in the order in which they were registered.
   *
   * @param {string} name The name of the hook.
   * @param {Object<string, any>} env The environment variables of the hook passed to all callbacks registered.
   * @public
   */
  run(name, env) {
    this[name] = this[name] || [];
    this[name].forEach(function(callback) {
      callback.call(env && env.context ? env.context : env, env);
    });
  }
};
var Plugins = class {
  constructor(jsep2) {
    this.jsep = jsep2;
    this.registered = {};
  }
  /**
   * @callback PluginSetup
   * @this {Jsep} jsep
   * @returns: void
   */
  /**
   * Adds the given plugin(s) to the registry
   *
   * @param {object} plugins
   * @param {string} plugins.name The name of the plugin
   * @param {PluginSetup} plugins.init The init function
   * @public
   */
  register(...plugins) {
    plugins.forEach((plugin2) => {
      if (typeof plugin2 !== "object" || !plugin2.name || !plugin2.init) {
        throw new Error("Invalid JSEP plugin format");
      }
      if (this.registered[plugin2.name]) {
        return;
      }
      plugin2.init(this.jsep);
      this.registered[plugin2.name] = plugin2;
    });
  }
};
var Jsep = class _Jsep {
  /**
   * @returns {string}
   */
  static get version() {
    return "1.4.0";
  }
  /**
   * @returns {string}
   */
  static toString() {
    return "JavaScript Expression Parser (JSEP) v" + _Jsep.version;
  }
  // ==================== CONFIG ================================
  /**
   * @method addUnaryOp
   * @param {string} op_name The name of the unary op to add
   * @returns {Jsep}
   */
  static addUnaryOp(op_name) {
    _Jsep.max_unop_len = Math.max(op_name.length, _Jsep.max_unop_len);
    _Jsep.unary_ops[op_name] = 1;
    return _Jsep;
  }
  /**
   * @method jsep.addBinaryOp
   * @param {string} op_name The name of the binary op to add
   * @param {number} precedence The precedence of the binary op (can be a float). Higher number = higher precedence
   * @param {boolean} [isRightAssociative=false] whether operator is right-associative
   * @returns {Jsep}
   */
  static addBinaryOp(op_name, precedence, isRightAssociative) {
    _Jsep.max_binop_len = Math.max(op_name.length, _Jsep.max_binop_len);
    _Jsep.binary_ops[op_name] = precedence;
    if (isRightAssociative) {
      _Jsep.right_associative.add(op_name);
    } else {
      _Jsep.right_associative.delete(op_name);
    }
    return _Jsep;
  }
  /**
   * @method addIdentifierChar
   * @param {string} char The additional character to treat as a valid part of an identifier
   * @returns {Jsep}
   */
  static addIdentifierChar(char) {
    _Jsep.additional_identifier_chars.add(char);
    return _Jsep;
  }
  /**
   * @method addLiteral
   * @param {string} literal_name The name of the literal to add
   * @param {*} literal_value The value of the literal
   * @returns {Jsep}
   */
  static addLiteral(literal_name, literal_value) {
    _Jsep.literals[literal_name] = literal_value;
    return _Jsep;
  }
  /**
   * @method removeUnaryOp
   * @param {string} op_name The name of the unary op to remove
   * @returns {Jsep}
   */
  static removeUnaryOp(op_name) {
    delete _Jsep.unary_ops[op_name];
    if (op_name.length === _Jsep.max_unop_len) {
      _Jsep.max_unop_len = _Jsep.getMaxKeyLen(_Jsep.unary_ops);
    }
    return _Jsep;
  }
  /**
   * @method removeAllUnaryOps
   * @returns {Jsep}
   */
  static removeAllUnaryOps() {
    _Jsep.unary_ops = {};
    _Jsep.max_unop_len = 0;
    return _Jsep;
  }
  /**
   * @method removeIdentifierChar
   * @param {string} char The additional character to stop treating as a valid part of an identifier
   * @returns {Jsep}
   */
  static removeIdentifierChar(char) {
    _Jsep.additional_identifier_chars.delete(char);
    return _Jsep;
  }
  /**
   * @method removeBinaryOp
   * @param {string} op_name The name of the binary op to remove
   * @returns {Jsep}
   */
  static removeBinaryOp(op_name) {
    delete _Jsep.binary_ops[op_name];
    if (op_name.length === _Jsep.max_binop_len) {
      _Jsep.max_binop_len = _Jsep.getMaxKeyLen(_Jsep.binary_ops);
    }
    _Jsep.right_associative.delete(op_name);
    return _Jsep;
  }
  /**
   * @method removeAllBinaryOps
   * @returns {Jsep}
   */
  static removeAllBinaryOps() {
    _Jsep.binary_ops = {};
    _Jsep.max_binop_len = 0;
    return _Jsep;
  }
  /**
   * @method removeLiteral
   * @param {string} literal_name The name of the literal to remove
   * @returns {Jsep}
   */
  static removeLiteral(literal_name) {
    delete _Jsep.literals[literal_name];
    return _Jsep;
  }
  /**
   * @method removeAllLiterals
   * @returns {Jsep}
   */
  static removeAllLiterals() {
    _Jsep.literals = {};
    return _Jsep;
  }
  // ==================== END CONFIG ============================
  /**
   * @returns {string}
   */
  get char() {
    return this.expr.charAt(this.index);
  }
  /**
   * @returns {number}
   */
  get code() {
    return this.expr.charCodeAt(this.index);
  }
  /**
   * @param {string} expr a string with the passed in express
   * @returns Jsep
   */
  constructor(expr2) {
    this.expr = expr2;
    this.index = 0;
  }
  /**
   * static top-level parser
   * @returns {jsep.Expression}
   */
  static parse(expr2) {
    return new _Jsep(expr2).parse();
  }
  /**
   * Get the longest key length of any object
   * @param {object} obj
   * @returns {number}
   */
  static getMaxKeyLen(obj) {
    return Math.max(0, ...Object.keys(obj).map((k) => k.length));
  }
  /**
   * `ch` is a character code in the next three functions
   * @param {number} ch
   * @returns {boolean}
   */
  static isDecimalDigit(ch) {
    return ch >= 48 && ch <= 57;
  }
  /**
   * Returns the precedence of a binary operator or `0` if it isn't a binary operator. Can be float.
   * @param {string} op_val
   * @returns {number}
   */
  static binaryPrecedence(op_val) {
    return _Jsep.binary_ops[op_val] || 0;
  }
  /**
   * Looks for start of identifier
   * @param {number} ch
   * @returns {boolean}
   */
  static isIdentifierStart(ch) {
    return ch >= 65 && ch <= 90 || // A...Z
    ch >= 97 && ch <= 122 || // a...z
    ch >= 128 && !_Jsep.binary_ops[String.fromCharCode(ch)] || // any non-ASCII that is not an operator
    _Jsep.additional_identifier_chars.has(String.fromCharCode(ch));
  }
  /**
   * @param {number} ch
   * @returns {boolean}
   */
  static isIdentifierPart(ch) {
    return _Jsep.isIdentifierStart(ch) || _Jsep.isDecimalDigit(ch);
  }
  /**
   * throw error at index of the expression
   * @param {string} message
   * @throws
   */
  throwError(message2) {
    const error = new Error(message2 + " at character " + this.index);
    error.index = this.index;
    error.description = message2;
    throw error;
  }
  /**
   * Run a given hook
   * @param {string} name
   * @param {jsep.Expression|false} [node]
   * @returns {?jsep.Expression}
   */
  runHook(name, node) {
    if (_Jsep.hooks[name]) {
      const env = {
        context: this,
        node
      };
      _Jsep.hooks.run(name, env);
      return env.node;
    }
    return node;
  }
  /**
   * Runs a given hook until one returns a node
   * @param {string} name
   * @returns {?jsep.Expression}
   */
  searchHook(name) {
    if (_Jsep.hooks[name]) {
      const env = {
        context: this
      };
      _Jsep.hooks[name].find(function(callback) {
        callback.call(env.context, env);
        return env.node;
      });
      return env.node;
    }
  }
  /**
   * Push `index` up to the next non-space character
   */
  gobbleSpaces() {
    let ch = this.code;
    while (ch === _Jsep.SPACE_CODE || ch === _Jsep.TAB_CODE || ch === _Jsep.LF_CODE || ch === _Jsep.CR_CODE) {
      ch = this.expr.charCodeAt(++this.index);
    }
    this.runHook("gobble-spaces");
  }
  /**
   * Top-level method to parse all expressions and returns compound or single node
   * @returns {jsep.Expression}
   */
  parse() {
    this.runHook("before-all");
    const nodes = this.gobbleExpressions();
    const node = nodes.length === 1 ? nodes[0] : {
      type: _Jsep.COMPOUND,
      body: nodes
    };
    return this.runHook("after-all", node);
  }
  /**
   * top-level parser (but can be reused within as well)
   * @param {number} [untilICode]
   * @returns {jsep.Expression[]}
   */
  gobbleExpressions(untilICode) {
    let nodes = [], ch_i, node;
    while (this.index < this.expr.length) {
      ch_i = this.code;
      if (ch_i === _Jsep.SEMCOL_CODE || ch_i === _Jsep.COMMA_CODE) {
        this.index++;
      } else {
        if (node = this.gobbleExpression()) {
          nodes.push(node);
        } else if (this.index < this.expr.length) {
          if (ch_i === untilICode) {
            break;
          }
          this.throwError('Unexpected "' + this.char + '"');
        }
      }
    }
    return nodes;
  }
  /**
   * The main parsing function.
   * @returns {?jsep.Expression}
   */
  gobbleExpression() {
    const node = this.searchHook("gobble-expression") || this.gobbleBinaryExpression();
    this.gobbleSpaces();
    return this.runHook("after-expression", node);
  }
  /**
   * Search for the operation portion of the string (e.g. `+`, `===`)
   * Start by taking the longest possible binary operations (3 characters: `===`, `!==`, `>>>`)
   * and move down from 3 to 2 to 1 character until a matching binary operation is found
   * then, return that binary operation
   * @returns {string|boolean}
   */
  gobbleBinaryOp() {
    this.gobbleSpaces();
    let to_check = this.expr.substr(this.index, _Jsep.max_binop_len);
    let tc_len = to_check.length;
    while (tc_len > 0) {
      if (_Jsep.binary_ops.hasOwnProperty(to_check) && (!_Jsep.isIdentifierStart(this.code) || this.index + to_check.length < this.expr.length && !_Jsep.isIdentifierPart(this.expr.charCodeAt(this.index + to_check.length)))) {
        this.index += tc_len;
        return to_check;
      }
      to_check = to_check.substr(0, --tc_len);
    }
    return false;
  }
  /**
   * This function is responsible for gobbling an individual expression,
   * e.g. `1`, `1+2`, `a+(b*2)-Math.sqrt(2)`
   * @returns {?jsep.BinaryExpression}
   */
  gobbleBinaryExpression() {
    let node, biop, prec, stack, biop_info, left, right, i, cur_biop;
    left = this.gobbleToken();
    if (!left) {
      return left;
    }
    biop = this.gobbleBinaryOp();
    if (!biop) {
      return left;
    }
    biop_info = {
      value: biop,
      prec: _Jsep.binaryPrecedence(biop),
      right_a: _Jsep.right_associative.has(biop)
    };
    right = this.gobbleToken();
    if (!right) {
      this.throwError("Expected expression after " + biop);
    }
    stack = [left, biop_info, right];
    while (biop = this.gobbleBinaryOp()) {
      prec = _Jsep.binaryPrecedence(biop);
      if (prec === 0) {
        this.index -= biop.length;
        break;
      }
      biop_info = {
        value: biop,
        prec,
        right_a: _Jsep.right_associative.has(biop)
      };
      cur_biop = biop;
      const comparePrev = (prev) => biop_info.right_a && prev.right_a ? prec > prev.prec : prec <= prev.prec;
      while (stack.length > 2 && comparePrev(stack[stack.length - 2])) {
        right = stack.pop();
        biop = stack.pop().value;
        left = stack.pop();
        node = {
          type: _Jsep.BINARY_EXP,
          operator: biop,
          left,
          right
        };
        stack.push(node);
      }
      node = this.gobbleToken();
      if (!node) {
        this.throwError("Expected expression after " + cur_biop);
      }
      stack.push(biop_info, node);
    }
    i = stack.length - 1;
    node = stack[i];
    while (i > 1) {
      node = {
        type: _Jsep.BINARY_EXP,
        operator: stack[i - 1].value,
        left: stack[i - 2],
        right: node
      };
      i -= 2;
    }
    return node;
  }
  /**
   * An individual part of a binary expression:
   * e.g. `foo.bar(baz)`, `1`, `"abc"`, `(a % 2)` (because it's in parenthesis)
   * @returns {boolean|jsep.Expression}
   */
  gobbleToken() {
    let ch, to_check, tc_len, node;
    this.gobbleSpaces();
    node = this.searchHook("gobble-token");
    if (node) {
      return this.runHook("after-token", node);
    }
    ch = this.code;
    if (_Jsep.isDecimalDigit(ch) || ch === _Jsep.PERIOD_CODE) {
      return this.gobbleNumericLiteral();
    }
    if (ch === _Jsep.SQUOTE_CODE || ch === _Jsep.DQUOTE_CODE) {
      node = this.gobbleStringLiteral();
    } else if (ch === _Jsep.OBRACK_CODE) {
      node = this.gobbleArray();
    } else {
      to_check = this.expr.substr(this.index, _Jsep.max_unop_len);
      tc_len = to_check.length;
      while (tc_len > 0) {
        if (_Jsep.unary_ops.hasOwnProperty(to_check) && (!_Jsep.isIdentifierStart(this.code) || this.index + to_check.length < this.expr.length && !_Jsep.isIdentifierPart(this.expr.charCodeAt(this.index + to_check.length)))) {
          this.index += tc_len;
          const argument = this.gobbleToken();
          if (!argument) {
            this.throwError("missing unaryOp argument");
          }
          return this.runHook("after-token", {
            type: _Jsep.UNARY_EXP,
            operator: to_check,
            argument,
            prefix: true
          });
        }
        to_check = to_check.substr(0, --tc_len);
      }
      if (_Jsep.isIdentifierStart(ch)) {
        node = this.gobbleIdentifier();
        if (_Jsep.literals.hasOwnProperty(node.name)) {
          node = {
            type: _Jsep.LITERAL,
            value: _Jsep.literals[node.name],
            raw: node.name
          };
        } else if (node.name === _Jsep.this_str) {
          node = {
            type: _Jsep.THIS_EXP
          };
        }
      } else if (ch === _Jsep.OPAREN_CODE) {
        node = this.gobbleGroup();
      }
    }
    if (!node) {
      return this.runHook("after-token", false);
    }
    node = this.gobbleTokenProperty(node);
    return this.runHook("after-token", node);
  }
  /**
   * Gobble properties of of identifiers/strings/arrays/groups.
   * e.g. `foo`, `bar.baz`, `foo['bar'].baz`
   * It also gobbles function calls:
   * e.g. `Math.acos(obj.angle)`
   * @param {jsep.Expression} node
   * @returns {jsep.Expression}
   */
  gobbleTokenProperty(node) {
    this.gobbleSpaces();
    let ch = this.code;
    while (ch === _Jsep.PERIOD_CODE || ch === _Jsep.OBRACK_CODE || ch === _Jsep.OPAREN_CODE || ch === _Jsep.QUMARK_CODE) {
      let optional;
      if (ch === _Jsep.QUMARK_CODE) {
        if (this.expr.charCodeAt(this.index + 1) !== _Jsep.PERIOD_CODE) {
          break;
        }
        optional = true;
        this.index += 2;
        this.gobbleSpaces();
        ch = this.code;
      }
      this.index++;
      if (ch === _Jsep.OBRACK_CODE) {
        node = {
          type: _Jsep.MEMBER_EXP,
          computed: true,
          object: node,
          property: this.gobbleExpression()
        };
        if (!node.property) {
          this.throwError('Unexpected "' + this.char + '"');
        }
        this.gobbleSpaces();
        ch = this.code;
        if (ch !== _Jsep.CBRACK_CODE) {
          this.throwError("Unclosed [");
        }
        this.index++;
      } else if (ch === _Jsep.OPAREN_CODE) {
        node = {
          type: _Jsep.CALL_EXP,
          "arguments": this.gobbleArguments(_Jsep.CPAREN_CODE),
          callee: node
        };
      } else if (ch === _Jsep.PERIOD_CODE || optional) {
        if (optional) {
          this.index--;
        }
        this.gobbleSpaces();
        node = {
          type: _Jsep.MEMBER_EXP,
          computed: false,
          object: node,
          property: this.gobbleIdentifier()
        };
      }
      if (optional) {
        node.optional = true;
      }
      this.gobbleSpaces();
      ch = this.code;
    }
    return node;
  }
  /**
   * Parse simple numeric literals: `12`, `3.4`, `.5`. Do this by using a string to
   * keep track of everything in the numeric literal and then calling `parseFloat` on that string
   * @returns {jsep.Literal}
   */
  gobbleNumericLiteral() {
    let number = "", ch, chCode;
    while (_Jsep.isDecimalDigit(this.code)) {
      number += this.expr.charAt(this.index++);
    }
    if (this.code === _Jsep.PERIOD_CODE) {
      number += this.expr.charAt(this.index++);
      while (_Jsep.isDecimalDigit(this.code)) {
        number += this.expr.charAt(this.index++);
      }
    }
    ch = this.char;
    if (ch === "e" || ch === "E") {
      number += this.expr.charAt(this.index++);
      ch = this.char;
      if (ch === "+" || ch === "-") {
        number += this.expr.charAt(this.index++);
      }
      while (_Jsep.isDecimalDigit(this.code)) {
        number += this.expr.charAt(this.index++);
      }
      if (!_Jsep.isDecimalDigit(this.expr.charCodeAt(this.index - 1))) {
        this.throwError("Expected exponent (" + number + this.char + ")");
      }
    }
    chCode = this.code;
    if (_Jsep.isIdentifierStart(chCode)) {
      this.throwError("Variable names cannot start with a number (" + number + this.char + ")");
    } else if (chCode === _Jsep.PERIOD_CODE || number.length === 1 && number.charCodeAt(0) === _Jsep.PERIOD_CODE) {
      this.throwError("Unexpected period");
    }
    return {
      type: _Jsep.LITERAL,
      value: parseFloat(number),
      raw: number
    };
  }
  /**
   * Parses a string literal, staring with single or double quotes with basic support for escape codes
   * e.g. `"hello world"`, `'this is\nJSEP'`
   * @returns {jsep.Literal}
   */
  gobbleStringLiteral() {
    let str2 = "";
    const startIndex = this.index;
    const quote = this.expr.charAt(this.index++);
    let closed = false;
    while (this.index < this.expr.length) {
      let ch = this.expr.charAt(this.index++);
      if (ch === quote) {
        closed = true;
        break;
      } else if (ch === "\\") {
        ch = this.expr.charAt(this.index++);
        switch (ch) {
          case "n":
            str2 += "\n";
            break;
          case "r":
            str2 += "\r";
            break;
          case "t":
            str2 += "	";
            break;
          case "b":
            str2 += "\b";
            break;
          case "f":
            str2 += "\f";
            break;
          case "v":
            str2 += "\v";
            break;
          default:
            str2 += ch;
        }
      } else {
        str2 += ch;
      }
    }
    if (!closed) {
      this.throwError('Unclosed quote after "' + str2 + '"');
    }
    return {
      type: _Jsep.LITERAL,
      value: str2,
      raw: this.expr.substring(startIndex, this.index)
    };
  }
  /**
   * Gobbles only identifiers
   * e.g.: `foo`, `_value`, `$x1`
   * Also, this function checks if that identifier is a literal:
   * (e.g. `true`, `false`, `null`) or `this`
   * @returns {jsep.Identifier}
   */
  gobbleIdentifier() {
    let ch = this.code, start = this.index;
    if (_Jsep.isIdentifierStart(ch)) {
      this.index++;
    } else {
      this.throwError("Unexpected " + this.char);
    }
    while (this.index < this.expr.length) {
      ch = this.code;
      if (_Jsep.isIdentifierPart(ch)) {
        this.index++;
      } else {
        break;
      }
    }
    return {
      type: _Jsep.IDENTIFIER,
      name: this.expr.slice(start, this.index)
    };
  }
  /**
   * Gobbles a list of arguments within the context of a function call
   * or array literal. This function also assumes that the opening character
   * `(` or `[` has already been gobbled, and gobbles expressions and commas
   * until the terminator character `)` or `]` is encountered.
   * e.g. `foo(bar, baz)`, `my_func()`, or `[bar, baz]`
   * @param {number} termination
   * @returns {jsep.Expression[]}
   */
  gobbleArguments(termination) {
    const args = [];
    let closed = false;
    let separator_count = 0;
    while (this.index < this.expr.length) {
      this.gobbleSpaces();
      let ch_i = this.code;
      if (ch_i === termination) {
        closed = true;
        this.index++;
        if (termination === _Jsep.CPAREN_CODE && separator_count && separator_count >= args.length) {
          this.throwError("Unexpected token " + String.fromCharCode(termination));
        }
        break;
      } else if (ch_i === _Jsep.COMMA_CODE) {
        this.index++;
        separator_count++;
        if (separator_count !== args.length) {
          if (termination === _Jsep.CPAREN_CODE) {
            this.throwError("Unexpected token ,");
          } else if (termination === _Jsep.CBRACK_CODE) {
            for (let arg = args.length; arg < separator_count; arg++) {
              args.push(null);
            }
          }
        }
      } else if (args.length !== separator_count && separator_count !== 0) {
        this.throwError("Expected comma");
      } else {
        const node = this.gobbleExpression();
        if (!node || node.type === _Jsep.COMPOUND) {
          this.throwError("Expected comma");
        }
        args.push(node);
      }
    }
    if (!closed) {
      this.throwError("Expected " + String.fromCharCode(termination));
    }
    return args;
  }
  /**
   * Responsible for parsing a group of things within parentheses `()`
   * that have no identifier in front (so not a function call)
   * This function assumes that it needs to gobble the opening parenthesis
   * and then tries to gobble everything within that parenthesis, assuming
   * that the next thing it should see is the close parenthesis. If not,
   * then the expression probably doesn't have a `)`
   * @returns {boolean|jsep.Expression}
   */
  gobbleGroup() {
    this.index++;
    let nodes = this.gobbleExpressions(_Jsep.CPAREN_CODE);
    if (this.code === _Jsep.CPAREN_CODE) {
      this.index++;
      if (nodes.length === 1) {
        return nodes[0];
      } else if (!nodes.length) {
        return false;
      } else {
        return {
          type: _Jsep.SEQUENCE_EXP,
          expressions: nodes
        };
      }
    } else {
      this.throwError("Unclosed (");
    }
  }
  /**
   * Responsible for parsing Array literals `[1, 2, 3]`
   * This function assumes that it needs to gobble the opening bracket
   * and then tries to gobble the expressions as arguments.
   * @returns {jsep.ArrayExpression}
   */
  gobbleArray() {
    this.index++;
    return {
      type: _Jsep.ARRAY_EXP,
      elements: this.gobbleArguments(_Jsep.CBRACK_CODE)
    };
  }
};
var hooks = new Hooks();
Object.assign(Jsep, {
  hooks,
  plugins: new Plugins(Jsep),
  // Node Types
  // ----------
  // This is the full set of types that any JSEP node can be.
  // Store them here to save space when minified
  COMPOUND: "Compound",
  SEQUENCE_EXP: "SequenceExpression",
  IDENTIFIER: "Identifier",
  MEMBER_EXP: "MemberExpression",
  LITERAL: "Literal",
  THIS_EXP: "ThisExpression",
  CALL_EXP: "CallExpression",
  UNARY_EXP: "UnaryExpression",
  BINARY_EXP: "BinaryExpression",
  ARRAY_EXP: "ArrayExpression",
  TAB_CODE: 9,
  LF_CODE: 10,
  CR_CODE: 13,
  SPACE_CODE: 32,
  PERIOD_CODE: 46,
  // '.'
  COMMA_CODE: 44,
  // ','
  SQUOTE_CODE: 39,
  // single quote
  DQUOTE_CODE: 34,
  // double quotes
  OPAREN_CODE: 40,
  // (
  CPAREN_CODE: 41,
  // )
  OBRACK_CODE: 91,
  // [
  CBRACK_CODE: 93,
  // ]
  QUMARK_CODE: 63,
  // ?
  SEMCOL_CODE: 59,
  // ;
  COLON_CODE: 58,
  // :
  // Operations
  // ----------
  // Use a quickly-accessible map to store all of the unary operators
  // Values are set to `1` (it really doesn't matter)
  unary_ops: {
    "-": 1,
    "!": 1,
    "~": 1,
    "+": 1
  },
  // Also use a map for the binary operations but set their values to their
  // binary precedence for quick reference (higher number = higher precedence)
  // see [Order of operations](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Operator_Precedence)
  binary_ops: {
    "||": 1,
    "??": 1,
    "&&": 2,
    "|": 3,
    "^": 4,
    "&": 5,
    "==": 6,
    "!=": 6,
    "===": 6,
    "!==": 6,
    "<": 7,
    ">": 7,
    "<=": 7,
    ">=": 7,
    "<<": 8,
    ">>": 8,
    ">>>": 8,
    "+": 9,
    "-": 9,
    "*": 10,
    "/": 10,
    "%": 10,
    "**": 11
  },
  // sets specific binary_ops as right-associative
  right_associative: /* @__PURE__ */ new Set(["**"]),
  // Additional valid identifier chars, apart from a-z, A-Z and 0-9 (except on the starting char)
  additional_identifier_chars: /* @__PURE__ */ new Set(["$", "_"]),
  // Literals
  // ----------
  // Store the values to return for the various literals we may encounter
  literals: {
    "true": true,
    "false": false,
    "null": null
  },
  // Except for `this`, which is special. This could be changed to something like `'self'` as well
  this_str: "this"
});
Jsep.max_unop_len = Jsep.getMaxKeyLen(Jsep.unary_ops);
Jsep.max_binop_len = Jsep.getMaxKeyLen(Jsep.binary_ops);
var jsep = (expr2) => new Jsep(expr2).parse();
var stdClassProps = Object.getOwnPropertyNames(class Test {
});
Object.getOwnPropertyNames(Jsep).filter((prop) => !stdClassProps.includes(prop) && jsep[prop] === void 0).forEach((m) => {
  jsep[m] = Jsep[m];
});
jsep.Jsep = Jsep;
var CONDITIONAL_EXP = "ConditionalExpression";
var ternary = {
  name: "ternary",
  init(jsep2) {
    jsep2.hooks.add("after-expression", function gobbleTernary(env) {
      if (env.node && this.code === jsep2.QUMARK_CODE) {
        this.index++;
        const test = env.node;
        const consequent = this.gobbleExpression();
        if (!consequent) {
          this.throwError("Expected expression");
        }
        this.gobbleSpaces();
        if (this.code === jsep2.COLON_CODE) {
          this.index++;
          const alternate = this.gobbleExpression();
          if (!alternate) {
            this.throwError("Expected expression");
          }
          env.node = {
            type: CONDITIONAL_EXP,
            test,
            consequent,
            alternate
          };
          if (test.operator && jsep2.binary_ops[test.operator] <= 0.9) {
            let newTest = test;
            while (newTest.right.operator && jsep2.binary_ops[newTest.right.operator] <= 0.9) {
              newTest = newTest.right;
            }
            env.node.test = newTest.right;
            newTest.right = env.node;
            env.node = test;
          }
        } else {
          this.throwError("Expected :");
        }
      }
    });
  }
};
jsep.plugins.register(ternary);
var FSLASH_CODE = 47;
var BSLASH_CODE = 92;
var index = {
  name: "regex",
  init(jsep2) {
    jsep2.hooks.add("gobble-token", function gobbleRegexLiteral(env) {
      if (this.code === FSLASH_CODE) {
        const patternIndex = ++this.index;
        let inCharSet = false;
        while (this.index < this.expr.length) {
          if (this.code === FSLASH_CODE && !inCharSet) {
            const pattern = this.expr.slice(patternIndex, this.index);
            let flags = "";
            while (++this.index < this.expr.length) {
              const code2 = this.code;
              if (code2 >= 97 && code2 <= 122 || code2 >= 65 && code2 <= 90 || code2 >= 48 && code2 <= 57) {
                flags += this.char;
              } else {
                break;
              }
            }
            let value;
            try {
              value = new RegExp(pattern, flags);
            } catch (e) {
              this.throwError(e.message);
            }
            env.node = {
              type: jsep2.LITERAL,
              value,
              raw: this.expr.slice(patternIndex - 1, this.index)
            };
            env.node = this.gobbleTokenProperty(env.node);
            return env.node;
          }
          if (this.code === jsep2.OBRACK_CODE) {
            inCharSet = true;
          } else if (inCharSet && this.code === jsep2.CBRACK_CODE) {
            inCharSet = false;
          }
          this.index += this.code === BSLASH_CODE ? 2 : 1;
        }
        this.throwError("Unclosed Regex");
      }
    });
  }
};
var PLUS_CODE = 43;
var MINUS_CODE = 45;
var plugin = {
  name: "assignment",
  assignmentOperators: /* @__PURE__ */ new Set(["=", "*=", "**=", "/=", "%=", "+=", "-=", "<<=", ">>=", ">>>=", "&=", "^=", "|=", "||=", "&&=", "??="]),
  updateOperators: [PLUS_CODE, MINUS_CODE],
  assignmentPrecedence: 0.9,
  init(jsep2) {
    const updateNodeTypes = [jsep2.IDENTIFIER, jsep2.MEMBER_EXP];
    plugin.assignmentOperators.forEach((op) => jsep2.addBinaryOp(op, plugin.assignmentPrecedence, true));
    jsep2.hooks.add("gobble-token", function gobbleUpdatePrefix(env) {
      const code2 = this.code;
      if (plugin.updateOperators.some((c) => c === code2 && c === this.expr.charCodeAt(this.index + 1))) {
        this.index += 2;
        env.node = {
          type: "UpdateExpression",
          operator: code2 === PLUS_CODE ? "++" : "--",
          argument: this.gobbleTokenProperty(this.gobbleIdentifier()),
          prefix: true
        };
        if (!env.node.argument || !updateNodeTypes.includes(env.node.argument.type)) {
          this.throwError(`Unexpected ${env.node.operator}`);
        }
      }
    });
    jsep2.hooks.add("after-token", function gobbleUpdatePostfix(env) {
      if (env.node) {
        const code2 = this.code;
        if (plugin.updateOperators.some((c) => c === code2 && c === this.expr.charCodeAt(this.index + 1))) {
          if (!updateNodeTypes.includes(env.node.type)) {
            this.throwError(`Unexpected ${env.node.operator}`);
          }
          this.index += 2;
          env.node = {
            type: "UpdateExpression",
            operator: code2 === PLUS_CODE ? "++" : "--",
            argument: env.node,
            prefix: false
          };
        }
      }
    });
    jsep2.hooks.add("after-expression", function gobbleAssignment(env) {
      if (env.node) {
        updateBinariesToAssignments(env.node);
      }
    });
    function updateBinariesToAssignments(node) {
      if (plugin.assignmentOperators.has(node.operator)) {
        node.type = "AssignmentExpression";
        updateBinariesToAssignments(node.left);
        updateBinariesToAssignments(node.right);
      } else if (!node.operator) {
        Object.values(node).forEach((val2) => {
          if (val2 && typeof val2 === "object") {
            updateBinariesToAssignments(val2);
          }
        });
      }
    }
  }
};
jsep.plugins.register(index, plugin);
jsep.addUnaryOp("typeof");
jsep.addUnaryOp("void");
jsep.addLiteral("null", null);
jsep.addLiteral("undefined", void 0);
var BLOCKED_PROTO_PROPERTIES = /* @__PURE__ */ new Set(["constructor", "__proto__", "__defineGetter__", "__defineSetter__", "__lookupGetter__", "__lookupSetter__"]);
var SafeEval = {
  /**
   * @param {jsep.Expression} ast
   * @param {Record<string, any>} subs
   */
  evalAst(ast, subs) {
    switch (ast.type) {
      case "BinaryExpression":
      case "LogicalExpression":
        return SafeEval.evalBinaryExpression(ast, subs);
      case "Compound":
        return SafeEval.evalCompound(ast, subs);
      case "ConditionalExpression":
        return SafeEval.evalConditionalExpression(ast, subs);
      case "Identifier":
        return SafeEval.evalIdentifier(ast, subs);
      case "Literal":
        return SafeEval.evalLiteral(ast, subs);
      case "MemberExpression":
        return SafeEval.evalMemberExpression(ast, subs);
      case "UnaryExpression":
        return SafeEval.evalUnaryExpression(ast, subs);
      case "ArrayExpression":
        return SafeEval.evalArrayExpression(ast, subs);
      case "CallExpression":
        return SafeEval.evalCallExpression(ast, subs);
      case "AssignmentExpression":
        return SafeEval.evalAssignmentExpression(ast, subs);
      default:
        throw SyntaxError("Unexpected expression", ast);
    }
  },
  evalBinaryExpression(ast, subs) {
    const result = {
      "||": (a, b) => a || b(),
      "&&": (a, b) => a && b(),
      "|": (a, b) => a | b(),
      "^": (a, b) => a ^ b(),
      "&": (a, b) => a & b(),
      // eslint-disable-next-line eqeqeq -- API
      "==": (a, b) => a == b(),
      // eslint-disable-next-line eqeqeq -- API
      "!=": (a, b) => a != b(),
      "===": (a, b) => a === b(),
      "!==": (a, b) => a !== b(),
      "<": (a, b) => a < b(),
      ">": (a, b) => a > b(),
      "<=": (a, b) => a <= b(),
      ">=": (a, b) => a >= b(),
      "<<": (a, b) => a << b(),
      ">>": (a, b) => a >> b(),
      ">>>": (a, b) => a >>> b(),
      "+": (a, b) => a + b(),
      "-": (a, b) => a - b(),
      "*": (a, b) => a * b(),
      "/": (a, b) => a / b(),
      "%": (a, b) => a % b()
    }[ast.operator](SafeEval.evalAst(ast.left, subs), () => SafeEval.evalAst(ast.right, subs));
    return result;
  },
  evalCompound(ast, subs) {
    let last;
    for (let i = 0; i < ast.body.length; i++) {
      if (ast.body[i].type === "Identifier" && ["var", "let", "const"].includes(ast.body[i].name) && ast.body[i + 1] && ast.body[i + 1].type === "AssignmentExpression") {
        i += 1;
      }
      const expr2 = ast.body[i];
      last = SafeEval.evalAst(expr2, subs);
    }
    return last;
  },
  evalConditionalExpression(ast, subs) {
    if (SafeEval.evalAst(ast.test, subs)) {
      return SafeEval.evalAst(ast.consequent, subs);
    }
    return SafeEval.evalAst(ast.alternate, subs);
  },
  evalIdentifier(ast, subs) {
    if (Object.hasOwn(subs, ast.name)) {
      return subs[ast.name];
    }
    throw ReferenceError(`${ast.name} is not defined`);
  },
  evalLiteral(ast) {
    return ast.value;
  },
  evalMemberExpression(ast, subs) {
    const prop = String(
      // NOTE: `String(value)` throws error when
      // value has overwritten the toString method to return non-string
      // i.e. `value = {toString: () => []}`
      ast.computed ? SafeEval.evalAst(ast.property) : ast.property.name
      // `object.property` property is Identifier
    );
    const obj = SafeEval.evalAst(ast.object, subs);
    if (obj === void 0 || obj === null) {
      throw TypeError(`Cannot read properties of ${obj} (reading '${prop}')`);
    }
    if (!Object.hasOwn(obj, prop) && BLOCKED_PROTO_PROPERTIES.has(prop)) {
      throw TypeError(`Cannot read properties of ${obj} (reading '${prop}')`);
    }
    const result = obj[prop];
    if (typeof result === "function") {
      return result.bind(obj);
    }
    return result;
  },
  evalUnaryExpression(ast, subs) {
    const result = {
      "-": (a) => -SafeEval.evalAst(a, subs),
      "!": (a) => !SafeEval.evalAst(a, subs),
      "~": (a) => ~SafeEval.evalAst(a, subs),
      // eslint-disable-next-line no-implicit-coercion -- API
      "+": (a) => +SafeEval.evalAst(a, subs),
      typeof: (a) => typeof SafeEval.evalAst(a, subs),
      // eslint-disable-next-line no-void, sonarjs/void-use -- feature
      void: (a) => void SafeEval.evalAst(a, subs)
    }[ast.operator](ast.argument);
    return result;
  },
  evalArrayExpression(ast, subs) {
    return ast.elements.map((el) => SafeEval.evalAst(el, subs));
  },
  evalCallExpression(ast, subs) {
    const args = ast.arguments.map((arg) => SafeEval.evalAst(arg, subs));
    const func = SafeEval.evalAst(ast.callee, subs);
    if (func === Function) {
      throw new Error("Function constructor is disabled");
    }
    return func(...args);
  },
  evalAssignmentExpression(ast, subs) {
    if (ast.left.type !== "Identifier") {
      throw SyntaxError("Invalid left-hand side in assignment");
    }
    const id = ast.left.name;
    const value = SafeEval.evalAst(ast.right, subs);
    subs[id] = value;
    return subs[id];
  }
};
var SafeScript = class {
  /**
   * @param {string} expr Expression to evaluate
   */
  constructor(expr2) {
    this.code = expr2;
    this.ast = jsep(this.code);
  }
  /**
   * @param {object} context Object whose items will be added
   *   to evaluation
   * @returns {EvaluatedResult} Result of evaluated code
   */
  runInNewContext(context) {
    const keyMap = Object.assign(/* @__PURE__ */ Object.create(null), context);
    return SafeEval.evalAst(this.ast, keyMap);
  }
};
function push(arr, item) {
  arr = arr.slice();
  arr.push(item);
  return arr;
}
function unshift(item, arr) {
  arr = arr.slice();
  arr.unshift(item);
  return arr;
}
var NewError = class extends Error {
  /**
   * @param {AnyResult} value The evaluated scalar value
   */
  constructor(value) {
    super('JSONPath should not be called with "new" (it prevents return of (unwrapped) scalar values)');
    this.avoidNew = true;
    this.value = value;
    this.name = "NewError";
  }
};
function JSONPath(opts, expr2, obj, callback, otherTypeCallback) {
  if (!(this instanceof JSONPath)) {
    try {
      return new JSONPath(opts, expr2, obj, callback, otherTypeCallback);
    } catch (e) {
      if (!e.avoidNew) {
        throw e;
      }
      return e.value;
    }
  }
  if (typeof opts === "string") {
    otherTypeCallback = callback;
    callback = obj;
    obj = expr2;
    expr2 = opts;
    opts = null;
  }
  const optObj = opts && typeof opts === "object";
  opts = opts || {};
  this.json = opts.json || obj;
  this.path = opts.path || expr2;
  this.resultType = opts.resultType || "value";
  this.flatten = opts.flatten || false;
  this.wrap = Object.hasOwn(opts, "wrap") ? opts.wrap : true;
  this.sandbox = opts.sandbox || {};
  this.eval = opts.eval === void 0 ? "safe" : opts.eval;
  this.ignoreEvalErrors = typeof opts.ignoreEvalErrors === "undefined" ? false : opts.ignoreEvalErrors;
  this.parent = opts.parent || null;
  this.parentProperty = opts.parentProperty || null;
  this.callback = opts.callback || callback || null;
  this.otherTypeCallback = opts.otherTypeCallback || otherTypeCallback || function() {
    throw new TypeError("You must supply an otherTypeCallback callback option with the @other() operator.");
  };
  if (opts.autostart !== false) {
    const args = {
      path: optObj ? opts.path : expr2
    };
    if (!optObj) {
      args.json = obj;
    } else if ("json" in opts) {
      args.json = opts.json;
    }
    const ret = this.evaluate(args);
    if (!ret || typeof ret !== "object") {
      throw new NewError(ret);
    }
    return ret;
  }
}
JSONPath.prototype.evaluate = function(expr2, json, callback, otherTypeCallback) {
  let currParent = this.parent, currParentProperty = this.parentProperty;
  let {
    flatten,
    wrap
  } = this;
  this.currResultType = this.resultType;
  this.currEval = this.eval;
  this.currSandbox = this.sandbox;
  callback = callback || this.callback;
  this.currOtherTypeCallback = otherTypeCallback || this.otherTypeCallback;
  json = json || this.json;
  expr2 = expr2 || this.path;
  if (expr2 && typeof expr2 === "object" && !Array.isArray(expr2)) {
    if (!expr2.path && expr2.path !== "") {
      throw new TypeError('You must supply a "path" property when providing an object argument to JSONPath.evaluate().');
    }
    if (!Object.hasOwn(expr2, "json")) {
      throw new TypeError('You must supply a "json" property when providing an object argument to JSONPath.evaluate().');
    }
    ({
      json
    } = expr2);
    flatten = Object.hasOwn(expr2, "flatten") ? expr2.flatten : flatten;
    this.currResultType = Object.hasOwn(expr2, "resultType") ? expr2.resultType : this.currResultType;
    this.currSandbox = Object.hasOwn(expr2, "sandbox") ? expr2.sandbox : this.currSandbox;
    wrap = Object.hasOwn(expr2, "wrap") ? expr2.wrap : wrap;
    this.currEval = Object.hasOwn(expr2, "eval") ? expr2.eval : this.currEval;
    callback = Object.hasOwn(expr2, "callback") ? expr2.callback : callback;
    this.currOtherTypeCallback = Object.hasOwn(expr2, "otherTypeCallback") ? expr2.otherTypeCallback : this.currOtherTypeCallback;
    currParent = Object.hasOwn(expr2, "parent") ? expr2.parent : currParent;
    currParentProperty = Object.hasOwn(expr2, "parentProperty") ? expr2.parentProperty : currParentProperty;
    expr2 = expr2.path;
  }
  currParent = currParent || null;
  currParentProperty = currParentProperty || null;
  if (Array.isArray(expr2)) {
    expr2 = JSONPath.toPathString(expr2);
  }
  if (!expr2 && expr2 !== "" || !json) {
    return void 0;
  }
  const exprList = JSONPath.toPathArray(expr2);
  if (exprList[0] === "$" && exprList.length > 1) {
    exprList.shift();
  }
  this._hasParentSelector = null;
  const result = this._trace(exprList, json, ["$"], currParent, currParentProperty, callback).filter(function(ea) {
    return ea && !ea.isParentSelector;
  });
  if (!result.length) {
    return wrap ? [] : void 0;
  }
  if (!wrap && result.length === 1 && !result[0].hasArrExpr) {
    return this._getPreferredOutput(result[0]);
  }
  return result.reduce((rslt, ea) => {
    const valOrPath = this._getPreferredOutput(ea);
    if (flatten && Array.isArray(valOrPath)) {
      rslt = rslt.concat(valOrPath);
    } else {
      rslt.push(valOrPath);
    }
    return rslt;
  }, []);
};
JSONPath.prototype._getPreferredOutput = function(ea) {
  const resultType = this.currResultType;
  switch (resultType) {
    case "all": {
      const path = Array.isArray(ea.path) ? ea.path : JSONPath.toPathArray(ea.path);
      ea.pointer = JSONPath.toPointer(path);
      ea.path = typeof ea.path === "string" ? ea.path : JSONPath.toPathString(ea.path);
      return ea;
    }
    case "value":
    case "parent":
    case "parentProperty":
      return ea[resultType];
    case "path":
      return JSONPath.toPathString(ea[resultType]);
    case "pointer":
      return JSONPath.toPointer(ea.path);
    default:
      throw new TypeError("Unknown result type");
  }
};
JSONPath.prototype._handleCallback = function(fullRetObj, callback, type) {
  if (callback) {
    const preferredOutput = this._getPreferredOutput(fullRetObj);
    fullRetObj.path = typeof fullRetObj.path === "string" ? fullRetObj.path : JSONPath.toPathString(fullRetObj.path);
    callback(preferredOutput, type, fullRetObj);
  }
};
JSONPath.prototype._trace = function(expr2, val2, path, parent, parentPropName, callback, hasArrExpr, literalPriority) {
  let retObj;
  if (!expr2.length) {
    retObj = {
      path,
      value: val2,
      parent,
      parentProperty: parentPropName,
      hasArrExpr
    };
    this._handleCallback(retObj, callback, "value");
    return retObj;
  }
  const loc = expr2[0], x = expr2.slice(1);
  const ret = [];
  function addRet(elems) {
    if (Array.isArray(elems)) {
      elems.forEach((t) => {
        ret.push(t);
      });
    } else {
      ret.push(elems);
    }
  }
  if ((typeof loc !== "string" || literalPriority) && val2 && Object.hasOwn(val2, loc)) {
    addRet(this._trace(x, val2[loc], push(path, loc), val2, loc, callback, hasArrExpr));
  } else if (loc === "*") {
    this._walk(val2, (m) => {
      addRet(this._trace(x, val2[m], push(path, m), val2, m, callback, true, true));
    });
  } else if (loc === "..") {
    addRet(this._trace(x, val2, path, parent, parentPropName, callback, hasArrExpr));
    this._walk(val2, (m) => {
      if (typeof val2[m] === "object") {
        addRet(this._trace(expr2.slice(), val2[m], push(path, m), val2, m, callback, true));
      }
    });
  } else if (loc === "^") {
    this._hasParentSelector = true;
    return {
      path: path.slice(0, -1),
      expr: x,
      isParentSelector: true
    };
  } else if (loc === "~") {
    retObj = {
      path: push(path, loc),
      value: parentPropName,
      parent,
      parentProperty: null
    };
    this._handleCallback(retObj, callback, "property");
    return retObj;
  } else if (loc === "$") {
    addRet(this._trace(x, val2, path, null, null, callback, hasArrExpr));
  } else if (/^(-?\d*):(-?\d*):?(\d*)$/u.test(loc)) {
    addRet(this._slice(loc, x, val2, path, parent, parentPropName, callback));
  } else if (loc.indexOf("?(") === 0) {
    if (this.currEval === false) {
      throw new Error("Eval [?(expr)] prevented in JSONPath expression.");
    }
    const safeLoc = loc.replace(/^\?\((.*?)\)$/u, "$1");
    const nested = /@.?([^?]*)[['](\??\(.*?\))(?!.\)\])[\]']/gu.exec(safeLoc);
    if (nested) {
      this._walk(val2, (m) => {
        const npath = [nested[2]];
        const nvalue = nested[1] ? val2[m][nested[1]] : val2[m];
        const filterResults = this._trace(npath, nvalue, path, parent, parentPropName, callback, true);
        if (filterResults.length > 0) {
          addRet(this._trace(x, val2[m], push(path, m), val2, m, callback, true));
        }
      });
    } else {
      this._walk(val2, (m) => {
        if (this._eval(safeLoc, val2[m], m, path, parent, parentPropName)) {
          addRet(this._trace(x, val2[m], push(path, m), val2, m, callback, true));
        }
      });
    }
  } else if (loc[0] === "(") {
    if (this.currEval === false) {
      throw new Error("Eval [(expr)] prevented in JSONPath expression.");
    }
    addRet(this._trace(unshift(this._eval(loc, val2, path.at(-1), path.slice(0, -1), parent, parentPropName), x), val2, path, parent, parentPropName, callback, hasArrExpr));
  } else if (loc[0] === "@") {
    let addType = false;
    const valueType = loc.slice(1, -2);
    switch (valueType) {
      case "scalar":
        if (!val2 || !["object", "function"].includes(typeof val2)) {
          addType = true;
        }
        break;
      case "boolean":
      case "string":
      case "undefined":
      case "function":
        if (typeof val2 === valueType) {
          addType = true;
        }
        break;
      case "integer":
        if (Number.isFinite(val2) && !(val2 % 1)) {
          addType = true;
        }
        break;
      case "number":
        if (Number.isFinite(val2)) {
          addType = true;
        }
        break;
      case "nonFinite":
        if (typeof val2 === "number" && !Number.isFinite(val2)) {
          addType = true;
        }
        break;
      case "object":
        if (val2 && typeof val2 === valueType) {
          addType = true;
        }
        break;
      case "array":
        if (Array.isArray(val2)) {
          addType = true;
        }
        break;
      case "other":
        addType = this.currOtherTypeCallback(val2, path, parent, parentPropName);
        break;
      case "null":
        if (val2 === null) {
          addType = true;
        }
        break;
      /* c8 ignore next 2 */
      default:
        throw new TypeError("Unknown value type " + valueType);
    }
    if (addType) {
      retObj = {
        path,
        value: val2,
        parent,
        parentProperty: parentPropName
      };
      this._handleCallback(retObj, callback, "value");
      return retObj;
    }
  } else if (loc[0] === "`" && val2 && Object.hasOwn(val2, loc.slice(1))) {
    const locProp = loc.slice(1);
    addRet(this._trace(x, val2[locProp], push(path, locProp), val2, locProp, callback, hasArrExpr, true));
  } else if (loc.includes(",")) {
    const parts = loc.split(",");
    for (const part of parts) {
      addRet(this._trace(unshift(part, x), val2, path, parent, parentPropName, callback, true));
    }
  } else if (!literalPriority && val2 && Object.hasOwn(val2, loc)) {
    addRet(this._trace(x, val2[loc], push(path, loc), val2, loc, callback, hasArrExpr, true));
  }
  if (this._hasParentSelector) {
    for (let t = 0; t < ret.length; t++) {
      const rett = ret[t];
      if (rett && rett.isParentSelector) {
        const tmp = this._trace(rett.expr, val2, rett.path, parent, parentPropName, callback, hasArrExpr);
        if (Array.isArray(tmp)) {
          ret[t] = tmp[0];
          const tl = tmp.length;
          for (let tt = 1; tt < tl; tt++) {
            t++;
            ret.splice(t, 0, tmp[tt]);
          }
        } else {
          ret[t] = tmp;
        }
      }
    }
  }
  return ret;
};
JSONPath.prototype._walk = function(val2, f) {
  if (Array.isArray(val2)) {
    const n = val2.length;
    for (let i = 0; i < n; i++) {
      f(i);
    }
  } else if (val2 && typeof val2 === "object") {
    Object.keys(val2).forEach((m) => {
      f(m);
    });
  }
};
JSONPath.prototype._slice = function(loc, expr2, val2, path, parent, parentPropName, callback) {
  if (!Array.isArray(val2)) {
    return void 0;
  }
  const len = val2.length, parts = loc.split(":"), step = parts[2] && Number.parseInt(parts[2]) || 1;
  let start = parts[0] && Number.parseInt(parts[0]) || 0, end = parts[1] && Number.parseInt(parts[1]) || len;
  start = start < 0 ? Math.max(0, start + len) : Math.min(len, start);
  end = end < 0 ? Math.max(0, end + len) : Math.min(len, end);
  const ret = [];
  for (let i = start; i < end; i += step) {
    const tmp = this._trace(unshift(i, expr2), val2, path, parent, parentPropName, callback, true);
    tmp.forEach((t) => {
      ret.push(t);
    });
  }
  return ret;
};
JSONPath.prototype._eval = function(code2, _v, _vname, path, parent, parentPropName) {
  this.currSandbox._$_parentProperty = parentPropName;
  this.currSandbox._$_parent = parent;
  this.currSandbox._$_property = _vname;
  this.currSandbox._$_root = this.json;
  this.currSandbox._$_v = _v;
  const containsPath = code2.includes("@path");
  if (containsPath) {
    this.currSandbox._$_path = JSONPath.toPathString(path.concat([_vname]));
  }
  const scriptCacheKey = this.currEval + "Script:" + code2;
  if (!JSONPath.cache[scriptCacheKey]) {
    let script = code2.replaceAll("@parentProperty", "_$_parentProperty").replaceAll("@parent", "_$_parent").replaceAll("@property", "_$_property").replaceAll("@root", "_$_root").replaceAll(/@([.\s)[])/gu, "_$_v$1");
    if (containsPath) {
      script = script.replaceAll("@path", "_$_path");
    }
    if (this.currEval === "safe" || this.currEval === true || this.currEval === void 0) {
      JSONPath.cache[scriptCacheKey] = new this.safeVm.Script(script);
    } else if (this.currEval === "native") {
      JSONPath.cache[scriptCacheKey] = new this.vm.Script(script);
    } else if (typeof this.currEval === "function" && this.currEval.prototype && Object.hasOwn(this.currEval.prototype, "runInNewContext")) {
      const CurrEval = this.currEval;
      JSONPath.cache[scriptCacheKey] = new CurrEval(script);
    } else if (typeof this.currEval === "function") {
      JSONPath.cache[scriptCacheKey] = {
        runInNewContext: (context) => this.currEval(script, context)
      };
    } else {
      throw new TypeError(`Unknown "eval" property "${this.currEval}"`);
    }
  }
  try {
    return JSONPath.cache[scriptCacheKey].runInNewContext(this.currSandbox);
  } catch (e) {
    if (this.ignoreEvalErrors) {
      return false;
    }
    throw new Error("jsonPath: " + e.message + ": " + code2);
  }
};
JSONPath.cache = {};
JSONPath.toPathString = function(pathArr) {
  const x = pathArr, n = x.length;
  let p = "$";
  for (let i = 1; i < n; i++) {
    if (!/^(~|\^|@.*?\(\))$/u.test(x[i])) {
      p += /^[0-9*]+$/u.test(x[i]) ? "[" + x[i] + "]" : "['" + x[i] + "']";
    }
  }
  return p;
};
JSONPath.toPointer = function(pointer) {
  const x = pointer, n = x.length;
  let p = "";
  for (let i = 1; i < n; i++) {
    if (!/^(~|\^|@.*?\(\))$/u.test(x[i])) {
      p += "/" + x[i].toString().replaceAll("~", "~0").replaceAll("/", "~1");
    }
  }
  return p;
};
JSONPath.toPathArray = function(expr2) {
  const {
    cache
  } = JSONPath;
  if (cache[expr2]) {
    return cache[expr2].concat();
  }
  const subx = [];
  const normalized = expr2.replaceAll(/@(?:null|boolean|number|string|integer|undefined|nonFinite|scalar|array|object|function|other)\(\)/gu, ";$&;").replaceAll(/[['](\??\(.*?\))[\]'](?!.\])/gu, function($0, $1) {
    return "[#" + (subx.push($1) - 1) + "]";
  }).replaceAll(/\[['"]([^'\]]*)['"]\]/gu, function($0, prop) {
    return "['" + prop.replaceAll(".", "%@%").replaceAll("~", "%%@@%%") + "']";
  }).replaceAll("~", ";~;").replaceAll(/['"]?\.['"]?(?![^[]*\])|\[['"]?/gu, ";").replaceAll("%@%", ".").replaceAll("%%@@%%", "~").replaceAll(/(?:;)?(\^+)(?:;)?/gu, function($0, ups) {
    return ";" + ups.split("").join(";") + ";";
  }).replaceAll(/;;;|;;/gu, ";..;").replaceAll(/;$|'?\]|'$/gu, "");
  const exprList = normalized.split(";").map(function(exp) {
    const match = exp.match(/#(\d+)/u);
    return !match || !match[1] ? exp : subx[match[1]];
  });
  cache[expr2] = exprList;
  return cache[expr2].concat();
};
JSONPath.prototype.safeVm = {
  Script: SafeScript
};
JSONPath.prototype.vm = vm;

// packages/verify/src/binding/jsonpath-resolver.ts
function resolveJsonPath(document, jsonPath, index2) {
  try {
    if (!document || typeof document !== "object") {
      return {
        success: false,
        value: null,
        path: jsonPath,
        matchCount: 0,
        error: "Invalid document: expected object",
        valueType: "null"
      };
    }
    if (!jsonPath || typeof jsonPath !== "string") {
      return {
        success: false,
        value: null,
        path: jsonPath,
        matchCount: 0,
        error: "Invalid JSONPath: expected non-empty string",
        valueType: "null"
      };
    }
    const normalizedPath = jsonPath.startsWith("$") ? jsonPath : `$.${jsonPath}`;
    const results = JSONPath({
      path: normalizedPath,
      json: document,
      wrap: true
      // Always return array
    });
    if (!results || results.length === 0) {
      return {
        success: false,
        value: null,
        path: jsonPath,
        matchCount: 0,
        error: `No matches found for path: ${jsonPath}`,
        valueType: "null"
      };
    }
    if (index2 !== void 0) {
      if (index2 >= 0 && index2 < results.length) {
        const value2 = results[index2];
        return {
          success: true,
          value: value2,
          path: jsonPath,
          matchCount: 1,
          valueType: getValueType(value2)
        };
      } else {
        return {
          success: false,
          value: null,
          path: jsonPath,
          matchCount: results.length,
          error: `Index ${index2} out of bounds (found ${results.length} matches)`,
          valueType: "null"
        };
      }
    }
    const value = results.length === 1 ? results[0] : results;
    return {
      success: true,
      value,
      path: jsonPath,
      matchCount: results.length,
      valueType: getValueType(value)
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return {
      success: false,
      value: null,
      path: jsonPath,
      matchCount: 0,
      error: `JSONPath error: ${errorMessage}`,
      valueType: "null"
    };
  }
}
function getValueType(value) {
  if (value === null) return "null";
  if (value === void 0) return "undefined";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return "number";
  if (typeof value === "string") return "string";
  if (typeof value === "object") return "object";
  return "undefined";
}

// packages/verify/src/binding/ontological-bridge.ts
var getFlightRecorder = () => null;
var bridgeLog = () => {
};
var bridgeLogOn = false;
function setBridgeLogger(logger) {
  bridgeLog = logger ?? (() => {
  });
  bridgeLogOn = logger !== void 0 && logger !== null;
}
function newDocumentScope() {
  return {
    plans: /* @__PURE__ */ new Map(),
    pathShape: /* @__PURE__ */ new Map(),
    direct: /* @__PURE__ */ new Map(),
    fuzzy: /* @__PURE__ */ new Map(),
    dates: /* @__PURE__ */ new Map(),
    contractRules: /* @__PURE__ */ new Map(),
    evidenceItems: /* @__PURE__ */ new Map(),
    heterogeneity: /* @__PURE__ */ new Map()
  };
}
function perDocument(outer, document) {
  let inner2 = outer.get(document);
  if (!inner2) {
    inner2 = /* @__PURE__ */ new Map();
    outer.set(document, inner2);
  }
  return inner2;
}
var FIELD_ALIASES = {
  // Rate variations
  rate: ["unit_price", "price", "hourly_rate", "rate_per_unit", "price_per_unit", "unit_rate", "cost", "charge"],
  unit_price: ["rate", "price", "hourly_rate", "cost", "charge"],
  // Quantity variations
  quantity: ["qty", "units", "hours", "count", "num", "amount"],
  hours: ["quantity", "qty", "units", "total_hours", "worked_hours"],
  // Amount variations
  amount: ["total", "sum", "value", "price", "cost", "charge", "billed_amount", "line_total"],
  total: ["amount", "sum", "grand_total", "subtotal", "total_amount"],
  // Date variations
  date: ["service_date", "event_date", "transaction_date", "work_date", "effective_date"],
  effective_date: ["start_date", "begin_date", "commencement_date"],
  end_date: ["expiration_date", "termination_date", "expiry_date", "contract_end"],
  // Reference variations
  document_number: ["invoice_number", "reference", "ref", "po_number", "order_number", "ticket_number"]
};
function getFieldAliases(fieldName) {
  const normalized = fieldName.toLowerCase().replace(/-/g, "_");
  const aliases = /* @__PURE__ */ new Set([normalized]);
  if (FIELD_ALIASES[normalized]) {
    for (const alias of FIELD_ALIASES[normalized]) {
      aliases.add(alias);
    }
  }
  for (const [canonical, aliasList] of Object.entries(FIELD_ALIASES)) {
    if (aliasList.includes(normalized)) {
      aliases.add(canonical);
      for (const alias of aliasList) {
        aliases.add(alias);
      }
    }
  }
  return Array.from(aliases);
}
var DOMAIN_ONTOLOGIES = {};
var OntologicalBridge = class _OntologicalBridge {
  ontologies = /* @__PURE__ */ new Map();
  // role → kind for the ontology currently being bound (set in createBindings). Lets a ruleset declare how its
  // roles normalize instead of extending the hard-coded lists below.
  roleKinds = {};
  // one representative built-in role per kind; kind-declared roles delegate to it.
  static KIND_REPRESENTATIVE = {
    amount: "CLAIMED_AMOUNT",
    rate: "TAX_RATE",
    quantity: "CLAIMED_QUANTITY",
    date: "EVENT_DATE",
    reference: "DOCUMENT_ID",
    string: "INVOICE_DESCRIPTION",
    array: "PRIOR_CLAIM_IDS"
  };
  extractionCache = /* @__PURE__ */ new WeakMap();
  flightRecorder = null;
  currentDocumentId;
  currentDomain;
  currentDocumentType;
  // F3: live only inside createLineItemBindings (see DocumentScope); null everywhere else, so a lone createBindings
  // call behaves exactly as before.
  scope = null;
  constructor() {
    for (const [key, ontology] of Object.entries(DOMAIN_ONTOLOGIES)) {
      this.ontologies.set(key, ontology);
    }
    try {
      this.flightRecorder = getFlightRecorder();
    } catch {
    }
  }
  /**
   * Enable flight recording for current extraction context
   */
  setExtractionContext(documentId, domain, documentType) {
    this.currentDocumentId = documentId;
    this.currentDomain = domain;
    this.currentDocumentType = documentType;
  }
  /**
   * Register a custom domain ontology
   */
  registerOntology(ontology) {
    this.ontologies.set(ontology.domainId, ontology);
  }
  /**
   * Get ontology for a domain
   */
  getOntology(domainId) {
    return this.ontologies.get(domainId);
  }
  // --------------------------------------------------------------------------
  // F3 memo helpers. Each returns exactly what its uncached body returns; inside a createLineItemBindings call the
  // answer is computed on first use (so anything that throws still throws at the same point) and reused by later lines.
  // --------------------------------------------------------------------------
  mappingPlanOf(ontology) {
    const hit = this.scope?.plans.get(ontology);
    if (hit) return hit;
    const sortedMappings = [...ontology.mappings].sort((a, b) => b.priority - a.priority);
    const plan = {
      invoice: sortedMappings.filter((m) => m.documentType === "invoice" || m.documentType === "any"),
      contract: sortedMappings.filter((m) => m.documentType === "contract" || m.documentType === "any"),
      evidence: sortedMappings.filter((m) => m.documentType === "evidence")
    };
    this.scope?.plans.set(ontology, plan);
    return plan;
  }
  dateOf(doc3) {
    const memo = this.scope?.dates;
    if (memo?.has(doc3)) return memo.get(doc3);
    const date = this.extractDateValue(doc3);
    memo?.set(doc3, date);
    return date;
  }
  contractRulesOf(contract) {
    const hit = this.scope?.contractRules.get(contract);
    if (hit) return hit;
    const rules = this.extractContractRulesForCorrelation(contract);
    this.scope?.contractRules.set(contract, rules);
    return rules;
  }
  evidenceItemsOf(evidence) {
    const hit = this.scope?.evidenceItems.get(evidence);
    if (hit) return hit;
    const items = this.extractEvidenceForCorrelation(evidence);
    this.scope?.evidenceItems.set(evidence, items);
    return items;
  }
  /**
   * v5.5 heterogeneity scan: the distinct line-item categories across ALL line descriptions. A property of the invoice,
   * not of any one line.
   */
  heterogeneityOf(invoiceLineItems) {
    const hit = this.scope?.heterogeneity.get(invoiceLineItems);
    if (hit) return hit;
    const descriptions = invoiceLineItems.map((item) => item === null || item === void 0 ? void 0 : item.description || item.service || item.name).filter((d) => typeof d === "string" && d.length > 0).map((d) => d.toLowerCase());
    const hasTransport = descriptions.some((d) => /transport|haul|freight|delivery|drive/.test(d));
    const hasFuel = descriptions.some((d) => /fuel|gas|diesel/.test(d));
    const hasCrane = descriptions.some((d) => /crane|mobilization|rigging|lift/.test(d));
    const hasMileage = descriptions.some((d) => /mileage|mile|excess|distance/.test(d));
    const hasPerDiem = descriptions.some((d) => /per diem|lodging|overnight|hotel/.test(d));
    const hasOther = descriptions.some((d) => /surcharge|fee|charge|standby|wait/.test(d));
    const categoryCount = [hasTransport, hasFuel, hasCrane, hasMileage, hasPerDiem, hasOther].filter(Boolean).length;
    const out = { descriptions, categoryCount };
    this.scope?.heterogeneity.set(invoiceLineItems, out);
    return out;
  }
  /**
   * True when the exact/alternative phase of `mapping` cannot see `arrayIndex`, so its answer is fixed per document:
   * no path is a JSONPath (resolveJsonPath indexes its match list and returns a fresh array per call), and either no
   * index is given or no path has a `[*]` (extractExact reads the index only at a `[*]` segment).
   */
  isLineBlind(mapping, arrayIndex2, scope) {
    let shape = scope.pathShape.get(mapping);
    if (!shape) {
      const alts = mapping.alternativePaths;
      const paths = !alts ? [mapping.fieldPath] : Array.isArray(alts) ? [mapping.fieldPath, ...alts] : null;
      shape = paths === null || paths.some((p) => typeof p !== "string") ? { jsonPath: true, wildcard: true } : { jsonPath: paths.some((p) => p.startsWith("$")), wildcard: paths.some((p) => p.includes("[*]")) };
      scope.pathShape.set(mapping, shape);
    }
    return !shape.jsonPath && (arrayIndex2 === void 0 || !shape.wildcard);
  }
  /**
   * Extract a value from a document using a field path with fuzzy fallbacks.
   * Supports dot notation and array wildcards (e.g., "line_items[*].rate")
   *
   * ENHANCED: Tries JSONPath first (for paths starting with $), then exact paths,
   * and finally fuzzy field name matching.
   */
  extractValue(document, fieldPath, arrayIndex2, enableFuzzy = true) {
    if (fieldPath.startsWith("$")) {
      const jsonPathResult = resolveJsonPath(document, fieldPath, arrayIndex2);
      if (jsonPathResult.success && jsonPathResult.value !== null && jsonPathResult.value !== void 0) {
        return jsonPathResult.value;
      }
      const legacyPath = fieldPath.replace(/^\$\.?/, "");
      if (legacyPath) {
        const legacyResult = this.extractExact(document, legacyPath, arrayIndex2);
        if (legacyResult !== null && legacyResult !== void 0) {
          return legacyResult;
        }
      }
    }
    const exactResult = this.extractExact(document, fieldPath, arrayIndex2);
    if (exactResult !== null && exactResult !== void 0) {
      return exactResult;
    }
    if (enableFuzzy) {
      return this.extractFuzzy(document, fieldPath, arrayIndex2);
    }
    return null;
  }
  /**
   * Extract using exact path matching
   */
  extractExact(document, fieldPath, arrayIndex2) {
    const parts = fieldPath.split(".");
    let current = document;
    for (const part of parts) {
      if (current === null || current === void 0) {
        return null;
      }
      const arrayMatch = part.match(/^(.+)\[\*\]$/);
      if (arrayMatch) {
        const arrayField = arrayMatch[1];
        const arr = current[arrayField];
        if (!Array.isArray(arr)) {
          return null;
        }
        if (arrayIndex2 !== void 0) {
          current = arr[arrayIndex2];
        } else {
          for (const item of arr) {
            if (item !== null && item !== void 0) {
              current = item;
              break;
            }
          }
          if (current === arr) {
            return arr;
          }
        }
      } else if (part.match(/^\d+$/)) {
        const idx = parseInt(part, 10);
        if (Array.isArray(current)) {
          current = current[idx];
        } else {
          return null;
        }
      } else {
        current = current[part];
      }
    }
    return current;
  }
  /**
   * Extract using fuzzy path resolution
   */
  extractFuzzy(document, fieldPath, arrayIndex2) {
    const parts = fieldPath.split(".");
    if (parts.length === 0) return null;
    let lastPart = parts[parts.length - 1];
    const arrayWildcard = lastPart.match(/^(.+)\[\*\]$/);
    if (arrayWildcard) {
      lastPart = arrayWildcard[1];
    }
    const aliases = getFieldAliases(lastPart);
    for (const alias of aliases) {
      const result = this.deepSearch(document, alias, arrayIndex2);
      if (result !== null && result !== void 0) {
        return result;
      }
    }
    if (parts.length >= 2 && parts[0].includes("[*]")) {
      const arrMatch = parts[0].match(/^(.+)\[\*\]$/);
      if (arrMatch) {
        const result = this.searchInArrays(document, arrMatch[1], lastPart, arrayIndex2);
        if (result !== null && result !== void 0) {
          return result;
        }
      }
    }
    return null;
  }
  /**
   * Deep search for a field name in nested object
   */
  deepSearch(obj, fieldName, arrayIndex2, maxDepth = 4) {
    if (maxDepth <= 0) return null;
    for (const key of Object.keys(obj)) {
      const normalizedKey = key.toLowerCase().replace(/-/g, "_");
      if (normalizedKey === fieldName.toLowerCase()) {
        const value = obj[key];
        if (Array.isArray(value) && arrayIndex2 !== void 0) {
          return value[arrayIndex2];
        }
        return value;
      }
    }
    for (const value of Object.values(obj)) {
      if (value && typeof value === "object") {
        if (Array.isArray(value)) {
          if (arrayIndex2 !== void 0 && value[arrayIndex2]) {
            const item = value[arrayIndex2];
            if (typeof item === "object" && item !== null) {
              const result = this.deepSearch(item, fieldName, void 0, maxDepth - 1);
              if (result !== null && result !== void 0) {
                return result;
              }
            }
          } else {
            for (const item of value) {
              if (typeof item === "object" && item !== null) {
                const result = this.deepSearch(item, fieldName, void 0, maxDepth - 1);
                if (result !== null && result !== void 0) {
                  return result;
                }
              }
            }
          }
        } else {
          const result = this.deepSearch(value, fieldName, arrayIndex2, maxDepth - 1);
          if (result !== null && result !== void 0) {
            return result;
          }
        }
      }
    }
    return null;
  }
  /**
   * Search in arrays for a specific field
   */
  searchInArrays(obj, arrayName, fieldName, arrayIndex2) {
    const aliases = getFieldAliases(arrayName);
    let arr = null;
    for (const alias of aliases) {
      for (const key of Object.keys(obj)) {
        const normalizedKey = key.toLowerCase().replace(/-/g, "_");
        if (normalizedKey === alias.toLowerCase() && Array.isArray(obj[key])) {
          arr = obj[key];
          break;
        }
      }
      if (arr) break;
    }
    if (!arr) return null;
    const targetIndex = arrayIndex2 ?? 0;
    const item = arr[targetIndex];
    if (item && typeof item === "object") {
      const fieldAliases = getFieldAliases(fieldName);
      for (const alias of fieldAliases) {
        for (const key of Object.keys(item)) {
          const normalizedKey = key.toLowerCase().replace(/-/g, "_");
          if (normalizedKey === alias.toLowerCase()) {
            return item[key];
          }
        }
      }
    }
    return null;
  }
  /**
   * Create bindings from extracted document data.
   * This is the core "data binding" step that feeds the axiom gavel.
   *
   * ENHANCED v4.5: Uses LLM correlation map when available, falls back to code correlation.
   * LLM provides semantic understanding; code provides mathematical verification.
   */
  createBindings(domainId, invoice, contract, evidence, lineItemIndex, llmCorrelationMap) {
    const ontology = this.ontologies.get(domainId);
    this.roleKinds = ontology?.roleKinds ?? {};
    const invoiceId = invoice.document_number || invoice.id || "unknown";
    this.setExtractionContext(invoiceId, domainId, "invoice");
    if (!ontology) {
      if (bridgeLogOn) bridgeLog(`[OntologicalBridge] No ontology for domain: ${domainId}`);
      return {
        bindings: {},
        invoiceId,
        lineItemIndex
      };
    }
    const bindings = {};
    const plan = this.mappingPlanOf(ontology);
    for (const mapping of plan.invoice) {
      if (bindings[mapping.role]) continue;
      if (mapping.role === "EVENT_DATE") {
        const dateValue = this.dateOf(invoice);
        if (dateValue) {
          const normResult = this.normalizeValueForRole(dateValue, mapping.role);
          bindings[mapping.role] = {
            value: normResult.normalized,
            source: "invoice",
            field: "dates[service_date]",
            confidence: 100,
            // Deterministic extraction
            originalValue: dateValue,
            normalizedValue: typeof normResult.normalized === "object" ? String(normResult.normalized) : normResult.normalized,
            normalizations: normResult.meta?.transformations
          };
          if (bridgeLogOn) bridgeLog(`[OntologicalBridge] EVENT_DATE BIND (smart): ${String(dateValue).slice(0, 50)} (service_date preferred, 100%)`);
          continue;
        }
      }
      const match = this.extractWithFallbacks(invoice, mapping, lineItemIndex);
      if (match !== null) {
        const normResult = this.normalizeValueForRole(match.value, mapping.role);
        bindings[mapping.role] = {
          value: normResult.normalized,
          source: "invoice",
          field: match.matchPath,
          confidence: match.confidence,
          // v4.5: Normalization provenance
          originalValue: normResult.meta?.original ?? match.value,
          normalizedValue: typeof normResult.normalized === "object" ? String(normResult.normalized) : normResult.normalized,
          normalizations: normResult.meta?.transformations
        };
        if (bridgeLogOn && (match.matchType === "fuzzy" || match.matchType === "deep_search")) {
          bridgeLog(`[OntologicalBridge] FUZZY BIND: ${mapping.role} = ${String(match.value).slice(0, 50)} (${match.matchPath}, ${match.confidence}%)`);
        }
      }
    }
    this.setExtractionContext(invoiceId, domainId, "contract");
    const contractRules = this.contractRulesOf(contract);
    const llmMapping = llmCorrelationMap?.lineItemMappings?.find(
      (m) => m.invoiceLineIndex === lineItemIndex
    );
    const llmContractMatch = llmMapping?.matchedContractRule;
    let contractCorrelation;
    if (llmContractMatch && llmContractMatch.confidence === "HIGH" && llmContractMatch.ruleIndex !== void 0 && llmContractMatch.ruleIndex >= 0) {
      if (bridgeLogOn) {
        bridgeLog(`[OntologicalBridge] LLM CONTRACT CORRELATION: ${llmContractMatch.ruleName || "unnamed"} (${llmContractMatch.confidence})`);
        bridgeLog(`[OntologicalBridge]   Reasoning: ${llmContractMatch.reasoning}`);
      }
      contractCorrelation = {
        score: 90,
        // LLM HIGH = 90%
        factors: { dateMatch: 0, referenceMatch: 0, descriptionMatch: 90 },
        matchedIndex: llmContractMatch.ruleIndex,
        explanation: `LLM match: ${llmContractMatch.reasoning}`,
        isReliable: true
      };
    } else if (llmContractMatch && llmContractMatch.confidence === "MEDIUM" && llmContractMatch.ruleIndex !== void 0 && llmContractMatch.ruleIndex >= 0) {
      if (bridgeLogOn) bridgeLog(`[OntologicalBridge] LLM CONTRACT CORRELATION (MEDIUM): ${llmContractMatch.ruleName || "unnamed"}`);
      contractCorrelation = {
        score: 65,
        // LLM MEDIUM = 65%
        factors: { dateMatch: 0, referenceMatch: 0, descriptionMatch: 65 },
        matchedIndex: llmContractMatch.ruleIndex,
        explanation: `LLM match (medium): ${llmContractMatch.reasoning}`,
        isReliable: true
      };
    } else if (llmCorrelationMap && llmCorrelationMap.lineItemMappings.length > 0 && contractRules.length > 0) {
      if (bridgeLogOn) {
        bridgeLog(`[OntologicalBridge] WARNING: MAPPING_FAILURE - LLM couldn't map line item ${lineItemIndex} to contract rule`);
        bridgeLog(`[OntologicalBridge]   LLM tried but confidence was LOW or no match found`);
      }
      contractCorrelation = {
        score: 0,
        factors: { dateMatch: 0, referenceMatch: 0, descriptionMatch: 0 },
        matchedIndex: -1,
        explanation: "MAPPING_FAILURE: LLM could not semantically match this line item to a contract rule",
        isReliable: false
      };
    } else if ((!llmCorrelationMap || llmCorrelationMap.lineItemMappings.length === 0) && contractRules.length > 0) {
      const lineItems = invoice.line_items || [];
      const currentLineItem = lineItemIndex !== void 0 ? lineItems[lineItemIndex] || {} : {};
      const lineItemDescription = String(currentLineItem.description ?? "");
      const keywordMatch = this.findContractRuleByKeywords(lineItemDescription, contractRules);
      if (keywordMatch.matchedIndex >= 0) {
        if (bridgeLogOn) bridgeLog(`[OntologicalBridge] v5.19 KEYWORD MATCH: Line "${lineItemDescription.slice(0, 40)}" \u2192 Rule "${keywordMatch.ruleName}" (${keywordMatch.score}% confidence)`);
        contractCorrelation = {
          score: keywordMatch.score,
          factors: { dateMatch: 0, referenceMatch: 0, descriptionMatch: keywordMatch.score },
          matchedIndex: keywordMatch.matchedIndex,
          explanation: `v5.19 keyword match: ${keywordMatch.explanation}`,
          isReliable: keywordMatch.score >= 70
          // Treat 70%+ keyword matches as reliable
        };
      } else {
        if (bridgeLogOn) bridgeLog(`[OntologicalBridge] v5.19: No keyword match found for "${lineItemDescription.slice(0, 40)}" in ${contractRules.length} rules`);
        contractCorrelation = {
          score: 0,
          factors: { dateMatch: 0, referenceMatch: 0, descriptionMatch: 0 },
          matchedIndex: -1,
          explanation: "v5.19: No keyword match - line item does not match any contract rule category",
          isReliable: false
        };
      }
    } else {
      contractCorrelation = {
        score: 0,
        factors: { dateMatch: 0, referenceMatch: 0, descriptionMatch: 0 },
        matchedIndex: -1,
        explanation: "No contract rules to correlate",
        isReliable: false
      };
    }
    const hasMultipleRules = contractRules.length > 1;
    for (const mapping of plan.contract) {
      if (bindings[mapping.role]) continue;
      const isArrayBasedField = mapping.fieldPath.includes("[*]");
      if (isArrayBasedField && hasMultipleRules && !contractCorrelation.isReliable) {
        if (bridgeLogOn) bridgeLog(`[OntologicalBridge] SKIPPING ${mapping.role} - multiple contract rules require reliable correlation`);
        continue;
      }
      let ruleIndex;
      if (contractCorrelation.isReliable) {
        ruleIndex = contractCorrelation.matchedIndex;
      } else if (!hasMultipleRules && contractRules.length === 1) {
        ruleIndex = 0;
      }
      const match = this.extractWithFallbacks(contract, mapping, ruleIndex);
      if (match !== null) {
        let adjustedConfidence;
        const isDeterministic = match.matchType === "exact" || match.matchType === "alternative";
        if (isDeterministic) {
          adjustedConfidence = match.confidence;
        } else {
          const correlationFactor = contractCorrelation.score / 100;
          adjustedConfidence = Math.round(match.confidence * correlationFactor);
        }
        const normResult = this.normalizeValueForRole(match.value, mapping.role);
        bindings[mapping.role] = {
          value: normResult.normalized,
          source: "contract",
          field: match.matchPath,
          confidence: adjustedConfidence,
          // v4.5: Normalization provenance
          originalValue: normResult.meta?.original ?? match.value,
          normalizedValue: typeof normResult.normalized === "object" ? String(normResult.normalized) : normResult.normalized,
          normalizations: normResult.meta?.transformations
        };
        if (bridgeLogOn) {
          if (match.matchType === "fuzzy" || match.matchType === "deep_search") {
            bridgeLog(`[OntologicalBridge] CONTRACT BIND (${match.matchType}): ${mapping.role} = ${String(match.value).slice(0, 50)} (${match.matchPath}, ${adjustedConfidence}% adjusted)`);
          } else {
            bridgeLog(`[OntologicalBridge] CONTRACT BIND (${match.matchType}): ${mapping.role} = ${String(match.value).slice(0, 50)} (${match.matchPath}, ${adjustedConfidence}%)`);
          }
        }
      }
    }
    this.setExtractionContext(invoiceId, domainId, "evidence");
    const evidenceItems = this.evidenceItemsOf(evidence);
    const llmEvidenceMatches = llmMapping?.matchedEvidence?.filter(
      (m) => m.evidenceDocIndex !== void 0 && m.evidenceDocIndex >= 0 && m.confidence !== "LOW"
    ) || [];
    let evidenceCorrelation;
    if (llmEvidenceMatches.length > 0 && llmEvidenceMatches[0].confidence === "HIGH") {
      const bestMatch = llmEvidenceMatches[0];
      if (bridgeLogOn) {
        bridgeLog(`[OntologicalBridge] LLM EVIDENCE CORRELATION: doc[${bestMatch.evidenceDocIndex}] ticket:${bestMatch.ticketNumber || "none"} (${bestMatch.confidence})`);
        bridgeLog(`[OntologicalBridge]   Reasoning: ${bestMatch.reasoning}`);
      }
      evidenceCorrelation = {
        score: 90,
        // LLM HIGH = 90%
        factors: { dateMatch: 45, referenceMatch: 45, descriptionMatch: 0 },
        matchedIndex: bestMatch.evidenceDocIndex,
        explanation: `LLM match: ${bestMatch.reasoning}`,
        isReliable: true
      };
    } else if (llmEvidenceMatches.length > 0 && llmEvidenceMatches[0].confidence === "MEDIUM") {
      const bestMatch = llmEvidenceMatches[0];
      if (bridgeLogOn) bridgeLog(`[OntologicalBridge] LLM EVIDENCE CORRELATION (MEDIUM): doc[${bestMatch.evidenceDocIndex}]`);
      evidenceCorrelation = {
        score: 65,
        // LLM MEDIUM = 65%
        factors: { dateMatch: 32, referenceMatch: 33, descriptionMatch: 0 },
        matchedIndex: bestMatch.evidenceDocIndex,
        explanation: `LLM match (medium): ${bestMatch.reasoning}`,
        isReliable: true
      };
    } else if (llmCorrelationMap && evidenceItems.length > 0) {
      if (bridgeLogOn) {
        bridgeLog(`[OntologicalBridge] WARNING: MAPPING_FAILURE - LLM couldn't map line item ${lineItemIndex} to evidence`);
        bridgeLog(`[OntologicalBridge]   LLM tried but confidence was LOW or no match found`);
      }
      evidenceCorrelation = {
        score: 0,
        factors: { dateMatch: 0, referenceMatch: 0, descriptionMatch: 0 },
        matchedIndex: -1,
        explanation: "MAPPING_FAILURE: LLM could not semantically match this line item to evidence",
        isReliable: false
      };
    } else if (!llmCorrelationMap && evidenceItems.length > 0) {
      if (bridgeLogOn) {
        bridgeLog(`[OntologicalBridge] WARNING: MAPPING_FAILURE - No LLM correlation_map provided`);
        bridgeLog(`[OntologicalBridge]   ${evidenceItems.length} evidence items exist but cannot be semantically matched`);
        bridgeLog(`[OntologicalBridge]   JACCARD FALLBACK DISABLED - insufficient data for reliable matching`);
      }
      evidenceCorrelation = {
        score: 0,
        factors: { dateMatch: 0, referenceMatch: 0, descriptionMatch: 0 },
        matchedIndex: -1,
        explanation: "MAPPING_FAILURE: No LLM correlation_map - cannot semantically match to evidence",
        isReliable: false
      };
    } else {
      evidenceCorrelation = {
        score: 0,
        factors: { dateMatch: 0, referenceMatch: 0, descriptionMatch: 0 },
        matchedIndex: -1,
        explanation: "No evidence items to correlate",
        isReliable: false
      };
    }
    for (const mapping of plan.evidence) {
      if (bindings[mapping.role]) continue;
      if (mapping.role === "ACTUAL_QUANTITY") {
        if (bridgeLogOn) bridgeLog(`[OntologicalBridge] v5.5 CHECK ENTERED - invoice exists: ${!!invoice}`);
        const invoiceLineItems = invoice ? invoice.line_items : void 0;
        if (bridgeLogOn) bridgeLog(`[OntologicalBridge] v5.5 line_items: ${invoiceLineItems ? `array of ${invoiceLineItems.length}` : "undefined"}`);
        if (invoiceLineItems && Array.isArray(invoiceLineItems) && invoiceLineItems.length > 1) {
          const { descriptions, categoryCount } = this.heterogeneityOf(invoiceLineItems);
          if (categoryCount >= 2) {
            if (bridgeLogOn) {
              bridgeLog(`[OntologicalBridge] v5.5 HETEROGENEOUS INVOICE DETECTED - ${categoryCount} distinct categories`);
              bridgeLog(`[OntologicalBridge]   Line items: ${descriptions.slice(0, 3).join(", ")}${descriptions.length > 3 ? "..." : ""}`);
              bridgeLog(`[OntologicalBridge]   SKIPPING global ACTUAL_QUANTITY binding - LLM will handle per-line-item`);
            }
            continue;
          }
        }
      }
      if (evidenceCorrelation.isReliable && evidenceCorrelation.matchedIndex >= 0) {
        const correlatedEvidence = evidence[evidenceCorrelation.matchedIndex];
        const match = this.extractWithFallbacks(correlatedEvidence, mapping);
        if (match !== null) {
          let adjustedConfidence;
          const isDeterministic = match.matchType === "exact" || match.matchType === "alternative";
          if (isDeterministic) {
            adjustedConfidence = match.confidence;
          } else {
            const correlationFactor = evidenceCorrelation.score / 100;
            adjustedConfidence = Math.round(match.confidence * correlationFactor);
          }
          const normResult = this.normalizeValueForRole(match.value, mapping.role);
          bindings[mapping.role] = {
            value: normResult.normalized,
            source: "evidence",
            field: `evidence[${evidenceCorrelation.matchedIndex}].${match.matchPath}`,
            confidence: adjustedConfidence,
            // v4.5: Normalization provenance
            originalValue: normResult.meta?.original ?? match.value,
            normalizedValue: typeof normResult.normalized === "object" ? String(normResult.normalized) : normResult.normalized,
            normalizations: normResult.meta?.transformations
          };
          if (bridgeLogOn) bridgeLog(`[OntologicalBridge] EVIDENCE BIND (${match.matchType}): ${mapping.role} = ${String(match.value).slice(0, 50)} (${adjustedConfidence}%)`);
        }
      } else {
        const isSingleEvidence = evidence.length === 1;
        const needsSemanticCheck = mapping.role === "ACTUAL_QUANTITY";
        const invoiceDesc = bindings.INVOICE_DESCRIPTION?.value;
        for (let evIdx = 0; evIdx < evidence.length; evIdx++) {
          const ev = evidence[evIdx];
          const match = this.extractWithFallbacks(ev, mapping);
          if (match !== null) {
            if (needsSemanticCheck && typeof invoiceDesc === "string") {
              const evLineItems = ev.line_items;
              let evidenceDescForQty;
              if (evLineItems && Array.isArray(evLineItems)) {
                for (const evItem of evLineItems) {
                  const evQty = evItem.quantity || evItem.hours || evItem.qty;
                  if (evQty === match.value) {
                    evidenceDescForQty = evItem.description || evItem.service || evItem.name;
                    break;
                  }
                }
              }
              if (!evidenceDescForQty) {
                evidenceDescForQty = ev.description;
              }
              if (evidenceDescForQty !== void 0 && typeof evidenceDescForQty !== "string") {
                evidenceDescForQty = String(evidenceDescForQty);
              }
              const similarity = this.computeDescriptionSimilarity(invoiceDesc, evidenceDescForQty);
              const SEMANTIC_THRESHOLD = 0.25;
              if (similarity < SEMANTIC_THRESHOLD) {
                if (bridgeLogOn) {
                  bridgeLog(`[OntologicalBridge] SKIPPED ACTUAL_QUANTITY binding - descriptions don't match (${(similarity * 100).toFixed(0)}% < ${SEMANTIC_THRESHOLD * 100}%)`);
                  bridgeLog(`[OntologicalBridge]   Invoice: "${typeof invoiceDesc === "string" ? invoiceDesc.slice(0, 50) : "N/A"}"`);
                  bridgeLog(`[OntologicalBridge]   Evidence: "${evidenceDescForQty?.slice(0, 50) || "N/A"}"`);
                }
                continue;
              }
            }
            let adjustedConfidence;
            const isDeterministicPath = match.matchType === "exact" || match.matchType === "alternative";
            if (isSingleEvidence && isDeterministicPath) {
              adjustedConfidence = match.confidence;
              if (bridgeLogOn) bridgeLog(`[OntologicalBridge] EVIDENCE BIND (single-deterministic): ${mapping.role} = ${String(match.value).slice(0, 50)} (${adjustedConfidence}%)`);
            } else if (isSingleEvidence) {
              adjustedConfidence = Math.min(75, match.confidence);
              if (bridgeLogOn) bridgeLog(`[OntologicalBridge] EVIDENCE BIND (single-fuzzy): ${mapping.role} = ${String(match.value).slice(0, 50)} (${adjustedConfidence}%)`);
            } else {
              adjustedConfidence = Math.min(50, Math.round(match.confidence * 0.5));
              if (bridgeLogOn) bridgeLog(`[OntologicalBridge] EVIDENCE BIND (uncorrelated): ${mapping.role} = ${String(match.value).slice(0, 50)} (${adjustedConfidence}% - LOW CONFIDENCE)`);
            }
            const normResult = this.normalizeValueForRole(match.value, mapping.role);
            bindings[mapping.role] = {
              value: normResult.normalized,
              source: "evidence",
              field: `evidence[${evIdx}].${match.matchPath}`,
              confidence: adjustedConfidence,
              // v4.5: Normalization provenance
              originalValue: normResult.meta?.original ?? match.value,
              normalizedValue: typeof normResult.normalized === "object" ? String(normResult.normalized) : normResult.normalized,
              normalizations: normResult.meta?.transformations
            };
            break;
          }
        }
      }
    }
    if (bindings.VERIFIED_AMOUNT && bindings.CLAIMED_AMOUNT) {
      const verified = bindings.VERIFIED_AMOUNT.value;
      const claimed = bindings.CLAIMED_AMOUNT.value;
      if (typeof verified === "number" && typeof claimed === "number" && claimed > 0) {
        const ratio = verified / claimed;
        if (ratio < 0.05 && verified < 100) {
          if (bridgeLogOn) {
            bridgeLog(`[OntologicalBridge] v5.11 FIX: Rejecting VERIFIED_AMOUNT=${verified} - implausibly small vs CLAIMED_AMOUNT=${claimed} (ratio: ${(ratio * 100).toFixed(1)}%)`);
            bridgeLog(`[OntologicalBridge]   This is likely hours (${verified}) misread as dollars from ticket totals.total`);
          }
          delete bindings.VERIFIED_AMOUNT;
        }
      }
    }
    this.computeDerivedBindings(bindings);
    let itemDescription;
    if (lineItemIndex !== void 0) {
      const lineItems = invoice.line_items;
      if (lineItems && lineItems[lineItemIndex]) {
        itemDescription = lineItems[lineItemIndex].description;
      }
    }
    return {
      bindings,
      invoiceId: invoice.document_number || invoice.id || "unknown",
      lineItemIndex,
      itemDescription,
      // Include correlation info for provenance
      correlationInfo: {
        evidence: evidenceCorrelation,
        contract: contractCorrelation
      }
    };
  }
  /**
   * Extract line item data for correlation matching
   */
  extractLineItemForCorrelation(invoice, lineItemIndex) {
    const lineItems = invoice.line_items;
    if (!lineItems || lineItemIndex === void 0 || !lineItems[lineItemIndex]) {
      return {
        description: invoice.description,
        date: this.extractDateValue(invoice),
        referenceIds: this.extractReferenceIds(invoice)
      };
    }
    const item = lineItems[lineItemIndex];
    return {
      description: item.description || item.service || item.name,
      date: this.extractDateValue(item) || this.extractDateValue(invoice),
      referenceIds: this.extractReferenceIds(invoice),
      quantity: item.quantity || item.hours || item.qty,
      rate: item.unit_price || item.rate || item.price,
      amount: item.amount || item.total
    };
  }
  /**
   * Extract contract rules for correlation matching
   */
  extractContractRulesForCorrelation(contract) {
    const rules = contract.financial_rules;
    if (!rules || !Array.isArray(rules)) return [];
    return rules.filter((r) => r !== null && typeof r === "object").map((rule) => ({
      ruleName: rule.rule_name || rule.name || rule.description,
      description: rule.description || rule.rule_name,
      rate: rule.values?.rate || rule.values?.hourly_rate || rule.rate,
      unit: rule.values?.unit || rule.unit
    }));
  }
  /**
   * Extract evidence items for correlation matching
   */
  extractEvidenceForCorrelation(evidence) {
    return evidence.map((ev) => ({
      description: ev.description || ev.service_description || ev.work_description,
      date: this.extractDateValue(ev),
      referenceIds: this.extractReferenceIds(ev),
      ticketNumber: ev.ticket_number || ev.document_number || ev.reference,
      quantity: ev.quantity || ev.totals?.total,
      hours: ev.totals?.hours || ev.totals?.total_hours || ev.hours
    }));
  }
  /**
   * Extract date value from document
   * v5.0: Implements MIN(service_date) logic for TIME_ORD accuracy
   */
  extractDateValue(doc3) {
    const dateFields = ["service_date", "work_date", "event_date", "date", "invoice_date", "ticket_date"];
    for (const field of dateFields) {
      const raw = doc3[field];
      if (typeof raw === "string" || typeof raw === "number") return String(raw);
    }
    const rawDates = doc3.dates;
    const dates = Array.isArray(rawDates) ? rawDates.filter((d) => d !== null && typeof d === "object") : void 0;
    if (dates && dates.length > 0) {
      const serviceDateTypes = ["service_date", "service", "work_date", "work", "event_date", "event"];
      const invoiceDateTypes = ["invoice_date", "invoice", "billing_date"];
      const serviceDates = dates.filter(
        (d) => d.type && serviceDateTypes.some((t) => d.type.toLowerCase().includes(t.toLowerCase()))
      );
      if (serviceDates.length > 0) {
        const dateValue = serviceDates[0].date || serviceDates[0].value;
        if (dateValue) return String(dateValue);
      }
      const nonInvoiceDates = dates.filter(
        (d) => !d.type || !invoiceDateTypes.some((t) => d.type.toLowerCase().includes(t.toLowerCase()))
      );
      if (nonInvoiceDates.length > 0) {
        const dateValue = nonInvoiceDates[0].date || nonInvoiceDates[0].value;
        if (dateValue) return String(dateValue);
      }
      const firstDateValue = dates[0]?.date || dates[0]?.value;
      if (firstDateValue) return String(firstDateValue);
    }
    return void 0;
  }
  /**
   * Extract reference IDs from document
   */
  extractReferenceIds(doc3) {
    const refs = [];
    const refFields = ["reference_ids", "po_number", "order_number", "ticket_number", "document_number"];
    for (const field of refFields) {
      const value = doc3[field];
      if (Array.isArray(value)) {
        refs.push(...value.map(String));
      } else if (value) {
        refs.push(String(value));
      }
    }
    return refs.filter((r) => r.length > 0);
  }
  /**
   * Validate that an extracted value matches the expected type for a role.
   * This prevents fuzzy matching from grabbing wrong fields.
   */
  validateValueType(value, role) {
    const declared = this.roleKinds[role];
    if (declared !== void 0) {
      const rep = _OntologicalBridge.KIND_REPRESENTATIVE[declared];
      if (rep !== role) return this.validateValueType(value, rep);
    }
    const numericRoles = [
      "RATE_APPLIED",
      "RATE_CONTRACTED",
      "CLAIMED_AMOUNT",
      "VERIFIED_AMOUNT",
      "CONTRACTED_LIMIT",
      "CLAIMED_QUANTITY",
      "ACTUAL_QUANTITY",
      "LINE_ITEM_TOTAL",
      "EXPECTED_TOTAL",
      // invoice document-level roles
      "SUBTOTAL",
      "TAX_AMOUNT",
      "TAX_RATE",
      "DISCOUNT_AMOUNT",
      "SERVICE_CHARGE",
      "GRAND_TOTAL",
      "LINE_ITEMS_SUM",
      "EXPECTED_GRAND_TOTAL",
      "EXPECTED_TAX_AMOUNT"
    ];
    const dateRoles = ["EVENT_DATE", "CONTRACT_START", "CONTRACT_END"];
    const arrayRoles = ["PRIOR_CLAIM_IDS"];
    const stringRoles = ["DOCUMENT_ID", "INVOICE_DESCRIPTION", "EVIDENCE_DESCRIPTION", "CURRENCY_CODE"];
    if (numericRoles.includes(role)) {
      if (typeof value === "number") return true;
      if (typeof value === "string") {
        const cleaned = value.replace(/[,$\s]/g, "");
        return !isNaN(parseFloat(cleaned)) && cleaned.match(/^-?\d*\.?\d+$/) !== null;
      }
      return false;
    }
    if (dateRoles.includes(role)) {
      if (value instanceof Date) return true;
      if (typeof value === "string") {
        const parsed = Date.parse(value);
        return !isNaN(parsed);
      }
      return false;
    }
    if (arrayRoles.includes(role)) {
      return Array.isArray(value);
    }
    if (stringRoles.includes(role)) {
      return typeof value === "string";
    }
    return true;
  }
  /**
   * v5.19: Deterministic keyword matching for contract rules
   *
   * When LLM correlation_map is unavailable (e.g., during code-only precompute),
   * this provides a reliable fallback by matching line item descriptions to
   * contract rule names using domain-specific keyword categories.
   *
   * Returns the best matching rule index and confidence score.
   */
  /**
   * v10.9.2: Enhanced keyword matching with expanded categories,
   * generic fallback, and correlation telemetry.
   */
  findContractRuleByKeywords(lineItemDescription, contractRules) {
    const desc = lineItemDescription.toLowerCase();
    const categories = [
      // === SPECIFIC CATEGORIES (check first) ===
      { name: "mileage", lineKeywords: ["mileage", "excess mile", "miles", "per mile"], ruleKeywords: ["mileage", "mile"], excludeRuleKeywords: ["crane"] },
      { name: "fuel", lineKeywords: ["fuel surcharge", "diesel surcharge", "fuel charge", "fsc"], ruleKeywords: ["fuel"], skipValidation: true },
      { name: "per_diem", lineKeywords: ["per diem", "per-diem", "overnight per diem", "overnight lodging", "lodging", "hotel", "motel"], ruleKeywords: ["per diem", "per-diem", "overnight", "lodging"] },
      { name: "standby", lineKeywords: ["standby", "wait time", "detention", "waiting", "delay"], ruleKeywords: ["standby", "detention", "wait"] },
      { name: "permit", lineKeywords: ["permit", "oversize", "overweight", "os/ow"], ruleKeywords: ["permit"] },
      { name: "crane", lineKeywords: ["crane", "rigging crew", "rigging", "lift"], ruleKeywords: ["crane", "rigging"] },
      { name: "pilot", lineKeywords: ["pilot car", "escort vehicle", "lead car", "chase car", "escort"], ruleKeywords: ["pilot", "escort"] },
      // === TRANSPORT/HAULING (common) ===
      { name: "heavy_haul", lineKeywords: ["heavy haul", "heavy-haul", "oversize load", "specialized transport"], ruleKeywords: ["heavy haul", "heavy-haul", "specialized"] },
      { name: "transport", lineKeywords: ["transport", "haul", "hauling", "trucking", "freight", "delivery", "shipping"], ruleKeywords: ["transport", "haul", "trucking", "freight", "delivery"] },
      // === WATER/FLUID SERVICES ===
      { name: "water", lineKeywords: ["water", "h2o", "hydro", "water haul", "water truck", "water service"], ruleKeywords: ["water", "h2o", "hydro"] },
      { name: "vacuum", lineKeywords: ["vacuum", "vac truck", "vac service", "vacuum truck"], ruleKeywords: ["vacuum", "vac"] },
      { name: "pump", lineKeywords: ["pump", "pumping", "pump truck", "pump service"], ruleKeywords: ["pump"] },
      // === LABOR/SERVICE (very common) ===
      { name: "labor", lineKeywords: ["labor", "labour", "manpower", "crew", "worker", "hand"], ruleKeywords: ["labor", "labour", "manpower", "crew", "hourly"] },
      { name: "service", lineKeywords: ["service", "services", "service call", "field service"], ruleKeywords: ["service", "hourly", "rate"] },
      { name: "hourly", lineKeywords: ["hourly", "per hour", "/hr", "/ hr", "hour rate"], ruleKeywords: ["hourly", "hour", "/hr"] },
      { name: "daily", lineKeywords: ["daily", "per day", "/day", "day rate"], ruleKeywords: ["daily", "day", "/day"] },
      // === EQUIPMENT ===
      { name: "equipment_rental", lineKeywords: ["equipment rental", "equipment rate", "equip rental"], ruleKeywords: ["equipment", "rental"] },
      { name: "rental", lineKeywords: ["rental", "rent", "lease"], ruleKeywords: ["rental", "rent", "lease"] },
      { name: "operator", lineKeywords: ["operator", "operated", "with operator"], ruleKeywords: ["operator", "operated"] },
      // === MISC CHARGES ===
      { name: "mobilization", lineKeywords: ["mobilization", "mob", "demob", "demobilization", "move-in", "move-out"], ruleKeywords: ["mobilization", "mob", "demob"] },
      { name: "minimum", lineKeywords: ["minimum", "min charge", "minimum charge", "min."], ruleKeywords: ["minimum", "min"] },
      { name: "overtime", lineKeywords: ["overtime", "ot", "over time", "after hours"], ruleKeywords: ["overtime", "ot", "after hours"] },
      { name: "weekend", lineKeywords: ["weekend", "saturday", "sunday", "sat/sun"], ruleKeywords: ["weekend", "saturday", "sunday"] },
      { name: "holiday", lineKeywords: ["holiday"], ruleKeywords: ["holiday"] },
      // === ADMIN/FEES ===
      { name: "admin", lineKeywords: ["admin", "administrative", "admin fee", "processing"], ruleKeywords: ["admin", "administrative", "processing"] },
      { name: "markup", lineKeywords: ["markup", "mark-up", "margin"], ruleKeywords: ["markup", "mark-up", "margin"] }
    ];
    let matchedCategory = null;
    for (const cat of categories) {
      if (cat.lineKeywords.some((kw) => desc.includes(kw))) {
        matchedCategory = cat;
        break;
      }
    }
    const logCorrelation = (result, details) => {
      bridgeLog(`[OntologicalBridge] CORRELATION ${result}: "${lineItemDescription.slice(0, 40)}" - ${details}`);
    };
    if (matchedCategory) {
      if (matchedCategory.skipValidation) {
        if (bridgeLogOn) logCorrelation("SKIP", `${matchedCategory.name} requires external validation`);
        return {
          matchedIndex: -1,
          ruleName: "",
          score: 0,
          explanation: `Skipping ${matchedCategory.name} - index-based, requires external validation`
        };
      }
      let bestMatch = null;
      for (let i = 0; i < contractRules.length; i++) {
        const rule = contractRules[i];
        const ruleName = (rule.rule_name || rule.description || "").toLowerCase();
        const ruleDesc = (rule.description || "").toLowerCase();
        const ruleText = ruleName + " " + ruleDesc;
        if (matchedCategory.excludeRuleKeywords?.some((kw) => ruleText.includes(kw))) {
          continue;
        }
        const matchCount = matchedCategory.ruleKeywords.filter((kw) => ruleText.includes(kw)).length;
        if (matchCount > 0) {
          const score2 = Math.min(90, 60 + matchCount * 15);
          if (!bestMatch || score2 > bestMatch.score) {
            bestMatch = { index: i, score: score2, rule };
          }
        }
      }
      if (bestMatch) {
        const ruleName = bestMatch.rule.rule_name || bestMatch.rule.description || "unnamed";
        if (bridgeLogOn) logCorrelation("CATEGORY", `${matchedCategory.name} \u2192 "${ruleName}" (${bestMatch.score}%)`);
        return {
          matchedIndex: bestMatch.index,
          ruleName,
          score: bestMatch.score,
          explanation: `Category "${matchedCategory.name}" matched rule "${ruleName}" with ${bestMatch.score}% confidence`
        };
      }
      if (bridgeLogOn) logCorrelation("CATEGORY_NO_RULE", `${matchedCategory.name} category but no matching rule in ${contractRules.length} rules`);
    }
    const lineWords = desc.replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2).filter((w) => !["the", "and", "for", "per", "with", "from", "this", "that"].includes(w));
    if (lineWords.length === 0) {
      if (bridgeLogOn) logCorrelation("FAIL", "No meaningful words in line item description");
      return {
        matchedIndex: -1,
        ruleName: "",
        score: 0,
        explanation: `No meaningful words in "${lineItemDescription.slice(0, 50)}"`
      };
    }
    let bestGenericMatch = null;
    for (let i = 0; i < contractRules.length; i++) {
      const rule = contractRules[i];
      const ruleName = (rule.rule_name || rule.description || "").toLowerCase();
      const ruleDesc = (rule.description || "").toLowerCase();
      const ruleText = ruleName + " " + ruleDesc;
      const matchedWords = lineWords.filter((word) => ruleText.includes(word));
      if (matchedWords.length > 0) {
        const overlapRatio = matchedWords.length / lineWords.length;
        const score2 = Math.min(75, Math.round(40 + overlapRatio * 35));
        if (!bestGenericMatch || matchedWords.length > bestGenericMatch.matchedWords.length || matchedWords.length === bestGenericMatch.matchedWords.length && score2 > bestGenericMatch.score) {
          bestGenericMatch = { index: i, score: score2, rule, matchedWords };
        }
      }
    }
    if (bestGenericMatch && bestGenericMatch.matchedWords.length >= 1) {
      const ruleName = bestGenericMatch.rule.rule_name || bestGenericMatch.rule.description || "unnamed";
      const wordsStr = bestGenericMatch.matchedWords.slice(0, 3).join(", ");
      if (bridgeLogOn) logCorrelation("GENERIC", `words [${wordsStr}] \u2192 "${ruleName}" (${bestGenericMatch.score}%)`);
      return {
        matchedIndex: bestGenericMatch.index,
        ruleName,
        score: bestGenericMatch.score,
        explanation: `Generic word match [${wordsStr}] to rule "${ruleName}" with ${bestGenericMatch.score}% confidence`
      };
    }
    if (bridgeLogOn) logCorrelation("FAIL", `No match in ${contractRules.length} rules. Line words: [${lineWords.slice(0, 5).join(", ")}]`);
    if (bridgeLogOn && contractRules.length > 0 && contractRules.length <= 10) {
      const ruleNames = contractRules.map((r) => r.rule_name || r.description || "unnamed");
      bridgeLog(`[OntologicalBridge] CORRELATION DEBUG: Available rules: [${ruleNames.join(", ")}]`);
    }
    return {
      matchedIndex: -1,
      ruleName: "",
      score: 0,
      explanation: `No keyword or word overlap match for "${lineItemDescription.slice(0, 50)}" in ${contractRules.length} rules`
    };
  }
  /**
   * Extract value with all fallback paths, returning confidence and match type.
   * Returns FuzzyMatchResult with confidence scoring.
   *
   * v5.1 FULL-SPECTRUM TRACEABILITY: Logs all resolution attempts to flight recorder
   */
  extractWithFallbacks(document, mapping, arrayIndex2) {
    const scope = this.flightRecorder ? null : this.scope;
    const memo = scope && this.isLineBlind(mapping, arrayIndex2, scope) ? perDocument(scope.direct, document) : void 0;
    const known = memo?.get(mapping);
    if (known === void 0) {
      const found = this.extractDirect(document, mapping, arrayIndex2);
      memo?.set(mapping, found === null ? null : { ...found });
      if (found !== null) return found;
    } else if (known !== null) {
      return { ...known };
    }
    const alternativesTried = this.flightRecorder ? [mapping.fieldPath, ...mapping.alternativePaths || []] : [];
    const fuzzyEnabled = mapping.fuzzyMatch !== false;
    if (fuzzyEnabled) {
      const value = this.fuzzyValueOf(document, mapping.fieldPath, arrayIndex2);
      if (value !== null && value !== void 0) {
        if (this.validateValueType(value, mapping.role)) {
          this.logResolutionAttempt("fuzzy", mapping.role, true, value, 75, "fuzzy", 1, alternativesTried, document);
          return {
            value,
            confidence: 75,
            matchType: "fuzzy",
            matchPath: "fuzzy"
          };
        } else {
          if (bridgeLogOn) bridgeLog(`[OntologicalBridge] Fuzzy match REJECTED for ${mapping.role}: got ${typeof value} (${String(value).slice(0, 50)})`);
          if (this.flightRecorder) this.logResolutionAttempt("fuzzy", mapping.role, false, null, 0, "none", 0, alternativesTried, document, `Type validation failed: expected ${mapping.role}-compatible, got ${typeof value}`);
        }
      }
    }
    if (this.flightRecorder) {
      this.logResolutionAttempt(
        mapping.fieldPath,
        mapping.role,
        false,
        null,
        0,
        "none",
        0,
        alternativesTried,
        document,
        `No path resolved for ${mapping.role}. Tried: ${alternativesTried.join(", ")}`
      );
    }
    return null;
  }
  /** Phases 1–2 of extractWithFallbacks: the primary path (confidence 100), then each alternative path (95). */
  extractDirect(document, mapping, arrayIndex2) {
    const alternativesTried = [];
    let value = this.extractValue(document, mapping.fieldPath, arrayIndex2, false);
    if (value !== null && value !== void 0) {
      this.logResolutionAttempt(mapping.fieldPath, mapping.role, true, value, 100, "exact", 1, alternativesTried, document);
      return {
        value,
        confidence: 100,
        matchType: "exact",
        matchPath: mapping.fieldPath
      };
    }
    alternativesTried.push(mapping.fieldPath);
    if (mapping.alternativePaths) {
      for (const altPath of mapping.alternativePaths) {
        value = this.extractValue(document, altPath, arrayIndex2, false);
        if (value !== null && value !== void 0) {
          this.logResolutionAttempt(altPath, mapping.role, true, value, 95, "alternative", 1, alternativesTried, document);
          return {
            value,
            confidence: 95,
            matchType: "alternative",
            matchPath: altPath
          };
        }
        alternativesTried.push(altPath);
      }
    }
    return null;
  }
  /**
   * extractValue with fuzzy search on. With no line index the search is a fixed function of (document, path), and every
   * value it returns is the document's own (no fresh container), so inside createLineItemBindings it runs once per
   * document. At a line index it stays per line: deepSearch reads that line's item.
   */
  fuzzyValueOf(document, fieldPath, arrayIndex2) {
    const memo = this.scope && arrayIndex2 === void 0 && typeof fieldPath === "string" && !fieldPath.startsWith("$") ? perDocument(this.scope.fuzzy, document) : void 0;
    if (memo?.has(fieldPath)) return memo.get(fieldPath);
    const value = this.extractValue(document, fieldPath, arrayIndex2, true);
    memo?.set(fieldPath, value);
    return value;
  }
  /**
   * Log a resolution attempt to the flight recorder
   * v5.1: Full-spectrum traceability for forensic replay
   */
  logResolutionAttempt(path, role, success, value, confidence, matchType, matchCount, alternativesTried, document, error) {
    if (!this.flightRecorder) return;
    try {
      const recordedMatchType = matchType === "none" ? void 0 : matchType;
      if (success) {
        this.flightRecorder.logSuccess(path, value, matchCount, {
          role,
          documentId: this.currentDocumentId,
          domain: this.currentDomain,
          documentType: this.currentDocumentType,
          confidence,
          matchType: recordedMatchType,
          alternativesTried: alternativesTried.length > 0 ? alternativesTried : void 0
        });
      } else {
        this.flightRecorder.logFailure(path, error || "No match found", {
          role,
          documentId: this.currentDocumentId,
          domain: this.currentDomain,
          documentType: this.currentDocumentType,
          alternativesTried: alternativesTried.length > 0 ? alternativesTried : void 0,
          // Include document snapshot on failure for forensic replay
          documentSnapshot: document
        });
      }
    } catch {
    }
  }
  /**
   * Normalize a value to a standard type using forensic normalizer
   * Returns both normalized value and normalization metadata for audit trail.
   */
  normalizeValue(value) {
    if (value === null || value === void 0) {
      return null;
    }
    if (typeof value === "number") {
      return value;
    }
    if (typeof value === "string") {
      const amountResult = normalizeAmount(value);
      if (amountResult?.success) {
        return amountResult.normalized;
      }
      const dateResult = normalizeDate(value);
      if (dateResult?.success) {
        return new Date(dateResult.normalized);
      }
      return value;
    }
    if (value instanceof Date) {
      return value;
    }
    if (Array.isArray(value)) {
      if (value.length > 0 && typeof value[0] === "object") {
        return value.map((v) => String(v));
      }
      return value.map((v) => String(v));
    }
    return String(value);
  }
  /**
   * Normalize a value for a specific role with full audit trail
   * Returns normalization metadata for provenance tracking.
   */
  normalizeValueForRole(value, role) {
    if (value === null || value === void 0) {
      return { normalized: null };
    }
    const declared = this.roleKinds[role];
    if (declared !== void 0) {
      const rep = _OntologicalBridge.KIND_REPRESENTATIVE[declared];
      if (rep !== role) return this.normalizeValueForRole(value, rep);
    }
    const priceRoles = ["RATE_APPLIED", "RATE_CONTRACTED"];
    const numericRoles = [
      "CLAIMED_AMOUNT",
      "VERIFIED_AMOUNT",
      "CONTRACTED_LIMIT",
      "LINE_ITEM_TOTAL",
      "EXPECTED_TOTAL",
      // invoice document-level amounts
      "SUBTOTAL",
      "TAX_AMOUNT",
      "DISCOUNT_AMOUNT",
      "SERVICE_CHARGE",
      "GRAND_TOTAL",
      "LINE_ITEMS_SUM",
      "EXPECTED_GRAND_TOTAL",
      "EXPECTED_TAX_AMOUNT"
    ];
    const rateRoles = ["TAX_RATE"];
    const quantityRoles = ["CLAIMED_QUANTITY", "ACTUAL_QUANTITY"];
    const dateRoles = ["EVENT_DATE", "CONTRACT_START", "CONTRACT_END"];
    const referenceRoles = ["DOCUMENT_ID"];
    if (rateRoles.includes(role)) {
      const result = normalizeRate(value);
      if (result?.success) {
        return {
          normalized: result.normalized,
          meta: result
        };
      }
    }
    if (priceRoles.includes(role)) {
      const result = normalizePrice(value);
      if (result?.success) {
        return {
          normalized: result.normalized,
          meta: result
        };
      }
    }
    if (numericRoles.includes(role)) {
      const result = normalizeAmount(value);
      if (result?.success) {
        return {
          normalized: result.normalized,
          meta: result
        };
      }
    }
    if (quantityRoles.includes(role)) {
      const result = normalizeQuantity(value);
      if (result?.success) {
        return {
          normalized: result.normalized,
          meta: result
        };
      }
    }
    if (dateRoles.includes(role)) {
      const result = normalizeDate(value);
      if (result?.success) {
        return {
          normalized: new Date(result.normalized),
          meta: result
        };
      }
      return { normalized: String(value), ...result ? { meta: result } : {} };
    }
    if (referenceRoles.includes(role)) {
      const result = normalizeReference(value);
      if (result?.success) {
        return {
          normalized: result.normalized,
          meta: result
        };
      }
    }
    return { normalized: this.normalizeValue(value) };
  }
  /**
   * Simple word overlap similarity for description matching
   * Returns 0-1 score
   */
  computeDescriptionSimilarity(a, b) {
    const strA = typeof a === "string" ? a : null;
    const strB = typeof b === "string" ? b : null;
    if (!strA || !strB) return 0;
    const wordsA = new Set(strA.toLowerCase().split(/\W+/).filter((w) => w.length >= 3));
    const wordsB = new Set(strB.toLowerCase().split(/\W+/).filter((w) => w.length >= 3));
    if (wordsA.size === 0 || wordsB.size === 0) return 0;
    let overlap = 0;
    Array.from(wordsA).forEach((word) => {
      if (wordsB.has(word)) overlap++;
    });
    return overlap / Math.min(wordsA.size, wordsB.size);
  }
  /**
   * Compute derived bindings (LINE_ITEM_TOTAL, EXPECTED_TOTAL, VERIFIED_AMOUNT)
   * v5.0 MATH_INT FIX: Compute VERIFIED_AMOUNT from invoice data when no evidence
   * v5.2 SCOPING FIX: Only compute EXPECTED_TOTAL when ACTUAL_QUANTITY has high correlation
   * v5.3 SEMANTIC FIX: Check description similarity before applying evidence quantities
   */
  computeDerivedBindings(bindings) {
    const rateApplied = bindings.RATE_APPLIED?.value;
    const claimedQty = bindings.CLAIMED_QUANTITY?.value;
    if (typeof rateApplied === "number" && typeof claimedQty === "number") {
      const computedTotal = rateApplied * claimedQty;
      bindings.LINE_ITEM_TOTAL = {
        value: computedTotal,
        source: "computed",
        field: "RATE_APPLIED * CLAIMED_QUANTITY",
        confidence: Math.min(bindings.RATE_APPLIED?.confidence ?? 0, bindings.CLAIMED_QUANTITY?.confidence ?? 0)
        // inherit the weakest operand
      };
      if (bridgeLogOn) bridgeLog(`[OntologicalBridge] COMPUTED: LINE_ITEM_TOTAL = ${rateApplied} \xD7 ${claimedQty} = ${computedTotal}`);
    }
    const rateContracted = bindings.RATE_CONTRACTED?.value;
    const actualQtyBinding = bindings.ACTUAL_QUANTITY;
    const actualQty = actualQtyBinding?.value;
    const invoiceDesc = bindings.INVOICE_DESCRIPTION?.value;
    const evidenceDesc = bindings.EVIDENCE_DESCRIPTION?.value;
    const descSimilarity = this.computeDescriptionSimilarity(invoiceDesc, evidenceDesc);
    const SIMILARITY_THRESHOLD = 0.3;
    const actualQtyIsCorrelated = actualQtyBinding && actualQtyBinding.source === "evidence" && actualQtyBinding.confidence >= 70 && (descSimilarity >= SIMILARITY_THRESHOLD || !invoiceDesc && !evidenceDesc);
    if (typeof rateContracted === "number" && typeof actualQty === "number" && actualQtyIsCorrelated) {
      bindings.EXPECTED_TOTAL = {
        value: rateContracted * actualQty,
        source: "computed",
        field: "RATE_CONTRACTED * ACTUAL_QUANTITY",
        confidence: Math.min(actualQtyBinding.confidence, 95)
        // Capped by correlation quality
      };
      if (bridgeLogOn) bridgeLog(`[OntologicalBridge] COMPUTED: EXPECTED_TOTAL = ${rateContracted} \xD7 ${actualQty} = ${rateContracted * actualQty} (similarity: ${(descSimilarity * 100).toFixed(0)}%)`);
    } else if (bridgeLogOn && typeof rateContracted === "number" && typeof actualQty === "number") {
      const invDescStr = typeof invoiceDesc === "string" ? invoiceDesc.slice(0, 50) : "N/A";
      const evDescStr = typeof evidenceDesc === "string" ? evidenceDesc.slice(0, 50) : "N/A";
      bridgeLog(`[OntologicalBridge] SKIPPED: EXPECTED_TOTAL - descriptions don't match (similarity: ${(descSimilarity * 100).toFixed(0)}%, threshold: ${SIMILARITY_THRESHOLD * 100}%)`);
      bridgeLog(`[OntologicalBridge]   Invoice: "${invDescStr}"`);
      bridgeLog(`[OntologicalBridge]   Evidence: "${evDescStr}"`);
    }
    if (!bindings.VERIFIED_AMOUNT) {
      if (bindings.LINE_ITEM_TOTAL) {
        bindings.VERIFIED_AMOUNT = {
          value: bindings.LINE_ITEM_TOTAL.value,
          source: "computed",
          field: "RATE_APPLIED * CLAIMED_QUANTITY (math check)",
          confidence: bindings.LINE_ITEM_TOTAL.confidence
          // inherit from the computed total
        };
        if (bridgeLogOn) bridgeLog(`[OntologicalBridge] COMPUTED: VERIFIED_AMOUNT = ${bindings.LINE_ITEM_TOTAL.value} (math check: rate\xD7qty)`);
      }
    }
  }
  /**
   * Create bindings for ALL line items in an invoice.
   * Returns an array of BindingContext, one per line item.
   *
   * v4.5: Accepts optional LLM correlation map for semantic matching.
   */
  createLineItemBindings(domainId, invoice, contract, evidence, llmCorrelationMap) {
    const keys = this.ontologies.get(domainId)?.lineArrayKeys ?? ["line_items"];
    const lineKey = keys.find((k) => Array.isArray(invoice[k]));
    const lineItems = lineKey !== void 0 ? invoice[lineKey] : void 0;
    if (!lineItems || !Array.isArray(lineItems)) {
      return [this.createBindings(domainId, invoice, contract, evidence, void 0, llmCorrelationMap)];
    }
    const contexts = [];
    const outer = this.scope;
    this.scope = outer ?? newDocumentScope();
    try {
      for (let i = 0; i < lineItems.length; i++) {
        contexts.push(this.createBindings(domainId, invoice, contract, evidence, i, llmCorrelationMap));
      }
    } finally {
      this.scope = outer;
    }
    return contexts;
  }
  /**
   * Convert extracted correlation_map from indexer format to internal format
   */
  static convertExtractedCorrelationMap(extractedMap) {
    if (!extractedMap?.line_item_mappings) {
      return void 0;
    }
    return {
      lineItemMappings: extractedMap.line_item_mappings.map((m) => ({
        invoiceLineIndex: m.invoice_line_index,
        invoiceLineDescription: m.invoice_line_description,
        matchedEvidence: (m.matched_evidence || []).map((e) => ({
          evidenceDocIndex: e.evidence_doc_index ?? -1,
          evidenceDescription: e.evidence_description,
          ticketNumber: e.ticket_number,
          confidence: e.confidence,
          reasoning: e.reasoning
        })),
        matchedContractRule: m.matched_contract_rule ? {
          ruleName: m.matched_contract_rule.rule_name,
          ruleIndex: m.matched_contract_rule.rule_index ?? -1,
          confidence: m.matched_contract_rule.confidence,
          reasoning: m.matched_contract_rule.reasoning
        } : void 0
      }))
    };
  }
  /**
   * Get all available domains
   */
  getAvailableDomains() {
    return Array.from(this.ontologies.keys());
  }
  /**
   * Diagnostic: Show what paths would be tried for a role
   */
  debugPathResolution(domainId, role, documentType) {
    const ontology = this.ontologies.get(domainId);
    if (!ontology) return [];
    const paths = [];
    for (const mapping of ontology.mappings) {
      if (mapping.role === role && (mapping.documentType === documentType || mapping.documentType === "any")) {
        paths.push(mapping.fieldPath);
        if (mapping.alternativePaths) {
          paths.push(...mapping.alternativePaths);
        }
        if (mapping.fieldAliases) {
          paths.push(...mapping.fieldAliases.map((a) => `[fuzzy:${a}]`));
        }
      }
    }
    return paths;
  }
};
var bridgeInstance = null;
function getOntologicalBridge() {
  if (!bridgeInstance) {
    bridgeInstance = new OntologicalBridge();
  }
  return bridgeInstance;
}

// packages/verify/src/kernel/axiom-registry.ts
var RATE_SUPREMACY = {
  id: "ax-rate-sup",
  shortCode: "RATE_SUP",
  name: "Law of Rate Supremacy",
  axiomStatement: "A claimed rate cannot exceed the contracted rate",
  formalForm: "\u2200r: r_applied \u2264 r_contracted",
  predicates: [
    {
      leftRole: "RATE_APPLIED",
      operator: "<=",
      rightRole: "RATE_CONTRACTED",
      tolerance: 0.01,
      // 1 cent tolerance
      description: "Invoice rate must not exceed contracted rate"
    }
  ],
  requiredRoles: ["RATE_APPLIED", "RATE_CONTRACTED"],
  combinationLogic: "AND",
  detectableBy: "PRECOMPUTE",
  severity: "high",
  applicableDomains: []
  // Universal
};
var QUANTITY_MATCH = {
  id: "ax-qty-match",
  shortCode: "QTY_MATCH",
  name: "Law of Quantity Match",
  axiomStatement: "Claimed quantity must match verified quantity from evidence",
  formalForm: "\u2200q: q_claimed = q_verified",
  predicates: [
    {
      leftRole: "CLAIMED_QUANTITY",
      operator: "=",
      rightRole: "ACTUAL_QUANTITY",
      tolerance: 1e-3,
      // Small tolerance for rounding
      description: "Invoice quantity must match evidence quantity"
    }
  ],
  requiredRoles: ["CLAIMED_QUANTITY", "ACTUAL_QUANTITY"],
  combinationLogic: "AND",
  detectableBy: "PRECOMPUTE",
  severity: "high",
  applicableDomains: []
};
var TEMPORAL_ORDER = {
  id: "ax-time-ord",
  shortCode: "TIME_ORD",
  name: "Law of Temporal Order",
  axiomStatement: "Service date must fall within contract effective period",
  formalForm: "\u2200t: contract_start \u2264 t_event \u2264 contract_end",
  predicates: [
    {
      leftRole: "EVENT_DATE",
      operator: ">=",
      rightRole: "CONTRACT_START",
      description: "Service date must be on or after contract start"
    },
    {
      leftRole: "EVENT_DATE",
      operator: "<=",
      rightRole: "CONTRACT_END",
      description: "Service date must be on or before contract end"
    }
  ],
  requiredRoles: ["EVENT_DATE", "CONTRACT_START", "CONTRACT_END"],
  combinationLogic: "AND",
  detectableBy: "PRECOMPUTE",
  severity: "critical",
  applicableDomains: []
};
var DUPLICATE_PROHIBITION = {
  id: "ax-dup-prohib",
  shortCode: "DUP_PROHIB",
  name: "Law of Duplicate Prohibition",
  axiomStatement: "A claim cannot duplicate a prior approved claim",
  formalForm: "\u2200c: prior_claims(c) = \u2205",
  predicates: [
    {
      leftRole: "PRIOR_CLAIM_IDS",
      operator: "EMPTY",
      rightRole: null,
      description: "No prior claims should exist for this service"
    }
  ],
  requiredRoles: ["PRIOR_CLAIM_IDS"],
  combinationLogic: "AND",
  detectableBy: "BOTH",
  // May need LLM to identify fuzzy duplicates
  severity: "critical",
  applicableDomains: []
};
var MATH_INTEGRITY = {
  id: "ax-math-int",
  shortCode: "MATH_INT",
  name: "Law of Mathematical Integrity",
  axiomStatement: "Claimed amount must equal calculated/verified amount",
  formalForm: "\u2200a: a_claimed = a_calculated",
  predicates: [
    {
      leftRole: "CLAIMED_AMOUNT",
      operator: "=",
      rightRole: "VERIFIED_AMOUNT",
      tolerance: 0.01,
      // 1 cent tolerance
      description: "Invoice amount must match verified amount"
    }
  ],
  requiredRoles: ["CLAIMED_AMOUNT", "VERIFIED_AMOUNT"],
  combinationLogic: "AND",
  detectableBy: "PRECOMPUTE",
  severity: "high",
  applicableDomains: []
};
var AMOUNT_CAP = {
  id: "ax-amt-cap",
  shortCode: "AMT_CAP",
  name: "Law of Amount Cap",
  axiomStatement: "Claimed amount cannot exceed contracted maximum",
  formalForm: "\u2200a: a_claimed \u2264 a_max",
  predicates: [
    {
      leftRole: "CLAIMED_AMOUNT",
      operator: "<=",
      rightRole: "CONTRACTED_LIMIT",
      tolerance: 0.01,
      description: "Invoice amount must not exceed contracted limit"
    }
  ],
  requiredRoles: ["CLAIMED_AMOUNT", "CONTRACTED_LIMIT"],
  combinationLogic: "AND",
  detectableBy: "PRECOMPUTE",
  severity: "high",
  applicableDomains: []
};
var EVIDENCE_REQUIREMENT = {
  id: "ax-evid-req",
  shortCode: "EVID_REQ",
  name: "Law of Evidence Requirement",
  axiomStatement: "Every claim must have supporting documentary evidence",
  formalForm: "\u2200c: evidence(c) \u2260 \u2205",
  predicates: [
    {
      leftRole: "ACTUAL_QUANTITY",
      operator: "EXISTS",
      rightRole: null,
      description: "Evidence quantity must exist for claimed items"
    }
  ],
  requiredRoles: [],
  // No roles required - we're checking if evidence EXISTS
  combinationLogic: "AND",
  detectableBy: "BOTH",
  // Semi-computable: can detect missing, but LLM verifies match
  severity: "medium",
  applicableDomains: []
};
var DESCRIPTION_MATCH = {
  id: "ax-desc-match",
  shortCode: "DESC_MATCH",
  name: "Law of Description Match",
  axiomStatement: "Invoice service description must match evidence documentation",
  formalForm: "\u2200d: semantic_match(d_invoice, d_evidence) = true",
  predicates: [],
  // No computational predicates - LLM handles semantic matching
  requiredRoles: ["INVOICE_DESCRIPTION", "EVIDENCE_DESCRIPTION"],
  // Kept for binding/provenance
  combinationLogic: "AND",
  detectableBy: "LLM",
  // Semantic matching requires LLM
  severity: "medium",
  applicableDomains: []
};
var STRUCTURAL_OMISSION = {
  id: "ax-omission",
  shortCode: "OMISSION",
  name: "Law of Structural Completeness",
  axiomStatement: "Required data fields must be present for validation to proceed",
  formalForm: "\u2200f \u2208 RequiredFields: f \u2260 \u2205",
  predicates: [],
  // Omission detection is handled by omission-detector.ts, not predicates
  requiredRoles: [],
  // Dynamic - depends on domain configuration
  combinationLogic: "AND",
  detectableBy: "PRECOMPUTE",
  severity: "critical",
  applicableDomains: []
  // Universal - applies to all domains
};
var TERMINATION_GUARANTEE = {
  id: "ax-term-guar",
  shortCode: "TERMINATION_GUARANTEE",
  name: "Law of Termination Guarantee",
  axiomStatement: "All execution paths must have verified termination conditions",
  formalForm: "\u2200loop: verified_exits(loop) \u2265 1",
  predicates: [
    {
      leftRole: "ACTUAL_QUANTITY",
      // Verified exits
      operator: ">=",
      rightRole: "CLAIMED_QUANTITY",
      // Claimed exits
      tolerance: 0,
      description: "Verified exits must match or exceed claimed exits"
    }
  ],
  requiredRoles: ["CLAIMED_QUANTITY", "ACTUAL_QUANTITY"],
  combinationLogic: "AND",
  detectableBy: "PRECOMPUTE",
  severity: "critical",
  applicableDomains: ["code"]
};
var STATE_EXCLUSIVITY = {
  id: "ax-state-ex",
  shortCode: "STATE_EXCLUSIVITY",
  name: "Law of State Exclusivity",
  axiomStatement: "All shared state must be protected by synchronization primitives",
  formalForm: "\u2200v \u2208 SharedVars: synchronized(v)",
  predicates: [
    {
      leftRole: "ACTUAL_QUANTITY",
      // Synchronized accesses
      operator: ">=",
      rightRole: "CLAIMED_QUANTITY",
      // Shared variables
      tolerance: 0,
      description: "All shared variables must have synchronization"
    }
  ],
  requiredRoles: ["CLAIMED_QUANTITY", "ACTUAL_QUANTITY"],
  combinationLogic: "AND",
  detectableBy: "PRECOMPUTE",
  severity: "high",
  applicableDomains: ["code"]
};
var MEMORY_CONSERVATION = {
  id: "ax-mem-cons",
  shortCode: "MEMORY_CONSERVATION",
  name: "Law of Memory Conservation",
  axiomStatement: "All memory allocations must have corresponding releases",
  formalForm: "\u2200alloc: \u2203release(alloc)",
  predicates: [
    {
      leftRole: "ACTUAL_QUANTITY",
      // Releases
      operator: ">=",
      rightRole: "CLAIMED_QUANTITY",
      // Allocations
      tolerance: 0,
      description: "Releases must match or exceed allocations"
    }
  ],
  requiredRoles: ["CLAIMED_QUANTITY", "ACTUAL_QUANTITY"],
  combinationLogic: "AND",
  detectableBy: "PRECOMPUTE",
  severity: "high",
  applicableDomains: ["code"]
};
var ORGANIC_DISTRIBUTION = {
  id: "ax-org-dist",
  shortCode: "ORGANIC_DISTRIBUTION",
  name: "Law of Organic Distribution",
  axiomStatement: "Human activity patterns follow natural distributions with high entropy",
  formalForm: "\u2200activity: entropy(timestamps) \u2265 0.7",
  predicates: [
    {
      leftRole: "RATE_APPLIED",
      // Actual entropy
      operator: ">=",
      rightRole: "RATE_CONTRACTED",
      // Required entropy (0.7)
      tolerance: 0.05,
      description: "Activity entropy must indicate organic behavior"
    }
  ],
  requiredRoles: ["RATE_APPLIED", "RATE_CONTRACTED"],
  combinationLogic: "AND",
  detectableBy: "PRECOMPUTE",
  severity: "critical",
  applicableDomains: ["media"]
};
var VOTE_CONSERVATION = {
  id: "ax-vote-cons",
  shortCode: "VOTE_CONSERVATION",
  name: "Law of Vote Conservation",
  axiomStatement: "Total votes cast cannot exceed registered voter count",
  formalForm: "\u2200election: votes_cast \u2264 registered_voters",
  predicates: [
    {
      leftRole: "CLAIMED_QUANTITY",
      // Votes cast
      operator: "<=",
      rightRole: "CONTRACTED_LIMIT",
      // Registered voters
      tolerance: 0,
      description: "Votes must not exceed registration"
    }
  ],
  requiredRoles: ["CLAIMED_QUANTITY", "CONTRACTED_LIMIT"],
  combinationLogic: "AND",
  detectableBy: "PRECOMPUTE",
  severity: "critical",
  applicableDomains: ["media"]
};
var TRANSITIVE_PROPERTY = {
  id: "ax-trans-prop",
  shortCode: "TRANSITIVE_PROPERTY",
  name: "Law of Transitive Property",
  axiomStatement: "Logical chains must preserve validity across all links",
  formalForm: "(A\u2192B \u2227 B\u2192C) \u2192 (A\u2192C)",
  predicates: [
    {
      leftRole: "ACTUAL_QUANTITY",
      // Verified links
      operator: ">=",
      rightRole: "CLAIMED_QUANTITY",
      // Stated links
      tolerance: 0,
      description: "All logical links must be verified"
    }
  ],
  requiredRoles: ["CLAIMED_QUANTITY", "ACTUAL_QUANTITY"],
  combinationLogic: "AND",
  detectableBy: "PRECOMPUTE",
  severity: "critical",
  applicableDomains: ["philosophy"]
};
var CIRCULAR_PROHIBITION = {
  id: "ax-circ-prohib",
  shortCode: "CIRCULAR_PROHIBITION",
  name: "Law of Circular Prohibition",
  axiomStatement: "Arguments must not beg the question (conclusion in premise)",
  formalForm: "\u2200arg: premise \u2229 conclusion = \u2205",
  predicates: [
    {
      leftRole: "ACTUAL_QUANTITY",
      // Circularity score
      operator: "<",
      rightRole: "CONTRACTED_LIMIT",
      // Max allowed (0.1)
      tolerance: 0.01,
      description: "Circularity must be below threshold"
    }
  ],
  requiredRoles: ["ACTUAL_QUANTITY", "CONTRACTED_LIMIT"],
  combinationLogic: "AND",
  detectableBy: "PRECOMPUTE",
  severity: "high",
  applicableDomains: ["philosophy"]
};
var EUPHEMISM_DETECTION = {
  id: "ax-sem-euphemism",
  shortCode: "SEM_EUPHEMISM",
  name: "Law of Plain Language",
  axiomStatement: "Claims should use direct language, not euphemisms",
  formalForm: "\u2200text: euphemism_count(text) = 0",
  predicates: [
    {
      leftRole: "CLAIMED_AMOUNT",
      // Euphemism count
      operator: "<=",
      rightRole: "CONTRACTED_LIMIT",
      // Max allowed (0)
      tolerance: 0,
      description: "No euphemisms should be present"
    }
  ],
  requiredRoles: ["CLAIMED_AMOUNT", "CONTRACTED_LIMIT"],
  combinationLogic: "AND",
  detectableBy: "PRECOMPUTE",
  severity: "medium",
  applicableDomains: ["finance", "legal", "medical", "science"]
};
var DISCLOSURE_REQUIREMENTS = {
  id: "ax-sem-disclosure",
  shortCode: "SEM_DISCLOSURE",
  name: "Law of Required Disclosures",
  axiomStatement: "Documents must contain all required disclosures",
  formalForm: "\u2200req \u2208 requirements: present(doc, req)",
  predicates: [
    {
      leftRole: "ACTUAL_QUANTITY",
      // Disclosures found
      operator: ">=",
      rightRole: "CLAIMED_QUANTITY",
      // Disclosures required
      tolerance: 0,
      description: "All required disclosures must be present"
    }
  ],
  requiredRoles: ["ACTUAL_QUANTITY", "CLAIMED_QUANTITY"],
  combinationLogic: "AND",
  detectableBy: "PRECOMPUTE",
  severity: "high",
  applicableDomains: ["finance", "legal", "medical", "science"]
};
var PROPORTIONALITY_CHECK = {
  id: "ax-sem-proportionality",
  shortCode: "SEM_PROPORTIONALITY",
  name: "Law of Proportional Claims",
  axiomStatement: "Claim magnitudes must be proportional to evidence",
  formalForm: "|claim/evidence| \u2264 maxRatio",
  predicates: [
    {
      leftRole: "CLAIMED_AMOUNT",
      // Claim magnitude
      operator: "<=",
      rightRole: "VERIFIED_AMOUNT",
      // Evidence magnitude × maxRatio
      tolerance: 0.1,
      description: "Claim must not exceed evidence by ratio threshold"
    }
  ],
  requiredRoles: ["CLAIMED_AMOUNT", "VERIFIED_AMOUNT"],
  combinationLogic: "AND",
  detectableBy: "PRECOMPUTE",
  severity: "high",
  applicableDomains: ["finance", "legal", "medical", "science"]
};
var CHERRY_PICKING_DETECTION = {
  id: "ax-sem-cherry-picking",
  shortCode: "SEM_CHERRY_PICKING",
  name: "Law of Complete Evidence",
  axiomStatement: "Claims must not selectively present data",
  formalForm: "cited_data \u2286 relevant_data \u2192 \xACcherry_picked",
  predicates: [
    {
      leftRole: "ACTUAL_QUANTITY",
      // Cited evidence ratio
      operator: ">=",
      rightRole: "CONTRACTED_LIMIT",
      // Minimum coverage (0.8)
      tolerance: 0.1,
      description: "Must cite sufficient portion of relevant data"
    }
  ],
  requiredRoles: ["ACTUAL_QUANTITY", "CONTRACTED_LIMIT"],
  combinationLogic: "AND",
  detectableBy: "LLM",
  severity: "high",
  applicableDomains: ["science", "legal", "medical"]
};
var CAUSAL_VALIDITY = {
  id: "ax-sem-causal-validity",
  shortCode: "SEM_CAUSAL_VALIDITY",
  name: "Law of Causal Validity",
  axiomStatement: "Causal claims must be supported by appropriate methodology",
  formalForm: "claim(A\u2192B) \u2192 methodology_supports(A\u2192B)",
  predicates: [
    {
      leftRole: "CLAIMED_AMOUNT",
      // Methodology strength
      operator: ">=",
      rightRole: "CONTRACTED_LIMIT",
      // Required strength for causal claim
      tolerance: 0.05,
      description: "Methodology must support causal inference"
    }
  ],
  requiredRoles: ["CLAIMED_AMOUNT", "CONTRACTED_LIMIT"],
  combinationLogic: "AND",
  detectableBy: "LLM",
  severity: "high",
  applicableDomains: ["science", "medical"]
};
var FRAMING_ANALYSIS = {
  id: "ax-sem-framing",
  shortCode: "SEM_FRAMING",
  name: "Law of Neutral Framing",
  axiomStatement: "Information should be presented without biased framing",
  formalForm: "bias_score(text) \u2264 threshold",
  predicates: [
    {
      leftRole: "CLAIMED_AMOUNT",
      // Bias score
      operator: "<=",
      rightRole: "CONTRACTED_LIMIT",
      // Max allowed bias
      tolerance: 0.1,
      description: "Text must not contain excessive framing bias"
    }
  ],
  requiredRoles: ["CLAIMED_AMOUNT", "CONTRACTED_LIMIT"],
  combinationLogic: "AND",
  detectableBy: "LLM",
  severity: "medium",
  applicableDomains: ["media", "legal", "finance"]
};
var CORE_AXIOMS = [
  RATE_SUPREMACY,
  QUANTITY_MATCH,
  TEMPORAL_ORDER,
  DUPLICATE_PROHIBITION,
  MATH_INTEGRITY,
  AMOUNT_CAP
];
var EXTENDED_AXIOMS = [
  ...CORE_AXIOMS,
  EVIDENCE_REQUIREMENT,
  DESCRIPTION_MATCH,
  STRUCTURAL_OMISSION,
  // The Octagon - Domain-Specific Axioms
  TERMINATION_GUARANTEE,
  // Code: loops must terminate
  STATE_EXCLUSIVITY,
  // Code: synchronized access
  MEMORY_CONSERVATION,
  // Code: no leaks
  ORGANIC_DISTRIBUTION,
  // Media: bell curves not step functions
  VOTE_CONSERVATION,
  // Media: votes <= voters
  TRANSITIVE_PROPERTY,
  // Philosophy: A→B→C implies A→C
  CIRCULAR_PROHIBITION,
  // Philosophy: no begging the question
  // Level 4: Semantic Axioms
  EUPHEMISM_DETECTION,
  // Semantic: detect softening language
  DISCLOSURE_REQUIREMENTS,
  // Semantic: check required disclosures
  PROPORTIONALITY_CHECK,
  // Semantic: claim vs evidence magnitude
  CHERRY_PICKING_DETECTION,
  // Semantic: selective data presentation (LLM)
  CAUSAL_VALIDITY,
  // Semantic: cause-effect validity (LLM)
  FRAMING_ANALYSIS
  // Semantic: biased framing (LLM)
];
var AXIOM_BY_CODE = new Map(
  EXTENDED_AXIOMS.map((a) => [a.shortCode, a])
);
var AXIOM_BY_ID = new Map(
  EXTENDED_AXIOMS.map((a) => [a.id, a])
);
var AxiomRegistry = class {
  axioms = /* @__PURE__ */ new Map();
  axiomsByCode = /* @__PURE__ */ new Map();
  constructor() {
    for (const axiom of EXTENDED_AXIOMS) {
      this.register(axiom);
    }
  }
  /**
   * Register a computational axiom
   */
  register(axiom) {
    this.axioms.set(axiom.id, axiom);
    this.axiomsByCode.set(axiom.shortCode, axiom);
  }
  /**
   * Get axiom by ID
   */
  getById(id) {
    return this.axioms.get(id);
  }
  /**
   * Get axiom by short code
   */
  getByCode(code2) {
    return this.axiomsByCode.get(code2);
  }
  /**
   * Get all axioms
   */
  getAll() {
    return Array.from(this.axioms.values());
  }
  /**
   * Get axioms applicable to a domain
   */
  getForDomain(domainId) {
    return this.getAll().filter(
      (a) => a.applicableDomains.length === 0 || a.applicableDomains.includes(domainId)
    );
  }
  /**
   * Get precomputable axioms (can be evaluated without LLM)
   */
  getPrecomputable() {
    return this.getAll().filter(
      (a) => a.detectableBy === "PRECOMPUTE" || a.detectableBy === "BOTH"
    );
  }
  /**
   * Get LLM-required axioms
   */
  getLLMRequired() {
    return this.getAll().filter((a) => a.detectableBy === "LLM");
  }
  /**
   * Get axioms that require specific roles
   */
  getRequiringRoles(roles) {
    const roleSet = new Set(roles);
    return this.getAll().filter(
      (a) => a.requiredRoles.every((r) => roleSet.has(r))
    );
  }
  /**
   * Check if axiom is applicable given available bindings
   */
  isApplicable(axiomId, availableRoles) {
    const axiom = this.axioms.get(axiomId);
    if (!axiom) return false;
    const roleSet = new Set(availableRoles);
    return axiom.requiredRoles.every((r) => roleSet.has(r));
  }
};
var registryInstance = null;
function getAxiomRegistry() {
  if (!registryInstance) {
    registryInstance = new AxiomRegistry();
  }
  return registryInstance;
}

// packages/verify/src/kernel/validation-gavel.ts
var log = () => {
};
function setGavelLogger(logger) {
  log = logger ?? (() => {
  });
}
function isValidDate(x) {
  return x instanceof Date && !isNaN(x.getTime());
}
function valueKind(x) {
  if (x === null || x === void 0) return "missing";
  if (x instanceof Date) return "date";
  if (Array.isArray(x)) return "list";
  return typeof x;
}
function describeOperand(x) {
  const k = valueKind(x);
  if (k === "string") {
    const s = x;
    return `the text "${s.length > 40 ? `${s.slice(0, 40)}\u2026` : s}"`;
  }
  return k === "missing" ? "missing" : `a ${k}`;
}
function mismatchReason(op, p, left, right) {
  const rightName = p.rightRole ?? "the constant";
  return `Type mismatch for ${op} comparison: ${p.leftRole} is ${describeOperand(left)}, ${rightName} is ${describeOperand(right)}, so they could not be compared`;
}
var ValidationGavel = class {
  DEFAULT_TOLERANCE = 0.01;
  // 1 cent for currency
  /**
   * Get human-readable hint for what to supply for a role.
   */
  getRoleHint(role) {
    const hints = {
      RATE_APPLIED: "the rate/unit price from the invoice",
      RATE_CONTRACTED: "the contracted rate from the contract",
      CLAIMED_AMOUNT: "the billed/invoiced amount",
      VERIFIED_AMOUNT: "the verified amount from evidence",
      CONTRACTED_LIMIT: "the maximum allowed amount from contract",
      CLAIMED_QUANTITY: "the quantity claimed on the invoice",
      ACTUAL_QUANTITY: "the actual quantity from evidence (field tickets)",
      EVENT_DATE: "the service date from the invoice",
      CONTRACT_START: "the contract effective/start date",
      CONTRACT_END: "the contract expiration/end date",
      DOCUMENT_ID: "the invoice or document number",
      PRIOR_CLAIM_IDS: "prior_invoice_ids \u2014 an array of previously seen invoice numbers, supplied by the caller, for duplicate detection",
      LINE_ITEM_TOTAL: "the computed line item total",
      EXPECTED_TOTAL: "the expected total based on contract rates",
      INVOICE_DESCRIPTION: "the service description from the invoice",
      EVIDENCE_DESCRIPTION: "the service description from evidence",
      SUBTOTAL: "the stated subtotal from the invoice",
      TAX_AMOUNT: "the stated tax amount from the invoice",
      TAX_RATE: "the stated tax rate from the invoice",
      DISCOUNT_AMOUNT: "the stated discount from the invoice",
      GRAND_TOTAL: "the stated grand total from the invoice",
      LINE_ITEMS_SUM: "the sum of line item amounts (computed)",
      CURRENCY_CODE: "the ISO-4217 currency code"
    };
    return hints[role] ?? role;
  }
  /**
   * Validate a single axiom against bindings.
   */
  validateAxiom(axiom, bindings) {
    const missingRoles = [];
    for (const role of axiom.requiredRoles) {
      if (!bindings.bindings[role] || bindings.bindings[role]?.value === null) {
        missingRoles.push(role);
      }
    }
    if (missingRoles.length > 0) {
      const boundCount = axiom.requiredRoles.length - missingRoles.length;
      const bindingCoverage = axiom.requiredRoles.length > 0 ? boundCount / axiom.requiredRoles.length * 100 : 0;
      const extractionHint = `Please supply: ${missingRoles.map((r) => this.getRoleHint(r)).join(", ")}`;
      return {
        axiomId: axiom.id,
        axiomCode: axiom.shortCode,
        verdict: "INSUFFICIENT_DATA",
        confidence: "LOW",
        isLocked: false,
        predicateResults: [],
        missingRoles,
        bindingCoverage,
        extractionHint,
        validatedAt: /* @__PURE__ */ new Date(),
        explanation: `Cannot evaluate: missing bindings for ${missingRoles.join(", ")}`
      };
    }
    const predicateResults = [];
    for (const predicate of axiom.predicates) {
      const result = this.evaluatePredicate(predicate, bindings);
      predicateResults.push(result);
    }
    let passed;
    if (axiom.combinationLogic === "AND") {
      passed = predicateResults.every((r) => r.passed);
    } else {
      passed = predicateResults.some((r) => r.passed);
    }
    const confidence = this.calculateConfidence(bindings, axiom.requiredRoles);
    const allBindingsHighConfidence = this.allRequiredBindingsExact(bindings, axiom.requiredRoles);
    const needsCorrelation = this.axiomNeedsCorrelation(axiom);
    const correlationIsReliable = this.checkCorrelationReliable(bindings, needsCorrelation);
    if ((needsCorrelation.contract || needsCorrelation.evidence) && !correlationIsReliable) {
      log(`[ValidationGavel] Locking prevented: ${axiom.shortCode} requires reliable correlation but correlation is weak/missing`);
    }
    const isLocked = !passed && allBindingsHighConfidence && // ALL bindings must be exact matches
    (!(needsCorrelation.contract || needsCorrelation.evidence) || correlationIsReliable) && // v4.5: Correlation must be reliable if needed
    (axiom.detectableBy === "PRECOMPUTE" || // Lock BOTH axioms only for definitive negative checks
    // We can prove absence of data; a reasoner can't find what doesn't exist
    axiom.detectableBy === "BOTH" && this.isDefinitiveNegativeResult(axiom, predicateResults));
    const variance = this.calculateVariance(predicateResults, bindings, axiom);
    const explanation = this.generateExplanation(axiom, predicateResults, passed);
    return {
      axiomId: axiom.id,
      axiomCode: axiom.shortCode,
      verdict: passed ? "PASS" : "FAIL",
      confidence,
      isLocked,
      variance,
      predicateResults,
      bindingCoverage: 100,
      // All required roles were bound if we got here
      validatedAt: /* @__PURE__ */ new Date(),
      explanation
    };
  }
  /**
   * Validate all applicable axioms against bindings.
   */
  validateAll(bindings, domainId) {
    const registry = getAxiomRegistry();
    const axioms = domainId ? registry.getForDomain(domainId) : registry.getAll();
    const results = [];
    for (const axiom of axioms) {
      const result = this.validateAxiom(axiom, bindings);
      results.push(result);
    }
    return this.summarize(bindings.invoiceId, results);
  }
  /**
   * Validate precomputable axioms only (fast path, no reasoner needed).
   * Evaluates the static registry, optionally filtered to a domain.
   */
  validatePrecomputable(bindings, domainId) {
    const registry = getAxiomRegistry();
    let axioms = registry.getPrecomputable();
    if (domainId) {
      axioms = axioms.filter(
        (a) => a.applicableDomains.length === 0 || a.applicableDomains.includes(domainId)
      );
    }
    const results = [];
    for (const axiom of axioms) {
      results.push(this.validateAxiom(axiom, bindings));
    }
    return this.summarize(bindings.invoiceId, results);
  }
  /**
   * Build the report summary from results.
   */
  summarize(invoiceId, results) {
    const lockedFailures = results.filter((r) => r.isLocked).length;
    const passCount = results.filter((r) => r.verdict === "PASS").length;
    const failCount = results.filter((r) => r.verdict === "FAIL").length;
    const insufficientCount = results.filter((r) => r.verdict === "INSUFFICIENT_DATA").length;
    return {
      invoiceId,
      results,
      lockedFailures,
      passCount,
      failCount,
      insufficientCount,
      generatedAt: /* @__PURE__ */ new Date()
    };
  }
  /**
   * Evaluate a single predicate against bindings.
   * v4.5: Includes binding provenance with full normalization audit trail.
   */
  evaluatePredicate(predicate, bindings) {
    const leftBound = bindings.bindings[predicate.leftRole];
    const leftValue = leftBound?.value ?? null;
    const leftProvenance = leftBound ? {
      role: predicate.leftRole,
      value: leftBound.value,
      source: leftBound.source,
      fieldPath: leftBound.field,
      confidence: leftBound.confidence,
      // v4.5: Normalization audit trail
      originalValue: leftBound.originalValue,
      normalizedValue: leftBound.normalizedValue,
      normalizations: leftBound.normalizations
    } : void 0;
    let rightValue = null;
    let rightProvenance = void 0;
    if (predicate.rightRole) {
      const rightBound = bindings.bindings[predicate.rightRole];
      rightValue = rightBound?.value ?? null;
      if (rightBound) {
        rightProvenance = {
          role: predicate.rightRole,
          value: rightBound.value,
          source: rightBound.source,
          fieldPath: rightBound.field,
          confidence: rightBound.confidence,
          // v4.5: Normalization audit trail
          originalValue: rightBound.originalValue,
          normalizedValue: rightBound.normalizedValue,
          normalizations: rightBound.normalizations
        };
      }
    } else if (predicate.constant !== void 0) {
      rightValue = predicate.constant;
    }
    if (leftValue === null && predicate.operator !== "EXISTS" && predicate.operator !== "NOT_EXISTS") {
      return {
        predicate,
        passed: false,
        leftValue: null,
        rightValue,
        failureReason: `Left value (${predicate.leftRole}) is missing`,
        leftProvenance,
        rightProvenance
      };
    }
    if (leftValue instanceof Date && !isValidDate(leftValue) || rightValue instanceof Date && !isValidDate(rightValue)) {
      return { predicate, passed: false, leftValue, rightValue, failureReason: "Type mismatch: invalid date value", leftProvenance, rightProvenance };
    }
    const tolerance = predicate.tolerance ?? this.DEFAULT_TOLERANCE;
    let passed = false;
    let variance;
    let failureReason;
    switch (predicate.operator) {
      case "<=":
        if (typeof leftValue === "number" && typeof rightValue === "number") {
          passed = leftValue <= rightValue + tolerance;
          variance = leftValue - rightValue;
          if (!passed) failureReason = `${leftValue} > ${rightValue}`;
        } else if (isValidDate(leftValue) && isValidDate(rightValue)) {
          passed = leftValue <= rightValue;
          if (!passed) failureReason = `${leftValue.toISOString()} > ${rightValue.toISOString()}`;
        } else {
          failureReason = "Type mismatch for <= comparison";
        }
        break;
      case ">=":
        if (typeof leftValue === "number" && typeof rightValue === "number") {
          passed = leftValue >= rightValue - tolerance;
          variance = leftValue - rightValue;
          if (!passed) failureReason = `${leftValue} < ${rightValue}`;
        } else if (isValidDate(leftValue) && isValidDate(rightValue)) {
          passed = leftValue >= rightValue;
          if (!passed) failureReason = `${leftValue.toISOString()} < ${rightValue.toISOString()}`;
        } else {
          failureReason = "Type mismatch for >= comparison";
        }
        break;
      case "=":
        if (typeof leftValue === "number" && typeof rightValue === "number") {
          passed = Math.abs(leftValue - rightValue) <= tolerance;
          variance = leftValue - rightValue;
          if (!passed) failureReason = `${leftValue} \u2260 ${rightValue} (diff: ${variance.toFixed(2)})`;
        } else if (typeof leftValue === "string" && typeof rightValue === "string") {
          passed = leftValue === rightValue;
          if (!passed) failureReason = `"${leftValue}" \u2260 "${rightValue}"`;
        } else if (isValidDate(leftValue) && isValidDate(rightValue)) {
          passed = leftValue.getTime() === rightValue.getTime();
          if (!passed) failureReason = `${leftValue.toISOString()} \u2260 ${rightValue.toISOString()}`;
        } else if (valueKind(leftValue) !== valueKind(rightValue)) {
          failureReason = mismatchReason("=", predicate, leftValue, rightValue);
        } else {
          passed = leftValue === rightValue;
          if (!passed) failureReason = `${String(leftValue)} \u2260 ${String(rightValue)}`;
        }
        break;
      case "!=":
        if (typeof leftValue === "number" && typeof rightValue === "number") {
          passed = Math.abs(leftValue - rightValue) > tolerance;
          if (!passed) failureReason = `${leftValue} = ${rightValue}`;
        } else if (valueKind(leftValue) !== valueKind(rightValue)) {
          failureReason = mismatchReason("!=", predicate, leftValue, rightValue);
        } else {
          passed = leftValue !== rightValue;
          if (!passed) failureReason = `${String(leftValue)} = ${String(rightValue)}`;
        }
        break;
      case "<":
        if (typeof leftValue === "number" && typeof rightValue === "number") {
          passed = leftValue < rightValue;
          variance = leftValue - rightValue;
          if (!passed) failureReason = `${leftValue} >= ${rightValue}`;
        } else if (isValidDate(leftValue) && isValidDate(rightValue)) {
          passed = leftValue < rightValue;
          if (!passed) failureReason = `${leftValue.toISOString()} >= ${rightValue.toISOString()}`;
        } else {
          failureReason = "Type mismatch for < comparison";
        }
        break;
      case ">":
        if (typeof leftValue === "number" && typeof rightValue === "number") {
          passed = leftValue > rightValue;
          variance = leftValue - rightValue;
          if (!passed) failureReason = `${leftValue} <= ${rightValue}`;
        } else if (isValidDate(leftValue) && isValidDate(rightValue)) {
          passed = leftValue > rightValue;
          if (!passed) failureReason = `${leftValue.toISOString()} <= ${rightValue.toISOString()}`;
        } else {
          failureReason = "Type mismatch for > comparison";
        }
        break;
      case "IN":
        if (Array.isArray(rightValue)) {
          passed = rightValue.includes(String(leftValue));
          if (!passed) failureReason = `${String(leftValue)} not in [${rightValue.join(", ")}]`;
        } else {
          failureReason = "Right value must be array for IN operator";
        }
        break;
      case "NOT_IN":
        if (Array.isArray(rightValue)) {
          passed = !rightValue.includes(String(leftValue));
          if (!passed) failureReason = `${String(leftValue)} found in [${rightValue.join(", ")}]`;
        } else {
          failureReason = "Right value must be array for NOT_IN operator";
        }
        break;
      case "EMPTY":
        if (Array.isArray(leftValue)) {
          passed = leftValue.length === 0;
          if (!passed) failureReason = `Array has ${leftValue.length} elements`;
        } else {
          failureReason = "Left value must be array for EMPTY operator";
        }
        break;
      case "NOT_EMPTY":
        if (Array.isArray(leftValue)) {
          passed = leftValue.length > 0;
          if (!passed) failureReason = "Array is empty";
        } else {
          failureReason = "Left value must be array for NOT_EMPTY operator";
        }
        break;
      case "EXISTS":
        passed = leftValue !== null && leftValue !== void 0;
        if (!passed) failureReason = `${predicate.leftRole} does not exist (no evidence)`;
        break;
      case "NOT_EXISTS":
        passed = leftValue === null || leftValue === void 0;
        if (!passed) failureReason = `${predicate.leftRole} exists when it should not`;
        break;
      case "SIMILAR_TO": {
        if (typeof leftValue !== "string" || typeof rightValue !== "string") {
          failureReason = "SIMILAR_TO requires string values";
          break;
        }
        const similarity = this.computeStringSimilarity(leftValue, rightValue);
        const threshold = tolerance;
        passed = similarity >= threshold;
        variance = 1 - similarity;
        if (!passed) {
          const leftPreview = leftValue.length > 50 ? leftValue.slice(0, 50) + "..." : leftValue;
          const rightPreview = rightValue.length > 50 ? rightValue.slice(0, 50) + "..." : rightValue;
          failureReason = `Similarity: ${(similarity * 100).toFixed(0)}% (threshold: ${(threshold * 100).toFixed(0)}%) - "${leftPreview}" vs "${rightPreview}"`;
        }
        break;
      }
      default:
        failureReason = `Unknown operator: ${String(predicate.operator)}`;
    }
    return {
      predicate,
      passed,
      leftValue,
      rightValue,
      variance,
      failureReason,
      leftProvenance,
      rightProvenance
    };
  }
  /**
   * Calculate confidence level based on binding quality.
   */
  calculateConfidence(bindings, requiredRoles) {
    const confidences = [];
    for (const role of requiredRoles) {
      const bound = bindings.bindings[role];
      if (bound) {
        confidences.push(bound.confidence);
      }
    }
    if (confidences.length === 0) return "LOW";
    const avgConfidence = confidences.reduce((a, b) => a + b, 0) / confidences.length;
    if (avgConfidence >= 90) return "HIGH";
    if (avgConfidence >= 70) return "MEDIUM";
    return "LOW";
  }
  /**
   * Calculate total variance from predicate results.
   *
   * v5.21: For rate-based axioms (RATE_SUP), multiply the per-unit variance by quantity
   * to get the total overcharge. This ensures locked variance reflects actual savings.
   */
  calculateVariance(results, bindings, axiom) {
    const variances = results.filter((r) => r.variance !== void 0).map((r) => r.variance);
    if (variances.length === 0) return void 0;
    const baseVariance = variances.reduce((a, b) => a + Math.abs(b), 0);
    const isRateAxiom = axiom.shortCode === "RATE_SUP";
    if (isRateAxiom) {
      const quantity = bindings.bindings["CLAIMED_QUANTITY"]?.value;
      if (typeof quantity === "number" && quantity > 0) {
        const totalVariance = baseVariance * quantity;
        log(`[ValidationGavel] RATE_SUP variance \xD7 quantity = ${baseVariance.toFixed(2)} \xD7 ${quantity} = ${totalVariance.toFixed(2)}`);
        return totalVariance;
      }
    }
    return baseVariance;
  }
  /**
   * Check if ALL required role bindings have high confidence (≥90%).
   * v9.3: Lowered from 95% to 90%. Fuzzy matches (75%) still don't qualify for locking.
   */
  allRequiredBindingsExact(bindings, requiredRoles) {
    const EXACT_MATCH_THRESHOLD = 90;
    for (const role of requiredRoles) {
      const bound = bindings.bindings[role];
      if (!bound) {
        return false;
      }
      if (bound.confidence < EXACT_MATCH_THRESHOLD) {
        log(`[ValidationGavel] Locking prevented: ${role} has ${bound.confidence}% confidence (threshold: ${EXACT_MATCH_THRESHOLD}%)`);
        return false;
      }
    }
    return true;
  }
  /**
   * v4.5: Check if an axiom requires correlation to evidence or contract.
   * Axioms using RATE_CONTRACTED, ACTUAL_QUANTITY, etc. need reliable correlation.
   */
  axiomNeedsCorrelation(axiom) {
    const CONTRACT_ROLES = [
      "RATE_CONTRACTED",
      "CONTRACTED_LIMIT",
      "CONTRACT_START",
      "CONTRACT_END"
    ];
    const EVIDENCE_ROLES = [
      "ACTUAL_QUANTITY",
      "VERIFIED_AMOUNT",
      "EVIDENCE_DESCRIPTION"
    ];
    const needsContract = axiom.requiredRoles.some((role) => CONTRACT_ROLES.includes(role));
    const needsEvidence = axiom.requiredRoles.some((role) => EVIDENCE_ROLES.includes(role));
    return { contract: needsContract, evidence: needsEvidence };
  }
  /**
   * v4.5 + v5.0: Check if correlation info in bindings shows reliable correlation.
   * If axiom needs contract/evidence, those correlations must be reliable.
   *
   * v5.0 DETERMINISTIC MODE: If all required bindings for contract/evidence have
   * high confidence (≥95%), we treat the correlation as implicitly reliable because
   * the binding paths were explicit/deterministic (e.g., JSONPath resolution succeeded).
   */
  checkCorrelationReliable(bindings, needs) {
    const corrInfo = bindings.correlationInfo;
    const DETERMINISTIC_THRESHOLD = 95;
    if (!needs.contract && !needs.evidence) {
      return true;
    }
    const contractRoles = ["RATE_CONTRACTED", "CONTRACTED_LIMIT", "CONTRACT_START", "CONTRACT_END"];
    const evidenceRoles = ["ACTUAL_QUANTITY", "VERIFIED_AMOUNT", "EVIDENCE_DESCRIPTION"];
    if (needs.contract) {
      const contractBindings = contractRoles.map((role) => bindings.bindings[role]).filter((b) => b !== void 0 && b !== null);
      const allContractDeterministic = contractBindings.length > 0 && contractBindings.every((b) => b.confidence >= DETERMINISTIC_THRESHOLD);
      if (allContractDeterministic) {
        log(`[ValidationGavel] Contract correlation: DETERMINISTIC MODE (all bindings \u2265${DETERMINISTIC_THRESHOLD}%)`);
      } else if (!corrInfo?.contract?.isReliable) {
        log(`[ValidationGavel] Correlation check: contract correlation not reliable (score: ${corrInfo?.contract?.score ?? 0})`);
        return false;
      }
    }
    if (needs.evidence) {
      const evidenceBindings = evidenceRoles.map((role) => bindings.bindings[role]).filter((b) => b !== void 0 && b !== null);
      const allEvidenceDeterministic = evidenceBindings.length > 0 && evidenceBindings.every((b) => b.confidence >= DETERMINISTIC_THRESHOLD);
      if (allEvidenceDeterministic) {
        log(`[ValidationGavel] Evidence correlation: DETERMINISTIC MODE (all bindings \u2265${DETERMINISTIC_THRESHOLD}%)`);
      } else if (!corrInfo?.evidence?.isReliable) {
        log(`[ValidationGavel] Correlation check: evidence correlation not reliable (score: ${corrInfo?.evidence?.score ?? 0})`);
        return false;
      }
    }
    return true;
  }
  /**
   * Check if a BOTH axiom has a definitive negative result that should be locked.
   *
   * v4.5 REVISED: EXISTS/NOT_EXISTS are NOT considered definitive for locking.
   * Reason: Missing evidence could be an extraction failure, not proof of absence.
   * Only EMPTY/NOT_EMPTY on arrays that WERE extracted are considered definitive.
   */
  isDefinitiveNegativeResult(axiom, predicateResults) {
    const definitiveOperators = ["EMPTY", "NOT_EMPTY"];
    return predicateResults.some((result) => {
      if (result.passed) return false;
      const predDef = axiom.predicates.find(
        (p) => p.description === result.predicate.description || p.leftRole === result.predicate.leftRole && p.operator === result.predicate.operator
      );
      return predDef !== void 0 && definitiveOperators.includes(predDef.operator);
    });
  }
  /**
   * Compute string similarity using Jaccard index on words.
   * Returns a value between 0 (no similarity) and 1 (identical).
   */
  computeStringSimilarity(a, b) {
    const aWords = new Set(
      a.toLowerCase().split(/\W+/).filter((w) => w.length > 2)
    );
    const bWords = new Set(
      b.toLowerCase().split(/\W+/).filter((w) => w.length > 2)
    );
    const aWordsArray = Array.from(aWords);
    const bWordsArray = Array.from(bWords);
    const intersection = new Set(aWordsArray.filter((w) => bWords.has(w)));
    const union = new Set(aWordsArray.concat(bWordsArray));
    if (union.size === 0) return 0;
    return intersection.size / union.size;
  }
  /**
   * Generate human-readable explanation of the validation result.
   */
  generateExplanation(axiom, results, passed) {
    if (passed) {
      return `${axiom.name}: All predicates satisfied.`;
    }
    const failures = results.filter((r) => !r.passed);
    const reasons = failures.map((f) => f.failureReason || f.predicate.description || "Unknown failure").join("; ");
    return `${axiom.name} VIOLATED: ${reasons}`;
  }
};
var gavelInstance = null;
function getValidationGavel() {
  if (!gavelInstance) {
    gavelInstance = new ValidationGavel();
  }
  return gavelInstance;
}

// packages/verify/src/verdict/from-report.ts
function round4(x) {
  return Math.round(x * 1e4) / 1e4;
}
function toValue(v) {
  if (v === void 0 || v === null) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  if (Array.isArray(v)) return v.map(String);
  return v;
}
function evidenceFrom(p) {
  if (!p) return null;
  const value = toValue(p.value);
  const original = p.originalValue === void 0 ? void 0 : toValue(p.originalValue);
  const role = p.source === "computed" ? "CONTEXT" : p.source === "contract" || p.source === "evidence" || p.source === "history" ? "REFERENCE" : "OPERAND";
  const e = {
    locator: { kind: "field", source: p.source, path: p.fieldPath },
    value,
    confidence: p.confidence,
    role
  };
  if (original !== void 0 && original !== value) e.original = original;
  if (p.normalizations && p.normalizations.length > 0) e.normalizations = p.normalizations;
  return e;
}
function evidenceFromBinding(role, b) {
  const p = {
    role,
    value: b.value,
    source: b.source,
    fieldPath: b.field,
    confidence: b.confidence,
    originalValue: b.originalValue,
    normalizedValue: b.normalizedValue,
    normalizations: b.normalizations
  };
  return evidenceFrom(p);
}
function evidenceKey(e) {
  return e.locator.kind === "field" ? `${e.locator.source}:${e.locator.path}` : `span:${e.locator.source_hash}:${e.locator.start}-${e.locator.end}`;
}
var MIN_VERDICT_CONFIDENCE = 90;
function abstainOnGuessedOperands(claims) {
  for (const c of claims) {
    if (c.outcome === "INSUFFICIENT_DATA") continue;
    const guessed = c.evidence.filter((e) => e.confidence < MIN_VERDICT_CONFIDENCE);
    if (guessed.length === 0) continue;
    const where = guessed.map((g) => `${g.locator.kind === "field" ? `${g.locator.source}:${g.locator.path}` : "span"} (confidence ${g.confidence})`).join("; ");
    c.outcome = "INSUFFICIENT_DATA";
    c.locked = false;
    delete c.computation;
    delete c.variance;
    c.insufficiency = {
      reason: "AMBIGUOUS_FIELD",
      detail: `${where} \u2014 a required field was located only by fuzzy name-matching; verdicts are never issued on guessed fields. Supply it under a recognized field name.`
    };
    c.explanation = `Abstained: ${c.explanation}`;
  }
}
function isUncomparable(pr) {
  const r = pr.failureReason ?? "";
  return /^Type mismatch/.test(r) || /is missing$/.test(r) || /must be array/.test(r) || /requires string values/.test(r) || /^Unknown operator/.test(r);
}
function toClaimVerdicts(results, ctx, opts) {
  return results.map((r) => toClaim(r, ctx, opts));
}
function toClaim(r, ctx, opts) {
  const code2 = r.axiomCode;
  const axiom = opts.registry.getByCode(code2);
  const kind = opts.kindByCode[code2] ?? "CONSISTENCY";
  const tier = "DETERMINISTIC";
  const claim_id = `${opts.claimPrefix}.${code2}`;
  const rule_id = code2;
  const rule_name = axiom?.name ?? code2;
  const formula = axiom?.formalForm ?? code2;
  const field = opts.fieldByCode[code2] ?? code2.toLowerCase();
  const evidence = [];
  const seen = /* @__PURE__ */ new Set();
  for (const pr of r.predicateResults) {
    for (const p of [pr.leftProvenance, pr.rightProvenance]) {
      const e = evidenceFrom(p);
      if (!e) continue;
      const key = evidenceKey(e);
      if (seen.has(key)) continue;
      seen.add(key);
      evidence.push(e);
    }
  }
  const first = r.predicateResults[0];
  let asserted = null;
  if (first) asserted = toValue(first.leftValue);
  else {
    const role = axiom?.requiredRoles[0];
    if (role) asserted = toValue(ctx.bindings[role]?.value);
  }
  if (r.verdict === "INSUFFICIENT_DATA") {
    return {
      claim_id,
      kind,
      tier,
      outcome: "INSUFFICIENT_DATA",
      field,
      asserted,
      rule_id,
      rule_name,
      evidence,
      insufficiency: insufficiencyFor(r.missingRoles ?? [], opts, r.extractionHint),
      locked: false,
      explanation: r.explanation
    };
  }
  const failed = r.predicateResults.filter((p) => !p.passed);
  if (r.verdict === "FAIL" && failed.length > 0 && failed.every(isUncomparable)) {
    return {
      claim_id,
      kind,
      tier,
      outcome: "INSUFFICIENT_DATA",
      field,
      asserted,
      rule_id,
      rule_name,
      evidence,
      insufficiency: {
        reason: "UNPARSEABLE",
        detail: failed.map((p) => p.failureReason ?? "operands could not be compared").join("; ")
      },
      locked: false,
      explanation: r.explanation
    };
  }
  const operands = {};
  for (const pr of r.predicateResults) {
    operands[pr.predicate.leftRole] = toValue(pr.leftValue);
    if (pr.predicate.rightRole) operands[pr.predicate.rightRole] = toValue(pr.rightValue);
    else if (pr.predicate.constant !== void 0) operands["constant"] = pr.predicate.constant;
  }
  const tolerance = first?.predicate.tolerance;
  const claim = {
    claim_id,
    kind,
    tier,
    outcome: r.verdict,
    field,
    asserted,
    rule_id,
    rule_name,
    computation: {
      formula,
      operands,
      result: first ? toValue(first.rightValue) : null,
      ...tolerance !== void 0 ? { tolerance: { abs: tolerance } } : {}
    },
    evidence,
    locked: r.isLocked,
    explanation: r.explanation
  };
  if (r.variance !== void 0) {
    const only = r.predicateResults.length === 1 ? r.predicateResults[0] : void 0;
    const sign = only && typeof only.variance === "number" && only.variance < 0 ? -1 : 1;
    claim.variance = round4(sign * Math.abs(r.variance));
  }
  return claim;
}
function insufficiencyFor(missing, opts, hint) {
  if (missing.length === 0) {
    return { reason: "OUT_OF_RULESET_SCOPE", detail: hint ?? "rule could not be evaluated" };
  }
  const { contract, evidence, history } = opts.referenceRoles;
  const allContract = missing.every((m) => contract.includes(m));
  const allEvidence = missing.every((m) => evidence.includes(m));
  const allHistory = missing.every((m) => history.includes(m));
  if (allContract && !opts.refs.contract) {
    return { reason: "REFERENCE_NOT_PROVIDED", detail: `No contract/PO reference supplied; this check needs ${missing.join(", ")}`, missing };
  }
  if (allEvidence && !opts.refs.evidence) {
    return { reason: "REFERENCE_NOT_PROVIDED", detail: `No evidence reference supplied; this check needs ${missing.join(", ")}`, missing };
  }
  if (allHistory && !opts.refs.history) {
    return { reason: "REFERENCE_NOT_PROVIDED", detail: `No previous document supplied as history; this check needs ${missing.join(", ")}`, missing };
  }
  for (const m of missing) {
    const a = opts.absence[m];
    if (a !== void 0 && typeof a !== "string") return { reason: a.reason, detail: a.detail, missing };
  }
  const notes = missing.map((m) => [m, opts.absence[m]]).filter((x) => typeof x[1] === "string" && x[1].length > 0).map(([m, why]) => `${m}: ${why}`);
  const parts = [notes.join("; "), hint].filter((s) => Boolean(s));
  const detail = parts.length > 0 ? parts.join(" \u2014 ") : `missing ${missing.join(", ")}`;
  return { reason: "FIELD_MISSING", detail, missing };
}

// packages/verify/src/dedup.ts
var REVISION_TOKEN = /^(?:REV(?:ISED)?\d*|CORRECTED|AMENDED|COPY|DUPLICATE|DUP|REISSUED?|FINAL|[A-Z])$/;
function segments(raw) {
  return raw.toUpperCase().split(/[^A-Z0-9]+/).filter((s) => s.length > 0).map((s) => /^\d+$/.test(s) ? s.replace(/^0+(?=\d)/, "") : s);
}
function tightId(raw) {
  return segments(raw).join("|");
}
function baseId(raw) {
  const segs = segments(raw);
  if (segs.length >= 2 && REVISION_TOKEN.test(segs[segs.length - 1])) return segs.slice(0, -1).join("|");
  return segs.join("|");
}
function classifyDuplicates(currentRaw, priors) {
  const exact = [];
  const near = [];
  const curTight = tightId(currentRaw);
  const curBase = baseId(currentRaw);
  for (const p of priors) {
    if (typeof p !== "string" || p.length === 0) continue;
    if (p === currentRaw) {
      exact.push(p);
      continue;
    }
    if (tightId(p) === curTight) {
      near.push({ id: p, kind: "formatting" });
      continue;
    }
    if (baseId(p) === curBase) near.push({ id: p, kind: "revision" });
  }
  near.sort((a, b) => a.kind === b.kind ? 0 : a.kind === "formatting" ? -1 : 1);
  return { exact, near };
}
function priorsOf(b) {
  if (!b) return [];
  const v = b.value;
  return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
}
function duplicateClaims(docId, priorBinding) {
  const base = {
    kind: "CONSISTENCY",
    tier: "DETERMINISTIC",
    field: "invoice_number"
  };
  const idEvidence = docId ? [evidenceFromBinding("DOCUMENT_ID", docId)] : [];
  const priorEvidence = priorBinding ? [evidenceFromBinding("PRIOR_CLAIM_IDS", priorBinding)] : [];
  if (!docId || typeof docId.value !== "string") {
    return [{
      ...base,
      claim_id: "document.DUP_PROHIB",
      outcome: "INSUFFICIENT_DATA",
      asserted: null,
      rule_id: "DUP_PROHIB",
      rule_name: "Law of Duplicate Prohibition",
      evidence: [],
      insufficiency: { reason: "FIELD_MISSING", detail: "no invoice number on the extraction; cannot check for duplicates", missing: ["DOCUMENT_ID"] },
      locked: false,
      explanation: "No invoice number to compare against prior invoices."
    }];
  }
  const currentRaw = String(docId.originalValue ?? docId.value);
  if (!priorBinding || !Array.isArray(priorBinding.value)) {
    return [{
      ...base,
      claim_id: "document.DUP_PROHIB",
      outcome: "INSUFFICIENT_DATA",
      asserted: docId.value,
      rule_id: "DUP_PROHIB",
      rule_name: "Law of Duplicate Prohibition",
      evidence: [],
      insufficiency: { reason: "FIELD_MISSING", detail: "no prior_invoice_ids supplied; supply the prior invoice-number history to check for duplicates", missing: ["PRIOR_CLAIM_IDS"] },
      locked: false,
      explanation: "No prior invoice history supplied."
    }];
  }
  const priors = priorsOf(priorBinding);
  const { exact, near } = classifyDuplicates(currentRaw, priors);
  const claims = [];
  claims.push(exact.length > 0 ? {
    ...base,
    claim_id: "document.DUP_PROHIB",
    outcome: "FAIL",
    asserted: docId.value,
    rule_id: "DUP_PROHIB",
    rule_name: "Law of Duplicate Prohibition",
    computation: { formula: "invoice_number \u2209 prior_invoice_ids", operands: { DOCUMENT_ID: docId.value, matched: exact }, result: false },
    evidence: [...idEvidence, ...priorEvidence],
    locked: true,
    explanation: `This invoice number was already processed (exact match: ${exact.join(", ")}). Paying it again is a duplicate.`
  } : {
    ...base,
    claim_id: "document.DUP_PROHIB",
    outcome: "PASS",
    asserted: docId.value,
    rule_id: "DUP_PROHIB",
    rule_name: "Law of Duplicate Prohibition",
    computation: { formula: "invoice_number \u2209 prior_invoice_ids", operands: { DOCUMENT_ID: docId.value }, result: true },
    evidence: [...idEvidence, ...priorEvidence],
    locked: false,
    explanation: "No prior invoice carries this exact number."
  });
  claims.push(near.length > 0 ? {
    ...base,
    claim_id: "document.DUP_NEAR",
    outcome: "FAIL",
    asserted: docId.value,
    rule_id: "DUP_NEAR",
    rule_name: "Law of Near-Duplicate Prohibition",
    computation: { formula: "normalize(invoice_number) \u2209 normalize(prior_invoice_ids)", operands: { DOCUMENT_ID: docId.value, matched: near.map((n) => `${n.id} (${n.kind})`) }, result: false },
    evidence: [...idEvidence, ...priorEvidence],
    locked: false,
    explanation: near[0].kind === "formatting" ? `A prior invoice number normalizes to the same value (${near.map((n) => n.id).join(", ")}) \u2014 same number, different formatting. Almost certainly a duplicate; do not pay until cleared.` : `A prior invoice number shares this base with a revision suffix (${near.map((n) => n.id).join(", ")}). This may be a legitimate re-issue with a corrected amount \u2014 a human should confirm before payment.`
  } : {
    ...base,
    claim_id: "document.DUP_NEAR",
    outcome: "PASS",
    asserted: docId.value,
    rule_id: "DUP_NEAR",
    rule_name: "Law of Near-Duplicate Prohibition",
    computation: { formula: "normalize(invoice_number) \u2209 normalize(prior_invoice_ids)", operands: { DOCUMENT_ID: docId.value }, result: true },
    evidence: [...idEvidence, ...priorEvidence],
    locked: false,
    explanation: "No prior invoice number normalizes to this one (no formatting or revision-suffix collision)."
  });
  return claims;
}

// packages/verify/src/version.ts
var ENGINE_VERSION = "0.0.1";
var RULESET = {
  id: "invoice",
  version: "0.1.0",
  domain: "invoice"
};
var PAY_APP_RULESET_REF = {
  id: "pay-app",
  version: "0.0.1",
  domain: "pay-app"
};
var SCHEMA_VERSION = "v0";

// packages/verify/src/tolerance.ts
var PRACTITIONER = { rel: 3e-4, absCap: 0 };
var CAPPED = { rel: 3e-4, absCap: 0, roundingCap: { perLine: ["TAX_INT"], cashStep: ["TOTAL_INT"] } };
function toleranceIdentity(t) {
  return {
    rel: t.rel,
    absCap: t.absCap,
    ...t.rounding !== void 0 ? { rounding: t.rounding } : {},
    ...t.roundingCap !== void 0 ? {
      roundingCap: { perLine: [...t.roundingCap.perLine ?? []], cashStep: [...t.roundingCap.cashStep ?? []] }
    } : {}
  };
}
function documentGrain(claims) {
  let any = false;
  for (const c of claims) {
    if (c.kind !== "RECOMPUTE" || typeof c.asserted !== "number" || !Number.isFinite(c.asserted)) continue;
    any = true;
    if (Math.abs(c.asserted - Math.round(c.asserted)) > 1e-9) return 0.01;
  }
  return any ? 1 : 0.01;
}
function roundingSteps(claim) {
  let k = 0;
  for (const e of claim.evidence) {
    if (e.locator.kind === "field" && e.locator.source !== "computed" && typeof e.value === "number") k++;
  }
  return k;
}
function cashStepOf(stated, grain) {
  if (typeof stated !== "number" || !Number.isFinite(stated)) return 0;
  for (const m of [100, 50, 10, 5]) {
    const s = m * grain;
    const q = stated / s;
    if (Math.abs(q - Math.round(q)) < 1e-9) return round4(s);
  }
  return 0;
}
function lineCount(claims) {
  const lines = /* @__PURE__ */ new Set();
  for (const c of claims) {
    const m = /^line\[(\d+)\]\./.exec(c.claim_id);
    if (m) lines.add(m[1]);
  }
  return lines.size;
}
function applyTolerancePolicy(claims, policy) {
  if (policy.rel <= 0) return;
  const rc = policy.roundingCap;
  const grain = rc ? documentGrain(claims) : 0;
  const lines = rc?.perLine?.length ? lineCount(claims) : 0;
  for (const c of claims) {
    const comp = c.computation;
    if (!comp || typeof comp.result !== "number") continue;
    const absFloor = comp.tolerance?.abs ?? 0.01;
    comp.tolerance = { abs: absFloor, rel: policy.rel };
    if (c.outcome !== "FAIL" || typeof c.variance !== "number") continue;
    const cap = policy.absCap > 0 ? policy.absCap : Infinity;
    if (!rc) {
      const eff2 = Math.max(absFloor, Math.min(policy.rel * Math.abs(comp.result), cap));
      if (Math.abs(c.variance) <= eff2 + 1e-9) {
        c.outcome = "PASS";
        c.locked = false;
        c.explanation = `Within tolerance (|variance| ${round4(Math.abs(c.variance))} \u2264 ${round4(eff2)} = min(${round4(policy.rel * 100)}% of ${comp.result}, cap $${policy.absCap}), floor $${absFloor}): treated as rounding, not error. ${c.explanation}`;
      }
      continue;
    }
    const relBand = Math.min(policy.rel * Math.abs(comp.result), cap);
    const k = roundingSteps(c) + (rc.perLine?.includes(c.rule_id) ? lines : 0);
    const step = rc.cashStep?.includes(c.rule_id) ? cashStepOf(c.asserted, grain) : 0;
    const roundCap = round4(grain * k + step / 2);
    const eff = Math.max(absFloor, Math.min(relBand, roundCap));
    const v = round4(Math.abs(c.variance));
    const capText = `rounding cap ${grain} \xD7 ${k} step${k === 1 ? "" : "s"}${step > 0 ? ` + half a cash step of ${step}` : ""} = ${roundCap}${policy.absCap > 0 ? `, cap ${policy.absCap}` : ""}`;
    if (Math.abs(c.variance) <= eff + 1e-9) {
      c.outcome = "PASS";
      c.locked = false;
      c.explanation = `Within tolerance (|variance| ${v} \u2264 ${round4(eff)} = min(${round4(policy.rel * 100)}% of ${comp.result}, ${capText}), floor ${absFloor}): treated as rounding, not error. ${c.explanation}`;
    } else if (Math.abs(c.variance) <= Math.max(absFloor, relBand) + 1e-9) {
      c.explanation = `${c.explanation} Not treated as rounding: |variance| ${v} is within ${round4(policy.rel * 100)}% of ${comp.result} but above the ${capText} (the most rounding can produce on this claim).`;
    }
  }
}

// packages/verify/src/rulesets/invoice/axioms.ts
var CURRENCY_TOLERANCE = 0.01;
var SUM_INTEGRITY = {
  id: "ax-inv-sum-int",
  shortCode: "SUM_INT",
  name: "Law of Footing",
  axiomStatement: "The line item amounts must sum to the stated subtotal",
  formalForm: "\u03A3 line_items[i].amount = subtotal",
  predicates: [
    {
      leftRole: "LINE_ITEMS_SUM",
      operator: "=",
      rightRole: "SUBTOTAL",
      tolerance: CURRENCY_TOLERANCE,
      description: "Sum of line item amounts must equal the stated subtotal"
    }
  ],
  requiredRoles: ["LINE_ITEMS_SUM", "SUBTOTAL"],
  combinationLogic: "AND",
  detectableBy: "PRECOMPUTE",
  severity: "high",
  applicableDomains: ["invoice"]
};
var TOTAL_INTEGRITY = {
  id: "ax-inv-total-int",
  shortCode: "TOTAL_INT",
  name: "Law of the Bottom Line",
  axiomStatement: "The stated grand total must equal subtotal plus tax minus discount",
  formalForm: "grand_total = subtotal + tax \u2212 discount",
  predicates: [
    {
      leftRole: "GRAND_TOTAL",
      operator: "=",
      rightRole: "EXPECTED_GRAND_TOTAL",
      tolerance: CURRENCY_TOLERANCE,
      description: "Stated grand total must equal the computed subtotal + tax \u2212 discount"
    }
  ],
  requiredRoles: ["GRAND_TOTAL", "EXPECTED_GRAND_TOTAL"],
  combinationLogic: "AND",
  detectableBy: "PRECOMPUTE",
  severity: "critical",
  applicableDomains: ["invoice"]
};
var TAX_INTEGRITY = {
  id: "ax-inv-tax-int",
  shortCode: "TAX_INT",
  name: "Law of the Levy",
  axiomStatement: "The stated tax amount must equal the subtotal multiplied by the stated tax rate",
  formalForm: "tax = subtotal \xD7 tax_rate",
  predicates: [
    {
      leftRole: "TAX_AMOUNT",
      operator: "=",
      rightRole: "EXPECTED_TAX_AMOUNT",
      tolerance: CURRENCY_TOLERANCE,
      description: "Stated tax must equal subtotal \xD7 rate within one cent"
    }
  ],
  requiredRoles: ["TAX_AMOUNT", "EXPECTED_TAX_AMOUNT"],
  combinationLogic: "AND",
  detectableBy: "PRECOMPUTE",
  severity: "high",
  applicableDomains: ["invoice"]
};
var INVOICE_AXIOMS = [
  SUM_INTEGRITY,
  TOTAL_INTEGRITY,
  TAX_INTEGRITY
];

// packages/verify/src/rulesets/invoice/ontology.ts
var D = "invoice";
var LINE_ITEM_MAPPINGS = [
  {
    domain: D,
    role: "RATE_APPLIED",
    documentType: "invoice",
    priority: 100,
    fieldPath: "line_items[*].unit_price",
    alternativePaths: [
      "line_items[*].rate",
      "line_items[*].price",
      "line_items[*].unit_rate",
      "line_items[*].unit_cost",
      "line_items[*].hourly_rate",
      "line_items[*].price_per_unit",
      "items[*].unit_price",
      "items[*].rate",
      "items[*].price",
      "lines[*].unit_price",
      "lines[*].rate"
    ],
    fieldAliases: ["unit_price", "rate", "price", "unit_rate", "unit_cost"]
  },
  {
    domain: D,
    role: "CLAIMED_QUANTITY",
    documentType: "invoice",
    priority: 100,
    fieldPath: "line_items[*].quantity",
    alternativePaths: [
      "line_items[*].qty",
      "line_items[*].units",
      "line_items[*].hours",
      "line_items[*].count",
      "items[*].quantity",
      "items[*].qty",
      "lines[*].quantity",
      "lines[*].qty"
    ],
    fieldAliases: ["quantity", "qty", "units", "hours"]
  },
  {
    domain: D,
    role: "CLAIMED_AMOUNT",
    documentType: "invoice",
    priority: 100,
    fieldPath: "line_items[*].amount",
    alternativePaths: [
      "line_items[*].total",
      "line_items[*].line_total",
      "line_items[*].extended_amount",
      "line_items[*].extended_price",
      "line_items[*].subtotal",
      "line_items[*].net_amount",
      "items[*].amount",
      "items[*].total",
      "items[*].line_total",
      "lines[*].amount",
      "lines[*].total"
    ],
    fieldAliases: ["amount", "total", "line_total", "extended_amount"]
  },
  {
    domain: D,
    role: "INVOICE_DESCRIPTION",
    documentType: "invoice",
    priority: 100,
    fieldPath: "line_items[*].description",
    alternativePaths: [
      "line_items[*].item",
      "line_items[*].service",
      "line_items[*].name",
      "line_items[*].product",
      "items[*].description",
      "items[*].name",
      "lines[*].description"
    ],
    fieldAliases: ["description", "item", "service", "name", "product"]
  }
];
var DOCUMENT_MAPPINGS = [
  {
    domain: D,
    role: "SUBTOTAL",
    documentType: "invoice",
    priority: 100,
    fuzzyMatch: false,
    fieldPath: "totals.subtotal",
    alternativePaths: [
      "subtotal",
      "sub_total",
      "totals.sub_total",
      "totals.net",
      "totals.net_amount",
      "amounts.subtotal",
      "summary.subtotal",
      "net_amount",
      "subtotal_amount"
    ],
    fieldAliases: ["subtotal", "sub_total", "net_amount"]
  },
  {
    domain: D,
    role: "TAX_AMOUNT",
    documentType: "invoice",
    priority: 100,
    fuzzyMatch: false,
    fieldPath: "totals.tax",
    alternativePaths: [
      "tax",
      "tax_amount",
      "totals.tax_amount",
      "totals.tax_total",
      "tax_total",
      "sales_tax",
      "totals.sales_tax",
      "vat",
      "vat_amount",
      "totals.vat",
      "totals.vat_amount",
      "taxes.total",
      "amounts.tax",
      "summary.tax"
    ],
    fieldAliases: ["tax", "tax_amount", "sales_tax", "vat", "vat_amount"]
  },
  {
    domain: D,
    role: "TAX_RATE",
    documentType: "invoice",
    priority: 100,
    fuzzyMatch: false,
    fieldPath: "totals.tax_rate",
    alternativePaths: [
      "tax_rate",
      "vat_rate",
      "sales_tax_rate",
      "tax_percent",
      "tax_percentage",
      "tax.rate",
      "taxes.rate",
      "amounts.tax_rate",
      "summary.tax_rate"
    ],
    fieldAliases: ["tax_rate", "vat_rate", "tax_percent"]
  },
  {
    domain: D,
    role: "DISCOUNT_AMOUNT",
    documentType: "invoice",
    priority: 100,
    fuzzyMatch: false,
    fieldPath: "totals.discount",
    alternativePaths: [
      "discount",
      "discount_amount",
      "totals.discount_amount",
      "discounts.total",
      "amounts.discount",
      "summary.discount",
      "total_discount",
      "sub_total.discount_price"
    ],
    fieldAliases: ["discount", "discount_amount"]
  },
  {
    // Real receipts add a service charge / gratuity between subtotal and total (CORD `service_price`).
    domain: D,
    role: "SERVICE_CHARGE",
    documentType: "invoice",
    priority: 100,
    fuzzyMatch: false,
    fieldPath: "totals.service_charge",
    alternativePaths: [
      "service_charge",
      "service",
      "svc",
      "gratuity",
      "totals.service",
      "totals.service_price",
      "amounts.service_charge",
      "summary.service_charge",
      "sub_total.service_price",
      "service_price"
    ],
    fieldAliases: ["service_charge", "service", "gratuity"]
  },
  {
    domain: D,
    role: "GRAND_TOTAL",
    documentType: "invoice",
    priority: 100,
    fuzzyMatch: false,
    fieldPath: "totals.total",
    alternativePaths: [
      "total",
      "grand_total",
      "totals.grand_total",
      "total_amount",
      "totals.total_amount",
      "amount_due",
      "totals.amount_due",
      "balance_due",
      "totals.balance_due",
      "invoice_total",
      "total_due",
      "amounts.total",
      "summary.total"
    ],
    fieldAliases: ["total", "grand_total", "total_amount", "amount_due", "balance_due", "invoice_total"]
  },
  {
    domain: D,
    role: "DOCUMENT_ID",
    documentType: "invoice",
    priority: 100,
    fieldPath: "invoice_number",
    alternativePaths: [
      "document_number",
      "invoice_id",
      "invoice_no",
      "number",
      "id",
      "reference",
      "reference_number",
      "header.invoice_number",
      "metadata.invoice_number"
    ],
    fieldAliases: ["invoice_number", "document_number", "invoice_no", "reference"]
  },
  {
    // The bridge special-cases EVENT_DATE via extractDateValue() (prefers service_date over invoice_date).
    domain: D,
    role: "EVENT_DATE",
    documentType: "invoice",
    priority: 90,
    fieldPath: "dates[*].value",
    alternativePaths: ["dates[*].date", "service_date", "invoice_date", "issue_date", "date", "header.invoice_date"]
  },
  {
    // Strings only; fuzzy search disabled so an unrelated string can never be mistaken for a currency.
    domain: D,
    role: "CURRENCY_CODE",
    documentType: "invoice",
    priority: 100,
    fuzzyMatch: false,
    fieldPath: "currency",
    alternativePaths: ["currency_code", "totals.currency", "amounts.currency", "header.currency", "metadata.currency"]
  },
  {
    // Supplied by the caller (their AP system knows prior invoices); an array. Required by DUP_PROHIB.
    domain: D,
    role: "PRIOR_CLAIM_IDS",
    documentType: "invoice",
    priority: 100,
    fuzzyMatch: false,
    fieldPath: "prior_invoice_ids",
    alternativePaths: ["prior_claim_ids", "duplicate_candidates", "related_invoice_ids", "prior_invoices"]
  }
];
var CONTRACT_MAPPINGS = [
  {
    domain: D,
    role: "RATE_CONTRACTED",
    documentType: "contract",
    priority: 100,
    fieldPath: "rates[*].rate",
    alternativePaths: [
      "financial_rules[*].values.rate",
      "financial_rules[*].rate",
      "price_list[*].unit_price",
      "line_items[*].unit_price",
      "line_items[*].rate",
      "contracted_rate",
      "unit_price",
      "rate",
      "hourly_rate"
    ],
    fieldAliases: ["rate", "unit_price", "contracted_rate", "hourly_rate"]
  },
  {
    domain: D,
    role: "CONTRACTED_LIMIT",
    documentType: "contract",
    priority: 100,
    fieldPath: "max_amount",
    alternativePaths: [
      "financial_rules[*].values.max_amount",
      "financial_rules[*].values.cap",
      "limits.max",
      "not_to_exceed",
      "nte",
      "cap",
      "po_total",
      "purchase_order.total",
      "totals.total",
      "total",
      "amount"
    ],
    fieldAliases: ["max_amount", "cap", "limit", "not_to_exceed", "po_total"]
  },
  {
    domain: D,
    role: "CONTRACT_START",
    documentType: "contract",
    priority: 100,
    fieldPath: "effective_date",
    alternativePaths: ["start_date", "contract_start", "key_terms.effective_date", "period.start", "valid_from", "po_date"]
  },
  {
    domain: D,
    role: "CONTRACT_END",
    documentType: "contract",
    priority: 100,
    fieldPath: "expiration_date",
    alternativePaths: ["end_date", "contract_end", "key_terms.expiration_date", "termination_date", "period.end", "valid_to"]
  }
];
var EVIDENCE_MAPPINGS = [
  {
    domain: D,
    role: "ACTUAL_QUANTITY",
    documentType: "evidence",
    priority: 100,
    fieldPath: "line_items[*].quantity",
    alternativePaths: [
      "line_items[*].qty",
      "line_items[*].units",
      "line_items[*].hours",
      "quantity",
      "qty",
      "received_quantity",
      "delivered_quantity",
      "totals.quantity",
      "totals.total_quantity",
      "totals.hours"
    ],
    fieldAliases: ["quantity", "qty", "units", "hours", "received_quantity", "delivered_quantity"]
  },
  {
    domain: D,
    role: "VERIFIED_AMOUNT",
    documentType: "evidence",
    priority: 100,
    fieldPath: "totals.total",
    alternativePaths: ["amount", "total", "verified_amount", "receipt_total", "totals.amount"]
  },
  {
    domain: D,
    role: "EVENT_DATE",
    documentType: "evidence",
    priority: 100,
    fieldPath: "dates[*].date",
    alternativePaths: ["dates[*].value", "date", "service_date", "delivery_date", "received_date", "ticket_date"]
  },
  {
    domain: D,
    role: "EVIDENCE_DESCRIPTION",
    documentType: "evidence",
    priority: 100,
    fieldPath: "line_items[*].description",
    alternativePaths: ["description", "item", "service", "line_items[*].item", "line_items[*].service"],
    fieldAliases: ["description", "item", "service"]
  }
];
var I18N = {
  // European (Romance / Germanic / Dutch)
  SUBTOTAL: [
    "subtotal",
    "base_imponible",
    "sous_total",
    "soustotal",
    "zwischensumme",
    "subtotale",
    "subtotaal",
    // CJK / Cyrillic / Arabic
    "\u5C0F\u8BA1",
    "\u5C0F\u8A08",
    "\uC18C\uACC4",
    "\u043F\u043E\u0434\u044B\u0442\u043E\u0433",
    "\u0441\u0443\u043C\u043C\u0430_\u0431\u0435\u0437_\u043D\u0430\u043B\u043E\u0433\u0430"
  ],
  TAX_AMOUNT: [
    "impuesto",
    "iva",
    "tva",
    "mwst",
    "steuer",
    "umsatzsteuer",
    "imposta",
    "imposto",
    "btw",
    "\u7A0E",
    "\u7A0E\u989D",
    "\u7A0E\u984D",
    "\u6D88\u8CBB\u7A0E",
    "\uC138\uAE08",
    "\u043D\u0430\u043B\u043E\u0433",
    "\u043D\u0434\u0441",
    "\u0627\u0644\u0636\u0631\u064A\u0628\u0629"
  ],
  TAX_RATE: [
    "tipo_iva",
    "tasa_iva",
    "taux_tva",
    "steuersatz",
    "aliquota_iva",
    "taxa_iva",
    "\u7A0E\u7387",
    "\uC138\uC728",
    "\u0441\u0442\u0430\u0432\u043A\u0430_\u043D\u0430\u043B\u043E\u0433\u0430"
  ],
  DISCOUNT_AMOUNT: [
    "descuento",
    "remise",
    "rabais",
    "rabatt",
    "nachlass",
    "sconto",
    "desconto",
    "korting",
    "\u6298\u6263",
    "\u5272\u5F15",
    "\uD560\uC778",
    "\u0441\u043A\u0438\u0434\u043A\u0430",
    "\u0627\u0644\u062E\u0635\u0645"
  ],
  SERVICE_CHARGE: ["servicio", "cargo_por_servicio", "servizio", "bedienung", "taxe_de_service", "\u670D\u52A1\u8D39", "\u30B5\u30FC\u30D3\u30B9\u6599"],
  GRAND_TOTAL: [
    "total",
    "total_factura",
    "importe_total",
    "montant_total",
    "gesamtbetrag",
    "gesamt",
    "endbetrag",
    "totale",
    "totaal",
    "valor_total",
    "\u5408\u8BA1",
    "\u603B\u8BA1",
    "\u5408\u8A08",
    "\uD569\uACC4",
    "\uCD1D\uACC4",
    "\u0438\u0442\u043E\u0433\u043E",
    "\u0432\u0441\u0435\u0433\u043E",
    "\u0627\u0644\u0645\u062C\u0645\u0648\u0639",
    "\u0627\u0644\u0625\u062C\u0645\u0627\u0644\u064A"
  ],
  CURRENCY_CODE: ["moneda", "devise", "waehrung", "valuta", "moeda", "\u8D27\u5E01", "\u901A\u8CA8", "\u0432\u0430\u043B\u044E\u0442\u0430", "\u0627\u0644\u0639\u0645\u0644\u0629"],
  RATE_APPLIED: [
    "precio_unitario",
    "precio",
    "prix_unitaire",
    "prix",
    "einzelpreis",
    "preis",
    "prezzo_unitario",
    "prezzo",
    "preco",
    "\u5355\u4EF7",
    "\u5358\u4FA1",
    "\uB2E8\uAC00",
    "\u0446\u0435\u043D\u0430",
    "\u0633\u0639\u0631_\u0627\u0644\u0648\u062D\u062F\u0629"
  ],
  CLAIMED_QUANTITY: [
    "cantidad",
    "quantite",
    "menge",
    "anzahl",
    "quantita",
    "quantidade",
    "\u6570\u91CF",
    "\uC218\uB7C9",
    "\u043A\u043E\u043B\u0438\u0447\u0435\u0441\u0442\u0432\u043E",
    "\u0627\u0644\u0643\u0645\u064A\u0629"
  ],
  CLAIMED_AMOUNT: [
    "importe",
    "montant",
    "betrag",
    "importo",
    "valor",
    "gesamtpreis",
    "\u91D1\u989D",
    "\u91D1\u984D",
    "\uAE08\uC561",
    "\u0441\u0443\u043C\u043C\u0430",
    "\u0627\u0644\u0645\u0628\u0644\u063A"
  ],
  INVOICE_DESCRIPTION: [
    "descripcion",
    "concepto",
    "designation",
    "beschreibung",
    "bezeichnung",
    "descrizione",
    "descricao",
    "articulo",
    "artikel",
    "\u63CF\u8FF0",
    "\u6458\u8981",
    "\u54C1\u540D",
    "\uB0B4\uC5ED",
    "\u043E\u043F\u0438\u0441\u0430\u043D\u0438\u0435",
    "\u0627\u0644\u0648\u0635\u0641"
  ]
};
var TRADE_I18N = {
  SUBTOTAL: ["ara_toplam", "delsumma", "jumlah", "subtotal_harga"],
  TAX_AMOUNT: ["kdv", "vergi", "moms", "skatt", "pajak", "ppn"],
  TAX_RATE: ["kdv_orani", "momssats", "tarif_pajak"],
  DISCOUNT_AMOUNT: ["indirim", "rabatt", "diskon", "potongan"],
  GRAND_TOTAL: ["genel_toplam", "toplam", "totalt", "summa", "total_harga", "jumlah_total"],
  CURRENCY_CODE: ["para_birimi", "valuta_kod", "mata_uang"],
  RATE_APPLIED: ["birim_fiyat", "styckpris", "harga_satuan", "harga"],
  CLAIMED_QUANTITY: ["miktar", "adet", "antal", "kuantitas", "jumlah_barang"],
  CLAIMED_AMOUNT: ["tutar", "belopp", "nilai", "jumlah_harga"],
  INVOICE_DESCRIPTION: ["aciklama", "beskrivning", "keterangan", "deskripsi"]
};
{
  const lineRoles = new Set(LINE_ITEM_MAPPINGS);
  for (const m of [...LINE_ITEM_MAPPINGS, ...DOCUMENT_MAPPINGS]) {
    const extra = [...I18N[m.role] ?? [], ...TRADE_I18N[m.role] ?? []];
    if (extra.length === 0) continue;
    const alt = m.alternativePaths ??= [];
    for (const a of extra) {
      const forms = lineRoles.has(m) ? [`line_items[*].${a}`, `items[*].${a}`, `lines[*].${a}`] : [a, `totals.${a}`];
      for (const f of forms) if (!alt.includes(f)) alt.push(f);
    }
  }
}
var INVOICE_ONTOLOGY = {
  domainId: D,
  domainName: "Commercial Invoice (generic)",
  mappings: [
    ...LINE_ITEM_MAPPINGS,
    ...DOCUMENT_MAPPINGS,
    ...CONTRACT_MAPPINGS,
    ...EVIDENCE_MAPPINGS
  ]
};

// packages/verify/src/rulesets/types.ts
function computed(value, formula, operands) {
  return { value, source: "computed", field: formula, confidence: minConfidence(operands) };
}
function minConfidence(bindings) {
  return bindings.length === 0 ? 0 : Math.min(...bindings.map((b) => b.confidence));
}
function num(b) {
  return b && typeof b.value === "number" && Number.isFinite(b.value) ? b.value : null;
}
function round42(x) {
  return Math.round(x * 1e4) / 1e4;
}

// packages/verify/src/rulesets/invoice/index.ts
function operandEvidence(bindings, roles) {
  const out = [];
  for (const r of roles) {
    const b = bindings[r];
    if (b) out.push(evidenceFromBinding(r, b));
  }
  return out;
}
function unparseable(b) {
  return b !== void 0 && b.value !== null && b.value !== void 0 && num(b) === null;
}
var shown = (b) => {
  const s = JSON.stringify(b?.value) ?? String(b?.value);
  return s.length > 40 ? `${s.slice(0, 40)}\u2026` : s;
};
function makeCompute(readsJunkAsAbsent) {
  return (input) => compute(input, readsJunkAsAbsent);
}
function compute({ docCtx, lineCtxs, extraction }, readsJunkAsAbsent) {
  const docAbsence = {};
  const lineAbsence = lineCtxs.map(() => ({}));
  const attach = {};
  const lineAmounts = [];
  const lineProblems = [];
  lineCtxs.forEach((ctx, i) => {
    attach[`line[${i}].MATH_INT`] = operandEvidence(ctx.bindings, ["RATE_APPLIED", "CLAIMED_QUANTITY"]);
    const amt = ctx.bindings.CLAIMED_AMOUNT;
    if (amt && num(amt) !== null) lineAmounts.push({ ...amt, field: amt.field.replace("[*]", `[${i}]`) });
    else lineProblems.push(`line_items[${i}]: amount missing or unparseable`);
  });
  const lineCount2 = Array.isArray(extraction.line_items) ? extraction.line_items.length : 0;
  if (lineCount2 === 0) docAbsence.LINE_ITEMS_SUM = "no line_items array on the extraction";
  else if (lineProblems.length > 0) docAbsence.LINE_ITEMS_SUM = lineProblems.join("; ");
  else {
    const sum = round42(lineAmounts.reduce((acc, b) => acc + b.value, 0));
    docCtx.bindings.LINE_ITEMS_SUM = computed(sum, `\u03A3(${lineAmounts.map((b) => b.field).join(" + ")})`, lineAmounts);
    attach["document.SUM_INT"] = lineAmounts.map((b) => evidenceFromBinding("CLAIMED_AMOUNT", b));
  }
  const B2 = docCtx.bindings;
  const subtotal = num(B2.SUBTOTAL);
  const tax = num(B2.TAX_AMOUNT);
  const discount = num(B2.DISCOUNT_AMOUNT);
  const service = num(B2.SERVICE_CHARGE);
  const subtotalJunk = !readsJunkAsAbsent && unparseable(B2.SUBTOTAL);
  const subtotalAbsence = subtotalJunk ? { reason: "UNPARSEABLE", detail: `SUBTOTAL is present but is not a number (${shown(B2.SUBTOTAL)})` } : "SUBTOTAL not present on the extraction";
  const junk = readsJunkAsAbsent ? [] : ["TAX_AMOUNT", "SERVICE_CHARGE", "DISCOUNT_AMOUNT"].filter((r) => unparseable(B2[r]));
  if (subtotal === null || !B2.SUBTOTAL) {
    docAbsence.EXPECTED_GRAND_TOTAL = subtotalAbsence;
  } else if (junk.length > 0) {
    docAbsence.EXPECTED_GRAND_TOTAL = {
      reason: "UNPARSEABLE",
      detail: `${junk.map((r) => `${r} (${shown(B2[r])})`).join(", ")} present but not a number, so the expected total cannot be computed (it is never read as 0)`
    };
  } else {
    const notes = [];
    if (tax === null) notes.push("TAX_AMOUNT absent \u2192 0");
    if (service === null) notes.push("SERVICE_CHARGE absent \u2192 0");
    if (discount === null) notes.push("DISCOUNT_AMOUNT absent \u2192 0");
    const ops = [
      B2.SUBTOTAL,
      ...tax !== null && B2.TAX_AMOUNT ? [B2.TAX_AMOUNT] : [],
      ...service !== null && B2.SERVICE_CHARGE ? [B2.SERVICE_CHARGE] : [],
      ...discount !== null && B2.DISCOUNT_AMOUNT ? [B2.DISCOUNT_AMOUNT] : []
    ];
    B2.EXPECTED_GRAND_TOTAL = computed(
      round42(subtotal + (tax ?? 0) + (service ?? 0) - Math.abs(discount ?? 0)),
      `SUBTOTAL + TAX_AMOUNT + SERVICE_CHARGE \u2212 |DISCOUNT_AMOUNT|${notes.length ? ` (${notes.join("; ")})` : ""}`,
      ops
    );
  }
  attach["document.TOTAL_INT"] = operandEvidence(B2, ["SUBTOTAL", "TAX_AMOUNT", "SERVICE_CHARGE", "DISCOUNT_AMOUNT"]);
  const rate = num(B2.TAX_RATE);
  if (subtotal === null || !B2.SUBTOTAL) docAbsence.EXPECTED_TAX_AMOUNT = subtotalAbsence;
  else if (!readsJunkAsAbsent && unparseable(B2.TAX_RATE)) docAbsence.EXPECTED_TAX_AMOUNT = { reason: "UNPARSEABLE", detail: `TAX_RATE is present but is not a number (${shown(B2.TAX_RATE)})` };
  else if (rate === null || !B2.TAX_RATE) docAbsence.EXPECTED_TAX_AMOUNT = "TAX_RATE not present on the extraction";
  else B2.EXPECTED_TAX_AMOUNT = computed(round42(subtotal * rate), "SUBTOTAL \xD7 TAX_RATE", [B2.SUBTOTAL, B2.TAX_RATE]);
  attach["document.TAX_INT"] = operandEvidence(B2, ["SUBTOTAL", "TAX_RATE"]);
  const claims = duplicateClaims(B2.DOCUMENT_ID, B2.PRIOR_CLAIM_IDS);
  return { docAbsence, lineAbsence, attach, claims };
}
var INVOICE_RULESET = {
  ...RULESET,
  name: "Commercial invoice",
  ontology: INVOICE_ONTOLOGY,
  axioms: INVOICE_AXIOMS,
  lineCodes: ["MATH_INT", "RATE_SUP", "AMT_CAP", "QTY_MATCH"],
  // DUP_PROHIB + DUP_NEAR are produced by compute() (self-contained), not the gavel — so they are NOT listed here.
  documentCodes: ["SUM_INT", "TOTAL_INT", "TAX_INT", "TIME_ORD"],
  kindByCode: {
    SUM_INT: "RECOMPUTE",
    TOTAL_INT: "RECOMPUTE",
    TAX_INT: "RECOMPUTE",
    MATH_INT: "RECOMPUTE",
    RATE_SUP: "CROSS_REFERENCE",
    AMT_CAP: "CROSS_REFERENCE",
    TIME_ORD: "CROSS_REFERENCE",
    QTY_MATCH: "CROSS_REFERENCE",
    DUP_PROHIB: "CONSISTENCY"
  },
  fieldByCode: {
    SUM_INT: "subtotal",
    TOTAL_INT: "total",
    TAX_INT: "tax",
    MATH_INT: "amount",
    RATE_SUP: "unit_price",
    AMT_CAP: "amount",
    TIME_ORD: "service_date",
    QTY_MATCH: "quantity",
    DUP_PROHIB: "invoice_number"
  },
  referenceRoles: {
    contract: ["RATE_CONTRACTED", "CONTRACTED_LIMIT", "CONTRACT_START", "CONTRACT_END"],
    evidence: ["ACTUAL_QUANTITY", "VERIFIED_AMOUNT", "EVIDENCE_DESCRIPTION"],
    history: []
  },
  computedRoles: ["LINE_ITEMS_SUM", "EXPECTED_GRAND_TOTAL", "EXPECTED_TAX_AMOUNT", "LINE_ITEM_TOTAL", "EXPECTED_TOTAL"],
  // Rounding policy (0.1.0): a 0.03% band over the $0.01 floor, capped at what rounding can produce on the claim (U × k,
  // see src/tolerance.ts). A penny never false-alarms; $2,500 on a $10M line is never "rounding".
  defaultTolerance: CAPPED,
  ambiguityGuards: [["RATE_SUP", "RATE_CONTRACTED"], ["AMT_CAP", "CONTRACTED_LIMIT"]],
  compute: makeCompute(false)
};
var INVOICE_RULESET_V0_0_1 = { ...INVOICE_RULESET, version: "0.0.1", defaultTolerance: PRACTITIONER, compute: makeCompute(true) };

// packages/verify/src/rulesets/pay-app/axioms.ts
var CURRENCY_TOLERANCE2 = 0.01;
var PERCENT_TOLERANCE = 5e-3;
var D2 = ["pay-app"];
function law(code2, id, name, statement, formal, left, operator, right, tolerance, severity) {
  return {
    id,
    shortCode: code2,
    name,
    axiomStatement: statement,
    formalForm: formal,
    predicates: [{ leftRole: left, operator, rightRole: right, tolerance, description: statement }],
    requiredRoles: right ? [left, right] : [left],
    combinationLogic: "AND",
    detectableBy: "PRECOMPUTE",
    severity,
    applicableDomains: D2
  };
}
var G703_TOTAL = law(
  "G703_TOTAL",
  "ax-payapp-g703-total",
  "Law of the Continuation Sheet",
  "Total completed and stored to date must equal previous work plus this period plus stored materials",
  "G = D + E + F",
  "COMPLETED_TO_DATE",
  "=",
  "EXPECTED_COMPLETED_TO_DATE",
  CURRENCY_TOLERANCE2,
  "high"
);
var G703_BAL = law(
  "G703_BAL",
  "ax-payapp-g703-balance",
  "Law of the Balance to Finish",
  "Balance to finish must equal scheduled value minus total completed and stored",
  "H = C \u2212 G",
  "BALANCE_TO_FINISH",
  "=",
  "EXPECTED_BALANCE_TO_FINISH",
  CURRENCY_TOLERANCE2,
  "medium"
);
var G703_PCT = law(
  "G703_PCT",
  "ax-payapp-g703-percent",
  "Law of the Percentage",
  "Percent complete must equal total completed and stored divided by scheduled value",
  "% = G \xF7 C",
  "PERCENT_COMPLETE",
  "=",
  "EXPECTED_PERCENT_COMPLETE",
  PERCENT_TOLERANCE,
  "low"
);
var G703_CAP = law(
  "G703_CAP",
  "ax-payapp-g703-cap",
  "Law of No Overbilling",
  "Total completed and stored to date may not exceed the scheduled value",
  "G \u2264 C",
  "COMPLETED_TO_DATE",
  "<=",
  "SCHEDULED_VALUE",
  CURRENCY_TOLERANCE2,
  "critical"
);
var G703_PREV = law(
  "G703_PREV",
  "ax-payapp-g703-previous",
  "Law of Continuity",
  "Work completed from previous applications must equal the previous application's total completed and stored for the same item",
  "D = G(previous application)",
  "WORK_PREVIOUS",
  "=",
  "PREVIOUS_COMPLETED_TO_DATE",
  CURRENCY_TOLERANCE2,
  "high"
);
var G702_CSUM = law(
  "G702_CSUM",
  "ax-payapp-g702-contract-sum",
  "Law of the Contract Sum",
  "Contract sum to date must equal the original contract sum plus net change by change orders",
  "line 3 = line 1 + line 2",
  "CONTRACT_SUM_TO_DATE",
  "=",
  "EXPECTED_CONTRACT_SUM_TO_DATE",
  CURRENCY_TOLERANCE2,
  "high"
);
var G702_SOV = law(
  "G702_SOV",
  "ax-payapp-g702-sov",
  "Law of the Schedule of Values",
  "The scheduled values on the continuation sheet must sum to the contract sum to date",
  "line 3 = \u03A3 C",
  "CONTRACT_SUM_TO_DATE",
  "=",
  "SOV_SCHEDULED_SUM",
  CURRENCY_TOLERANCE2,
  "high"
);
var G702_DONE = law(
  "G702_DONE",
  "ax-payapp-g702-completed",
  "Law of the Carried Total",
  "Total completed and stored to date must equal the sum of the continuation sheet's column G",
  "line 4 = \u03A3 G",
  "TOTAL_COMPLETED_STORED",
  "=",
  "SOV_COMPLETED_SUM",
  CURRENCY_TOLERANCE2,
  "critical"
);
var G702_RSUM = law(
  "G702_RSUM",
  "ax-payapp-g702-retainage-sum",
  "Law of Retainage (carried)",
  "Total retainage must equal the sum of line-level retainage",
  "line 5 = \u03A3 I",
  "RETAINAGE_TOTAL",
  "=",
  "SOV_RETAINAGE_SUM",
  CURRENCY_TOLERANCE2,
  "high"
);
var G702_RATE = law(
  "G702_RATE",
  "ax-payapp-g702-retainage-rate",
  "Law of Retainage (rate)",
  "Total retainage must equal the stated retainage percentage of total completed and stored",
  "line 5 = line 4 \xD7 rate",
  "RETAINAGE_TOTAL",
  "=",
  "EXPECTED_RETAINAGE_TOTAL",
  CURRENCY_TOLERANCE2,
  "high"
);
var G702_EARN = law(
  "G702_EARN",
  "ax-payapp-g702-earned",
  "Law of Earnings",
  "Total earned less retainage must equal total completed and stored minus total retainage",
  "line 6 = line 4 \u2212 line 5",
  "TOTAL_EARNED_LESS_RETAINAGE",
  "=",
  "EXPECTED_EARNED_LESS_RETAINAGE",
  CURRENCY_TOLERANCE2,
  "critical"
);
var G702_DUE = law(
  "G702_DUE",
  "ax-payapp-g702-due",
  "Law of the Payment Due",
  "Current payment due must equal total earned less retainage minus previous certificates for payment",
  "line 8 = line 6 \u2212 line 7",
  "CURRENT_PAYMENT_DUE",
  "=",
  "EXPECTED_CURRENT_PAYMENT_DUE",
  CURRENCY_TOLERANCE2,
  "critical"
);
var G702_BAL = law(
  "G702_BAL",
  "ax-payapp-g702-balance",
  "Law of the Balance (including retainage)",
  "Balance to finish including retainage must equal contract sum to date minus total earned less retainage",
  "line 9 = line 3 \u2212 line 6",
  "BALANCE_INCL_RETAINAGE",
  "=",
  "EXPECTED_BALANCE_INCL_RETAINAGE",
  CURRENCY_TOLERANCE2,
  "medium"
);
var G702_PREV = law(
  "G702_PREV",
  "ax-payapp-g702-previous",
  "Law of the Previous Certificate",
  "Previous certificates for payment must equal the previous application's total earned less retainage",
  "line 7 = line 6(previous application)",
  "PREVIOUS_CERTIFICATES",
  "=",
  "PREVIOUS_EARNED_LESS_RETAINAGE",
  CURRENCY_TOLERANCE2,
  "high"
);
var PAY_APP_LINE_AXIOMS = [G703_TOTAL, G703_BAL, G703_PCT, G703_CAP, G703_PREV];
var PAY_APP_DOCUMENT_AXIOMS = [
  G702_CSUM,
  G702_SOV,
  G702_DONE,
  G702_RSUM,
  G702_RATE,
  G702_EARN,
  G702_DUE,
  G702_BAL,
  G702_PREV
];
var PAY_APP_AXIOMS = [...PAY_APP_LINE_AXIOMS, ...PAY_APP_DOCUMENT_AXIOMS];

// packages/verify/src/rulesets/pay-app/ontology.ts
var D3 = "pay-app";
var PAY_APP_LINE_ARRAY_KEYS = ["schedule_of_values", "continuation_sheet", "line_items", "items", "sov"];
function line(role, fields, opts = {}) {
  const paths = [];
  for (const root2 of PAY_APP_LINE_ARRAY_KEYS) for (const f of fields) paths.push(`${root2}[*].${f}`);
  const [fieldPath, ...alternativePaths] = paths;
  return {
    domain: D3,
    role,
    documentType: "invoice",
    priority: 100,
    fieldPath,
    alternativePaths,
    fuzzyMatch: opts.fuzzy ?? false,
    ...opts.aliases ? { fieldAliases: opts.aliases } : {}
  };
}
function doc(role, fields, opts = {}) {
  const roots = ["", "summary.", "g702.", "application.", "totals."];
  const paths = [];
  for (const r of roots) for (const f of fields) paths.push(`${r}${f}`);
  const [fieldPath, ...alternativePaths] = paths;
  return { domain: D3, role, documentType: "invoice", priority: 100, fieldPath, alternativePaths, fuzzyMatch: opts.fuzzy ?? false };
}
var LINE_MAPPINGS = [
  line("SOV_ITEM_ID", ["item_no", "item_number", "item", "line_no", "line_number", "no", "id", "number", "cost_code"]),
  line("SOV_DESCRIPTION", ["description", "description_of_work", "work_description", "name", "scope"], { fuzzy: true, aliases: ["description"] }),
  line("SCHEDULED_VALUE", ["scheduled_value", "scheduled_amount", "contract_value", "sov_value", "value", "budget", "contract_amount", "amount"]),
  line("WORK_PREVIOUS", ["previous", "from_previous_application", "from_previous_applications", "previous_applications", "work_completed_previous", "previously_completed", "completed_previous", "prior", "previous_work"]),
  line("WORK_THIS_PERIOD", ["this_period", "work_completed_this_period", "this_application", "current_period", "current", "this_month", "completed_this_period"]),
  line("MATERIALS_STORED", ["materials_stored", "materials_presently_stored", "stored_materials", "presently_stored", "stored"]),
  line("COMPLETED_TO_DATE", ["completed_to_date", "total_completed_and_stored", "total_completed_and_stored_to_date", "total_completed_stored_to_date", "total_to_date", "completed_and_stored", "total_completed", "total_completed_stored"]),
  line("PERCENT_COMPLETE", ["percent_complete", "percent", "pct_complete", "percentage_complete", "percentage", "complete_pct", "g_over_c", "pct"]),
  line("BALANCE_TO_FINISH", ["balance_to_finish", "balance", "balance_remaining", "remaining", "remaining_balance"]),
  line("LINE_RETAINAGE", ["retainage", "retention", "retainage_amount", "retained", "retainage_held"])
];
var DOCUMENT_MAPPINGS2 = [
  doc("DOCUMENT_ID", ["application_number", "application_no", "pay_app_number", "pay_application_number", "app_no", "invoice_number", "number"]),
  doc("ORIGINAL_CONTRACT_SUM", ["original_contract_sum", "original_contract_amount", "original_contract_value", "base_contract", "base_contract_sum"]),
  doc("NET_CHANGE_ORDERS", ["net_change_orders", "net_change_by_change_orders", "change_orders_net", "net_change", "approved_change_orders", "approved_change_orders_total"]),
  doc("CONTRACT_SUM_TO_DATE", ["contract_sum_to_date", "revised_contract_sum", "current_contract_sum", "adjusted_contract_sum", "contract_sum"]),
  doc("TOTAL_COMPLETED_STORED", ["total_completed_and_stored", "total_completed_and_stored_to_date", "total_completed_stored_to_date", "total_completed_to_date", "work_completed_to_date", "total_completed"]),
  doc("RETAINAGE_RATE", ["retainage_rate", "retainage_percent", "retainage_percentage", "retention_rate", "retainage_pct", "retention_percent"]),
  doc("RETAINAGE_TOTAL", ["total_retainage", "retainage_total", "retainage", "retention_total", "total_retention", "retainage_held"]),
  doc("TOTAL_EARNED_LESS_RETAINAGE", ["total_earned_less_retainage", "earned_less_retainage", "net_earned", "total_earned_less_retention"]),
  doc("PREVIOUS_CERTIFICATES", ["less_previous_certificates", "previous_certificates", "previous_certificates_for_payment", "less_previous_certificates_for_payment", "previous_payments", "previously_paid", "prior_payments", "previously_certified"]),
  doc("CURRENT_PAYMENT_DUE", ["current_payment_due", "payment_due", "amount_due", "this_payment", "current_due", "total_due"]),
  doc("BALANCE_INCL_RETAINAGE", ["balance_to_finish_including_retainage", "balance_to_finish_incl_retainage", "balance_including_retainage", "balance_to_finish", "remaining_balance"]),
  doc("CURRENCY_CODE", ["currency", "currency_code"])
];
var PAY_APP_ROLE_KINDS = {
  SOV_ITEM_ID: "reference",
  SOV_DESCRIPTION: "string",
  SCHEDULED_VALUE: "amount",
  WORK_PREVIOUS: "amount",
  WORK_THIS_PERIOD: "amount",
  MATERIALS_STORED: "amount",
  COMPLETED_TO_DATE: "amount",
  EXPECTED_COMPLETED_TO_DATE: "amount",
  PERCENT_COMPLETE: "rate",
  EXPECTED_PERCENT_COMPLETE: "rate",
  BALANCE_TO_FINISH: "amount",
  EXPECTED_BALANCE_TO_FINISH: "amount",
  LINE_RETAINAGE: "amount",
  PREVIOUS_COMPLETED_TO_DATE: "amount",
  ORIGINAL_CONTRACT_SUM: "amount",
  NET_CHANGE_ORDERS: "amount",
  CONTRACT_SUM_TO_DATE: "amount",
  EXPECTED_CONTRACT_SUM_TO_DATE: "amount",
  TOTAL_COMPLETED_STORED: "amount",
  SOV_SCHEDULED_SUM: "amount",
  SOV_COMPLETED_SUM: "amount",
  RETAINAGE_RATE: "rate",
  RETAINAGE_TOTAL: "amount",
  EXPECTED_RETAINAGE_TOTAL: "amount",
  SOV_RETAINAGE_SUM: "amount",
  TOTAL_EARNED_LESS_RETAINAGE: "amount",
  EXPECTED_EARNED_LESS_RETAINAGE: "amount",
  PREVIOUS_CERTIFICATES: "amount",
  PREVIOUS_EARNED_LESS_RETAINAGE: "amount",
  CURRENT_PAYMENT_DUE: "amount",
  EXPECTED_CURRENT_PAYMENT_DUE: "amount",
  BALANCE_INCL_RETAINAGE: "amount",
  EXPECTED_BALANCE_INCL_RETAINAGE: "amount"
};
var PAY_APP_ONTOLOGY = {
  domainId: D3,
  domainName: "Construction pay application (AIA G702 / G703)",
  mappings: [...LINE_MAPPINGS, ...DOCUMENT_MAPPINGS2],
  roleKinds: PAY_APP_ROLE_KINDS,
  lineArrayKeys: PAY_APP_LINE_ARRAY_KEYS
};

// packages/verify/src/rulesets/pay-app/index.ts
function operandEvidence2(b, roles) {
  const out = [];
  for (const r of roles) if (b[r]) out.push(evidenceFromBinding(r, b[r]));
  return out;
}
function column(lineCtxs, role, lineKey) {
  const values = [];
  const problems = [];
  lineCtxs.forEach((ctx, i) => {
    const b = ctx.bindings[role];
    if (b && num(b) !== null) values.push({ ...b, field: b.field.replace("[*]", `[${i}]`) });
    else problems.push(`${lineKey}[${i}]: ${role} missing or unparseable`);
  });
  return { values, problems };
}
var ITEM_KEYS = ["item_no", "item_number", "item", "line_no", "line_number", "no", "id", "number", "cost_code"];
var COMPLETED_KEYS = ["completed_to_date", "total_completed_and_stored", "total_completed_and_stored_to_date", "total_completed_stored_to_date", "total_to_date", "completed_and_stored", "total_completed", "total_completed_stored"];
var EARNED_KEYS = ["total_earned_less_retainage", "earned_less_retainage", "net_earned", "total_earned_less_retention"];
var APP_NO_KEYS = ["application_number", "application_no", "pay_app_number", "pay_application_number", "app_no", "invoice_number", "number"];
var DOC_ROOTS = ["", "summary.", "g702.", "application.", "totals."];
function get(obj, path) {
  let cur = obj;
  for (const part of path.split(".")) {
    if (part === "") continue;
    if (cur === null || typeof cur !== "object" || Array.isArray(cur)) return void 0;
    cur = cur[part];
  }
  return cur;
}
function firstKey(obj, keys, roots = [""]) {
  for (const r of roots) for (const k of keys) {
    const v = get(obj, `${r}${k}`);
    if (v !== void 0 && v !== null && v !== "") return { path: `${r}${k}`, value: v };
  }
  return null;
}
function itemIdOf(line3) {
  const hit = firstKey(line3, ITEM_KEYS);
  if (!hit) return null;
  const n = normalizeReference(hit.value);
  return n?.success ? n.normalized : String(hit.value).trim();
}
function lineArrayOf(doc3) {
  for (const k of PAY_APP_LINE_ARRAY_KEYS) {
    const v = doc3[k];
    if (Array.isArray(v)) return { key: k, lines: v.filter((x) => x !== null && typeof x === "object" && !Array.isArray(x)) };
  }
  return null;
}
function appNumber(doc3) {
  const hit = firstKey(doc3, APP_NO_KEYS, DOC_ROOTS);
  if (!hit) return null;
  const m = String(hit.value).match(/(\d+)(?!.*\d)/);
  return m ? Number(m[1]) : null;
}
function previousApplication(history) {
  if (history.length === 0) return "no previous application supplied";
  if (history.length === 1) return { index: 0, doc: history[0] };
  const numbered = history.map((d, i) => ({ i, n: appNumber(d) }));
  if (numbered.some((x) => x.n === null)) {
    return { reason: "AMBIGUOUS_REFERENCE", detail: `${history.length} history documents supplied and not all carry an application number; cannot tell which is the previous application` };
  }
  numbered.sort((a, b) => b.n - a.n);
  const top = numbered[0];
  if (numbered[1] && numbered[1].n === top.n) {
    return { reason: "AMBIGUOUS_REFERENCE", detail: `two history documents share application number ${top.n}` };
  }
  return { index: top.i, doc: history[top.i] };
}
function historyAmount(path, raw) {
  const n = normalizeAmount(raw);
  if (!n?.success) return null;
  return {
    value: n.normalized,
    source: "history",
    field: path,
    confidence: 100,
    originalValue: n.original ?? raw,
    normalizedValue: n.normalized,
    normalizations: n.transformations
  };
}
function compute2({ extraction, references, docCtx, lineCtxs }) {
  const docAbsence = {};
  const lineAbsence = lineCtxs.map(() => ({}));
  const attach = {};
  const arr = lineArrayOf(extraction);
  const lineKey = arr?.key ?? "schedule_of_values";
  const lines = arr?.lines ?? [];
  const prev = previousApplication(references.history);
  const prevDoc = typeof prev === "object" && "doc" in prev ? prev : null;
  const prevAbsence = prevDoc ? "" : prev;
  const prevLines = prevDoc ? lineArrayOf(prevDoc.doc) : null;
  const prevById = /* @__PURE__ */ new Map();
  if (prevDoc && prevLines) {
    prevLines.lines.forEach((l, j) => {
      const id = itemIdOf(l);
      if (id === null) return;
      prevById.set(id, prevById.has(id) ? "duplicate" : { path: `history[${prevDoc.index}].${prevLines.key}[${j}]`, line: l });
    });
  }
  lineCtxs.forEach((ctx, i) => {
    const B3 = ctx.bindings;
    const A2 = lineAbsence[i];
    const C2 = num(B3.SCHEDULED_VALUE), Dv = num(B3.WORK_PREVIOUS), E2 = num(B3.WORK_THIS_PERIOD), F2 = num(B3.MATERIALS_STORED), G = num(B3.COMPLETED_TO_DATE);
    if (Dv === null && E2 === null && F2 === null) {
      A2.EXPECTED_COMPLETED_TO_DATE = "none of previous / this period / materials stored is present on the line";
    } else {
      const notes = [];
      if (Dv === null) notes.push("D absent \u2192 0");
      if (E2 === null) notes.push("E absent \u2192 0");
      if (F2 === null) notes.push("F absent \u2192 0");
      const ops = [B3.WORK_PREVIOUS, B3.WORK_THIS_PERIOD, B3.MATERIALS_STORED].filter((b) => !!b && num(b) !== null);
      B3.EXPECTED_COMPLETED_TO_DATE = computed(round42((Dv ?? 0) + (E2 ?? 0) + (F2 ?? 0)), `D + E + F${notes.length ? ` (${notes.join("; ")})` : ""}`, ops);
    }
    attach[`line[${i}].G703_TOTAL`] = operandEvidence2(B3, ["WORK_PREVIOUS", "WORK_THIS_PERIOD", "MATERIALS_STORED"]);
    if (C2 === null || !B3.SCHEDULED_VALUE) A2.EXPECTED_BALANCE_TO_FINISH = "SCHEDULED_VALUE not present on the line";
    else if (G === null || !B3.COMPLETED_TO_DATE) A2.EXPECTED_BALANCE_TO_FINISH = "COMPLETED_TO_DATE not present on the line";
    else B3.EXPECTED_BALANCE_TO_FINISH = computed(round42(C2 - G), "C \u2212 G", [B3.SCHEDULED_VALUE, B3.COMPLETED_TO_DATE]);
    attach[`line[${i}].G703_BAL`] = operandEvidence2(B3, ["SCHEDULED_VALUE", "COMPLETED_TO_DATE"]);
    if (C2 === null || !B3.SCHEDULED_VALUE) A2.EXPECTED_PERCENT_COMPLETE = "SCHEDULED_VALUE not present on the line";
    else if (C2 === 0) A2.EXPECTED_PERCENT_COMPLETE = "SCHEDULED_VALUE is zero; percent complete is undefined";
    else if (G === null || !B3.COMPLETED_TO_DATE) A2.EXPECTED_PERCENT_COMPLETE = "COMPLETED_TO_DATE not present on the line";
    else B3.EXPECTED_PERCENT_COMPLETE = computed(Math.round(G / C2 * 1e6) / 1e6, "G \xF7 C", [B3.SCHEDULED_VALUE, B3.COMPLETED_TO_DATE]);
    attach[`line[${i}].G703_PCT`] = operandEvidence2(B3, ["SCHEDULED_VALUE", "COMPLETED_TO_DATE"]);
    const pct4 = B3.PERCENT_COMPLETE;
    if (pct4) {
      const raw = pct4.originalValue;
      const bare = typeof raw === "number" || typeof raw === "string" && !raw.includes("%");
      const rawNum = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw.replace(/[^0-9.\-]/g, "")) : NaN;
      if (bare && Number.isFinite(rawNum) && rawNum > 0 && rawNum <= 1) {
        delete B3.PERCENT_COMPLETE;
        A2.PERCENT_COMPLETE = { reason: "AMBIGUOUS_UNIT", detail: `${pct4.field} = ${String(raw)} \u2014 a bare value in (0, 1] may be a percent or a fraction; send "45%" or 45` };
      }
    }
    if (!prevDoc) {
      A2.PREVIOUS_COMPLETED_TO_DATE = prevAbsence;
    } else if (!prevLines) {
      A2.PREVIOUS_COMPLETED_TO_DATE = "the previous application has no schedule-of-values array";
    } else {
      const id = lines[i] ? itemIdOf(lines[i]) : null;
      if (id === null) A2.PREVIOUS_COMPLETED_TO_DATE = `${lineKey}[${i}] has no item number; lines are matched to the previous application by item number only`;
      else {
        const hit = prevById.get(id);
        if (hit === void 0) A2.PREVIOUS_COMPLETED_TO_DATE = `no line in the previous application carries item number ${id}`;
        else if (hit === "duplicate") A2.PREVIOUS_COMPLETED_TO_DATE = { reason: "AMBIGUOUS_REFERENCE", detail: `the previous application lists item number ${id} more than once` };
        else {
          const g = firstKey(hit.line, COMPLETED_KEYS);
          const bound = g ? historyAmount(`${hit.path}.${g.path}`, g.value) : null;
          if (!bound) A2.PREVIOUS_COMPLETED_TO_DATE = `previous application item ${id} has no completed-to-date amount`;
          else B3.PREVIOUS_COMPLETED_TO_DATE = bound;
        }
      }
    }
  });
  const B2 = docCtx.bindings;
  const L1 = num(B2.ORIGINAL_CONTRACT_SUM), L2 = num(B2.NET_CHANGE_ORDERS), L3 = num(B2.CONTRACT_SUM_TO_DATE);
  const L4 = num(B2.TOTAL_COMPLETED_STORED), L5 = num(B2.RETAINAGE_TOTAL), rate = num(B2.RETAINAGE_RATE);
  const L6 = num(B2.TOTAL_EARNED_LESS_RETAINAGE), L7 = num(B2.PREVIOUS_CERTIFICATES);
  if (L1 === null || !B2.ORIGINAL_CONTRACT_SUM) docAbsence.EXPECTED_CONTRACT_SUM_TO_DATE = "ORIGINAL_CONTRACT_SUM not present";
  else {
    const ops = [B2.ORIGINAL_CONTRACT_SUM, ...L2 !== null && B2.NET_CHANGE_ORDERS ? [B2.NET_CHANGE_ORDERS] : []];
    B2.EXPECTED_CONTRACT_SUM_TO_DATE = computed(round42(L1 + (L2 ?? 0)), `line 1 + line 2${L2 === null ? " (line 2 absent \u2192 0)" : ""}`, ops);
  }
  attach["document.G702_CSUM"] = operandEvidence2(B2, ["ORIGINAL_CONTRACT_SUM", "NET_CHANGE_ORDERS"]);
  if (lines.length === 0) {
    docAbsence.SOV_SCHEDULED_SUM = docAbsence.SOV_COMPLETED_SUM = docAbsence.SOV_RETAINAGE_SUM = "no schedule-of-values array on the extraction";
  } else {
    const sc = column(lineCtxs, "SCHEDULED_VALUE", lineKey);
    if (sc.problems.length) docAbsence.SOV_SCHEDULED_SUM = sc.problems.join("; ");
    else {
      B2.SOV_SCHEDULED_SUM = computed(round42(sc.values.reduce((a, b) => a + b.value, 0)), `\u03A3(${sc.values.map((b) => b.field).join(" + ")})`, sc.values);
      attach["document.G702_SOV"] = sc.values.map((b) => evidenceFromBinding("SCHEDULED_VALUE", b));
    }
    const gc = column(lineCtxs, "COMPLETED_TO_DATE", lineKey);
    if (gc.problems.length) docAbsence.SOV_COMPLETED_SUM = gc.problems.join("; ");
    else {
      B2.SOV_COMPLETED_SUM = computed(round42(gc.values.reduce((a, b) => a + b.value, 0)), `\u03A3(${gc.values.map((b) => b.field).join(" + ")})`, gc.values);
      attach["document.G702_DONE"] = gc.values.map((b) => evidenceFromBinding("COMPLETED_TO_DATE", b));
    }
    const rc = column(lineCtxs, "LINE_RETAINAGE", lineKey);
    if (rc.values.length === 0) docAbsence.SOV_RETAINAGE_SUM = "no line-level retainage on the continuation sheet (column I absent)";
    else if (rc.problems.length) docAbsence.SOV_RETAINAGE_SUM = rc.problems.join("; ");
    else {
      B2.SOV_RETAINAGE_SUM = computed(round42(rc.values.reduce((a, b) => a + b.value, 0)), `\u03A3(${rc.values.map((b) => b.field).join(" + ")})`, rc.values);
      attach["document.G702_RSUM"] = rc.values.map((b) => evidenceFromBinding("LINE_RETAINAGE", b));
    }
  }
  if (L4 === null || !B2.TOTAL_COMPLETED_STORED) docAbsence.EXPECTED_RETAINAGE_TOTAL = "TOTAL_COMPLETED_STORED not present";
  else if (rate === null || !B2.RETAINAGE_RATE) docAbsence.EXPECTED_RETAINAGE_TOTAL = "RETAINAGE_RATE not present";
  else B2.EXPECTED_RETAINAGE_TOTAL = computed(round42(L4 * rate), "line 4 \xD7 rate", [B2.TOTAL_COMPLETED_STORED, B2.RETAINAGE_RATE]);
  attach["document.G702_RATE"] = operandEvidence2(B2, ["TOTAL_COMPLETED_STORED", "RETAINAGE_RATE"]);
  if (L4 === null || !B2.TOTAL_COMPLETED_STORED) docAbsence.EXPECTED_EARNED_LESS_RETAINAGE = "TOTAL_COMPLETED_STORED not present";
  else if (L5 === null || !B2.RETAINAGE_TOTAL) docAbsence.EXPECTED_EARNED_LESS_RETAINAGE = "RETAINAGE_TOTAL not present";
  else B2.EXPECTED_EARNED_LESS_RETAINAGE = computed(round42(L4 - L5), "line 4 \u2212 line 5", [B2.TOTAL_COMPLETED_STORED, B2.RETAINAGE_TOTAL]);
  attach["document.G702_EARN"] = operandEvidence2(B2, ["TOTAL_COMPLETED_STORED", "RETAINAGE_TOTAL"]);
  if (L6 === null || !B2.TOTAL_EARNED_LESS_RETAINAGE) docAbsence.EXPECTED_CURRENT_PAYMENT_DUE = "TOTAL_EARNED_LESS_RETAINAGE not present";
  else {
    const ops = [B2.TOTAL_EARNED_LESS_RETAINAGE, ...L7 !== null && B2.PREVIOUS_CERTIFICATES ? [B2.PREVIOUS_CERTIFICATES] : []];
    B2.EXPECTED_CURRENT_PAYMENT_DUE = computed(round42(L6 - (L7 ?? 0)), `line 6 \u2212 line 7${L7 === null ? " (line 7 absent \u2192 0)" : ""}`, ops);
  }
  attach["document.G702_DUE"] = operandEvidence2(B2, ["TOTAL_EARNED_LESS_RETAINAGE", "PREVIOUS_CERTIFICATES"]);
  if (L3 === null || !B2.CONTRACT_SUM_TO_DATE) docAbsence.EXPECTED_BALANCE_INCL_RETAINAGE = "CONTRACT_SUM_TO_DATE not present";
  else if (L6 === null || !B2.TOTAL_EARNED_LESS_RETAINAGE) docAbsence.EXPECTED_BALANCE_INCL_RETAINAGE = "TOTAL_EARNED_LESS_RETAINAGE not present";
  else B2.EXPECTED_BALANCE_INCL_RETAINAGE = computed(round42(L3 - L6), "line 3 \u2212 line 6", [B2.CONTRACT_SUM_TO_DATE, B2.TOTAL_EARNED_LESS_RETAINAGE]);
  attach["document.G702_BAL"] = operandEvidence2(B2, ["CONTRACT_SUM_TO_DATE", "TOTAL_EARNED_LESS_RETAINAGE"]);
  if (!prevDoc) docAbsence.PREVIOUS_EARNED_LESS_RETAINAGE = prevAbsence;
  else {
    const e = firstKey(prevDoc.doc, EARNED_KEYS, DOC_ROOTS);
    const bound = e ? historyAmount(`history[${prevDoc.index}].${e.path}`, e.value) : null;
    if (!bound) docAbsence.PREVIOUS_EARNED_LESS_RETAINAGE = "the previous application has no total-earned-less-retainage amount";
    else B2.PREVIOUS_EARNED_LESS_RETAINAGE = bound;
  }
  return { docAbsence, lineAbsence, attach };
}
var PAY_APP_RULESET = {
  ...PAY_APP_RULESET_REF,
  name: "Construction pay application (AIA G702 / G703)",
  ontology: PAY_APP_ONTOLOGY,
  axioms: PAY_APP_AXIOMS,
  lineCodes: PAY_APP_LINE_AXIOMS.map((a) => a.shortCode),
  documentCodes: PAY_APP_DOCUMENT_AXIOMS.map((a) => a.shortCode),
  kindByCode: {
    G703_TOTAL: "RECOMPUTE",
    G703_BAL: "RECOMPUTE",
    G703_PCT: "RECOMPUTE",
    G703_CAP: "CONSISTENCY",
    G703_PREV: "CROSS_REFERENCE",
    G702_CSUM: "RECOMPUTE",
    G702_SOV: "RECOMPUTE",
    G702_DONE: "RECOMPUTE",
    G702_RSUM: "RECOMPUTE",
    G702_RATE: "RECOMPUTE",
    G702_EARN: "RECOMPUTE",
    G702_DUE: "RECOMPUTE",
    G702_BAL: "RECOMPUTE",
    G702_PREV: "CROSS_REFERENCE"
  },
  fieldByCode: {
    G703_TOTAL: "completed_to_date",
    G703_BAL: "balance_to_finish",
    G703_PCT: "percent_complete",
    G703_CAP: "completed_to_date",
    G703_PREV: "previous",
    G702_CSUM: "contract_sum_to_date",
    G702_SOV: "contract_sum_to_date",
    G702_DONE: "total_completed_and_stored",
    G702_RSUM: "total_retainage",
    G702_RATE: "total_retainage",
    G702_EARN: "total_earned_less_retainage",
    G702_DUE: "current_payment_due",
    G702_BAL: "balance_to_finish_including_retainage",
    G702_PREV: "less_previous_certificates"
  },
  referenceRoles: {
    contract: [],
    evidence: [],
    history: ["PREVIOUS_COMPLETED_TO_DATE", "PREVIOUS_EARNED_LESS_RETAINAGE"]
  },
  computedRoles: [
    "EXPECTED_COMPLETED_TO_DATE",
    "EXPECTED_BALANCE_TO_FINISH",
    "EXPECTED_PERCENT_COMPLETE",
    "EXPECTED_CONTRACT_SUM_TO_DATE",
    "SOV_SCHEDULED_SUM",
    "SOV_COMPLETED_SUM",
    "SOV_RETAINAGE_SUM",
    "EXPECTED_RETAINAGE_TOTAL",
    "EXPECTED_EARNED_LESS_RETAINAGE",
    "EXPECTED_CURRENT_PAYMENT_DUE",
    "EXPECTED_BALANCE_INCL_RETAINAGE"
  ],
  ambiguityGuards: [],
  compute: compute2
};

// packages/verify/src/rulesets/index.ts
var RULESETS = [INVOICE_RULESET, PAY_APP_RULESET];
var RULESET_VERSIONS = [...RULESETS, INVOICE_RULESET_V0_0_1];
var BY_ID = new Map(RULESETS.map((r) => [r.id, r]));
var BY_REF = new Map(RULESET_VERSIONS.map((r) => [`${r.id}@${r.version}`, r]));
function resolveRuleset(r) {
  if (r === void 0) return INVOICE_RULESET;
  if (typeof r !== "string") return r;
  const hit = BY_ID.get(r) ?? BY_REF.get(r);
  if (!hit) throw new Error(`unknown ruleset "${r}"; known: ${[...BY_ID.keys(), ...BY_REF.keys()].join(", ")}`);
  return hit;
}

// packages/verify/src/verdict/canonical.ts
import { createHash } from "node:crypto";
function canonicalize(value) {
  return JSON.stringify(normalize(value));
}
function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
function hashOf(value) {
  return sha256(canonicalize(value));
}
function normalize(v) {
  if (v === void 0 || v === null) return v === void 0 ? void 0 : null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.toISOString();
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "string" || typeof v === "boolean") return v;
  if (Array.isArray(v)) {
    return v.map((x) => {
      const n = normalize(x);
      return n === void 0 ? null : n;
    });
  }
  if (typeof v === "object") {
    const src = v;
    const out = /* @__PURE__ */ Object.create(null);
    for (const k of Object.keys(src).sort()) {
      const n = normalize(src[k]);
      if (n !== void 0) out[k] = n;
    }
    return out;
  }
  return null;
}

// packages/verify/src/verdict/accuracy.ts
function attachDeclaredAccuracy(verdict, accuracy) {
  if (accuracy.ruleset_version !== verdict.ruleset.version) {
    throw new Error(
      `declared_accuracy was measured on ruleset version ${accuracy.ruleset_version} but this verdict is from version ${verdict.ruleset.version}; re-measure before attaching`
    );
  }
  return { ...verdict, declared_accuracy: accuracy };
}

// packages/verify/src/declarative/expr.ts
function tokenize(s) {
  const toks = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < s.length && /[0-9.]/.test(s[j])) j++;
      toks.push({ t: "num", v: s.slice(i, j) });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < s.length && /[A-Za-z0-9_]/.test(s[j])) j++;
      if (s[j] === "?") {
        toks.push({ t: "id", v: s.slice(i, j), opt: true });
        i = j + 1;
        continue;
      }
      toks.push({ t: "id", v: s.slice(i, j) });
      i = j;
      continue;
    }
    if (c === "(") {
      toks.push({ t: "lp", v: c });
      i++;
      continue;
    }
    if (c === ")") {
      toks.push({ t: "rp", v: c });
      i++;
      continue;
    }
    if ("+-*/".includes(c)) {
      toks.push({ t: "op", v: c });
      i++;
      continue;
    }
    throw new Error(`invalid character in expression: '${c}'`);
  }
  return toks;
}
function evalExpr(expr2, env) {
  const toks = tokenize(expr2);
  let p = 0;
  const peek = () => toks[p];
  const next = () => toks[p++];
  function parseExpr() {
    let left = parseTerm();
    while (peek()?.t === "op" && (peek().v === "+" || peek().v === "-")) {
      const op = next().v;
      const right = parseTerm();
      if (left === void 0 || right === void 0) left = void 0;
      else left = op === "+" ? left + right : left - right;
    }
    return left;
  }
  function parseTerm() {
    let left = parseFactor();
    while (peek()?.t === "op" && (peek().v === "*" || peek().v === "/")) {
      const op = next().v;
      const right = parseFactor();
      if (left === void 0 || right === void 0) left = void 0;
      else left = op === "*" ? left * right : right === 0 ? void 0 : left / right;
    }
    return left;
  }
  function parseFactor() {
    const tk2 = peek();
    if (!tk2) throw new Error("unexpected end of expression");
    if (tk2.t === "op" && tk2.v === "-") {
      next();
      const v = parseFactor();
      return v === void 0 ? void 0 : -v;
    }
    if (tk2.t === "op" && tk2.v === "+") {
      next();
      return parseFactor();
    }
    if (tk2.t === "num") {
      next();
      return Number(tk2.v);
    }
    if (tk2.t === "lp") {
      next();
      const v = parseExpr();
      expect("rp");
      return v;
    }
    if (tk2.t === "id") {
      next();
      if (peek()?.t === "lp") {
        if (tk2.opt) throw new Error(`'?' marks an optional role; it cannot follow the function name '${tk2.v}'`);
        next();
        if (tk2.v === "sum") {
          const arg = peek();
          if (!arg || arg.t !== "id") throw new Error("sum() expects a role name");
          if (arg.opt) throw new Error("sum() takes a role name without '?'");
          next();
          expect("rp");
          return env.sum(arg.v);
        }
        if (tk2.v === "abs") {
          const v = parseExpr();
          expect("rp");
          return v === void 0 ? void 0 : Math.abs(v);
        }
        throw new Error(`unknown function '${tk2.v}'`);
      }
      if (tk2.opt) return env.vars[tk2.v] ?? 0;
      return env.vars[tk2.v];
    }
    throw new Error(`unexpected token '${tk2.v}'`);
  }
  function expect(t) {
    if (peek()?.t !== t) throw new Error(`expected ${t}`);
    next();
  }
  const result = parseExpr();
  if (p !== toks.length) throw new Error("trailing tokens in expression");
  return result;
}
function referencedRoles(expr2) {
  const out = /* @__PURE__ */ new Set();
  for (const t of tokenize(expr2)) if (t.t === "id" && t.v !== "sum" && t.v !== "abs") out.add(t.v);
  return [...out];
}
function roleRefs(...exprs) {
  const all = /* @__PURE__ */ new Set(), req = /* @__PURE__ */ new Set();
  for (const e of exprs) for (const t of tokenize(e)) {
    if (t.t !== "id" || t.v === "sum" || t.v === "abs") continue;
    all.add(t.v);
    if (!t.opt) req.add(t.v);
  }
  const list = [...all];
  return { all: list, required: list.filter((r) => req.has(r)), optional: list.filter((r) => !req.has(r)) };
}

// packages/verify/src/declarative/evaluate.ts
var ROUNDING_UNITS = [1e6, 1e5, 1e3, 1];
function inferReportingUnit(values) {
  if (values.length === 0) return void 0;
  return ROUNDING_UNITS.find((u) => values.every((v) => Number.isFinite(v) && Math.abs(v) % u === 0));
}
function roundingTolerance(values, rel, absCap, floor) {
  const n = values.length;
  const maxAbs = values.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  const unit = inferReportingUnit(values);
  const relTerm = round4(absCap > 0 ? Math.min(rel * maxAbs, absCap) : rel * maxAbs);
  return { tol: Math.max(floor, relTerm, (unit ?? 0) * n), unit, n, maxAbs };
}
function conditionHolds(l, op, r, tol) {
  switch (op) {
    case "=":
      return Math.abs(l - r) <= tol;
    case "!=":
      return Math.abs(l - r) > tol;
    case "<":
      return l < r - tol;
    case "<=":
      return l <= r + tol;
    case ">":
      return l > r + tol;
    case ">=":
      return l >= r - tol;
    default:
      return false;
  }
}
var isDefaulted = (b) => !!b && b.status === "ok" && !!b.path && b.path.startsWith("default(");
var isAmountField = (f) => !!f && (f.kind === void 0 || f.kind === "amount");
var statusOf = (b) => !b ? "missing" : b.status === "ok" ? isDefaulted(b) ? "defaulted" : "ok" : b.status;
function getPath(obj, path) {
  const parts = path.replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean);
  let cur = obj;
  for (const p of parts) {
    if (cur === null || typeof cur !== "object") return void 0;
    cur = cur[p];
  }
  return cur;
}
function normBool(raw) {
  if (raw === true || raw === false) return { value: raw ? 1 : 0, norms: ["bool_to_number"] };
  if (raw === 1 || raw === 0) return { value: raw, norms: ["already_number"] };
  if (typeof raw === "string") {
    const s = raw.trim().toLowerCase();
    if (s === "true" || s === "yes" || s === "1") return { value: 1, norms: ["bool_text_parsed"] };
    if (s === "false" || s === "no" || s === "0") return { value: 0, norms: ["bool_text_parsed"] };
  }
  return null;
}
function normIdentifiers(raw) {
  const one2 = (x) => {
    if (typeof x === "number" && Number.isFinite(x)) return String(x);
    if (typeof x !== "string") return void 0;
    const n = x.replace(/\s+/g, "").toUpperCase();
    return n.length ? n : null;
  };
  if (!Array.isArray(raw)) {
    const n = one2(raw);
    return typeof n === "string" ? [n] : null;
  }
  const out = [];
  for (const x of raw) {
    const n = one2(x);
    if (n === void 0) return null;
    if (n !== null && !out.includes(n)) out.push(n);
  }
  return out;
}
function normPrice(raw) {
  if (typeof raw === "number") return Number.isFinite(raw) ? { value: raw, norms: ["already_number"] } : null;
  if (typeof raw === "string" && /^\s*-?\d+(\.\d+)?\s*$/.test(raw)) {
    const v = Number(raw);
    return Number.isFinite(v) ? { value: v, norms: ["plain_decimal_parsed"] } : null;
  }
  const n = normalizeAmount(raw);
  if (!n?.success || typeof n.normalized !== "number" || !Number.isFinite(n.normalized)) return null;
  if (n.transformations.includes("rounded_to_2_decimals")) return null;
  return { value: n.normalized, norms: n.transformations };
}
function normByKind(kind, raw) {
  if (kind === "bool") return normBool(raw);
  if (kind === "price") return normPrice(raw);
  const n = kind === "rate" ? normalizeRate(raw) : kind === "quantity" ? normalizeQuantity(raw) : normalizeAmount(raw);
  if (!n?.success || typeof n.normalized !== "number" || !Number.isFinite(n.normalized)) return null;
  return { value: n.normalized, norms: n.transformations };
}
function bindField(source, field) {
  let resolvedButBad = false;
  for (let i = 0; i < field.paths.length; i++) {
    const raw = getPath(source, field.paths[i]);
    if (raw === void 0 || raw === null || raw === "") continue;
    const confidence = i === 0 ? 100 : 95;
    if (field.kind === "string") return { status: "ok", strValue: String(raw), path: field.paths[i], confidence, original: raw };
    if (field.kind === "identifier") {
      const ids = normIdentifiers(raw);
      if (ids) return { status: "ok", ids, path: field.paths[i], confidence, original: raw, norms: ["identifier_normalized"] };
      resolvedButBad = true;
      continue;
    }
    const norm2 = normByKind(field.kind, raw);
    if (norm2) return { status: "ok", value: norm2.value, path: field.paths[i], confidence, original: raw, norms: norm2.norms };
    resolvedButBad = true;
  }
  if (!resolvedButBad && field.default !== void 0) return { status: "ok", value: field.default, path: `default(${field.default})`, confidence: 100 };
  return { status: resolvedButBad ? "unparseable" : "missing", confidence: 0 };
}
function fieldEvidence(role, b) {
  if (b.status !== "ok" || !b.path) return null;
  const value = b.ids !== void 0 ? Array.isArray(b.original) ? b.ids : b.ids[0] ?? null : b.value !== void 0 ? b.value : b.strValue ?? null;
  const source = b.path.startsWith("default(") ? "computed" : "invoice";
  const e = { locator: { kind: "field", source, path: b.path }, value, confidence: b.confidence, role: "OPERAND" };
  if (b.original !== void 0 && String(b.original) !== String(value)) e.original = b.original;
  if (b.norms && b.norms.length) e.normalizations = b.norms;
  return e;
}
var declaredAbstention = (why) => ({ reason: "OUT_OF_RULESET_SCOPE", detail: `declared abstention: ${why}` });
var evidenceKey2 = (e) => e.locator.kind === "field" ? `${e.locator.source}:${e.locator.path}` : `span:${e.locator.source_hash}`;
function verifyDeclarative(extraction, ruleset, options = {}) {
  const lineKeys = ruleset.lineArrayKeys ?? ["line_items"];
  const lineKey = lineKeys.find((k) => Array.isArray(extraction[k]));
  const lines = lineKey ? extraction[lineKey].filter((x) => x !== null && typeof x === "object" && !Array.isArray(x)) : [];
  const docRoles = Object.entries(ruleset.fields).filter(([, f]) => !f.line);
  const lineRoles = Object.entries(ruleset.fields).filter(([, f]) => f.line);
  const lineRoleNames = new Set(lineRoles.map(([r]) => r));
  const boundDoc = /* @__PURE__ */ new Map();
  for (const [role, f] of docRoles) boundDoc.set(role, bindField(extraction, f));
  const boundLines = lines.map((line3) => {
    const m = /* @__PURE__ */ new Map();
    for (const [role, f] of lineRoles) m.set(role, bindField(line3, f));
    return m;
  });
  const sumRole = (role) => {
    if (boundLines.length === 0) return void 0;
    let acc = 0;
    for (const m of boundLines) {
      const b = m.get(role);
      if (!b || b.status !== "ok" || b.value === void 0) return void 0;
      acc += b.value;
    }
    return round4(acc);
  };
  const docVars = {};
  for (const [role, b] of boundDoc) docVars[role] = b.status === "ok" ? b.value : void 0;
  const computedFormula = /* @__PURE__ */ new Map();
  for (const [role, formula] of Object.entries(ruleset.computed ?? {})) {
    computedFormula.set(role, formula);
    docVars[role] = evalExpr(formula, { vars: docVars, sum: sumRole });
  }
  const docEnv = { vars: docVars, sum: sumRole };
  const policy = options.tolerance ?? ruleset.tolerance ?? { rel: 3e-4, absCap: 0 };
  const roundingDefault = options.tolerance?.rounding ?? ruleset.tolerance?.rounding ?? "none";
  const claims = [];
  const inferred = /* @__PURE__ */ new Set();
  const fieldSpec = (r) => Object.prototype.hasOwnProperty.call(ruleset.fields, r) ? ruleset.fields[r] : void 0;
  const guardInsufficiency = (chk, env, scope) => {
    const g = firedGuard(chk, env, scope);
    return g && chk.guard_reason !== void 0 ? { ...g, detail: `${g.detail}. Reason: ${chk.guard_reason}` } : g;
  };
  const firedGuard = (chk, env, scope) => {
    const unless = chk.abstain_unless_all_present ?? [];
    if (unless.length) {
      const bad2 = unless.filter((r) => scope.status(r) === "unparseable");
      if (bad2.length) return { reason: "UNPARSEABLE", detail: `guard abstain_unless_all_present: ${bad2.join(", ")} present but unparseable`, missing: bad2 };
      const absent = unless.filter((r) => scope.status(r) !== "ok");
      if (absent.length) return { reason: "FIELD_MISSING", detail: `guard abstain_unless_all_present: ${absent.join(", ")} not reported`, missing: absent };
    }
    for (const r of chk.abstain_if_present ?? []) {
      const s = scope.status(r);
      if (s === "ok" || s === "unparseable") {
        const w = scope.where(r);
        return { reason: "OUT_OF_RULESET_SCOPE", detail: `guard abstain_if_present: ${r} is reported${w ? ` (${w})` : ""}; the identity does not model it` };
      }
    }
    for (const g of chk.abstain_if_present_without ?? []) {
      const s = scope.status(g.present);
      if ((s === "ok" || s === "unparseable") && scope.status(g.without) !== "ok") {
        const w = scope.where(g.present);
        return { reason: "OUT_OF_RULESET_SCOPE", detail: `guard abstain_if_present_without: ${g.present} is reported${w ? ` (${w})` : ""} without ${g.without}; the identity reads ${g.without} in its place` };
      }
    }
    for (const c of chk.abstain_if ?? []) {
      let l, r;
      try {
        const unp = roleRefs(c.left, c.right).all.filter((x) => scope.status(x) === "unparseable");
        if (unp.length) return { reason: "UNPARSEABLE", detail: `guard abstain_if: ${unp.join(", ")} present but unparseable, so "${c.left} ${c.op} ${c.right}" cannot be evaluated`, missing: unp };
        l = evalExpr(c.left, env);
        r = evalExpr(c.right, env);
      } catch (e) {
        return { reason: "OUT_OF_RULESET_SCOPE", detail: `guard abstain_if: expression error: ${e.message}` };
      }
      if (l === void 0 || r === void 0) continue;
      if (conditionHolds(l, c.op, r, c.tol ?? 0)) return { reason: "OUT_OF_RULESET_SCOPE", detail: `guard abstain_if: ${c.left} ${c.op} ${c.right} holds (${round4(l)} vs ${round4(r)})` };
    }
    return null;
  };
  const runCheck = (chk, env, prefix, gatherEvidence, missingOf, scope) => {
    const claim_id = `${prefix}.${chk.code}`;
    const base = { claim_id, kind: "RECOMPUTE", tier: "DETERMINISTIC", field: chk.field ?? chk.code.toLowerCase(), rule_id: chk.code, rule_name: chk.name ?? chk.code };
    const abstain = (insufficiency) => {
      claims.push({ ...base, outcome: "INSUFFICIENT_DATA", asserted: null, evidence: [], insufficiency, locked: false, explanation: `${chk.code}: ${insufficiency.detail}` });
    };
    if (chk.abstain !== void 0) return abstain(declaredAbstention(chk.abstain));
    const forms = [{ left: chk.left, right: chk.right }, ...chk.alternatives ?? []];
    const multi = forms.length > 1;
    const blockedBy = (refs2) => {
      const m = missingOf(refs2.required);
      if (m) return m;
      for (const o of refs2.optional) if (scope.status(o) === "unparseable") return { reason: "UNPARSEABLE", detail: `optional ${o} is present but could not be parsed as a number`, missing: [o] };
      return null;
    };
    let k = -1;
    let refs = roleRefs(forms[0].left, forms[0].right);
    const blocks = [];
    for (let i = 0; i < forms.length; i++) {
      const r = i === 0 ? refs : roleRefs(forms[i].left, forms[i].right);
      const why = blockedBy(r);
      if (!why) {
        k = i;
        refs = r;
        break;
      }
      blocks.push({ refs: r, why });
    }
    if (k < 0) {
      if (!multi) return abstain(blocks[0].why);
      const unp = blocks.find((b) => b.why.reason === "UNPARSEABLE");
      if (unp) return abstain(unp.why);
      const lacks = blocks.map((b) => b.refs.required.filter((x) => {
        const s = scope.status(x);
        return s !== "ok" && s !== "defaulted";
      }));
      return abstain({ reason: "FIELD_MISSING", detail: `no form of ${chk.code} has all its required operands (${lacks.map((l, i) => `form ${i + 1} lacks ${l.join(", ") || blocks[i].why.detail}`).join("; ")})`, missing: [...new Set(lacks.flat())] });
    }
    const form = forms[k];
    const roles = refs.all;
    if (refs.required.length === 0 && refs.optional.length > 0 && !refs.optional.some((o) => scope.status(o) === "ok")) {
      return abstain({ reason: "FIELD_MISSING", detail: `none of the operands of ${chk.code} is reported (all are optional)`, missing: refs.optional });
    }
    const g = guardInsufficiency(chk, env, scope);
    if (g) return abstain(g);
    let left, right;
    try {
      left = evalExpr(form.left, env);
      right = evalExpr(form.right, env);
    } catch (e) {
      claims.push({ ...base, outcome: "INSUFFICIENT_DATA", asserted: null, evidence: [], insufficiency: { reason: "OUT_OF_RULESET_SCOPE", detail: `expression error: ${e.message}` }, locked: false, explanation: `${chk.code}: bad expression` });
      return;
    }
    if (left === void 0 || right === void 0) {
      claims.push({ ...base, outcome: "INSUFFICIENT_DATA", asserted: null, evidence: [], insufficiency: { reason: "FIELD_MISSING", detail: `a value needed by ${chk.code} was absent`, missing: roles }, locked: false, explanation: `${chk.code}: operand absent` });
      return;
    }
    const infer = (chk.rounding ?? roundingDefault) === "infer";
    const rt = infer ? roundingTolerance(scope.amounts(roles), policy.rel, policy.absCap, chk.tol ?? 0.01) : void 0;
    const tol = rt ? rt.tol : chk.tol ?? 0.01;
    let passed;
    if (chk.op === "=") passed = Math.abs(left - right) <= tol;
    else if (chk.op === "<=") passed = left <= right + tol;
    else if (chk.op === ">=") passed = left >= right - tol;
    else passed = Math.abs(left - right) > tol;
    const evidence = gatherEvidence(roles);
    const absentOptional = refs.optional.filter((o) => scope.status(o) !== "ok");
    const notes = [
      ...multi ? [`Form ${k + 1} of ${forms.length}.`] : [],
      ...absentOptional.length ? [`Optional terms not reported (counted as 0): ${absentOptional.join(", ")}.`] : [],
      ...rt ? [`Rounding-aware tolerance ${round4(rt.tol)} = max(${round4(policy.rel * 100)}% of the largest operand ${round4(rt.maxAbs)}, unit ${rt.unit ?? "none"} \xD7 ${rt.n} operands${policy.absCap > 0 ? `; relative term capped at ${policy.absCap}` : ""}, floor ${chk.tol ?? 0.01})${passed && left !== right && chk.op === "=" ? ": the difference is treated as rounding, not error" : ""}.`] : []
    ];
    const claim = {
      ...base,
      outcome: passed ? "PASS" : "FAIL",
      asserted: round4(left),
      computation: { formula: `${form.left} ${chk.op} ${form.right}`, operands: { left: round4(left), right: round4(right) }, result: round4(right), tolerance: rt ? { abs: round4(rt.tol), rel: policy.rel } : { abs: tol } },
      evidence,
      locked: !passed,
      explanation: `${chk.field ?? chk.code}: ${round4(left)} ${chk.op} ${round4(right)} \u2014 ${passed ? "holds" : "does not hold"}.${notes.length ? ` ${notes.join(" ")}` : ""}`,
      ...passed ? {} : { variance: round4(left - right) }
    };
    claims.push(claim);
    if (rt) inferred.add(claim);
  };
  const runIdentifierCheck = (chk, prefix, scope, lookup, env, info) => {
    const base = { claim_id: `${prefix}.${chk.code}`, kind: "CROSS_REFERENCE", tier: "DETERMINISTIC", field: chk.field ?? chk.code.toLowerCase(), rule_id: chk.code, rule_name: chk.name ?? chk.code };
    const abstain = (insufficiency) => {
      claims.push({ ...base, outcome: "INSUFFICIENT_DATA", asserted: null, evidence: [], insufficiency, locked: false, explanation: `${chk.code}: ${insufficiency.detail}` });
    };
    if (chk.abstain !== void 0) return abstain(declaredAbstention(chk.abstain));
    const L = String(chk.left ?? "").trim(), R = String(chk.right ?? "").trim();
    if (chk.op !== "=" && chk.op !== "!=") return abstain({ reason: "OUT_OF_RULESET_SCOPE", detail: `identifier checks support only = and != (got ${chk.op})` });
    if (chk.alternatives !== void 0 || chk.rounding !== void 0) return abstain({ reason: "OUT_OF_RULESET_SCOPE", detail: "alternatives and rounding apply to numeric checks only, not to an identifier check" });
    for (const r of [L, R]) {
      const f = Object.prototype.hasOwnProperty.call(ruleset.fields, r) ? ruleset.fields[r] : void 0;
      if (!f || f.kind !== "identifier" || !!f.line !== (scope === "line")) return abstain({ reason: "OUT_OF_RULESET_SCOPE", detail: `"${r}" is not a ${scope}-level 'identifier' field (an identifier check names two identifier fields)` });
    }
    const bl = lookup(L), br = lookup(R);
    for (const [r, b] of [[L, bl], [R, br]]) if (b?.status === "unparseable") return abstain({ reason: "UNPARSEABLE", detail: `${r} is present but is not an identifier or a list of identifiers`, missing: [r] });
    for (const [r, b] of [[L, bl], [R, br]]) if (!b || b.status !== "ok" || !b.ids) return abstain({ reason: "FIELD_MISSING", detail: `${r} not present`, missing: [r] });
    const g = guardInsufficiency(chk, env, info);
    if (g) return abstain(g);
    const li = bl.ids, ri = br.ids;
    const same = li.length === ri.length && li.every((x) => ri.includes(x));
    const passed = chk.op === "=" ? same : !same;
    const show = (ids) => ids.length === 1 ? ids[0] : `{${ids.join(", ")}}`;
    const asValue = (ids) => ids.length === 1 ? ids[0] : ids;
    claims.push({
      ...base,
      outcome: passed ? "PASS" : "FAIL",
      asserted: asValue(li),
      computation: { formula: `${L} ${chk.op} ${R} (identifier sets; whitespace removed, upper-cased)`, operands: { [L]: li, [R]: ri }, result: asValue(ri) },
      evidence: [fieldEvidence(L, bl), fieldEvidence(R, br)].filter((e) => e !== null),
      locked: !passed,
      explanation: `${chk.field ?? chk.code}: ${show(li)} ${chk.op} ${show(ri)} \u2014 ${passed ? "holds" : "does not hold"}.`
    });
  };
  const docMissing = (roles) => {
    for (const r of roles) {
      const b = boundDoc.get(r);
      if (b && b.status === "unparseable") return { reason: "UNPARSEABLE", detail: `${r} is present but could not be parsed as a number`, missing: [r] };
    }
    for (const r of roles) {
      if (!lineRoleNames.has(r)) continue;
      for (let i = 0; i < boundLines.length; i++) {
        const b = boundLines[i].get(r);
        if (b?.status === "unparseable") return { reason: "UNPARSEABLE", detail: `${r} present but unparseable on line ${i}`, missing: [r] };
      }
    }
    for (const r of roles) {
      if (computedFormula.has(r)) {
        if (docVars[r] === void 0) return { reason: "FIELD_MISSING", detail: `computed ${r} could not be produced (an operand was absent)`, missing: [r] };
        continue;
      }
      if (lineRoleNames.has(r)) {
        if (sumRole(r) === void 0) return { reason: "FIELD_MISSING", detail: `${r} absent on one or more lines`, missing: [r] };
        continue;
      }
      const b = boundDoc.get(r);
      if (!b || b.status === "missing") return { reason: "FIELD_MISSING", detail: `${r} not present on the document`, missing: [r] };
    }
    return null;
  };
  const docEvidence = (roles) => {
    const out = [];
    const seen = /* @__PURE__ */ new Set();
    const add = (e) => {
      if (e) {
        const k = evidenceKey2(e);
        if (!seen.has(k)) {
          seen.add(k);
          out.push(e);
        }
      }
    };
    for (const r of roles) {
      if (boundDoc.has(r)) add(fieldEvidence(r, boundDoc.get(r)));
      else if (computedFormula.has(r) && docVars[r] !== void 0) add({ locator: { kind: "field", source: "computed", path: computedFormula.get(r) }, value: round4(docVars[r]), confidence: 100, role: "CONTEXT" });
      for (const m of boundLines) if (m.has(r)) add(fieldEvidence(r, m.get(r)));
    }
    return out;
  };
  const docScope = {
    status: (r) => {
      if (boundDoc.has(r)) return statusOf(boundDoc.get(r));
      if (computedFormula.has(r)) return docVars[r] === void 0 ? "missing" : "ok";
      if (lineRoleNames.has(r)) {
        for (const m of boundLines) if (m.get(r)?.status === "unparseable") return "unparseable";
        return sumRole(r) === void 0 ? "missing" : "ok";
      }
      return "missing";
    },
    where: (r) => boundDoc.get(r)?.path ?? computedFormula.get(r),
    amounts: (roles) => {
      const out = [];
      const seen = /* @__PURE__ */ new Set();
      const walk2 = (r) => {
        if (seen.has(r)) return;
        seen.add(r);
        const f = fieldSpec(r);
        if (f && !f.line) {
          const b = boundDoc.get(r);
          if (isAmountField(f) && b?.status === "ok" && b.value !== void 0 && !isDefaulted(b)) out.push(b.value);
          return;
        }
        if (f && f.line) {
          if (isAmountField(f)) for (const m of boundLines) {
            const b = m.get(r);
            if (b?.status === "ok" && b.value !== void 0 && !isDefaulted(b)) out.push(b.value);
          }
          return;
        }
        const formula = computedFormula.get(r);
        if (formula !== void 0 && docVars[r] !== void 0) for (const x of referencedRoles(formula)) walk2(x);
      };
      for (const r of roles) walk2(r);
      return out;
    }
  };
  const lineScope = (m) => ({
    status: (r) => statusOf(m.get(r)),
    where: (r) => m.get(r)?.path,
    amounts: (roles) => roles.flatMap((r) => {
      const b = m.get(r);
      return isAmountField(fieldSpec(r)) && b?.status === "ok" && b.value !== void 0 && !isDefaulted(b) ? [b.value] : [];
    })
  });
  for (const chk of ruleset.checks.filter((c) => (c.scope ?? "document") === "document")) {
    if (chk.compare === "identifier") runIdentifierCheck(chk, "document", "document", (r) => boundDoc.get(r), docEnv, docScope);
    else runCheck(chk, docEnv, "document", docEvidence, docMissing, docScope);
  }
  ruleset.checks.filter((c) => c.scope === "line").forEach((chk) => {
    boundLines.forEach((m, i) => {
      const lineVars = {};
      for (const [role, b] of m) lineVars[role] = b.status === "ok" ? b.value : void 0;
      const env = { vars: lineVars, sum: () => void 0 };
      if (chk.compare === "identifier") {
        runIdentifierCheck(chk, `line[${i}]`, "line", (r) => m.get(r), env, lineScope(m));
        return;
      }
      const missing = (roles) => {
        for (const r of roles) {
          const b = m.get(r);
          if (b?.status === "unparseable") return { reason: "UNPARSEABLE", detail: `${r} present but unparseable on line ${i}`, missing: [r] };
        }
        for (const r of roles) {
          const b = m.get(r);
          if (!b || b.status === "missing") return { reason: "FIELD_MISSING", detail: `${r} not present on line ${i}`, missing: [r] };
        }
        return null;
      };
      const ev = (roles) => {
        const out = [];
        for (const r of roles) {
          const e = fieldEvidence(r, m.get(r) ?? { status: "missing", confidence: 0 });
          if (e) out.push(e);
        }
        return out;
      };
      runCheck(chk, env, `line[${i}]`, ev, missing, lineScope(m));
    });
  });
  applyTolerancePolicy(inferred.size ? claims.filter((c) => !inferred.has(c)) : claims, policy);
  let pass = 0, fail = 0, ins = 0;
  for (const c of claims) c.outcome === "PASS" ? pass++ : c.outcome === "FAIL" ? fail++ : ins++;
  const coverage = { claims_total: claims.length, claims_checked: pass + fail, claims_pass: pass, claims_fail: fail, claims_insufficient: ins };
  const outcome = fail > 0 ? "FAIL" : pass + fail === 0 ? "INSUFFICIENT_DATA" : "PASS";
  const input_hash = hashOf({ extraction, ruleset, ...options.tolerance ? { tolerance: toleranceIdentity(options.tolerance) } : {} });
  const verdict_id = sha256(`${input_hash}:${ruleset.id}@${ruleset.version}:${ENGINE_VERSION}`).slice(0, 32);
  const issued_at = (options.now ?? (() => /* @__PURE__ */ new Date()))().toISOString();
  const verdict = {
    schema_version: SCHEMA_VERSION,
    verdict_id,
    issued_at,
    engine_version: ENGINE_VERSION,
    ruleset: { id: ruleset.id, version: ruleset.version, domain: ruleset.domain ?? ruleset.id },
    input_hash,
    replayable: true,
    document: { extraction_hash: hashOf(extraction), ...options.producer !== void 0 ? { producer: options.producer } : {}, line_items: lines.length },
    references: { contract: false, evidence: 0, history: 0, source: false },
    outcome,
    aggregation: "ANY_FAIL_FAILS",
    claims,
    coverage
  };
  return options.declared_accuracy ? attachDeclaredAccuracy(verdict, options.declared_accuracy) : verdict;
}

// packages/verify/src/declarative/types.ts
function isDeclarativeRuleset(x) {
  return !!x && typeof x === "object" && !("compute" in x) && typeof x.fields === "object" && Array.isArray(x.checks);
}

// packages/verify/src/protocol/input.ts
var InputRefused = class extends TypeError {
  input;
  constructor(input, message2) {
    super(message2);
    this.name = "InputRefused";
    this.input = input;
  }
};
function extractionProblem(x) {
  if (x === null) return "the extraction is null: there is no document to verify (pass the extracted fields as a JSON object)";
  if (x === void 0) return "the extraction is missing (undefined): there is no document to verify (pass the extracted fields as a JSON object)";
  const t = typeof x;
  if (t === "function" || t === "symbol" || t === "bigint") {
    return `the extraction is a ${t}, not JSON data: it has no canonical form a verdict could be bound to (pass the extracted fields as a JSON object)`;
  }
  return void 0;
}
function assertExtraction(x) {
  const problem = extractionProblem(x);
  if (problem) throw new InputRefused("extraction", `verify: ${problem}`);
}

// packages/verify/src/textmatch/normalize.ts
var QUOTE_MAP = {
  "\u2018": "'",
  "\u2019": "'",
  "\u201A": "'",
  "\u201B": "'",
  "\u201C": '"',
  "\u201D": '"',
  "\u201E": '"',
  "\u201F": '"',
  "\xAB": '"',
  "\xBB": '"',
  "\u2039": "'",
  "\u203A": "'",
  "`": "'",
  "\xB4": "'"
};
var DASHES = /* @__PURE__ */ new Set(["\u2010", "\u2011", "\u2012", "\u2013", "\u2014", "\u2015", "\u2212"]);
function isSpace(c) {
  return c === " " || c === "	" || c === "\n" || c === "\r" || c === "\f" || c === "\v" || c === "\xA0";
}
function isHyphenOrDash(c) {
  return c === "-" || DASHES.has(c);
}
function normalizeMapped(src, profile) {
  const out = [];
  const map = [];
  const n = src.length;
  const push2 = (ch, srcOffset) => {
    for (let k = 0; k < ch.length; k++) {
      out.push(ch[k]);
      map.push(srcOffset);
    }
  };
  let i = 0;
  while (i < n) {
    const c = src[i];
    if (isHyphenOrDash(c)) {
      let k = i + 1;
      while (k < n && (src[k] === " " || src[k] === "	")) k++;
      if (k < n && (src[k] === "\n" || src[k] === "\r")) {
        i = k;
        while (i < n && isSpace(src[i])) i++;
        continue;
      }
      push2("-", i);
      i++;
      continue;
    }
    if (isSpace(c)) {
      const start = i;
      while (i < n && isSpace(src[i])) i++;
      push2(" ", start);
      continue;
    }
    if (c === "\u2026") {
      push2("...", i);
      i++;
      continue;
    }
    const q = QUOTE_MAP[c];
    if (q !== void 0) {
      push2(q, i);
      i++;
      continue;
    }
    push2(profile === "legal" ? c.toLowerCase() : c, i);
    i++;
  }
  return { text: out.join(""), map, original: src };
}
function toOriginalSpan(m, normStart, normEnd) {
  if (m.text.length === 0) return { start: 0, end: 0 };
  const s = Math.max(0, Math.min(normStart, m.text.length - 1));
  const e = Math.max(s, Math.min(normEnd - 1, m.text.length - 1));
  const start = m.map[s];
  const lastOrig = m.map[e];
  return { start, end: lastOrig + 1 };
}
function numberSurfaceForms(value) {
  if (!Number.isFinite(value)) return [];
  const abs = Math.abs(value);
  const forms = /* @__PURE__ */ new Set();
  const two = abs.toFixed(2);
  const [ip, fp] = two.split(".");
  const grouped = Number(ip).toLocaleString("en-US");
  forms.add(two);
  forms.add(`${grouped}.${fp}`);
  const plain = String(abs);
  forms.add(plain);
  if (Number.isInteger(abs)) {
    forms.add(grouped);
    forms.add(ip);
  } else {
    const [pp, pf] = plain.split(".");
    forms.add(`${Number(pp).toLocaleString("en-US")}.${pf}`);
  }
  return [...forms].filter((s) => s.length > 0);
}

// packages/verify/src/textmatch/matcher.ts
var WORD_RE = /[^\s]+/g;
var MIN_ANCHOR_WORDS = 3;
function edgeIsNumberPart(text, idx, dir) {
  const c = text[idx];
  if (c === void 0) return false;
  if (c >= "0" && c <= "9") return true;
  if (c === "." || c === ",") {
    const beyond = text[idx + dir];
    return beyond !== void 0 && beyond >= "0" && beyond <= "9";
  }
  return false;
}
function prepareSource(source) {
  return { legal: normalizeMapped(source, "legal"), value: normalizeMapped(source, "value"), raw: source };
}
function words(s) {
  return s.match(WORD_RE) ?? [];
}
function matchQuote(prepared, quote) {
  const src = prepared.legal;
  const qn = normalizeMapped(quote, "legal").text.trim();
  if (qn.length === 0) return { found: false, reason: "not_located" };
  const idx = src.text.indexOf(qn);
  if (idx >= 0) {
    const span = toOriginalSpan(src, idx, idx + qn.length);
    return { found: true, span, matchedText: prepared.raw.slice(span.start, span.end), reason: "verbatim" };
  }
  const qWords = words(qn);
  let bestLen = 0;
  let bestPos = -1;
  let bestChars = 0;
  for (let i = 0; i < qWords.length; i++) {
    let phrase = qWords[i];
    let pos = src.text.indexOf(phrase);
    if (pos < 0) continue;
    let j = i;
    while (j + 1 < qWords.length) {
      const trial = `${phrase} ${qWords[j + 1]}`;
      const tpos = src.text.indexOf(trial);
      if (tpos < 0) break;
      phrase = trial;
      pos = tpos;
      j++;
    }
    const len = j - i + 1;
    if (len > bestLen) {
      bestLen = len;
      bestPos = pos;
      bestChars = phrase.length;
    }
  }
  if (bestLen >= MIN_ANCHOR_WORDS && bestPos >= 0) {
    const margin = Math.max(qn.length, 40);
    let ws2 = Math.max(0, bestPos - margin);
    let we = Math.min(src.text.length, bestPos + bestChars + margin);
    while (ws2 > 0 && src.text[ws2 - 1] !== " ") ws2--;
    while (we < src.text.length && src.text[we] !== " ") we++;
    const span = toOriginalSpan(src, ws2, we);
    return {
      found: false,
      nearest: { span, text: prepared.raw.slice(span.start, span.end) },
      reason: "misquote_nearest"
    };
  }
  return { found: false, reason: "not_located" };
}
function matchValue(prepared, value) {
  const src = prepared.value;
  for (const form of numberSurfaceForms(value)) {
    let from = 0;
    for (; ; ) {
      const p = src.text.indexOf(form, from);
      if (p < 0) break;
      if (!edgeIsNumberPart(src.text, p - 1, -1) && !edgeIsNumberPart(src.text, p + form.length, 1)) {
        const span = toOriginalSpan(src, p, p + form.length);
        return { found: true, span, matchedText: prepared.raw.slice(span.start, span.end), form };
      }
      from = p + 1;
    }
  }
  return { found: false };
}

// packages/verify/src/textmatch/index.ts
function spanEvidence(sourceHash, span, text, page) {
  const e = {
    locator: { kind: "span", source_hash: sourceHash, start: span.start, end: span.end, ...page !== void 0 ? { page } : {} },
    value: text,
    confidence: 100,
    role: "QUOTE"
  };
  return e;
}
function verifyQuote(a, prepared, sourceHash) {
  const r = matchQuote(prepared, a.quote);
  const base = {
    claim_id: a.id,
    kind: "QUOTE_MATCH",
    tier: "DETERMINISTIC",
    field: a.label ?? "quote",
    asserted: a.quote,
    rule_id: "QUOTE_MATCH",
    rule_name: "Verbatim quotation"
  };
  if (r.found && r.span) {
    return {
      ...base,
      outcome: "PASS",
      locked: true,
      evidence: [spanEvidence(sourceHash, r.span, r.matchedText ?? "")],
      explanation: `The quoted passage appears verbatim in the source at [${r.span.start}, ${r.span.end}).`
    };
  }
  if (r.reason === "misquote_nearest" && r.nearest) {
    return {
      ...base,
      outcome: "FAIL",
      locked: true,
      computation: { formula: "quoted = source[cited span]", operands: { quoted: a.quote, source_says: r.nearest.text }, result: r.nearest.text },
      evidence: [spanEvidence(sourceHash, r.nearest.span, r.nearest.text)],
      explanation: `The citation points at real text, but the quotation is not verbatim. The source reads: "${r.nearest.text}".`
    };
  }
  return {
    ...base,
    outcome: "INSUFFICIENT_DATA",
    locked: false,
    evidence: [],
    insufficiency: { reason: "SPAN_NOT_FOUND", detail: "The quoted passage was not located in the supplied source text; it may be quoted from a different source, or the source text may be incomplete (e.g. scanned/OCR gaps)." },
    explanation: "Could not locate the quoted passage in the source; abstaining rather than asserting a negative."
  };
}
function verifyValueInText(a, prepared, sourceHash) {
  const r = matchValue(prepared, a.value);
  const base = {
    claim_id: a.id,
    kind: "QUOTE_MATCH",
    tier: "DETERMINISTIC",
    field: a.field,
    asserted: a.value,
    rule_id: "VALUE_IN_SOURCE",
    rule_name: "Extracted value present in source"
  };
  if (r.found && r.span) {
    return {
      ...base,
      outcome: "PASS",
      locked: false,
      evidence: [spanEvidence(sourceHash, r.span, r.matchedText ?? "")],
      explanation: `The extracted ${a.field} (${a.value}) appears in the source as "${r.matchedText}" (presence only \u2014 not proof it is the correct field).`
    };
  }
  return {
    ...base,
    outcome: "INSUFFICIENT_DATA",
    locked: false,
    evidence: [],
    insufficiency: { reason: "SPAN_NOT_FOUND", detail: `The extracted ${a.field} (${a.value}) was not found in the supplied source text; the value may be computed, formatted differently, or extracted from a region not included.` },
    explanation: `Could not locate ${a.field} in the source; abstaining.`
  };
}
function verifyAgainstSource(sourceText, quotes = [], values = []) {
  const source_hash = sha256(sourceText);
  const prepared = prepareSource(sourceText);
  const claims = [
    ...quotes.map((q) => verifyQuote(q, prepared, source_hash)),
    ...values.map((v) => verifyValueInText(v, prepared, source_hash))
  ];
  return { source_hash, claims };
}

// packages/verify/src/verify.ts
var initialized = /* @__PURE__ */ new Set();
function init(rs) {
  if (initialized.has(rs.id)) return;
  getOntologicalBridge().registerOntology(rs.ontology);
  const registry = getAxiomRegistry();
  for (const a of rs.axioms) registry.register(a);
  setGavelLogger(void 0);
  setBridgeLogger(void 0);
  initialized.add(rs.id);
}
var isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
function verify(extraction, options = {}) {
  assertExtraction(extraction);
  if (isDeclarativeRuleset(options.ruleset)) {
    return verifyDeclarative(extraction, options.ruleset, {
      ...options.now ? { now: options.now } : {},
      ...options.producer !== void 0 ? { producer: options.producer } : {},
      ...options.tolerance ? { tolerance: options.tolerance } : {}
    });
  }
  const rs = resolveRuleset(options.ruleset);
  init(rs);
  const bridge = getOntologicalBridge();
  const registry = getAxiomRegistry();
  const gavel = getValidationGavel();
  const contractGiven = isObj(options.references?.contract);
  const contract = contractGiven ? options.references?.contract : {};
  const rawEvidence = options.references?.evidence;
  const evidence = (Array.isArray(rawEvidence) ? rawEvidence : []).filter(isObj);
  const rawHistory = options.references?.history;
  const history = (Array.isArray(rawHistory) ? rawHistory : []).filter(isObj);
  const refs = { contract: contractGiven, evidence: evidence.length > 0, history: history.length > 0 };
  const sourceGiven = typeof options.source?.text === "string" && options.source.text.length > 0;
  const input_hash = hashOf({
    extraction,
    references: { contract: options.references?.contract ?? null, evidence: rawEvidence ?? [], history: rawHistory ?? [] },
    source: options.source ?? null,
    // A tolerance override can change the outcome, so the input it is bound to includes it; absent, the ruleset's own policy
    // is named by its version (D-TOL-ID).
    ...options.tolerance ? { tolerance: toleranceIdentity(options.tolerance) } : {}
  });
  const extraction_hash = hashOf(extraction);
  const axiomsFor = (codes) => codes.map((c) => registry.getByCode(c)).filter((a) => a !== void 0);
  const lineAxioms = axiomsFor(rs.lineCodes);
  const docAxioms = axiomsFor(rs.documentCodes);
  const lineKeys = rs.ontology.lineArrayKeys ?? ["line_items"];
  const lineKey = lineKeys.find((k) => Array.isArray(extraction[k]));
  const lineCount2 = lineKey !== void 0 ? extraction[lineKey].length : 0;
  const lineCtxs = lineCount2 > 0 ? bridge.createLineItemBindings(rs.domain, extraction, contract, evidence) : [];
  const docCtx = bridge.createBindings(rs.domain, extraction, contract, evidence, void 0);
  const { docAbsence, lineAbsence, attach, claims: rulesetClaims } = rs.compute({
    extraction,
    references: { contract: contractGiven ? contract : null, evidence, history },
    docCtx,
    lineCtxs
  });
  const common = { registry, refs, kindByCode: rs.kindByCode, fieldByCode: rs.fieldByCode, referenceRoles: rs.referenceRoles };
  const claims = [];
  const docResults = docAxioms.map((a) => gavel.validateAxiom(a, docCtx));
  claims.push(...toClaimVerdicts(docResults, docCtx, { ...common, claimPrefix: "document", absence: docAbsence }));
  lineCtxs.forEach((ctx, i) => {
    const results = lineAxioms.map((a) => gavel.validateAxiom(a, ctx));
    claims.push(...toClaimVerdicts(results, ctx, { ...common, claimPrefix: `line[${i}]`, absence: lineAbsence[i] ?? {} }));
  });
  if (rulesetClaims) claims.push(...rulesetClaims);
  const claimById = indexClaims(claims);
  for (const [claimId, extra] of Object.entries(attach)) attachEvidence(claimById.get(claimId), extra);
  const policy = options.tolerance ?? rs.defaultTolerance ?? { rel: 0, absCap: 0 };
  applyTolerancePolicy(claims, policy);
  abstainOnGuessedOperands(claims);
  abstainOnAmbiguousReference(rs, claims, lineCtxs, contract, contractGiven);
  if (sourceGiven) {
    const text = options.source.text;
    const prepared = prepareSource(text);
    const sourceHash = sha256(text);
    const idOf = (raw) => raw.startsWith("source.") ? raw : `source.${raw}`;
    for (const q of options.source.quotes ?? []) claims.push(verifyQuote({ ...q, id: idOf(q.id) }, prepared, sourceHash));
    for (const v of options.source.values ?? []) claims.push(verifyValueInText({ ...v, id: idOf(v.id) }, prepared, sourceHash));
  }
  const coverage = coverageOf(claims);
  const outcome = coverage.claims_fail > 0 ? "FAIL" : coverage.claims_checked === 0 ? "INSUFFICIENT_DATA" : "PASS";
  const verdict_id = sha256(`${input_hash}:${rs.id}@${rs.version}:${ENGINE_VERSION}`).slice(0, 32);
  const issued_at = (options.now ?? (() => /* @__PURE__ */ new Date()))().toISOString();
  return {
    schema_version: SCHEMA_VERSION,
    verdict_id,
    issued_at,
    engine_version: ENGINE_VERSION,
    ruleset: { id: rs.id, version: rs.version, domain: rs.domain },
    input_hash,
    replayable: true,
    document: {
      extraction_hash,
      ...options.producer !== void 0 ? { producer: options.producer } : {},
      line_items: lineCount2
    },
    references: { contract: refs.contract, evidence: evidence.length, history: history.length, source: sourceGiven },
    outcome,
    aggregation: "ANY_FAIL_FAILS",
    claims,
    coverage
  };
}
function verifyBatch(items, shared = {}) {
  const summary = { PASS: 0, FAIL: 0, INSUFFICIENT_DATA: 0 };
  const results = [];
  for (const it of items) {
    const v = verify(it.extraction, { ...it.options ?? {}, ...shared.now ? { now: shared.now } : {} });
    summary[v.outcome]++;
    results.push(v);
  }
  return { count: items.length, summary, results };
}
function referenceMultiplicity(contract, role, ruleset = INVOICE_RULESET) {
  const roots = /* @__PURE__ */ new Set();
  for (const m of ruleset.ontology.mappings) {
    if (m.role !== role || m.documentType !== "contract") continue;
    for (const p of [m.fieldPath, ...m.alternativePaths ?? []]) {
      const i = p.indexOf("[*]");
      if (i > 0) roots.add(p.slice(0, i));
    }
  }
  let max = 0;
  for (const root2 of roots) {
    if (root2.includes(".")) continue;
    const v = contract[root2];
    if (Array.isArray(v)) max = Math.max(max, v.filter((x) => x !== null && x !== void 0).length);
  }
  return max;
}
function abstainOnAmbiguousReference(rs, claims, lineCtxs, contract, contractGiven) {
  if (!contractGiven) return;
  const claimById = indexClaims(claims);
  for (const [code2, role] of rs.ambiguityGuards) {
    const n = referenceMultiplicity(contract, role, rs);
    if (n <= 1) continue;
    lineCtxs.forEach((ctx, i) => {
      if (ctx.correlationInfo?.contract?.isReliable === true) return;
      const c = claimById.get(`line[${i}].${code2}`);
      if (!c || c.outcome === "INSUFFICIENT_DATA") return;
      c.outcome = "INSUFFICIENT_DATA";
      c.locked = false;
      delete c.computation;
      delete c.variance;
      c.insufficiency = {
        reason: "AMBIGUOUS_REFERENCE",
        detail: `the contract lists ${n} candidate values for ${role} and no rule could be matched to this line; supply financial_rules[] with a rule_name/description matching the line description, or a single-valued reference`,
        missing: [role]
      };
      c.explanation = `Abstained: ${c.explanation}`;
    });
  }
}
function indexClaims(claims) {
  const byId2 = /* @__PURE__ */ new Map();
  for (const c of claims) if (!byId2.has(c.claim_id)) byId2.set(c.claim_id, c);
  return byId2;
}
function attachEvidence(claim, extra) {
  if (!claim) return;
  const seen = new Set(claim.evidence.map(evidenceKey));
  for (const e of extra) {
    const k = evidenceKey(e);
    if (seen.has(k)) continue;
    seen.add(k);
    claim.evidence.push(e);
  }
}
function coverageOf(claims) {
  let pass = 0, fail = 0, insufficient = 0;
  for (const c of claims) {
    if (c.outcome === "PASS") pass++;
    else if (c.outcome === "FAIL") fail++;
    else insufficient++;
  }
  return {
    claims_total: claims.length,
    claims_checked: pass + fail,
    claims_pass: pass,
    claims_fail: fail,
    claims_insufficient: insufficient
  };
}

// packages/verify/src/action/index.ts
var ACTION_RULESET = { id: "action", version: "0.0.1", domain: "action" };
var ACTION_RECORDS_RULESET = { id: "action", version: "0.1.0", domain: "action" };
var isScalar = (x) => typeof x === "string" || typeof x === "number" || typeof x === "boolean";
var looksNumeric = (v) => typeof v === "number" || typeof v === "string" && /^-?[\d.,\s$]+$/.test(v) && /\d/.test(v);
function allowlistEvidence(path, value) {
  return { locator: { kind: "field", source: "contract", path: `allowed.${path}` }, value, confidence: 100, role: "REFERENCE" };
}
function spanEvidence2(sourceHash, span, text) {
  return { locator: { kind: "span", source_hash: sourceHash, start: span.start, end: span.end }, value: text, confidence: 100, role: "QUOTE" };
}
function groundArgument(path, value, sources, prepared, sourceHash) {
  const base = { claim_id: `arg.${path}`, tier: "DETERMINISTIC", field: path, asserted: value };
  const allowed = sources.allowed?.[path];
  if (allowed !== void 0) {
    const ok2 = allowed.some((a) => String(a) === String(value));
    return ok2 ? {
      ...base,
      kind: "CROSS_REFERENCE",
      outcome: "PASS",
      rule_id: "GROUNDED",
      rule_name: "Value grounded in an approved set",
      computation: { formula: "value \u2208 allowed", operands: { value }, result: true },
      evidence: [allowlistEvidence(path, value)],
      locked: true,
      explanation: `"${value}" is one of the ${allowed.length} approved values for ${path}.`
    } : {
      ...base,
      kind: "CROSS_REFERENCE",
      outcome: "FAIL",
      rule_id: "GROUNDED",
      rule_name: "Value grounded in an approved set",
      computation: { formula: "value \u2208 allowed", operands: { value, approved: allowed.length }, result: false },
      evidence: [allowlistEvidence(path, value)],
      locked: true,
      explanation: `"${value}" is NOT in the approved set for ${path}. The agent proposed a value with no approved source \u2014 do not execute.`
    };
  }
  if (prepared && sourceHash) {
    if (looksNumeric(value)) {
      return {
        ...base,
        kind: "CROSS_REFERENCE",
        outcome: "INSUFFICIENT_DATA",
        rule_id: "GROUNDED",
        rule_name: "Value grounded in an approved source",
        evidence: [],
        insufficiency: { reason: "REFERENCE_NOT_PROVIDED", detail: `${path} = ${JSON.stringify(value)}: a bare number found in free source text does not establish it as this argument's value (it can match a year, quantity, part or account number, or an opposite sign). Supply an allow-list of approved values, or a labelled source field, to ground a numeric action value.` },
        locked: false,
        explanation: `Numeric value ${path} cannot be grounded by free-text presence alone; provenance unconfirmed.`
      };
    }
    const sval = String(value);
    if (sval.trim().length >= 3) {
      const r = matchQuote(prepared, sval);
      if (r.found && r.span) return {
        ...base,
        kind: "QUOTE_MATCH",
        outcome: "PASS",
        rule_id: "GROUNDED",
        rule_name: "Value grounded in the source document",
        computation: { formula: "value \u2208 source", operands: { value }, result: true },
        evidence: [spanEvidence2(sourceHash, r.span, r.matchedText ?? "")],
        locked: true,
        explanation: `${path} = "${value}" appears verbatim in the source the agent read.`
      };
    }
    return {
      ...base,
      kind: "QUOTE_MATCH",
      outcome: "INSUFFICIENT_DATA",
      rule_id: "GROUNDED",
      rule_name: "Value grounded in the source document",
      evidence: [],
      insufficiency: { reason: "SPAN_NOT_FOUND", detail: `${path} = ${JSON.stringify(value)} was not found verbatim in the supplied source. Not confirmed grounded \u2014 do not execute on this alone.` },
      locked: false,
      explanation: `Could not ground ${path} in the source; provenance unconfirmed.`
    };
  }
  return {
    ...base,
    kind: "CROSS_REFERENCE",
    outcome: "INSUFFICIENT_DATA",
    rule_id: "GROUNDED",
    rule_name: "Value grounded in an approved source",
    evidence: [],
    insufficiency: { reason: "REFERENCE_NOT_PROVIDED", detail: `no allow-list and no source were declared for ${path}, so its provenance cannot be checked. Supply allowed values or the source document the value must come from.` },
    locked: false,
    explanation: `No source declared for ${path}; provenance unverifiable.`
  };
}
var hasField = (r, k) => Object.prototype.hasOwnProperty.call(r, k);
function recordNamed(records) {
  const out = [];
  for (const r of records) for (const k of Object.keys(r)) if (!out.includes(k)) out.push(k);
  return out;
}
function groundRecords(args, records, required) {
  const rule = { kind: "CROSS_REFERENCE", tier: "DETERMINISTIC", rule_id: "GROUNDED_RECORD", rule_name: "Values grounded together in one approved record" };
  const out = /* @__PURE__ */ new Map();
  const recordRef = (i, k, value) => ({ locator: { kind: "field", source: "contract", path: `records[${i}].${k}` }, value, confidence: 100, role: "REFERENCE" });
  if (records.length === 0) {
    for (const k of required) {
      const v = isScalar(args[k]) ? args[k] : null;
      out.set(k, {
        ...rule,
        claim_id: `arg.${k}`,
        field: k,
        asserted: v,
        outcome: "FAIL",
        computation: { formula: "values \u2208 one approved record", operands: { value: v, records: 0 }, result: false },
        evidence: [{ locator: { kind: "field", source: "contract", path: "records" }, value: v, confidence: 100, role: "REFERENCE" }],
        locked: true,
        explanation: `The approved records are empty, so nothing is approved: ${k} = ${JSON.stringify(args[k] ?? null)} has no approved record. Do not execute.`
      });
    }
    return out;
  }
  const named = recordNamed(records);
  const present = named.filter((k) => isScalar(args[k]));
  const missing = named.filter((k) => !isScalar(args[k]));
  const agrees = (r, k) => hasField(r, k) && String(r[k]) === String(args[k]);
  const consistent = records.map((_, i) => i).filter((i) => present.every((k) => agrees(records[i], k)));
  const given = present.map((k) => `${k} = ${JSON.stringify(args[k])}`).join(", ");
  const partial = `the approved records bind ${named.join(", ")} together, and the action does not supply ${missing.join(", ")} as a value; a record is never grounded piecewise, so no record-named argument is grounded. Supply every record-named argument, or declare records that name only this tool's arguments.`;
  const abstain = (k) => ({
    ...rule,
    claim_id: `arg.${k}`,
    field: k,
    asserted: isScalar(args[k]) ? args[k] : null,
    outcome: "INSUFFICIENT_DATA",
    evidence: [],
    insufficiency: { reason: "FIELD_MISSING", detail: `${k}: ${partial}`, missing },
    locked: false,
    explanation: `${k} cannot be grounded on a partial record (missing: ${missing.join(", ")}); provenance unconfirmed.`
  });
  for (const k of missing) out.set(k, abstain(k));
  if (consistent.length === 0) {
    const score2 = (i) => present.filter((k) => agrees(records[i], k)).length;
    let best = 0;
    for (let i = 1; i < records.length; i++) if (score2(i) > score2(best)) best = i;
    const r = records[best];
    const differs = present.filter((k) => !agrees(r, k)).map((k) => `${k} = ${hasField(r, k) ? JSON.stringify(r[k]) : "(not on it)"}`).join(", ");
    const closest = `Closest approved record: records[${best}] (${score2(best)} of ${present.length} agree; it has ${differs}).`;
    for (const k of present) {
      const v = args[k];
      out.set(k, {
        ...rule,
        claim_id: `arg.${k}`,
        field: k,
        asserted: v,
        outcome: "FAIL",
        computation: { formula: "values \u2208 one approved record", operands: { value: v, records: records.length }, result: false },
        evidence: [recordRef(best, k, hasField(r, k) ? r[k] : null)],
        locked: true,
        explanation: `No approved record carries ${given} together. ${closest} A value approved for one record combined with another record's value is not grounded. Do not execute.`
      });
    }
  } else if (missing.length === 0) {
    const i = consistent[0];
    for (const k of present) {
      const v = args[k];
      out.set(k, {
        ...rule,
        claim_id: `arg.${k}`,
        field: k,
        asserted: v,
        outcome: "PASS",
        computation: { formula: "values \u2208 one approved record", operands: { value: v, record: i }, result: true },
        evidence: [recordRef(i, k, records[i][k])],
        locked: true,
        explanation: `${k} = ${JSON.stringify(v)} is grounded together with the action's other record-named values (${given}) in approved records[${i}].`
      });
    }
  } else {
    for (const k of present) out.set(k, abstain(k));
  }
  return out;
}
function coverageOf2(claims) {
  let pass = 0, fail = 0, ins = 0;
  for (const c of claims) c.outcome === "PASS" ? pass++ : c.outcome === "FAIL" ? fail++ : ins++;
  return { claims_total: claims.length, claims_checked: pass + fail, claims_pass: pass, claims_fail: fail, claims_insufficient: ins };
}
function verifyAction(action, sources = {}, options = {}) {
  const args = action.arguments ?? {};
  const declared = sources.require ?? Object.keys(args).filter((k) => isScalar(args[k]));
  const records = sources.records;
  const required = records ? [...declared, ...recordNamed(records).filter((k) => !declared.includes(k))] : declared;
  const byRecord = records ? groundRecords(args, records, required) : void 0;
  const prepared = typeof sources.text === "string" && sources.text.length > 0 ? prepareSource(sources.text) : void 0;
  const sourceHash = prepared ? sha256(sources.text) : void 0;
  const claims = required.map((path) => {
    const v = args[path];
    const rec = byRecord?.get(path);
    if (rec) {
      if (rec.outcome !== "INSUFFICIENT_DATA" && sources.allowed?.[path] !== void 0 && isScalar(v)) {
        const listed = groundArgument(path, v, { allowed: sources.allowed }, void 0, void 0);
        if (listed.outcome === "FAIL") return listed;
      }
      return rec;
    }
    if (!isScalar(v)) {
      return {
        claim_id: `arg.${path}`,
        kind: "CROSS_REFERENCE",
        tier: "DETERMINISTIC",
        outcome: "INSUFFICIENT_DATA",
        field: path,
        asserted: null,
        rule_id: "GROUNDED",
        rule_name: "Value grounded in an approved source",
        evidence: [],
        insufficiency: { reason: "UNPARSEABLE", detail: `${path} is not a scalar value; only scalar arguments (amounts, codes, ids, strings) are checked for grounding.` },
        locked: false,
        explanation: `${path} is not a scalar; not checked.`
      };
    }
    return groundArgument(path, v, sources, prepared, sourceHash);
  });
  const coverage = coverageOf2(claims);
  const outcome = coverage.claims_fail > 0 ? "FAIL" : coverage.claims_insufficient > 0 || coverage.claims_checked === 0 ? "INSUFFICIENT_DATA" : "PASS";
  const ruleset = records ? ACTION_RECORDS_RULESET : ACTION_RULESET;
  const input_hash = hashOf({ action, sources });
  const verdict_id = sha256(`${input_hash}:${ruleset.id}@${ruleset.version}:${ENGINE_VERSION}`).slice(0, 32);
  const issued_at = (options.now ?? (() => /* @__PURE__ */ new Date()))().toISOString();
  return {
    schema_version: SCHEMA_VERSION,
    verdict_id,
    issued_at,
    engine_version: ENGINE_VERSION,
    ruleset: { ...ruleset },
    input_hash,
    replayable: true,
    document: { extraction_hash: hashOf(action), ...options.producer !== void 0 ? { producer: options.producer } : {}, line_items: 0 },
    references: { contract: sources.allowed !== void 0 || records !== void 0, evidence: 0, history: 0, source: prepared !== void 0 },
    outcome,
    aggregation: "ANY_FAIL_FAILS",
    claims,
    coverage
  };
}

// packages/verify/src/verdict/aggregation.ts
var AGGREGATIONS = ["ANY_FAIL_FAILS", "ANY_FAIL_FAILS_CONSISTENCY_ALONE_NEVER_PASSES"];
function aggregateOutcome(aggregation, claims) {
  if (claims.some((c) => c.outcome === "FAIL")) return "FAIL";
  const passes = aggregation === "ANY_FAIL_FAILS_CONSISTENCY_ALONE_NEVER_PASSES" ? claims.some((c) => c.outcome === "PASS" && c.kind !== "CONSISTENCY") : claims.some((c) => c.outcome === "PASS");
  return passes ? "PASS" : "INSUFFICIENT_DATA";
}

// packages/verify/src/legal/index.ts
var LEGAL_RULESET = { id: "legal", version: "0.0.1", domain: "legal" };
function spanEvidence3(sourceHash, span, text) {
  return { locator: { kind: "span", source_hash: sourceHash, start: span.start, end: span.end }, value: text, confidence: 100, role: "QUOTE" };
}
var NEGATION = /\b(?:not|no|never|cannot|can't|don't|doesn't|didn't|nor|without|fail(?:s|ed|ing)?\s+to|declin\w+\s+to|refus\w+\s+to|reject\w*|decline[ds]?)\b/i;
function precededByNegation(text, start) {
  const before = text.slice(Math.max(0, start - 80), start);
  const clause = before.split(/[.;:!?]/).pop() ?? before;
  return NEGATION.test(clause);
}
function resolveSource(c, sources) {
  for (const k of [c.source_key, c.cite, c.case_name, c.id]) {
    if (k !== void 0 && typeof sources[k] === "string" && sources[k].length > 0) return { key: k, text: sources[k] };
  }
  return null;
}
function verifyCitation(c, sources) {
  const label = c.case_name ?? c.cite ?? c.id;
  const base = {
    claim_id: `cite.${c.id}`,
    kind: "QUOTE_MATCH",
    tier: "DETERMINISTIC",
    field: c.cite ?? c.case_name ?? c.id,
    asserted: c.quote ?? c.proposition ?? label,
    rule_id: "CITE_VERBATIM",
    rule_name: "Citation quoted accurately"
  };
  const src = resolveSource(c, sources);
  if (!src) {
    return {
      ...base,
      outcome: "INSUFFICIENT_DATA",
      evidence: [],
      insufficiency: { reason: "REFERENCE_NOT_PROVIDED", detail: `no opinion text supplied for ${label}; existence and quotation cannot be verified without the source opinion. (Existence-only checking is a separate commodity; we verify the words.)` },
      locked: false,
      explanation: `No opinion text for ${label}; cannot verify.`
    };
  }
  if (c.quote === void 0 || c.quote.trim().length === 0) {
    return {
      ...base,
      outcome: "INSUFFICIENT_DATA",
      evidence: [{ locator: { kind: "field", source: "contract", path: `opinion:${src.key}` }, value: label, confidence: 100, role: "REFERENCE" }],
      insufficiency: { reason: "OUT_OF_RULESET_SCOPE", detail: `whether ${label} stands for the asserted proposition is a semantic judgement the deterministic tier does not make. Supply the quoted language to verify it verbatim, or await the REASONED tier.` },
      locked: false,
      explanation: `${label}: proposition not deterministically decidable; abstaining by design.`
    };
  }
  const prepared = prepareSource(src.text);
  const sourceHash = sha256(src.text);
  const r = matchQuote(prepared, c.quote);
  if (r.found && r.span) {
    if (precededByNegation(src.text, r.span.start)) {
      return {
        ...base,
        outcome: "INSUFFICIENT_DATA",
        evidence: [spanEvidence3(sourceHash, r.span, r.matchedText ?? "")],
        insufficiency: { reason: "SELECTIVE_QUOTE", detail: `the quoted words appear in ${label}, but immediately follow a negation in the opinion (e.g. "we do not hold that\u2026") that the quotation omits. This may be a selective quotation that inverts the holding \u2014 cannot certify as accurately cited; verify in context.` },
        locked: false,
        explanation: `${label}: quoted words present but preceded by a negation the quote omits; not certified \u2014 possible selective quotation.`
      };
    }
    return {
      ...base,
      outcome: "PASS",
      locked: true,
      evidence: [spanEvidence3(sourceHash, r.span, r.matchedText ?? "")],
      explanation: `The quotation attributed to ${label} appears verbatim in the opinion.`
    };
  }
  if (r.reason === "misquote_nearest" && r.nearest) {
    return {
      ...base,
      outcome: "FAIL",
      locked: true,
      computation: { formula: "brief_quote = opinion[cited passage]", operands: { brief_quote: c.quote, opinion_says: r.nearest.text }, result: r.nearest.text },
      evidence: [spanEvidence3(sourceHash, r.nearest.span, r.nearest.text)],
      explanation: `${label} is a real authority, but the quotation is not accurate. The opinion reads: "${r.nearest.text}".`
    };
  }
  return {
    ...base,
    outcome: "INSUFFICIENT_DATA",
    evidence: [],
    insufficiency: { reason: "SPAN_NOT_FOUND", detail: `the quoted passage was not found in the supplied text of ${label}; it may be fabricated, or the supplied opinion text may be incomplete. Not confirmed \u2014 do not rely on this citation as quoted.` },
    locked: false,
    explanation: `${label}: quotation not located in the opinion; abstaining rather than asserting a fabrication.`
  };
}
function coverageOf3(claims) {
  let pass = 0, fail = 0, ins = 0;
  for (const c of claims) c.outcome === "PASS" ? pass++ : c.outcome === "FAIL" ? fail++ : ins++;
  return { claims_total: claims.length, claims_checked: pass + fail, claims_pass: pass, claims_fail: fail, claims_insufficient: ins };
}
function verifyCitations(citations, sources = {}, options = {}) {
  const claims = citations.map((c) => verifyCitation(c, sources));
  const coverage = coverageOf3(claims);
  const outcome = coverage.claims_fail > 0 ? "FAIL" : coverage.claims_checked === 0 ? "INSUFFICIENT_DATA" : "PASS";
  const input_hash = hashOf({ citations, sources });
  const verdict_id = sha256(`${input_hash}:${LEGAL_RULESET.id}@${LEGAL_RULESET.version}:${ENGINE_VERSION}`).slice(0, 32);
  const issued_at = (options.now ?? (() => /* @__PURE__ */ new Date()))().toISOString();
  return {
    schema_version: SCHEMA_VERSION,
    verdict_id,
    issued_at,
    engine_version: ENGINE_VERSION,
    ruleset: { ...LEGAL_RULESET },
    input_hash,
    replayable: true,
    document: { extraction_hash: hashOf(citations), ...options.producer !== void 0 ? { producer: options.producer } : {}, line_items: citations.length },
    references: { contract: false, evidence: 0, history: 0, source: Object.keys(sources).length > 0 },
    outcome,
    aggregation: "ANY_FAIL_FAILS",
    claims,
    coverage
  };
}

// packages/verify/src/ap/parse.ts
var NUM = /\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g;
function numbersIn(s) {
  const raw = [];
  for (const m of s.matchAll(NUM)) {
    const i = m.index ?? 0;
    const before = s[i - 1] ?? "";
    const after = s[i + m[0].length] ?? "";
    if (before === "-" || after === "-") continue;
    if (/[A-Za-z]/.test(after) || /[A-Za-z]/.test(before)) continue;
    raw.push({ value: Number(m[0].replace(/,/g, "")), text: m[0], index: i });
  }
  const out = [];
  for (let k = 0; k < raw.length; k++) {
    const n = raw[k];
    const anchored = /(?:USD|EUR|GBP|CAD|\$)\s*$/i.test(s.slice(Math.max(0, n.index - 5), n.index));
    if (anchored && /^\d{1,3}$/.test(n.text)) {
      let text = n.text, end = n.index + n.text.length, j = k + 1;
      while (j < raw.length && /^\s{1,2}$/.test(s.slice(end, raw[j].index)) && /^\d{3}(?:\.\d+)?$/.test(raw[j].text)) {
        text += raw[j].text;
        end = raw[j].index + raw[j].text.length;
        j++;
        if (/\./.test(text)) break;
      }
      if (j > k + 1) {
        out.push({ value: Number(text), text: s.slice(n.index, end), index: n.index });
        k = j - 1;
        continue;
      }
    }
    out.push(n);
  }
  return out;
}
var UNANCHORED_SPACE_GROUP = /(?<!(?:USD|EUR|GBP|CAD|\$)\s{0,2})\b\d{1,3}\s{1,2}\d{3}(?:\.\d{2})\b/i;
var close = (a, b, eps = 5e-3) => Math.abs(a - b) <= eps;
var round2 = (x) => Math.round(x * 100) / 100;
function linesOf(text) {
  const out = [];
  let pos = 0;
  text.split("\n").forEach((t, i) => {
    out.push({ text: t, start: pos, line: i + 1 });
    pos += t.length + 1;
  });
  return out;
}
var spanOf = (l) => ({ start: l.start, end: l.start + l.text.length, line: l.line });
var TOTAL = /\btotal\b|amount\s+(?:payable|due)|balance\s+due|please\s+(?:pay|remit)/i;
var NOT_TOTAL = /sub-?\s*total|previous|balance on|balance forward|quote|valid|credit|paid|deposit|outstanding|overdue|last month|prior/i;
var FREIGHT = /freight|shipping|delivery charge|carriage/i;
var STRAY = /previous|balance on|balance forward|quote|valid until|credit|deposit|already paid|paid on|outstanding|overdue|last month|prior|not part of this invoice/i;
var MONEY = /(?:USD|EUR|GBP|CAD|\$)\s*\d[\d, ]*(?:\.\d{2})?|\d[\d,]*\.\d{2}/i;
function parseInvoice(text) {
  const explicit = [...text.matchAll(/invoice\s*(?:no\.?|number|#|:)?\s*([A-Z]{2,4}-\d{4,6})\b/gi)];
  const all = [...text.matchAll(/\b([A-Z]{2,4}-\d{4,6})\b/g)].filter((m) => !/^(PO|Q|QT|QUO|REF|RMA)-/i.test(m[1]));
  const pool = explicit.length ? explicit : all;
  const candidates = [...new Set(pool.map((m) => m[1].toUpperCase()))];
  let invoiceNumber = null;
  if (candidates.length === 1) {
    const m = pool[0];
    const start = (m.index ?? 0) + m[0].lastIndexOf(m[1]);
    invoiceNumber = { value: candidates[0], span: { start, end: start + m[1].length, line: text.slice(0, start).split("\n").length } };
  }
  const seenPo = /* @__PURE__ */ new Set();
  const poNumbers = [];
  for (const m of text.matchAll(/\b(PO-\d+)\b/g)) {
    if (seenPo.has(m[1])) continue;
    seenPo.add(m[1]);
    const start = m.index ?? 0;
    poNumbers.push({ value: m[1], span: { start, end: start + m[1].length, line: text.slice(0, start).split("\n").length } });
  }
  const lines = [];
  const totals = [];
  const freight = [];
  const unclassified = [];
  let ambiguousTotal = null;
  for (const l of linesOf(text)) {
    const line3 = l.text.trim();
    if (!line3) continue;
    const nums = numbersIn(l.text);
    const unclassify = () => {
      if (!MONEY.test(l.text) || STRAY.test(l.text)) return;
      const money3 = nums.filter((n) => /\.\d{2}$/.test(n.text));
      const pick2 = money3[money3.length - 1] ?? nums[nums.length - 1];
      if (pick2) unclassified.push({ value: pick2.value, span: spanOf(l), text: line3 });
    };
    if (TOTAL.test(l.text) && !NOT_TOTAL.test(l.text) && nums.length) {
      if (UNANCHORED_SPACE_GROUP.test(l.text)) {
        ambiguousTotal = line3;
        continue;
      }
      const kw = l.text.search(TOTAL);
      const money3 = nums.filter((n) => n.index > kw && /\.\d{2}$/.test(n.text));
      totals.push({ value: (money3[0] ?? nums[nums.length - 1]).value, span: spanOf(l) });
      continue;
    }
    if (FREIGHT.test(l.text) && nums.length && !/not allowed|no freight/i.test(l.text)) {
      freight.push({ value: nums[nums.length - 1].value, span: spanOf(l) });
      continue;
    }
    if (nums.length < 3) {
      unclassify();
      continue;
    }
    let best = null;
    for (let i = 0; i < nums.length; i++) for (let j = i + 1; j < nums.length; j++) for (let k = j + 1; k < nums.length; k++) {
      const q = nums[i].value, u = nums[j].value, t = nums[k].value;
      if (!Number.isInteger(q) || q <= 0 || u <= 0) continue;
      if (close(round2(q * u), t, 0.011) && (!best || k > best.idx[2])) best = { q, u, t, exact: true, idx: [i, j, k] };
    }
    if (!best) {
      const n = nums.length;
      const [a, b, c] = [nums[n - 3], nums[n - 2], nums[n - 1]];
      if (Number.isInteger(a.value) && a.value > 0 && Math.abs(a.value * b.value - c.value) / Math.max(c.value, 1) < 0.25) {
        best = { q: a.value, u: b.value, t: c.value, exact: false, idx: [n - 3, n - 2, n - 1] };
      }
    }
    if (!best) {
      unclassify();
      continue;
    }
    let named = l.text;
    for (const k of [...best.idx].sort((x, y) => y - x)) {
      const nm = nums[k];
      named = named.slice(0, nm.index) + " ".repeat(nm.text.length) + named.slice(nm.index + nm.text.length);
    }
    const pick = best;
    const name = named.replace(/^\s*[-*•]?\s*\d{1,2}[.)]?\s+(?=\S)/, (m) => /^\s*[-*•]?\s*\d{1,2}[.)]?\s+$/.test(m) && pick.idx[0] !== 0 ? " " : m).replace(/\b(USD|EUR|GBP|CAD)\b|\$/gi, " ").replace(/[|@=×]|\bx\b/gi, " ").replace(/^[\s\-*•]+/, "").replace(/\s+/g, " ").trim();
    lines.push({ name, qty: best.q, unit: best.u, amount: best.t, amountMatchesQtyTimesUnit: best.exact, span: spanOf(l) });
  }
  return { invoiceNumber, invoiceNumberCandidates: candidates, poNumbers, lines, totals, freight, unclassified, ambiguousTotal };
}
function parsePurchaseOrder(text) {
  let number = null;
  const nm = text.match(/\b(PO-\d+)\s*\|\s*Vendor/);
  if (nm) {
    const start = nm.index ?? 0;
    number = { value: nm[1], span: { start, end: start + nm[1].length, line: text.slice(0, start).split("\n").length } };
  }
  const frText = text.match(/Freight:\s*([^|\n]+)/i)?.[1]?.trim().toLowerCase();
  const freightAllowed = frText === void 0 ? null : /not allowed|not permitted|no freight|included in price|vendor pays/.test(frText) ? false : /allowed|permitted|may be added|billable|added by the vendor/.test(frText) ? true : null;
  const lines = [];
  for (const l of linesOf(text)) {
    const m = l.text.match(/^\s*(\d+)\.\s*(.+?)\s*\|\s*qty\s*([\d,.]+)\s*\|\s*unit\s*[A-Z]{3}\s*([\d,.]+)\s*$/);
    if (m) lines.push({ index: Number(m[1]), name: m[2].trim(), qty: Number(m[3].replace(/,/g, "")), unit: Number(m[4].replace(/,/g, "")), span: spanOf(l) });
  }
  return { number, freightAllowed, lines };
}
function parseGoodsReceipt(text) {
  const out = [];
  for (const l of linesOf(text)) {
    const m = l.text.match(/^\s*(\d+)\.\s*(.+?)\s*\|\s*received\s*([\d,.]+)\s*$/);
    if (m) out.push({ index: Number(m[1]), name: m[2].trim(), received: Number(m[3].replace(/,/g, "")), span: spanOf(l) });
  }
  return out;
}
function tokens(s) {
  return s.toLowerCase().replace(/(\d)([a-z])/g, "$1 $2").replace(/([a-z])(\d)/g, "$1 $2").replace(/[^a-z0-9. ]+/g, " ").split(/\s+/).map((t) => t.replace(/\.$/, "")).filter(Boolean);
}
function tokenMatch(a, b) {
  if (a === b) return true;
  if (/^\d/.test(a) || /^\d/.test(b)) return false;
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  if (s.length < 2) return false;
  if (l.startsWith(s)) return true;
  if (s[0] !== l[0]) return false;
  let j = 0;
  for (const ch of l) if (ch === s[j]) j++;
  return j === s.length;
}
var STOP = /* @__PURE__ */ new Set(["x", "usd", "ea", "each", "pc", "pcs", "unit", "units", "of", "the", "and", "with", "for", "a"]);
function nameScore(invName, poName) {
  const a = tokens(invName).filter((t) => !STOP.has(t));
  const b = tokens(poName).filter((t) => !STOP.has(t));
  if (!a.length || !b.length) return 0;
  const used = /* @__PURE__ */ new Set();
  let hit = 0;
  for (const t of a) {
    const j = b.findIndex((u, k) => !used.has(k) && tokenMatch(t, u));
    if (j >= 0) {
      used.add(j);
      hit++;
    }
  }
  const numsB = new Set(b.filter((t) => /^\d/.test(t)));
  const numMiss = a.filter((t) => /^\d/.test(t) && !numsB.has(t)).length;
  return hit / Math.min(a.length, b.length) - 0.5 * numMiss;
}
function matchLines(inv, po) {
  const n = inv.length;
  if (n !== po.length || n === 0 || n > 8) return null;
  const S = inv.map((il) => po.map((pl) => nameScore(il.name, pl.name) + (close(il.unit, pl.unit, 5e-3) ? 0.3 : Math.abs(il.unit - pl.unit) / pl.unit < 0.12 ? 0.1 : 0)));
  let best = -Infinity, second = -Infinity, bestPerm = [];
  const perm = po.map((_, j) => j);
  const permute = (k) => {
    if (k === n) {
      const tot = perm.reduce((acc, j, i) => acc + S[i][j], 0);
      if (tot > best) {
        second = best;
        best = tot;
        bestPerm = [...perm];
      } else if (tot > second) second = tot;
      return;
    }
    for (let x = k; x < n; x++) {
      [perm[k], perm[x]] = [perm[x], perm[k]];
      permute(k + 1);
      [perm[k], perm[x]] = [perm[x], perm[k]];
    }
  };
  permute(0);
  const pairs = bestPerm.map((j, i) => [i, j]);
  return { pairs, margin: n === 1 ? Infinity : best - second, minScore: Math.min(...pairs.map(([i, j]) => S[i][j])) };
}

// packages/verify/src/ap/index.ts
var AP_RULESET = { id: "ap-threeway", version: "0.1.0", domain: "accounts-payable" };
function splitApLayout(text) {
  const iPo = text.indexOf("PURCHASE ORDER (ERP)");
  const iGr = text.indexOf("GOODS RECEIPT (ERP)");
  if (iPo < 0 || iGr < 0 || iGr < iPo) return null;
  return { invoice: text.slice(0, iPo), purchase_order: text.slice(iPo, iGr), goods_receipt: text.slice(iGr) };
}
function verifyInvoiceMatch(docs, options = {}) {
  const tolP = options.policy?.price_tolerance ?? 0.02;
  const tolT = options.policy?.total_tolerance ?? 5e-3;
  const hashes = { invoice: sha256(docs.invoice), purchase_order: sha256(docs.purchase_order), goods_receipt: sha256(docs.goods_receipt) };
  const ev = (src, span, value, role) => ({ locator: { kind: "span", source_hash: hashes[src], start: span.start, end: span.end, line: span.line }, value, confidence: 100, role });
  const inv = parseInvoice(docs.invoice);
  const po = parsePurchaseOrder(docs.purchase_order);
  const gr = parseGoodsReceipt(docs.goods_receipt);
  const claims = [];
  const insufficient = (claim_id, field, rule_id, rule_name, reason, detail) => ({ claim_id, kind: "CROSS_REFERENCE", tier: "DETERMINISTIC", outcome: "INSUFFICIENT_DATA", field, asserted: null, rule_id, rule_name, evidence: [], insufficiency: { reason, detail }, locked: false, explanation: detail });
  const not_checked = [];
  const vendor = docs.purchase_order.match(/Vendor:\s*([^|\n]+)/)?.[1]?.trim() ?? null;
  const sameVendor = (h) => !h.vendor || !vendor || h.vendor.trim().toLowerCase() === vendor.toLowerCase();
  const history = docs.history;
  if (!history) {
    not_checked.push("duplicate check: no payment history supplied (pass history to enable it)");
  } else if (!inv.invoiceNumber) {
    claims.push(insufficient("ap.duplicate", "invoice_number", "AP_DUPLICATE", "Invoice not already booked", "UNPARSEABLE", "invoice number unclear, so the duplicate check cannot run"));
  } else {
    const invNo = inv.invoiceNumber;
    const num4 = invNo.value.toUpperCase();
    const exact = history.findIndex((h) => h.invoice_number.trim().toUpperCase() === num4 && sameVendor(h));
    const statedTotal2 = inv.totals.length === 1 ? round2(inv.totals[0].value) : null;
    const invPo = inv.poNumbers.length === 1 ? inv.poNumbers[0].value : null;
    const near = exact >= 0 ? -1 : history.findIndex((h) => sameVendor(h) && invPo !== null && h.po_number === invPo && statedTotal2 !== null && h.total !== void 0 && close(round2(h.total), statedTotal2, tolT));
    const histEv = (i) => ({ locator: { kind: "field", source: "history", path: `history[${i}]` }, value: history[i].invoice_number, confidence: 100, role: "REFERENCE" });
    if (exact >= 0) {
      const h = history[exact];
      claims.push({
        claim_id: "ap.duplicate",
        kind: "CROSS_REFERENCE",
        tier: "DETERMINISTIC",
        outcome: "FAIL",
        field: "invoice_number",
        asserted: invNo.value,
        rule_id: "AP_DUPLICATE",
        rule_name: "Invoice not already booked",
        computation: { formula: "invoice_number not in history (same vendor)", operands: { invoice_number: invNo.value, booked_as: h.invoice_number }, result: h.invoice_number },
        evidence: [ev("invoice", invNo.span, invNo.value, "OPERAND"), histEv(exact)],
        locked: true,
        explanation: `Invoice ${invNo.value} is already in the books${h.paid_on ? ` (paid ${h.paid_on})` : ""}. Paying it again would be a duplicate payment.`
      });
    } else if (near >= 0) {
      const h = history[near];
      claims.push({
        ...insufficient(
          "ap.duplicate",
          "invoice_number",
          "AP_DUPLICATE",
          "Invoice not already booked",
          "AMBIGUOUS_REFERENCE",
          `possible resubmission: same vendor, same PO (${h.po_number}) and same total (${h.total}) as booked invoice ${h.invoice_number}, under a different number \u2014 a person should confirm this is a new delivery`
        ),
        evidence: [histEv(near)]
      });
    } else {
      claims.push({
        claim_id: "ap.duplicate",
        kind: "CROSS_REFERENCE",
        tier: "DETERMINISTIC",
        outcome: "PASS",
        field: "invoice_number",
        asserted: invNo.value,
        rule_id: "AP_DUPLICATE",
        rule_name: "Invoice not already booked",
        computation: { formula: "invoice_number not in history (same vendor)", operands: { invoice_number: invNo.value, history_size: history.length }, result: null },
        evidence: [ev("invoice", invNo.span, invNo.value, "OPERAND"), { locator: { kind: "field", source: "history", path: "history" }, value: history.length, confidence: 100, role: "CONTEXT" }],
        locked: true,
        explanation: `Invoice ${invNo.value} does not appear among ${history.length} booked invoice(s).`
      });
    }
  }
  if (!po.number) {
    claims.push(insufficient("ap.po_number", "po_number", "AP_PO_MATCH", "Invoice references the purchase order", "UNPARSEABLE", "the purchase order number could not be read"));
  } else if (inv.poNumbers.length > 1) {
    claims.push(insufficient("ap.po_number", "po_number", "AP_PO_MATCH", "Invoice references the purchase order", "AMBIGUOUS_FIELD", `the invoice mentions several PO numbers (${inv.poNumbers.map((p) => p.value).join(", ")})`));
  } else if (inv.poNumbers.length === 0) {
    claims.push({
      claim_id: "ap.po_number",
      kind: "CROSS_REFERENCE",
      tier: "DETERMINISTIC",
      outcome: "FAIL",
      field: "po_number",
      asserted: null,
      rule_id: "AP_PO_MATCH",
      rule_name: "Invoice references the purchase order",
      computation: { formula: "invoice.po_number = po.number", operands: { invoice_po: null, po: po.number.value }, result: po.number.value },
      evidence: [ev("purchase_order", po.number.span, po.number.value, "REFERENCE")],
      locked: true,
      explanation: `The invoice cites no PO number; the open order is ${po.number.value}.`
    });
  } else {
    const ip = inv.poNumbers[0];
    const ok2 = ip.value === po.number.value;
    claims.push({
      claim_id: "ap.po_number",
      kind: "CROSS_REFERENCE",
      tier: "DETERMINISTIC",
      outcome: ok2 ? "PASS" : "FAIL",
      field: "po_number",
      asserted: ip.value,
      rule_id: "AP_PO_MATCH",
      rule_name: "Invoice references the purchase order",
      computation: { formula: "invoice.po_number = po.number", operands: { invoice_po: ip.value, po: po.number.value }, result: po.number.value },
      evidence: [ev("invoice", ip.span, ip.value, "OPERAND"), ev("purchase_order", po.number.span, po.number.value, "REFERENCE")],
      locked: true,
      explanation: ok2 ? `Invoice cites ${ip.value}, which is the purchase order.` : `Invoice cites ${ip.value}; the open order is ${po.number.value}.`
    });
  }
  let lineProblem = null;
  const byPo = /* @__PURE__ */ new Map();
  if (!po.lines.length) lineProblem = "the purchase order lines could not be read";
  else if (inv.lines.length !== po.lines.length) lineProblem = `read ${inv.lines.length} invoice line(s) but the PO has ${po.lines.length}`;
  else {
    const m = matchLines(inv.lines, po.lines);
    if (!m) lineProblem = "invoice lines could not be matched to PO lines";
    else if (m.minScore < 0.34) lineProblem = `a line match is too weak to trust (score ${m.minScore.toFixed(2)})`;
    else if (m.margin < 0.25) lineProblem = `two different line matchings are nearly as plausible (margin ${m.margin.toFixed(2)})`;
    else for (const [i, j] of m.pairs) byPo.set(j, inv.lines[i]);
  }
  for (let j = 0; j < po.lines.length; j++) {
    const pl = po.lines[j];
    const L = pl.index;
    const il = byPo.get(j);
    const rl2 = gr.find((r) => r.index === L);
    if (lineProblem || !il) {
      claims.push(insufficient(`ap.line[${L}].quantity`, `line[${L}].quantity`, "AP_QTY_RECEIVED", "Billed units were received", "AMBIGUOUS_REFERENCE", lineProblem ?? `no invoice line matched PO line ${L}`));
      claims.push(insufficient(`ap.line[${L}].price`, `line[${L}].unit_price`, "AP_PRICE_PO", "Unit price within PO tolerance", "AMBIGUOUS_REFERENCE", lineProblem ?? `no invoice line matched PO line ${L}`));
      continue;
    }
    if (!rl2) {
      claims.push(insufficient(`ap.line[${L}].quantity`, `line[${L}].quantity`, "AP_QTY_RECEIVED", "Billed units were received", "REFERENCE_NOT_PROVIDED", `no goods-receipt line for PO line ${L}`));
    } else {
      const ok2 = il.qty <= rl2.received;
      claims.push({
        claim_id: `ap.line[${L}].quantity`,
        kind: "CROSS_REFERENCE",
        tier: "DETERMINISTIC",
        outcome: ok2 ? "PASS" : "FAIL",
        field: `line[${L}].quantity`,
        asserted: il.qty,
        rule_id: "AP_QTY_RECEIVED",
        rule_name: "Billed units were received",
        computation: { formula: "invoice.qty \u2264 receipt.received", operands: { invoiced: il.qty, received: rl2.received }, result: rl2.received },
        evidence: [ev("invoice", il.span, il.qty, "OPERAND"), ev("goods_receipt", rl2.span, rl2.received, "REFERENCE")],
        locked: true,
        ...ok2 ? {} : { variance: il.qty - rl2.received },
        explanation: `${pl.name}: billed ${il.qty}, received ${rl2.received}${ok2 ? "" : " \u2014 more billed than received"}. (Invoice line "${il.name}".)`
      });
    }
    const max = pl.unit * (1 + tolP);
    const okP = il.unit <= max + 1e-9;
    claims.push({
      claim_id: `ap.line[${L}].price`,
      kind: "CROSS_REFERENCE",
      tier: "DETERMINISTIC",
      outcome: okP ? "PASS" : "FAIL",
      field: `line[${L}].unit_price`,
      asserted: il.unit,
      rule_id: "AP_PRICE_PO",
      rule_name: "Unit price within PO tolerance",
      computation: { formula: `invoice.unit \u2264 po.unit \xD7 ${1 + tolP}`, operands: { invoiced: il.unit, po_unit: pl.unit }, result: round2(max * 1e4) / 1e4, tolerance: { rel: tolP } },
      evidence: [ev("invoice", il.span, il.unit, "OPERAND"), ev("purchase_order", pl.span, pl.unit, "REFERENCE")],
      locked: true,
      ...okP ? {} : { variance: round2(il.unit - pl.unit) },
      explanation: `${pl.name}: invoiced ${il.unit}, PO ${pl.unit} (max ${max.toFixed(4)})${okP ? "" : " \u2014 over tolerance"}.`
    });
  }
  const totalVals = [...new Set(inv.totals.map((t) => round2(t.value)))];
  if (inv.ambiguousTotal) {
    claims.push({ ...insufficient(
      "ap.total",
      "total",
      "AP_TOTAL_SUM",
      "Stated total equals the lines (+ allowed freight)",
      "UNPARSEABLE",
      `the total is written with a space inside the number ("${inv.ambiguousTotal.slice(0, 80)}") and no currency marker in front of it \u2014 it could be read two ways; not guessing`
    ), kind: "RECOMPUTE" });
  } else if (totalVals.length !== 1) {
    claims.push({ ...insufficient("ap.total", "total", "AP_TOTAL_SUM", "Stated total equals the lines (+ allowed freight)", totalVals.length ? "AMBIGUOUS_FIELD" : "FIELD_MISSING", totalVals.length ? `several different stated totals (${totalVals.join(", ")})` : "no stated total found"), kind: "RECOMPUTE" });
  } else if (inv.unclassified.length) {
    const u = inv.unclassified[0];
    claims.push({ ...insufficient(
      "ap.total",
      "total",
      "AP_TOTAL_SUM",
      "Stated total equals the lines (+ allowed freight)",
      "AMBIGUOUS_FIELD",
      `an amount on the invoice (${u.value}, in "${u.text.slice(0, 80)}") is not a line item, the total, freight, or a known stray \u2014 cannot tell whether it belongs in the total`
    ), kind: "RECOMPUTE" });
  } else if (inv.freight.length > 1) {
    claims.push({ ...insufficient("ap.total", "total", "AP_TOTAL_SUM", "Stated total equals the lines (+ allowed freight)", "AMBIGUOUS_FIELD", "several freight amounts"), kind: "RECOMPUTE" });
  } else if (inv.freight.length && po.freightAllowed === null) {
    claims.push({ ...insufficient("ap.total", "total", "AP_TOTAL_SUM", "Stated total equals the lines (+ allowed freight)", "AMBIGUOUS_UNIT", "freight billed but the PO does not say whether freight is allowed"), kind: "RECOMPUTE" });
  } else if (!inv.lines.length) {
    claims.push({ ...insufficient("ap.total", "total", "AP_TOTAL_SUM", "Stated total equals the lines (+ allowed freight)", "UNPARSEABLE", "no invoice lines could be read"), kind: "RECOMPUTE" });
  } else {
    const stated = inv.totals[0];
    const freight = inv.freight.length && po.freightAllowed ? inv.freight[0].value : 0;
    const sum = round2(inv.lines.reduce((s, l) => s + l.amount, 0) + freight);
    const ok2 = close(round2(stated.value), sum, tolT);
    const evidence = [ev("invoice", stated.span, stated.value, "OPERAND"), ...inv.lines.map((l) => ev("invoice", l.span, l.amount, "OPERAND"))];
    if (inv.freight.length) evidence.push(ev("invoice", inv.freight[0].span, inv.freight[0].value, po.freightAllowed ? "OPERAND" : "CONTEXT"));
    claims.push({
      claim_id: "ap.total",
      kind: "RECOMPUTE",
      tier: "DETERMINISTIC",
      outcome: ok2 ? "PASS" : "FAIL",
      field: "total",
      asserted: stated.value,
      rule_id: "AP_TOTAL_SUM",
      rule_name: "Stated total equals the lines (+ allowed freight)",
      computation: { formula: "total = \u03A3 line.amount + (freight if PO allows)", operands: { lines: round2(sum - freight), freight, freight_allowed: po.freightAllowed }, result: sum, tolerance: { abs: tolT } },
      evidence,
      locked: true,
      ...ok2 ? {} : { variance: round2(stated.value - sum) },
      explanation: `Stated total ${stated.value}; lines ${round2(sum - freight)}${inv.freight.length ? `, freight ${inv.freight[0].value} ${po.freightAllowed ? "allowed" : "NOT allowed (excluded)"}` : ""} = ${sum}.${ok2 ? "" : " Does not add up."}`
    });
  }
  const coverage = { claims_total: claims.length, claims_checked: 0, claims_pass: 0, claims_fail: 0, claims_insufficient: 0 };
  for (const c of claims) {
    if (c.outcome === "PASS") coverage.claims_pass++;
    else if (c.outcome === "FAIL") coverage.claims_fail++;
    else coverage.claims_insufficient++;
  }
  coverage.claims_checked = coverage.claims_pass + coverage.claims_fail;
  const outcome = coverage.claims_fail > 0 ? "FAIL" : coverage.claims_checked === 0 ? "INSUFFICIENT_DATA" : "PASS";
  const input_hash = hashOf({ ap: docs, policy: { price_tolerance: tolP, total_tolerance: tolT } });
  const verdict_id = sha256(`${input_hash}:${AP_RULESET.id}@${AP_RULESET.version}:${ENGINE_VERSION}`).slice(0, 32);
  const verdict = {
    schema_version: SCHEMA_VERSION,
    verdict_id,
    issued_at: (options.now ?? (() => /* @__PURE__ */ new Date()))().toISOString(),
    engine_version: ENGINE_VERSION,
    ruleset: { ...AP_RULESET },
    input_hash,
    replayable: true,
    document: { extraction_hash: sha256(docs.invoice), ...options.producer !== void 0 ? { producer: options.producer } : {}, line_items: inv.lines.length },
    references: { contract: true, evidence: 1, history: history?.length ?? 0, source: true },
    outcome,
    aggregation: "ANY_FAIL_FAILS",
    claims,
    coverage
  };
  const order = [
    ...history ? [["ap.duplicate", "hold_duplicate"]] : [],
    ["ap.po_number", "hold_no_po"],
    ...po.lines.map((pl) => [`ap.line[${pl.index}].quantity`, "hold_quantity"]),
    ...po.lines.map((pl) => [`ap.line[${pl.index}].price`, "hold_price"]),
    ["ap.total", "hold_total"]
  ];
  const invoice_number = inv.invoiceNumber?.value ?? null;
  const po_number = inv.poNumbers.length === 1 ? inv.poNumbers[0].value : null;
  const byId2 = new Map(claims.map((c) => [c.claim_id, c]));
  for (const [id, label] of order) {
    const c = byId2.get(id);
    if (!c || c.outcome === "INSUFFICIENT_DATA") {
      return {
        verdict,
        decision: "abstain",
        payable: coverage.claims_fail > 0 ? false : null,
        grounding: { invoice_number, po_number, item: null, invoiced: null, expected: null },
        reasons: [`cannot decide ${id}: ${c?.insufficiency?.detail ?? "check missing"}`, ...coverage.claims_fail > 0 ? ["a later check FAILED \u2014 do not pay, but the policy label is undetermined"] : []],
        not_checked
      };
    }
    if (c.outcome === "FAIL") {
      const L = id.match(/line\[(\d+)\]/)?.[1];
      const pl = L ? po.lines.find((p) => p.index === Number(L)) : void 0;
      const ops = c.computation?.operands ?? {};
      const grounding = label === "hold_duplicate" ? { invoice_number, po_number, item: null, invoiced: invoice_number, expected: ops.booked_as ?? null } : label === "hold_no_po" ? { invoice_number, po_number, item: null, invoiced: ops.invoice_po ?? null, expected: ops.po ?? null } : label === "hold_total" ? { invoice_number, po_number, item: null, invoiced: c.asserted, expected: c.computation?.result } : { invoice_number, po_number, item: pl?.name ?? null, invoiced: c.asserted, expected: label === "hold_quantity" ? ops.received : ops.po_unit };
      if (invoice_number === null) return { verdict, decision: "abstain", payable: false, grounding, reasons: [c.explanation, "invoice number unclear \u2014 do not pay, route for identification"], not_checked };
      return { verdict, decision: label, payable: false, grounding, reasons: [c.explanation], not_checked };
    }
  }
  if (invoice_number === null) return { verdict, decision: "abstain", payable: null, grounding: { invoice_number, po_number, item: null, invoiced: null, expected: null }, reasons: ["all checks passed but the invoice number is unclear"], not_checked };
  return { verdict, decision: "approve", payable: true, grounding: { invoice_number, po_number, item: null, invoiced: null, expected: null }, reasons: [history ? "all checks passed, including the duplicate check" : "all four checks passed"], not_checked };
}

// packages/verify/src/declarative/lint.ts
var VALID_KINDS = /* @__PURE__ */ new Set(["amount", "rate", "quantity", "string", "bool", "identifier", "price"]);
var VALID_OPS = /* @__PURE__ */ new Set(["=", "<=", ">=", "!="]);
var VALID_COMPARE = /* @__PURE__ */ new Set(["number", "identifier"]);
var VALID_GUARD_OPS = /* @__PURE__ */ new Set(["=", "!=", "<", "<=", ">", ">="]);
var VALID_ROUNDING = /* @__PURE__ */ new Set(["none", "infer"]);
var safeRefs = (expr2) => {
  if (typeof expr2 !== "string") return [];
  try {
    return referencedRoles(expr2);
  } catch {
    return [];
  }
};
function lintRuleset(rs) {
  const errors = [];
  const warnings = [];
  if (rs === null || typeof rs !== "object") return { ok: false, errors: ["ruleset must be an object"], warnings };
  const R = rs;
  if (typeof R.id !== "string" || R.id.length === 0) errors.push('missing or empty "id"');
  if (typeof R.version !== "string" || R.version.length === 0) errors.push('missing or empty "version"');
  const fieldsOk = R.fields !== null && typeof R.fields === "object" && !Array.isArray(R.fields) && Object.keys(R.fields).length > 0;
  if (!fieldsOk) errors.push('"fields" must be a non-empty object');
  if (!Array.isArray(R.checks) || R.checks.length === 0) errors.push('"checks" must be a non-empty array');
  if (errors.length > 0) return { ok: false, errors, warnings };
  const fields = R.fields;
  const computed2 = R.computed ?? {};
  const docRoles = new Set(Object.keys(fields).filter((k) => !fields[k].line));
  const lineRoles = new Set(Object.keys(fields).filter((k) => fields[k].line));
  const computedRoles = new Set(Object.keys(computed2));
  const allRoles = /* @__PURE__ */ new Set([...docRoles, ...lineRoles, ...computedRoles]);
  const identifierRoles = new Set(Object.keys(fields).filter((k) => fields[k].kind === "identifier"));
  const noIdentifierArithmetic = (expr2, where) => {
    if (typeof expr2 !== "string") return;
    try {
      for (const ref2 of referencedRoles(expr2)) if (identifierRoles.has(ref2)) errors.push(`${where}: identifier field "${ref2}" cannot be used in arithmetic (use a check with compare: "identifier")`);
    } catch {
    }
  };
  for (const [role, f] of Object.entries(fields)) {
    if (!Array.isArray(f.paths) || f.paths.length === 0) errors.push(`field "${role}": "paths" must be a non-empty array`);
    if (f.kind !== void 0 && !VALID_KINDS.has(f.kind)) errors.push(`field "${role}": invalid kind "${f.kind}"`);
  }
  for (const r of computedRoles) if (fields[r]) errors.push(`"${r}" is both a field and a computed role \u2014 names must be unique`);
  const dummy = { vars: Object.fromEntries([...allRoles].map((r) => [r, 1])), sum: (r) => lineRoles.has(r) ? 1 : void 0 };
  const parse = (expr2, where) => {
    if (typeof expr2 !== "string" || expr2.trim() === "") {
      errors.push(`${where}: expression must be a non-empty string`);
      return;
    }
    try {
      evalExpr(expr2, dummy);
    } catch (e) {
      errors.push(`${where}: ${e.message}`);
      return;
    }
    for (const ref2 of referencedRoles(expr2)) if (!allRoles.has(ref2)) errors.push(`${where}: references unknown role "${ref2}"`);
  };
  for (const [role, formula] of Object.entries(computed2)) {
    parse(formula, `computed "${role}"`);
    noIdentifierArithmetic(formula, `computed "${role}"`);
  }
  const tolRounding = R.tolerance?.rounding;
  if (tolRounding !== void 0 && !VALID_ROUNDING.has(tolRounding)) errors.push(`tolerance.rounding: invalid value "${String(tolRounding)}" (none | infer)`);
  const src = R.sources;
  if (src !== void 0 && (src === null || typeof src !== "object" || Array.isArray(src) || Object.values(src).some((v) => typeof v !== "string" || v.trim() === ""))) {
    errors.push('"sources" must be an object mapping each key to a non-empty string (a URL or a citation)');
  }
  const usedRoles = /* @__PURE__ */ new Set();
  const checkSide = (expr2, where, err, scope) => {
    parse(expr2, where);
    noIdentifierArithmetic(expr2, where);
    if (typeof expr2 !== "string") return;
    for (const ref2 of safeRefs(expr2)) {
      usedRoles.add(ref2);
      if (!allRoles.has(ref2)) continue;
      if (scope === "line") {
        if (docRoles.has(ref2)) errors.push(`${err}: line-scope check references document field "${ref2}" (only line fields are visible per line)`);
        if (computedRoles.has(ref2)) errors.push(`${err}: line-scope check references computed role "${ref2}" (computed roles are document-scope)`);
        if (/\bsum\s*\(/.test(expr2)) errors.push(`${err}: sum() is not available in a line-scope check`);
      } else {
        if (lineRoles.has(ref2) && !new RegExp(`\\bsum\\s*\\(\\s*${ref2}\\s*\\)`).test(expr2)) {
          errors.push(`${err}: document-scope check uses per-line field "${ref2}" directly \u2014 wrap it as sum(${ref2})`);
        }
      }
    }
  };
  const checkNewOptions = (c, where, scope, isIdentifier) => {
    if (c.abstain !== void 0) {
      if (typeof c.abstain !== "string" || c.abstain.trim() === "") errors.push(`${where}: "abstain" must be a non-empty string (the reason the check never decides)`);
      else warnings.push(`${where}: declared abstention; the check never decides (${c.abstain.length > 80 ? `${c.abstain.slice(0, 77)}...` : c.abstain})`);
    }
    if (c.guard_reason !== void 0) {
      if (typeof c.guard_reason !== "string" || c.guard_reason.trim() === "") errors.push(`${where}: "guard_reason" must be a non-empty string`);
      else if (c.abstain_if_present === void 0 && c.abstain_unless_all_present === void 0 && c.abstain_if === void 0 && c.abstain_if_present_without === void 0) warnings.push(`${where}: "guard_reason" is set but the check has no abstain guard`);
    }
    if (c.abstain_if_present_without !== void 0) {
      const list = c.abstain_if_present_without;
      if (!Array.isArray(list) || list.length === 0 || list.some((g) => !g || typeof g !== "object" || typeof g.present !== "string" || typeof g.without !== "string")) {
        errors.push(`${where}: "abstain_if_present_without" must be a non-empty array of { present, without } role names`);
      } else for (const g of list) for (const r of [g.present, g.without]) {
        usedRoles.add(r);
        if (!allRoles.has(r)) errors.push(`${where}."abstain_if_present_without": unknown role "${r}"`);
        else if (scope === "line" && !lineRoles.has(r)) errors.push(`${where}."abstain_if_present_without": a line-scope check can only name line fields ("${r}" is not one)`);
        else if (scope === "document" && lineRoles.has(r)) errors.push(`${where}."abstain_if_present_without": a document-scope check cannot name the per-line field "${r}"`);
      }
    }
    if (c.rounding !== void 0) {
      if (isIdentifier) errors.push(`${where}: "rounding" applies to numeric checks only`);
      else if (!VALID_ROUNDING.has(c.rounding)) errors.push(`${where}: invalid rounding "${String(c.rounding)}" (none | infer)`);
    }
    if (c.alternatives !== void 0) {
      if (isIdentifier) errors.push(`${where}: "alternatives" apply to numeric checks only`);
      else if (!Array.isArray(c.alternatives) || c.alternatives.length === 0) errors.push(`${where}: "alternatives" must be a non-empty array of { left, right }`);
      else c.alternatives.forEach((a, j) => {
        const aw = `${where}.alternatives[${j}]`;
        if (!a || typeof a !== "object") {
          errors.push(`${aw}: must be an object { left, right }`);
          return;
        }
        for (const side of ["left", "right"]) checkSide(a[side], `${aw}."${side}"`, aw, scope);
      });
    }
    for (const key of ["abstain_unless_all_present", "abstain_if_present"]) {
      const list = c[key];
      if (list === void 0) continue;
      if (!Array.isArray(list) || list.length === 0 || list.some((x) => typeof x !== "string")) {
        errors.push(`${where}: "${key}" must be a non-empty array of role names`);
        continue;
      }
      for (const r of list) {
        usedRoles.add(r);
        if (!allRoles.has(r)) errors.push(`${where}."${key}": unknown role "${r}"`);
        else if (scope === "line" && !lineRoles.has(r)) errors.push(`${where}."${key}": a line-scope check can only name line fields ("${r}" is not one)`);
        else if (scope === "document" && lineRoles.has(r)) errors.push(`${where}."${key}": a document-scope check cannot name the per-line field "${r}"`);
      }
    }
    if (c.abstain_if !== void 0) {
      if (!Array.isArray(c.abstain_if) || c.abstain_if.length === 0) errors.push(`${where}: "abstain_if" must be a non-empty array of { left, op, right }`);
      else c.abstain_if.forEach((g, j) => {
        const gw = `${where}.abstain_if[${j}]`;
        if (!g || typeof g !== "object") {
          errors.push(`${gw}: must be an object { left, op, right }`);
          return;
        }
        if (!VALID_GUARD_OPS.has(g.op)) errors.push(`${gw}: invalid op "${String(g.op)}" (= != < <= > >=)`);
        if (g.tol !== void 0 && !(typeof g.tol === "number" && g.tol >= 0)) errors.push(`${gw}: "tol" must be a number >= 0`);
        for (const side of ["left", "right"]) checkSide(g[side], `${gw}."${side}"`, gw, scope);
      });
    }
    if (!isIdentifier) {
      const forms = [{ left: c.left, right: c.right }, ...Array.isArray(c.alternatives) ? c.alternatives : []];
      forms.forEach((f, j) => {
        if (!f || typeof f.left !== "string" || typeof f.right !== "string") return;
        try {
          const r = roleRefs(f.left, f.right);
          if (r.required.length === 0 && r.optional.length > 0) warnings.push(`${where}${j ? `.alternatives[${j - 1}]` : ""}: every operand is optional (${r.optional.join(", ")}); the form abstains when none of them is reported`);
        } catch {
        }
      });
    }
  };
  R.checks.forEach((c, i) => {
    const where = `check[${i}]${c.code ? ` (${c.code})` : ""}`;
    if (typeof c.code !== "string" || c.code.length === 0) errors.push(`${where}: missing "code"`);
    if (!VALID_OPS.has(c.op)) errors.push(`${where}: invalid op "${c.op}"`);
    const scope = c.scope ?? "document";
    if (c.compare !== void 0 && !VALID_COMPARE.has(c.compare)) {
      errors.push(`${where}: invalid compare "${String(c.compare)}" (number | identifier)`);
      return;
    }
    if (c.compare === "identifier") {
      if (c.op !== "=" && c.op !== "!=") errors.push(`${where}: an identifier check supports only = and !=`);
      for (const side of ["left", "right"]) {
        const name = typeof c[side] === "string" ? c[side].trim() : "";
        usedRoles.add(name);
        const f = Object.prototype.hasOwnProperty.call(fields, name) ? fields[name] : void 0;
        if (!f || f.kind !== "identifier") errors.push(`${where}."${side}": an identifier check must name an 'identifier' field (got "${name}")`);
        else if (!!f.line !== (scope === "line")) errors.push(`${where}."${side}": "${name}" is a ${f.line ? "line" : "document"} field but the check is ${scope}-scope`);
      }
      checkNewOptions(c, where, scope, true);
      return;
    }
    for (const side of ["left", "right"]) checkSide(c[side], `${where}."${side}"`, where, scope);
    checkNewOptions(c, where, scope, false);
  });
  const referencedByComputed = /* @__PURE__ */ new Set();
  for (const formula of Object.values(computed2)) for (const r of safeRefs(formula)) referencedByComputed.add(r);
  for (const r of allRoles) if (!usedRoles.has(r) && !referencedByComputed.has(r)) warnings.push(`role "${r}" is defined but never used in a check`);
  return { ok: errors.length === 0, errors, warnings };
}

// packages/verify/src/bench/score.ts
var div = (a, b) => b === 0 ? 0 : a / b;
function bucket(label, j) {
  if (j === "INSUFFICIENT_DATA") return "abstain";
  if (label === "ERROR") return j === "FAIL" ? "tp" : "fn";
  return j === "FAIL" ? "fp" : "tn";
}
function score(rows) {
  const c = { tp: 0, tn: 0, fp: 0, fn: 0, abstain: 0, total: rows.length };
  for (const r of rows) c[bucket(r.label, r.judgment)]++;
  const covered = c.tp + c.tn + c.fp + c.fn;
  return {
    ...c,
    fp_rate: div(c.fp, c.fp + c.tn),
    fn_rate: div(c.fn, c.fn + c.tp),
    abstain_rate: div(c.abstain, c.total),
    precision: div(c.tp, c.tp + c.fp),
    recall: div(c.tp, c.tp + c.fn),
    coverage: div(covered, c.total)
  };
}

// packages/verify/src/declarative/measure.ts
function measureRuleset(ruleset, cases) {
  const rows = cases.map((c) => ({ label: c.label, judgment: verifyDeclarative(c.extraction, ruleset).outcome }));
  const metrics = score(rows);
  const measured_on = sha256(canonicalize({ ruleset: { id: ruleset.id, version: ruleset.version }, cases }));
  const accuracy = {
    domain: ruleset.domain ?? ruleset.id,
    ruleset_version: ruleset.version,
    fp_rate: metrics.fp_rate,
    fn_rate: metrics.fn_rate,
    abstain_rate: metrics.abstain_rate,
    measured_on
  };
  return { accuracy, metrics, rows };
}

// packages/verify/src/protocol/verdict-id.ts
function deriveVerdictId(input_hash, ruleset, engine_version) {
  return sha256(`${input_hash}:${ruleset.id}@${ruleset.version}:${engine_version}`).slice(0, 32);
}

// packages/verify/src/verdict/notices.ts
var disputeCommand = (verdict_id, claim_id) => `verify opinion --ledger <chain.jsonl> --dispute ${verdict_id}${claim_id !== void 0 ? ` --claim ${claim_id}` : ""}`;
var ACTION_HANDLING = {
  record: { FAIL: "SURFACE", INSUFFICIENT_DATA: "SURFACE", PASS: "UNCHANGED", delivery: "notice", every_fail_disputable: true },
  advise: { FAIL: "SURFACE", INSUFFICIENT_DATA: "SURFACE", PASS: "UNCHANGED", delivery: "in-flow", every_fail_disputable: true },
  gate: { FAIL: "HOLD", INSUFFICIENT_DATA: "HOLD", PASS: "HUMAN_REVIEW", delivery: "in-flow", every_fail_disputable: true },
  autonomy: { FAIL: "HOLD", INSUFFICIENT_DATA: "HOLD", PASS: "ACT_WITHIN_BOUNDS", delivery: "in-flow", every_fail_disputable: true }
};
function findingOf(v, c) {
  return {
    claim_id: c.claim_id,
    rule_id: c.rule_id,
    rule_name: c.rule_name,
    outcome: c.outcome,
    field: c.field,
    asserted: c.asserted,
    // A boolean computation result is a rule's pass/fail bit (e.g. GROUNDED), not a value the claim should have had.
    // Rendering it as "expected false" misled (delivery-lane finding F2, 2026-09-28), so only real values are "expected".
    ...c.computation && typeof c.computation.result !== "boolean" ? { expected: c.computation.result } : {},
    ...c.variance !== void 0 ? { variance: c.variance } : {},
    explanation: c.explanation,
    evidence: c.evidence.map((e) => ({ ...e })),
    ...c.insufficiency ? { insufficiency: { ...c.insufficiency } } : {},
    dispute: disputeCommand(v.verdict_id, c.claim_id)
  };
}
function verdictFindings(verdict) {
  const det = verdict.claims.filter((c) => c.tier === "DETERMINISTIC");
  const reasoned = verdict.claims.filter((c) => c.tier !== "DETERMINISTIC" && (c.outcome === "PASS" || c.outcome === "FAIL")).length;
  const fail = det.some((c) => c.outcome === "FAIL");
  const checked = det.filter((c) => c.outcome !== "INSUFFICIENT_DATA").length;
  const aggregated = fail ? "FAIL" : checked === 0 ? "INSUFFICIENT_DATA" : "PASS";
  const rank3 = { PASS: 0, INSUFFICIENT_DATA: 1, FAIL: 2 };
  const allDet = det.length === verdict.claims.length;
  const detInsufficient = det.some((c) => c.outcome === "INSUFFICIENT_DATA");
  const floor = allDet ? verdict.outcome : verdict.outcome === "INSUFFICIENT_DATA" && detInsufficient ? "INSUFFICIENT_DATA" : "PASS";
  const outcome = rank3[floor] > rank3[aggregated] ? floor : aggregated;
  return {
    verdict_id: verdict.verdict_id,
    outcome,
    findings: [...det.filter((c) => c.outcome === "FAIL"), ...det.filter((c) => c.outcome === "INSUFFICIENT_DATA")].map((c) => findingOf(verdict, c)),
    advisories: reasoned,
    dispute: disputeCommand(verdict.verdict_id)
  };
}
function actionNotice(verdict, level) {
  const handling = ACTION_HANDLING[level];
  if (!handling) throw new RangeError(`unknown rung ${JSON.stringify(level)} (record | advise | gate | autonomy)`);
  const f = verdictFindings(verdict);
  const action = f.outcome === "PASS" ? "PROCEED" : handling[f.outcome] === "HOLD" ? "HOLD" : "SURFACE";
  return { ...f, level, handling, action };
}
var val = (v) => v === void 0 ? "\u2014" : JSON.stringify(v);
function evidenceLine(e) {
  const where = e.locator.kind === "field" ? `${e.locator.source}:${e.locator.path}` : `span ${e.locator.source_hash.slice(0, 12)}\u2026[${e.locator.start}..${e.locator.end}]`;
  const orig = e.original !== void 0 ? ` (read as ${val(e.original)})` : "";
  return `  - \`${where}\` = ${val(e.value)}${orig} \xB7 confidence ${e.confidence}`;
}
function renderFindings(f) {
  const L = [];
  for (const x of f.findings.filter((y) => y.outcome === "FAIL")) {
    L.push(`- \u2717 **${x.rule_name}** (\`${x.claim_id}\`) on \`${x.field}\`: ${x.explanation}`);
    if (x.expected !== void 0) L.push(`  - asserted ${val(x.asserted)} \xB7 expected ${val(x.expected)}${x.variance !== void 0 ? ` \xB7 variance ${x.variance}` : ""}`);
    L.push(...x.evidence.map(evidenceLine));
    L.push(`  - dispute this finding: \`${x.dispute}\``);
  }
  for (const x of f.findings.filter((y) => y.outcome === "INSUFFICIENT_DATA")) {
    L.push(`- \u26A0 **${x.rule_name}** (\`${x.claim_id}\`) could not run: ${x.insufficiency?.reason ?? "INSUFFICIENT_DATA"}: ${x.insufficiency?.detail ?? x.explanation}`);
    L.push(`  - dispute this finding: \`${x.dispute}\``);
  }
  if (f.advisories > 0) L.push(`- ${f.advisories} judgement-tier finding(s) on this verdict are advisories (COUNSEL): shown with their evidence, never held.`);
  return L;
}
function renderActionNotice(n) {
  const what = n.outcome === "FAIL" ? "a check FAILed" : "the checks could not decide (ABSTAIN)";
  const head = n.action === "HOLD" ? `**HELD for a person** \xB7 rung \`${n.level}\` \xB7 verdict \`${n.verdict_id}\` \xB7 ${what}. It stays held until a person resolves it.` : n.action === "SURFACE" ? `**${n.outcome === "FAIL" ? "FAIL" : "ABSTAIN"}: surfaced, not held** \xB7 rung \`${n.level}\` (${n.handling.delivery === "in-flow" ? "shown in-flow to the person and the agent" : "a notice on the record"}) \xB7 verdict \`${n.verdict_id}\` \xB7 ${what}. Dispute it if you disagree.` : `**PROCEED** \xB7 rung \`${n.level}\` \xB7 verdict \`${n.verdict_id}\` \xB7 every deterministic check that ran held (a PASS here: ${n.handling.PASS === "ACT_WITHIN_BOUNDS" ? "proceeds unreviewed within the declared bounds" : n.handling.PASS === "HUMAN_REVIEW" ? "goes to human review" : "Riposte does not intervene"}).`;
  return [head, "", ...renderFindings(n), "", `Dispute the whole verdict: \`${n.dispute}\``, ""].join("\n");
}

// packages/verify/src/verdict/channel.ts
var ChannelViolation = class extends Error {
  constructor(message2) {
    super(message2);
    this.name = "ChannelViolation";
  }
};
var isObj2 = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
function channelOf(x) {
  if (!isObj2(x)) return void 0;
  if (x.channel === "COUNSEL") return "COUNSEL";
  const prov = x.provenance;
  if (isObj2(prov) && prov.type === "GENERATED") return "COUNSEL";
  if (typeof x.verdict_id === "string" && Array.isArray(x.claims) && typeof x.outcome === "string") return "VERDICT";
  return void 0;
}
function proofProblem(x, opts = {}) {
  if (channelOf(x) === "COUNSEL") {
    return "COUNSEL can never be presented as a VERDICT: it is generated (channel COUNSEL or provenance GENERATED) and dismissible, not checked against a binding source";
  }
  if (!isObj2(x) || channelOf(x) !== "VERDICT") return "not a verdict: a VERDICT is a proof object with verdict_id, outcome and claims";
  if (x.channel !== void 0 && x.channel !== "VERDICT") return `a verdict cannot carry channel ${JSON.stringify(x.channel)}`;
  const v = x;
  if (v.replayable !== true) return `verdict ${v.verdict_id} does not assert replayable: true`;
  if (typeof v.input_hash !== "string" || !isObj2(v.ruleset) || typeof v.engine_version !== "string") {
    return `verdict ${v.verdict_id} lacks the reproducibility contract (input_hash, ruleset, engine_version)`;
  }
  const expected = deriveVerdictId(v.input_hash, v.ruleset, v.engine_version);
  if (expected !== v.verdict_id) {
    return `verdict ${v.verdict_id} is not bound to its inputs: its id does not derive from input_hash + ruleset@version + engine_version (expected ${expected})`;
  }
  for (const c of v.claims) {
    if (c.outcome !== "PASS" && c.outcome !== "FAIL") continue;
    if (!Array.isArray(c.evidence) || c.evidence.length === 0) return `claim ${c.claim_id} is ${c.outcome} without evidence; an unevidenced finding is not a VERDICT`;
    if (c.tier !== "DETERMINISTIC" && !opts.allowReasoned) {
      return `claim ${c.claim_id} is a judgement-tier (${c.tier}) finding: judgement is COUNSEL (an advisory with a strength), never a VERDICT. Surface it with counselFromReasoned`;
    }
  }
  return void 0;
}
function assertVerdict(x) {
  const problem = proofProblem(x);
  if (problem) throw new ChannelViolation(problem);
}

// packages/verify/src/verdict/bounds.ts
var A = [3.3871328727963665, 133.14166789178438, 1971.5909503065513, 13731.69376550946, 45921.95393154987, 67265.7709270087, 33430.57558358813, 2509.0809287301227];
var B = [1, 42.31333070160091, 687.1870074920579, 5394.196021424751, 21213.794301586597, 39307.89580009271, 28729.085735721943, 5226.495278852854];
var C = [1.4234371107496835, 4.630337846156546, 5.769497221460691, 3.6478483247632045, 1.2704582524523684, 0.2417807251774506, 0.022723844989269184, 7745450142783414e-19];
var D4 = [1, 2.053191626637759, 1.6763848301838038, 0.6897673349851, 0.14810397642748008, 0.015198666563616457, 5475938084995345e-19, 10507500716444169e-25];
var E = [6.657904643501103, 5.463784911164114, 1.7848265399172913, 0.29656057182850487, 0.026532189526576124, 0.0012426609473880784, 27115555687434876e-21, 20103343992922881e-23];
var F = [1, 0.599832206555888, 0.1369298809227358, 0.014875361290850615, 7868691311456133e-19, 18463183175100548e-21, 1421511758316446e-22, 20442631033899397e-31];
function poly(c, x) {
  let s = 0;
  for (let i = c.length - 1; i >= 0; i--) s = s * x + c[i];
  return s;
}
function normalQuantile(p) {
  if (!(p > 0 && p < 1)) throw new RangeError(`normalQuantile needs 0 < p < 1 (got ${p})`);
  const q = p - 0.5;
  if (Math.abs(q) <= 0.425) {
    const r3 = 0.180625 - q * q;
    return q * poly(A, r3) / poly(B, r3);
  }
  let r = Math.sqrt(-Math.log(q < 0 ? p : 1 - p));
  let val2;
  if (r <= 5) {
    r -= 1.6;
    val2 = poly(C, r) / poly(D4, r);
  } else {
    r -= 5;
    val2 = poly(E, r) / poly(F, r);
  }
  return q < 0 ? -val2 : val2;
}
function binomialCdf(k, n, p) {
  if (k < 0) return 0;
  if (k >= n) return 1;
  if (p <= 0) return 1;
  if (p >= 1) return 0;
  const lp = Math.log(p), lq = Math.log1p(-p);
  let lt = n * lq;
  const terms = [lt];
  let max = lt;
  for (let i = 0; i < k; i++) {
    lt += Math.log(n - i) - Math.log(i + 1) + lp - lq;
    terms.push(lt);
    if (lt > max) max = lt;
  }
  let s = 0;
  for (const t of terms) s += Math.exp(t - max);
  return Math.min(1, Math.exp(max + Math.log(s)));
}
var ITER = 200;
var up = (x) => Math.min(1, Math.ceil(x * 1e12) / 1e12);
var down = (x) => Math.max(0, Math.floor(x * 1e12) / 1e12);
function check(k, n, confidence) {
  if (!Number.isInteger(n) || n < 0) throw new RangeError(`n must be a non-negative integer (got ${n})`);
  if (!Number.isInteger(k) || k < 0 || k > n) throw new RangeError(`k must be an integer in [0, n] (got k=${k}, n=${n})`);
  if (!(confidence >= 0.5 && confidence < 1)) throw new RangeError(`confidence must be in [0.5, 1) (got ${confidence})`);
}
function wilsonInterval(k, n, confidence) {
  check(k, n, confidence);
  if (n === 0) return { lower: 0, upper: 1 };
  const z = normalQuantile(confidence);
  const ph = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = ph + z2 / (2 * n);
  const half = z * Math.sqrt(ph * (1 - ph) / n + z2 / (4 * n * n));
  return {
    lower: k === 0 ? 0 : down((centre - half) / denom),
    upper: k === n ? 1 : up((centre + half) / denom)
  };
}
function clopperPearsonInterval(k, n, confidence) {
  check(k, n, confidence);
  if (n === 0) return { lower: 0, upper: 1 };
  const alpha = 1 - confidence;
  let upper = 1;
  if (k < n) {
    let lo = 0, hi = 1;
    for (let i = 0; i < ITER; i++) {
      const mid = (lo + hi) / 2;
      if (binomialCdf(k, n, mid) > alpha) lo = mid;
      else hi = mid;
    }
    upper = up(hi);
  }
  let lower = 0;
  if (k > 0) {
    let lo = 0, hi = 1;
    for (let i = 0; i < ITER; i++) {
      const mid = (lo + hi) / 2;
      if (binomialCdf(k - 1, n, mid) > confidence) lo = mid;
      else hi = mid;
    }
    lower = down(lo);
  }
  return { lower, upper };
}
function oneSidedLevel(confidence, sidedness) {
  if (sidedness === "one-sided") return confidence;
  if (sidedness === "two-sided") return 1 - (1 - confidence) / 2;
  throw new RangeError(`unknown sidedness ${JSON.stringify(sidedness)} (declare 'one-sided' or 'two-sided')`);
}
function rateInterval(k, n, confidence, method, sidedness = "one-sided") {
  const c = oneSidedLevel(confidence, sidedness);
  if (method === "wilson") return wilsonInterval(k, n, c);
  if (method === "clopper-pearson") return clopperPearsonInterval(k, n, c);
  throw new RangeError(`unknown bound method ${JSON.stringify(method)} (declare 'wilson' or 'clopper-pearson')`);
}
function describeBound(confidence, method, sidedness = "one-sided") {
  return `${Number((confidence * 100).toPrecision(3))}% ${sidedness} ${method}`;
}
var N_CAP = 1e9;
function zeroMissN(bar, confidence, method, sidedness = "one-sided") {
  if (!(bar > 0 && bar < 1)) throw new RangeError(`bar must be in (0, 1) (got ${bar})`);
  const ok2 = (n) => rateInterval(0, n, confidence, method, sidedness).upper <= bar;
  let hi = 1;
  while (!ok2(hi)) {
    hi *= 2;
    if (hi > N_CAP) throw new RangeError(`no n \u2264 ${N_CAP} clears ${bar} at ${describeBound(confidence, method, sidedness)}`);
  }
  let lo = Math.floor(hi / 2);
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (ok2(mid)) hi = mid;
    else lo = mid;
  }
  return hi;
}
function successLowerBound(caught, n, confidence, method, sidedness = "one-sided") {
  if (n === 0) return 0;
  return Math.max(0, 1 - rateInterval(n - caught, n, confidence, method, sidedness).upper);
}

// packages/verify/src/ledger/calibration.ts
var DEFAULT_MIN_REVIEWED = 5;
var DEFAULT_FLAG_THRESHOLD = 0.2;
function ruleCalibration(records, opts = {}) {
  const min_reviewed = opts.min_reviewed ?? DEFAULT_MIN_REVIEWED;
  const flag_threshold = opts.flag_threshold ?? DEFAULT_FLAG_THRESHOLD;
  const acc = /* @__PURE__ */ new Map();
  for (const rec of records) {
    if (!rec.review) continue;
    const overturned = rec.review.decision === "OVERTURNED";
    const domain = rec.verdict.ruleset.domain;
    const failingRules = /* @__PURE__ */ new Map();
    for (const c of rec.verdict.claims) {
      if (c.outcome === "FAIL") failingRules.set(c.rule_id, { rule_id: c.rule_id, rule_name: c.rule_name });
    }
    for (const { rule_id, rule_name } of failingRules.values()) {
      const key = `${domain}\0${rule_id}`;
      let r = acc.get(key);
      if (!r) {
        r = { rule_id, rule_name, domain, reviewed: 0, upheld: 0, overturned: 0, overturn_rate: 0 };
        acc.set(key, r);
      }
      r.reviewed++;
      if (overturned) r.overturned++;
      else r.upheld++;
    }
  }
  const rules = [...acc.values()];
  for (const r of rules) r.overturn_rate = r.reviewed === 0 ? 0 : r.overturned / r.reviewed;
  rules.sort((a, b) => b.overturn_rate - a.overturn_rate || b.reviewed - a.reviewed || a.rule_id.localeCompare(b.rule_id));
  const flagged = rules.filter((r) => r.reviewed >= min_reviewed && r.overturn_rate >= flag_threshold);
  return { rules, flagged, params: { min_reviewed, flag_threshold } };
}

// packages/verify/src/ledger/decisions.ts
import { createPrivateKey, createPublicKey as createPublicKey2, sign as edSign, verify as edVerify } from "node:crypto";

// packages/verify/src/ledger/chain.ts
var GENESIS = sha256("verify-ledger:genesis:v1");
function payloadHash(payload) {
  return hashOf(payload);
}
function entryHash(seq, prev_hash, payload_hash) {
  return sha256(`${seq}:${prev_hash}:${payload_hash}`);
}
function linkEvent(seq, prev_hash, e) {
  const payload_hash = payloadHash(e.payload);
  const entry_hash = entryHash(seq, prev_hash, payload_hash);
  return { seq, ts: e.ts, type: e.type, verdict_id: e.verdict_id, payload_hash, prev_hash, entry_hash };
}
var PAYLOAD_VIEW = /* @__PURE__ */ Symbol("riposte.ledger.payload-view");
function payloadViewOf(payloads) {
  if (!payloads || typeof payloads !== "object") return void 0;
  const info = payloads[PAYLOAD_VIEW];
  return info && typeof info === "object" && info.store ? info : void 0;
}
var PREFIX = /* @__PURE__ */ new WeakMap();
function certifyPrefix(events, prefix) {
  if (prefix.through <= 0 || prefix.through > events.length) return;
  PREFIX.set(events, prefix);
}
function prefixOf(events) {
  return PREFIX.get(events);
}
function forgetPrefix(events) {
  PREFIX.delete(events);
}
function usablePrefix(events, payloadOf, payloads) {
  const p = PREFIX.get(events);
  if (!p || p.through <= 0 || p.through > events.length || events[p.through - 1].entry_hash !== p.head) return void 0;
  const certified = payloadViewOf(p.payloads);
  if (certified) {
    const handed = payloadViewOf(payloads);
    if (!handed || handed.store !== certified.store || handed.pristine < p.through) return void 0;
    for (let i = 0; i < p.through; i++) if (events[i] !== p.events[i]) return void 0;
    return p;
  }
  for (let i = 0; i < p.through; i++) if (events[i] !== p.events[i] || payloadOf(events[i]) !== p.payloads[i]) return void 0;
  return p;
}
function verifyChain(events) {
  let prev = GENESIS;
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (ev.seq !== i) return { ok: false, length: events.length, head: prev, brokenAt: i, reason: `seq ${ev.seq} out of order (expected ${i})` };
    if (ev.prev_hash !== prev) return { ok: false, length: events.length, head: prev, brokenAt: i, reason: `prev_hash at ${i} does not link to the previous entry` };
    if (entryHash(ev.seq, ev.prev_hash, ev.payload_hash) !== ev.entry_hash) return { ok: false, length: events.length, head: prev, brokenAt: i, reason: `entry_hash at ${i} does not recompute` };
    prev = ev.entry_hash;
  }
  return { ok: true, length: events.length, head: prev };
}
function verifyChainFrom(events, from, head) {
  let prev = head;
  for (let i = from; i < events.length; i++) {
    const ev = events[i];
    if (ev.seq !== i) return { ok: false, length: events.length, head: prev, brokenAt: i, reason: `seq ${ev.seq} out of order (expected ${i})` };
    if (ev.prev_hash !== prev) return { ok: false, length: events.length, head: prev, brokenAt: i, reason: `prev_hash at ${i} does not link to the previous entry` };
    if (entryHash(ev.seq, ev.prev_hash, ev.payload_hash) !== ev.entry_hash) return { ok: false, length: events.length, head: prev, brokenAt: i, reason: `entry_hash at ${i} does not recompute` };
    prev = ev.entry_hash;
  }
  return { ok: true, length: events.length, head: prev };
}
function verifyChainAgainst(events, payloadOf, opts = {}) {
  const prefix = usablePrefix(events, payloadOf, opts.payloads);
  const from = prefix?.through ?? 0;
  const structural = prefix ? verifyChainFrom(events, from, prefix.head) : verifyChain(events);
  if (!structural.ok) return structural;
  opts.onPrefix?.(from);
  for (let i = from; i < events.length; i++) {
    const ev = events[i];
    const payload = payloadOf(ev);
    if (payloadHash(payload) !== ev.payload_hash) return { ok: false, length: events.length, head: structural.head, brokenAt: i, reason: `payload at ${i} was altered (payload_hash mismatch)` };
    opts.onVerified?.(i, payload);
  }
  return prefix ? { ...structural, reused: { through: prefix.through, verified_at: prefix.verified_at } } : structural;
}

// packages/verify/src/ledger/registry.ts
import { createPublicKey } from "node:crypto";
var ROLES = ["key_admin", "policy_author", "reviewer", "grant_signer", "witness"];
var isRole = (r) => ROLES.includes(r);
var ROLE_FOR = {
  GRANT: "grant_signer",
  GRANT_COSIGN: "grant_signer",
  DECLINE: "grant_signer",
  POLICY_REVISION: "policy_author",
  CANARY_SEAL: "policy_author",
  CANARY_REVEAL: "policy_author",
  REVIEW: "reviewer",
  KEY_REGISTER: "key_admin",
  KEY_REVOKE: "key_admin"
};
function keyFingerprint(pem) {
  try {
    const k = createPublicKey(pem);
    if (k.asymmetricKeyType !== "ed25519") return void 0;
    return sha256(k.export({ type: "spki", format: "der" }).toString("base64"));
  } catch {
    return void 0;
  }
}
function tenantOfWorkflow(workflow_id) {
  const i = workflow_id.indexOf("/");
  return i > 0 ? workflow_id.slice(0, i) : void 0;
}
var KeyRegistry = class {
  roots = /* @__PURE__ */ new Set();
  keys = /* @__PURE__ */ new Map();
  /** Chain position of the first KEY_REGISTER applied. The registry governs every signed item AFTER it. */
  started;
  constructor(root_keys) {
    for (const pem of root_keys ?? []) {
      const fp = keyFingerprint(pem);
      if (!fp) throw new Error("a root key must be an Ed25519 public key (SPKI PEM)");
      this.roots.add(fp);
    }
  }
  /** True when a root key was supplied (the registry can be in force). */
  get rooted() {
    return this.roots.size > 0;
  }
  isRoot(pem) {
    const fp = keyFingerprint(pem);
    return fp !== void 0 && this.roots.has(fp);
  }
  /** In force for an item at `seq`: rooted, and a KEY_REGISTER sits at an earlier position. */
  inForceAt(seq) {
    return this.rooted && this.started !== void 0 && this.started < seq;
  }
  entry(pem) {
    const fp = keyFingerprint(pem);
    return fp === void 0 ? void 0 : this.keys.get(fp);
  }
  /**
   * Was `pem` an active key of `subject_id`, holding `role`, at chain position `seq`, for this act? `tenant` is the tenant the
   * act concerns (a workflow's or a record's); undefined means a deployment-wide act (a policy revision, a key event).
   */
  holds(seq, subject_id, pem, role, tenant) {
    const e = this.entry(pem);
    if (!e || e.registered.seq >= seq) return { ok: false, reason: `the signing key is not registered on the book (as of position ${seq}): only a registered key can sign once the registry is in force` };
    if (e.revoked && e.revoked.seq < seq) return { ok: false, reason: `the signing key of '${e.subject_id}' was revoked at position ${e.revoked.seq} (${e.revoked.reason}); it signs nothing after that` };
    if (e.subject_id !== subject_id) return { ok: false, reason: `the signing key is registered to '${e.subject_id}', not '${subject_id}'` };
    if (!e.roles.includes(role)) return { ok: false, reason: `'${subject_id}' holds ${e.roles.join(", ")}; this needs the '${role}' role (segregation of duties)` };
    if (e.tenants) {
      if (tenant === void 0) return { ok: false, reason: `'${subject_id}''s key is scoped to tenant(s) ${e.tenants.join(", ")}: it cannot sign a deployment-wide act` };
      if (!e.tenants.includes(tenant)) return { ok: false, reason: `'${subject_id}''s key is scoped to tenant(s) ${e.tenants.join(", ")}, not ${tenant}: one tenant's key never decides for another's workflow (F-B)` };
    }
    return { ok: true };
  }
  /**
   * Why a KEY event at `seq`, signed by `pem`, may not be applied (undefined: it may). Authority: the root key, a registered
   * `key_admin`, or (KEY_REVOKE only) the key itself. Consistency: a key is registered once, to one subject, and a revoked key
   * stays revoked.
   */
  keyEventProblem(seq, d, pem) {
    if (!this.rooted) return "the key registry is anchored to a root key: open the ledger with root_keys";
    const fp = keyFingerprint(d.public_key);
    if (!fp) return "public_key must be an Ed25519 public key (SPKI PEM)";
    const selfRevoke = d.kind === "KEY_REVOKE" && keyFingerprint(pem) === fp && d.signer_id === d.subject_id;
    const root2 = this.isRoot(pem);
    const admin = !root2 && !selfRevoke && this.inForceAt(seq) ? this.entry(pem) : void 0;
    const authorized = root2 || selfRevoke || admin !== void 0 && this.holds(seq, d.signer_id, pem, "key_admin", admin.tenants?.[0]).ok;
    if (!authorized) return `a ${d.kind} must be signed by the registry root key or a registered 'key_admin'${d.kind === "KEY_REVOKE" ? " (or by the key itself)" : ""}`;
    const e = this.keys.get(fp);
    const within = (t) => !admin?.tenants || !!t && t.length > 0 && t.every((x) => admin.tenants.includes(x));
    if (d.kind === "KEY_REGISTER") {
      if (e?.revoked) return `this key was revoked at position ${e.revoked.seq}: a revoked key is never re-registered (rotate: register a new key)`;
      if (e) return `this key is already registered to '${e.subject_id}' (position ${e.registered.seq})`;
      if (!within(d.tenants)) return `'${d.signer_id}' keeps tenant(s) ${admin.tenants.join(", ")} only: it registers keys scoped within them`;
      return void 0;
    }
    if (!e) return "KEY_REVOKE names a key that is not registered";
    if (e.subject_id !== d.subject_id) return `the key is registered to '${e.subject_id}', not '${d.subject_id}'`;
    if (e.revoked) return `the key was already revoked at position ${e.revoked.seq}`;
    if (!within(e.tenants)) return `'${d.signer_id}' keeps tenant(s) ${admin.tenants.join(", ")} only: this key reaches beyond them`;
    return void 0;
  }
  /** Apply a KEY event that passed keyEventProblem. */
  apply(seq, decision_id, d) {
    const fp = keyFingerprint(d.public_key);
    if (d.kind === "KEY_REGISTER") {
      this.keys.set(fp, {
        fingerprint: fp,
        subject_id: d.subject_id,
        public_key: d.public_key,
        roles: [...d.roles ?? []].sort(),
        ...d.tenants ? { tenants: [...d.tenants].sort() } : {},
        registered: { seq, decision_id, by: d.signer_id }
      });
      if (this.started === void 0) this.started = seq;
      return;
    }
    const e = this.keys.get(fp);
    e.revoked = { seq, decision_id, by: d.signer_id, reason: d.reason ?? "" };
  }
  /** Every key ever registered, in registration order (cloned). */
  snapshot() {
    return [...this.keys.values()].sort((a, b) => a.registered.seq - b.registered.seq).map((e) => structuredClone(e));
  }
};

// packages/verify/src/ledger/disk.ts
import { createHash as createHash2 } from "node:crypto";
import { closeSync, openSync, readSync } from "node:fs";
var LedgerFileChanged = class extends Error {
  path;
  /** The event whose line changed. */
  seq;
  /** Where its line starts. */
  offset;
  constructor(path, seq, offset, why) {
    super(
      `the book at ${path} changed on disk after this process read it: the line of event seq ${seq} (byte ${offset}) ${why}. A book of record is append-only. Reopen it to check what the file holds now (the first check of a reopened book re-hashes every event), and treat the file as tampered until you know why.`
    );
    this.name = "LedgerFileChanged";
    this.path = path;
    this.seq = seq;
    this.offset = offset;
  }
};
var lineDigest = (bytes) => createHash2("sha256").update(bytes).digest();
var WINDOW = 4 << 20;
var SEQUENTIAL_GAP = 64 << 10;
function arrayIndex(k) {
  if (typeof k !== "string" || k.length === 0 || k.length > 15) return void 0;
  const c0 = k.charCodeAt(0);
  if (c0 < 48 || c0 > 57 || c0 === 48 && k.length > 1) return void 0;
  for (let j = 1; j < k.length; j++) {
    const c = k.charCodeAt(j);
    if (c < 48 || c > 57) return void 0;
  }
  return Number(k);
}
var HOLE = /* @__PURE__ */ Symbol("deleted");
var MARK = /* @__PURE__ */ Symbol("ledger.evidence-mark");
function evidenceMark(v) {
  const known = v !== null && typeof v === "object" ? v[MARK] : void 0;
  if (known !== void 0) return known;
  if (channelOf(v) === "COUNSEL") return "COUNSEL";
  const claims = v?.claims;
  return Array.isArray(claims) && claims.some((c) => c && c.tier === "REASONED" && (c.outcome === "PASS" || c.outcome === "FAIL")) ? "REASONED" : "VERDICT";
}
var OUTCOMES = /* @__PURE__ */ new Set(["PASS", "FAIL", "INSUFFICIENT_DATA"]);
var verdictStub = (c, verdict_id) => ({ verdict_id, outcome: c.outcome, ruleset: c.ruleset, engine_version: c.engine_version, [MARK]: c.mark });
var RECORD_FACTS = /* @__PURE__ */ Symbol("riposte.ledger.record-facts");
function recordFacts(rec) {
  const f = rec !== null && typeof rec === "object" ? rec[RECORD_FACTS] : void 0;
  return typeof f === "function" ? f(rec) : void 0;
}
function recordFactsAt(payloads, i) {
  const info = payloadViewOf(payloads);
  return info && info.store instanceof DiskPayloads && i < info.pristine && i < payloads.length ? info.store.factsAt(i) : void 0;
}
var DiskPayloads = class {
  path;
  #n = 0;
  #off = new Float64Array(1024);
  /** Line length; 0: the payload is in the heap (#resident). */
  #len = new Uint32Array(1024);
  #digest = Buffer.alloc(1024 * 32);
  #resident = /* @__PURE__ */ new Map();
  #cache = /* @__PURE__ */ new Map();
  #cacheMax;
  #fd;
  #win = Buffer.alloc(0);
  #winStart = 0;
  #winEnd = 0;
  /** The ledger's own payloads: a live view (its length follows the book). */
  own;
  /** Lines read back from disk (cache misses). */
  reads = 0;
  /** P-J: each position's fact class (0: none: not a RECORD, or one read in full), and a RECORD's own strings (shared, not copied). */
  #cls = new Uint32Array(1024);
  #classes = [];
  #classKeys = /* @__PURE__ */ new Map();
  #ids = [];
  #recordedAt = [];
  #retention = [];
  constructor(path, opts = {}) {
    this.path = path;
    this.#cacheMax = Math.max(1, opts.cache ?? 256);
    this.own = this.view();
  }
  get length() {
    return this.#n;
  }
  /**
   * Keep the next event's payload: on disk at `line` (a RECORD's), or in the heap. A RECORD's calibration facts are learned here
   * (P-J), from the payload as parsed at open or as written; `event` lends its verdict id and time, so neither is held twice.
   */
  push(payload, line3, event) {
    if (this.#n === this.#len.length) {
      const cap = this.#n * 2;
      const off = new Float64Array(cap);
      off.set(this.#off);
      this.#off = off;
      const len = new Uint32Array(cap);
      len.set(this.#len);
      this.#len = len;
      const dig = Buffer.alloc(cap * 32);
      this.#digest.copy(dig);
      this.#digest = dig;
      const cls = new Uint32Array(cap);
      cls.set(this.#cls);
      this.#cls = cls;
    }
    const i = this.#n++;
    const onDisk = line3 !== void 0 && line3.length > 0;
    if (onDisk) {
      this.#off[i] = line3.offset;
      this.#len[i] = line3.length;
      line3.digest.copy(this.#digest, i * 32);
    } else {
      this.#len[i] = 0;
      this.#resident.set(i, payload);
    }
    this.#learn(i, onDisk ? payload : void 0, event);
  }
  /** P-J: a RECORD's calibration facts, when every one is a plain value (else none: its readers read it in full). */
  #learn(i, payload, event) {
    const p = payload;
    const v = p !== null && typeof p === "object" ? p.verdict : void 0;
    const r = v !== null && typeof v === "object" ? v.ruleset : void 0;
    if (!p || p.type !== "RECORD" || typeof p.tenant_id !== "string" || typeof p.recorded_at !== "string" || typeof p.retention_until !== "string" || !v || Array.isArray(v) || typeof v.verdict_id !== "string" || !OUTCOMES.has(v.outcome) || typeof v.engine_version !== "string" || !r || typeof r !== "object" || typeof r.id !== "string" || typeof r.version !== "string") {
      this.#cls[i] = 0;
      this.#ids[i] = this.#recordedAt[i] = this.#retention[i] = void 0;
      return;
    }
    const mark = evidenceMark(v);
    const key = JSON.stringify([p.tenant_id, v.outcome, r.id, r.version, v.engine_version, mark]);
    let k = this.#classKeys.get(key);
    if (k === void 0) {
      this.#classes.push(Object.freeze({ tenant_id: p.tenant_id, outcome: v.outcome, ruleset: Object.freeze({ id: r.id, version: r.version }), engine_version: v.engine_version, mark }));
      k = this.#classes.length;
      this.#classKeys.set(key, k);
    }
    this.#cls[i] = k;
    this.#ids[i] = event && event.verdict_id === v.verdict_id ? event.verdict_id : v.verdict_id;
    this.#recordedAt[i] = event && event.ts === p.recorded_at ? event.ts : p.recorded_at;
    this.#retention[i] = p.retention_until;
  }
  /** P-J: event i's RECORD payload as a calibration reads it, from the index (no read of the file); undefined when it has none. */
  factsAt(i) {
    const k = i >= 0 && i < this.#n ? this.#cls[i] : 0;
    if (k === 0) return void 0;
    const c = this.#classes[k - 1];
    return { type: "RECORD", tenant_id: c.tenant_id, recorded_at: this.#recordedAt[i], retention_until: this.#retention[i], verdict: verdictStub(c, this.#ids[i]) };
  }
  /** P-J: event i's verdict as a calibration reads it, from the index; undefined when it has none. */
  verdictFactsAt(i) {
    const k = i >= 0 && i < this.#n ? this.#cls[i] : 0;
    return k === 0 ? void 0 : verdictStub(this.#classes[k - 1], this.#ids[i]);
  }
  /** Event i's payload: from the heap, the read cache, or its line (checked against its digest, then parsed). */
  at(i) {
    if (!(i >= 0 && i < this.#n)) return void 0;
    if (this.#len[i] === 0) return this.#resident.get(i);
    const hit = this.#cache.get(i);
    if (hit !== void 0) {
      this.#cache.delete(i);
      this.#cache.set(i, hit);
      return hit;
    }
    const p = this.#load(i);
    this.#cache.set(i, p);
    if (this.#cache.size > this.#cacheMax) this.#cache.delete(this.#cache.keys().next().value);
    return p;
  }
  /** Forget the read cache and the read-ahead window: the next read of every payload comes from the file (a full check). */
  forget() {
    this.#cache.clear();
    this.#winStart = this.#winEnd = 0;
  }
  /** Release the read handle (the next read opens it again). Idempotent. */
  close() {
    if (this.#fd === void 0) return;
    const fd = this.#fd;
    this.#fd = void 0;
    this.#winStart = this.#winEnd = 0;
    closeSync(fd);
  }
  #load(i) {
    const offset = this.#off[i];
    const length = this.#len[i];
    const bytes = this.#bytes(i, offset, length);
    if (lineDigest(bytes).compare(this.#digest, i * 32, i * 32 + 32) !== 0) throw new LedgerFileChanged(this.path, i, offset, "no longer holds the bytes it held");
    this.reads++;
    return JSON.parse(bytes.toString("utf8").trim()).payload;
  }
  /** The bytes of one line: from the read-ahead window, else read (a window ahead when the reads run in order). */
  #bytes(i, offset, length) {
    if (offset >= this.#winStart && offset + length <= this.#winEnd) return this.#win.subarray(offset - this.#winStart, offset - this.#winStart + length);
    const sequential = this.#winEnd > 0 && offset >= this.#winEnd && offset - this.#winEnd <= SEQUENTIAL_GAP;
    const size = sequential ? Math.max(length, WINDOW) : length;
    if (this.#win.length < size) this.#win = Buffer.allocUnsafe(size);
    this.#fd ??= openSync(this.path, "r");
    let got = 0;
    while (got < size) {
      const n = readSync(this.#fd, this.#win, got, size - got, offset + got);
      if (n <= 0) break;
      got += n;
    }
    this.#winStart = offset;
    this.#winEnd = offset + got;
    if (got < length) {
      this.#winStart = this.#winEnd = 0;
      throw new LedgerFileChanged(this.path, i, offset, "is cut short (the file is shorter than when it was read)");
    }
    return this.#win.subarray(0, length);
  }
  /**
   * An array of payloads 0 … length−1 read on demand (no argument: the live book). The holder may edit its copy (set, delete,
   * push, a shorter length): edits stay in the view, never reach the book, and mark it touched from that position (PAYLOAD_VIEW).
   */
  view(length) {
    const edits = /* @__PURE__ */ new Map();
    let len = length;
    const size = () => len ?? this.#n;
    const info = { store: this, pristine: Infinity };
    const touch = (i) => {
      if (i < info.pristine) info.pristine = i;
    };
    const read = (i) => {
      if (i >= size()) return void 0;
      if (edits.has(i)) {
        const v = edits.get(i);
        return v === HOLE ? void 0 : v;
      }
      return this.at(i);
    };
    const present = (i) => i < size() && edits.get(i) !== HOLE;
    return new Proxy([], {
      get(t, k, r) {
        if (k === PAYLOAD_VIEW) return info;
        if (k === "length") return size();
        const i = arrayIndex(k);
        return i === void 0 ? Reflect.get(t, k, r) : read(i);
      },
      set(t, k, v) {
        if (k === "length") {
          const n = Number(v);
          if (!Number.isInteger(n) || n < 0) throw new RangeError("Invalid array length");
          if (n < size()) touch(n);
          for (const j of [...edits.keys()]) if (j >= n) edits.delete(j);
          len = n;
          return true;
        }
        const i = arrayIndex(k);
        if (i === void 0) return Reflect.set(t, k, v);
        touch(i);
        edits.set(i, v);
        if (i >= size()) len = i + 1;
        return true;
      },
      deleteProperty(t, k) {
        const i = arrayIndex(k);
        if (i === void 0) return Reflect.deleteProperty(t, k);
        if (i < size()) {
          touch(i);
          edits.set(i, HOLE);
        }
        return true;
      },
      has(t, k) {
        if (k === "length") return true;
        const i = arrayIndex(k);
        return i === void 0 ? Reflect.has(t, k) : present(i);
      },
      getOwnPropertyDescriptor(t, k) {
        if (k === "length") return { value: size(), writable: true, enumerable: false, configurable: false };
        const i = arrayIndex(k);
        if (i === void 0) return Reflect.getOwnPropertyDescriptor(t, k);
        return present(i) ? { value: read(i), writable: true, enumerable: true, configurable: true } : void 0;
      },
      defineProperty(t, k, d) {
        const i = arrayIndex(k);
        if (i === void 0 || k === "length") return Reflect.defineProperty(t, k, d);
        touch(i);
        edits.set(i, d.value);
        if (i >= size()) len = i + 1;
        return true;
      },
      ownKeys() {
        const keys = [];
        for (let i = 0, n = size(); i < n; i++) if (present(i)) keys.push(String(i));
        keys.push("length");
        return keys;
      }
    });
  }
};

// packages/verify/src/ledger/sampling.ts
var PERIOD_UNITS = ["day", "month", "quarter"];
var isPeriodUnit = (u) => PERIOD_UNITS.includes(u);
var PERIOD_LENGTH_RANK = { day: 0, month: 1, quarter: 2 };
var STRATA = ["PASS", "FAIL"];
var SAMPLE_SEED_PREFIX = "riposte:sample-seed:v0\n";
var iso = (ms2) => new Date(ms2).toISOString();
function periodAt(ms2, unit) {
  const d = new Date(ms2);
  const y = d.getUTCFullYear(), m = d.getUTCMonth();
  if (unit === "day") {
    const s = Date.UTC(y, m, d.getUTCDate());
    return { start: iso(s), end: iso(s + 864e5) };
  }
  if (unit === "month") return { start: iso(Date.UTC(y, m, 1)), end: iso(Date.UTC(y, m + 1, 1)) };
  const q = Math.floor(m / 3) * 3;
  return { start: iso(Date.UTC(y, q, 1)), end: iso(Date.UTC(y, q + 3, 1)) };
}
function nextPeriodEnd(start, unit) {
  const cur = periodAt(Date.parse(start), unit);
  return periodAt(Date.parse(cur.end), unit).end;
}
function chainClock(events) {
  let max;
  for (const ev of events) {
    const t = Date.parse(ev.ts);
    if (Number.isFinite(t) && (max === void 0 || t > max)) max = t;
  }
  return max;
}
function chainPeriods(events, unit) {
  const out = [];
  let max = -Infinity;
  for (let i = 0; i < events.length; i++) {
    const t = Date.parse(events[i].ts);
    if (Number.isFinite(t) && t > max) max = t;
    if (!Number.isFinite(max)) continue;
    const p = periodAt(max, unit);
    const last = out[out.length - 1];
    if (last && last.start === p.start) {
      last.last_seq = i;
      continue;
    }
    if (last) last.closed_by = i;
    out.push({ unit, start: p.start, end: p.end, first_seq: i, last_seq: i });
  }
  return out;
}
function recordWorkflow(p) {
  const q = p;
  const r = q?.verdict?.ruleset;
  if (!q || q.type !== "RECORD" || typeof q.tenant_id !== "string" || !r || typeof r.id !== "string" || typeof r.version !== "string") return void 0;
  return `${q.tenant_id}/${r.id}@${r.version}`;
}
function isEvidence(v) {
  return evidenceMark(v) === "VERDICT";
}
function periodFrame(events, payloads, workflow_id, span) {
  const latest = /* @__PURE__ */ new Map();
  for (let i = span.first_seq; i <= span.last_seq; i++) {
    if (events[i]?.type !== "RECORD") continue;
    const p = recordFactsAt(payloads, i) ?? payloads[i];
    if (recordWorkflow(p) !== workflow_id) continue;
    const v = p.verdict;
    if (typeof v.verdict_id !== "string") continue;
    const o = v.outcome;
    latest.set(v.verdict_id, isEvidence(v) && (o === "PASS" || o === "FAIL") ? o : void 0);
  }
  const out = { PASS: [], FAIL: [] };
  for (const [id, s] of latest) if (s) out[s].push(id);
  out.PASS.sort();
  out.FAIL.sort();
  return out;
}
function sampleSeed(workflow_id, unit, start, epoch_hash) {
  return sha256(SAMPLE_SEED_PREFIX + canonicalize({ workflow_id, unit, start, epoch_hash }));
}
function drawSize(rate, n) {
  if (!(rate > 0) || n <= 0) return 0;
  return Math.min(n, Math.ceil(rate * n - 1e-9));
}
function drawStratum(ids, seed, stratum, rate) {
  const k = drawSize(rate, ids.length);
  if (k === 0) return [];
  return ids.map((id) => ({ id, key: sha256(`${seed}:${stratum}:${id}`) })).sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : a.id < b.id ? -1 : 1).slice(0, k).map((x) => x.id).sort();
}
function sampleSubject(s) {
  return `sample:${s.workflow_id}:${s.period.unit}:${s.period.start}`;
}
function sampleKey(s) {
  return `${s.workflow_id}|${s.period.unit}|${s.period.start}|${s.rates.PASS}|${s.rates.FAIL}`;
}
var SampleRefused = class extends Error {
  constructor(message2) {
    super(message2);
    this.name = "SampleRefused";
  }
};
var validRate = (r) => typeof r === "number" && Number.isFinite(r) && r >= 0 && r <= 1;
function deriveSample(events, payloads, req, spans) {
  if (typeof req.workflow_id !== "string" || !req.workflow_id) return { problem: "a sample names its workflow_id" };
  if (!isPeriodUnit(req.unit)) return { problem: `period unit must be one of ${PERIOD_UNITS.join(", ")}` };
  if (!req.rates || !validRate(req.rates.PASS) || !validRate(req.rates.FAIL)) return { problem: "rates.PASS and rates.FAIL must be fractions in [0, 1]" };
  if (req.rates.PASS === 0 && req.rates.FAIL === 0) return { problem: "a sample draws something: at least one rate must be above 0" };
  const span = (spans ?? chainPeriods(events, req.unit)).find((s) => s.start === req.start);
  if (!span) return { problem: `no event on the book falls in the ${req.unit} starting ${req.start}` };
  if (span.closed_by === void 0) return { problem: `the ${req.unit} starting ${req.start} has not closed (no later event on the book yet): its epoch, and so its draw, is not fixed` };
  const frame = periodFrame(events, payloads, req.workflow_id, span);
  if (frame.PASS.length + frame.FAIL.length === 0) return { problem: `nothing to draw: no PASS or FAIL verdict of ${req.workflow_id} was recorded in that ${req.unit}` };
  const epoch = events[span.last_seq];
  const seed = sampleSeed(req.workflow_id, req.unit, span.start, epoch.entry_hash);
  return {
    sample_version: "sample-v0",
    workflow_id: req.workflow_id,
    period: { unit: req.unit, start: span.start, end: span.end },
    frame: { first_seq: span.first_seq, last_seq: span.last_seq },
    epoch: { seq: epoch.seq, entry_hash: epoch.entry_hash },
    closed_by: span.closed_by,
    seed,
    rates: { PASS: req.rates.PASS, FAIL: req.rates.FAIL },
    population: { PASS: frame.PASS.length, FAIL: frame.FAIL.length },
    selected: { PASS: drawStratum(frame.PASS, seed, "PASS", req.rates.PASS), FAIL: drawStratum(frame.FAIL, seed, "FAIL", req.rates.FAIL) }
  };
}

// packages/verify/src/ledger/decisions.ts
var DECISION_KINDS = ["GRANT", "DECLINE", "POLICY_REVISION"];
var isDecisionKind = (t) => DECISION_KINDS.includes(t);
var BOOK_DECISION_KINDS = [...DECISION_KINDS, "KEY_REGISTER", "KEY_REVOKE", "CANARY_SEAL", "CANARY_REVEAL", "GRANT_COSIGN"];
var isBookDecisionKind = (t) => BOOK_DECISION_KINDS.includes(t);
function decisionEventType(kind) {
  return kind === "GRANT_COSIGN" ? "GRANT" : kind;
}
var DECISION_LEVELS = ["record", "advise", "gate", "autonomy"];
var RUNG_NAMES = ["advise", "gate", "autonomy"];
var rank = (l) => DECISION_LEVELS.indexOf(l);
var DECISION_SIGNING_PREFIX = "riposte:decision:v0\n";
var CANARY_COMMIT_PREFIX = "riposte:canary:v0\n";
var DecisionRefused = class extends Error {
  constructor(message2) {
    super(message2);
    this.name = "DecisionRefused";
  }
};
var isObj3 = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
var nonEmpty = (x) => typeof x === "string" && x.trim().length > 0;
var ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
var isIso = (x) => typeof x === "string" && ISO.test(x) && Number.isFinite(Date.parse(x));
var HEX64 = /^[0-9a-f]{64}$/;
var HEX32 = /^[0-9a-f]{32}$/;
var SALT = /^[0-9a-f]{32,}$/;
var isLevel = (x) => DECISION_LEVELS.includes(x);
var isNat = (x) => Number.isInteger(x) && x >= 0;
var MAX_SIGNATURES = 5;
var isStrArr = (x) => Array.isArray(x) && x.every((s) => typeof s === "string");
var sortedUnique = (a) => a.every((s, i) => i === 0 || a[i - 1] < s);
function extraKeys(o, allowed) {
  return Object.keys(o).filter((k) => !allowed.includes(k) && o[k] !== void 0);
}
function refProblem(r, at3) {
  if (!isObj3(r)) return `${at3} must be a policy reference { policy_id, version, hash }`;
  if (!nonEmpty(r.policy_id) || !nonEmpty(r.version)) return `${at3} needs policy_id and version`;
  if (typeof r.hash !== "string" || !HEX64.test(r.hash)) return `${at3}.hash must be a sha256 hex digest`;
  const extra = extraKeys(r, ["policy_id", "version", "hash"]);
  if (extra.length) return `${at3} carries unknown field(s) ${extra.join(", ")}`;
  return void 0;
}
var BASE_KEYS = ["decision_version", "kind", "signer_id", "signed_at", "note"];
var ALLOWED_KEYS = {
  GRANT: [...BASE_KEYS, "workflow_id", "level", "consequence_tier", "policy", "bounds", "answers", "signatures", "succeeds"],
  GRANT_COSIGN: [...BASE_KEYS, "workflow_id", "grant", "level"],
  DECLINE: [...BASE_KEYS, "workflow_id", "proposal_id", "proposal_kind", "from", "to", "consequence_tier", "policy", "under_grant", "reason", "seen"],
  POLICY_REVISION: [...BASE_KEYS, "policy", "supersedes", "reason", "changes", "policy_body"],
  KEY_REGISTER: [...BASE_KEYS, "subject_id", "public_key", "roles", "tenants"],
  KEY_REVOKE: [...BASE_KEYS, "subject_id", "public_key", "reason"],
  CANARY_SEAL: [...BASE_KEYS, "workflow_id", "commitment"],
  CANARY_REVEAL: [...BASE_KEYS, "workflow_id", "seal", "verdict_ids", "salt"],
  REVIEW: [...BASE_KEYS, "verdict_id", "tenant_id", "decision", "procedure"]
};
function decisionProblem(d) {
  if (!isObj3(d)) return "a decision must be an object";
  if (d.decision_version !== "decision-v0") return `decision_version must be 'decision-v0'`;
  if (!isBookDecisionKind(d.kind) && d.kind !== "REVIEW") return `kind must be one of ${[...BOOK_DECISION_KINDS, "REVIEW"].join(", ")}`;
  if (!nonEmpty(d.signer_id)) return "a decision is a person's: it needs signer_id";
  if (!isIso(d.signed_at)) return "signed_at must be an ISO-8601 timestamp with a zone";
  if (d.note !== void 0 && typeof d.note !== "string") return "note must be a string";
  const extra = extraKeys(d, ALLOWED_KEYS[d.kind]);
  if (extra.length) return `a ${String(d.kind)} carries unknown field(s) ${extra.join(", ")}`;
  if (d.kind === "GRANT") {
    if (!nonEmpty(d.workflow_id)) return "a GRANT names its workflow_id";
    if (!isLevel(d.level)) return `level must be one of ${DECISION_LEVELS.join(", ")}`;
    if (!nonEmpty(d.consequence_tier)) return "a GRANT is made at a consequence_tier";
    const rp2 = refProblem(d.policy, "policy");
    if (rp2) return rp2;
    if (d.bounds !== void 0 && !nonEmpty(d.bounds)) return "bounds, when given, must be words";
    if (d.level === "autonomy" && !nonEmpty(d.bounds)) return 'a GRANT of autonomy must state the bounds it acts within (a person writes them, even "all")';
    if (d.answers !== void 0 && !nonEmpty(d.answers)) return "answers, when given, is a proposal_id";
    if (d.signatures !== void 0 && !(Number.isInteger(d.signatures) && d.signatures >= 2 && d.signatures <= MAX_SIGNATURES)) {
      return `signatures, when given, is an integer from 2 to ${MAX_SIGNATURES} (absent means one: this signer alone)`;
    }
    if (d.succeeds !== void 0) return successionShapeProblem(d.workflow_id, d.succeeds, d.answers !== void 0);
    return void 0;
  }
  if (d.kind === "GRANT_COSIGN") {
    if (!nonEmpty(d.workflow_id)) return "a GRANT_COSIGN names its workflow_id";
    if (typeof d.grant !== "string" || !HEX32.test(d.grant)) return "grant must be the decision_id of the GRANT co-signed";
    if (!isLevel(d.level)) return `level must be one of ${DECISION_LEVELS.join(", ")} (the grant's level, restated)`;
    return void 0;
  }
  if (d.kind === "DECLINE") {
    if (!nonEmpty(d.workflow_id)) return "a DECLINE names its workflow_id";
    if (!nonEmpty(d.proposal_id)) return "a DECLINE names the proposal it answers (proposal_id)";
    if (d.proposal_kind !== "PROMOTION_PROPOSAL" && d.proposal_kind !== "DEMOTION_PROPOSAL") return `proposal_kind must be PROMOTION_PROPOSAL or DEMOTION_PROPOSAL`;
    if (!isLevel(d.from) || !isLevel(d.to)) return `from and to must be rungs (${DECISION_LEVELS.join(", ")})`;
    const step = rank(d.to) - rank(d.from);
    if (d.proposal_kind === "PROMOTION_PROPOSAL" && step !== 1) return "a promotion proposal is one rung up (from \u2192 to)";
    if (d.proposal_kind === "DEMOTION_PROPOSAL" && step !== -1) return "a demotion proposal is one rung down (from \u2192 to)";
    if (!nonEmpty(d.consequence_tier)) return "a DECLINE names the consequence_tier of the proposal";
    const rp2 = refProblem(d.policy, "policy");
    if (rp2) return rp2;
    if (d.under_grant !== void 0 && !nonEmpty(d.under_grant)) return "under_grant, when given, is the decision_id of the grant in force";
    if (!nonEmpty(d.reason)) return "a DECLINE is a person's recorded decision: it needs a reason";
    const s = d.seen;
    if (!isObj3(s)) return "a DECLINE records the evidence the person saw (seen)";
    const sx = extraKeys(s, ["calibration_hash", "rungs", "failing_cases", "blockers"]);
    if (sx.length) return `seen carries unknown field(s) ${sx.join(", ")}`;
    if (typeof s.calibration_hash !== "string" || !HEX64.test(s.calibration_hash)) return "seen.calibration_hash must be a sha256 hex digest";
    if (!Array.isArray(s.rungs)) return "seen.rungs must be an array";
    for (const r of s.rungs) {
      if (!isObj3(r) || !RUNG_NAMES.includes(r.rung) || !isNat(r.n) || !isNat(r.errors) || r.errors > r.n) return "each seen rung is { rung, n, errors } with 0 \u2264 errors \u2264 n";
      if (extraKeys(r, ["rung", "n", "errors"]).length) return "a seen rung carries only rung, n, errors";
    }
    if (!isStrArr(s.failing_cases) || !isStrArr(s.blockers)) return "seen.failing_cases and seen.blockers must be string arrays";
    if (d.proposal_kind === "PROMOTION_PROPOSAL" && s.failing_cases.length) return "a promotion proposal lists no failing cases";
    return void 0;
  }
  if (d.kind === "KEY_REGISTER" || d.kind === "KEY_REVOKE") {
    if (!nonEmpty(d.subject_id)) return `a ${d.kind} names the person the key belongs to (subject_id)`;
    if (typeof d.public_key !== "string" || !keyFingerprint(d.public_key)) return "public_key must be an Ed25519 public key (SPKI PEM)";
    if (d.kind === "KEY_REGISTER") {
      if (!Array.isArray(d.roles) || d.roles.length === 0 || !d.roles.every(isRole)) return `roles must be a non-empty list drawn from ${ROLES.join(", ")}`;
      if (new Set(d.roles).size !== d.roles.length) return "roles must not repeat";
      if (d.tenants !== void 0 && (!isStrArr(d.tenants) || d.tenants.length === 0 || !d.tenants.every(nonEmpty) || !sortedUnique(d.tenants))) return "tenants, when given, is a sorted, unique, non-empty list of tenant ids";
      return void 0;
    }
    if (!nonEmpty(d.reason)) return "a KEY_REVOKE records why (reason)";
    return void 0;
  }
  if (d.kind === "CANARY_SEAL") {
    if (!nonEmpty(d.workflow_id)) return "a CANARY_SEAL names its workflow_id";
    if (typeof d.commitment !== "string" || !HEX64.test(d.commitment)) return "commitment must be a sha256 hex digest (canaryCommitment)";
    return void 0;
  }
  if (d.kind === "CANARY_REVEAL") {
    if (!nonEmpty(d.workflow_id)) return "a CANARY_REVEAL names its workflow_id";
    if (typeof d.seal !== "string" || !HEX32.test(d.seal)) return "seal must be the decision_id of the CANARY_SEAL it opens";
    if (!isStrArr(d.verdict_ids) || d.verdict_ids.length === 0 || !d.verdict_ids.every(nonEmpty)) return "verdict_ids must name at least one verdict";
    if (!sortedUnique(d.verdict_ids)) return "verdict_ids must be sorted and unique (the commitment is over the canonical set)";
    if (typeof d.salt !== "string" || !SALT.test(d.salt)) return "salt must be at least 32 hex characters (128 bits): without it, the sealed set could be guessed";
    return void 0;
  }
  if (d.kind === "REVIEW") {
    if (!nonEmpty(d.verdict_id)) return "a REVIEW names the verdict it reviews (verdict_id)";
    if (d.tenant_id !== void 0 && !nonEmpty(d.tenant_id)) return "tenant_id, when given, names the tenant whose record is reviewed";
    if (d.decision !== "UPHELD" && d.decision !== "OVERTURNED") return "a REVIEW decides UPHELD or OVERTURNED";
    if (d.procedure !== void 0 && d.procedure !== "re-performed" && d.procedure !== "inspected") return `procedure, when given, is 're-performed' or 'inspected'`;
    return void 0;
  }
  const rp = refProblem(d.policy, "policy");
  if (rp) return rp;
  const sp = refProblem(d.supersedes, "supersedes");
  if (sp) return sp;
  const pol = d.policy, sup = d.supersedes;
  if (sup.policy_id !== pol.policy_id) return "a revision supersedes a version of the same policy_id";
  if (sup.version === pol.version) return "a revision must carry a new version";
  if (sup.hash === pol.hash) return "a revision must change the policy (its hash equals the one it supersedes)";
  if (!nonEmpty(d.reason)) return "a POLICY_REVISION records why (reason)";
  if (!isStrArr(d.changes) || d.changes.length === 0) return "a POLICY_REVISION records what changed (changes)";
  const body = d.policy_body;
  if (!isObj3(body) || body.policy_version !== "promotion-policy-v0") return "policy_body must be the full revised promotion policy";
  if (body.policy_id !== pol.policy_id || body.version !== pol.version) return "policy_body must be the version named by policy";
  if (hashOf(body) !== pol.hash) return "policy.hash does not match policy_body (the hash of the full revised policy)";
  const expected = { supersedes: sup, revised_by: d.signer_id, revised_at: d.signed_at, reason: d.reason, changes: d.changes };
  if (!isObj3(body.revision) || hashOf(body.revision) !== hashOf(expected)) {
    return "policy_body.revision must record exactly this decision: supersedes, revised_by = signer_id, revised_at = signed_at, reason and changes";
  }
  return void 0;
}
function rulesetWorkflow(workflow_id) {
  const m = /^([^/]+)\/(.+)@([^@/]+)$/.exec(workflow_id);
  return m ? { tenant: m[1], ruleset: m[2], version: m[3] } : void 0;
}
var OUTCOME_SET = ["PASS", "FAIL", "INSUFFICIENT_DATA"];
var loosens = (c) => c.to === "PASS" && c.from !== "PASS";
function successionShapeProblem(to, s, answers) {
  if (!isObj3(s)) return "succeeds, when given, is a succession { from, grant, reason, replay }";
  const extra = extraKeys(s, ["from", "grant", "reason", "replay", "loosening_reason"]);
  if (extra.length) return `succeeds carries unknown field(s) ${extra.join(", ")}`;
  if (answers) return "a succession answers no proposal: it carries a grant a person made, it is not a yes to a proposal";
  if (!nonEmpty(s.from)) return "a succession names the workflow it carries the grant from (succeeds.from)";
  const a = rulesetWorkflow(s.from), b = rulesetWorkflow(to);
  if (!a || !b) return `a succession is between versions of one ruleset: both workflows are <tenant>/<ruleset>@<version> (${s.from} \u2192 ${to})`;
  if (a.tenant !== b.tenant) return `a succession stays within a tenant: ${s.from} is ${a.tenant}'s, ${to} is ${b.tenant}'s`;
  if (a.ruleset !== b.ruleset) return `a succession carries a grant to another version of the same ruleset: ${a.ruleset} is not ${b.ruleset}`;
  if (a.version === b.version) return `a succession is to another version: ${s.from} is this workflow`;
  if (typeof s.grant !== "string" || !HEX32.test(s.grant)) return "succeeds.grant must be the decision_id of the GRANT in force on the old workflow";
  if (!nonEmpty(s.reason)) return "a succession is a person's recorded decision: it needs a reason (succeeds.reason)";
  const r = s.replay;
  if (r === void 0) return "a succession carries the replay of the old workflow's verdicts under the new ruleset (succeeds.replay): the signer signs knowing what the new rules would have said";
  if (!isObj3(r) || r.replay_version !== "succession-replay-v0") return "succeeds.replay must be a succession replay (replay_version succession-replay-v0; build it with successionReplay)";
  const rx = extraKeys(r, ["replay_version", "through", "head", "engine_version", "recorded", "reperformed", "changed"]);
  if (rx.length) return `succeeds.replay carries unknown field(s) ${rx.join(", ")}`;
  if (!isNat(r.through) || typeof r.head !== "string" || !HEX64.test(r.head)) return "succeeds.replay names the book it read: through (a count of events) and head (the entry_hash of the last)";
  if (!nonEmpty(r.engine_version)) return "succeeds.replay names the engine that re-performed the verdicts (engine_version)";
  if (!isNat(r.recorded) || !isNat(r.reperformed) || r.reperformed > r.recorded) return "succeeds.replay counts recorded \u2265 reperformed \u2265 0";
  if (!Array.isArray(r.changed)) return "succeeds.replay.changed must be an array";
  const ids = [];
  for (const c of r.changed) {
    if (!isObj3(c) || !nonEmpty(c.verdict_id) || !OUTCOME_SET.includes(c.from) || !OUTCOME_SET.includes(c.to) || extraKeys(c, ["verdict_id", "from", "to"]).length) {
      return "each replay change is { verdict_id, from, to } with outcomes PASS, FAIL or INSUFFICIENT_DATA";
    }
    if (c.from === c.to) return `replay change ${c.verdict_id} is not a change (${String(c.from)} both ways)`;
    ids.push(c.verdict_id);
  }
  if (!sortedUnique(ids)) return "succeeds.replay.changed must be sorted by verdict_id, each once";
  if (ids.length > r.reperformed) return "succeeds.replay lists more changes than verdicts re-performed";
  const loose = r.changed.filter(loosens).length;
  if (s.loosening_reason !== void 0 && !nonEmpty(s.loosening_reason)) return "loosening_reason, when given, must be words";
  if (loose > 0 && s.loosening_reason === void 0) {
    return `the replay shows ${loose} verdict(s) the new ruleset would PASS that were recorded as FAIL or INSUFFICIENT_DATA (it loosens): a person states why that is accepted (succeeds.loosening_reason)`;
  }
  if (loose === 0 && s.loosening_reason !== void 0) return "loosening_reason is for a replay that loosens; this one does not";
  return void 0;
}
function decisionId(d) {
  return hashOf(d).slice(0, 32);
}
function decisionSubject(d) {
  switch (d.kind) {
    case "POLICY_REVISION":
      return `policy:${d.policy.policy_id}@${d.policy.version}`;
    case "KEY_REGISTER":
    case "KEY_REVOKE":
      return `key:${d.subject_id}`;
    case "CANARY_SEAL":
    case "CANARY_REVEAL":
      return `canary:${d.workflow_id}`;
    default:
      return `workflow:${d.workflow_id}`;
  }
}
function canaryCommitment(workflow_id, verdict_ids, salt) {
  return sha256(CANARY_COMMIT_PREFIX + canonicalize({ workflow_id, verdict_ids: [...new Set(verdict_ids)].sort(), salt }));
}
var message = (d) => Buffer.from(DECISION_SIGNING_PREFIX + canonicalize(d), "utf8");
function spkiOf(pem) {
  try {
    return createPublicKey2(pem).export({ type: "spki", format: "der" }).toString("base64");
  } catch {
    return void 0;
  }
}
function verifySignature(s) {
  const no = (reason) => ({ ok: false, reason });
  if (!isObj3(s)) return no("not a signed decision");
  if (s.alg !== "ed25519") return no(`unsupported alg: ${String(s.alg)}`);
  if (typeof s.public_key !== "string" || typeof s.signature !== "string") return no("a signed decision carries public_key and signature");
  const extra = extraKeys(s, ["decision", "alg", "public_key", "signature", "decision_id"]);
  if (extra.length) return no(`a signed decision carries unknown field(s) ${extra.join(", ")}`);
  const problem = decisionProblem(s.decision);
  if (problem) return no(problem);
  const d = s.decision;
  if (s.decision_id !== decisionId(d)) return no("decision_id does not derive from the decision (altered after signing)");
  let sigOk = false;
  try {
    sigOk = edVerify(null, message(d), createPublicKey2(s.public_key), Buffer.from(s.signature, "base64"));
  } catch (e) {
    return no(`signature verification errored: ${e.message}`);
  }
  if (!sigOk) return no("signature does not verify: the decision was altered, or the key does not match");
  return { ok: true };
}
function trustedCheck(trusted_keys, signer_id, pem) {
  const anchoredKeys = trusted_keys[signer_id];
  if (anchoredKeys === void 0) return { ok: false, reason: `signer '${signer_id}' has no anchored key: only a person whose key is anchored can decide` };
  const mine2 = spkiOf(pem);
  const listed = (typeof anchoredKeys === "string" ? [anchoredKeys] : anchoredKeys).map(spkiOf);
  if (!mine2 || !listed.includes(mine2)) return { ok: false, reason: `the signing key is not the one anchored to signer '${signer_id}'` };
  return { ok: true };
}
function authorizeSigner(registry, seq, kind, signer_id, pem, trusted_keys, tenant) {
  if (registry.inForceAt(seq)) {
    const h = registry.holds(seq, signer_id, pem, ROLE_FOR[kind], tenant);
    return h.ok ? { ok: true, via: "registry" } : { ok: false, via: "registry", reason: h.reason };
  }
  if (trusted_keys) {
    const t = trustedCheck(trusted_keys, signer_id, pem);
    return t.ok ? { ok: true, via: "trusted_keys" } : { ok: false, via: "trusted_keys", reason: t.reason };
  }
  return { ok: true, via: "unanchored" };
}
function decisionTenant(d) {
  return d.kind === "GRANT" || d.kind === "GRANT_COSIGN" || d.kind === "DECLINE" || d.kind === "CANARY_SEAL" || d.kind === "CANARY_REVEAL" ? tenantOfWorkflow(d.workflow_id) : void 0;
}
function makeGrant(input) {
  const d = { decision_version: "decision-v0", kind: "GRANT", ...input, policy: { ...input.policy } };
  const problem = decisionProblem(d);
  if (problem) throw new DecisionRefused(problem);
  return d;
}
var OUTCOMES2 = /* @__PURE__ */ new Set(["PASS", "FAIL", "INSUFFICIENT_DATA"]);
var NAMED_AGGREGATIONS = new Set(AGGREGATIONS);
var EINVOICE_PRE_CORRECTION = /* @__PURE__ */ new Set(["0.1.0", "0.2.0"]);
var EINVOICE_AGGREGATION = "ANY_FAIL_FAILS_CONSISTENCY_ALONE_NEVER_PASSES";
function recordedVerdictProblem(x) {
  if (!isObj3(x)) return "not a verdict: not a JSON object";
  if (x.channel === "COUNSEL") return "COUNSEL (channel COUNSEL) is generated advice: it is never a recorded VERDICT";
  if (isObj3(x.provenance) && x.provenance.type === "GENERATED") return "generated material (provenance GENERATED) is never a recorded VERDICT";
  if ("counsel_version" in x || "opinion_version" in x || "dismissible" in x || "holds_action" in x) {
    return "carries the marks of COUNSEL (a counsel/opinion version, dismissible, holds_action): generated advice is never a recorded VERDICT";
  }
  const problem = proofProblem(x, { allowReasoned: true });
  if (problem) return problem;
  const v = x;
  if (v.schema_version !== "v0") return `verdict ${v.verdict_id}: schema_version ${JSON.stringify(v.schema_version)} is not v0`;
  if (typeof v.issued_at !== "string") return `verdict ${v.verdict_id}: issued_at is missing`;
  if (!OUTCOMES2.has(v.outcome)) return `verdict ${v.verdict_id}: outcome ${JSON.stringify(v.outcome)} is not PASS, FAIL or INSUFFICIENT_DATA (three outcomes, never a fourth)`;
  if (!NAMED_AGGREGATIONS.has(v.aggregation)) return `verdict ${v.verdict_id}: aggregation must be one of ${AGGREGATIONS.join(", ")} (a named rule)`;
  let pass = 0, fail = 0, ins = 0;
  for (const c of v.claims) {
    if (!isObj3(c) || typeof c.claim_id !== "string" || typeof c.rule_id !== "string") return `verdict ${v.verdict_id}: every claim needs a claim_id and a rule_id`;
    if (!OUTCOMES2.has(c.outcome)) return `verdict ${v.verdict_id}: claim ${c.claim_id} has outcome ${JSON.stringify(c.outcome)}`;
    if (c.outcome === "INSUFFICIENT_DATA") {
      ins++;
      if (!isObj3(c.insufficiency) || typeof c.insufficiency.reason !== "string") return `verdict ${v.verdict_id}: claim ${c.claim_id} abstains without an explained insufficiency`;
    } else {
      if (c.insufficiency !== void 0) return `verdict ${v.verdict_id}: claim ${c.claim_id} is ${String(c.outcome)} yet carries an insufficiency`;
      if (c.outcome === "PASS") pass++;
      else fail++;
    }
  }
  if (fail > 0 !== (v.outcome === "FAIL")) return `verdict ${v.verdict_id}: outcome ${v.outcome} does not follow from its claims under ${v.aggregation} (${fail} FAIL claim(s))`;
  if (v.outcome === "PASS" && pass === 0) return `verdict ${v.verdict_id}: outcome PASS with no PASS claim does not follow from its claims`;
  if (isObj3(v.ruleset) && v.ruleset.id === "action" && v.outcome === "PASS" && ins > 0) {
    return `verdict ${v.verdict_id}: an action verdict is PASS only when every value is grounded; ${ins} claim(s) could not be grounded, so its outcome is INSUFFICIENT_DATA`;
  }
  if (v.aggregation !== "ANY_FAIL_FAILS") {
    const expected = aggregateOutcome(v.aggregation, v.claims);
    if (v.outcome !== expected) return `verdict ${v.verdict_id}: outcome ${v.outcome} does not follow from its claims under ${v.aggregation} (they give ${expected}${expected === "INSUFFICIENT_DATA" && v.outcome === "PASS" ? ": only CONSISTENCY claims PASSed, and a document agreeing with itself never PASSes the values checked against it" : ""})`;
  }
  if (isObj3(v.ruleset) && typeof v.ruleset.id === "string" && v.ruleset.id.startsWith("twin-einvoice") && !EINVOICE_PRE_CORRECTION.has(v.ruleset.version) && v.aggregation !== EINVOICE_AGGREGATION) {
    return `verdict ${v.verdict_id}: an e-invoice twin verdict from 0.3.0 names aggregation ${EINVOICE_AGGREGATION} (its footing alone never makes it PASS), not ${v.aggregation}`;
  }
  const cov = v.coverage;
  if (!isObj3(cov) || cov.claims_total !== v.claims.length || cov.claims_pass !== pass || cov.claims_fail !== fail || cov.claims_insufficient !== ins || cov.claims_checked !== pass + fail) {
    return `verdict ${v.verdict_id}: coverage does not recount from its claims (${pass} PASS \xB7 ${fail} FAIL \xB7 ${ins} can't-tell of ${v.claims.length})`;
  }
  return void 0;
}
function readDecisionBook(events, payloads, opts = {}) {
  const read = readBookAs(events, payloads, opts);
  const explicit = opts.trusted_keys !== void 0 || opts.root_keys !== void 0 && opts.root_keys.length > 0;
  const own = explicit ? void 0 : OWN_READ.get(events);
  if (!own || !read.ok || own.check.length !== read.check.length || own.check.head !== read.check.head) return read;
  return structuredClone(own);
}
var OWN_READ = /* @__PURE__ */ new WeakMap();
var BookReader = class _BookReader {
  /** Throws when a root key is not an Ed25519 public key (the book then reads as not ok, after its hashes). */
  constructor(opts) {
    this.opts = opts;
    this.reg = new KeyRegistry(opts.root_keys);
  }
  opts;
  /** Events 0 … through−1 have been read. */
  through = 0;
  reg;
  decisions = [];
  keys = [];
  canaries = [];
  cosigns = [];
  unanchored = /* @__PURE__ */ new Set();
  samples = [];
  signed_reviews = [];
  recorded = /* @__PURE__ */ new Set();
  /** verdict id → every tenant that recorded it (one tenant, the common case, as the string itself). */
  owners = /* @__PURE__ */ new Map();
  latestOwner = /* @__PURE__ */ new Map();
  sampleKeys = /* @__PURE__ */ new Set();
  /** RULESET_SUCCESSION: workflow → the positions of its verdicts' first records, ascending (a replay is checked against them). */
  wfFirst = /* @__PURE__ */ new Map();
  #owned(id, tenant) {
    const o = this.owners.get(id);
    return o === tenant || o instanceof Set && o.has(tenant);
  }
  #own(id, tenant) {
    const o = this.owners.get(id);
    if (o === void 0) this.owners.set(id, tenant);
    else if (typeof o === "string") {
      if (o !== tenant) this.owners.set(id, /* @__PURE__ */ new Set([o, tenant]));
    } else o.add(tenant);
  }
  /** Read event i (its payload `p` already hash-verified): undefined, or why the book breaks there. Advances `through` when it reads. */
  step(events, payloads, i, p, spansOf) {
    const why = this.#read(events, payloads, i, p, spansOf);
    if (why === void 0) this.through = i + 1;
    return why;
  }
  #read(events, payloads, i, p, spansOf) {
    const { reg, opts, decisions, keys, canaries, cosigns, unanchored, samples, signed_reviews, recorded, latestOwner, sampleKeys } = this;
    const ev = events[i];
    const ptype = isObj3(p) ? p.type : void 0;
    if (ptype !== ev.type) return `event ${i} is labelled ${ev.type} but its hashed payload is ${String(ptype)}`;
    const q = p;
    if (ev.type === "RECORD") {
      const v = q.verdict;
      if (!isObj3(v) || v.verdict_id !== ev.verdict_id || q.recorded_at !== ev.ts) return `event ${i}'s header (verdict_id, ts) does not match its hashed RECORD payload`;
      const door = recordedVerdictProblem(v);
      if (door) return `event ${i} records something that does not pass the verdict door (${door}): only a well-formed VERDICT sits on the book of record`;
      recorded.add(ev.verdict_id);
      if (typeof q.tenant_id === "string") {
        const wf = this.#owned(ev.verdict_id, q.tenant_id) ? void 0 : recordWorkflow(p);
        if (wf !== void 0) {
          const at3 = this.wfFirst.get(wf);
          if (at3) at3.push(i);
          else this.wfFirst.set(wf, [i]);
        }
        this.#own(ev.verdict_id, q.tenant_id);
        latestOwner.set(ev.verdict_id, q.tenant_id);
      }
      return void 0;
    }
    if (ev.type === "REVIEW") {
      const r = q.review;
      if (q.verdict_id !== ev.verdict_id || !isObj3(r) || r.decided_at !== ev.ts) return `event ${i}'s header (verdict_id, ts) does not match its hashed REVIEW payload`;
      if (q.tenant_id !== void 0 && !(typeof q.tenant_id === "string" && this.#owned(ev.verdict_id, q.tenant_id))) {
        return `event ${i} reviews tenant ${String(q.tenant_id)}'s record of ${ev.verdict_id}, but that tenant never recorded it before`;
      }
      const reviewedTenant = typeof q.tenant_id === "string" ? q.tenant_id : latestOwner.get(ev.verdict_id);
      if (q.signed === void 0) return void 0;
      const sig2 = verifySignature(q.signed);
      if (!sig2.ok) return `signed review at ${i}: ${sig2.reason}`;
      const s = q.signed;
      const d2 = s.decision;
      if (d2.kind !== "REVIEW") return `event ${i} is a REVIEW but its signed body is a ${d2.kind}`;
      if (d2.verdict_id !== ev.verdict_id || r.reviewer_id !== d2.signer_id || r.decision !== d2.decision || (r.note ?? null) !== (d2.note ?? null) || d2.tenant_id !== void 0 && d2.tenant_id !== reviewedTenant) {
        return `event ${i}'s review (verdict, tenant, reviewer, decision, note) does not match the body its reviewer signed`;
      }
      if (!recorded.has(ev.verdict_id)) return `event ${i} signs a review of a verdict not recorded before it`;
      const a = authorizeSigner(reg, i, "REVIEW", d2.signer_id, s.public_key, opts.trusted_keys, reviewedTenant);
      if (!a.ok) return `signed review at ${i}: ${a.reason}`;
      if (a.via === "unanchored") unanchored.add(d2.signer_id);
      signed_reviews.push({
        seq: ev.seq,
        entry_hash: ev.entry_hash,
        verdict_id: ev.verdict_id,
        ...reviewedTenant !== void 0 ? { tenant_id: reviewedTenant } : {},
        decision_id: s.decision_id,
        signer_id: d2.signer_id,
        fingerprint: keyFingerprint(s.public_key),
        decision: d2.decision,
        ...d2.procedure ? { procedure: d2.procedure } : {},
        via: a.via
      });
      return void 0;
    }
    if (ev.type === "SAMPLE") {
      const body = q.sample;
      if (!isObj3(body) || !isObj3(body.period) || q.recorded_at !== ev.ts || ev.verdict_id !== sampleSubject(body)) return `event ${i}'s header (subject, ts) does not match its hashed SAMPLE payload`;
      const re = deriveSample(events, payloads, { workflow_id: body.workflow_id, unit: body.period.unit, start: body.period.start, rates: body.rates }, spansOf(body.period.unit));
      if ("problem" in re) return `sample at ${i}: ${re.problem}`;
      if (hashOf(re) !== hashOf(body)) return `sample at ${i} does not re-derive from the chain (an altered frame, seed or selection): anyone re-drawing gets a different queue`;
      if (re.closed_by >= i) return `sample at ${i} was drawn before its period closed (its epoch was not fixed)`;
      const key = sampleKey(re);
      if (sampleKeys.has(key)) return `sample at ${i} commits the same draw twice`;
      sampleKeys.add(key);
      samples.push({ seq: ev.seq, entry_hash: ev.entry_hash, recorded_at: ev.ts, sample: structuredClone(re) });
      return void 0;
    }
    if (!isBookDecisionKind(ev.type)) return `event ${i} has an unknown type ${String(ev.type)}`;
    const sig = verifySignature(q.signed);
    if (!sig.ok) return `decision at ${i}: ${sig.reason}`;
    const signed = q.signed;
    const d = signed.decision;
    if (decisionEventType(d.kind) !== ev.type) return `event ${i} is labelled ${ev.type} but the signed decision is a ${d.kind}`;
    if (ev.verdict_id !== decisionSubject(d) || q.recorded_at !== ev.ts) return `event ${i}'s header (subject, ts) does not match its signed decision`;
    let via;
    if (d.kind === "KEY_REGISTER" || d.kind === "KEY_REVOKE") {
      if (reg.rooted) {
        const kp = reg.keyEventProblem(i, d, signed.public_key);
        if (kp) return `decision at ${i}: ${kp}`;
        reg.apply(i, signed.decision_id, d);
      } else {
        unanchored.add(d.signer_id);
      }
    } else {
      const a = authorizeSigner(reg, i, d.kind, d.signer_id, signed.public_key, opts.trusted_keys, decisionTenant(d));
      if (!a.ok) return `decision at ${i}: ${a.reason}`;
      if (a.via === "unanchored") unanchored.add(d.signer_id);
      via = a.via;
    }
    const entry = {
      seq: ev.seq,
      entry_hash: ev.entry_hash,
      recorded_at: ev.ts,
      decision_id: signed.decision_id,
      signed: structuredClone(signed),
      ...via !== void 0 ? { via } : {},
      // RULESET_SUCCESSION: whether the replay matches the book is read here, where the chain is; a mismatch gives the grant
      // no effect (successionProblem), it does not break the book (the door cannot see the chain, so it could not refuse it).
      ...d.kind === "GRANT" && d.succeeds ? { replay: this.#replayCheck(events, payloads, i, d.succeeds) } : {}
    };
    if (d.kind === "CANARY_SEAL" || d.kind === "CANARY_REVEAL") {
      const c = canaryConflict(d, canaries, recorded);
      if (c) return `decision at ${i}: ${c}`;
      canaries.push(entry);
    } else if (d.kind === "GRANT_COSIGN") {
      const g = decisions.find((e) => e.decision_id === d.grant && e.signed.decision.kind === "GRANT");
      if (!g) return `decision at ${i}: a GRANT_COSIGN names grant ${d.grant}, which is not a GRANT earlier on the book`;
      if (g.signed.decision.workflow_id !== d.workflow_id || g.signed.decision.level !== d.level) {
        return `decision at ${i}: grant ${d.grant} sets ${g.signed.decision.workflow_id} at ${g.signed.decision.level}; the co-signature says ${d.workflow_id} at ${d.level}`;
      }
      const c = entry;
      if (!cosignProblem(c, g, g.cosigned ?? [], true)) (g.cosigned ??= []).push(cosignOf(c));
      cosigns.push(c);
    } else if (d.kind === "KEY_REGISTER" || d.kind === "KEY_REVOKE") {
      keys.push(entry);
    } else {
      decisions.push(entry);
    }
    return void 0;
  }
  /**
   * A succession's replay against the book: the span it names ends before the succession and at the head it names; it counts
   * exactly the verdicts recorded under `from` in that span; each changed verdict is one of them, recorded with the outcome
   * the replay says. (What the new ruleset says of each needs the documents: checkSuccessionReplay re-performs it.)
   */
  #replayCheck(events, payloads, i, s) {
    const no = (reason) => ({ matches: false, reason });
    const r = s.replay;
    if (r.through > i) return no(`it covers events 0 to ${r.through - 1}, past its own position (seq ${i})`);
    const head = r.through === 0 ? GENESIS : events[r.through - 1].entry_hash;
    if (head !== r.head) return no(`its head ${r.head.slice(0, 12)}\u2026 is not the book's at event ${r.through - 1} (${head.slice(0, 12)}\u2026)`);
    const at3 = (this.wfFirst.get(s.from) ?? []).filter((p) => p < r.through);
    if (at3.length !== r.recorded) return no(`it counts ${r.recorded} verdict(s) recorded under ${s.from} before event ${r.through}; the book records ${at3.length}`);
    const want = new Map(r.changed.map((c) => [c.verdict_id, c]));
    for (const p of at3) {
      const c = want.get(events[p].verdict_id);
      if (!c) continue;
      want.delete(c.verdict_id);
      const outcome = payloads[p]?.verdict?.outcome;
      if (outcome !== c.from) return no(`it says ${c.verdict_id} was recorded ${c.from}; the book records ${String(outcome)}`);
    }
    const stray = want.keys().next();
    if (!stray.done) return no(`it names ${stray.value}, which is not recorded under ${s.from} before event ${r.through}`);
    return { matches: true };
  }
  /** A copy to feed further, leaving this one as it is (a snapshot's reader resuming from its ledger's). */
  fork() {
    const r = new _BookReader(this.opts);
    if (this.reg.rooted) for (const e of this.keys) r.reg.apply(e.seq, e.decision_id, e.signed.decision);
    r.through = this.through;
    const lists = structuredClone({ decisions: this.decisions, keys: this.keys, canaries: this.canaries, cosigns: this.cosigns, samples: this.samples, signed_reviews: this.signed_reviews });
    r.decisions = lists.decisions;
    r.keys = lists.keys;
    r.canaries = lists.canaries;
    r.cosigns = lists.cosigns;
    r.samples = lists.samples;
    r.signed_reviews = lists.signed_reviews;
    r.unanchored = new Set(this.unanchored);
    r.recorded = new Set(this.recorded);
    r.owners = new Map(Array.from(this.owners, ([id, o]) => [id, typeof o === "string" ? o : new Set(o)]));
    r.latestOwner = new Map(this.latestOwner);
    r.sampleKeys = new Set(this.sampleKeys);
    r.wfFirst = new Map(Array.from(this.wfFirst, ([wf, at3]) => [wf, [...at3]]));
    return r;
  }
  /** The book as read through `through`, as fresh objects (the reader's own lists keep changing as it is fed). */
  result(base) {
    const lists = structuredClone({ decisions: this.decisions, keys: this.keys, canaries: this.canaries, cosigns: this.cosigns, samples: this.samples, signed_reviews: this.signed_reviews });
    const reg = this.reg;
    return {
      ok: true,
      check: base,
      decisions: lists.decisions,
      keys: lists.keys,
      canaries: lists.canaries,
      cosigns: lists.cosigns,
      unanchored: [...this.unanchored].sort(),
      samples: lists.samples,
      signed_reviews: lists.signed_reviews,
      ...reg.rooted ? { registry: { ...reg.started !== void 0 ? { started: reg.started } : {}, keys: reg.snapshot() } } : {}
    };
  }
};
var HOMES = /* @__PURE__ */ new WeakMap();
function keepBookReaders(events, payloads) {
  HOMES.set(events, { events, payloads, readers: /* @__PURE__ */ new Map() });
}
function shareBookReaders(from, to) {
  const home = HOMES.get(from);
  if (home) HOMES.set(to, home);
}
function dropBookReaders(events) {
  HOMES.get(events)?.readers.clear();
}
var anchorKey = (opts) => JSON.stringify([opts.trusted_keys ?? null, opts.root_keys ?? null]);
function sameAsHome(home, events, payloads, from, upto) {
  if (upto > home.events.length || upto > events.length) return false;
  for (let i = from; i < upto; i++) if (events[i] !== home.events[i]) return false;
  const own = payloadViewOf(home.payloads);
  if (own) {
    const v = payloadViewOf(payloads);
    return v !== void 0 && v.store === own.store && v.pristine >= upto;
  }
  for (let i = from; i < upto; i++) if (payloads[i] !== home.payloads[i]) return false;
  return true;
}
function readBookAs(events, payloads, opts) {
  const fail = (check2) => ({ ok: false, check: check2, decisions: [], keys: [], canaries: [], cosigns: [], unanchored: [], samples: [], signed_reviews: [] });
  if (payloads.length !== events.length) {
    return fail({ ok: false, length: events.length, head: events.length ? events[events.length - 1].entry_hash : GENESIS, reason: `the book has ${events.length} events but ${payloads.length} payloads` });
  }
  const home = HOMES.get(events);
  const key = anchorKey(opts);
  const inPlace = home !== void 0 && home.events === events && home.payloads === payloads;
  const kept = home?.readers.get(key);
  const usable = kept !== void 0 && kept.through <= events.length && (inPlace || sameAsHome(home, events, payloads, 0, kept.through));
  let r;
  let rootProblem;
  if (usable) r = inPlace || kept.through === events.length ? kept : kept.fork();
  else {
    try {
      r = new BookReader(opts);
    } catch (e) {
      rootProblem = e.message;
    }
  }
  const drop = () => {
    if (inPlace && r === kept) home.readers.delete(key);
  };
  const spansByUnit = /* @__PURE__ */ new Map();
  const spansOf = (u) => {
    if (!isPeriodUnit(u)) return void 0;
    if (!spansByUnit.has(u)) spansByUnit.set(u, chainPeriods(events, u));
    return spansByUnit.get(u);
  };
  let first;
  const step = (i, p) => {
    if (first || !r || i < r.through) return;
    const why = r.step(events, payloads, i, p, spansOf);
    if (why !== void 0) first = { i, reason: why };
  };
  let base;
  try {
    base = verifyChainAgainst(events, (ev) => payloads[ev.seq], {
      payloads,
      // Events between the reader and the verified prefix were verified before but not yet read: read them first, in order.
      onPrefix: (from) => {
        for (let i = r?.through ?? from; i < from && !first; i++) step(i, payloads[i]);
      },
      onVerified: step
    });
  } catch (e) {
    drop();
    throw e;
  }
  if (!base.ok) {
    drop();
    return fail(base);
  }
  if (rootProblem !== void 0 || !r) return fail({ ok: false, length: events.length, head: base.head, reason: rootProblem ?? "no reader" });
  if (first) {
    drop();
    return fail({ ok: false, length: events.length, head: base.head, brokenAt: first.i, reason: first.reason });
  }
  if (home && r !== kept && (!kept || kept.through < r.through) && sameAsHome(home, events, payloads, usable ? kept.through : 0, r.through)) home.readers.set(key, r);
  return r.result(base);
}
function isAnchored(e) {
  return e.via !== void 0 && e.via !== "unanchored";
}
function grantInForce(decisions, workflow_id, opts = {}) {
  return latestInForce(decisions, workflow_id, Number.POSITIVE_INFINITY, opts.policies, true, opts.governing_policy);
}
function governingProblem(g, book, governing2, before = Number.POSITIVE_INFINITY) {
  const gd = g.signed.decision;
  const under = `the governing policy ${governing2.policy_id}@${governing2.version}`;
  const tier = Array.isArray(governing2.tiers) ? governing2.tiers.find((t) => t?.tier === gd.consequence_tier) : void 0;
  if (!tier) return `tier '${gd.consequence_tier}' is not declared in ${under}`;
  const cap = tier.max_rung ?? "autonomy";
  if (DECISION_LEVELS.indexOf(gd.level) > DECISION_LEVELS.indexOf(cap)) return `${under} caps tier '${tier.tier}' at ${cap}`;
  if (gd.level !== "autonomy") return void 0;
  const stated = gd.signatures ?? 1;
  const n = tier.grant_signatures;
  const required = Number.isInteger(n) && n > stated ? n : stated;
  if (required <= 1) return void 0;
  const have = 1 + cosignsFrom(g, book, true).filter((c) => c.seq < before).length;
  return have >= required ? void 0 : `autonomy at tier '${tier.tier}' needs ${required} signatures under ${under} (dual authorization) and has ${have}`;
}
function grantAt(decisions, workflow_id, seq, opts = {}) {
  return latestInForce(decisions.filter((e) => e.seq < seq), workflow_id, seq, opts.policies, true, opts.governing_policy);
}
function carriedProblem(gd, e, book, policies, strict, gov) {
  const s = gd.succeeds;
  if (!s) return void 0;
  if (strict && e.replay?.matches !== true) {
    return e.replay ? `its replay does not match the book: ${e.replay.reason}` : "its replay was not checked against the book (read it through readDecisionBook)";
  }
  const from = latestInForce(book.filter((x) => x.seq < e.seq), s.from, e.seq, policies, strict, gov);
  if (!from) return `nothing is granted on ${s.from} at its position: there is no grant to carry`;
  if (from.decision_id !== s.grant) {
    return `it carries GRANT \`${s.grant.slice(0, 12)}\`, but the grant in force on ${s.from} at its position is GRANT \`${from.decision_id.slice(0, 12)}\` (seq ${from.seq}): only the grant in force is carried`;
  }
  const fd = from.signed.decision;
  if (rank(gd.level) > rank(fd.level)) return `it carries ${gd.level}, above the grant in force on ${s.from} (${fd.level}): a succession carries a rung, it never raises one`;
  if (gd.consequence_tier !== fd.consequence_tier) return `it is at tier '${gd.consequence_tier}'; the grant it carries is at tier '${fd.consequence_tier}'`;
  if (gd.level === "autonomy" && (gd.signatures ?? 1) < (fd.signatures ?? 1)) return `it states ${gd.signatures ?? 1} signature(s); the grant it carries was made under ${fd.signatures} (dual authorization carries over)`;
  return void 0;
}
function requiredUnder(g, body) {
  const stated = g.signatures ?? 1;
  if (g.level !== "autonomy" || !body || !Array.isArray(body.tiers)) return stated;
  const n = body.tiers.find((t) => t?.tier === g.consequence_tier)?.grant_signatures;
  return Number.isInteger(n) && n > stated ? n : stated;
}
function policyResolver(entries, policies) {
  let byHash;
  return (hash) => {
    if (!byHash) {
      byHash = /* @__PURE__ */ new Map();
      for (const e of entries) {
        const d = e.signed.decision;
        if (d.kind === "POLICY_REVISION") byHash.set(d.policy.hash, d.policy_body);
      }
      for (const p of policies ?? []) byHash.set(hashOf(p), p);
    }
    return byHash.get(hash);
  };
}
var cosignOf = (c) => ({ decision_id: c.decision_id, seq: c.seq, signer_id: c.signed.decision.signer_id, fingerprint: keyFingerprint(c.signed.public_key) ?? "" });
function cosignProblem(c, g, counted, strict) {
  const anchored = (e) => strict ? isAnchored(e) : e.via !== "unanchored";
  const gd = g.signed.decision;
  if (!anchored(g)) return `grant \`${g.decision_id.slice(0, 12)}\` is not anchored: it has no effect, and a co-signature cannot give it one`;
  if (!anchored(c)) return `the co-signer is not anchored: ${ANCHOR_HINT}`;
  const who = c.signed.decision.signer_id;
  if (who === gd.signer_id) return `${who} signed the grant itself: dual authorization needs a second person`;
  const prior = counted.find((x) => x.signer_id === who);
  if (prior) return `${who} already co-signed it (seq ${prior.seq}): one person counts once`;
  if (c.signed.public_key === void 0) return void 0;
  const fp = keyFingerprint(c.signed.public_key);
  if (fp === void 0 || fp === keyFingerprint(g.signed.public_key)) return `it is signed with the key that signed the grant: two ids on one key are one signer`;
  const sameKey = counted.find((x) => x.fingerprint === fp);
  if (sameKey) return `its key already co-signed it (as ${sameKey.signer_id}, seq ${sameKey.seq}): two ids on one key are one signer`;
  return void 0;
}
function cosignsFrom(g, entries, strict) {
  if (g.cosigned) return g.cosigned;
  const gd = g.signed.decision;
  const out = [];
  for (const c of entries) {
    const d = c.signed.decision;
    if (d.kind !== "GRANT_COSIGN" || d.grant !== g.decision_id || c.seq <= g.seq || d.workflow_id !== gd.workflow_id || d.level !== gd.level) continue;
    if (!cosignProblem(c, g, out, strict)) out.push(cosignOf(c));
  }
  return out;
}
function grantSignatures(g, book = [], opts = {}) {
  return signaturesOf(g, book, policyResolver(book, opts.policies), opts.before ?? Number.POSITIVE_INFINITY);
}
function signaturesOf(g, book, body, before) {
  const gd = g.signed.decision;
  const required = gd.level === "autonomy" ? requiredUnder(gd, body(gd.policy.hash)) : requiredUnder(gd, void 0);
  const cosigns = (required > 1 || g.cosigned ? cosignsFrom(g, book, true) : []).filter((c) => c.seq < before).map((c) => ({ ...c }));
  return { required, signers: [gd.signer_id, ...cosigns.map((c) => c.signer_id)], cosigns, complete: 1 + cosigns.length >= required };
}
function latestInForce(entries, workflow_id, before, policies, strict, gov) {
  const body = policyResolver(entries, gov ? [...policies ?? [], gov] : policies);
  let g;
  for (const e of entries) {
    const d = e.signed.decision;
    if (d.kind !== "GRANT" || d.workflow_id !== workflow_id) continue;
    if (strict ? !isAnchored(e) : e.via === "unanchored") continue;
    const ge = e;
    const required = d.signatures === void 0 && d.level !== "autonomy" ? 1 : requiredUnder(d, body(d.policy.hash));
    if (required > 1 && 1 + cosignsFrom(ge, entries, strict).filter((c) => c.seq < before).length < required) continue;
    if (gov && governingProblem(ge, entries, gov, before) !== void 0) continue;
    if (d.succeeds && carriedProblem(d, ge, entries, policies, strict, gov) !== void 0) continue;
    g = ge;
  }
  return g;
}
function declinesFor(decisions, workflow_id) {
  return decisions.filter((e) => e.signed.decision.kind === "DECLINE" && e.signed.decision.workflow_id === workflow_id && isAnchored(e));
}
function revisionsOf(decisions, policy_id) {
  return decisions.filter((e) => e.signed.decision.kind === "POLICY_REVISION" && e.signed.decision.policy.policy_id === policy_id && isAnchored(e));
}
function canarySealsFor(canaries, workflow_id) {
  return canaries.filter((e) => e.signed.decision.kind === "CANARY_SEAL" && e.signed.decision.workflow_id === workflow_id && isAnchored(e));
}
function canaryRevealsFor(canaries, workflow_id) {
  return canaries.filter((e) => e.signed.decision.kind === "CANARY_REVEAL" && e.signed.decision.workflow_id === workflow_id && isAnchored(e));
}
var ANCHOR_HINT = "anchor the signer with --trusted-keys / --root-keys";
function noEffectNotice(e) {
  const d = e.signed.decision;
  const what = d.kind === "GRANT" ? `${d.workflow_id} is not moved to ${d.level}` : d.kind === "DECLINE" ? `it holds back no proposal on ${d.workflow_id}` : d.kind === "POLICY_REVISION" ? `${d.policy.policy_id}@${d.policy.version} is not read as a version of the policy` : d.kind === "CANARY_SEAL" || d.kind === "CANARY_REVEAL" ? `no item of ${d.workflow_id} is set aside as a canary` : d.kind === "GRANT_COSIGN" ? `it adds no signature to grant \`${d.grant.slice(0, 12)}\` on ${d.workflow_id}` : "it anchors nothing";
  return `${at(e)} is not anchored: it has no effect (${what}); ${ANCHOR_HINT}`;
}
var at = (e) => `${e.signed.decision.kind} \`${e.decision_id.slice(0, 12)}\` by ${e.signed.decision.signer_id} at ${e.signed.decision.signed_at} (seq ${e.seq})`;
function pendingNotice(g, s, supersededBy) {
  const gd = g.signed.decision;
  const missing = s.required - s.signers.length;
  const head = `${at(g)} is pending: ${gd.level} at tier '${gd.consequence_tier}' needs ${s.required} signatures (dual authorization) and has ${s.signers.length} (${s.signers.join(", ")}); it has no effect (${gd.workflow_id} is not moved to ${gd.level})`;
  return supersededBy ? `${head}, and GRANT \`${supersededBy.decision_id.slice(0, 12)}\` (seq ${supersededBy.seq}) has since superseded it, so it never takes effect` : `${head} until ${missing === 1 ? "another person co-signs" : `${missing} more people co-sign`} it (GRANT_COSIGN by an anchored grant signer, on another key)`;
}
function successionNoEffectNotice(g, why) {
  const gd = g.signed.decision;
  return `${at(g)} carries ${gd.succeeds.from}'s grant to ${gd.workflow_id} and has no effect (${gd.workflow_id} is not moved to ${gd.level}): ${why}`;
}
function noEffect(book, filter = {}) {
  const all = [...book.decisions, ...book.canaries, ...book.cosigns ?? []].sort((a, b) => a.seq - b.seq);
  const body = policyResolver(all, filter.policies);
  const out = [];
  for (const e of all) {
    const d = e.signed.decision;
    if (d.kind === "KEY_REGISTER" || d.kind === "KEY_REVOKE") continue;
    const wf = d.kind === "POLICY_REVISION" ? void 0 : d.workflow_id;
    const scoped = filter.workflow_id !== void 0 || filter.policy_id !== void 0;
    const keep = !scoped || wf !== void 0 && wf === filter.workflow_id || d.kind === "POLICY_REVISION" && d.policy.policy_id === filter.policy_id;
    if (!keep) continue;
    const base = { decision_id: e.decision_id, seq: e.seq, kind: d.kind, signer_id: d.signer_id, signed_at: d.signed_at, ...wf !== void 0 ? { workflow_id: wf } : {} };
    if (!isAnchored(e)) {
      out.push({ ...base, notice: noEffectNotice(e) });
      continue;
    }
    if (d.kind === "GRANT") {
      const g = e;
      const carried = carriedProblem(d, g, all, filter.policies, true, void 0);
      if (carried) {
        out.push({ ...base, notice: successionNoEffectNotice(g, carried) });
        continue;
      }
      const s = signaturesOf(g, all, body, Number.POSITIVE_INFINITY);
      if (s.complete) continue;
      const later = all.find((x) => x.seq > g.seq && x.signed.decision.kind === "GRANT" && x.signed.decision.workflow_id === d.workflow_id && isAnchored(x));
      out.push({ ...base, pending: { required: s.required, signed_by: s.signers }, notice: pendingNotice(g, s, later) });
      continue;
    }
    if (d.kind === "GRANT_COSIGN") {
      const g = all.find((x) => x.decision_id === d.grant && x.signed.decision.kind === "GRANT");
      if (!g) continue;
      const counted = cosignsFrom(g, all, true);
      if (counted.some((c) => c.decision_id === e.decision_id)) continue;
      const why = cosignProblem(e, g, counted.filter((c) => c.seq < e.seq), true) ?? "it does not count toward the grant";
      out.push({ ...base, notice: `${at(e)} has no effect: ${why}` });
    }
  }
  return out;
}
var governingRead = (policy) => policy ? { policies: [policy], governing_policy: policy } : {};
function canaryConflict(d, book, recorded) {
  if (d.kind === "CANARY_SEAL") {
    const dup = book.find((e) => e.signed.decision.kind === "CANARY_SEAL" && e.signed.decision.commitment === d.commitment);
    return dup ? `this commitment is already sealed (seq ${dup.seq})` : void 0;
  }
  const seal = book.find((e) => e.decision_id === d.seal && e.signed.decision.kind === "CANARY_SEAL");
  if (!seal) return `no CANARY_SEAL ${d.seal} is on the book to reveal`;
  const sd = seal.signed.decision;
  if (sd.workflow_id !== d.workflow_id) return `seal ${d.seal} is for ${sd.workflow_id}, not ${d.workflow_id}`;
  const again = book.find((e) => e.signed.decision.kind === "CANARY_REVEAL" && e.signed.decision.seal === d.seal);
  if (again) return `seal ${d.seal} was already revealed (seq ${again.seq})`;
  if (sd.signer_id !== d.signer_id) return `seal ${d.seal} was made by '${sd.signer_id}'; only its sealer reveals it`;
  if (canaryCommitment(d.workflow_id, d.verdict_ids, d.salt) !== sd.commitment) return `the revealed set and salt do not reproduce seal ${d.seal}'s commitment (the canaries were changed after sealing)`;
  if (recorded) {
    const missing = d.verdict_ids.filter((id) => !recorded.has(id));
    if (missing.length) return `a canary must be recorded on the book before it is revealed; not recorded: ${missing.join(", ")}`;
  }
  return void 0;
}
function decisionConflict(d, book, recorded, signing_key) {
  const rungBook = book.filter((e) => isDecisionKind(e.signed.decision.kind));
  const revisionsOf2 = (rb, policy_id) => rb.filter((e) => e.signed.decision.kind === "POLICY_REVISION" && e.signed.decision.policy.policy_id === policy_id);
  const grantInForce2 = (workflow_id) => latestInForce(book, workflow_id, Number.POSITIVE_INFINITY, void 0, false);
  if (d.kind === "GRANT_COSIGN") {
    const g = rungBook.find((e) => e.decision_id === d.grant && e.signed.decision.kind === "GRANT");
    if (!g) return `a GRANT_COSIGN names grant ${d.grant}, which is not on the book: co-sign a GRANT already recorded`;
    const gd = g.signed.decision;
    if (gd.workflow_id !== d.workflow_id || gd.level !== d.level) return `grant ${d.grant} sets ${gd.workflow_id} at ${gd.level}; this co-signature says ${d.workflow_id} at ${d.level}: a co-signer signs what the grant says`;
    const later = rungBook.find((e) => e.seq > g.seq && e.signed.decision.kind === "GRANT" && e.signed.decision.workflow_id === gd.workflow_id && e.via !== "unanchored");
    if (later) return `grant ${d.grant} was superseded by GRANT ${later.decision_id} (seq ${later.seq}): only the latest grant for a workflow can be co-signed`;
    const why = cosignProblem({ signed: { decision: d, ...signing_key !== void 0 ? { public_key: signing_key } : {} } }, g, cosignsFrom(g, book, false), false);
    return why ? `this co-signature would not count: ${why}` : void 0;
  }
  if (d.kind === "GRANT") {
    const known = revisionsOf2(rungBook, d.policy.policy_id).find((e) => e.signed.decision.policy.version === d.policy.version);
    if (known && known.signed.decision.policy.hash !== d.policy.hash) {
      return `the book records ${d.policy.policy_id}@${d.policy.version} as ${known.signed.decision.policy.hash.slice(0, 12)}\u2026 (seq ${known.seq}); this grant names another body under the same version`;
    }
    if (d.succeeds) {
      const why = carriedProblem(d, { seq: Number.POSITIVE_INFINITY }, book, void 0, false, void 0);
      if (why) return `this succession would carry nothing: ${why}`;
    }
    return void 0;
  }
  if (d.kind === "DECLINE") {
    const g = grantInForce2(d.workflow_id);
    if ((d.under_grant ?? null) !== (g?.decision_id ?? null)) {
      return g ? `a decline answers a proposal made under the grant in force for ${d.workflow_id} (${g.decision_id}, seq ${g.seq}); this one names ${d.under_grant ?? "no grant"}` : `nothing is granted for ${d.workflow_id} on this book, but the decline names grant ${d.under_grant}`;
    }
    if (g) {
      const gd = g.signed.decision;
      if (d.from !== gd.level) return `the grant in force is ${gd.level}; a proposal under it runs from ${gd.level}, not ${d.from}`;
      if (d.consequence_tier !== gd.consequence_tier) return `the grant in force is at tier '${gd.consequence_tier}', not '${d.consequence_tier}'`;
      if (d.policy.hash !== gd.policy.hash) return `the grant in force is under policy ${gd.policy.policy_id}@${gd.policy.version}; the declined proposal names another`;
    } else if (d.from !== "record") {
      return `nothing is granted for ${d.workflow_id}: the rung is record, so a proposal runs from record, not ${d.from}`;
    }
    return void 0;
  }
  if (d.kind === "CANARY_SEAL" || d.kind === "CANARY_REVEAL") return canaryConflict(d, book, recorded);
  if (d.kind === "KEY_REGISTER" || d.kind === "KEY_REVOKE") return void 0;
  const revs = revisionsOf2(rungBook, d.policy.policy_id);
  const same = revs.find((e) => e.signed.decision.policy.version === d.policy.version);
  if (same) return `${d.policy.policy_id}@${d.policy.version} is already on the book (seq ${same.seq}); a version names one body, so revise to a new version`;
  const prior = revs.find((e) => e.signed.decision.policy.version === d.supersedes.version);
  if (prior && prior.signed.decision.policy.hash !== d.supersedes.hash) {
    return `the book records ${d.supersedes.policy_id}@${d.supersedes.version} as ${prior.signed.decision.policy.hash.slice(0, 12)}\u2026 (seq ${prior.seq}), not the hash this revision supersedes`;
  }
  return void 0;
}

// packages/verify/src/surveillance/evidence.ts
function samplingRates(tier, rung) {
  const s = tier.sampling;
  if (!s) return { PASS: 0, FAIL: 0 };
  if (rung === "gate") return { PASS: 1, FAIL: 1 };
  if (rung === "autonomy") return { PASS: s.surveillance_rate ?? 0, FAIL: 1 };
  const r = s.review_rate ?? 0;
  return { PASS: r, FAIL: r };
}
var tk = (tenant, id) => `${tenant}\0${id}`;
function latestReviews(events, payloads, book, workflow_id) {
  const signedAt = new Map(book.signed_reviews.map((r) => [r.seq, r]));
  const reviews = /* @__PURE__ */ new Map();
  const recordSeq = /* @__PURE__ */ new Map();
  const latestOwner = /* @__PURE__ */ new Map();
  let wfTenant;
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    const p = recordFactsAt(payloads, i) ?? payloads[i];
    if (ev.type === "RECORD") {
      const tenant2 = typeof p?.tenant_id === "string" ? p.tenant_id : "";
      recordSeq.set(tk(tenant2, ev.verdict_id), i);
      latestOwner.set(ev.verdict_id, tenant2);
      if (wfTenant === void 0 && recordWorkflow(p) === workflow_id) wfTenant = tenant2;
      continue;
    }
    if (ev.type !== "REVIEW") continue;
    const tenant = typeof p?.tenant_id === "string" ? p.tenant_id : latestOwner.get(ev.verdict_id);
    if (tenant === void 0 || !recordSeq.has(tk(tenant, ev.verdict_id))) continue;
    const r = p?.review;
    if (!r || r.decision !== "UPHELD" && r.decision !== "OVERTURNED") continue;
    const signed = signedAt.get(i);
    reviews.set(tk(tenant, ev.verdict_id), { seq: i, reviewer_id: String(r.reviewer_id ?? ""), decision: r.decision, ...signed ? { signed } : {} });
  }
  const key = (id) => tk(wfTenant ?? latestOwner.get(id) ?? "", id);
  return { review: (id) => reviews.get(key(id)), recordSeq: (id) => recordSeq.get(key(id)) };
}
var anchoredSigned = (r) => !!r?.signed && r.signed.via !== "unanchored";
function auditApplies(tier, book, workflow_id) {
  const e = tier.evidence;
  return !!tier.sampling || !!(e && (e.random_selection || e.signed_reviews || e.segregation || e.canaries)) || canarySealsFor(book.canaries, workflow_id).length > 0;
}
function auditEvidence(input) {
  const { workflow_id: wf, events, payloads, book, tier, calibration: cal, grant } = input;
  const reading = input.policy ? { policies: [input.policy], governing_policy: input.policy } : {};
  const req = tier.evidence ?? {};
  const confidence = tier.confidence;
  const lr = latestReviews(events, payloads, book, wf);
  const reviews = { get: lr.review };
  const recordSeq = { get: lr.recordSeq };
  const overturned = /* @__PURE__ */ new Set([...cal.evidence.false_pass, ...cal.evidence.false_fail]);
  const reviewed = [...cal.evidence.reviewed_pass, ...cal.evidence.reviewed_fail].sort();
  const setAside = /* @__PURE__ */ new Map();
  const aside = (id, why) => {
    if (!setAside.has(id)) setAside.set(id, why);
  };
  const blockers = [], failure_blockers = [], notes = [];
  const seals = canarySealsFor(book.canaries, wf);
  const reveals = canaryRevealsFor(book.canaries, wf);
  const canaryIds = /* @__PURE__ */ new Set();
  const sealerOf = /* @__PURE__ */ new Map();
  for (const r of reveals) for (const id of r.signed.decision.verdict_ids) {
    canaryIds.add(id);
    sealerOf.set(id, r.signed.decision.signer_id);
  }
  for (const id of reviewed) if (canaryIds.has(id)) aside(id, "a revealed canary: a known-bad item seeded to measure reviewer attention, never evidence about the workflow");
  let canaryCitation;
  if (seals.length || req.canaries) {
    let n = 0, caught = 0;
    const missed = [];
    for (const id of [...canaryIds].sort()) {
      const r = reviews.get(id);
      if (!r || r.reviewer_id === sealerOf.get(id)) continue;
      if (req.signed_reviews && !anchoredSigned(r)) continue;
      n++;
      if (r.decision === "OVERTURNED") caught++;
      else missed.push(id);
    }
    const lower = successLowerBound(caught, n, confidence, input.method, input.sidedness);
    const revealedSeals = new Set(reveals.map((r) => r.signed.decision.seal));
    canaryCitation = {
      sealed: seals.length,
      revealed: reveals.length,
      outstanding: seals.filter((s) => !revealedSeals.has(s.decision_id)).length,
      reviewed: n,
      caught,
      missed,
      lower_bound: lower,
      bound: `${describeBound(confidence, input.method, input.sidedness)} lower bound`
    };
    if (req.canaries) {
      const shown2 = n >= req.canaries.min_n && lower >= req.canaries.min_catch_rate;
      canaryCitation.requirement = { min_n: req.canaries.min_n, min_catch_rate: req.canaries.min_catch_rate, shown: shown2 };
      if (!shown2) {
        const what = n < req.canaries.min_n ? `${n} reviewed canar${n === 1 ? "y" : "ies"} < minimum ${req.canaries.min_n}` : `the ${describeBound(confidence, input.method, input.sidedness)} lower bound on the catch rate is ${pct(lower)} (${caught}/${n} caught) < floor ${pct(req.canaries.min_catch_rate)}`;
        const b = `reviewer attention is not shown: ${what}. Until it is, no overturn rate counts as evidence (IMDA MGF Agentic \xA72.2.2: a low override rate may signal rubber-stamping)`;
        blockers.push(b);
        if (missed.length) failure_blockers.push(b);
      }
    }
  }
  if (req.signed_reviews) {
    let unanchored = 0;
    for (const id of reviewed) {
      if (setAside.has(id)) continue;
      const r = reviews.get(id);
      if (anchoredSigned(r)) continue;
      if (r?.signed) unanchored++;
      aside(id, r?.signed ? "signed by a key not anchored to a person (read the book with root_keys or trusted_keys): a signature proves the key holder, not the reviewer" : "an unsigned review: this tier counts only a person's signed review, so an agent cannot manufacture the evidence");
    }
    if (unanchored) notes.push(`${unanchored} signed review(s) could not be tied to a person: the book was read without an anchor for their keys`);
  }
  let segregation;
  if (req.segregation && grant) {
    const signer = grant.signed.decision.signer_id;
    const fp = keyFingerprint(grant.signed.public_key);
    const own = [];
    for (const id of reviewed) {
      if (setAside.has(id)) continue;
      const r = reviews.get(id);
      if (!r || r.decision !== "UPHELD") continue;
      if (r.reviewer_id === signer || fp !== void 0 && r.signed?.fingerprint === fp) {
        own.push(id);
        aside(id, `segregation of duties: '${signer}' signed the grant in force and reviewed this item; a grant cannot rest on its signer's own clean reviews (COSO GenAI p.13)`);
      }
    }
    const cosigns = grantSignatures(grant, book.decisions, reading).cosigns;
    for (const c of cosigns) {
      for (const id of reviewed) {
        if (setAside.has(id)) continue;
        const r = reviews.get(id);
        if (!r || r.decision !== "UPHELD") continue;
        if (r.reviewer_id === c.signer_id || c.fingerprint !== "" && r.signed?.fingerprint === c.fingerprint) {
          own.push(id);
          aside(id, `segregation of duties: '${c.signer_id}' co-signed the grant in force and reviewed this item; a grant cannot rest on its signers' own clean reviews (COSO GenAI p.13)`);
        }
      }
    }
    own.sort();
    segregation = { signer, ...cosigns.length ? { cosigners: cosigns.map((c) => c.signer_id) } : {}, set_aside: own };
  }
  const held = [];
  const untested = { PASS: [], FAIL: [] };
  const drawnInfo = /* @__PURE__ */ new Map();
  let selection;
  const counts = (r) => !!r && (!req.signed_reviews || anchoredSigned(r));
  if (tier.sampling) {
    const unit = tier.sampling.period;
    const spans = chainPeriods(events, unit);
    const clock = chainClock(events);
    const draws = [];
    let notClosed = 0;
    let population = 0;
    for (const span of spans) {
      if (span.closed_by === void 0) {
        notClosed++;
        continue;
      }
      const epoch = events[span.last_seq];
      const rung = grantAt(book.decisions, wf, span.last_seq + 1, reading)?.signed.decision.level ?? "record";
      const rates = samplingRates(tier, rung);
      const frame = periodFrame(events, payloads, wf, span);
      population += frame.PASS.length + frame.FAIL.length;
      if (rates.PASS === 0 && rates.FAIL === 0) continue;
      const seed = sampleSeed(wf, unit, span.start, epoch.entry_hash);
      const due_by = nextPeriodEnd(span.start, unit);
      const overdue = clock !== void 0 && clock >= Date.parse(due_by);
      const drawn = { PASS: [], FAIL: [] };
      for (const s of STRATA) drawn[s] = drawStratum(frame[s], seed, s, rates[s]).filter((id) => !canaryIds.has(id) && !drawnInfo.has(id));
      let rev = 0, pend = 0, unt = 0;
      const open = STRATA.some((s) => drawn[s].some((id) => !counts(reviews.get(id))));
      for (const s of STRATA) {
        for (const id of drawn[s]) {
          const surveilled = s === "PASS" && rung === "autonomy" && (tier.sampling.surveillance_rate ?? 0) > 0;
          drawnInfo.set(id, { stratum: s, start: span.start, open: open && !overdue, overdue, surveillance: surveilled });
          if (counts(reviews.get(id))) rev++;
          else if (overdue) {
            unt++;
            if (req.random_selection || surveilled) untested[s].push(id);
          } else pend++;
        }
      }
      const committed = book.samples.some((e) => e.sample.workflow_id === wf && e.sample.period.unit === unit && e.sample.period.start === span.start && e.sample.rates.PASS === rates.PASS && e.sample.rates.FAIL === rates.FAIL);
      draws.push({
        start: span.start,
        end: span.end,
        due_by,
        rung,
        rates,
        seed,
        population: { PASS: frame.PASS.length, FAIL: frame.FAIL.length },
        drawn: { PASS: drawn.PASS.length, FAIL: drawn.FAIL.length },
        reviewed: rev,
        pending: pend,
        untested: unt,
        committed,
        status: pend + unt === 0 ? "complete" : overdue ? "overdue" : "open"
      });
    }
    selection = { period: unit, draws, not_yet_closed: notClosed };
    const uncommitted = draws.filter((d) => !d.committed).length;
    if (uncommitted) notes.push(`${uncommitted} closed period(s) have no SAMPLE committed on the book at the policy's rates: the draw is still fixed by the chain and re-derived here, but the queue was never published (commit it with ledger.commitSample)`);
    if (req.random_selection && population === 0 && reviewed.length > 0) {
      blockers.push(`random selection is required, but the sampling frame (the default workflow key, tenant/ruleset@version, over closed ${unit}s) holds none of this workflow's records: no review can qualify`);
    }
  }
  if (req.random_selection) {
    for (const id of reviewed) {
      if (setAside.has(id)) continue;
      if (overturned.has(id)) continue;
      const d = drawnInfo.get(id);
      if (!d) {
        aside(id, "not drawn by the random selection: a clean review of an item a person chose to review is not evidence (AS 2315 .39)");
        continue;
      }
      if (d.open) held.push(id);
    }
  }
  let surveillance;
  const surveillance_cases = [];
  if (grant && grant.signed.decision.level === "autonomy") {
    const rate = tier.sampling?.surveillance_rate ?? 0;
    if (rate > 0 && tier.sampling) {
      const since = grant.seq;
      const after = (id) => (recordSeq.get(id) ?? -1) > since;
      const misses = cal.evidence.false_pass.filter((id) => after(id) && !setAside.has(id)).sort();
      const unt = untested.PASS.filter(after).sort();
      let drawn = 0, rev = 0, pend = 0;
      for (const [id, d] of drawnInfo) {
        if (d.stratum !== "PASS" || !after(id)) continue;
        drawn++;
        if (counts(reviews.get(id))) rev++;
        else if (!d.overdue) pend++;
      }
      surveillance = { grant: grant.decision_id, since_seq: since, rate, period: tier.sampling.period, drawn, reviewed: rev, pending: pend, misses, untested: unt };
      surveillance_cases.push(.../* @__PURE__ */ new Set([...misses, ...unt]));
      surveillance_cases.sort();
    } else {
      notes.push("no surveillance_rate is declared at this tier: once PASSes proceed unreviewed under autonomy, the false-PASS evidence stops growing and no new miss can raise a proposal (research \xA75.3)");
    }
  }
  const counted = reviewed.filter((id) => !setAside.has(id) && !held.includes(id));
  const reviewers = [...new Set(counted.map((id) => reviews.get(id)?.reviewer_id).filter((x) => !!x))].sort();
  const set_aside = [...setAside].map(([verdict_id, why]) => ({ verdict_id, why })).sort((a, b) => a.verdict_id.localeCompare(b.verdict_id));
  untested.PASS.sort();
  untested.FAIL.sort();
  held.sort();
  const adjustment = { set_aside, untested, held, blockers, failure_blockers, surveillance_cases };
  const citation = {
    tier: tier.tier,
    requirements: { ...structuredClone(req), ...tier.sampling ? { sampling: { ...tier.sampling } } : {}, ...tier.max_rung ? { max_rung: tier.max_rung } : {} },
    ...selection ? { selection } : {},
    ...surveillance ? { surveillance } : {},
    ...canaryCitation ? { canaries: canaryCitation } : {},
    ...segregation ? { segregation } : {},
    set_aside,
    held: [...held],
    untested: { PASS: [...untested.PASS], FAIL: [...untested.FAIL] },
    reviewers,
    notes
  };
  return { adjustment, citation };
}
var pct = (x) => `${Number((x * 100).toPrecision(3))}%`;

// packages/verify/src/verdict/voice.ts
var VOICE_LADDER = ["record", "advise", "gate", "autonomy"];
var RUNGS = ["advise", "gate", "autonomy"];
var RUNG_METRIC = { advise: "false_flag_rate", gate: "false_flag_rate", autonomy: "false_pass_rate" };
var levelRank = (l) => VOICE_LADDER.indexOf(l);
function defaultWorkflowOf(rec) {
  const v = recordFacts(rec) ?? rec.verdict;
  return `${rec.tenant_id}/${v.ruleset.id}@${v.ruleset.version}`;
}
var zero = () => ({ PASS: 0, FAIL: 0, INSUFFICIENT_DATA: 0 });
function buildCalibration(workflow_id, recs, excluded, opts) {
  const by_outcome = zero(), reviewed = zero(), overturned = zero();
  const reviewed_pass = [], reviewed_fail = [], false_pass = [], false_fail = [];
  const versions = /* @__PURE__ */ new Set();
  let first, last;
  for (const { rec, f } of recs) {
    const v = f ?? rec.verdict;
    by_outcome[v.outcome]++;
    versions.add(`${v.ruleset.id}@${v.ruleset.version} \xB7 engine ${v.engine_version}`);
    if (first === void 0 || rec.recorded_at < first) first = rec.recorded_at;
    if (last === void 0 || rec.recorded_at > last) last = rec.recorded_at;
    if (!rec.review) continue;
    const over = rec.review.decision === "OVERTURNED";
    reviewed[v.outcome]++;
    if (over) overturned[v.outcome]++;
    if (v.outcome === "PASS") {
      reviewed_pass.push(v.verdict_id);
      if (over) false_pass.push(v.verdict_id);
    }
    if (v.outcome === "FAIL") {
      reviewed_fail.push(v.verdict_id);
      if (over) false_fail.push(v.verdict_id);
    }
  }
  const window = {
    ...opts.since !== void 0 ? { since: opts.since } : {},
    ...opts.until !== void 0 ? { until: opts.until } : {},
    ...first !== void 0 ? { first_recorded_at: first } : {},
    ...last !== void 0 ? { last_recorded_at: last } : {}
  };
  const body = {
    calibration_version: "workflow-calibration-v0",
    workflow_id,
    window,
    versions: [...versions].sort(),
    records: recs.length,
    by_outcome,
    reviewed,
    overturned,
    evidence: {
      reviewed_pass: reviewed_pass.sort(),
      reviewed_fail: reviewed_fail.sort(),
      false_pass: false_pass.sort(),
      false_fail: false_fail.sort()
    },
    excluded: [...excluded].sort((a, b) => a.verdict_id.localeCompare(b.verdict_id) || a.why.localeCompare(b.why)),
    // A person's review is involved: each reviewed verdict is read in full (the rule ids and names are in its claims).
    rules: ruleCalibration(recs.flatMap((c) => c.rec.review ? [c.rec] : [])).rules
  };
  return { ...body, calibration_hash: hashOf(body) };
}
function notVerdictEvidence(v) {
  const mark = evidenceMark(v);
  if (mark === "COUNSEL") return "COUNSEL on the ledger: generated material is never VERDICT evidence";
  if (mark === "REASONED") return "carries judgement-tier (REASONED) findings: those are advisories (COUNSEL), never VERDICT evidence";
  return void 0;
}
function calibrate(records, opts, only) {
  const keyOf2 = opts.workflowOf ?? defaultWorkflowOf;
  const groups = /* @__PURE__ */ new Map();
  const excluded = /* @__PURE__ */ new Map();
  const ex = (k, verdict_id, why) => {
    const list = excluded.get(k) ?? [];
    list.push({ verdict_id, why });
    excluded.set(k, list);
  };
  for (const rec of records) {
    if (opts.since !== void 0 && rec.recorded_at < opts.since) continue;
    if (opts.until !== void 0 && rec.recorded_at >= opts.until) continue;
    let key;
    try {
      key = keyOf2(rec);
    } catch {
      key = void 0;
    }
    if (key === void 0 || only !== void 0 && key !== only) continue;
    if (!groups.has(key)) groups.set(key, /* @__PURE__ */ new Map());
    const f = recordFacts(rec);
    const v = f ?? rec.verdict;
    const id = String(v?.verdict_id ?? "");
    const why = notVerdictEvidence(v);
    if (why) {
      ex(key, id, why);
      continue;
    }
    const g = groups.get(key);
    if (g.has(id)) ex(key, id, "duplicate record for the same verdict_id; the later record is used (the ledger overwrite rule)");
    g.set(id, { rec, f });
  }
  for (const k of excluded.keys()) if (!groups.has(k)) groups.set(k, /* @__PURE__ */ new Map());
  return [...groups.keys()].sort().map((k) => buildCalibration(k, [...groups.get(k).values()], excluded.get(k) ?? [], opts));
}
function workflowCalibration(records, workflow_id, opts = {}) {
  return calibrate(records, opts, workflow_id)[0] ?? buildCalibration(workflow_id, [], [], opts);
}
var RESEARCH_REPORT = "Automated-approval evidence standards, research note, 2026-09-28";
var RESEARCH_PROMOTION_POLICY = {
  policy_version: "promotion-policy-v0",
  policy_id: "research-consequence-tiers",
  version: "0.3.0",
  method: "clopper-pearson",
  sidedness: "one-sided",
  tiers: [
    {
      tier: "t1-routine",
      description: "Routine and reversible: small, undone by a credit memo, an existing vendor with an unchanged remit-to, a binding twin present (PO + receipt, e-invoice XML, iXBRL). E.g. auto-approve PO-matched invoice lines within the ERP tolerance and under a per-item cap.",
      confidence: 0.9,
      advise: { min_n: 7, max_error: 0.3 },
      gate: { min_n: 15, max_error: 0.15 },
      autonomy: { min_n: 45, max_error: 0.05 },
      max_rung: "autonomy",
      sampling: { period: "quarter", review_rate: 0.1, surveillance_rate: 0.025 },
      evidence: { random_selection: true, signed_reviews: true },
      basis: `${RESEARCH_REPORT} \xA72 row T1. \u2713 Autonomy: 5% tolerable deviation at 90% one-sided (AS 2315 .34, fn 9); min_n 45 = the exact zero-miss n (\xA71.2). \u25C7 Operative bar min(5%, TM \xF7 $flow) (AS 2315 .18/.35 concept). \u25C7 advise/gate: product choices (\xA72 (f)). \u25C7 Surveillance 2.5% a quarter: at 2,000 PASSes a quarter one draw re-establishes n = 45 (\xA72 T1 "Quarterly fresh random re-performance sample \u2265 the T1 n"; AS 2201 .61, .B33; COSO p.13 "Periodically re-perform"). \u2713 Random selection (AS 2315 .39) and signed, attributable reviews (\xA74.5). FAR 13.402 (small, reversible, monitored).`
    },
    {
      tier: "t2-material",
      description: "Material, reversible with effort: larger amounts where recovery needs a vendor clawback, still below the insured's dual-authorization threshold. E.g. PO-matched invoices up to that threshold; e-invoice approvals (Peppol / ZATCA / KSeF twin).",
      confidence: 0.95,
      advise: { min_n: 11, max_error: 0.25 },
      gate: { min_n: 29, max_error: 0.1 },
      autonomy: { min_n: 59, max_error: 0.05 },
      max_rung: "autonomy",
      sampling: { period: "month", review_rate: 0.1, surveillance_rate: 0.03 },
      evidence: { random_selection: true, signed_reviews: true, segregation: true },
      basis: `${RESEARCH_REPORT} \xA72 row T2. \u2713 Autonomy: 5% at 95% one-sided (AS 2315 .34, fn 9); min_n 59 = the exact zero-miss n (\xA71.2; AS 2315 .41's "60 items"). \u25C7 Operative bar min(5%, TM \xF7 $flow): e.g. $25k TM on $5M a quarter \u2192 0.5% \u2192 598 (dollarBar). \u2713 Reviewer pool independent of the signer (SEC 33-8810 pp.27\u201328 objectivity; COSO p.13 SoD). \u25C7 Surveillance 3% a month: ~60 a quarter at 2,000 PASSes, \u2265 n = 59 (\xA72 T2 "monthly random re-performance sample").`
    },
    {
      tier: "t3-high",
      description: "High: postings to material GL accounts or reconciliations, payments near the dual-authorization threshold, data sent to a known outside counterparty. E.g. auto-post a reconciliation match; auto-accept an extracted value into a filing workpaper.",
      confidence: 0.95,
      advise: { min_n: 14, max_error: 0.2 },
      gate: { min_n: 59, max_error: 0.05 },
      autonomy: { min_n: 299, max_error: 0.01 },
      max_rung: "autonomy",
      sampling: { period: "month", review_rate: 0.2, surveillance_rate: 0.15 },
      evidence: { random_selection: true, signed_reviews: true, segregation: true, canaries: { min_n: 14, min_catch_rate: 0.8 } },
      grant_signatures: 2,
      basis: `${RESEARCH_REPORT} \xA72 row T3. \u2713 Exact one-sided 95% (\u25C7 99% a deployment option); the bar is $-derived and \u2264 T2's, e.g. 1% \u2192 min_n 299 (\xA71.2). \u2713 Segregation and locked configuration (COSO pp.12\u201313; MAS 3.10\u20133.11 draft; SR 26-2 effective challenge). \u25C7 Canaries: 14 reviewed with none missed puts the exact 95% lower bound on the catch rate at 80.7% (IMDA \xA72.2.2 "A low rate may signal rubber-stamping"). \u25C7 Surveillance 15% a month: ~300 a quarter at 2,000 PASSes, \u2265 n = 299 (\xA72 T3 "Monthly random re-performance"). \u2713 Autonomy only with two signatures, process owner and control function (\xA72 T3 "Two signers", \xA75.6; COSO pp.12\u201313 multi-party approval): grant_signatures 2, so a GRANT of autonomy is in force only when a second anchored grant signer co-signs it on another key.`
    },
    {
      tier: "t4-irreversible",
      description: "Irreversible or insurer-conditioned: a wire or instant payment, a new or changed payee, a vendor bank-detail change, a regulatory filing, data deletion. Every action is held for a person.",
      confidence: 0.95,
      advise: { min_n: 29, max_error: 0.1 },
      gate: { min_n: 99, max_error: 0.03 },
      autonomy: { min_n: 299, max_error: 0.01 },
      max_rung: "gate",
      sampling: { period: "month", review_rate: 0.3 },
      evidence: { random_selection: true, signed_reviews: true, segregation: true, canaries: { min_n: 14, min_catch_rate: 0.8 } },
      basis: `${RESEARCH_REPORT} \xA72 row T4 and \xA75.1. \u2713 Highest grantable rung: gate (autonomy is not grantable; its bar is never applied and repeats T3's only to keep the table monotone). \u26A0 Crime / social-engineering endorsements condition coverage on callback or dual human authorization (Ward and Smith, secondary); \u2713 IMDA MGF Agentic \xA72.2.2 "Irreversible actions \u2026 making payments"; \u2713 COSO "segregating GenAI assistance from authoritative decisioning"; \u26A0 UCC 4A-202(a). \u25C7 Review the T4 list against the current endorsements at every renewal.`
    }
  ]
};
var isObjLike = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
var validRate2 = (x) => typeof x === "number" && Number.isFinite(x) && x > 0 && x <= 1;
var capOf = (t) => t.max_rung ?? "autonomy";
function lintPolicy(policy) {
  const errors = [];
  const warnings = [];
  const p = policy;
  if (!p || typeof p !== "object") return { ok: false, errors: ["policy must be an object"] };
  if (policy.policy_version !== "promotion-policy-v0") errors.push(`policy_version must be 'promotion-policy-v0'`);
  if (typeof policy.policy_id !== "string" || !policy.policy_id) errors.push("policy_id is required");
  if (typeof policy.version !== "string" || !policy.version) errors.push("version is required");
  if (policy.method !== "wilson" && policy.method !== "clopper-pearson") errors.push(`method must be 'wilson' or 'clopper-pearson'`);
  if (policy.sidedness === void 0) warnings.push(`sidedness is not declared: every bound is read as one-sided (the v0 convention). Declare sidedness: 'one-sided' so every number this policy produces says which it is`);
  else if (policy.sidedness === "two-sided") errors.push(`sidedness 'two-sided' is not assessable: every bar is tested against a one-sided upper bound. A two-sided figure at confidence c equals the one-sided figure at 1 \u2212 (1 \u2212 c)/2; declare that confidence instead`);
  else if (policy.sidedness !== "one-sided") errors.push(`sidedness must be 'one-sided'`);
  const methodOk = policy.method === "wilson" || policy.method === "clopper-pearson";
  if (policy.revision !== void 0) {
    const r = policy.revision;
    if (!r || !r.supersedes || !r.revised_by || !r.revised_at || !r.reason) errors.push("a revision records supersedes, revised_by, revised_at and reason");
    else {
      if (r.supersedes.policy_id !== policy.policy_id) errors.push("a revision supersedes a version of the same policy_id");
      if (r.supersedes.version === policy.version) errors.push("a revision must carry a new version");
      if (!Array.isArray(r.changes) || r.changes.length === 0) errors.push("a revision must record what changed");
    }
  }
  if (!Array.isArray(policy.tiers) || policy.tiers.length === 0) {
    errors.push("tiers must be a non-empty array, in ascending order of consequence");
    return { ok: false, errors };
  }
  const seen = /* @__PURE__ */ new Set();
  policy.tiers.forEach((t, i) => {
    const at3 = `tiers[${i}]${t && typeof t.tier === "string" ? ` (${t.tier})` : ""}`;
    if (!t || typeof t.tier !== "string" || !t.tier) {
      errors.push(`${at3}: tier name is required`);
      return;
    }
    if (seen.has(t.tier)) errors.push(`${at3}: duplicate tier name`);
    seen.add(t.tier);
    if (!(typeof t.confidence === "number" && t.confidence >= 0.5 && t.confidence < 1)) errors.push(`${at3}: confidence must be in [0.5, 1)`);
    for (const r of RUNGS) {
      const b = t[r];
      if (!b || !Number.isInteger(b.min_n) || b.min_n < 1) errors.push(`${at3}.${r}: min_n must be an integer \u2265 1`);
      if (!b || !(typeof b.max_error === "number" && b.max_error > 0 && b.max_error < 1)) errors.push(`${at3}.${r}: max_error must be in (0, 1)`);
    }
    if (t.gate && t.advise && (t.gate.min_n < t.advise.min_n || t.gate.max_error > t.advise.max_error)) {
      errors.push(`${at3}: the gate bar must be at least as strict as the advise bar (same metric, more authority)`);
    }
    if (t.max_rung !== void 0 && !RUNGS.includes(t.max_rung)) errors.push(`${at3}: max_rung must be advise, gate or autonomy`);
    const cap = RUNGS.includes(capOf(t)) ? capOf(t) : "autonomy";
    if (t.sampling !== void 0) {
      const sp = t.sampling;
      if (!isObjLike(sp)) errors.push(`${at3}.sampling must be an object { period, review_rate?, surveillance_rate? }`);
      else {
        if (!isPeriodUnit(sp.period)) errors.push(`${at3}.sampling.period must be day, month or quarter`);
        if (sp.review_rate !== void 0 && !validRate2(sp.review_rate)) errors.push(`${at3}.sampling.review_rate must be in (0, 1]`);
        if (sp.surveillance_rate !== void 0 && !validRate2(sp.surveillance_rate)) errors.push(`${at3}.sampling.surveillance_rate must be in (0, 1]`);
        if (sp.review_rate === void 0 && sp.surveillance_rate === void 0) errors.push(`${at3}.sampling draws nothing: declare review_rate and/or surveillance_rate`);
        if (sp.surveillance_rate !== void 0 && cap !== "autonomy") warnings.push(`${at3}.sampling.surveillance_rate is never used: autonomy is not grantable at this tier (max_rung ${cap})`);
      }
    }
    if (t.evidence !== void 0) {
      const ev = t.evidence;
      if (!isObjLike(ev)) errors.push(`${at3}.evidence must be an object`);
      else {
        for (const k of ["random_selection", "signed_reviews", "segregation"]) if (ev[k] !== void 0 && typeof ev[k] !== "boolean") errors.push(`${at3}.evidence.${k} must be true or false`);
        const c = ev.canaries;
        if (c !== void 0 && (!isObjLike(c) || !Number.isInteger(c.min_n) || c.min_n < 1 || !(typeof c.min_catch_rate === "number" && c.min_catch_rate > 0 && c.min_catch_rate < 1))) {
          errors.push(`${at3}.evidence.canaries is { min_n: an integer \u2265 1, min_catch_rate: in (0, 1) }`);
        }
        if (ev.random_selection === true && t.sampling?.review_rate === void 0) errors.push(`${at3}.evidence.random_selection needs sampling.review_rate: only drawn reviews count, so something must be drawn`);
      }
    }
    if (t.basis !== void 0 && typeof t.basis !== "string") errors.push(`${at3}.basis must be words`);
    if (t.grant_signatures !== void 0) {
      if (!Number.isInteger(t.grant_signatures) || t.grant_signatures < 1 || t.grant_signatures > MAX_SIGNATURES) errors.push(`${at3}.grant_signatures must be an integer from 1 to ${MAX_SIGNATURES} (the people who sign a GRANT of autonomy)`);
      else if (t.grant_signatures > 1 && cap !== "autonomy") warnings.push(`${at3}.grant_signatures is never used: it binds a GRANT of autonomy, which is not grantable at this tier (max_rung ${cap})`);
    }
    const confOk = typeof t.confidence === "number" && t.confidence >= 0.5 && t.confidence < 1;
    if (methodOk && confOk && policy.sidedness !== "two-sided") {
      for (const r of RUNGS) {
        const b = t[r];
        if (!b || !Number.isInteger(b.min_n) || !(b.max_error > 0 && b.max_error < 1) || levelRank(r) > levelRank(cap)) continue;
        const z = zeroMissN(b.max_error, t.confidence, policy.method, "one-sided");
        if (b.min_n < z) warnings.push(`${at3}.${r}: min_n ${b.min_n} can never clear its own bar: with 0 misses, the ${describeBound(t.confidence, policy.method)} upper bound first reaches ${pct2(b.max_error)} at n = ${z}. The real minimum is ${z}; declare it (the zero-miss n) so the stated burden is the true one`);
      }
      const c = t.evidence?.canaries;
      if (c && Number.isInteger(c.min_n) && c.min_catch_rate > 0 && c.min_catch_rate < 1) {
        const z = zeroMissN(1 - c.min_catch_rate, t.confidence, policy.method, "one-sided");
        if (c.min_n < z) warnings.push(`${at3}.evidence.canaries: min_n ${c.min_n} can never show a ${pct2(c.min_catch_rate)} catch rate: even with every canary caught, the ${describeBound(t.confidence, policy.method)} lower bound first reaches it at n = ${z}`);
      }
    }
  });
  for (let i = 1; i < policy.tiers.length; i++) {
    const lo = policy.tiers[i - 1], hi = policy.tiers[i];
    if (!lo || !hi) continue;
    if (hi.confidence < lo.confidence) errors.push(`burden decreases with consequence: ${hi.tier} confidence ${hi.confidence} < ${lo.tier} ${lo.confidence}`);
    const hiCap = capOf(hi), loCap = capOf(lo);
    for (const r of RUNGS) {
      if (!lo[r] || !hi[r]) continue;
      if (levelRank(r) > levelRank(hiCap)) continue;
      if (hi[r].min_n < lo[r].min_n) errors.push(`burden decreases with consequence: ${hi.tier}.${r} min_n ${hi[r].min_n} < ${lo.tier}.${r} ${lo[r].min_n}`);
      if (hi[r].max_error > lo[r].max_error) errors.push(`burden decreases with consequence: ${hi.tier}.${r} max_error ${hi[r].max_error} > ${lo.tier}.${r} ${lo[r].max_error}`);
    }
    if (levelRank(hiCap) > levelRank(loCap)) errors.push(`burden decreases with consequence: ${hi.tier} may be granted up to ${hiCap}, ${lo.tier} only up to ${loCap}`);
    const le = lo.evidence ?? {}, he = hi.evidence ?? {};
    for (const k of ["random_selection", "signed_reviews", "segregation"]) {
      if (le[k] === true && he[k] !== true) errors.push(`burden decreases with consequence: ${lo.tier} requires ${k} and ${hi.tier} does not`);
    }
    if (le.canaries && (!he.canaries || he.canaries.min_n < le.canaries.min_n || he.canaries.min_catch_rate < le.canaries.min_catch_rate)) {
      errors.push(`burden decreases with consequence: ${hi.tier}'s reviewer-attention requirement is weaker than ${lo.tier}'s`);
    }
    const ls = lo.sampling, hs = hi.sampling;
    if (ls?.review_rate !== void 0 && (hs?.review_rate === void 0 || hs.review_rate < ls.review_rate)) errors.push(`burden decreases with consequence: ${hi.tier} draws fewer reviews than ${lo.tier}`);
    if (hiCap === "autonomy" && loCap === "autonomy" && (hi.grant_signatures ?? 1) < (lo.grant_signatures ?? 1)) {
      errors.push(`burden decreases with consequence: ${hi.tier} needs ${hi.grant_signatures ?? 1} signature(s) on a grant of autonomy, ${lo.tier} ${lo.grant_signatures ?? 1}`);
    }
    if (hiCap === "autonomy" && loCap === "autonomy" && ls?.surveillance_rate !== void 0 && (hs?.surveillance_rate === void 0 || hs.surveillance_rate < ls.surveillance_rate)) {
      errors.push(`burden decreases with consequence: ${hi.tier} surveils autonomy less than ${lo.tier}`);
    }
    if (ls && hs && isPeriodUnit(ls.period) && isPeriodUnit(hs.period) && PERIOD_LENGTH_RANK[hs.period] > PERIOD_LENGTH_RANK[ls.period]) {
      errors.push(`burden decreases with consequence: ${hi.tier} re-tests every ${hs.period}, less often than ${lo.tier}'s ${ls.period}`);
    }
  }
  return { ok: errors.length === 0, errors, ...warnings.length ? { warnings } : {} };
}
function policyRef(policy) {
  return { policy_id: policy.policy_id, version: policy.version, hash: hashOf(policy) };
}
function isBookDeclaration(d) {
  return !!d && typeof d === "object" && d.book !== void 0;
}
var pct2 = (x) => `${Number((x * 100).toPrecision(3))}%`;
function rungEvidence(cal, rung, adj) {
  const passMetric = RUNG_METRIC[rung] === "false_pass_rate";
  const reviewed = passMetric ? cal.evidence.reviewed_pass : cal.evidence.reviewed_fail;
  const wrong = passMetric ? cal.evidence.false_pass : cal.evidence.false_fail;
  const noun = passMetric ? "reviewed PASS verdicts" : "reviewed FAIL verdicts";
  if (!adj) return { n: reviewed.length, errors: wrong.length, counter: wrong, noun, untested: [] };
  const out = new Set(adj.set_aside.map((x) => x.verdict_id));
  const held = new Set(adj.held);
  const counted = reviewed.filter((id) => !out.has(id) && !held.has(id));
  const misses = wrong.filter((id) => !out.has(id));
  const untested = passMetric ? adj.untested.PASS : adj.untested.FAIL;
  return { n: counted.length + untested.length, errors: misses.length + untested.length, counter: [...misses, ...untested].sort(), noun, untested: [...untested] };
}
function assessRung(rung, cal, tier, method, sidedness = "one-sided", adj) {
  const { n, errors, counter, noun, untested } = rungEvidence(cal, rung, adj);
  const bar = tier[rung];
  const { lower, upper } = rateInterval(errors, n, tier.confidence, method, sidedness);
  const bound = `${pct2(tier.confidence)} ${method} upper bound (${sidedness}) ${pct2(upper)} (${errors}/${n})`;
  const cap = tier.max_rung ?? "autonomy";
  let cleared = false, reason;
  if (levelRank(rung) > levelRank(cap)) reason = `not grantable at tier '${tier.tier}': its highest grantable rung is ${cap}`;
  else if (n < bar.min_n) reason = `${n} ${noun} < minimum ${bar.min_n}`;
  else if (upper > bar.max_error) reason = `${bound} > bar ${pct2(bar.max_error)}`;
  else {
    cleared = true;
    reason = `${n} ${noun} \u2265 ${bar.min_n}; ${bound} \u2264 bar ${pct2(bar.max_error)}`;
  }
  return {
    rung,
    metric: RUNG_METRIC[rung],
    n,
    errors,
    point: n === 0 ? null : errors / n,
    lower,
    upper,
    confidence: tier.confidence,
    method,
    sidedness,
    bar: { ...bar },
    cleared,
    reason,
    counter_cases: [...counter],
    ...untested.length ? { untested } : {}
  };
}
function calibrationIntact(cal) {
  const { calibration_hash, ...body } = cal;
  return hashOf(body) === calibration_hash;
}
function assessVoice(calibration, declaration, policy) {
  if (isBookDeclaration(declaration)) return assessFromBook(calibration, declaration, policy);
  const out = assessCore(calibration, declaration, policy);
  return { ...out, assessment_hash: hashOf(out) };
}
function readBook(book, trusted_keys, root_keys) {
  const opts = { ...trusted_keys ? { trusted_keys } : {}, ...root_keys ? { root_keys } : {} };
  if (book && typeof book.decisionBook === "function") return book.decisionBook(opts);
  const c = book;
  if (!c || !Array.isArray(c.events) || !Array.isArray(c.payloads)) throw new Error("book must be a Ledger or a chain export { events, payloads }");
  return readDecisionBook(c.events, c.payloads, opts);
}
function assessFromBook(calibration, bd, policy) {
  if (typeof bd.workflow_id !== "string" || !bd.workflow_id) throw new Error("a book declaration names its workflow_id");
  const book = readBook(bd.book, bd.trusted_keys, bd.root_keys);
  if (!book.ok) {
    const at3 = book.check.brokenAt !== void 0 ? ` at event ${book.check.brokenAt}` : "";
    throw new Error(`the book of record does not verify${at3} (${book.check.reason ?? "unknown"}): a tampered, mis-signed or unanchored book grants nothing, and no rung can be read from it`);
  }
  const wf = bd.workflow_id;
  const flag = bd.granted;
  const reading = { policies: [policy], governing_policy: policy };
  const g = grantInForce(book.decisions, wf, reading);
  const inert = noEffect(book, { workflow_id: wf, policy_id: policy.policy_id, ...reading });
  const inertGrants = inert.filter((n) => n.kind === "GRANT");
  const unanchoredWhy = inertGrants.length ? ` ${inertGrants.map((n) => n.notice).join("; ")}.` : "";
  const noGrant = inertGrants.some((n) => n.pending) ? "in-force " : inertGrants.length ? "anchored " : "";
  let decl;
  if (g) {
    const gd = g.signed.decision;
    if (bd.consequence_tier !== void 0 && bd.consequence_tier !== gd.consequence_tier) {
      throw new Error(`the grant in force (${g.decision_id}, seq ${g.seq}) was made at consequence tier '${gd.consequence_tier}', not '${bd.consequence_tier}'. Settings are fixed at grant time; re-declaring the tier is a person's re-grant`);
    }
    if (flag !== void 0 && flag !== gd.level) {
      throw new Error(`the rung is read from the book of record: the grant in force (${g.decision_id}, seq ${g.seq}) is ${gd.level}, not ${String(flag)}. A flag cannot override a person's signed grant`);
    }
    decl = {
      workflow_id: wf,
      consequence_tier: gd.consequence_tier,
      granted: gd.level,
      ...gd.bounds !== void 0 ? { bounds: gd.bounds } : {},
      grant: { level: gd.level, signer_id: gd.signer_id, signed_at: gd.signed_at, policy: { ...gd.policy }, consequence_tier: gd.consequence_tier, ...gd.note !== void 0 ? { note: gd.note } : {} }
    };
  } else {
    if (bd.consequence_tier === void 0) {
      throw new Error(`no ${noGrant}GRANT for workflow ${wf} is on the book, and no consequence_tier was declared: nothing is granted (the rung is record), but the burden of proof needs a declared tier to measure against.${unanchoredWhy}`);
    }
    if (flag !== void 0 && flag !== "record") {
      throw new Error(`the rung is read from the book of record: no ${noGrant}GRANT for workflow ${wf} is on it, so the rung is record, not ${String(flag)}. Only a person's signed grant moves it.${unanchoredWhy}`);
    }
    decl = { workflow_id: wf, consequence_tier: bd.consequence_tier, granted: "record" };
  }
  const lint = lintPolicy(policy);
  if (!lint.ok) throw new Error(`invalid promotion policy: ${lint.errors.join("; ")}`);
  const tierReq = policy.tiers.find((t) => t.tier === decl.consequence_tier);
  let audit;
  const chainNow = () => typeof bd.book.snapshot === "function" ? bd.book.snapshot() : bd.book;
  const fresh = g && calibration.workflow_id === wf ? stepDownWindow(g, book, chainNow, calibration, reading) : void 0;
  if (tierReq && calibration.workflow_id === wf && auditApplies(tierReq, book, wf)) {
    const chain = chainNow();
    audit = auditEvidence({
      workflow_id: wf,
      events: chain.events,
      payloads: chain.payloads,
      book,
      tier: tierReq,
      method: policy.method,
      sidedness: policy.sidedness ?? "one-sided",
      calibration,
      ...g ? { grant: g } : {},
      policy
    });
  }
  const out = assessCore(calibration, decl, policy, audit?.adjustment, fresh);
  const citation = { head: book.check.head, length: book.check.length };
  if (g) {
    const cosigned = grantSignatures(g, book.decisions, reading).cosigns;
    citation.grant = { decision_id: g.decision_id, seq: g.seq, entry_hash: g.entry_hash, ...cosigned.length ? { cosigned_by: cosigned.map((c) => ({ decision_id: c.decision_id, seq: c.seq, signer_id: c.signer_id })) } : {} };
  }
  if (out.proposal) {
    const p = out.proposal;
    const binding = declinesFor(book.decisions, wf).filter((e) => declineBinds(e.signed.decision, p, g?.decision_id));
    const last = binding[binding.length - 1];
    if (last) {
      const d = last.signed.decision;
      const standing = declineStanding(d, p, out.blockers);
      const cite = {
        decision_id: last.decision_id,
        seq: last.seq,
        entry_hash: last.entry_hash,
        signer_id: d.signer_id,
        signed_at: d.signed_at,
        reason: d.reason,
        proposal_kind: d.proposal_kind,
        declined_proposal_id: d.proposal_id,
        why: standing.why
      };
      if (standing.stands) {
        citation.declined = { ...cite, suppressed_proposal_id: p.proposal_id, re_raise_when: standing.re_raise_when };
        delete out.proposal;
      } else {
        citation.decline_lapsed = cite;
      }
    }
  }
  const later = revisionsOf(book.decisions, policy.policy_id).filter((e) => e.signed.decision.supersedes.hash === out.policy.hash);
  if (later.length) {
    citation.superseded_by = later.map((e) => ({ policy: { ...e.signed.decision.policy }, decision_id: e.decision_id, seq: e.seq, lints: lintPolicy(e.signed.decision.policy_body).ok }));
  }
  if (book.unanchored.length) citation.unanchored_signers = [...book.unanchored];
  if (inert.length) citation.no_effect = inert;
  if (audit) citation.evidence = audit.citation;
  const final = { ...out, book: citation };
  return { ...final, assessment_hash: hashOf(final) };
}
function declineBinds(d, p, grantId) {
  return d.workflow_id === p.workflow_id && d.proposal_kind === p.kind && d.from === p.from && d.to === p.to && d.consequence_tier === p.consequence_tier && d.policy.hash === p.policy.hash && (d.under_grant ?? null) === (grantId ?? null);
}
function declineStanding(d, p, blockers) {
  if (p.kind === "DEMOTION_PROPOSAL") {
    const seenCases = new Set(d.seen.failing_cases);
    const seenBlockers = new Set(d.seen.blockers);
    const newCases = p.failing_cases.map((c) => c.verdict_id).filter((id) => !seenCases.has(id)).sort();
    const newBlockers = blockers.filter((b) => !seenBlockers.has(b));
    const re_raise_when = "a new failing case (a verdict a person overturns that counts against the granted rung) or a new evidence blocker. Clean reviews never re-raise it; a person may re-grant at any time";
    if (newCases.length || newBlockers.length) {
      const parts = [
        ...newCases.length ? [`${newCases.length} new failing case(s) (${newCases.join(", ")})`] : [],
        ...newBlockers.length ? [`${newBlockers.length} new blocker(s)`] : []
      ];
      return { stands: false, why: `the evidence against the grant changed since the decline: ${parts.join("; ")}`, re_raise_when };
    }
    return { stands: true, why: `no new failing case or blocker since ${d.signer_id} declined it at ${d.signed_at} (${d.seen.failing_cases.length} failing case(s) seen)`, re_raise_when };
  }
  const target = p.to;
  const now = p.rungs.find((r) => r.rung === target);
  const seenN = d.seen.rungs.find((r) => r.rung === target)?.n ?? 0;
  const min = now?.bar.min_n ?? 1;
  const fresh = Math.max(0, (now?.n ?? 0) - seenN);
  const noun = RUNG_METRIC[target] === "false_pass_rate" ? "reviewed PASS verdict(s)" : "reviewed FAIL verdict(s)";
  if (fresh >= min) {
    return { stands: false, why: `${fresh} fresh ${noun} since the decline \u2265 ${target}'s min_n ${min}: a fresh sample the size the policy itself requires`, re_raise_when: `already met (${fresh} \u2265 ${min})` };
  }
  return {
    stands: true,
    why: `${fresh} of ${min} fresh ${noun} since ${d.signer_id} declined it at ${d.signed_at}`,
    re_raise_when: `${min - fresh} more ${noun}: a fresh sample of ${target}'s own min_n (${min}) since the decline`
  };
}
function tierSignatures(policy, consequence_tier, level) {
  if (level !== "autonomy") return 1;
  return policy.tiers.find((t) => t.tier === consequence_tier)?.grant_signatures ?? 1;
}
function grantUnderPolicy(policy, input) {
  const lint = lintPolicy(policy);
  if (!lint.ok) throw new DecisionRefused(`the policy does not lint: ${lint.errors.join("; ")}`);
  const tier = policy.tiers.find((t) => t.tier === input.consequence_tier);
  if (!tier) throw new DecisionRefused(`consequence tier ${JSON.stringify(input.consequence_tier)} is not declared in policy ${policy.policy_id}@${policy.version} (tiers: ${policy.tiers.map((t) => t.tier).join(", ")})`);
  const cap = tier.max_rung ?? "autonomy";
  if (levelRank(input.level) > levelRank(cap)) {
    throw new DecisionRefused(`tier '${tier.tier}' caps the grantable rung at ${cap}: ${input.level} is not grantable at this tier${tier.basis ? ` (${tier.basis.split(". ")[0]})` : ""}`);
  }
  const needed = tierSignatures(policy, tier.tier, input.level);
  if (input.signatures !== void 0 && input.signatures < needed) {
    throw new DecisionRefused(`tier '${tier.tier}' requires ${needed} signatures on a GRANT of ${input.level} (dual authorization); this grant states ${input.signatures}`);
  }
  const signatures = Math.max(needed, input.signatures ?? 1);
  const { signatures: _stated, ...rest } = input;
  return makeGrant({ ...rest, policy: policyRef(policy), ...signatures > 1 ? { signatures } : {} });
}
function assessCore(calibration, declaration, policy, adj, fresh) {
  const lint = lintPolicy(policy);
  if (!lint.ok) throw new Error(`invalid promotion policy: ${lint.errors.join("; ")}`);
  if (!VOICE_LADDER.includes(declaration.granted)) throw new Error(`granted must be one of ${VOICE_LADDER.join(", ")}`);
  if (declaration.workflow_id !== calibration.workflow_id) throw new Error(`the declaration is for ${declaration.workflow_id} but the calibration is for ${calibration.workflow_id}`);
  const tier = policy.tiers.find((t) => t.tier === declaration.consequence_tier);
  if (!tier) throw new Error(`consequence tier ${JSON.stringify(declaration.consequence_tier)} is not declared in policy ${policy.policy_id}@${policy.version} (tiers: ${policy.tiers.map((t) => t.tier).join(", ")})`);
  const cap = tier.max_rung ?? "autonomy";
  if (levelRank(declaration.granted) > levelRank(cap)) {
    throw new Error(`tier '${tier.tier}' of ${policy.policy_id}@${policy.version} caps the grantable rung at ${cap}: ${declaration.granted} is not grantable at this tier. A person re-grants at ${cap} or below`);
  }
  const pref = policyRef(policy);
  const g = declaration.grant;
  if (g !== void 0) {
    if (!g.signer_id || !g.signed_at) throw new Error("a grant is a person's decision: it needs signer_id and signed_at");
    if (g.level !== declaration.granted) throw new Error(`the grant is for ${g.level} but the declaration says ${declaration.granted}`);
    if (g.policy.hash !== pref.hash) {
      throw new Error(`the grant was made under policy ${g.policy.policy_id}@${g.policy.version} (${g.policy.hash.slice(0, 12)}\u2026), not ${pref.policy_id}@${pref.version} (${pref.hash.slice(0, 12)}\u2026). Settings are fixed at grant time: assess under the grant's policy, or have a person revise the policy (revisePolicy) and re-grant under it`);
    }
    if (g.consequence_tier !== declaration.consequence_tier) {
      throw new Error(`the grant was made at consequence tier '${g.consequence_tier}', not '${declaration.consequence_tier}'. Settings are fixed at grant time; re-declaring the tier is a person's re-grant`);
    }
  }
  const blockers = [];
  const failureBlockers = [];
  if (!calibrationIntact(calibration)) {
    const b = "the calibration does not match its own hash (altered after it was computed); its evidence supports nothing";
    blockers.push(b);
    failureBlockers.push(b);
  }
  if (calibration.versions.length > 1) {
    blockers.push(`the evidence spans ${calibration.versions.length} ruleset/engine versions (${calibration.versions.join("; ")}); a version change changes behaviour, so the old record no longer describes it (the declared_accuracy precedent). Start a fresh record per version`);
  }
  if (adj) {
    blockers.push(...adj.blockers);
    failureBlockers.push(...adj.failure_blockers);
  }
  const rungs = RUNGS.map((r) => assessRung(r, calibration, tier, policy.method, policy.sidedness ?? "one-sided", adj));
  let earned = "record";
  if (blockers.length === 0) {
    for (const r of rungs) {
      if (!r.cleared) break;
      earned = r.rung;
    }
  }
  const gi = levelRank(declaration.granted), ei = levelRank(earned);
  const out = {
    assessment_version: "voice-v0",
    workflow_id: calibration.workflow_id,
    consequence_tier: tier.tier,
    ...declaration.bounds !== void 0 ? { bounds: declaration.bounds } : {},
    granted: declaration.granted,
    level: declaration.granted,
    earned,
    ...g ? { grant: { ...g, policy: { ...g.policy } } } : {},
    handling: ACTION_HANDLING[declaration.granted],
    rungs,
    blockers,
    policy: pref,
    calibration_hash: calibration.calibration_hash
  };
  const common = {
    status: "PROPOSED",
    requires_human_signature: true,
    workflow_id: calibration.workflow_id,
    consequence_tier: tier.tier,
    ...declaration.bounds !== void 0 ? { bounds: declaration.bounds } : {},
    from: declaration.granted,
    earned,
    policy: pref,
    calibration_hash: calibration.calibration_hash
  };
  const trigger = adj && declaration.granted === "autonomy" ? adj.surveillance_cases : [];
  const returning = fresh && ei > gi && levelRank(VOICE_LADDER[gi + 1]) <= levelRank(fresh.from);
  const windowRung = returning ? assessRung(VOICE_LADDER[gi + 1], windowOf(calibration, fresh.ids), tier, policy.method, policy.sidedness ?? "one-sided", adj) : void 0;
  if (fresh) out.fresh_window = { from: fresh.from, since: { ...fresh.since }, records: fresh.records, ...windowRung ? { rung: windowRung } : {} };
  if (ei > gi && (!windowRung || windowRung.cleared)) {
    const to = VOICE_LADDER[gi + 1];
    const body = { kind: "PROMOTION_PROPOSAL", urgent: false, ...common, to, rungs: rungs.filter((r) => levelRank(r.rung) <= levelRank(to)) };
    out.proposal = { ...body, proposal_id: hashOf(body).slice(0, 32) };
  } else if (ei < gi || trigger.length) {
    const to = VOICE_LADDER[gi - 1];
    const unsupported = rungs.filter((r) => levelRank(r.rung) > ei && levelRank(r.rung) <= gi);
    const failing = rungs.filter((r) => levelRank(r.rung) <= gi && !r.cleared);
    const untestedIds = /* @__PURE__ */ new Set([...adj?.untested.PASS ?? [], ...adj?.untested.FAIL ?? []]);
    const UNTESTED = "drawn for review and still unreviewed when the next period closed: an untested item is a deviation (AS 2315 .40); reviewing it resolves this case";
    const seen = /* @__PURE__ */ new Set();
    const failing_cases = [];
    for (const r of failing) {
      for (const id of r.counter_cases) {
        if (seen.has(id)) continue;
        seen.add(id);
        failing_cases.push({ verdict_id: id, rung: r.rung, outcome: r.metric === "false_pass_rate" ? "PASS" : "FAIL", dispute: disputeCommand(id), ...untestedIds.has(id) ? { why: UNTESTED } : {} });
      }
    }
    for (const id of trigger) {
      if (seen.has(id)) continue;
      seen.add(id);
      failing_cases.push({
        verdict_id: id,
        rung: "autonomy",
        outcome: "PASS",
        dispute: disputeCommand(id),
        why: untestedIds.has(id) ? UNTESTED : "a PASS recorded after the autonomy grant that a person overturned (surveillance): the pooled bound may still clear, but a miss under autonomy is shown at once"
      });
    }
    const surveillanceReason = trigger.length ? [`surveillance: ${trigger.length} post-grant finding(s) under autonomy (${trigger.filter((id) => !untestedIds.has(id)).length} overturned, ${trigger.filter((id) => untestedIds.has(id)).length} untested)`] : [];
    const basis = failing_cases.length > 0 || failureBlockers.length > 0 ? "failure" : "unevidenced";
    const body = {
      kind: "DEMOTION_PROPOSAL",
      urgent: basis === "failure",
      basis,
      ...common,
      to,
      rungs: rungs.filter((r) => levelRank(r.rung) <= gi),
      reasons: [...blockers, ...unsupported.filter((r) => !r.cleared).map((r) => `${r.rung}: ${r.reason}`), ...surveillanceReason],
      failing_cases
    };
    out.proposal = { ...body, proposal_id: hashOf(body).slice(0, 32) };
  }
  return out;
}
function stepDownWindow(g, book, chainNow, cal, reading) {
  if (g.signed.decision.succeeds) return carriedStepDown(g, book, chainNow, reading);
  const wf = g.signed.decision.workflow_id;
  const prev = grantAt(book.decisions, wf, g.seq, reading);
  if (!prev || levelRank(prev.signed.decision.level) <= levelRank(g.signed.decision.level)) return void 0;
  const from = prev.signed.decision.level;
  const wrong = new Set(RUNG_METRIC[from] === "false_pass_rate" ? cal.evidence.false_pass : cal.evidence.false_fail);
  if (wrong.size === 0) return void 0;
  const tenant = tenantOfWorkflow(wf);
  const { events, payloads } = chainNow();
  let failure = false;
  const ids = /* @__PURE__ */ new Set();
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (ev.type === "REVIEW" && i < g.seq && wrong.has(ev.verdict_id)) {
      const t = payloads[i]?.tenant_id;
      if (t === void 0 || t === tenant) failure = true;
    } else if (ev.type === "RECORD" && i > g.seq && recordWorkflow(recordFactsAt(payloads, i) ?? payloads[i]) === wf) ids.add(ev.verdict_id);
  }
  return failure ? { from, since: { decision_id: g.decision_id, seq: g.seq }, records: ids.size, ids } : void 0;
}
function carriedStepDown(g, book, chainNow, reading) {
  const wf = g.signed.decision.workflow_id;
  let c = g;
  for (let hop = 0; hop < 16; hop++) {
    const s = c.signed.decision.succeeds;
    if (!s) return void 0;
    const next = book.decisions.find((e) => e.decision_id === s.grant && e.signed.decision.kind === "GRANT");
    if (!next) return void 0;
    c = next;
    const cw = c.signed.decision.workflow_id;
    const prev = grantAt(book.decisions, cw, c.seq, reading);
    if (!prev || levelRank(prev.signed.decision.level) <= levelRank(c.signed.decision.level)) continue;
    const from = prev.signed.decision.level;
    const wrongOutcome = RUNG_METRIC[from] === "false_pass_rate" ? "PASS" : "FAIL";
    const tenant = tenantOfWorkflow(cw);
    const { events, payloads } = chainNow();
    const outcome = /* @__PURE__ */ new Map();
    const latest = /* @__PURE__ */ new Map();
    const ids = /* @__PURE__ */ new Set();
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      if (ev.type === "RECORD") {
        const p = recordFactsAt(payloads, i) ?? payloads[i];
        const w = recordWorkflow(p);
        if (i < c.seq && w === cw && !outcome.has(ev.verdict_id)) outcome.set(ev.verdict_id, p.verdict?.outcome);
        else if (i > c.seq && w === wf) ids.add(ev.verdict_id);
      } else if (ev.type === "REVIEW" && i < c.seq && outcome.has(ev.verdict_id)) {
        const q = payloads[i];
        if (q?.tenant_id === void 0 || q.tenant_id === tenant) latest.set(ev.verdict_id, q?.review?.decision);
      }
    }
    const failure = [...latest].some(([id, d]) => d === "OVERTURNED" && outcome.get(id) === wrongOutcome);
    if (failure) return { from, since: { decision_id: c.decision_id, seq: c.seq }, records: ids.size, ids };
  }
  return void 0;
}
function windowOf(cal, ids) {
  const keep = (xs) => xs.filter((id) => ids.has(id));
  const e = cal.evidence;
  return { ...cal, evidence: { reviewed_pass: keep(e.reviewed_pass), reviewed_fail: keep(e.reviewed_fail), false_pass: keep(e.false_pass), false_fail: keep(e.false_fail) } };
}
var CAP = 1e7;
function consecutiveErrorsToBreach(errors, n, bar, confidence, method) {
  const over = (j) => rateInterval(errors + j, n + j, confidence, method).upper > bar;
  if (over(0)) return 0;
  let hi = 1;
  while (!over(hi)) {
    hi *= 2;
    if (hi > CAP) return CAP;
  }
  let lo = Math.floor(hi / 2);
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (over(mid)) hi = mid;
    else lo = mid;
  }
  return hi;
}
function errorsInHorizonToBreach(errors, n, horizon, bar, confidence, method) {
  const over = (m) => rateInterval(errors + m, n + horizon, confidence, method).upper > bar;
  if (!over(horizon)) return null;
  let lo = -1, hi = horizon;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (over(mid)) hi = mid;
    else lo = mid;
  }
  return hi;
}
function cleanReviewsToClear(errors, n, bar, confidence, method) {
  const ok2 = (c) => n + c >= bar.min_n && rateInterval(errors, n + c, confidence, method).upper <= bar.max_error;
  if (ok2(0)) return 0;
  let hi = 1;
  while (!ok2(hi)) {
    hi *= 2;
    if (hi > CAP) return null;
  }
  let lo = Math.floor(hi / 2);
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (ok2(mid)) hi = mid;
    else lo = mid;
  }
  return hi;
}

// packages/verify/src/ledger/memory.ts
import { constants as bufferConstants } from "node:buffer";
var DEFAULT_RETENTION_DAYS = 2555;
var CHAIN_EXPORT_MAX_CHARS = bufferConstants.MAX_STRING_LENGTH;
var ChainExportTooLarge = class extends Error {
  /** Events on the book. */
  events;
  /** The event at which the export passed the limit. */
  at;
  /** The character limit it passed. */
  limit;
  constructor(events, at3, limit) {
    super(
      `the chain export does not fit in one string: the book has ${events} events and the export passes ${limit} characters at event ${at3}. Stream it instead (the same bytes): writeChainJSONL(ledger, stream) or writeChainFile(ledger, path); or read the chain by reference with ledger.snapshot()`
    );
    this.name = "ChainExportTooLarge";
    this.events = events;
    this.at = at3;
    this.limit = limit;
  }
};
function emptyOutcomes() {
  return { PASS: 0, FAIL: 0, INSUFFICIENT_DATA: 0 };
}
var rk = (tenant_id, verdict_id) => `${tenant_id}\0${verdict_id}`;
var isObj4 = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
var HeapPayloads = class {
  own = [];
  get length() {
    return this.own.length;
  }
  at(i) {
    return this.own[i];
  }
  push(payload) {
    this.own.push(payload);
  }
};
var SLIM = /* @__PURE__ */ Symbol("ledger.record-index");
var MemoryLedger = class {
  /**
   * Records keyed by (tenant, verdict_id). F-A (opinion lane, 2026-09-28): keyed by verdict id alone, a second tenant's
   * RECORD of the same verdict id inherited the first tenant's review, wrote that reviewer and note into its own payload on
   * the chain, and replaced the first tenant's record. A review now never crosses tenants.
   */
  records = /* @__PURE__ */ new Map();
  /** Disk mode: the records' index entries (the verdicts stay in the book's file). */
  #slims = /* @__PURE__ */ new Map();
  #disk;
  #tenants = /* @__PURE__ */ new Map();
  /** Disk mode: the one getter / setter every handed-out record shares (no closure per record: ~100 B a record, not ~470). */
  #verdictAccessor;
  /** P-J: a handed-out record's facts from the store's index, while its verdict is still the one the ledger hands out. */
  #factsOf;
  /** verdict id → the tenant that recorded it most recently (what `get(id)` and an untargeted `review(id)` address). */
  latestOwner = /* @__PURE__ */ new Map();
  /** Every verdict id recorded (the door's `recorded` set for a canary reveal), kept as records are appended. */
  #recorded = /* @__PURE__ */ new Set();
  now;
  /**
   * Append-only event log (each event frozen) + a parallel array of each event's original payload (immutable across
   * overwrites). Private at runtime (#): the verified prefix (F5b) relies on nothing outside this class replacing an element.
   */
  #chain = [];
  #payloads;
  onAppend;
  /** signer_id → anchored public key(s). When set, only a decision signed by the signer's anchored key passes the door. */
  trustedKeys;
  /** The registry's root key(s). When set, the key registry on the book anchors every signer once it is in force (registry.ts). */
  rootKeys;
  /** F5b: the last verified read under the ledger's own anchors, and the chain it was read at. */
  #bookCache;
  /** F5c: the door's decision list (as the chain holds them: no `via`), the key registry and committed sample keys, indexed up to #indexed. */
  #doorList = [];
  #registry;
  #sampleKeys = /* @__PURE__ */ new Map();
  #indexed = 0;
  /**
   * `onAppend` persists each event before it joins the in-memory book (the file ledger writes its line there): when it
   * throws, nothing is appended and no record changes, so memory never runs ahead of the store. With `payloads` (a DiskPayloads
   * store, from openFileLedger's disk mode), `onAppend` returns where a RECORD's line was written, and `replay` streams the
   * existing book in (event, payload, line) instead of a `seed`.
   */
  constructor(opts = {}) {
    this.now = opts.now ?? (() => /* @__PURE__ */ new Date());
    this.onAppend = opts.onAppend;
    this.#payloads = opts.payloads ?? new HeapPayloads();
    this.#disk = opts.payloads !== void 0;
    const verdictOf = (s) => this.#verdictOf(s);
    this.#verdictAccessor = {
      get() {
        return verdictOf(this[SLIM]);
      },
      set(v) {
        Object.defineProperty(this, "verdict", { value: v, writable: true, enumerable: true, configurable: true });
      },
      enumerable: true,
      configurable: true
    };
    const store = opts.payloads;
    const getter = this.#verdictAccessor.get;
    this.#factsOf = (rec) => Object.getOwnPropertyDescriptor(rec, "verdict")?.get === getter ? store?.verdictFactsAt(rec[SLIM].at) : void 0;
    keepBookReaders(this.#chain, this.#payloads.own);
    if (opts.trusted_keys) this.trustedKeys = opts.trusted_keys;
    if (opts.root_keys && opts.root_keys.length) {
      new KeyRegistry(opts.root_keys);
      this.rootKeys = [...opts.root_keys];
    }
    this.#registry = new KeyRegistry(this.rootKeys);
    if (opts.seed) this.hydrate(opts.seed.events, opts.seed.payloads);
    opts.replay?.((ev, payload, line3) => this.#replay(ev, payload, line3));
  }
  /**
   * Restore state from a previously-exported chain (see `chainJSONL`) WITHOUT re-hashing — the events carry their verbatim
   * hashes, so a reopened ledger has the identical head and passes verifyContent(). Records are rebuilt by replaying the
   * payloads under the SAME rules the live methods apply (a re-RECORD keeps the earlier review, as record() does); no new
   * events are appended. The door is not re-applied: the past is immutable, and a chain written before the door still
   * opens (the read side — voice, opinions — excludes anything the door would now refuse). Decision events (GRANT,
   * DECLINE, POLICY_REVISION, KEY_*, CANARY_*) and SAMPLE events change no record; they live on the chain and are read (and
   * re-verified) by decisionBook(). A signed REVIEW replays exactly as an unsigned one (its `review` has the same shape).
   * Nothing here is verified: the first content check of a reopened ledger re-hashes every event (F5b).
   */
  hydrate(events, payloads) {
    for (let i = 0; i < events.length; i++) this.#replay(events[i], payloads[i]);
  }
  /** Replay one event of an existing book (hydrate, or the disk mode's streamed reopen): see hydrate. */
  #replay(event, payload, line3) {
    const ev = Object.freeze({ ...event });
    const at3 = this.#chain.length;
    this.#chain.push(ev);
    this.#payloads.push(payload, line3, ev);
    const p = payload ?? {};
    if (p.type === "RECORD" && p.verdict) {
      const tenant = p.tenant_id;
      const id = p.verdict.verdict_id === ev.verdict_id ? ev.verdict_id : p.verdict.verdict_id;
      if (this.#disk) {
        const prior = this.#slims.get(rk(tenant, id));
        this.#slims.set(rk(tenant, id), {
          at: at3,
          tenant_id: this.#intern(tenant),
          recorded_at: p.recorded_at === ev.ts ? ev.ts : p.recorded_at,
          retention_until: p.retention_until,
          outcome: p.verdict.outcome,
          ...prior?.review ? { review: prior.review, carried: prior.review } : {}
        });
      } else {
        const prior = this.records.get(rk(tenant, id));
        const ledgerField = { tenant_id: tenant, retention_until: p.retention_until, ...prior?.review ? { reviewer: this.reviewerOf(prior.review) } : {} };
        const verdict = hashOf(p.verdict.ledger ?? null) === hashOf(ledgerField) ? p.verdict : { ...p.verdict, ledger: ledgerField };
        this.records.set(rk(tenant, id), {
          verdict,
          tenant_id: tenant,
          recorded_at: p.recorded_at,
          retention_until: p.retention_until,
          ...prior?.review ? { review: prior.review } : {}
        });
      }
      this.latestOwner.set(id, tenant);
      this.#recorded.add(id);
    } else if (p.type === "REVIEW" && p.verdict_id && p.review) {
      const tenant = p.tenant_id ?? this.latestOwner.get(p.verdict_id);
      if (this.#disk) {
        const s = tenant !== void 0 ? this.#slims.get(rk(tenant, p.verdict_id)) : void 0;
        if (s) this.#slims.set(rk(s.tenant_id, p.verdict_id), { ...s, review: p.review, after: true });
      } else {
        const rec = tenant !== void 0 ? this.records.get(rk(tenant, p.verdict_id)) : void 0;
        if (rec) this.records.set(rk(rec.tenant_id, p.verdict_id), { ...rec, review: p.review, verdict: { ...rec.verdict, ledger: { tenant_id: rec.tenant_id, retention_until: rec.retention_until, reviewer: this.reviewerOf(p.review) } } });
      }
    }
  }
  #intern(tenant) {
    const known = this.#tenants.get(tenant);
    if (known !== void 0) return known;
    this.#tenants.set(tenant, tenant);
    return tenant;
  }
  /** Disk mode: a slim record's verdict, rebuilt exactly as the heap mode holds it (hydrate / record / review). */
  #verdictOf(s) {
    const pv = this.#payloads.at(s.at).verdict;
    const atRecord = { tenant_id: s.tenant_id, retention_until: s.retention_until, ...s.carried ? { reviewer: this.reviewerOf(s.carried) } : {} };
    s.own ??= hashOf(pv.ledger ?? null) === hashOf(atRecord);
    const v = s.own ? pv : { ...pv, ledger: atRecord };
    return s.after ? { ...v, ledger: { tenant_id: s.tenant_id, retention_until: s.retention_until, reviewer: this.reviewerOf(s.review) } } : v;
  }
  /** Disk mode: a record whose `verdict` is read from the book's file when it is read (never held by the ledger). */
  #lazy(s) {
    const rec = {};
    Object.defineProperty(rec, SLIM, { value: s });
    Object.defineProperty(rec, RECORD_FACTS, { value: this.#factsOf });
    Object.defineProperty(rec, "verdict", this.#verdictAccessor);
    rec.tenant_id = s.tenant_id;
    rec.recorded_at = s.recorded_at;
    rec.retention_until = s.retention_until;
    if (s.review) rec.review = s.review;
    return rec;
  }
  /**
   * Append one event, linking it to the current head. The payload is retained verbatim for content verification/export.
   * The store (onAppend) is written FIRST: if it throws, the event never joins the book.
   */
  append(type, verdict_id, payload, ts) {
    const seq = this.#chain.length;
    const prev = seq === 0 ? GENESIS : this.#chain[seq - 1].entry_hash;
    const ev = Object.freeze(linkEvent(seq, prev, { ts, type, verdict_id, payload }));
    const line3 = this.onAppend?.(ev, payload);
    this.#chain.push(ev);
    this.#payloads.push(payload, line3 || void 0, ev);
    return ev;
  }
  /**
   * F5c: bring the door's indexes up to the head: the decision list (each entry as the chain holds it), the key registry
   * (folded exactly as decisions.ts registryOf replays it) and the committed sample keys. O(events appended since).
   */
  #index() {
    for (let i = this.#indexed; i < this.#chain.length; i++) {
      const ev = this.#chain[i];
      if (ev.type === "SAMPLE") {
        const s = this.#payloads.at(i)?.sample;
        if (isObj4(s) && isObj4(s.period) && isObj4(s.rates)) {
          const key = sampleKey(s);
          if (!this.#sampleKeys.has(key)) this.#sampleKeys.set(key, i);
        }
        continue;
      }
      if (!isBookDecisionKind(ev.type)) continue;
      const signed = this.#payloads.at(i)?.signed;
      if (!signed) continue;
      this.#doorList.push({ seq: ev.seq, entry_hash: ev.entry_hash, recorded_at: ev.ts, decision_id: signed.decision_id, signed });
      const d = isObj4(signed.decision) ? signed.decision : void 0;
      if (this.#registry.rooted && d && (d.kind === "KEY_REGISTER" || d.kind === "KEY_REVOKE") && !this.#registry.keyEventProblem(ev.seq, d, signed.public_key)) {
        this.#registry.apply(ev.seq, signed.decision_id, d);
      }
    }
    this.#indexed = this.#chain.length;
  }
  /**
   * THE DOOR: only a well-formed VERDICT enters the book of record (`assertVerdict`: not generated, verdict-shaped,
   * replayable, bound to its inputs, every PASS/FAIL evidenced and DETERMINISTIC). COUNSEL can never be recorded as a
   * VERDICT. A refusal throws ChannelViolation and appends nothing. The stored bytes of an admitted verdict are unchanged.
   */
  record(verdict, opts) {
    assertVerdict(verdict);
    const recordedAt = this.now();
    const retentionDays = opts.retention_days ?? DEFAULT_RETENTION_DAYS;
    const retention_until = new Date(recordedAt.getTime() + retentionDays * 864e5).toISOString();
    const recorded_at = recordedAt.toISOString();
    const existing = this.#disk ? this.#slims.get(rk(opts.tenant_id, verdict.verdict_id)) : this.records.get(rk(opts.tenant_id, verdict.verdict_id));
    const stored = {
      ...verdict,
      ledger: { tenant_id: opts.tenant_id, retention_until, ...existing?.review ? { reviewer: this.reviewerOf(existing.review) } : {} }
    };
    const rec = { verdict: stored, tenant_id: opts.tenant_id, recorded_at, retention_until, ...existing?.review ? { review: existing.review } : {} };
    const ev = this.append("RECORD", verdict.verdict_id, { type: "RECORD", tenant_id: opts.tenant_id, recorded_at, retention_until, verdict: stored }, recorded_at);
    if (this.#disk) {
      this.#slims.set(rk(opts.tenant_id, verdict.verdict_id), {
        at: ev.seq,
        tenant_id: this.#intern(opts.tenant_id),
        recorded_at: ev.ts,
        retention_until,
        outcome: verdict.outcome,
        ...existing?.review ? { review: existing.review, carried: existing.review } : {},
        own: true
      });
    } else {
      this.records.set(rk(opts.tenant_id, verdict.verdict_id), rec);
    }
    this.latestOwner.set(verdict.verdict_id, opts.tenant_id);
    this.#recorded.add(verdict.verdict_id);
    return rec;
  }
  get(verdict_id, tenant_id) {
    const tenant = tenant_id ?? this.latestOwner.get(verdict_id);
    if (tenant === void 0) return void 0;
    if (!this.#disk) return this.records.get(rk(tenant, verdict_id));
    const s = this.#slims.get(rk(tenant, verdict_id));
    return s && this.#lazy(s);
  }
  review(verdict_id, review, opts = {}) {
    const rec = this.get(verdict_id, opts.tenant_id);
    if (!rec) throw new Error(`cannot review verdict ${verdict_id}${opts.tenant_id !== void 0 ? ` for tenant ${opts.tenant_id}` : ""}: not recorded`);
    return this.applyReview(rec, verdict_id, { ...review, decided_at: this.now().toISOString() });
  }
  applyReview(rec, verdict_id, full, signed) {
    if (this.#disk) {
      const key = rk(rec.tenant_id, verdict_id);
      const s = this.#slims.get(key);
      this.append("REVIEW", verdict_id, { type: "REVIEW", verdict_id, tenant_id: rec.tenant_id, review: full, ...signed ? { signed } : {} }, full.decided_at);
      const next = { ...s, review: full, after: true };
      this.#slims.set(key, next);
      return this.#lazy(next);
    }
    const updated = {
      ...rec,
      review: full,
      verdict: { ...rec.verdict, ledger: { tenant_id: rec.tenant_id, retention_until: rec.retention_until, reviewer: this.reviewerOf(full) } }
    };
    this.append("REVIEW", verdict_id, { type: "REVIEW", verdict_id, tenant_id: rec.tenant_id, review: full, ...signed ? { signed } : {} }, full.decided_at);
    this.records.set(rk(rec.tenant_id, verdict_id), updated);
    return updated;
  }
  /** The key registry at the head (kept incrementally, F5c; the read side re-verifies it in full). */
  registry() {
    this.#index();
    return this.#registry;
  }
  /** THE DOOR for a person's signed review: verified, anchored (the `reviewer` role once the registry is in force), recorded. */
  reviewSigned(signed) {
    const sig = verifySignature(signed);
    if (!sig.ok) throw new DecisionRefused(sig.reason ?? "the review does not verify");
    const clean = JSON.parse(canonicalize(signed));
    const d = clean.decision;
    if (d.kind !== "REVIEW") throw new DecisionRefused(`reviewSigned takes a signed REVIEW, not a ${String(d.kind)} (use decide)`);
    const rec = this.get(d.verdict_id, d.tenant_id);
    if (!rec) throw new DecisionRefused(`cannot review verdict ${d.verdict_id}${d.tenant_id !== void 0 ? ` for tenant ${d.tenant_id}` : ""}: not recorded`);
    const auth = authorizeSigner(this.registry(), this.#chain.length, "REVIEW", d.signer_id, clean.public_key, this.trustedKeys, rec.tenant_id);
    if (!auth.ok) throw new DecisionRefused(auth.reason ?? "the reviewer is not anchored");
    const full = { reviewer_id: d.signer_id, decision: d.decision, decided_at: this.now().toISOString(), ...d.note !== void 0 ? { note: d.note } : {} };
    return this.applyReview(rec, d.verdict_id, full, clean);
  }
  /** THE DOOR for a random review queue: re-derived from the chain; refused when open, empty, malformed or already committed. */
  commitSample(req) {
    const body = deriveSample(this.#chain, this.#payloads.own, req);
    if ("problem" in body) throw new SampleRefused(body.problem);
    const key = sampleKey(body);
    this.#index();
    const prior = this.#sampleKeys.get(key);
    if (prior !== void 0) throw new SampleRefused(`this draw is already committed (seq ${prior}): one queue per workflow, period and rates`);
    const recorded_at = this.now().toISOString();
    const payload = { type: "SAMPLE", recorded_at, sample: body };
    const ev = this.append("SAMPLE", sampleSubject(body), payload, recorded_at);
    return { seq: ev.seq, entry_hash: ev.entry_hash, recorded_at, sample: structuredClone(body) };
  }
  reviewerOf(r) {
    return { id: r.reviewer_id, decided_at: r.decided_at, decision: r.decision, ...r.note !== void 0 ? { note: r.note } : {} };
  }
  query(q = {}) {
    if (this.#disk) {
      const out = [];
      for (const s of this.#slims.values()) {
        if (q.tenant_id !== void 0 && s.tenant_id !== q.tenant_id) continue;
        if (q.outcome !== void 0 && s.outcome !== q.outcome) continue;
        if (q.reviewed === true && !s.review) continue;
        if (q.reviewed === false && s.review) continue;
        if (q.since !== void 0 && s.recorded_at < q.since) continue;
        out.push(this.#lazy(s));
      }
      return out;
    }
    return this.all().filter((r) => {
      if (q.tenant_id !== void 0 && r.tenant_id !== q.tenant_id) return false;
      if (q.outcome !== void 0 && r.verdict.outcome !== q.outcome) return false;
      if (q.reviewed === true && !r.review) return false;
      if (q.reviewed === false && r.review) return false;
      if (q.since !== void 0 && r.recorded_at < q.since) return false;
      return true;
    });
  }
  stats(tenant_id) {
    const by_outcome = emptyOutcomes();
    let reviewed = 0, upheld = 0, overturned = 0;
    if (this.#disk) {
      let total = 0;
      for (const s of this.#slims.values()) {
        if (tenant_id !== void 0 && s.tenant_id !== tenant_id) continue;
        total++;
        by_outcome[s.outcome]++;
        if (s.review) {
          reviewed++;
          if (s.review.decision === "OVERTURNED") overturned++;
          else upheld++;
        }
      }
      return { total, by_outcome, reviewed, upheld, overturned, overturn_rate: reviewed === 0 ? 0 : overturned / reviewed };
    }
    const rows = tenant_id === void 0 ? this.all() : this.query({ tenant_id });
    for (const r of rows) {
      by_outcome[r.verdict.outcome]++;
      if (r.review) {
        reviewed++;
        if (r.review.decision === "OVERTURNED") overturned++;
        else upheld++;
      }
    }
    return { total: rows.length, by_outcome, reviewed, upheld, overturned, overturn_rate: reviewed === 0 ? 0 : overturned / reviewed };
  }
  all() {
    if (this.#disk) return Array.from(this.#slims.values(), (s) => this.#lazy(s));
    return [...this.records.values()];
  }
  toJSONL() {
    return this.all().map((r) => JSON.stringify(r)).join("\n");
  }
  // ---- tamper-evident hash chain ----
  events() {
    return this.#chain.map((e) => ({ ...e }));
  }
  chainHead() {
    return this.#chain.length === 0 ? GENESIS : this.#chain[this.#chain.length - 1].entry_hash;
  }
  verifyChain() {
    return verifyChain(this.#chain);
  }
  /**
   * Payload hashes, event headers against their hashed payloads, and every decision re-verified (readDecisionBook). After a
   * check, only the events appended since are re-hashed (F5b; the result's `reused` says so); `{ full: true }` re-hashes all.
   */
  verifyContent(opts = {}) {
    return this.decisionBook(opts.full ? { full: true } : {}).check;
  }
  /**
   * The chain as ONE string (lines joined by '\n', no final newline). Past `maxChars` (default: the runtime's string ceiling)
   * it throws ChainExportTooLarge instead of a RangeError, naming the streaming paths that write the same bytes.
   */
  chainJSONL(opts = {}) {
    const limit = Math.min(opts.maxChars ?? CHAIN_EXPORT_MAX_CHARS, CHAIN_EXPORT_MAX_CHARS);
    const n = this.#chain.length;
    const lines = new Array(n);
    let chars = 0;
    for (let i = 0; i < n; i++) {
      const line3 = JSON.stringify({ ...this.#chain[i], payload: this.#payloads.at(i) });
      chars += line3.length + (i > 0 ? 1 : 0);
      if (chars > limit) throw new ChainExportTooLarge(n, i, limit);
      lines[i] = line3;
    }
    return lines.join("\n");
  }
  /**
   * F2: the chain as it stands now, by reference: fresh arrays (the caller may edit its copy; the book never changes) holding
   * the ledger's own event objects (frozen) and payload objects (not to be mutated). When this ledger has verified a prefix,
   * the snapshot carries that certificate (chain.ts), so a reader of it (readDecisionBook, openSnapshot) re-hashes only what
   * came after; a copy edited at any verified position is re-hashed in full.
   */
  snapshot() {
    const events = this.#chain.slice();
    const payloads = this.#disk ? this.#payloads.view(events.length) : this.#payloads.own.slice();
    const p = prefixOf(this.#chain);
    if (p) certifyPrefix(events, p);
    shareBookReaders(this.#chain, events);
    return { events, payloads };
  }
  // ---- a person's decisions (./decisions.ts) ----
  /**
   * THE DOOR for decisions: verified; anchored (the registry's role once it is in force, else trusted keys, else unanchored);
   * key events authorized by the root or a key_admin; consistent with the book; else refused, appending nothing.
   */
  decide(signed) {
    const sig = verifySignature(signed);
    if (!sig.ok) throw new DecisionRefused(sig.reason ?? "the decision does not verify");
    const clean = JSON.parse(canonicalize(signed));
    const d = clean.decision;
    if (!isBookDecisionKind(d.kind)) throw new DecisionRefused(`a ${String(d.kind)} is not a decision event: append a signed review with reviewSigned`);
    const whole = this.decisionBook();
    if (!whole.ok) {
      const at3 = whole.check.brokenAt !== void 0 ? ` at event ${whole.check.brokenAt}` : "";
      throw new DecisionRefused(`the book does not verify${at3} (${whole.check.reason ?? "unknown"}): nothing is decided on a broken book`);
    }
    const seq = this.#chain.length;
    const reg = this.registry();
    if (d.kind === "KEY_REGISTER" || d.kind === "KEY_REVOKE") {
      const kp = reg.keyEventProblem(seq, d, clean.public_key);
      if (kp) throw new DecisionRefused(kp);
    } else {
      const auth = authorizeSigner(reg, seq, d.kind, d.signer_id, clean.public_key, this.trustedKeys, decisionTenant(d));
      if (!auth.ok) throw new DecisionRefused(auth.reason ?? "the signer is not anchored");
    }
    const anchored = this.trustedKeys !== void 0 || this.rootKeys !== void 0;
    const conflict = decisionConflict(d, anchored ? [...whole.decisions, ...whole.canaries, ...whole.cosigns] : this.#doorList, this.#recorded, clean.public_key);
    if (conflict) throw new DecisionRefused(conflict);
    const recorded_at = this.now().toISOString();
    const type = decisionEventType(clean.decision.kind);
    const payload = { type, recorded_at, signed: clean };
    const ev = this.append(type, decisionSubject(clean.decision), payload, recorded_at);
    return { seq: ev.seq, entry_hash: ev.entry_hash, recorded_at, decision_id: clean.decision_id, signed: structuredClone(clean) };
  }
  decisions() {
    this.#index();
    const out = [];
    for (const e of this.#doorList) {
      if (!isDecisionKind(e.signed.decision.kind)) continue;
      out.push({ ...e, signed: structuredClone(e.signed) });
    }
    return out;
  }
  /**
   * Verify the book and read it (readDecisionBook). F5b: under the ledger's own anchors, an unchanged book returns its last
   * verified read (its check's `reused` covers every event); otherwise only the events appended since the last verified read
   * are re-hashed. `full: true` forgets what was verified and re-hashes everything. Explicit anchors read afresh (the hash
   * layer still reuses the verified prefix: anchors do not change a hash).
   */
  decisionBook(opts = {}) {
    const explicit = opts.trusted_keys !== void 0 || opts.root_keys !== void 0;
    const trusted_keys = opts.trusted_keys ?? this.trustedKeys;
    const root_keys = opts.root_keys ?? this.rootKeys;
    if (opts.full) {
      forgetPrefix(this.#chain);
      dropBookReaders(this.#chain);
      this.#payloads.forget?.();
      this.#bookCache = void 0;
    }
    const length = this.#chain.length;
    const head = this.chainHead();
    const hit = explicit ? void 0 : this.#bookCache;
    if (hit && hit.length === length && hit.head === head) return structuredClone(hit.book);
    let book;
    try {
      book = readDecisionBook(this.#chain, this.#payloads.own, { ...trusted_keys ? { trusted_keys } : {}, ...root_keys ? { root_keys } : {} });
    } catch (e) {
      if (!(e instanceof LedgerFileChanged)) throw e;
      forgetPrefix(this.#chain);
      this.#bookCache = void 0;
      return { ok: false, check: { ok: false, length, head, brokenAt: e.seq, reason: e.message }, decisions: [], keys: [], canaries: [], cosigns: [], unanchored: [], samples: [], signed_reviews: [] };
    }
    if (book.ok && length > 0) {
      const verified_at = (/* @__PURE__ */ new Date()).toISOString();
      certifyPrefix(this.#chain, { through: length, head, verified_at, events: this.#chain, payloads: this.#payloads.own });
      if (!explicit) this.#bookCache = { length, head, book: structuredClone({ ...book, check: { ...book.check, reused: { through: length, verified_at } } }) };
    }
    return book;
  }
};

// packages/verify/src/ledger/file.ts
function parseChainJSONL(text) {
  const events = [];
  const payloads = [];
  for (const line3 of text.split("\n")) {
    const s = line3.trim();
    if (!s) continue;
    const { payload, ...event } = JSON.parse(s);
    events.push(event);
    payloads.push(payload);
  }
  return { events, payloads };
}
var RELEASE = new FinalizationRegistry((store) => {
  try {
    store.close();
  } catch {
  }
});
var BATCH_CHARS = 1 << 20;

// packages/verify/src/opinion/snapshot.ts
function snapshotFromChainJSONL(text) {
  return parseChainJSONL(text);
}
function defaultOwnsWorkflow(tenant_id) {
  return (workflow_id) => workflow_id.startsWith(`${tenant_id}/`);
}
var reviewerOf = (r) => ({ id: r.reviewer_id, decided_at: r.decided_at, decision: r.decision, ...r.note !== void 0 ? { note: r.note } : {} });
var HELD = /* @__PURE__ */ Symbol("opinion.held-verdict");
function heldVerdict() {
  const h = this[HELD];
  const v = h.payloads[h.at].verdict;
  const atRecord = h.scoped && v.ledger ? { ...v, ledger: { tenant_id: v.ledger.tenant_id, retention_until: v.ledger.retention_until, ...h.carried ? { reviewer: reviewerOf(h.carried) } : {} } } : v;
  return h.reviewed ? { ...atRecord, ledger: { tenant_id: h.reviewed.tenant_id, retention_until: h.reviewed.retention_until, reviewer: reviewerOf(h.reviewed.review) } } : atRecord;
}
function setVerdict(v) {
  Object.defineProperty(this, "verdict", { value: v, writable: true, enumerable: true, configurable: true });
}
function heldFacts(rec) {
  if (Object.getOwnPropertyDescriptor(rec, "verdict")?.get !== heldVerdict) return void 0;
  const h = rec[HELD];
  return recordFactsAt(h.payloads, h.at)?.verdict;
}
function heldRecord(held, rest) {
  const rec = {};
  Object.defineProperty(rec, HELD, { value: held });
  Object.defineProperty(rec, RECORD_FACTS, { value: heldFacts });
  Object.defineProperty(rec, "verdict", { get: heldVerdict, set: setVerdict, enumerable: true, configurable: true });
  return Object.assign(rec, rest);
}
function rebuild(events, payloads, tenant) {
  const lazy = payloadViewOf(payloads) !== void 0;
  const recs = /* @__PURE__ */ new Map();
  const owner = /* @__PURE__ */ new Map();
  const lastRecord = /* @__PURE__ */ new Map();
  const lastReview = /* @__PURE__ */ new Map();
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    const p = recordFactsAt(payloads, i) ?? payloads[i];
    if (!p || typeof p !== "object") continue;
    if (p.type === "RECORD" && p.verdict) {
      const id = p.verdict.verdict_id;
      const t = p.tenant_id ?? "";
      owner.set(id, t);
      if (tenant !== void 0 && t !== tenant) continue;
      const prior = recs.get(id);
      if (lazy) {
        const carried = prior?.review;
        recs.set(id, heldRecord(
          { payloads, at: i, scoped: tenant !== void 0, ...carried ? { carried } : {} },
          { tenant_id: t, recorded_at: p.recorded_at ?? "", retention_until: p.retention_until ?? "", ...carried ? { review: carried } : {} }
        ));
        lastRecord.set(id, ev);
        continue;
      }
      const verdict = tenant !== void 0 && p.verdict.ledger ? { ...p.verdict, ledger: { tenant_id: p.verdict.ledger.tenant_id, retention_until: p.verdict.ledger.retention_until, ...prior?.review ? { reviewer: reviewerOf(prior.review) } : {} } } : p.verdict;
      recs.set(id, {
        verdict,
        tenant_id: t,
        recorded_at: p.recorded_at ?? "",
        retention_until: p.retention_until ?? "",
        ...prior?.review ? { review: prior.review } : {}
      });
      lastRecord.set(id, ev);
    } else if (p.type === "REVIEW" && p.verdict_id && p.review) {
      if (tenant !== void 0 && owner.get(p.verdict_id) !== tenant) continue;
      const rec = recs.get(p.verdict_id);
      if (!rec) continue;
      const held = lazy ? rec[HELD] : void 0;
      if (held) {
        const reviewed = { tenant_id: rec.tenant_id, retention_until: rec.retention_until, review: p.review };
        recs.set(p.verdict_id, heldRecord({ ...held, reviewed }, { tenant_id: rec.tenant_id, recorded_at: rec.recorded_at, retention_until: rec.retention_until, review: p.review }));
        lastReview.set(p.verdict_id, ev);
        continue;
      }
      recs.set(p.verdict_id, {
        ...rec,
        review: p.review,
        verdict: { ...rec.verdict, ledger: { tenant_id: rec.tenant_id, retention_until: rec.retention_until, reviewer: reviewerOf(p.review) } }
      });
      lastReview.set(p.verdict_id, ev);
    }
  }
  return { records: [...recs.values()], lastRecord, lastReview };
}
function openSnapshot(s, opts = {}) {
  const events = s.events ?? [];
  const tenant = opts.scope?.tenant_id;
  const owns = opts.scope ? opts.scope.owns_workflow ?? defaultOwnsWorkflow(opts.scope.tenant_id) : () => true;
  let chain = null;
  let content_verified = false;
  let records;
  let source;
  let decisions = [];
  let lastRecord = /* @__PURE__ */ new Map();
  let lastReview = /* @__PURE__ */ new Map();
  if (s.events && s.payloads && s.payloads.length === events.length) {
    const book = readDecisionBook(events, s.payloads, { ...opts.trusted_keys ? { trusted_keys: opts.trusted_keys } : {}, ...opts.root_keys?.length ? { root_keys: opts.root_keys } : {} });
    chain = book.check;
    content_verified = book.ok;
    const r = rebuild(events, s.payloads, tenant);
    records = r.records;
    lastRecord = r.lastRecord;
    lastReview = r.lastReview;
    source = "chain";
    decisions = book.decisions.filter((e) => e.signed.decision.kind === "POLICY_REVISION" || owns(e.signed.decision.workflow_id));
  } else {
    if (s.events) chain = verifyChain(events);
    records = (s.records ?? []).filter((r) => tenant === void 0 || r.tenant_id === tenant);
    source = "records";
    const ids = new Set(records.map((r) => r.verdict.verdict_id));
    for (const ev of events) {
      if (!ids.has(ev.verdict_id)) continue;
      if (ev.type === "RECORD") lastRecord.set(ev.verdict_id, ev);
      else if (ev.type === "REVIEW") lastReview.set(ev.verdict_id, ev);
    }
  }
  const unanchored = [...new Set(decisions.filter((e) => !isAnchored(e)).map((e) => e.signed.decision.signer_id))].sort();
  const eventsFor = (id) => {
    const record = lastRecord.get(id), review = lastReview.get(id);
    return { ...record ? { record } : {}, ...review ? { review } : {} };
  };
  const refOf = (id) => {
    const { record, review } = eventsFor(id);
    return {
      kind: "verdict",
      verdict_id: id,
      ...record ? { record_event: { seq: record.seq, entry_hash: record.entry_hash } } : {},
      ...review ? { review_event: { seq: review.seq, entry_hash: review.entry_hash } } : {}
    };
  };
  return {
    records,
    source,
    chain,
    content_verified,
    decisions,
    unanchored,
    ...tenant !== void 0 ? { scope: { tenant_id: tenant } } : {},
    ownsWorkflow: owns,
    eventsFor,
    refOf
  };
}

// packages/verify/src/opinion/types.ts
var OPINION_VERSION = "opinion-v0";
var OPINION_GENERATOR = "riposte-opinion";
var OPINION_GENERATOR_VERSION = "0.1.0";

// packages/verify/src/opinion/common.ts
var short = (h, n = 12) => h.length > n ? `${h.slice(0, n)}\u2026` : h;
function evidenceSet(label, ids) {
  const sorted = [...new Set(ids)].sort();
  return { kind: "evidence_set", label, count: sorted.length, hash: hashOf(sorted), verdict_ids: sorted };
}
function decisionRef(kind, d) {
  return { kind: "decision", decision_kind: kind, decision_id: d.decision_id, seq: d.seq, entry_hash: d.entry_hash };
}
function chainPremise(id, view) {
  const check2 = "readDecisionBook (ledger/decisions): every link and payload re-hashed, every event header held to its payload, every signed decision re-verified";
  const c = view.chain;
  const scoped = view.scope ? ` This opinion reads only tenant \`${view.scope.tenant_id}\`'s records and decisions; the chain is verified whole because its hashes cover every tenant.` : "";
  if (view.content_verified && c) {
    return {
      id,
      check: check2,
      verified: true,
      statement: `The book of record is intact: ${c.length} event(s), every payload re-hashed, every event header held to its payload, every signed decision re-verified; head \`${c.head}\`.${scoped}`,
      refs: [{ kind: "ledger_head", head: c.head, length: c.length }],
      detail: `content verified; every record cited here was rebuilt from this chain${view.scope ? ` (tenant ${view.scope.tenant_id} only)` : ""}`
    };
  }
  if (c && !c.ok) {
    return {
      id,
      check: check2,
      verified: false,
      statement: `The book of record FAILED its integrity check at event ${c.brokenAt}: ${c.reason}.`,
      refs: [{ kind: "ledger_head", head: c.head, length: c.length }],
      detail: `chain broken at event ${c.brokenAt}`
    };
  }
  if (c) {
    return {
      id,
      check: check2,
      verified: false,
      statement: "The chain links are intact, but the payloads were not supplied, so the verdict bodies were not re-hashed.",
      refs: [{ kind: "ledger_head", head: c.head, length: c.length }],
      detail: "structural check only; supply the chain export (events with payloads)"
    };
  }
  return {
    id,
    check: check2,
    verified: false,
    statement: "No chain was supplied: the records cannot be shown to be the ledger's.",
    refs: [],
    detail: "no chain; supply the chain export (ledger.chainJSONL())"
  };
}
function replayPremise(id, label, ids, byId2, opts = {}) {
  const failures = [];
  for (const vid of ids) {
    const v = byId2.get(vid);
    if (!v) {
      failures.push(`${short(vid)}: not on the record`);
      continue;
    }
    const problem = proofProblem(v, opts);
    if (problem) failures.push(`${short(vid)}: ${problem}`);
  }
  const n = new Set(ids).size;
  const what = opts.allowReasoned ? "its id re-derives from input_hash + ruleset@version + engine, it is evidenced, and it is not generated (its judgement-tier findings are advisories, not VERDICT)" : "its id re-derives from input_hash + ruleset@version + engine, it is evidenced, and it is VERDICT-channel (not generated)";
  return {
    id,
    statement: n === 0 ? `No verdict is cited as ${label}.` : n === 1 ? `The ${label} verdict replays: ${what}.` : `Each of the ${n} ${label} verdicts replays: ${what}.`,
    check: opts.allowReasoned ? "proofProblem (verdict/channel) \u2192 deriveVerdictId (protocol/replay)" : "assertVerdict (verdict/channel) \u2192 deriveVerdictId (protocol/replay)",
    refs: n === 0 ? [] : [evidenceSet(label, ids)],
    verified: failures.length === 0,
    detail: failures.length === 0 ? `${n} verdict(s) checked` : `${failures.length} failed: ${failures.slice(0, 5).join("; ")}${failures.length > 5 ? "; \u2026" : ""}`
  };
}
function sourceHashOf(view) {
  if (view.chain) return view.chain.head;
  return hashOf(view.records.map((r) => [r.verdict.verdict_id, r.review?.decision ?? null]).sort());
}
function finalizeOpinion(p, source_hash) {
  const failed = p.premises.filter((x) => !x.verified);
  const verified = failed.length === 0;
  const ruling = verified ? p.ruling : {
    disposition: "WITHHELD",
    favors: null,
    statement: `No ruling is proposed: ${failed.length} premise(s) could not be verified by Riposte's own checks (${failed.map((x) => `${x.id}: ${x.detail}`).join("; ")}). An opinion whose premises do not verify proposes nothing.`,
    scope: p.ruling.scope,
    status: "PROPOSED",
    takes_effect: "nothing changes"
  };
  const body = {
    opinion_version: OPINION_VERSION,
    channel: "COUNSEL",
    provenance: { type: "GENERATED", generator: OPINION_GENERATOR, generator_version: OPINION_GENERATOR_VERSION, source_hash },
    dismissible: true,
    subject: p.subject,
    title: p.title,
    question: p.question,
    readings: p.readings,
    authorities: p.authorities,
    precedent: p.precedent,
    ruling,
    dissent: p.dissent,
    overturn: p.overturn,
    premises: p.premises,
    judges: p.premises.map((x) => ({ judge: `${x.id} \xB7 ${x.check}`, passed: x.verified, detail: x.detail })),
    verified
  };
  const opinion_id = hashOf(body).slice(0, 32);
  const { opinion_version, channel, provenance, dismissible, ...rest } = body;
  return { opinion_version, channel, provenance, dismissible, opinion_id, ...rest };
}

// packages/verify/src/opinion/promotion.ts
var RUNG_CHECK = "readDecisionBook + grantInForce (ledger/decisions): the latest anchored, fully signed GRANT for the workflow on the verified book, its Ed25519 signature(s) re-verified";
function readRung(view, input, wf, asked, cal, policy, pref) {
  const { events, payloads } = input.snapshot;
  const onBook = view.content_verified && view.source === "chain" && !!events && !!payloads;
  const onBookForWf = onBook ? view.decisions.filter((e) => e.signed.decision.kind !== "POLICY_REVISION" && e.signed.decision.workflow_id === wf) : [];
  const reading = { policies: [policy], governing_policy: policy };
  const forWf = onBookForWf.filter(isAnchored);
  const inert = onBook ? noEffect({ decisions: view.decisions, canaries: [] }, { workflow_id: wf, ...reading }) : [];
  const inertText = inert.length ? ` ${inert.map((n) => n.notice).join("; ")}.` : "";
  const anchoredWord = inert.some((n) => n.pending) ? "in-force " : inert.length ? "anchored " : "";
  const headRef = view.chain ? [{ kind: "ledger_head", head: view.chain.head, length: view.chain.length }] : [];
  if (!onBook || forWf.length === 0 && asked) {
    let decl2;
    if (asked) decl2 = asked;
    else {
      if (input.consequence_tier === void 0) {
        throw new Error(`the rung of ${wf} is to be read from the book of record, but ${view.source === "chain" ? "the book does not verify" : "no chain was supplied"} and no consequence_tier was declared: nothing can be assessed`);
      }
      decl2 = { workflow_id: wf, consequence_tier: input.consequence_tier, granted: "record" };
    }
    const a2 = assessVoice(cal, decl2, policy);
    const supplied = decl2.grant ? ` A grant record (${decl2.grant.signer_id}, ${decl2.grant.signed_at}) was supplied with it, not read from a signed decision on the book.` : "";
    return {
      decl: decl2,
      a: a2,
      source: "DECLARED",
      premise: !asked ? {
        statement: `The rung of \`${wf}\` could not be read from the book of record: ${view.source === "chain" ? "the book does not verify" : "no chain was supplied"}.`,
        check: RUNG_CHECK,
        refs: headRef,
        verified: false,
        detail: "no verified book to read the rung from"
      } : {
        statement: `No ${anchoredWord}signed GRANT or DECLINE for \`${wf}\` is on the book of record: the rung \`${decl2.granted}\` is the caller's declaration, not read from a person's signed decision.${decl2.granted !== "record" ? ` Signed onto the book as a GRANT, it becomes the book's.` : ""}${supplied}${inertText}`,
        check: RUNG_CHECK,
        refs: headRef,
        verified: view.content_verified,
        detail: view.content_verified ? "declared, not signed: the absence of a GRANT read from the verified book" : "the book did not verify: the rung's source cannot be read"
      }
    };
  }
  const g = grantInForce(view.decisions, wf, reading);
  const gd = g?.signed.decision;
  const tier = gd ? gd.consequence_tier : asked?.consequence_tier ?? input.consequence_tier;
  if (tier === void 0) {
    throw new Error(`no ${anchoredWord}GRANT for workflow ${wf} is on the book, and no consequence_tier was declared: nothing is granted (the rung is record), but the burden of proof needs a declared tier to measure against.${inertText}`);
  }
  const mismatches = [];
  let decl;
  let a;
  if (gd && gd.policy.hash !== pref.hash) {
    mismatches.push(`the grant was made under policy ${gd.policy.policy_id}@${gd.policy.version} (\`${short(gd.policy.hash)}\`), not ${pref.policy_id}@${pref.version} (\`${short(pref.hash)}\`): settings are fixed at grant time`);
    decl = { workflow_id: wf, consequence_tier: tier, granted: gd.level, ...gd.bounds !== void 0 ? { bounds: gd.bounds } : {} };
    a = assessVoice(cal, decl, policy);
  } else {
    a = assessVoice(cal, {
      workflow_id: wf,
      book: { events, payloads },
      ...gd ? {} : { consequence_tier: tier },
      ...input.trusted_keys ? { trusted_keys: input.trusted_keys } : {},
      ...input.root_keys?.length ? { root_keys: input.root_keys } : {}
    }, policy);
    decl = {
      workflow_id: wf,
      consequence_tier: a.consequence_tier,
      granted: a.granted,
      ...a.bounds !== void 0 ? { bounds: a.bounds } : {},
      ...a.grant ? { grant: a.grant } : {}
    };
  }
  if (asked) {
    const says = input.proposal ? "the proposal runs from" : "the declaration says";
    if (asked.granted !== decl.granted) mismatches.push(`${says} \`${asked.granted}\`, but the book says \`${decl.granted}\``);
    if (asked.consequence_tier !== decl.consequence_tier) mismatches.push(`${input.proposal ? "the proposal is at" : "the declaration says"} tier '${asked.consequence_tier}', but the book says '${decl.consequence_tier}'`);
    if ((asked.bounds ?? null) !== (decl.bounds ?? null)) mismatches.push(`bounds ${JSON.stringify(asked.bounds ?? null)}, but the book says ${JSON.stringify(decl.bounds ?? null)}`);
    if (asked.grant && (!gd || asked.grant.signer_id !== gd.signer_id || asked.grant.signed_at !== gd.signed_at || asked.grant.level !== gd.level)) {
      mismatches.push(`a grant record (${asked.grant.signer_id}, ${asked.grant.signed_at}) that the book does not hold`);
    }
  }
  const later = a.book?.superseded_by?.length ? ` A later version of this policy is on the book (${a.book.superseded_by.map((s) => `${s.policy.policy_id}@${s.policy.version}`).join(", ")}); the grant stands under its own version until a person re-grants.` : "";
  const cosigned = a.book?.grant?.cosigned_by?.length ? ` and co-signed by ${a.book.grant.cosigned_by.map((c) => `${c.signer_id} (seq ${c.seq})`).join(", ")} (dual authorization)` : "";
  const read = g && gd ? `The rung is read from the book of record: GRANT \`${g.decision_id}\` (seq ${g.seq}) sets \`${wf}\` at \`${gd.level}\`${gd.bounds !== void 0 ? ` within "${gd.bounds}"` : ""}, signed by ${gd.signer_id} at ${gd.signed_at}${cosigned}, under policy ${gd.policy.policy_id}@${gd.policy.version} at tier '${gd.consequence_tier}'. A ruling here would amend that grant, and only a person's new signed GRANT does.${later}${inertText}` : `No ${anchoredWord}GRANT for \`${wf}\` is on the book of record: nothing is granted, so the rung is \`record\` (the day-1 default), measured against tier '${tier}'.${inertText}`;
  return {
    decl,
    a,
    source: "BOOK",
    ...g ? { grant: g } : {},
    premise: {
      statement: mismatches.length ? `The book of record governs the rung, and this opinion was asked under other settings: ${mismatches.join("; ")}. A flag never overrides a person's signed grant. ${read}` : read,
      check: RUNG_CHECK,
      refs: g ? [decisionRef("GRANT", g)] : headRef,
      verified: mismatches.length === 0,
      detail: mismatches.length ? mismatches.join("; ") : g ? `GRANT \`${short(g.decision_id)}\` read from the verified book` : "no GRANT on the verified book: the rung is record"
    }
  };
}
var METRIC_LABEL = { false_flag_rate: "false-flag rate", false_pass_rate: "false-PASS rate" };
var NOUN = { false_flag_rate: "reviewed FAIL verdicts", false_pass_rate: "reviewed PASS verdicts" };
var per = (x, base) => `${Number((x * base).toPrecision(3))}`;
function behaviour(level, bounds) {
  switch (level) {
    case "record":
      return "logs every verdict and surfaces each FAIL or ABSTAIN as a notice with its evidence and a dispute path; nothing is held";
    case "advise":
      return "surfaces each FAIL or ABSTAIN, and COUNSEL (strong advisories included), prominently in-flow to the person and the agent; nothing is held";
    case "gate":
      return "holds each FAIL or ABSTAIN action until a person resolves it; PASSes still get human review";
    case "autonomy":
      return `lets PASSes proceed unreviewed${bounds ? ` within "${bounds}"` : " within the declared bounds"}; each FAIL or ABSTAIN is still held until a person resolves it`;
  }
}
var below = (r) => VOICE_LADDER[Math.max(0, levelRank(r) - 1)];
function riskOf(r, cal) {
  const obs = r.point === null ? "no observed rate yet" : `${r.errors}/${r.n}`;
  if (r.metric === "false_pass_rate") {
    const passShare = cal.records === 0 ? "0" : pct2(cal.by_outcome.PASS / cal.records);
    return `At the observed rate (${obs}) about ${per(r.point ?? 0, 1e3)} of every 1,000 PASSes would be wrong and unreviewed; the data cannot rule out ${per(r.upper, 1e3)} (the upper bound). Review is removed from the PASS share of volume: ${cal.by_outcome.PASS} of ${cal.records} verdict(s) on record (${passShare}).`;
  }
  return `At the observed false-flag rate (${obs}) about ${per(r.point ?? 0, 100)} of every 100 flags are false alarms${r.rung === "gate" ? " that hold legitimate work" : ""}; the data cannot rule out ${per(r.upper, 100)}.`;
}
function tierAt(policy, name) {
  const index2 = policy.tiers.findIndex((t) => t.tier === name);
  return { tier: policy.tiers[index2], index: index2 };
}
function promotionOpinion(input) {
  const { policy, proposal } = input;
  const lint = lintPolicy(policy);
  if (!lint.ok) throw new Error(`invalid promotion policy: ${lint.errors.join("; ")}`);
  const asked = input.declaration ?? (proposal ? { workflow_id: proposal.workflow_id, consequence_tier: proposal.consequence_tier, granted: proposal.from, ...proposal.bounds !== void 0 ? { bounds: proposal.bounds } : {} } : void 0);
  const wf = asked?.workflow_id ?? input.workflow_id;
  if (!wf) throw new Error("promotionOpinion needs a proposal, a declaration, or a workflow_id (the rung read from the book of record)");
  if (asked && input.workflow_id !== void 0 && input.workflow_id !== asked.workflow_id) {
    throw new Error(`workflow_id ${input.workflow_id} disagrees with the ${proposal && !input.declaration ? "proposal" : "declaration"} (${asked.workflow_id}): one question per opinion`);
  }
  const view = openSnapshot(input.snapshot, {
    ...input.scope ? { scope: input.scope } : {},
    ...input.trusted_keys ? { trusted_keys: input.trusted_keys } : {},
    ...input.root_keys?.length ? { root_keys: input.root_keys } : {}
  });
  if (!view.ownsWorkflow(wf)) {
    throw new Error(`workflow ${wf} is not tenant ${view.scope?.tenant_id}'s: an opinion scoped to a tenant reads only that tenant's workflows`);
  }
  const cal = workflowCalibration(view.records, wf, input.calibration ?? {});
  const pref = policyRef(policy);
  const rung = readRung(view, input, wf, asked, cal, policy, pref);
  const { decl, a } = rung;
  const { tier, index: tierIndex } = tierAt(policy, decl.consequence_tier);
  const idOf = (r) => (recordFacts(r) ?? r.verdict).verdict_id;
  const recordById = new Map(view.records.map((r) => [idOf(r), r]));
  const firstById = /* @__PURE__ */ new Map();
  for (const r of view.records) {
    const id = idOf(r);
    if (!firstById.has(id)) firstById.set(id, r);
  }
  const verdictsOf = (ids) => new Map(ids.flatMap((id) => {
    const r = recordById.get(id);
    return r ? [[id, r.verdict]] : [];
  }));
  const standing = a.book?.declined;
  const lapsed = a.book?.decline_lapsed;
  const unevidenced = a.proposal?.kind === "DEMOTION_PROPOSAL" && a.proposal.basis === "unevidenced";
  const failureDemotion = a.proposal?.kind === "DEMOTION_PROPOSAL" && a.proposal.basis === "failure" || standing?.proposal_kind === "DEMOTION_PROPOSAL";
  const demotionReasons = a.proposal?.kind === "DEMOTION_PROPOSAL" ? a.proposal.reasons : void 0;
  const question_kind = levelRank(a.earned) < levelRank(decl.granted) || failureDemotion ? "DEMOTE" : decl.granted === "autonomy" ? "RETAIN" : "PROMOTE";
  const surveilled = question_kind === "DEMOTE" && levelRank(a.earned) >= levelRank(decl.granted);
  const toLevel = question_kind === "PROMOTE" ? VOICE_LADDER[levelRank(decl.granted) + 1] : question_kind === "DEMOTE" ? below(decl.granted) : decl.granted;
  const focus = question_kind === "PROMOTE" ? VOICE_LADDER[levelRank(decl.granted) + 1] : decl.granted;
  const deps2 = a.rungs.filter((r) => levelRank(r.rung) <= levelRank(focus));
  const focusRung = deps2[deps2.length - 1];
  const bind = deps2.find((r) => !r.cleared) ?? focusRung;
  const inBounds = decl.bounds ? ` within "${decl.bounds}"` : "";
  const byWhom = standing ? `${standing.signer_id}, ${standing.signed_at}` : "";
  const title = standing ? question_kind === "DEMOTE" ? `Kept at ${decl.granted} by a person: \`${wf}\` (the step down to ${toLevel} was declined)` : `Not now, by a person: promote \`${wf}\` from ${decl.granted} to ${focus}` : question_kind === "PROMOTE" ? `Promote \`${wf}\` from ${decl.granted} to ${focus}?` : question_kind === "RETAIN" ? `Retain autonomy for \`${wf}\`?` : unevidenced ? `Granted above the evidence: should \`${wf}\` step down from ${decl.granted} to ${toLevel}?` : `URGENT: step \`${wf}\` down from ${decl.granted} to ${toLevel}?`;
  const question = question_kind === "PROMOTE" ? `Should workflow \`${wf}\` (consequence tier '${tier.tier}') be promoted from \`${decl.granted}\` to \`${focus}\`${inBounds}?${standing ? ` A person has already declined this promotion (${byWhom}); does that decline still stand?` : ""}` : question_kind === "RETAIN" ? `Does the record of workflow \`${wf}\` (tier '${tier.tier}') still support \`autonomy\`${inBounds}?` : standing ? `The record of workflow \`${wf}\` (tier '${tier.tier}') no longer supports \`${decl.granted}\`, which a person granted, and a person has already declined stepping it down to \`${toLevel}\` (${byWhom}). Does that decline still stand?` : unevidenced ? `A person granted workflow \`${wf}\` (tier '${tier.tier}') \`${decl.granted}\`, and the record does not yet support it; nothing has gone wrong (no failing case). Should it step down to \`${toLevel}\`, or should the record be left to catch up? Until a person decides, it stays at \`${decl.granted}\`.` : surveilled ? `A failing case has turned up since a person granted workflow \`${wf}\` (tier '${tier.tier}') \`${decl.granted}\`, though the pooled record still clears its bars. Should it step down to \`${toLevel}\`? Until a person decides, it stays at \`${decl.granted}\`.` : `The record of workflow \`${wf}\` (tier '${tier.tier}') no longer supports \`${decl.granted}\`, which a person granted. Should it step down to \`${toLevel}\`? Until a person decides, it stays at \`${decl.granted}\`.`;
  const premises = [];
  premises.push(chainPremise("P1", view));
  const evidenceIds = [...cal.evidence.reviewed_pass, ...cal.evidence.reviewed_fail];
  premises.push(replayPremise("P2", "reviewed evidence", evidenceIds, verdictsOf(evidenceIds)));
  const calRefs = [
    { kind: "calibration", workflow_id: wf, hash: cal.calibration_hash },
    ...cal.evidence.reviewed_pass.length ? [evidenceSet("reviewed PASS", cal.evidence.reviewed_pass)] : [],
    ...cal.evidence.reviewed_fail.length ? [evidenceSet("reviewed FAIL", cal.evidence.reviewed_fail)] : []
  ];
  const calMatches = !proposal || proposal.calibration_hash === cal.calibration_hash;
  premises.push({
    id: "P3",
    statement: `Recounted from the ledger, workflow \`${wf}\` holds ${cal.records} verdict(s) (${cal.by_outcome.PASS} PASS \xB7 ${cal.by_outcome.FAIL} FAIL \xB7 ${cal.by_outcome.INSUFFICIENT_DATA} can't-tell); reviewed: ${cal.reviewed.PASS} PASS (${cal.overturned.PASS} overturned), ${cal.reviewed.FAIL} FAIL (${cal.overturned.FAIL} overturned). Versions: ${cal.versions.join("; ") || "none yet"}.${cal.excluded.length ? ` ${cal.excluded.length} record(s) excluded (${[...new Set(cal.excluded.map((e) => e.why))].join("; ")}).` : ""}`,
    check: "workflowCalibration (verdict/voice) over the records rebuilt from the chain",
    refs: calRefs,
    verified: calMatches,
    detail: calMatches ? `calibration \`${short(cal.calibration_hash)}\`${proposal ? " matches the proposal" : ""}` : `the proposal cites calibration ${short(proposal.calibration_hash)} but the ledger recounts to ${short(cal.calibration_hash)}`
  });
  const counterIds = [...new Set(deps2.flatMap((r) => r.counter_cases))].sort();
  const counterBad = counterIds.filter((id) => {
    const rec = firstById.get(id);
    return !(view.source === "chain" && view.eventsFor(id).review && rec?.review?.decision === "OVERTURNED");
  });
  premises.push({
    id: "P4",
    statement: counterIds.length ? `Each of the ${counterIds.length} counter-case(s) is on the ledger with a person's OVERTURNED review event.` : `No counter-case is on record: no ${deps2.map((r) => r.metric === "false_pass_rate" ? "PASS" : "FAIL").filter((x, i, s) => s.indexOf(x) === i).join(" or ")} verdict in the evidence was overturned. An absence is only as good as the ledger it is read from.`,
    check: "the ledger's REVIEW events (openSnapshot.eventsFor)",
    refs: counterIds.length ? counterIds.map((id) => view.refOf(id)) : view.chain ? [{ kind: "ledger_head", head: view.chain.head, length: view.chain.length }] : [],
    verified: counterIds.length ? counterBad.length === 0 : view.content_verified,
    detail: counterIds.length ? counterBad.length === 0 ? `${counterIds.length} review event(s) found` : `${counterBad.length} counter-case(s) lack a verifiable OVERTURNED review event: ${counterBad.map((x) => short(x)).join(", ")}` : view.content_verified ? "absence read from a content-verified chain" : "absence read from an unverified record set"
  });
  const policyMatches = !proposal || proposal.policy.hash === pref.hash;
  premises.push({
    id: "P5",
    statement: `The policy is \`${pref.policy_id}@${pref.version}\` (method ${policy.method}); it lints clean, including the rule that the burden of proof never decreases as consequence rises. The workflow is declared tier '${tier.tier}'.`,
    check: "lintPolicy + hashOf (verdict/voice)",
    refs: [{ kind: "policy", ...pref }],
    verified: policyMatches,
    detail: policyMatches ? `policy \`${short(pref.hash)}\`${proposal ? " matches the proposal" : ""}` : `the proposal cites policy ${short(proposal.policy.hash)} but the declared policy hashes to ${short(pref.hash)}`
  });
  const boundLines = [];
  let boundsOk = true;
  for (const r of deps2) {
    const again = rateInterval(r.errors, r.n, r.confidence, r.method, r.sidedness);
    if (again.upper !== r.upper || again.lower !== r.lower) boundsOk = false;
    boundLines.push(`${r.rung}: ${r.errors}/${r.n} \u2192 ${pct2(r.confidence)} ${r.sidedness} ${r.method} bounds [${pct2(r.lower)}, ${pct2(r.upper)}], upper against bar ${pct2(r.bar.max_error)} with n \u2265 ${r.bar.min_n}: ${r.cleared ? "clears" : "does not clear"}`);
  }
  if (proposal) {
    const top = Math.max(levelRank(proposal.from), levelRank(proposal.to));
    const mine2 = a.rungs.filter((r) => levelRank(r.rung) <= top);
    if (hashOf(mine2) !== hashOf(proposal.rungs)) boundsOk = false;
  }
  premises.push({
    id: "P6",
    statement: `The bounds recompute. ${boundLines.join("; ")}.`,
    check: "rateInterval (verdict/bounds), recomputed independently of the assessment",
    refs: [{ kind: "calibration", workflow_id: wf, hash: cal.calibration_hash }, { kind: "policy", ...pref }],
    verified: boundsOk,
    detail: boundsOk ? `${deps2.length} rung(s) recomputed` : "a recomputed bound differs from the one presented (the proposal was altered, or computed on other evidence)"
  });
  const proposalIntact = !proposal || (() => {
    const { proposal_id, ...body } = proposal;
    return hashOf(body).slice(0, 32) === proposal_id;
  })();
  const raised = a.proposal?.proposal_id ?? standing?.suppressed_proposal_id;
  const proposalMatches = proposalIntact && (!proposal || raised === proposal.proposal_id);
  const producedText = a.proposal ? ` The evidence produces ${a.proposal.kind === "DEMOTION_PROPOSAL" ? unevidenced ? "a standing (unevidenced, not urgent) demotion" : "an URGENT demotion" : "a promotion"} proposal \`${a.proposal.proposal_id}\` (${a.proposal.from} \u2192 ${a.proposal.to}).` : standing ? ` The evidence raises ${standing.proposal_kind === "DEMOTION_PROPOSAL" ? "a demotion" : "a promotion"} proposal \`${standing.suppressed_proposal_id}\`, which a person's standing decline holds back (P9).` : " The evidence produces no proposal.";
  const fw = a.fresh_window;
  const windowText = fw ? ` A person stepped \`${wf}\` down from \`${fw.from}\` after a failing case (GRANT \`${short(fw.since.decision_id)}\`, seq ${fw.since.seq}), so a return is argued from the ${fw.records} verdict(s) recorded since, alone${fw.rung ? `: ${fw.rung.rung} on that window: ${fw.rung.reason}` : ""}. The pooled record is shown; it cannot carry the return by itself.` : "";
  premises.push({
    id: "P7",
    statement: `The effective rung is \`${a.level}\`, a person's decision, which the assessment never changes; on this evidence the ladder supports \`${a.earned}\`.${a.blockers.length ? ` Blocked: ${a.blockers.join("; ")}.` : ""}${producedText}${windowText}`,
    check: "assessVoice (verdict/voice): cumulative support, one rung at a time either way, the rung itself never changed",
    refs: [{ kind: "calibration", workflow_id: wf, hash: cal.calibration_hash }, { kind: "policy", ...pref }],
    verified: proposalMatches,
    detail: proposalMatches ? proposal ? `proposal \`${short(proposal.proposal_id)}\` re-derived exactly` : "assessment recomputed" : !proposalIntact ? `the proposal \`${short(proposal.proposal_id)}\` does not match its own id (edited after it was minted)` : `the proposal \`${short(proposal.proposal_id)}\` is not what this evidence produces (${raised ? `it produces \`${short(raised)}\`` : "it produces no proposal"})`
  });
  premises.push({ id: "P8", ...rung.premise });
  const declineCite = standing ?? lapsed;
  if (declineCite) {
    const what = declineCite.proposal_kind === "DEMOTION_PROPOSAL" ? "demotion" : "promotion";
    premises.push({
      id: "P9",
      statement: standing ? `A person has already answered this proposal: DECLINE \`${standing.decision_id}\` (seq ${standing.seq}) by ${standing.signer_id} at ${standing.signed_at}: "${standing.reason}". It stands until ${standing.re_raise_when} (so far: ${standing.why}), so the ${what} is shown as declined, not asked again.` : `A person declined an earlier ${what} (DECLINE \`${declineCite.decision_id}\`, seq ${declineCite.seq}, by ${declineCite.signer_id} at ${declineCite.signed_at}: "${declineCite.reason}"). It no longer stands: ${declineCite.why}. The proposal is raised again.`,
      check: "declinesFor (ledger/decisions) + declineStanding (verdict/voice): a signed decline binds to the grant in force and stands until the evidence it saw changes",
      refs: [decisionRef("DECLINE", declineCite)],
      verified: true,
      detail: standing ? `decline \`${short(standing.decision_id)}\` stands` : `decline \`${short(declineCite.decision_id)}\` lapsed on new evidence`
    });
  }
  const cells = (r) => [
    { cell: `${r.rung}: ${NOUN[r.metric]} (n)`, value: r.n, premise: "P3" },
    { cell: `${r.rung}: overturned (counter-cases)`, value: r.errors, premise: "P4" },
    { cell: `${r.rung}: observed ${METRIC_LABEL[r.metric]}`, value: r.point, premise: "P3" },
    { cell: `${r.rung}: ${pct2(r.confidence)} ${r.method} upper bound`, value: r.upper, premise: "P6" },
    { cell: `${r.rung}: bar (max upper bound)`, value: r.bar.max_error, premise: "P5" },
    { cell: `${r.rung}: minimum n`, value: r.bar.min_n, premise: "P5" }
  ];
  const allCells = deps2.flatMap(cells);
  const upLevel = question_kind === "DEMOTE" ? decl.granted : focus;
  const downLevel = question_kind === "PROMOTE" ? decl.granted : below(decl.granted);
  const readings = [
    {
      id: "A",
      label: question_kind === "PROMOTE" ? `Promote to ${focus}` : `Keep ${upLevel}`,
      statement: question_kind === "DEMOTE" ? `A person keeps \`${upLevel}\`: they may dispute the failing cases (each is listed under Precedent with its dispute path), or accept the exposure knowingly. ${surveilled ? `The pooled record still clears its bars, but a failing case since the grant counts against it${demotionReasons ? ` (${demotionReasons.join("; ")})` : ""}.` : `As it stands the record does not support it (${bind.rung}: ${bind.reason}).`}` : `The record shows the ${deps2.map((r) => METRIC_LABEL[r.metric]).filter((x, i, s) => s.indexOf(x) === i).join(" and ")} low enough, on enough reviews, for the workflow to hold \`${upLevel}\`: it ${behaviour(upLevel, decl.bounds)}.`,
      cells: allCells,
      consequence: `The workflow ${behaviour(upLevel, decl.bounds)}. ${riskOf(focusRung, cal)}`
    },
    {
      id: "B",
      label: question_kind === "PROMOTE" ? `Stay at ${decl.granted}` : `Step down to ${downLevel}`,
      statement: surveilled ? `The pooled record clears every declared bar, but a failing case since the grant counts against \`${upLevel}\`${demotionReasons ? ` (${demotionReasons.join("; ")})` : ""}; the workflow should hold \`${downLevel}\` until a person has weighed it.` : bind.cleared ? `Though the record clears every declared bar, it is not enough to justify \`${upLevel}\`: a person may want more evidence than the policy asks for at this tier. The workflow should hold \`${downLevel}\`.` : `The record does not justify \`${upLevel}\` (${bind.rung}: ${bind.reason}); the workflow should hold \`${downLevel}\`.`,
      cells: [...allCells, { cell: "binding constraint", value: bind.cleared ? "none: every bar clears" : `${bind.rung}: ${bind.reason}`, premise: "P6" }],
      consequence: question_kind === "PROMOTE" ? `The workflow keeps its current behaviour: it ${behaviour(downLevel, decl.bounds)}. No new exposure; no review work is removed.` : `The workflow ${behaviour(downLevel, decl.bounds)}. The exposure measured above ends; the review work it had removed returns.`
    }
  ];
  const authorities = [
    { source: "promotion policy", cite: `${pref.policy_id}@${pref.version} \xB7 tier ${tier.tier}`, quote: `tier '${tier.tier}': ${tier.description}` },
    ...deps2.map((r) => ({
      source: "promotion policy",
      cite: `${pref.policy_id}@${pref.version} \xB7 tier ${tier.tier} \xB7 ${r.rung}`,
      quote: `${r.rung}: n \u2265 ${r.bar.min_n} ${NOUN[r.metric]}, and the ${pct2(r.confidence)} ${r.sidedness} ${r.method} upper bound on the ${METRIC_LABEL[r.metric]} \u2264 ${pct2(r.bar.max_error)}.`
    })),
    { source: "Riposte earned-voice doctrine", cite: "VERDICT-SCHEMA v0.1 \xA7earned voice", quote: "Riposte proposes; a person decides. The rung changes only by a person's decision, one rung at a time, in either direction." },
    { source: "Riposte earned-voice doctrine", cite: "VERDICT-SCHEMA v0.1 \xA7earned voice (stable settings)", quote: "The settings a workflow was granted under are fixed. The policy is versioned, nothing tunes it, and a change is a person's recorded revision." },
    { source: "Riposte earned-voice doctrine", cite: "VERDICT-SCHEMA v0.1 \xA7per-action handling", quote: "Every FAIL is shown to the person with its evidence and a dispute path, at every rung. Whether it also holds the action is the rung's: surfaced at record and advise, held at gate and autonomy." },
    { source: "Riposte earned-voice doctrine", cite: "VERDICT-SCHEMA v0.1 \xA7earned voice (the declared_accuracy precedent)", quote: "A ruleset or engine version change changes behaviour; the old record no longer describes it. Each version earns its own record." }
  ];
  const entries = counterIds.map((id) => {
    const rec = firstById.get(id);
    return {
      verdict_id: id,
      outcome: (recordFacts(rec) ?? rec.verdict).outcome,
      decision: rec.review?.decision ?? "OVERTURNED",
      ...rec.review ? { reviewer_id: rec.review.reviewer_id, decided_at: rec.review.decided_at } : {},
      ...rec.review?.note !== void 0 ? { note: rec.review.note } : {},
      ref: view.refOf(id),
      dispute: disputeCommand(id)
    };
  });
  const overturnedRules = cal.rules.filter((r) => r.overturned > 0).map((r) => `\`${r.rule_id}\` ${r.overturned}/${r.reviewed}`);
  const precedent = {
    summary: `${cal.reviewed.PASS + cal.reviewed.FAIL + cal.reviewed.INSUFFICIENT_DATA} human review(s) on record in this workflow: ${cal.reviewed.PASS} of PASS verdicts (${cal.overturned.PASS} overturned), ${cal.reviewed.FAIL} of FAIL verdicts (${cal.overturned.FAIL} overturned). ${counterIds.length ? `The adverse precedent (every overturned verdict the ${focus} question turns on) is listed, each with its own dispute path.` : "No adverse precedent: no overturned verdict bears on this question."}${overturnedRules.length ? ` Rules reviewers overturned: ${overturnedRules.join(", ")}.` : ""}`,
    entries
  };
  const scope = `Workflow \`${wf}\` only (${cal.versions.join("; ") || "no verdicts yet"}), consequence tier '${tier.tier}', policy ${pref.policy_id}@${pref.version}${decl.bounds ? `, within "${decl.bounds}"` : ""}. It does not extend to other workflows, versions, tiers or bounds.`;
  const g = rung.grant;
  const cite = (e) => ({ decision_id: e.decision_id, seq: e.seq, entry_hash: e.entry_hash });
  const supersedes = g ? ` and superseding GRANT \`${short(g.decision_id)}\` (seq ${g.seq})` : "";
  let ruling;
  if (standing) {
    const declined = {
      ...cite(standing),
      signer_id: standing.signer_id,
      signed_at: standing.signed_at,
      reason: standing.reason,
      proposal_kind: standing.proposal_kind,
      why: standing.why,
      re_raise_when: standing.re_raise_when
    };
    ruling = {
      disposition: "DECLINED",
      favors: question_kind === "DEMOTE" ? "A" : "B",
      status: "PROPOSED",
      scope,
      declined,
      statement: question_kind === "DEMOTE" ? `Kept on the record: ${standing.signer_id} kept \`${wf}\` at \`${decl.granted}\` at ${standing.signed_at} ("${standing.reason}"), declining the step down to \`${toLevel}\`. The decline stands until ${standing.re_raise_when} (so far: ${standing.why}). ${surveilled ? `The pooled record still clears its bars; the failing case(s) that person weighed stand against \`${decl.granted}\`` : `The record still does not support \`${decl.granted}\` (${bind.rung}: ${bind.reason})`}; keeping it is that person's decision.` : `Not now, on the record: ${standing.signer_id} declined promoting \`${wf}\` from \`${decl.granted}\` to \`${focus}\` at ${standing.signed_at} ("${standing.reason}"). The decline stands until ${standing.re_raise_when} (so far: ${standing.why}).`,
      takes_effect: `nothing changes: a person already answered this proposal. The workflow stays at \`${decl.granted}\`: it ${behaviour(decl.granted, decl.bounds)}.`
    };
  } else if (question_kind === "DEMOTE") {
    const reasons = a.proposal && a.proposal.kind === "DEMOTION_PROPOSAL" ? a.proposal.reasons : [`${bind.rung}: ${bind.reason}`];
    const further = levelRank(a.earned) < levelRank(toLevel) ? ` The evidence supports only \`${a.earned}\`; one rung is proposed at a time, and a person may decide a larger step.` : "";
    ruling = {
      disposition: "PROPOSE_DEMOTION",
      favors: "B",
      status: "PROPOSED",
      ...unevidenced ? {} : { urgent: true },
      scope,
      statement: unevidenced ? `A standing notice, not an alarm: \`${wf}\` is granted \`${decl.granted}\` above what the record supports, and nothing has gone wrong. ${reasons.join("; ")}. A person may step it down to \`${toLevel}\`, or let the record catch up.${further}` : `Proposed, urgent: step \`${wf}\` down from \`${decl.granted}\` to \`${toLevel}\`. ${reasons.join("; ")}.${further}`,
      takes_effect: `only on a person's decision. Until then the workflow stays at \`${decl.granted}\`: it ${behaviour(decl.granted, decl.bounds)}. Every FAIL stays visible and disputable.${rung.source === "BOOK" ? ` A person's signed GRANT of \`${toLevel}\` would take effect${supersedes}; a signed DECLINE ("keep it") is recorded and not asked again until a new failing case.` : ""}`
    };
  } else if (question_kind === "RETAIN") {
    const keep = a.earned === "autonomy";
    ruling = {
      disposition: "RETAIN",
      favors: keep ? "A" : "B",
      status: "PROPOSED",
      scope,
      statement: `Retain: \`${wf}\` keeps \`autonomy\`. ${focusRung.reason}.`,
      takes_effect: "nothing changes"
    };
  } else if (a.proposal) {
    ruling = {
      disposition: "PROPOSE_PROMOTION",
      favors: "A",
      status: "PROPOSED",
      scope,
      statement: `Proposed: promote \`${wf}\` from \`${decl.granted}\` to \`${focus}\`${inBounds}. ${focusRung.reason}.${levelRank(a.earned) > levelRank(focus) ? ` The evidence also clears \`${a.earned}\`; one rung is proposed at a time.` : ""}${fw?.rung ? ` Argued from the window since the step down (GRANT \`${short(fw.since.decision_id)}\`, seq ${fw.since.seq}) alone: ${fw.rung.reason}.` : ""}`,
      takes_effect: rung.source === "BOOK" ? `only on a person's signature: a new signed GRANT of \`${focus}\` on the book, answering proposal \`${short(a.proposal.proposal_id)}\`${supersedes}. Declining costs nothing, and a signed decline is not asked again until a fresh sample accrues.` : "only on a person's signature. Declining costs nothing."
    };
  } else {
    ruling = {
      disposition: "NOT_YET",
      favors: "B",
      status: "PROPOSED",
      scope,
      statement: `Not yet: \`${wf}\` stays at \`${decl.granted}\`. ${a.blockers.length ? `${a.blockers.join("; ")}.` : fw?.rung && !fw.rung.cleared ? `A person stepped it down from \`${fw.from}\` after a failing case (GRANT \`${short(fw.since.decision_id)}\`, seq ${fw.since.seq}); a return needs evidence recorded since: ${fw.rung.rung} on that window alone: ${fw.rung.reason}. The pooled record clears it, and cannot carry the return by itself.` : `${bind.rung}: ${bind.reason}.`}`,
      takes_effect: "nothing changes"
    };
  }
  const notes = [];
  if (decl.grant) {
    const gr = decl.grant;
    notes.push(g ? `\`${decl.granted}\` was granted by ${gr.signer_id} at ${gr.signed_at}, under policy ${gr.policy.policy_id}@${gr.policy.version} at tier '${gr.consequence_tier}' (GRANT \`${short(g.decision_id)}\`, seq ${g.seq} on the book of record). A ruling here amends that grant, and only a person's new signed GRANT does. Those settings stay fixed; changing them is a person's recorded revision.` : `\`${decl.granted}\` was granted by ${gr.signer_id} at ${gr.signed_at}, under policy ${gr.policy.policy_id}@${gr.policy.version} at tier '${gr.consequence_tier}'. Those settings stay fixed; changing them is a person's recorded revision.`);
  }
  if (lapsed) notes.push(`A person declined an earlier proposal (${lapsed.signer_id}, ${lapsed.signed_at}: "${lapsed.reason}"); it lapsed: ${lapsed.why}. This asks again on changed evidence.`);
  if (notes.length) ruling.note = notes.join(" ");
  const favorsAuthority = ruling.favors === "A";
  const dissent = buildDissent(favorsAuthority, deps2, bind, cal, decl, policy, tierIndex, surveilled);
  const overturn = buildOverturn(question_kind, ruling.disposition, deps2, decl, policy, tierIndex, cal, ruling.declined);
  const raisedId = a.proposal?.proposal_id ?? standing?.suppressed_proposal_id;
  return finalizeOpinion({
    subject: {
      kind: "PROMOTION",
      question_kind,
      workflow_id: wf,
      granted: decl.granted,
      earned: a.earned,
      focus,
      to: toLevel,
      ...raisedId ? { proposal_id: raisedId } : {},
      rung_source: rung.source,
      ...g ? { amends: cite(g) } : {},
      ...standing ? { declined: cite(standing) } : {},
      ...view.scope ? { tenant_id: view.scope.tenant_id } : {}
    },
    title,
    question,
    readings,
    authorities,
    precedent,
    ruling,
    dissent,
    overturn,
    premises
  }, sourceHashOf(view));
}
function reassess(cal, decl, policy, tier) {
  const { grant: _fixedAtGrant, ...rest } = decl;
  return assessVoice(cal, { ...rest, consequence_tier: tier }, policy);
}
function buildDissent(favorsAuthority, deps2, bind, cal, decl, policy, tierIndex, surveilled = false) {
  const out = [];
  const tier = policy.tiers[tierIndex];
  const focus = deps2[deps2.length - 1];
  const r = favorsAuthority ? focus : bind;
  const noun = NOUN[r.metric];
  const lvl = focus.rung;
  if (favorsAuthority) {
    const margin = r.n - r.bar.min_n;
    out.push({ topic: "sample_size", premise: "P3", argument: `n = ${r.n} ${noun} against a minimum of ${r.bar.min_n} (margin ${margin}).${margin < r.bar.min_n * 0.1 ? " The record only just clears the minimum." : ""} A sample of ${r.n} cannot tell a rate of ${pct2(r.point ?? 0)} from one as high as ${pct2(r.upper)}.` });
    out.push({ topic: "confidence_interval", premise: "P6", argument: `The ${pct2(r.confidence)} ${r.sidedness} ${r.method} bounds on the ${METRIC_LABEL[r.metric]} are [${pct2(r.lower)}, ${pct2(r.upper)}] around the observed ${pct2(r.point ?? 0)}. Headroom under the bar of ${pct2(r.bar.max_error)} is ${pct2(Math.max(0, r.bar.max_error - r.upper))}. The true rate can sit anywhere between them, and the ruling rests on the top edge.` });
    const own = focus.counter_cases;
    const flagCases = [...new Set(deps2.filter((d) => d.metric === "false_flag_rate" && d.metric !== focus.metric).flatMap((d) => d.counter_cases))];
    const list = (ids) => ids.slice(0, 8).map((x) => `\`${short(x)}\``).join(", ") + (ids.length > 8 ? ", \u2026" : "");
    const ownText = own.length ? `${own.length} counter-case(s) bear directly on ${lvl} (${list(own)}). ${focus.metric === "false_pass_rate" ? `Each is a PASS a person overturned: under ${lvl}, an unreviewed wrong action.` : `Each is a FAIL a person overturned: a false alarm${lvl === "gate" ? " that would hold legitimate work" : ""}.`}` : `No counter-case bears directly on ${lvl}. That is absence of evidence in ${r.n} review(s), not evidence of absence: the bound still allows up to ${pct2(r.upper)}.`;
    const flagText = flagCases.length ? ` Beneath it, ${flagCases.length} FAIL verdict(s) a person overturned (${list(flagCases)}) are false alarms on the rungs ${lvl} stands on.` : "";
    out.push({ topic: "counter_cases", premise: "P4", argument: ownText + flagText });
    const next = policy.tiers[tierIndex + 1];
    if (next) {
      const alt = reassess(cal, decl, policy, next.tier);
      const clears = levelRank(alt.earned) >= levelRank(lvl);
      const ar = alt.rungs.find((x) => x.rung === lvl);
      out.push({ topic: "consequence_tier", premise: "P5", argument: `The workflow is declared tier '${tier.tier}' (${tier.description}); the bar is only as right as that declaration. If its real consequence is tier '${next.tier}' (${next.description}), ${lvl} needs n \u2265 ${ar.bar.min_n} and an upper bound \u2264 ${pct2(ar.bar.max_error)} at ${pct2(ar.confidence)}: this record ${clears ? "still clears it" : `does not (${ar.reason})`}.` });
    } else {
      out.push({ topic: "consequence_tier", premise: "P5", argument: `The workflow is declared tier '${tier.tier}' (${tier.description}), the highest the policy declares. If its real consequence is worse than any declared tier, no bar in this policy is strict enough.` });
    }
  } else {
    if (surveilled && r.cleared) {
      out.push({ topic: "sample_size", premise: "P3", argument: `The pooled record clears its bar (n = ${r.n} \u2265 ${r.bar.min_n}; upper bound ${pct2(r.upper)} \u2264 ${pct2(r.bar.max_error)}): the proposal rests on the failing case(s) found since the grant, not on the pooled rate.` });
    } else if (r.n < r.bar.min_n) {
      const c = cleanReviewsToClear(r.errors, r.n, r.bar, r.confidence, r.method);
      out.push({ topic: "sample_size", premise: "P3", argument: `The shortfall is volume, not error: n = ${r.n} of the ${r.bar.min_n} required${c !== null ? `; ${c} more reviewed ${r.metric === "false_pass_rate" ? "PASSes" : "FAILs"} with no overturn would clear ${r.rung}` : ""}.` });
    } else {
      out.push({ topic: "sample_size", premise: "P3", argument: `The sample already meets its minimum (n = ${r.n} \u2265 ${r.bar.min_n}); what holds it back is the bound, which is conservative by design.` });
    }
    out.push({ topic: "confidence_interval", premise: "P6", argument: `The observed ${METRIC_LABEL[r.metric]} is ${r.point === null ? "not yet measured" : pct2(r.point)}${r.point !== null && r.point <= r.bar.max_error ? ", already at or under the bar" : ""}; its ${pct2(r.confidence)} ${r.sidedness} bounds [${pct2(r.lower)}, ${pct2(r.upper)}] ${r.lower <= r.bar.max_error ? `include rates under the bar of ${pct2(r.bar.max_error)}: the data is consistent with a workflow that meets it` : `lie wholly above the bar of ${pct2(r.bar.max_error)}`}.` });
    out.push({ topic: "counter_cases", premise: "P4", argument: r.counter_cases.length ? `Only ${r.counter_cases.length} counter-case(s) (${r.counter_cases.map((x) => `\`${short(x)}\``).join(", ")}) stand against it. Each may carry its own explanation in its review note, and each can be disputed on its own (its dispute path is under Precedent).` : "Not one counter-case is on record against it." });
    const prev = policy.tiers[tierIndex - 1];
    if (prev) {
      const alt = reassess(cal, decl, policy, prev.tier);
      const target = focus.rung;
      const clears = levelRank(alt.earned) >= levelRank(target);
      out.push({ topic: "consequence_tier", premise: "P5", argument: `If the workflow's real consequence is tier '${prev.tier}' (${prev.description}) rather than '${tier.tier}', the bar is lower, and this record ${clears ? `already earns \`${target}\` under it` : `still does not earn \`${target}\` under it`}.` });
    } else {
      out.push({ topic: "consequence_tier", premise: "P5", argument: `Tier '${tier.tier}' is already the lowest the policy declares; the bar cannot be argued down by re-declaring consequence.` });
    }
  }
  const outcome = r.metric === "false_pass_rate" ? "PASS" : "FAIL";
  const total = cal.by_outcome[outcome], rev = cal.reviewed[outcome];
  out.push({ topic: "selection", premise: "P3", argument: `${rev} of ${total} ${outcome} verdict(s) were reviewed (${total ? pct2(rev / total) : "0%"}). If reviewers chose what to review rather than sampling at random, the rate is biased in a direction nobody measured.` });
  out.push({ topic: "reviewer", argument: "Every rate here takes a person's review as ground truth. A mistaken review moves the rate, and Riposte cannot check a person's judgement." });
  if (cal.window.first_recorded_at) out.push({ topic: "window", premise: "P3", argument: `The evidence runs from ${cal.window.first_recorded_at} to ${cal.window.last_recorded_at}. A change in the agent, the documents or the counterparties since then is not in it.` });
  return out;
}
function buildOverturn(kind, disposition, deps2, decl, policy, tierIndex, cal, declined) {
  const out = [];
  const focus = deps2[deps2.length - 1];
  if (disposition === "DECLINED" && declined) {
    out.push({ premise: "P9", evidence: declined.re_raise_when, effect: "the decline lapses and the proposal is raised again, argued in a new opinion" });
    out.push({ premise: "P8", evidence: "a person re-granting the workflow (at any rung)", effect: "the decline binds to the grant in force, so it lapses with it" });
    if (kind === "DEMOTE") out.push({ premise: "P4", evidence: "a successful dispute of a failing case (a person re-reviews it as UPHELD)", effect: "it leaves the count and the bound is recomputed; if the record supports the rung again, there is nothing left to decline" });
  } else if (disposition === "PROPOSE_PROMOTION" || disposition === "RETAIN") {
    for (const r of [...deps2].reverse()) {
      if (!r.cleared) continue;
      const noun = r.metric === "false_pass_rate" ? "PASS verdicts" : "FAIL verdicts";
      const falls = below(r.rung);
      const j = consecutiveErrorsToBreach(r.errors, r.n, r.bar.max_error, r.confidence, r.method);
      out.push({ premise: "P6", evidence: `${j} more overturned ${noun} in a row (no clean review between)`, effect: `the ${r.rung} upper bound exceeds ${pct2(r.bar.max_error)}: Riposte raises an urgent proposal to step down to \`${falls}\`, and a person decides` });
      const m = errorsInHorizonToBreach(r.errors, r.n, r.bar.min_n, r.bar.max_error, r.confidence, r.method);
      if (m !== null) out.push({ premise: "P6", evidence: `${m} or more overturned among the next ${r.bar.min_n} reviewed ${noun}`, effect: `the ${r.rung} upper bound exceeds ${pct2(r.bar.max_error)}: Riposte raises an urgent proposal to step down to \`${falls}\`, and a person decides` });
    }
    const next = policy.tiers[tierIndex + 1];
    if (next) {
      const alt = reassess(cal, decl, policy, next.tier);
      if (levelRank(alt.earned) < levelRank(focus.rung)) out.push({ premise: "P5", evidence: `a person re-granting the workflow at tier '${next.tier}' (${next.description})`, effect: `this record supports only \`${alt.earned}\` under that bar` });
    }
    if (disposition === "PROPOSE_PROMOTION") out.push({ evidence: "a person declines to sign", effect: `the proposal lapses; the workflow stays at \`${decl.granted}\`` });
  } else {
    for (const r of deps2) {
      if (r.cleared) continue;
      const c = cleanReviewsToClear(r.errors, r.n, r.bar, r.confidence, r.method);
      const noun = r.metric === "false_pass_rate" ? "PASS verdicts" : "FAIL verdicts";
      out.push({ premise: "P6", evidence: c === null ? `no realistic run of clean reviews (past 10,000,000) clears ${r.rung} at this tier` : `${c} more reviewed ${noun} with no overturn`, effect: `${r.rung} clears (n \u2265 ${r.bar.min_n}, upper bound \u2264 ${pct2(r.bar.max_error)})` });
    }
    const target = kind === "DEMOTE" ? decl.granted : focus.rung;
    const prev = policy.tiers[tierIndex - 1];
    if (prev) {
      const alt = reassess(cal, decl, policy, prev.tier);
      if (levelRank(alt.earned) >= levelRank(target)) out.push({ premise: "P5", evidence: `a person re-granting at the lower tier '${prev.tier}' (${prev.description}), if that is its real consequence`, effect: `this record supports \`${alt.earned}\` under that bar` });
    }
    if (kind === "DEMOTE") {
      out.push({ premise: "P4", evidence: "a successful dispute of a failing case (a person re-reviews it as UPHELD)", effect: "it leaves the count and the bound is recomputed; the proposal lapses if the rung is supported again" });
      out.push({ evidence: "a person deciding to keep the rung", effect: `the workflow stays at \`${decl.granted}\`: it is their decision. The proposal stays open, flagged, while the record does not support the rung` });
    } else {
      out.push({ evidence: `a person deciding to grant \`${focus.rung}\` anyway`, effect: "the rung is theirs to set; while the record does not support it, Riposte shows a standing notice (not urgent), and raises an urgent proposal to step down only on a failing case" });
    }
  }
  out.push({ evidence: "a new ruleset or engine version", effect: "this evidence stops describing the rules; the new version starts an empty record, and its rung is a person's new grant" });
  out.push({ premise: "P1", evidence: "the ledger failing its integrity check (verifyContent)", effect: "the evidence is void; nothing may be earned from it" });
  return out;
}

// packages/verify/src/reconcile/index.ts
function getPath2(obj, path) {
  const parts = path.replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean);
  let cur = obj;
  for (const p of parts) {
    if (cur === null || typeof cur !== "object") return void 0;
    cur = cur[p];
  }
  return cur;
}
function bindField2(documents, spec) {
  const source = documents[spec.doc];
  if (source === void 0) {
    if (spec.default !== void 0) return { status: "ok", value: spec.default, doc: spec.doc, path: `default(${spec.default})` };
    return { status: "doc_missing", doc: spec.doc };
  }
  let resolvedButBad = false;
  for (const p of spec.paths) {
    const raw = getPath2(source, p);
    if (raw === void 0 || raw === null || raw === "") continue;
    const norm2 = normalizeAmount(raw);
    if (norm2 && norm2.success !== false) return { status: "ok", value: norm2.normalized, doc: spec.doc, path: p, original: raw, norms: norm2.transformations };
    resolvedButBad = true;
  }
  if (spec.default !== void 0) return { status: "ok", value: spec.default, doc: spec.doc, path: `default(${spec.default})` };
  return { status: resolvedButBad ? "unparseable" : "field_missing", doc: spec.doc };
}
var OP_LABEL = { "=": "=", "<=": "\u2264", ">=": "\u2265", "!=": "\u2260" };
function reconcile(documents, ruleset, options = {}) {
  const policy = ruleset.tolerance ?? { rel: 3e-4, absCap: 0 };
  const claims = [];
  for (const chk of ruleset.checks) {
    const roles = [.../* @__PURE__ */ new Set([...referencedRoles(chk.left), ...referencedRoles(chk.right)])].filter((r) => r in ruleset.fields);
    const bounds = new Map(roles.map((r) => [r, bindField2(documents, ruleset.fields[r])]));
    const base = { claim_id: `recon.${chk.code}`, kind: "CROSS_REFERENCE", tier: "DETERMINISTIC", field: chk.field ?? chk.code.toLowerCase(), rule_id: chk.code, rule_name: chk.name ?? chk.code };
    const insuff = (() => {
      for (const r of roles) {
        const b = bounds.get(r);
        if (b.status === "doc_missing") return { reason: "REFERENCE_NOT_PROVIDED", detail: `document "${b.doc}" (needed for ${r}) was not supplied`, missing: [r] };
      }
      for (const r of roles) {
        const b = bounds.get(r);
        if (b.status === "unparseable") return { reason: "UNPARSEABLE", detail: `${r} in "${b.doc}" is present but not a number`, missing: [r] };
        if (b.status === "field_missing") return { reason: "FIELD_MISSING", detail: `${r} not found in document "${b.doc}"`, missing: [r] };
      }
      return null;
    })();
    if (insuff) {
      claims.push({ ...base, outcome: "INSUFFICIENT_DATA", asserted: null, evidence: [], insufficiency: insuff, locked: false, explanation: `${chk.code}: ${insuff.detail}` });
      continue;
    }
    const vars = {};
    for (const r of roles) vars[r] = bounds.get(r).value;
    const env = { vars, sum: () => void 0 };
    let left, right;
    try {
      left = evalExpr(chk.left, env);
      right = evalExpr(chk.right, env);
    } catch (e) {
      claims.push({ ...base, outcome: "INSUFFICIENT_DATA", asserted: null, evidence: [], insufficiency: { reason: "OUT_OF_RULESET_SCOPE", detail: `expression error: ${e.message}` }, locked: false, explanation: `${chk.code}: bad expression` });
      continue;
    }
    if (left === void 0 || right === void 0) {
      claims.push({ ...base, outcome: "INSUFFICIENT_DATA", asserted: null, evidence: [], insufficiency: { reason: "FIELD_MISSING", detail: `a value needed by ${chk.code} was absent`, missing: roles }, locked: false, explanation: `${chk.code}: operand absent` });
      continue;
    }
    const tolAbs = Math.max(chk.tol ?? 0.01, policy.absCap, policy.rel * Math.max(Math.abs(left), Math.abs(right)));
    const diff = left - right;
    const pass = chk.op === "=" ? Math.abs(diff) <= tolAbs : chk.op === "!=" ? Math.abs(diff) > tolAbs : chk.op === "<=" ? left <= right + tolAbs : left >= right - tolAbs;
    const evidence = roles.map((r) => {
      const b = bounds.get(r);
      const computed2 = (b.path ?? "").startsWith("default(");
      const e = { locator: { kind: "field", source: computed2 ? "computed" : "evidence", path: `${b.doc}.${b.path ?? ""}` }, value: b.value ?? null, confidence: computed2 ? 100 : 100, role: "OPERAND" };
      if (b.original !== void 0 && String(b.original) !== String(b.value)) e.original = b.original;
      if (b.norms && b.norms.length) e.normalizations = b.norms;
      return e;
    });
    claims.push({
      ...base,
      outcome: pass ? "PASS" : "FAIL",
      asserted: left,
      computation: { formula: `${chk.left} ${OP_LABEL[chk.op]} ${chk.right}`, operands: Object.fromEntries(roles.map((r) => [r, vars[r] ?? null])), result: right, tolerance: { abs: tolAbs } },
      evidence,
      ...pass ? {} : { variance: Number(diff.toFixed(4)) },
      locked: pass,
      explanation: pass ? `${chk.code}: coheres (${left} ${OP_LABEL[chk.op]} ${right})` : `${chk.code}: cross-document mismatch \u2014 ${chk.left} = ${left} but expected ${right} (\u0394 ${Number(diff.toFixed(4))})`
    });
  }
  const outcome = claims.some((c) => c.outcome === "FAIL") ? "FAIL" : claims.some((c) => c.outcome === "PASS") ? "PASS" : "INSUFFICIENT_DATA";
  const coverage = {
    claims_total: claims.length,
    claims_checked: claims.filter((c) => c.outcome === "PASS" || c.outcome === "FAIL").length,
    claims_pass: claims.filter((c) => c.outcome === "PASS").length,
    claims_fail: claims.filter((c) => c.outcome === "FAIL").length,
    claims_insufficient: claims.filter((c) => c.outcome === "INSUFFICIENT_DATA").length
  };
  const input_hash = hashOf({ documents, ruleset });
  const verdict_id = deriveVerdictId(input_hash, ruleset, ENGINE_VERSION);
  const issued_at = (options.now ?? (() => /* @__PURE__ */ new Date()))().toISOString();
  return {
    schema_version: SCHEMA_VERSION,
    verdict_id,
    issued_at,
    engine_version: ENGINE_VERSION,
    ruleset: { id: ruleset.id, version: ruleset.version, domain: ruleset.domain ?? ruleset.id },
    input_hash,
    replayable: true,
    document: { extraction_hash: hashOf(documents), line_items: 0 },
    references: { contract: false, evidence: Object.keys(documents).length, history: 0, source: false },
    outcome,
    aggregation: "ANY_FAIL_FAILS",
    claims,
    coverage
  };
}

// packages/verify/src/twin/ixbrl.ts
var NS_US_GAAP = /^https?:\/\/(?:xbrl\.)?fasb\.org\/us-gaap\//i;
var NS_IX = /^http:\/\/www\.xbrl\.org\/20(?:08|13)\/inlineXBRL$/i;
var NS_ISO4217 = "http://www.xbrl.org/2003/iso4217";
var ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n >= 0 && n <= 1114111 ? String.fromCodePoint(n) : m;
    }
    return ENT[e.toLowerCase()] ?? m;
  });
}
function attr(attrs, name) {
  const m = attrs.match(new RegExp(`(?:^|\\s)${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"));
  return m ? decodeEntities(m[1] ?? m[2] ?? "") : void 0;
}
function namespaces(html) {
  const out = /* @__PURE__ */ new Map();
  for (const m of html.matchAll(/\sxmlns:([A-Za-z_][\w.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    const p = m[1];
    if (!out.has(p)) out.set(p, m[2] ?? m[3] ?? "");
  }
  return out;
}
var dateOnly = (s) => {
  const m = s?.trim().match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : void 0;
};
function readContexts(html) {
  const out = /* @__PURE__ */ new Map();
  for (const m of html.matchAll(/<((?:[A-Za-z_][\w.-]*:)?)context\b([^>]*)>([\s\S]*?)<\/\1context\s*>/g)) {
    const id = attr(m[2], "id");
    if (!id || out.has(id)) continue;
    const body = m[3];
    const inner2 = (tag) => body.match(new RegExp(`<(?:[A-Za-z_][\\w.-]*:)?${tag}\\s*>\\s*([^<]*?)\\s*<\\/(?:[A-Za-z_][\\w.-]*:)?${tag}\\s*>`))?.[1];
    const members = [];
    for (const e of body.matchAll(/<(?:[A-Za-z_][\w.-]*:)?(explicitMember|typedMember)\b([^>]*)>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?\1\s*>/g)) {
      members.push(`${attr(e[2], "dimension") ?? "?"}=${decodeEntities(e[3].replace(/<[^>]*>/g, "")).trim()}`);
    }
    const instant = dateOnly(inner2("instant"));
    const start = dateOnly(inner2("startDate"));
    const end = dateOnly(inner2("endDate"));
    out.set(id, { id, ...instant ? { instant } : {}, ...start ? { start } : {}, ...end ? { end } : {}, dimensional: members.length > 0, members });
  }
  return out;
}
function readUnits(html, ns) {
  const out = /* @__PURE__ */ new Map();
  for (const m of html.matchAll(/<((?:[A-Za-z_][\w.-]*:)?)unit\b([^>]*)>([\s\S]*?)<\/\1unit\s*>/g)) {
    const id = attr(m[2], "id");
    if (!id || out.has(id)) continue;
    const body = m[3];
    const measures = [...body.matchAll(/<(?:[A-Za-z_][\w.-]*:)?measure\s*>\s*([^<]*?)\s*<\/(?:[A-Za-z_][\w.-]*:)?measure\s*>/g)].map((x) => x[1].trim());
    const divide = /<(?:[A-Za-z_][\w.-]*:)?divide\b/.test(body);
    let usd = false;
    if (!divide && measures.length === 1) {
      const [p, local] = measures[0].includes(":") ? measures[0].split(":", 2) : ["", measures[0]];
      const uri = p ? ns.get(p) : void 0;
      usd = local === "USD" && (uri === NS_ISO4217 || uri === void 0 && p.toLowerCase() === "iso4217");
    }
    out.set(id, { id, measures, usd });
  }
  return out;
}
var WORDS = {
  no: 0,
  none: 0,
  nil: 0,
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20
};
function parseIxNumber(displayed, format) {
  const f = format.toLowerCase();
  const t = displayed.normalize("NFKC").trim();
  if (f === "fixed-zero" || f === "zerodash" || f === "fixedzero") return 0;
  if (f === "numwordsen" || f === "num-words-en") {
    const w = t.toLowerCase().replace(/[^a-z]/g, "");
    return w in WORDS ? WORDS[w] : null;
  }
  const s = t.replace(/^\((.*)\)$/, "$1").replace(/[\s$\u20ac\u00a3\u00a5]/g, "");
  if (f === "" || f === "num-dot-decimal" || f === "numdotdecimal" || f === "num-dot-decimal-apos" || f === "numcommadot") {
    const x = s.replace(/[,']/g, "");
    return /^\d+(\.\d+)?$|^\.\d+$/.test(x) ? Number(x) : null;
  }
  if (f === "num-comma-decimal" || f === "numcommadecimal" || f === "numdotcomma" || f === "numspacecomma") {
    const x = s.replace(/\./g, "").replace(",", ".");
    return /^\d+(\.\d+)?$|^\.\d+$/.test(x) ? Number(x) : null;
  }
  return null;
}
function displayedText(inner2, ix) {
  const ex = new RegExp(`<${ix}:exclude\\b[^>]*>[\\s\\S]*?<\\/${ix}:exclude\\s*>`, "gi");
  return decodeEntities(inner2.replace(ex, "").replace(/<[^>]*>/g, "")).replace(/[\s\u200b]+/g, " ").trim();
}
function parseInlineXbrl(html) {
  const ns = namespaces(html);
  const ix = [...ns.entries()].find(([, uri]) => NS_IX.test(uri))?.[0] ?? "ix";
  const contexts = readContexts(html);
  const units = readUnits(html, ns);
  const facts = [];
  const stats = { nonFraction: 0, nil: 0, unparseable: 0, missingContext: 0, formats: {} };
  const open = new RegExp(`<${ix}:nonFraction\\b([^>]*?)(\\/?)>`, "gi");
  const tagRe = new RegExp(`<(\\/?)${ix}:nonFraction\\b[^>]*?(\\/?)>`, "gi");
  for (let m = open.exec(html); m; m = open.exec(html)) {
    stats.nonFraction++;
    const attrs = m[1];
    const start = m.index;
    const openEnd = m.index + m[0].length;
    if (m[2] === "/" || /^true$/i.test(attr(attrs, "xsi:nil") ?? "")) {
      stats.nil++;
      continue;
    }
    tagRe.lastIndex = openEnd;
    let depth = 1, closeStart = -1, closeEnd = -1;
    for (let t = tagRe.exec(html); t; t = tagRe.exec(html)) {
      if (t[1] === "/") {
        depth--;
        if (depth === 0) {
          closeStart = t.index;
          closeEnd = t.index + t[0].length;
          break;
        }
      } else if (t[2] !== "/") depth++;
    }
    if (closeStart < 0) {
      stats.unparseable++;
      continue;
    }
    const displayed = displayedText(html.slice(openEnd, closeStart), ix);
    const format = (attr(attrs, "format") ?? "").replace(/^[^:]*:/, "");
    const qname = attr(attrs, "name") ?? "";
    const contextRef = attr(attrs, "contextRef") ?? "";
    if (!contexts.has(contextRef)) {
      stats.missingContext++;
      continue;
    }
    const n = parseIxNumber(displayed, format);
    if (n === null) {
      stats.unparseable++;
      continue;
    }
    const scale = Number(attr(attrs, "scale") ?? 0);
    const decRaw = attr(attrs, "decimals");
    const decimals = decRaw === void 0 ? null : /^inf$/i.test(decRaw.trim()) ? Infinity : Number(decRaw);
    const sign = (attr(attrs, "sign") ?? "").trim() === "-" ? -1 : 1;
    const [prefix, local] = qname.includes(":") ? qname.split(":", 2) : ["", qname];
    const value = sign * n * 10 ** (Number.isFinite(scale) ? scale : 0);
    stats.formats[format] = (stats.formats[format] ?? 0) + 1;
    facts.push({
      concept: local,
      namespace: ns.get(prefix) ?? "",
      qname,
      contextRef,
      unitRef: attr(attrs, "unitRef") ?? "",
      decimals: decimals !== null && Number.isNaN(decimals) ? null : decimals,
      scale: Number.isFinite(scale) ? scale : 0,
      sign,
      format,
      displayed,
      value: Object.is(value, -0) ? 0 : value,
      span: { start, end: closeEnd }
    });
  }
  return { sha256: sha256(html), contexts, units, facts, stats };
}
function isUsGaap(f) {
  return f.namespace ? NS_US_GAAP.test(f.namespace) : f.qname.startsWith("us-gaap:");
}

// packages/verify/src/twin/map.ts
var SCOPE_VARIANT_SUFFIXES = ["IncludingDisposalGroupAndDiscontinuedOperations", "IncludingDiscontinuedOperations"];
function twinFieldConcepts(map, fm) {
  if ((map.family ?? "map") !== "scope-variants") return fm.concepts;
  return [...fm.concepts, ...fm.concepts.flatMap((c) => SCOPE_VARIANT_SUFFIXES.map((s) => `${c}${s}`))];
}
var FS_CORE_TWIN_MAP = {
  id: "twin-xbrl-fs-core",
  version: "0.1.0",
  domain: "financial-statements",
  taxonomy: "us-gaap",
  fields: [
    { field: "assets", cell: "BS.totals", concepts: ["Assets"], period: "instant" },
    { field: "liabilities", cell: "BS.totals", concepts: ["Liabilities"], period: "instant" },
    { field: "equity", cell: "BS.totals", concepts: ["StockholdersEquity"], period: "instant" },
    { field: "liabilities_and_equity", cell: "BS.totals", concepts: ["LiabilitiesAndStockholdersEquity"], period: "instant" },
    { field: "current_assets", cell: "BS.current", concepts: ["AssetsCurrent"], period: "instant" },
    { field: "current_liabilities", cell: "BS.current", concepts: ["LiabilitiesCurrent"], period: "instant" },
    { field: "noncurrent_assets", cell: "BS.noncurrent", concepts: ["AssetsNoncurrent"], period: "instant" },
    { field: "noncurrent_liabilities", cell: "BS.noncurrent", concepts: ["LiabilitiesNoncurrent"], period: "instant" },
    { field: "cash", cell: "BS.cash", concepts: ["CashAndCashEquivalentsAtCarryingValue"], period: "instant" },
    { field: "revenue", cell: "IS.revenue", concepts: ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax"], period: "FY" },
    { field: "cost_of_goods_sold", cell: "IS.revenue", concepts: ["CostOfRevenue", "CostOfGoodsAndServicesSold"], period: "FY" },
    { field: "gross_profit", cell: "IS.revenue", concepts: ["GrossProfit"], period: "FY" },
    { field: "operating_expenses", cell: "IS.operating", concepts: ["OperatingExpenses"], period: "FY" },
    { field: "operating_income", cell: "IS.operating", concepts: ["OperatingIncomeLoss"], period: "FY" },
    { field: "pretax_income", cell: "IS.bottom", concepts: ["IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest", "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments"], period: "FY" },
    { field: "income_tax_expense", cell: "IS.bottom", concepts: ["IncomeTaxExpenseBenefit"], period: "FY" },
    { field: "net_income", cell: "IS.bottom", concepts: ["ProfitLoss", "NetIncomeLoss"], period: "FY" },
    { field: "other_comprehensive_income", cell: "CI", concepts: ["OtherComprehensiveIncomeLossNetOfTax"], period: "FY" },
    { field: "comprehensive_income", cell: "CI", concepts: ["ComprehensiveIncomeNetOfTaxIncludingPortionAttributableToNoncontrollingInterest", "ComprehensiveIncomeNetOfTax"], period: "FY" },
    { field: "cash_from_operations", cell: "CF.activities", concepts: ["NetCashProvidedByUsedInOperatingActivities"], period: "FY" },
    { field: "cash_from_investing", cell: "CF.activities", concepts: ["NetCashProvidedByUsedInInvestingActivities"], period: "FY" },
    { field: "cash_from_financing", cell: "CF.activities", concepts: ["NetCashProvidedByUsedInFinancingActivities"], period: "FY" },
    { field: "net_change_in_cash", cell: "CF.cash", concepts: ["CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalentsPeriodIncreaseDecreaseIncludingExchangeRateEffect", "CashAndCashEquivalentsPeriodIncreaseDecrease"], period: "FY" },
    { field: "ending_cash", cell: "CF.cash", concepts: ["CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents"], period: "instant" },
    { field: "beginning_cash", cell: "CF.cash", concepts: ["CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents"], period: "prior_instant" }
  ]
};
var FS_CORE_TWIN_MAP_V02 = {
  ...FS_CORE_TWIN_MAP,
  version: "0.2.0",
  binding: "statement",
  matching: "decimals"
};
var FS_CORE_TWIN_MAP_V021 = {
  ...FS_CORE_TWIN_MAP_V02,
  version: "0.2.1",
  family: "scope-variants",
  scale: "anchored",
  links: "strict",
  fields: FS_CORE_TWIN_MAP.fields.map((f) => f.field === "ending_cash" ? { ...f, roll: { position: "end", change: "net_change_in_cash" } } : f.field === "beginning_cash" ? { ...f, roll: { position: "start", change: "net_change_in_cash" } } : f)
};

// packages/verify/src/twin/judge.ts
var DAY = 864e5;
var ms = (d) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
var periodKey = (c) => c.instant ?? `${c.start ?? "?"}..${c.end ?? "?"}`;
function periodMatch(c, p, E2, tolDays) {
  if (p === "instant") return c.instant !== void 0 && Math.abs(ms(c.instant) - E2) <= tolDays * DAY;
  if (p === "FY") {
    if (c.start === void 0 || c.end === void 0) return false;
    const len = (ms(c.end) - ms(c.start)) / DAY;
    return Math.abs(ms(c.end) - E2) <= tolDays * DAY && len >= 350 && len <= 380;
  }
  if (c.instant === void 0) return false;
  const back = (E2 - ms(c.instant)) / DAY;
  return back > tolDays && back >= 350 && back <= 380;
}
function preferPeriod(p, E2, a, b) {
  if (p === "prior_instant") return ms(b.instant) - ms(a.instant);
  const ea = ms(a.instant ?? a.end), eb = ms(b.instant ?? b.end);
  const d = Math.abs(ea - E2) - Math.abs(eb - E2);
  if (d !== 0) return d;
  if (p === "FY") {
    const la = ms(a.end) - ms(a.start), lb = ms(b.end) - ms(b.start);
    if (la !== lb) return lb - la;
  }
  const ka = periodKey(a), kb = periodKey(b);
  return ka < kb ? -1 : ka > kb ? 1 : 0;
}
var indexCache = /* @__PURE__ */ new WeakMap();
function indexed(twin) {
  const hit = indexCache.get(twin);
  if (hit) return hit;
  const byConcept = /* @__PURE__ */ new Map(), byMagnitude = /* @__PURE__ */ new Map();
  for (const f of twin.facts) {
    const k = isUsGaap(f) ? f.concept : `\0${f.qname}`;
    const a = byConcept.get(k) ?? [];
    a.push(f);
    byConcept.set(k, a);
    const m = Math.round(Math.abs(f.value));
    const b = byMagnitude.get(m) ?? [];
    b.push(f);
    byMagnitude.set(m, b);
  }
  const out = { twin, byConcept, byMagnitude };
  indexCache.set(twin, out);
  return out;
}
function ref(twin, f) {
  const c = twin.contexts.get(f.contextRef);
  return { concept: f.concept, context: f.contextRef, period: periodKey(c), value: f.value, displayed: f.displayed, scale: f.scale, decimals: f.decimals, sign: f.sign, dimensional: c.dimensional, span: f.span };
}
var usdOf = (twin, f) => twin.units.get(f.unitRef)?.usd === true;
var rank2 = (d) => d === null ? -Infinity : d;
function twinGate(twin, periodEnd, periodToleranceDays = 7) {
  const E2 = ms(periodEnd);
  return twin.facts.some((f) => {
    const c = twin.contexts.get(f.contextRef);
    const d = c?.instant ?? c?.end;
    return c !== void 0 && !c.dimensional && d !== void 0 && usdOf(twin, f) && Math.abs(ms(d) - E2) <= periodToleranceDays * DAY;
  });
}
function conceptGroup(ix, concept, period, E2, tolDays, anchor) {
  const { twin } = ix;
  const inPeriod = (ix.byConcept.get(concept) ?? []).filter((f) => {
    const c = twin.contexts.get(f.contextRef);
    return !c.dimensional && periodMatch(c, period, E2, tolDays);
  });
  if (anchor && !anchor.has(concept)) return { kind: inPeriod.length ? "off" : "none" };
  const usd = inPeriod.filter((f) => usdOf(twin, f));
  if (!usd.length) return { kind: inPeriod.length ? "nonusd" : "none" };
  const ctxs = [...new Map(usd.map((f) => [periodKey(twin.contexts.get(f.contextRef)), twin.contexts.get(f.contextRef)])).values()];
  ctxs.sort((a, b) => preferPeriod(period, E2, a, b));
  const key = periodKey(ctxs[0]);
  const group = usd.filter((f) => periodKey(twin.contexts.get(f.contextRef)) === key).sort((a, b) => rank2(b.decimals) - rank2(a.decimals) || a.span.start - b.span.start);
  const best = group[0];
  for (const o of group.slice(1)) {
    const tol = o.decimals !== null && Number.isFinite(o.decimals) ? 0.5 * 10 ** -o.decimals : 0.5;
    if (Math.abs(o.value - best.value) > tol + 1e-9) return { kind: "conflict", detail: `${concept} in ${key} is reported as both ${best.value} and ${o.value}` };
  }
  return { kind: "group", group };
}
function bindFieldGroup(ix, fm, E2, tolDays, anchor, concepts = fm.concepts, named = fm.concepts.join(" / ")) {
  const { twin } = ix;
  const base = { field: fm.field, cell: fm.cell };
  const none = (reason, detail) => ({ result: { ...base, bound: false, reason, detail }, group: [] });
  const anyContext = [...twin.contexts.values()].some((c) => !c.dimensional && periodMatch(c, fm.period, E2, tolDays));
  if (!anyContext) return none("PERIOD_UNRESOLVED", `the twin has no non-dimensional ${fm.period} context for this period`);
  let sawNonUsd = false;
  const offStatement = [];
  for (const concept of concepts) {
    const g = conceptGroup(ix, concept, fm.period, E2, tolDays, anchor);
    if (g.kind === "off") {
      offStatement.push(concept);
      continue;
    }
    if (g.kind === "nonusd") {
      sawNonUsd = true;
      continue;
    }
    if (g.kind === "none") continue;
    if (g.kind === "conflict") return none("CONFLICTING_FACTS", g.detail);
    return { result: { ...base, bound: true, binding: { ...ref(twin, g.group[0]), duplicates: g.group.length } }, group: g.group };
  }
  if (sawNonUsd) return none("NO_USD_FACT", `${named} is reported in the period only in a non-USD unit`);
  if (offStatement.length) return none("NOT_ON_STATEMENT", `${offStatement.join(" / ")} is reported in the ${fm.period} period, but the filing's presentation linkbase places none of ${named} on a face statement`);
  return none("NO_BINDING_FACT", `the twin reports none of ${named} (non-dimensional, USD) in the ${fm.period} period${anchor ? " on a face statement" : ""}`);
}
var halfUnit = (d, tol) => d !== null && Number.isFinite(d) ? Math.max(tol, 0.5 * 10 ** -d) : tol;
function faceLines(ix, concepts, period, E2, tolDays, anchor, tol) {
  const out = [];
  for (const concept of concepts) {
    const g = conceptGroup(ix, concept, period, E2, tolDays, anchor);
    if (g.kind !== "group") continue;
    const v = g.group[0];
    if (!out.some((o) => Math.abs(o[0].value - v.value) <= Math.max(halfUnit(o[0].decimals, tol), halfUnit(v.decimals, tol)) + 1e-9)) out.push(g.group);
  }
  return out;
}
function bindFamily(ix, map, fm, E2, tolDays, anchor, tol, change) {
  const concepts = twinFieldConcepts(map, fm);
  const named = `${fm.concepts.join(" / ")} (or a scope variant)`;
  const first = bindFieldGroup(ix, fm, E2, tolDays, anchor, concepts, named);
  if (!first.result.bound || !fm.roll) return first;
  const own = faceLines(ix, concepts, fm.period, E2, tolDays, anchor, tol);
  if (own.length <= 1) return first;
  const { twin } = ix;
  const base = { field: fm.field, cell: fm.cell };
  const lines = own.map((g) => ({ ...ref(twin, g[0]), duplicates: g.length }));
  const show = lines.map((l) => `${l.concept} = ${l.value}`).join(", ");
  const partner = faceLines(ix, concepts, fm.period === "prior_instant" ? "instant" : "prior_instant", E2, tolDays, anchor, tol);
  const d = change();
  const closes = (o) => d !== void 0 && d.bound && partner.some((p) => {
    const [start, end] = fm.roll.position === "end" ? [p[0], o] : [o, p[0]];
    const slack = halfUnit(start.decimals, tol) + halfUnit(end.decimals, tol) + halfUnit(d.binding.decimals, tol);
    return Math.abs(start.value + d.binding.value - end.value) <= slack + 1e-9;
  });
  const fits = own.filter((g) => closes(g[0]));
  if (fits.length !== 1) {
    const why = d === void 0 || !d.bound ? `the period's net change (${fm.roll.change}) does not bind` : !partner.length ? "the other end of the roll has no face line" : `${fits.length ? "several" : "none"} of them close${fits.length ? "" : "s"} the roll`;
    return { result: { ...base, bound: false, reason: "AMBIGUOUS_LINE", detail: `the face statement presents ${own.length} lines of the field's concept family in the ${fm.period} period (${show}), and ${why}`, candidates: lines }, group: [] };
  }
  const group = fits[0];
  return { result: { ...base, bound: true, binding: { ...ref(twin, group[0]), duplicates: group.length }, alternatives: lines.filter((l) => l.span.start !== group[0].span.start) }, group };
}
function valueAnchors(ix, concepts, fm, E2, tolDays, anchor, tol) {
  const { twin } = ix;
  const out = [];
  for (const concept of concepts) {
    if (anchor.has(concept)) continue;
    const g = conceptGroup(ix, concept, fm.period, E2, tolDays, null);
    if (g.kind !== "group") continue;
    const m = g.group[0];
    const key = periodKey(twin.contexts.get(m.contextRef));
    const face = twin.facts.find((f) => isUsGaap(f) && anchor.has(f.concept) && usdOf(twin, f) && !twin.contexts.get(f.contextRef).dimensional && periodKey(twin.contexts.get(f.contextRef)) === key && Math.abs(Math.abs(f.value) - Math.abs(m.value)) <= Math.max(halfUnit(f.decimals, tol), halfUnit(m.decimals, tol)) + 1e-9);
    if (face) out.push({ fact: m, duplicates: g.group.length, face });
  }
  return out;
}
function exactScale(v, f, tol) {
  const a = Math.abs(f.value);
  if (a === 0 || v === 0) return null;
  for (const k of [3, 6, 9, -3, -6, -9]) {
    const scaled = k > 0 ? v / 10 ** k : v * 10 ** -k;
    if (Math.abs(scaled - a) <= halfUnit(f.decimals, tol) + 1e-9) return k;
  }
  return null;
}
function bindField3(ix, fm, E2, tolDays) {
  return bindFieldGroup(ix, fm, E2, tolDays, null).result;
}
function statementAnchor(map, p) {
  if ((map.binding ?? "document") !== "statement") return { anchor: null };
  if (!p) return { anchor: null, abstain: { reason: "NO_PRESENTATION_LINKBASE", detail: `the ruleset ${map.id}@${map.version} binds through the filing's presentation linkbase, and none was supplied or readable` } };
  if ((map.links ?? "v0.2") === "strict" && p.links !== "strict") return { anchor: null, abstain: { reason: "NO_PRESENTATION_LINKBASE", detail: `the ruleset ${map.id}@${map.version} binds through the strict reading of the presentation linkbase (parseTwinPresentation(\u2026, { links: 'strict' })), and the presentation supplied (sha256 ${p.sha256.slice(0, 12)}\u2026) was read the v0.2 way` } };
  if (!p.statementRoles.length) return { anchor: null, abstain: { reason: "NO_STATEMENT_ROLES", detail: `the presentation linkbase (sha256 ${p.sha256.slice(0, 12)}\u2026) identifies no face-statement role (source: ${p.source})` } };
  return { anchor: new Set(p.statementConcepts) };
}
function familyBinder(ix, map, E2, tolDays, anchor, tol) {
  const memo = /* @__PURE__ */ new Map();
  const bind = (fm) => {
    const hit = memo.get(fm.field);
    if (hit) return hit;
    const changeFm = fm.roll ? map.fields.find((f) => f.field === fm.roll.change && !f.roll) : void 0;
    const r = bindFamily(ix, map, fm, E2, tolDays, anchor, tol, () => changeFm ? bind(changeFm).result : void 0);
    memo.set(fm.field, r);
    return r;
  };
  return bind;
}
function diagnose(ix, fm, b, v, tol, E2, tolDays, concepts = fm.concepts) {
  const { twin } = ix;
  const bv = Math.abs(b.value);
  if (bv !== 0) {
    for (const k of [3, 6, 9]) for (const r of [10 ** k, 10 ** -k]) if (Math.abs(v / bv - r) <= 1e-3 * r) return { diagnosis: "SCALE", matches: [] };
  }
  const equal = [];
  for (let k = Math.round(v) - 1; k <= Math.round(v) + 1; k++) for (const f of ix.byMagnitude.get(k) ?? []) if (Math.abs(Math.abs(f.value) - v) <= tol && usdOf(twin, f)) equal.push(f);
  equal.sort((a, c) => a.span.start - c.span.start);
  const ctx = (f) => twin.contexts.get(f.contextRef);
  const own = (f) => isUsGaap(f) && concepts.includes(f.concept);
  const inPeriod = (f) => periodMatch(ctx(f), fm.period, E2, tolDays);
  const pick = (fs) => fs.slice(0, 3).map((f) => ref(twin, f));
  const period = equal.filter((f) => own(f) && !ctx(f).dimensional && periodKey(ctx(f)) !== b.period);
  if (period.length) return { diagnosis: "PERIOD", matches: pick(period) };
  const concept = equal.filter((f) => !ctx(f).dimensional && inPeriod(f) && !(isUsGaap(f) && f.concept === b.concept));
  if (concept.length) return { diagnosis: "CONCEPT", matches: pick(concept) };
  const dim = equal.filter((f) => own(f) && ctx(f).dimensional && inPeriod(f));
  if (dim.length) return { diagnosis: "DIMENSION", matches: pick(dim) };
  return { diagnosis: "UNLOCATED", matches: [] };
}
var INSUFFICIENCY = {
  NO_TWIN: "REFERENCE_NOT_PROVIDED",
  FIELD_NOT_MAPPED: "OUT_OF_RULESET_SCOPE",
  PERIOD_UNRESOLVED: "REFERENCE_NOT_PROVIDED",
  NO_BINDING_FACT: "REFERENCE_NOT_PROVIDED",
  NO_USD_FACT: "AMBIGUOUS_UNIT",
  CONFLICTING_FACTS: "AMBIGUOUS_REFERENCE",
  VALUE_UNPARSEABLE: "UNPARSEABLE",
  NO_PRESENTATION_LINKBASE: "REFERENCE_NOT_PROVIDED",
  NO_STATEMENT_ROLES: "REFERENCE_NOT_PROVIDED",
  NOT_ON_STATEMENT: "REFERENCE_NOT_PROVIDED",
  ROUNDED_BINDING: "AMBIGUOUS_REFERENCE",
  AMBIGUOUS_LINE: "AMBIGUOUS_REFERENCE"
};
function twinVerdictInput(twinSha256, claims, opts) {
  const map = opts.map ?? FS_CORE_TWIN_MAP;
  const input = {
    twin_sha256: twinSha256,
    period_end: opts.periodEnd,
    period_tolerance_days: opts.periodToleranceDays ?? 7,
    tolerance: opts.tolerance ?? 0.5,
    map: `${map.id}@${map.version}`,
    claims: claims.map((c) => ({ id: c.id, field: c.field, value: Number.isFinite(c.value) ? c.value : null }))
  };
  return (map.binding ?? "document") === "statement" ? { ...input, presentation_sha256: opts.presentation?.sha256 ?? null } : input;
}
function factEvidence(twinSha, b, format) {
  return [
    {
      locator: { kind: "span", source_hash: twinSha, start: b.span.start, end: b.span.end },
      value: b.value,
      original: b.displayed,
      normalizations: [`ix:scale=${b.scale}`, ...b.sign === -1 ? ["ix:sign=-"] : [], `ix:format=${format || "none"}`],
      confidence: 100,
      role: "REFERENCE"
    },
    { locator: { kind: "field", source: "evidence", path: `contexts["${b.context}"]` }, value: b.period, confidence: 100, role: "CONTEXT" }
  ];
}
function verifyAgainstTwin(twin, claims, opts) {
  const tw = typeof twin === "string" ? parseInlineXbrl(twin) : twin;
  const ix = indexed(tw);
  const map = opts.map ?? FS_CORE_TWIN_MAP;
  const tol = opts.tolerance ?? 0.5;
  const tolDays = opts.periodToleranceDays ?? 7;
  const E2 = ms(opts.periodEnd);
  if (!Number.isFinite(E2)) throw new RangeError(`periodEnd must be YYYY-MM-DD (got ${JSON.stringify(opts.periodEnd)})`);
  const gate = twinGate(tw, opts.periodEnd, tolDays);
  const statementMode = (map.binding ?? "document") === "statement";
  const decimalsMode = (map.matching ?? "exact") === "decimals";
  const st = statementAnchor(map, opts.presentation);
  const fam = (map.family ?? "map") === "scope-variants" && st.anchor ? familyBinder(ix, map, E2, tolDays, st.anchor, tol) : null;
  const scaleAnchored = (map.scale ?? "diagnose") === "anchored" && st.anchor !== null;
  const formatAt = new Map(tw.facts.map((f) => [f.span.start, f.format]));
  const judgments = [], out = [];
  for (const c of claims) {
    const fm = map.fields.find((f) => f.field === c.field);
    const base = {
      claim_id: `${c.id}.twin`,
      kind: "CROSS_REFERENCE",
      tier: "DETERMINISTIC",
      field: c.field,
      asserted: Number.isFinite(c.value) ? c.value : null,
      rule_id: "TWIN_FACT",
      rule_name: "Extracted value equals the filing's binding XBRL fact",
      locked: false
    };
    const abstain = (reason, detail, binding, candidates) => {
      judgments.push({ claim_id: c.id, field: c.field, cell: fm?.cell ?? null, value: c.value, outcome: "ABSTAIN", reason, detail, ...binding ? { binding } : {}, ...candidates ? { candidates } : {} });
      out.push({ ...base, outcome: "INSUFFICIENT_DATA", evidence: [], insufficiency: { reason: INSUFFICIENCY[reason], detail: `${reason}: ${detail}` }, explanation: `${c.field}: ${detail}; abstaining.` });
    };
    if (!Number.isFinite(c.value)) {
      abstain("VALUE_UNPARSEABLE", `the asserted value ${JSON.stringify(String(c.value))} is not a finite number`);
      continue;
    }
    if (!fm) {
      abstain("FIELD_NOT_MAPPED", `the map ${map.id}@${map.version} does not define "${c.field}"`);
      continue;
    }
    if (!gate) {
      abstain("NO_TWIN", `the twin (sha256 ${tw.sha256.slice(0, 12)}\u2026) has no non-dimensional USD fact dated within ${tolDays} days of ${opts.periodEnd}`);
      continue;
    }
    if (st.abstain) {
      abstain(st.abstain.reason, st.abstain.detail);
      continue;
    }
    const { result: b, group } = fam ? fam(fm) : statementMode ? bindFieldGroup(ix, fm, E2, tolDays, st.anchor) : { result: bindField3(ix, fm, E2, tolDays), group: [] };
    if (!b.bound) {
      if (scaleAnchored && (b.reason === "NOT_ON_STATEMENT" || b.reason === "AMBIGUOUS_LINE")) {
        const v2 = Math.abs(c.value);
        const hit = b.reason === "AMBIGUOUS_LINE" ? (b.candidates ?? []).map((l) => ({ k: exactScale(v2, l, tol), fact: l, face: void 0 })).find((x) => x.k !== null) : valueAnchors(ix, twinFieldConcepts(map, fm), fm, E2, tolDays, st.anchor, tol).map((a) => ({ k: exactScale(v2, a.face, tol) ?? exactScale(v2, a.fact, tol), fact: { ...ref(tw, a.fact), duplicates: a.duplicates }, face: ref(tw, a.face) })).find((x) => x.k !== null);
        if (hit) {
          const f = hit.fact;
          const signOk2 = c.value === 0 || f.value === 0 || Math.sign(c.value) === Math.sign(f.value);
          const at3 = (r) => `${r.concept} @ ${r.period} ("${r.displayed}" \xD7 10^${r.scale}${r.sign === -1 ? ", sign \u2212" : ""} = ${r.value})`;
          const how = hit.face ? `value-anchored: the field's concept reports ${at3(f)} off the face statements, and the face statement prints it as ${at3(hit.face)}` : `a face line of the field's concept family, ${at3(f)}; ${b.detail}`;
          const why2 = `off by a power of ten (${c.value} is exactly 10^${hit.k} \xD7 ${f.value})`;
          const ev2 = factEvidence(tw.sha256, f, formatAt.get(f.span.start) ?? "");
          ev2[0].normalizations.push("twin:statement-anchored", hit.face ? "twin:value-anchored" : "twin:family-line");
          if (hit.face) ev2.push({ locator: { kind: "span", source_hash: tw.sha256, start: hit.face.span.start, end: hit.face.span.end }, value: hit.face.value, original: hit.face.displayed, confidence: 100, role: "CONTEXT" });
          const computation2 = { formula: "|value| = |fact| (fact = sign \xD7 displayed \xD7 10^scale)", operands: { fact: f.value, displayed: f.displayed, scale: f.scale }, result: f.value, tolerance: { abs: tol } };
          judgments.push({
            claim_id: c.id,
            field: c.field,
            cell: fm.cell,
            value: c.value,
            outcome: "FAIL",
            reason: "MISMATCH",
            detail: `${why2}; ${how}`,
            binding: f,
            diagnosis: "SCALE",
            ...hit.face ? { anchor: hit.face } : { candidates: b.candidates },
            sign_matches_xbrl: signOk2
          });
          out.push({ ...base, outcome: "FAIL", evidence: ev2, computation: computation2, variance: v2 - Math.abs(f.value), explanation: `${c.field} = ${c.value}: ${why2}; ${how}. [SCALE]` });
          continue;
        }
      }
      abstain(b.reason, b.detail, void 0, b.candidates);
      continue;
    }
    const bind = b.binding;
    const v = Math.abs(c.value), bv = Math.abs(bind.value);
    const signOk = c.value === 0 || bind.value === 0 || Math.sign(c.value) === Math.sign(bind.value);
    const where = `${bind.concept} @ ${bind.period} ("${bind.displayed}" \xD7 10^${bind.scale}${bind.sign === -1 ? ", sign \u2212" : ""} = ${bind.value})`;
    const dup = decimalsMode && Math.abs(v - bv) > tol ? group.find((f) => Math.abs(v - Math.abs(f.value)) <= tol) : void 0;
    const shown2 = dup ? ref(tw, dup) : bind;
    const ev = factEvidence(tw.sha256, shown2, formatAt.get(shown2.span.start) ?? "");
    if (statementMode) ev[0].normalizations.push("twin:statement-anchored");
    const computation = { formula: "|value| = |fact| (fact = sign \xD7 displayed \xD7 10^scale)", operands: { fact: shown2.value, displayed: shown2.displayed, scale: shown2.scale }, result: shown2.value, tolerance: { abs: tol } };
    if (Math.abs(v - bv) <= tol || dup) {
      const asDup = dup ? `; matched as reported to decimals ${dup.decimals === null ? "none" : dup.decimals} ("${dup.displayed}" \xD7 10^${dup.scale} = ${dup.value}), a consistent duplicate` : "";
      judgments.push({ claim_id: c.id, field: c.field, cell: fm.cell, value: c.value, outcome: "PASS", reason: "MATCH", detail: `equals the binding fact ${where}${asDup}`, binding: bind, sign_matches_xbrl: signOk });
      out.push({
        ...base,
        outcome: "PASS",
        locked: true,
        evidence: ev,
        computation,
        explanation: `${c.field} = ${c.value}: the filing's binding fact is ${where}${asDup}.${signOk ? "" : " (Sign differs from the XBRL value; sign is not judged.)"}`
      });
      continue;
    }
    const alt = b.alternatives?.find((a) => Math.abs(v - Math.abs(a.value)) <= halfUnit(a.decimals, tol) + 1e-9);
    if (alt) {
      abstain("AMBIGUOUS_LINE", `${c.value} is ${alt.concept} @ ${alt.period}, a face line of the field's concept family, but the statement's cash roll closes on ${where}`, bind, b.alternatives);
      continue;
    }
    if (decimalsMode && bind.decimals !== null && Number.isFinite(bind.decimals) && Math.abs(v - bv) <= 0.5 * 10 ** -bind.decimals + 1e-9) {
      abstain("ROUNDED_BINDING", `the binding fact ${where} is reported only to decimals ${bind.decimals} (\xB1 ${0.5 * 10 ** -bind.decimals}); ${c.value} is consistent with it at that precision but equals none of its reported figures`, bind);
      continue;
    }
    const d = fam ? diagnose(ix, fm, bind, v, tol, E2, tolDays, twinFieldConcepts(map, fm)) : diagnose(ix, fm, bind, v, tol, E2, tolDays);
    const why = d.diagnosis === "SCALE" ? `off by a power of ten (${c.value} vs ${bind.value})` : d.diagnosis === "PERIOD" ? `it is ${d.matches[0].concept} for ${d.matches[0].period}, another period` : d.diagnosis === "CONCEPT" ? `it is ${d.matches.map((m) => m.concept).join(" / ")} in the period, another concept` : d.diagnosis === "DIMENSION" ? `it is a dimensional (segment / member) fact of the concept, not the consolidated figure` : "the twin reports that magnitude nowhere";
    judgments.push({ claim_id: c.id, field: c.field, cell: fm.cell, value: c.value, outcome: "FAIL", reason: "MISMATCH", detail: `${why}; the binding fact is ${where}`, binding: bind, diagnosis: d.diagnosis, ...d.matches.length ? { matches: d.matches } : {}, sign_matches_xbrl: signOk });
    out.push({
      ...base,
      outcome: "FAIL",
      evidence: [...ev, ...d.matches.map((m) => ({ locator: { kind: "span", source_hash: tw.sha256, start: m.span.start, end: m.span.end }, value: m.value, original: m.displayed, confidence: 100, role: "CONTEXT" }))],
      computation,
      variance: v - bv,
      explanation: `${c.field} = ${c.value}: ${why}. The filing's binding fact is ${where}. [${d.diagnosis}]`
    });
  }
  const coverage = { claims_total: out.length, claims_checked: 0, claims_pass: 0, claims_fail: 0, claims_insufficient: 0 };
  for (const c of out) {
    if (c.outcome === "PASS") coverage.claims_pass++;
    else if (c.outcome === "FAIL") coverage.claims_fail++;
    else coverage.claims_insufficient++;
  }
  coverage.claims_checked = coverage.claims_pass + coverage.claims_fail;
  const outcome = coverage.claims_fail > 0 ? "FAIL" : coverage.claims_checked === 0 ? "INSUFFICIENT_DATA" : "PASS";
  const input = twinVerdictInput(tw.sha256, claims, opts);
  const input_hash = hashOf(input);
  const ruleset = { id: map.id, version: map.version, domain: map.domain };
  const verdict = {
    schema_version: SCHEMA_VERSION,
    verdict_id: deriveVerdictId(input_hash, ruleset, ENGINE_VERSION),
    issued_at: (opts.now ?? (() => /* @__PURE__ */ new Date()))().toISOString(),
    engine_version: ENGINE_VERSION,
    ruleset,
    input_hash,
    replayable: true,
    document: { extraction_hash: hashOf(input.claims), ...opts.producer !== void 0 ? { producer: opts.producer } : {}, line_items: claims.length },
    references: { contract: false, evidence: statementMode ? 2 : 1, history: 0, source: true },
    outcome,
    aggregation: "ANY_FAIL_FAILS",
    claims: out,
    coverage
  };
  const p = opts.presentation;
  const presentation = p ? { sha256: p.sha256, source: p.source, statement_roles: p.statementRoles.length, statement_concepts: p.statementConcepts.length, ...p.links ? { links: p.links } : {} } : null;
  return { verdict, judgments, twin: { sha256: tw.sha256, facts: tw.facts.length, contexts: tw.contexts.size, gate, ...statementMode ? { presentation } : {} } };
}

// packages/verify/src/twin/presentation.ts
var US_GAAP_HREF = /(?:^|\/\/)(?:xbrl\.)?fasb\.org\/us-gaap\//i;
var PARENTHETICAL = /parenthetical/i;
function attr2(attrs, name) {
  const m = attrs.match(new RegExp(`(?:^|\\s)${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"));
  return m ? decodeEntities(m[1] ?? m[2] ?? "") : void 0;
}
var inner = (body, tag) => {
  const m = body.match(new RegExp(`<(?:[A-Za-z_][\\w.-]*:)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:[A-Za-z_][\\w.-]*:)?${tag}\\s*>`, "i"));
  return m ? decodeEntities(m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")).trim() : void 0;
};
function usGaapConcept(href) {
  const hash = href.indexOf("#");
  if (hash < 0) return "";
  const path = href.slice(0, hash), frag = href.slice(hash + 1);
  if (!US_GAAP_HREF.test(path)) return "";
  const m = frag.match(/^us-gaap_(.+)$/);
  return m ? m[1] : "";
}
var LINKS_V02 = /<((?:[A-Za-z_][\w.-]*:)?)presentationLink\b([^>]*)>([\s\S]*?)<\/\1presentationLink\s*>/g;
var LINKS_STRICT = /<((?:[A-Za-z_][\w.-]*:)?)presentationLink\b((?:[^>/]|\/(?!>))*)(?:\/>|>([\s\S]*?)<\/\1presentationLink\s*>)/g;
function readLinks(text, into, order, stats, strict) {
  for (const m of text.matchAll(strict ? LINKS_STRICT : LINKS_V02)) {
    const role = attr2(m[2], "xlink:role") ?? attr2(m[2], "role") ?? "";
    stats.links++;
    if (!into.has(role)) {
      into.set(role, /* @__PURE__ */ new Set());
      order.push(role);
    }
    const set = into.get(role);
    for (const l of (m[3] ?? "").matchAll(/<(?:[A-Za-z_][\w.-]*:)?loc\b([^>]*?)\/?>/g)) {
      stats.locs++;
      const c = usGaapConcept(attr2(l[1], "xlink:href") ?? "");
      if (c) set.add(c);
    }
  }
}
function readFilingSummary(xml) {
  const out = /* @__PURE__ */ new Map();
  for (const m of xml.matchAll(/<Report\b[^>]*>([\s\S]*?)<\/Report\s*>/g)) {
    const body = m[1];
    const role = inner(body, "Role");
    if (!role || out.has(role)) continue;
    const longName = inner(body, "LongName") ?? "";
    const shortName = inner(body, "ShortName") ?? "";
    const menu = inner(body, "MenuCategory");
    const statement = menu !== void 0 ? /^statements$/i.test(menu) : /\s-\s*Statement\s*-\s/i.test(longName);
    out.set(role, { name: longName || shortName, statement: statement && !PARENTHETICAL.test(`${longName} ${shortName}`) });
  }
  return out;
}
function readRoleTypes(text, into) {
  for (const m of text.matchAll(/<((?:[A-Za-z_][\w.-]*:)?)roleType\b([^>]*)>([\s\S]*?)<\/\1roleType\s*>/g)) {
    const role = attr2(m[2], "roleURI");
    const def = inner(m[3], "definition");
    if (role && def !== void 0 && !into.has(role)) into.set(role, def);
  }
}
function parseTwinPresentation(input, opts = {}) {
  const pre = input.pre ?? null, fs = input.filingSummary ?? null, schema = input.schema ?? null;
  const strict = opts.links === "strict";
  const links = /* @__PURE__ */ new Map(), order = [];
  const stats = { links: 0, locs: 0 };
  if (pre) readLinks(pre, links, order, stats, strict);
  if (schema) readLinks(schema, links, order, stats, strict);
  if (stats.links === 0) return null;
  const summary = fs ? readFilingSummary(fs) : /* @__PURE__ */ new Map();
  const defs = /* @__PURE__ */ new Map();
  if (schema) readRoleTypes(schema, defs);
  if (pre) readRoleTypes(pre, defs);
  const source = summary.size ? "filing-summary" : defs.size ? "role-definition" : "none";
  const roles = order.map((role) => {
    const concepts2 = links.get(role).size;
    if (source === "filing-summary") {
      const r = summary.get(role);
      const name2 = r?.name ?? defs.get(role) ?? "";
      return { role, name: name2, statement: r?.statement ?? false, parenthetical: PARENTHETICAL.test(name2), concepts: concepts2 };
    }
    const name = defs.get(role) ?? "";
    const parenthetical = PARENTHETICAL.test(name);
    return { role, name, statement: source === "role-definition" && /\s-\s*Statement\s*-\s/i.test(name) && !parenthetical, parenthetical, concepts: concepts2 };
  });
  const statementRoles = roles.filter((r) => r.statement).map((r) => r.role);
  const concepts = /* @__PURE__ */ new Set();
  for (const r of statementRoles) for (const c of links.get(r)) concepts.add(c);
  const inputs = { pre: pre === null ? null : sha256(pre), filingSummary: fs === null ? null : sha256(fs), schema: schema === null ? null : sha256(schema) };
  return {
    sha256: sha256(`twin-presentation|${strict ? "links:strict|" : ""}pre:${inputs.pre ?? "-"}|filing-summary:${inputs.filingSummary ?? "-"}|schema:${inputs.schema ?? "-"}`),
    inputs,
    source,
    roles,
    statementRoles,
    statementConcepts: [...concepts].sort(),
    stats,
    ...strict ? { links: "strict" } : {}
  };
}

// packages/verify/src/twin-einvoice/xml.ts
var XmlParseError = class extends Error {
  constructor(message2, offset) {
    super(`${message2} (at offset ${offset})`);
    this.offset = offset;
  }
  offset;
};
var NAME_START = /[A-Za-z_\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD]/;
var NAME_CHAR = /[\-.0-9:\u00B7\u0300-\u036F\u203F-\u2040A-Za-z_\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD]/;
var PREDEFINED = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };
var XML_NS = "http://www.w3.org/XML/1998/namespace";
function decode(raw, at3) {
  if (!raw.includes("&")) return raw;
  return raw.replace(/&([^;&\s]*);?/g, (m, body, off) => {
    if (!m.endsWith(";")) throw new XmlParseError(`unterminated entity reference "${m}"`, at3 + off);
    if (body.startsWith("#x") || body.startsWith("#X")) {
      const cp = /^[0-9a-fA-F]+$/.test(body.slice(2)) ? parseInt(body.slice(2), 16) : NaN;
      if (!Number.isFinite(cp) || cp > 1114111) throw new XmlParseError(`bad character reference "${m}"`, at3 + off);
      return String.fromCodePoint(cp);
    }
    if (body.startsWith("#")) {
      const cp = /^[0-9]+$/.test(body.slice(1)) ? parseInt(body.slice(1), 10) : NaN;
      if (!Number.isFinite(cp) || cp > 1114111) throw new XmlParseError(`bad character reference "${m}"`, at3 + off);
      return String.fromCodePoint(cp);
    }
    const v = PREDEFINED[body];
    if (v === void 0) throw new XmlParseError(`unknown entity "${m}" (DTD entities are not supported)`, at3 + off);
    return v;
  });
}
function parseXml(src) {
  let i = src.charCodeAt(0) === 65279 ? 1 : 0;
  const n = src.length;
  let root2 = null;
  const stack = [];
  const readName = () => {
    const s = i;
    if (i >= n || !NAME_START.test(src[i])) throw new XmlParseError("expected a name", i);
    i++;
    while (i < n && NAME_CHAR.test(src[i])) i++;
    return src.slice(s, i);
  };
  const skipWs = () => {
    while (i < n && (src[i] === " " || src[i] === "	" || src[i] === "\n" || src[i] === "\r")) i++;
  };
  const expect = (s) => {
    if (!src.startsWith(s, i)) throw new XmlParseError(`expected "${s}"`, i);
    i += s.length;
  };
  const resolve2 = (prefix, scope, isAttr, at3) => {
    if (prefix === "xml") return XML_NS;
    if (prefix === "") return isAttr ? "" : scope.get("") ?? "";
    const u = scope.get(prefix);
    if (u === void 0) throw new XmlParseError(`unbound namespace prefix "${prefix}"`, at3);
    return u;
  };
  while (i < n) {
    const lt = src.indexOf("<", i);
    const textEnd = lt < 0 ? n : lt;
    if (textEnd > i) {
      const raw = src.slice(i, textEnd);
      if (stack.length) stack[stack.length - 1].textParts.push(decode(raw, i));
      else if (raw.trim() !== "") throw new XmlParseError("character data outside the root element", i);
      i = textEnd;
      continue;
    }
    if (src.startsWith("<!--", i)) {
      const e = src.indexOf("-->", i + 4);
      if (e < 0) throw new XmlParseError("unterminated comment", i);
      i = e + 3;
      continue;
    }
    if (src.startsWith("<![CDATA[", i)) {
      if (!stack.length) throw new XmlParseError("CDATA outside the root element", i);
      const e = src.indexOf("]]>", i + 9);
      if (e < 0) throw new XmlParseError("unterminated CDATA section", i);
      stack[stack.length - 1].textParts.push(src.slice(i + 9, e));
      i = e + 3;
      continue;
    }
    if (src.startsWith("<!", i)) throw new XmlParseError("DOCTYPE / markup declarations are not accepted (no DTD, no entity expansion)", i);
    if (src.startsWith("<?", i)) {
      const e = src.indexOf("?>", i + 2);
      if (e < 0) throw new XmlParseError("unterminated processing instruction", i);
      i = e + 2;
      continue;
    }
    if (src.startsWith("</", i)) {
      const at4 = i;
      i += 2;
      const name = readName();
      skipWs();
      expect(">");
      const top = stack.pop();
      if (!top) throw new XmlParseError(`unexpected end tag </${name}>`, at4);
      if (top.el.qname !== name) throw new XmlParseError(`end tag </${name}> does not match <${top.el.qname}>`, at4);
      top.el.text = top.textParts.join("");
      top.el.inner.end = at4;
      top.el.span.end = i;
      continue;
    }
    const at3 = i;
    if (root2 && !stack.length) throw new XmlParseError("content after the root element", at3);
    i++;
    const qname = readName();
    const rawAttrs = [];
    for (; ; ) {
      const before = i;
      skipWs();
      if (src.startsWith("/>", i) || src[i] === ">") break;
      if (i === before) throw new XmlParseError(`expected whitespace before an attribute in <${qname}>`, i);
      const aAt = i;
      const aName = readName();
      skipWs();
      expect("=");
      skipWs();
      const q = src[i];
      if (q !== '"' && q !== "'") throw new XmlParseError(`attribute ${aName} value must be quoted`, i);
      const e = src.indexOf(q, i + 1);
      if (e < 0) throw new XmlParseError(`unterminated attribute ${aName}`, i);
      const rawV = src.slice(i + 1, e);
      if (rawV.includes("<")) throw new XmlParseError(`"<" in attribute ${aName}`, i);
      if (rawAttrs.some((a) => a.name === aName)) throw new XmlParseError(`duplicate attribute ${aName}`, aAt);
      rawAttrs.push({ name: aName, value: decode(rawV, i + 1), at: aAt });
      i = e + 1;
    }
    const selfClose = src.startsWith("/>", i);
    i += selfClose ? 2 : 1;
    const parentScope = stack.length ? stack[stack.length - 1].scope : /* @__PURE__ */ new Map();
    let scope = parentScope;
    const attrs = {};
    for (const a of rawAttrs) {
      if (a.name === "xmlns" || a.name.startsWith("xmlns:")) {
        if (scope === parentScope) scope = new Map(parentScope);
        scope.set(a.name === "xmlns" ? "" : a.name.slice(6), a.value);
      }
    }
    for (const a of rawAttrs) {
      if (a.name === "xmlns" || a.name.startsWith("xmlns:")) continue;
      const c2 = a.name.indexOf(":");
      if (c2 > 0) resolve2(a.name.slice(0, c2), scope, true, a.at);
      attrs[a.name] = a.value;
    }
    const c = qname.indexOf(":");
    const el = {
      local: c > 0 ? qname.slice(c + 1) : qname,
      ns: resolve2(c > 0 ? qname.slice(0, c) : "", scope, false, at3),
      qname,
      attrs,
      children: [],
      parent: stack.length ? stack[stack.length - 1].el : null,
      text: "",
      span: { start: at3, end: i },
      inner: { start: i, end: i }
    };
    if (el.parent) el.parent.children.push(el);
    else root2 = el;
    if (!selfClose) stack.push({ el, scope, textParts: [] });
  }
  if (stack.length) throw new XmlParseError(`unclosed element <${stack[stack.length - 1].el.qname}>`, n);
  if (!root2) throw new XmlParseError("no root element", 0);
  return root2;
}
function kids(el, ns, local) {
  return el.children.filter((c) => c.local === local && c.ns === ns);
}
function positionOf(el) {
  if (!el.parent) return { index: 1, of: 1 };
  const same = el.parent.children.filter((c) => c.local === el.local && c.ns === el.ns);
  return { index: same.indexOf(el) + 1, of: same.length };
}

// packages/verify/src/twin-einvoice/map.ts
var UBL_NS = {
  inv: "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2",
  cac: "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
  cbc: "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
};
var KSEF_NS = "http://crd.gov.pl/wzor/2025/06/25/13775/";
function walk(from, steps, ns) {
  let cur = from;
  for (const s of steps) {
    if (typeof s === "function") {
      cur = cur.flatMap(s);
      continue;
    }
    const c = s.indexOf(":");
    const uri = c > 0 ? ns[s.slice(0, c)] : "";
    if (uri === void 0) throw new Error(`map: unknown prefix in step ${s}`);
    const local = c > 0 ? s.slice(c + 1) : s;
    cur = cur.flatMap((e) => kids(e, uri, local));
  }
  return cur;
}
var ubl = (...steps) => (root2) => walk([root2], steps, UBL_NS);
var ksef = (...steps) => (root2) => walk([root2], steps, { k: KSEF_NS });
var norm = (s) => s.replace(/\s+/g, " ").trim();
var taxSchemeId = (pts) => norm(walk([pts], ["cac:TaxScheme", "cbc:ID"], UBL_NS)[0]?.text ?? "").toUpperCase();
var vatScheme = (want) => (party) => kids(party, UBL_NS.cac, "PartyTaxScheme").filter((p) => taxSchemeId(p) === "VAT" === want);
var taxTotal = (withSubtotal) => (root2) => kids(root2, UBL_NS.cac, "TaxTotal").filter((t) => kids(t, UBL_NS.cac, "TaxSubtotal").length > 0 === withSubtotal);
var SUPPLIER = ["cac:AccountingSupplierParty", "cac:Party"];
var CUSTOMER = ["cac:AccountingCustomerParty", "cac:Party"];
var LMT = "cac:LegalMonetaryTotal";
var doc2 = (f) => ({ scope: "document", ...f });
var line2 = (f) => ({ ...f, scope: "line" });
var vbd = (f) => ({ ...f, scope: "vat_breakdown" });
function ublCore(src, lineX) {
  return [
    doc2({ field: "invoice_number", term: "BT-1", name: "Invoice number", xpath: "/Invoice/cbc:ID", kind: "identifier", source: src, select: ubl("cbc:ID") }),
    doc2({ field: "issue_date", term: "BT-2", name: "Invoice issue date", xpath: "/Invoice/cbc:IssueDate", kind: "date", source: src, select: ubl("cbc:IssueDate") }),
    doc2({ field: "invoice_type_code", term: "BT-3", name: "Invoice type code", xpath: "/Invoice/cbc:InvoiceTypeCode", kind: "code", source: src, select: ubl("cbc:InvoiceTypeCode") }),
    doc2({ field: "currency", term: "BT-5", name: "Invoice currency code", xpath: "/Invoice/cbc:DocumentCurrencyCode", kind: "code", source: src, select: ubl("cbc:DocumentCurrencyCode") }),
    doc2({ field: "tax_currency", term: "BT-6", name: "VAT accounting currency code", xpath: "/Invoice/cbc:TaxCurrencyCode", kind: "code", source: src, select: ubl("cbc:TaxCurrencyCode") }),
    doc2({ field: "purchase_order_reference", term: "BT-13", name: "Purchase order reference", xpath: "/Invoice/cac:OrderReference/cbc:ID", kind: "identifier", source: src, select: ubl("cac:OrderReference", "cbc:ID") }),
    doc2({ field: "contract_reference", term: "BT-12", name: "Contract reference", xpath: "/Invoice/cac:ContractDocumentReference/cbc:ID", kind: "identifier", source: src, select: ubl("cac:ContractDocumentReference", "cbc:ID") }),
    doc2({ field: "seller_name", term: "BT-27", name: "Seller name", xpath: "/Invoice/cac:AccountingSupplierParty/cac:Party/cac:PartyLegalEntity/cbc:RegistrationName", kind: "text", source: src, select: ubl(...SUPPLIER, "cac:PartyLegalEntity", "cbc:RegistrationName"), counterpart: "buyer_name" }),
    doc2({ field: "seller_vat_id", term: "BT-31", name: "Seller VAT identifier", xpath: "/Invoice/cac:AccountingSupplierParty/cac:Party/cac:PartyTaxScheme[cac:TaxScheme/cbc:ID='VAT']/cbc:CompanyID", kind: "identifier", source: src, select: ubl(...SUPPLIER, vatScheme(true), "cbc:CompanyID"), counterpart: "buyer_vat_id" }),
    doc2({ field: "buyer_name", term: "BT-44", name: "Buyer name", xpath: "/Invoice/cac:AccountingCustomerParty/cac:Party/cac:PartyLegalEntity/cbc:RegistrationName", kind: "text", source: src, select: ubl(...CUSTOMER, "cac:PartyLegalEntity", "cbc:RegistrationName"), counterpart: "seller_name" }),
    doc2({ field: "buyer_vat_id", term: "BT-48", name: "Buyer VAT identifier", xpath: "/Invoice/cac:AccountingCustomerParty/cac:Party/cac:PartyTaxScheme[cac:TaxScheme/cbc:ID='VAT']/cbc:CompanyID", kind: "identifier", source: src, select: ubl(...CUSTOMER, vatScheme(true), "cbc:CompanyID"), counterpart: "seller_vat_id" }),
    doc2({ field: "sum_of_line_net_amount", term: "BT-106", name: "Sum of Invoice line net amount", xpath: `/Invoice/${LMT}/cbc:LineExtensionAmount`, kind: "amount", source: src, select: ubl(LMT, "cbc:LineExtensionAmount") }),
    doc2({ field: "allowance_total_amount", term: "BT-107", name: "Sum of allowances on document level", xpath: `/Invoice/${LMT}/cbc:AllowanceTotalAmount`, kind: "amount", source: src, select: ubl(LMT, "cbc:AllowanceTotalAmount") }),
    doc2({ field: "charge_total_amount", term: "BT-108", name: "Sum of charges on document level", xpath: `/Invoice/${LMT}/cbc:ChargeTotalAmount`, kind: "amount", source: src, select: ubl(LMT, "cbc:ChargeTotalAmount") }),
    doc2({ field: "tax_exclusive_amount", term: "BT-109", name: "Invoice total amount without VAT", xpath: `/Invoice/${LMT}/cbc:TaxExclusiveAmount`, kind: "amount", source: src, select: ubl(LMT, "cbc:TaxExclusiveAmount") }),
    doc2({ field: "tax_amount", term: "BT-110", name: "Invoice total VAT amount", xpath: "/Invoice/cac:TaxTotal[cac:TaxSubtotal]/cbc:TaxAmount", kind: "amount", source: src, select: ubl(taxTotal(true), "cbc:TaxAmount") }),
    doc2({ field: "tax_amount_accounting_currency", term: "BT-111", name: "Invoice total VAT amount in accounting currency", xpath: "/Invoice/cac:TaxTotal[not(cac:TaxSubtotal)]/cbc:TaxAmount", kind: "amount", source: src, select: ubl(taxTotal(false), "cbc:TaxAmount") }),
    doc2({ field: "tax_inclusive_amount", term: "BT-112", name: "Invoice total amount with VAT", xpath: `/Invoice/${LMT}/cbc:TaxInclusiveAmount`, kind: "amount", source: src, select: ubl(LMT, "cbc:TaxInclusiveAmount") }),
    doc2({ field: "prepaid_amount", term: "BT-113", name: "Paid amount", xpath: `/Invoice/${LMT}/cbc:PrepaidAmount`, kind: "amount", source: src, select: ubl(LMT, "cbc:PrepaidAmount") }),
    doc2({ field: "rounding_amount", term: "BT-114", name: "Rounding amount", xpath: `/Invoice/${LMT}/cbc:PayableRoundingAmount`, kind: "amount", source: src, select: ubl(LMT, "cbc:PayableRoundingAmount") }),
    doc2({ field: "payable_amount", term: "BT-115", name: "Amount due for payment", xpath: `/Invoice/${LMT}/cbc:PayableAmount`, kind: "amount", source: src, select: ubl(LMT, "cbc:PayableAmount") }),
    line2({ field: "id", term: "BT-126", name: "Invoice line identifier", xpath: `${lineX}/cbc:ID`, kind: "identifier", source: src, select: ubl("cbc:ID") }),
    line2({ field: "quantity", term: "BT-129", name: "Invoiced quantity", xpath: `${lineX}/cbc:InvoicedQuantity`, kind: "quantity", source: src, select: ubl("cbc:InvoicedQuantity") }),
    line2({ field: "net_amount", term: "BT-131", name: "Invoice line net amount", xpath: `${lineX}/cbc:LineExtensionAmount`, kind: "amount", source: src, select: ubl("cbc:LineExtensionAmount") }),
    line2({ field: "price", term: "BT-146", name: "Item net price", xpath: `${lineX}/cac:Price/cbc:PriceAmount`, kind: "amount", source: src, select: ubl("cac:Price", "cbc:PriceAmount") }),
    line2({ field: "base_quantity", term: "BT-149", name: "Item price base quantity", xpath: `${lineX}/cac:Price/cbc:BaseQuantity`, kind: "quantity", source: src, select: ubl("cac:Price", "cbc:BaseQuantity") }),
    line2({ field: "item_name", term: "BT-153", name: "Item name", xpath: `${lineX}/cac:Item/cbc:Name`, kind: "text", source: src, select: ubl("cac:Item", "cbc:Name") }),
    line2({ field: "vat_category", term: "BT-151", name: "Invoiced item VAT category code", xpath: `${lineX}/cac:Item/cac:ClassifiedTaxCategory/cbc:ID`, kind: "code", source: src, select: ubl("cac:Item", "cac:ClassifiedTaxCategory", "cbc:ID") }),
    line2({ field: "vat_rate", term: "BT-152", name: "Invoiced item VAT rate", xpath: `${lineX}/cac:Item/cac:ClassifiedTaxCategory/cbc:Percent`, kind: "rate", source: src, select: ubl("cac:Item", "cac:ClassifiedTaxCategory", "cbc:Percent") }),
    vbd({ field: "taxable_amount", term: "BT-116", name: "VAT category taxable amount", xpath: "/Invoice/cac:TaxTotal[cac:TaxSubtotal]/cac:TaxSubtotal/cbc:TaxableAmount", kind: "amount", source: src, select: ubl("cbc:TaxableAmount") }),
    vbd({ field: "tax_amount", term: "BT-117", name: "VAT category tax amount", xpath: "/Invoice/cac:TaxTotal[cac:TaxSubtotal]/cac:TaxSubtotal/cbc:TaxAmount", kind: "amount", source: src, select: ubl("cbc:TaxAmount") }),
    vbd({ field: "category", term: "BT-118", name: "VAT category code", xpath: "/Invoice/cac:TaxTotal[cac:TaxSubtotal]/cac:TaxSubtotal/cac:TaxCategory/cbc:ID", kind: "code", source: src, select: ubl("cac:TaxCategory", "cbc:ID") }),
    vbd({ field: "rate", term: "BT-119", name: "VAT category rate", xpath: "/Invoice/cac:TaxTotal[cac:TaxSubtotal]/cac:TaxSubtotal/cac:TaxCategory/cbc:Percent", kind: "rate", source: src, select: ubl("cac:TaxCategory", "cbc:Percent") })
  ];
}
var PEPPOL_LINE = "/Invoice/cac:InvoiceLine";
var PEPPOL_BIS3_MAP = {
  id: "twin-einvoice-peppol-bis3",
  version: "0.3.0",
  domain: "e-invoice",
  profile: "peppol-bis3",
  namespaces: { ...UBL_NS },
  lineXpath: PEPPOL_LINE,
  vatBreakdownXpath: "/Invoice/cac:TaxTotal[cac:TaxSubtotal]/cac:TaxSubtotal",
  fields: [
    ...ublCore("PEPPOL-SYNTAX", PEPPOL_LINE),
    doc2({ field: "due_date", term: "BT-9", name: "Payment due date", xpath: "/Invoice/cbc:DueDate", kind: "date", source: "PEPPOL-SYNTAX", select: ubl("cbc:DueDate") }),
    doc2({ field: "tax_point_date", term: "BT-7", name: "Value added tax point date", xpath: "/Invoice/cbc:TaxPointDate", kind: "date", source: "PEPPOL-SYNTAX", select: ubl("cbc:TaxPointDate") }),
    doc2({ field: "buyer_reference", term: "BT-10", name: "Buyer reference", xpath: "/Invoice/cbc:BuyerReference", kind: "identifier", source: "PEPPOL-SYNTAX", select: ubl("cbc:BuyerReference") }),
    doc2({ field: "delivery_date", term: "BT-72", name: "Actual delivery date", xpath: "/Invoice/cac:Delivery/cbc:ActualDeliveryDate", kind: "date", source: "PEPPOL-SYNTAX", select: ubl("cac:Delivery", "cbc:ActualDeliveryDate") }),
    doc2({ field: "seller_trading_name", term: "BT-28", name: "Seller trading name", xpath: "/Invoice/cac:AccountingSupplierParty/cac:Party/cac:PartyName/cbc:Name", kind: "text", source: "PEPPOL-SYNTAX", select: ubl(...SUPPLIER, "cac:PartyName", "cbc:Name"), counterpart: "buyer_trading_name" }),
    doc2({ field: "buyer_trading_name", term: "BT-45", name: "Buyer trading name", xpath: "/Invoice/cac:AccountingCustomerParty/cac:Party/cac:PartyName/cbc:Name", kind: "text", source: "PEPPOL-SYNTAX", select: ubl(...CUSTOMER, "cac:PartyName", "cbc:Name"), counterpart: "seller_trading_name" }),
    doc2({ field: "seller_tax_registration_id", term: "BT-32", name: "Seller tax registration identifier", xpath: "/Invoice/cac:AccountingSupplierParty/cac:Party/cac:PartyTaxScheme[cac:TaxScheme/cbc:ID!='VAT']/cbc:CompanyID", kind: "identifier", source: "PEPPOL-SYNTAX", select: ubl(...SUPPLIER, vatScheme(false), "cbc:CompanyID") }),
    doc2({ field: "seller_legal_registration_id", term: "BT-30", name: "Seller legal registration identifier", xpath: "/Invoice/cac:AccountingSupplierParty/cac:Party/cac:PartyLegalEntity/cbc:CompanyID", kind: "identifier", source: "PEPPOL-SYNTAX", select: ubl(...SUPPLIER, "cac:PartyLegalEntity", "cbc:CompanyID"), counterpart: "buyer_legal_registration_id" }),
    doc2({ field: "buyer_legal_registration_id", term: "BT-47", name: "Buyer legal registration identifier", xpath: "/Invoice/cac:AccountingCustomerParty/cac:Party/cac:PartyLegalEntity/cbc:CompanyID", kind: "identifier", source: "PEPPOL-SYNTAX", select: ubl(...CUSTOMER, "cac:PartyLegalEntity", "cbc:CompanyID"), counterpart: "seller_legal_registration_id" }),
    doc2({ field: "seller_electronic_address", term: "BT-34", name: "Seller electronic address", xpath: "/Invoice/cac:AccountingSupplierParty/cac:Party/cbc:EndpointID", kind: "identifier", source: "PEPPOL-SYNTAX", select: ubl(...SUPPLIER, "cbc:EndpointID"), counterpart: "buyer_electronic_address" }),
    doc2({ field: "buyer_electronic_address", term: "BT-49", name: "Buyer electronic address", xpath: "/Invoice/cac:AccountingCustomerParty/cac:Party/cbc:EndpointID", kind: "identifier", source: "PEPPOL-SYNTAX", select: ubl(...CUSTOMER, "cbc:EndpointID"), counterpart: "seller_electronic_address" })
  ]
};
var ZATCA_MAP = {
  id: "twin-einvoice-zatca-ksa",
  version: "0.3.0",
  domain: "e-invoice",
  profile: "zatca-ksa",
  namespaces: { ...UBL_NS },
  lineXpath: PEPPOL_LINE,
  vatBreakdownXpath: "/Invoice/cac:TaxTotal[cac:TaxSubtotal]/cac:TaxSubtotal",
  fields: [
    ...ublCore("ZATCA-DD", PEPPOL_LINE),
    doc2({ field: "uuid", term: "KSA-1", name: "Unique invoice identifier", xpath: "/Invoice/cbc:UUID", kind: "identifier", source: "ZATCA-DD", select: ubl("cbc:UUID") }),
    doc2({ field: "issue_time", term: "KSA-25", name: "Invoice issue time", xpath: "/Invoice/cbc:IssueTime", kind: "time", source: "ZATCA-DD", select: ubl("cbc:IssueTime") }),
    doc2({ field: "supply_date", term: "KSA-5", name: "Supply date (gregorian calendar)", xpath: "/Invoice/cac:Delivery/cbc:ActualDeliveryDate", kind: "date", source: "ZATCA-DD", select: ubl("cac:Delivery", "cbc:ActualDeliveryDate") }),
    doc2({ field: "supply_end_date", term: "KSA-24", name: "Supply end date", xpath: "/Invoice/cac:Delivery/cbc:LatestDeliveryDate", kind: "date", source: "ZATCA-DD", select: ubl("cac:Delivery", "cbc:LatestDeliveryDate") }),
    line2({ field: "vat_amount", term: "KSA-11", name: "VAT line amount", xpath: `${PEPPOL_LINE}/cac:TaxTotal/cbc:TaxAmount`, kind: "amount", source: "ZATCA-DD", select: ubl("cac:TaxTotal", "cbc:TaxAmount") }),
    line2({ field: "amount_with_vat", term: "KSA-12", name: "Line amount inclusive VAT", xpath: `${PEPPOL_LINE}/cac:TaxTotal/cbc:RoundingAmount`, kind: "amount", source: "ZATCA-DD", select: ubl("cac:TaxTotal", "cbc:RoundingAmount") })
  ]
};
var FA = ["k:Fa"];
var P1 = ["k:Podmiot1", "k:DaneIdentyfikacyjne"];
var P2 = ["k:Podmiot2", "k:DaneIdentyfikacyjne"];
var K_LINE = "/Faktura/Fa/FaWiersz";
var KSEF_BUCKETS = [
  { code: "P_13_1", name: "Suma warto\u015Bci sprzeda\u017Cy netto obj\u0119tej stawk\u0105 podstawow\u0105 (23% albo 22%)" },
  { code: "P_14_1", name: "Kwota podatku od sumy warto\u015Bci sprzeda\u017Cy netto obj\u0119tej stawk\u0105 podstawow\u0105" },
  { code: "P_14_1W", name: "Kwota podatku (stawka podstawowa) przeliczona na PLN (faktura w walucie obcej)" },
  { code: "P_13_2", name: "Suma warto\u015Bci sprzeda\u017Cy netto obj\u0119tej stawk\u0105 obni\u017Con\u0105 pierwsz\u0105 (8% albo 7%)" },
  { code: "P_14_2", name: "Kwota podatku od sumy warto\u015Bci sprzeda\u017Cy netto obj\u0119tej stawk\u0105 obni\u017Con\u0105 pierwsz\u0105" },
  { code: "P_14_2W", name: "Kwota podatku (stawka obni\u017Cona pierwsza) przeliczona na PLN" },
  { code: "P_13_3", name: "Suma warto\u015Bci sprzeda\u017Cy netto obj\u0119tej stawk\u0105 obni\u017Con\u0105 drug\u0105 (5%)" },
  { code: "P_14_3", name: "Kwota podatku od sumy warto\u015Bci sprzeda\u017Cy netto obj\u0119tej stawk\u0105 obni\u017Con\u0105 drug\u0105" },
  { code: "P_14_3W", name: "Kwota podatku (stawka obni\u017Cona druga) przeliczona na PLN" },
  { code: "P_13_4", name: "Suma warto\u015Bci sprzeda\u017Cy netto obj\u0119tej rycza\u0142tem dla taks\xF3wek osobowych" },
  { code: "P_14_4", name: "Kwota podatku (rycza\u0142t dla taks\xF3wek osobowych)" },
  { code: "P_14_4W", name: "Wysoko\u015B\u0107 rycza\u0142tu dla taks\xF3wek osobowych przeliczona na PLN" },
  { code: "P_13_5", name: "Suma warto\u015Bci sprzeda\u017Cy netto w procedurze szczeg\xF3lnej (dzia\u0142 XII rozdzia\u0142 6a)" },
  { code: "P_14_5", name: "Kwota podatku od warto\u015Bci dodanej w procedurze szczeg\xF3lnej (dzia\u0142 XII rozdzia\u0142 6a)" },
  { code: "P_13_6_1", name: "Suma warto\u015Bci sprzeda\u017Cy obj\u0119tej stawk\u0105 0% z wy\u0142\u0105czeniem WDT i eksportu" },
  { code: "P_13_6_2", name: "Suma warto\u015Bci sprzeda\u017Cy obj\u0119tej stawk\u0105 0% w przypadku WDT" },
  { code: "P_13_6_3", name: "Suma warto\u015Bci sprzeda\u017Cy obj\u0119tej stawk\u0105 0% w przypadku eksportu" },
  { code: "P_13_7", name: "Suma warto\u015Bci sprzeda\u017Cy zwolnionej od podatku" },
  { code: "P_13_8", name: "Suma warto\u015Bci sprzeda\u017Cy poza terytorium kraju" },
  { code: "P_13_9", name: "Suma warto\u015Bci \u015Bwiadczenia us\u0142ug z art. 100 ust. 1 pkt 4" },
  { code: "P_13_10", name: "Suma warto\u015Bci sprzeda\u017Cy w procedurze odwrotnego obci\u0105\u017Cenia" },
  { code: "P_13_11", name: "Suma warto\u015Bci sprzeda\u017Cy w procedurze mar\u017Cy" }
];
var KSEF_FA3_MAP = {
  id: "twin-einvoice-ksef-fa3",
  version: "0.3.0",
  domain: "e-invoice",
  profile: "ksef-fa3",
  namespaces: { k: KSEF_NS },
  lineXpath: K_LINE,
  vatBreakdownXpath: null,
  fields: [
    doc2({ field: "invoice_number", term: "P_2", name: "Kolejny numer faktury", xpath: "/Faktura/Fa/P_2", kind: "identifier", source: "KSEF-XSD", select: ksef(...FA, "k:P_2") }),
    doc2({ field: "issue_date", term: "P_1", name: "Data wystawienia", xpath: "/Faktura/Fa/P_1", kind: "date", source: "KSEF-XSD", select: ksef(...FA, "k:P_1") }),
    doc2({ field: "currency", term: "KodWaluty", name: "Kod waluty (ISO 4217)", xpath: "/Faktura/Fa/KodWaluty", kind: "code", source: "KSEF-XSD", select: ksef(...FA, "k:KodWaluty") }),
    doc2({ field: "supply_date", term: "P_6", name: "Data dokonania lub zako\u0144czenia dostawy towar\xF3w lub wykonania us\u0142ugi lub data otrzymania zap\u0142aty", xpath: "/Faktura/Fa/P_6", kind: "date", source: "KSEF-XSD", select: ksef(...FA, "k:P_6") }),
    doc2({ field: "seller_nip", term: "Podmiot1/NIP", name: "Identyfikator podatkowy NIP (sprzedawca)", xpath: "/Faktura/Podmiot1/DaneIdentyfikacyjne/NIP", kind: "identifier", source: "KSEF-XSD", select: ksef(...P1, "k:NIP"), counterpart: "buyer_nip" }),
    doc2({ field: "seller_name", term: "Podmiot1/Nazwa", name: "Imi\u0119 i nazwisko lub nazwa (sprzedawca)", xpath: "/Faktura/Podmiot1/DaneIdentyfikacyjne/Nazwa", kind: "text", source: "KSEF-XSD", select: ksef(...P1, "k:Nazwa"), counterpart: "buyer_name" }),
    doc2({ field: "buyer_nip", term: "Podmiot2/NIP", name: "Identyfikator podatkowy NIP (nabywca)", xpath: "/Faktura/Podmiot2/DaneIdentyfikacyjne/NIP", kind: "identifier", source: "KSEF-XSD", select: ksef(...P2, "k:NIP"), counterpart: "seller_nip" }),
    doc2({ field: "buyer_name", term: "Podmiot2/Nazwa", name: "Imi\u0119 i nazwisko lub nazwa (nabywca)", xpath: "/Faktura/Podmiot2/DaneIdentyfikacyjne/Nazwa", kind: "text", source: "KSEF-XSD", select: ksef(...P2, "k:Nazwa"), counterpart: "seller_name" }),
    ...KSEF_BUCKETS.map((b) => doc2({ field: b.code, term: b.code, name: b.name, xpath: `/Faktura/Fa/${b.code}`, kind: "amount", source: "KSEF-XSD", select: ksef(...FA, `k:${b.code}`) })),
    doc2({ field: "P_15", term: "P_15", name: "Kwota nale\u017Cno\u015Bci og\xF3\u0142em", xpath: "/Faktura/Fa/P_15", kind: "amount", source: "KSEF-XSD", select: ksef(...FA, "k:P_15") }),
    line2({ field: "number", term: "NrWierszaFa", name: "Kolejny numer wiersza faktury", xpath: `${K_LINE}/NrWierszaFa`, kind: "identifier", source: "KSEF-XSD", select: ksef("k:NrWierszaFa") }),
    line2({ field: "item_name", term: "P_7", name: "Nazwa (rodzaj) towaru lub us\u0142ugi", xpath: `${K_LINE}/P_7`, kind: "text", source: "KSEF-XSD", select: ksef("k:P_7") }),
    line2({ field: "P_7", term: "P_7", name: "Nazwa (rodzaj) towaru lub us\u0142ugi", xpath: `${K_LINE}/P_7`, kind: "text", source: "KSEF-XSD", select: ksef("k:P_7") }),
    line2({ field: "quantity", term: "P_8B", name: "Ilo\u015B\u0107 (liczba) dostarczonych towar\xF3w lub zakres wykonanych us\u0142ug", xpath: `${K_LINE}/P_8B`, kind: "quantity", source: "KSEF-XSD", select: ksef("k:P_8B") }),
    line2({ field: "P_8B", term: "P_8B", name: "Ilo\u015B\u0107 (liczba) dostarczonych towar\xF3w lub zakres wykonanych us\u0142ug", xpath: `${K_LINE}/P_8B`, kind: "quantity", source: "KSEF-XSD", select: ksef("k:P_8B") }),
    line2({ field: "price", term: "P_9A", name: "Cena jednostkowa towaru lub us\u0142ugi bez kwoty podatku (cena jednostkowa netto)", xpath: `${K_LINE}/P_9A`, kind: "amount", source: "KSEF-XSD", select: ksef("k:P_9A") }),
    line2({ field: "P_9A", term: "P_9A", name: "Cena jednostkowa netto", xpath: `${K_LINE}/P_9A`, kind: "amount", source: "KSEF-XSD", select: ksef("k:P_9A") }),
    line2({ field: "P_9B", term: "P_9B", name: "Cena wraz z kwot\u0105 podatku (cena jednostkowa brutto)", xpath: `${K_LINE}/P_9B`, kind: "amount", source: "KSEF-XSD", select: ksef("k:P_9B") }),
    line2({ field: "P_10", term: "P_10", name: "Kwoty wszelkich opust\xF3w lub obni\u017Cek cen", xpath: `${K_LINE}/P_10`, kind: "amount", source: "KSEF-XSD", select: ksef("k:P_10") }),
    line2({ field: "P_11", term: "P_11", name: "Warto\u015B\u0107 sprzeda\u017Cy netto", xpath: `${K_LINE}/P_11`, kind: "amount", source: "KSEF-XSD", select: ksef("k:P_11") }),
    line2({ field: "P_11A", term: "P_11A", name: "Warto\u015B\u0107 sprzeda\u017Cy brutto (art. 106e ust. 7 i 8)", xpath: `${K_LINE}/P_11A`, kind: "amount", source: "KSEF-XSD", select: ksef("k:P_11A") }),
    line2({ field: "P_11Vat", term: "P_11Vat", name: "Kwota podatku (art. 106e ust. 10)", xpath: `${K_LINE}/P_11Vat`, kind: "amount", source: "KSEF-XSD", select: ksef("k:P_11Vat") }),
    line2({ field: "P_12", term: "P_12", name: "Stawka podatku", xpath: `${K_LINE}/P_12`, kind: "code", source: "KSEF-XSD", select: ksef("k:P_12") })
  ]
};
var EINVOICE_MAPS = {
  "peppol-bis3": PEPPOL_BIS3_MAP,
  "zatca-ksa": ZATCA_MAP,
  "ksef-fa3": KSEF_FA3_MAP
};
function lineElements(map, root2) {
  return map.profile === "ksef-fa3" ? ksef(...FA, "k:FaWiersz")(root2) : ubl("cac:InvoiceLine")(root2);
}
function vatBreakdownElements(map, root2) {
  if (map.vatBreakdownXpath === null) return [];
  const tt = taxTotal(true)(root2);
  return tt.length === 1 ? kids(tt[0], UBL_NS.cac, "TaxSubtotal") : [];
}
function breakdownTotals(root2) {
  return taxTotal(true)(root2).length;
}

// packages/verify/src/twin-einvoice/bind.ts
var PEPPOL_BIS3_CUSTOMIZATION = "urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0";
var ZATCA_PROFILE_ID = "reporting:1.0";
var ws = (s) => s.replace(/\s+/g, " ").trim();
function detectProfile(root2) {
  if (root2.ns === UBL_NS.inv && root2.local === "Invoice") {
    const cust = ws(kids(root2, UBL_NS.cbc, "CustomizationID")[0]?.text ?? "");
    const prof = ws(kids(root2, UBL_NS.cbc, "ProfileID")[0]?.text ?? "");
    if (cust.startsWith(PEPPOL_BIS3_CUSTOMIZATION)) return { profile: "peppol-bis3", detail: `cbc:CustomizationID "${cust}" (PEPPOL-EN16931-R004)` };
    if (prof === ZATCA_PROFILE_ID) return { profile: "zatca-ksa", detail: `cbc:ProfileID "${prof}" (BR-KSA-EN16931-01)` };
    return { profile: null, detail: `a UBL Invoice that is neither Peppol BIS 3.0 (CustomizationID "${cust}") nor ZATCA (ProfileID "${prof}")` };
  }
  if (root2.local === "CreditNote" && root2.ns === "urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2") {
    return { profile: null, detail: "a UBL CreditNote: not mapped in this version (only the UBL Invoice root is)" };
  }
  if (root2.local === "Faktura") {
    if (root2.ns !== KSEF_NS) return { profile: null, detail: `a KSeF Faktura in namespace ${root2.ns}, not FA(3) (${KSEF_NS})` };
    const kf = kids(kids(root2, KSEF_NS, "Naglowek")[0] ?? root2, KSEF_NS, "KodFormularza")[0];
    const sys = kf?.attrs.kodSystemowy;
    if (sys !== "FA (3)") return { profile: null, detail: `a FA(3)-namespace Faktura whose Naglowek/KodFormularza/@kodSystemowy is ${JSON.stringify(sys ?? null)}, not "FA (3)"` };
    return { profile: "ksef-fa3", detail: 'Faktura in the FA(3) namespace, KodFormularza kodSystemowy="FA (3)"' };
  }
  return { profile: null, detail: `root element {${root2.ns}}${root2.local} is not a mapped e-invoice` };
}
var PREFIX2 = { [UBL_NS.cac]: "cac", [UBL_NS.cbc]: "cbc" };
function xpathOf(el) {
  const parts = [];
  for (let e = el; e; e = e.parent) {
    const p = PREFIX2[e.ns];
    const { index: index2, of } = positionOf(e);
    parts.unshift(`${p ? `${p}:` : ""}${e.local}${of > 1 ? `[${index2}]` : ""}`);
  }
  return "/" + parts.join("/");
}
var DECIMAL = /^[+-]?(\d+(\.\d*)?|\.\d+)$/;
var DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
var TIME = /^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/;
function parseDecimal(s) {
  const t = s.trim();
  return DECIMAL.test(t) ? Number(t) : null;
}
function parseIsoDate(s) {
  const t = s.trim();
  const m = DATE.exec(t);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? t : null;
}
function parseTime(s) {
  const t = s.trim();
  return TIME.test(t) ? t : null;
}
function parseByKind(kind, raw) {
  switch (kind) {
    case "amount":
    case "quantity":
    case "rate":
      return parseDecimal(raw);
    case "date":
      return parseIsoDate(raw);
    case "time":
      return parseTime(raw);
    default: {
      const t = raw.trim();
      return t.length ? t : null;
    }
  }
}
function scopeRoot(map, root2, ref2) {
  if (ref2.scope === "document") return { el: root2 };
  if (ref2.scope === "line") {
    const ls = lineElements(map, root2);
    return ls[ref2.index] ? { el: ls[ref2.index] } : { el: null, reason: "ELEMENT_ABSENT", detail: `the invoice has ${ls.length} line(s) (${map.lineXpath}); there is no line index ${ref2.index} (0-based)` };
  }
  const tt = breakdownTotals(root2);
  if (tt !== 1) return { el: null, reason: tt === 0 ? "ELEMENT_ABSENT" : "AMBIGUOUS_ELEMENT", detail: `the VAT breakdown lives in the one cac:TaxTotal with cac:TaxSubtotal; this invoice has ${tt}` };
  const vb = vatBreakdownElements(map, root2);
  return vb[ref2.index] ? { el: vb[ref2.index] } : { el: null, reason: "ELEMENT_ABSENT", detail: `the invoice has ${vb.length} VAT breakdown(s); there is no index ${ref2.index} (0-based)` };
}
function bindField4(map, root2, fm, ref2) {
  const sr = scopeRoot(map, root2, ref2);
  if (!sr.el) return { ok: false, reason: sr.reason, detail: sr.detail };
  const els = fm.select(sr.el, root2);
  const where = ref2.scope === "document" ? fm.xpath : `${fm.xpath} (${ref2.scope}[${ref2.index}])`;
  if (els.length === 0) return { ok: false, reason: "ELEMENT_ABSENT", detail: `the invoice has no ${where} (${fm.term} ${fm.name})` };
  if (els.length > 1) return { ok: false, reason: "AMBIGUOUS_ELEMENT", detail: `the invoice has ${els.length} elements for ${where} (${fm.term}); one is required to bind: ${els.map(xpathOf).join(", ")}` };
  const el = els[0];
  const binding = {
    field: fm.field,
    term: fm.term,
    name: fm.name,
    source: fm.source,
    kind: fm.kind,
    declared_xpath: fm.xpath,
    xpath: xpathOf(el),
    raw: el.text,
    value: parseByKind(fm.kind, el.text),
    span: { ...el.inner },
    ...el.attrs.currencyID !== void 0 ? { currency: el.attrs.currencyID.trim() } : {}
  };
  if (el.children.length) return { ok: false, reason: "BINDING_UNPARSEABLE", detail: `${binding.xpath} has child elements; a ${fm.kind} leaf was expected`, binding };
  if (binding.value === null) return { ok: false, reason: "BINDING_UNPARSEABLE", detail: `${binding.xpath} reads ${JSON.stringify(el.text)}, which is not a valid ${fm.kind}`, binding };
  if (fm.term === "BT-110") {
    const docCur = ws(kids(root2, UBL_NS.cbc, "DocumentCurrencyCode")[0]?.text ?? "");
    if (!docCur || binding.currency !== docCur) {
      return { ok: false, reason: "AMBIGUOUS_ELEMENT", detail: `the tax total with a breakdown (${binding.xpath}) is in ${binding.currency ?? "(no currencyID)"}, but BT-110 is the one in the document currency ${docCur || "(none stated)"}; the two selections disagree`, binding };
    }
  }
  if (fm.term === "BT-111" && kids(root2, UBL_NS.cbc, "TaxCurrencyCode").length === 0) {
    return { ok: false, reason: "AMBIGUOUS_ELEMENT", detail: `${binding.xpath} is a tax total without a breakdown, but the invoice states no VAT accounting currency (BT-6, cbc:TaxCurrencyCode); BT-111 exists only with BT-6 (PEPPOL-EN16931-R054), so it is not bound as BT-111`, binding };
  }
  return { ok: true, binding };
}
function mapFor(profile) {
  return EINVOICE_MAPS[profile];
}

// packages/verify/src/twin-einvoice/rulesets.ts
var HOUSE_PEPPOL_RULESET = {
  id: "peppol-en16931",
  version: "0.1.0",
  domain: "e-invoice",
  name: "Peppol BIS Billing 3.0 / EN 16931 invoice",
  sources: {
    "PEPPOL-RULES-CEN": "https://docs.peppol.eu/poacc/billing/3.0/rules/ubl-tc434/",
    "PEPPOL-RULES-PEPPOL": "https://docs.peppol.eu/poacc/billing/3.0/rules/ubl-peppol/",
    "CEN-SCH": "https://github.com/OpenPEPPOL/peppol-bis-invoice-3/blob/master/rules/sch/CEN-EN16931-UBL.sch",
    "PEPPOL-SCH": "https://github.com/OpenPEPPOL/peppol-bis-invoice-3/blob/master/rules/sch/PEPPOL-EN16931-UBL.sch",
    "PEPPOL-BIS": "https://docs.peppol.eu/poacc/billing/3.0/bis/"
  },
  lineArrayKeys: ["lines", "invoice_lines", "line_items"],
  tolerance: { rel: 0, absCap: 0 },
  fields: {
    LINE_EXT: { paths: ["line_extension_amount", "LineExtensionAmount", "net_amount"], line: true },
    QTY: { paths: ["invoiced_quantity", "InvoicedQuantity", "quantity", "qty"], kind: "quantity", line: true },
    PRICE: { paths: ["price_amount", "PriceAmount", "price", "unit_price"], kind: "price", line: true },
    BASE_QTY: { paths: ["base_quantity", "BaseQuantity"], kind: "quantity", line: true, default: 1 },
    LINE_ALLOWANCE: { paths: ["line_allowance_amount", "allowance_amount", "allowance_total_amount"], line: true },
    LINE_CHARGE: { paths: ["line_charge_amount", "charge_amount", "charge_total_amount"], line: true },
    LINE_ALLOWANCE_CHARGE_LIST: { paths: ["allowance_charges", "allowances_charges", "AllowanceCharge", "allowances", "charges"], kind: "string", line: true },
    SUM_LINE_NET: { paths: ["line_extension_amount", "LineExtensionAmount", "totals.line_extension_amount", "sum_of_line_net_amount"] },
    ALLOWANCE: { paths: ["allowance_total_amount", "AllowanceTotalAmount", "totals.allowance_total_amount"], default: 0 },
    CHARGE: { paths: ["charge_total_amount", "ChargeTotalAmount", "totals.charge_total_amount"], default: 0 },
    TAX_EXCL: { paths: ["tax_exclusive_amount", "TaxExclusiveAmount", "totals.tax_exclusive_amount"] },
    TAX_AMT: { paths: ["tax_amount", "TaxAmount", "totals.tax_amount"] },
    TAX_INCL: { paths: ["tax_inclusive_amount", "TaxInclusiveAmount", "totals.tax_inclusive_amount"] },
    PREPAID: { paths: ["prepaid_amount", "PrepaidAmount", "totals.prepaid_amount"], default: 0 },
    ROUNDING: { paths: ["payable_rounding_amount", "PayableRoundingAmount", "totals.payable_rounding_amount"], default: 0 },
    PAYABLE: { paths: ["payable_amount", "PayableAmount", "totals.payable_amount", "amount_due"] }
  },
  checks: [
    {
      code: "LINES_SUM_INT",
      field: "sum_of_line_net_amount",
      tol: 5e-3,
      name: "BR-CO-10: BT-106 = \u03A3 BT-131, exact to the cent [PEPPOL-RULES-CEN, CEN-SCH]",
      left: "SUM_LINE_NET",
      op: "=",
      right: "sum(LINE_EXT)"
    },
    {
      code: "TAX_EXCL_INT",
      field: "tax_exclusive_amount",
      tol: 5e-3,
      name: "BR-CO-13: BT-109 = BT-106 \u2212 BT-107 + BT-108, exact to the cent [PEPPOL-RULES-CEN, CEN-SCH]",
      left: "TAX_EXCL",
      op: "=",
      right: "SUM_LINE_NET - ALLOWANCE + CHARGE"
    },
    {
      code: "TAX_INCL_INT",
      field: "tax_inclusive_amount",
      tol: 5e-3,
      name: "BR-CO-15: BT-112 = BT-109 + BT-110, exact to the cent; BT-110 is required [PEPPOL-RULES-CEN, CEN-SCH]",
      left: "TAX_INCL",
      op: "=",
      right: "TAX_EXCL + TAX_AMT"
    },
    {
      code: "PAYABLE_INT",
      field: "payable_amount",
      tol: 5e-3,
      name: "BR-CO-16: BT-115 = BT-112 \u2212 BT-113 + BT-114, exact to the cent [PEPPOL-RULES-CEN, CEN-SCH]",
      left: "PAYABLE",
      op: "=",
      right: "TAX_INCL - PREPAID + ROUNDING"
    },
    {
      code: "LINE_MATH_INT",
      field: "line_extension_amount",
      scope: "line",
      tol: 0.020001,
      name: "PEPPOL-EN16931-R120: BT-131 = BT-129 \xD7 (BT-146 / BT-149) + \u03A3 BT-141 \u2212 \u03A3 BT-136, slack 0.02 [PEPPOL-RULES-PEPPOL, PEPPOL-SCH]",
      left: "LINE_EXT",
      op: "=",
      right: "QTY * PRICE / BASE_QTY + LINE_CHARGE? - LINE_ALLOWANCE?",
      abstain_if_present: ["LINE_ALLOWANCE_CHARGE_LIST"],
      guard_reason: "the line lists its allowances/charges as items; this ruleset reads only their totals (line_allowance_amount / line_charge_amount), so it cannot sum \u03A3 BT-136 / \u03A3 BT-141 here"
    }
  ]
};
var HOUSE_ZATCA_RULESET = {
  id: "zatca-ksa-en16931",
  version: "0.1.0",
  domain: "e-invoice",
  name: "ZATCA (Saudi Arabia / FATOORA) e-invoice \u2014 EN 16931 document footing",
  sources: {
    "ZATCA-XML-STD": "https://zatca.gov.sa/ar/E-Invoicing/SystemsDevelopers/Documents/20230519_ZATCA_Electronic_Invoice_XML_Implementation_Standard_%20vF.pdf",
    "ZATCA-DD": "https://zatca.gov.sa/ar/E-Invoicing/SystemsDevelopers/Documents/20230519_EInvoice_Data_Dictionary%20vF.xlsx"
  },
  lineArrayKeys: ["lines", "invoice_lines", "line_items"],
  tolerance: { rel: 0, absCap: 0 },
  fields: {
    LINE_EXT: { paths: ["line_extension_amount", "LineExtensionAmount", "net_amount"], line: true },
    QTY: { paths: ["invoiced_quantity", "InvoicedQuantity", "quantity", "qty"], kind: "quantity", line: true },
    PRICE: { paths: ["price_amount", "PriceAmount", "price", "unit_price"], kind: "price", line: true },
    BASE_QTY: { paths: ["base_quantity", "BaseQuantity"], kind: "quantity", line: true, default: 1 },
    LINE_ALLOWANCE: { paths: ["line_allowance_amount", "allowance_amount", "allowance_total_amount"], line: true },
    LINE_CHARGE: { paths: ["line_charge_amount", "charge_amount", "charge_total_amount"], line: true },
    LINE_ALLOWANCE_CHARGE_LIST: { paths: ["allowance_charges", "allowances_charges", "AllowanceCharge", "allowances", "charges"], kind: "string", line: true },
    SUM_LINE_NET: { paths: ["line_extension_amount", "LineExtensionAmount", "totals.line_extension_amount", "sum_of_line_net_amount"] },
    ALLOWANCE: { paths: ["allowance_total_amount", "AllowanceTotalAmount", "totals.allowance_total_amount"], default: 0 },
    CHARGE: { paths: ["charge_total_amount", "ChargeTotalAmount", "totals.charge_total_amount"], default: 0 },
    TAX_EXCL: { paths: ["tax_exclusive_amount", "TaxExclusiveAmount", "totals.tax_exclusive_amount"] },
    TAX_AMT: { paths: ["tax_amount", "TaxAmount", "totals.tax_amount"] },
    TAX_INCL: { paths: ["tax_inclusive_amount", "TaxInclusiveAmount", "totals.tax_inclusive_amount"] },
    PREPAID: { paths: ["prepaid_amount", "PrepaidAmount", "totals.prepaid_amount"], default: 0 },
    ROUNDING: { paths: ["payable_rounding_amount", "PayableRoundingAmount", "totals.payable_rounding_amount"], default: 0 },
    PAYABLE: { paths: ["payable_amount", "PayableAmount", "totals.payable_amount", "amount_due"] }
  },
  checks: [
    {
      code: "LINES_SUM_INT",
      field: "sum_of_line_net_amount",
      tol: 5e-3,
      name: "BR-CO-10: BT-106 = \u03A3 BT-131, exact to the cent (totals rounded to two decimals, \xA710) [ZATCA-XML-STD pp.29, 38]",
      left: "SUM_LINE_NET",
      op: "=",
      right: "sum(LINE_EXT)"
    },
    {
      code: "TAX_EXCL_INT",
      field: "tax_exclusive_amount",
      tol: 5e-3,
      name: "BR-CO-13: BT-109 = \u03A3 BT-131 \u2212 BT-107 + BT-108, exact to the cent [ZATCA-XML-STD pp.29, 38]",
      left: "TAX_EXCL",
      op: "=",
      right: "SUM_LINE_NET - ALLOWANCE + CHARGE"
    },
    {
      code: "TAX_INCL_INT",
      field: "tax_inclusive_amount",
      tol: 5e-3,
      name: "BR-CO-15: BT-112 = BT-109 + BT-110, exact to the cent; BT-110 is required (BR-KSA-EN16931-08) [ZATCA-XML-STD pp.29, 38, 67]",
      left: "TAX_INCL",
      op: "=",
      right: "TAX_EXCL + TAX_AMT"
    },
    {
      code: "PAYABLE_INT",
      field: "payable_amount",
      tol: 5e-3,
      name: "BR-CO-16: BT-115 = BT-112 \u2212 BT-113 + BT-114, exact to the cent [ZATCA-XML-STD pp.29, 38]",
      left: "PAYABLE",
      op: "=",
      right: "TAX_INCL - PREPAID + ROUNDING"
    },
    {
      code: "LINE_MATH_INT",
      field: "line_extension_amount",
      scope: "line",
      tol: 5001e-6,
      name: "BR-KSA-EN16931-11: BT-131 = BT-129 \xD7 (BT-146 / BT-149) + \u03A3 BT-141 \u2212 \u03A3 BT-136; only the product is rounded, half-up to two decimals, so at most 0.005 apart (\xA79.3, \xA710) [ZATCA-XML-STD pp.17-18, 29, 67]",
      left: "LINE_EXT",
      op: "=",
      right: "QTY * PRICE / BASE_QTY + LINE_CHARGE? - LINE_ALLOWANCE?",
      abstain_if_present: ["LINE_ALLOWANCE_CHARGE_LIST"],
      guard_reason: "the line lists its allowances/charges as items; this ruleset reads only their totals (line_allowance_amount / line_charge_amount), so it cannot sum \u03A3 BT-136 / \u03A3 BT-141 here"
    }
  ]
};
var HOUSE_KSEF_RULESET = {
  id: "ksef-fa3-pl",
  version: "0.2.0",
  domain: "e-invoice",
  name: "Poland KSeF FA(3) invoice \u2014 national schema footing (NOT EN 16931)",
  sources: {
    "FA3-XSD": "http://crd.gov.pl/wzor/2025/06/25/13775/schemat.xsd",
    "MF-BROSZURA": "https://ksef.podatki.gov.pl/media/jknpcymf/broszura-informacyjna-dotyczaca-struktury-logicznej-fa-3-04032026.pdf",
    "FA3-XSD-DoZaplaty": "http://crd.gov.pl/wzor/2025/06/25/13775/schemat.xsd, element Faktura/Fa/Rozliczenie/DoZaplaty, xsd:documentation (raw text): 'Kwota nale\u017Cno\u015Bci do zap\u0142aty r\xF3wna polu P_15 powi\u0119kszonemu o Obciazenia i pomniejszonemu o Odliczenia'"
  },
  lineArrayKeys: ["lines", "FaWiersze", "invoice_lines", "line_items"],
  tolerance: { rel: 0, absCap: 0 },
  fields: {
    P_11: { paths: ["P_11", "line_net", "net_value"], line: true },
    P_8B: { paths: ["P_8B", "quantity", "qty"], kind: "quantity", line: true },
    P_9A: { paths: ["P_9A", "unit_price", "net_unit_price"], kind: "price", line: true },
    P_10: { paths: ["P_10", "discount"], line: true },
    P_9B: { paths: ["P_9B"], line: true },
    P_11A: { paths: ["P_11A"], line: true },
    P_13_1: { paths: ["P_13_1"], default: 0 },
    P_13_2: { paths: ["P_13_2"], default: 0 },
    P_13_3: { paths: ["P_13_3"], default: 0 },
    P_13_4: { paths: ["P_13_4"], default: 0 },
    P_13_5: { paths: ["P_13_5"], default: 0 },
    P_13_6_1: { paths: ["P_13_6_1"], default: 0 },
    P_13_6_2: { paths: ["P_13_6_2"], default: 0 },
    P_13_6_3: { paths: ["P_13_6_3"], default: 0 },
    P_13_7: { paths: ["P_13_7"], default: 0 },
    P_13_8: { paths: ["P_13_8"], default: 0 },
    P_13_9: { paths: ["P_13_9"], default: 0 },
    P_13_10: { paths: ["P_13_10"], default: 0 },
    P_13_11: { paths: ["P_13_11"], default: 0 },
    P_14_1: { paths: ["P_14_1"], default: 0 },
    P_14_2: { paths: ["P_14_2"], default: 0 },
    P_14_3: { paths: ["P_14_3"], default: 0 },
    P_14_4: { paths: ["P_14_4"], default: 0 },
    P_14_5: { paths: ["P_14_5"], default: 0 },
    P_15: { paths: ["P_15", "gross_total", "amount_due"] },
    DO_ZAPLATY: { paths: ["DoZaplaty", "Rozliczenie.DoZaplaty"] },
    SUMA_OBCIAZEN: { paths: ["SumaObciazen", "Rozliczenie.SumaObciazen"] },
    SUMA_ODLICZEN: { paths: ["SumaOdliczen", "Rozliczenie.SumaOdliczen"] },
    OBCIAZENIA: { paths: ["Obciazenia", "Rozliczenie.Obciazenia"], kind: "string" },
    ODLICZENIA: { paths: ["Odliczenia", "Rozliczenie.Odliczenia"], kind: "string" }
  },
  checks: [
    {
      code: "GROSS_INT",
      field: "P_15",
      tol: 0.02,
      name: "P_15 = \u03A3 P_13_x + \u03A3 P_14_x over the FA(3) buckets (house candidate; not stated by the sources) [FA3-XSD, MF-BROSZURA]",
      left: "P_15",
      op: "=",
      right: "P_13_1 + P_13_2 + P_13_3 + P_13_4 + P_13_5 + P_13_6_1 + P_13_6_2 + P_13_6_3 + P_13_7 + P_13_8 + P_13_9 + P_13_10 + P_13_11 + P_14_1 + P_14_2 + P_14_3 + P_14_4 + P_14_5",
      abstain: "UNSOURCED. Neither the FA(3) XSD nor the MF information sheet (2026-03-04) states P_15 = \u03A3 P_13_x + \u03A3 P_14_x. P_15 is 'Kwota nale\u017Cno\u015Bci og\xF3\u0142em' (total amount due), and the sheet (p.52) names cases where it is something else: the payment documented (advance invoices), the amount remaining (art. 106f ust. 3 invoices) and the correction (corrective invoices). The formula over the full FA(3) bucket set is kept as the candidate until a source states it"
    },
    {
      code: "LINE_NET_INT",
      field: "P_11",
      scope: "line",
      tol: 0.020001,
      name: "P_11 = P_8B \xD7 P_9A, as the MF sheet's worked examples compute it (Przyk\u0142ad 22-23, pp.100-104: 'cena jednostkowa 90 z\u0142, warto\u015B\u0107 netto 3 sztuk r\xF3wna si\u0119 270 z\u0142'); a worked example, not a stated rule [MF-BROSZURA, FA3-XSD]",
      left: "P_11",
      op: "=",
      right: "P_8B * P_9A",
      abstain_if_present: ["P_10", "P_9B", "P_11A"],
      guard_reason: "P_10 (discounts not already in the net unit price) is not stated as per unit or per line in the FA(3) XSD or the MF sheet (pp.90-91); P_9B / P_11A mark the gross method of art. 106e ust. 7-8, where the sheet says the gross unit price and gross value replace the net ones (p.90)"
    },
    {
      code: "DOZAPLATY_INT",
      field: "DoZaplaty",
      tol: 5e-3,
      name: "DoZaplaty = P_15 + SumaObciazen \u2212 SumaOdliczen, exact to the cent; stated by the XSD ('Kwota nale\u017Cno\u015Bci do zap\u0142aty r\xF3wna polu P_15 powi\u0119kszonemu o Obciazenia i pomniejszonemu o Odliczenia') and the MF sheet (p.105) [FA3-XSD-DoZaplaty, MF-BROSZURA]",
      left: "DO_ZAPLATY",
      op: "=",
      right: "P_15 + SUMA_OBCIAZEN? - SUMA_ODLICZEN?",
      abstain_if_present_without: [{ present: "OBCIAZENIA", without: "SUMA_OBCIAZEN" }, { present: "ODLICZENIA", without: "SUMA_ODLICZEN" }],
      guard_reason: "the MF sheet (p.105) defines SumaObciazen / SumaOdliczen as the sum of the items' Kwota; this ruleset reads the stated sum and does not add up the items itself"
    }
  ]
};
var PEPPOL_LINE_SLACK = HOUSE_PEPPOL_RULESET.checks.find((c) => c.code === "LINE_MATH_INT").tol;
function footingRulesetFor(profile) {
  return profile === "peppol-bis3" ? HOUSE_PEPPOL_RULESET : profile === "zatca-ksa" ? HOUSE_ZATCA_RULESET : HOUSE_KSEF_RULESET;
}

// packages/verify/src/twin-einvoice/consistency.ts
var UBL_RULE = {
  LINES_SUM_INT: { id: "BR-CO-10", text: "Sum of Invoice line net amount (BT-106) = \u03A3 Invoice line net amount (BT-131)", terms: ["BT-106", "BT-131*"] },
  TAX_EXCL_INT: { id: "BR-CO-13", text: "Invoice total amount without VAT (BT-109) = \u03A3 BT-131 \u2212 BT-107 + BT-108", terms: ["BT-109", "BT-106", "BT-107", "BT-108"] },
  TAX_INCL_INT: { id: "BR-CO-15", text: "Invoice total amount with VAT (BT-112) = BT-109 + BT-110", terms: ["BT-112", "BT-109", "BT-110"] },
  PAYABLE_INT: { id: "BR-CO-16", text: "Amount due for payment (BT-115) = BT-112 \u2212 BT-113 + BT-114", terms: ["BT-115", "BT-112", "BT-113", "BT-114"] }
};
var UBL_LINE_TERMS = ["BT-131", "BT-129", "BT-146", "BT-149"];
var KSEF_TEXT = {
  GROSS_INT: "P_15 = \u03A3 P_13_x + \u03A3 P_14_x (house candidate; a declared abstention in the ruleset: no primary source states it)",
  LINE_NET_INT: "P_11 = P_8B \xD7 P_9A (house identity from the MF sheet's worked examples; abstains on P_10 / P_9B / P_11A)"
};
var KSEF_RULESET_BUCKETS = Object.keys(HOUSE_KSEF_RULESET.fields).filter((k) => /^P_1[34]_/.test(k));
var KSEF_LINE_TERMS = ["P_11", "P_8B", "P_9A", "P_10", "P_9B", "P_11A"];
var KSEF_SPEC_RULE = {
  DOZAPLATY_INT: { id: "FA3-XSD:DoZaplaty", text: "DoZaplaty = P_15 + SumaObciazen \u2212 SumaOdliczen (FA(3) XSD Rozliczenie/DoZaplaty; MF information sheet p.105)" }
};
function bindAll(map, root2, scope, index2, terms) {
  const out = /* @__PURE__ */ new Map();
  for (const t of terms) {
    const fm = map.fields.find((f) => f.term === t && f.scope === scope);
    if (fm) out.set(t, bindField4(map, root2, fm, { scope, index: index2 }));
  }
  return out;
}
function jsonValue(b) {
  if (!b) return void 0;
  if (b.ok) return b.binding.value;
  if (b.reason === "ELEMENT_ABSENT") return void 0;
  return `UNBOUND:${b.reason}`;
}
function spanEvidence4(xmlSha, b) {
  return [
    { locator: { kind: "span", source_hash: xmlSha, start: b.span.start, end: b.span.end }, value: b.value, original: b.raw, confidence: 100, role: "OPERAND" },
    { locator: { kind: "field", source: "evidence", path: b.xpath }, value: b.term, confidence: 100, role: "CONTEXT" }
  ];
}
var cents = (x) => Math.round(x * 100) / 100;
function lineAllowancesCharges(map, line3) {
  const allowances = [], charges = [];
  const source = map.profile === "zatca-ksa" ? "ZATCA-DD" : "PEPPOL-SYNTAX";
  for (const ac of kids(line3, UBL_NS.cac, "AllowanceCharge")) {
    const ind = kids(ac, UBL_NS.cbc, "ChargeIndicator");
    const flag = ind.length === 1 ? ind[0].text.replace(/\s+/g, " ").trim() : null;
    if (flag !== "true" && flag !== "false") return { problem: `${xpathOf(ac)} has cbc:ChargeIndicator ${flag === null ? `\xD7${ind.length}` : JSON.stringify(flag)}; only 'true' (BT-141) or 'false' (BT-136) says which total it belongs to` };
    const amt = kids(ac, UBL_NS.cbc, "Amount");
    if (amt.length !== 1) return { problem: `${xpathOf(ac)} has ${amt.length} cbc:Amount elements; one is required` };
    const el = amt[0];
    const value = el.children.length ? null : parseDecimal(el.text);
    if (value === null) return { problem: `${xpathOf(el)} reads ${JSON.stringify(el.text)}, which is not a valid amount` };
    const charge = flag === "true";
    const b = {
      field: charge ? "line_charge_amount" : "line_allowance_amount",
      term: charge ? "BT-141" : "BT-136",
      name: charge ? "Invoice line charge amount" : "Invoice line allowance amount",
      source,
      kind: "amount",
      declared_xpath: `/Invoice/cac:InvoiceLine/cac:AllowanceCharge[cbc:ChargeIndicator='${flag}']/cbc:Amount`,
      xpath: xpathOf(el),
      raw: el.text,
      value,
      span: { ...el.inner },
      ...el.attrs.currencyID !== void 0 ? { currency: el.attrs.currencyID.trim() } : {}
    };
    (charge ? charges : allowances).push(b);
  }
  return { allowances, charges };
}
function ksefRozliczenie(root2) {
  const fa = kids(root2, KSEF_NS, "Fa")[0];
  const rz = fa ? kids(fa, KSEF_NS, "Rozliczenie") : [];
  if (rz.length !== 1) return null;
  const json = {}, bindings = [];
  for (const name of ["DoZaplaty", "SumaObciazen", "SumaOdliczen"]) {
    const els = kids(rz[0], KSEF_NS, name);
    if (els.length === 0) continue;
    const el = els[0];
    const value = els.length === 1 && !el.children.length ? parseDecimal(el.text) : null;
    if (value === null) {
      json[name] = `UNBOUND:${els.length > 1 ? "AMBIGUOUS_ELEMENT" : "BINDING_UNPARSEABLE"}`;
      continue;
    }
    json[name] = value;
    bindings.push({ field: name, term: name, name, source: "KSEF-XSD", kind: "amount", declared_xpath: `/Faktura/Fa/Rozliczenie/${name}`, xpath: xpathOf(el), raw: el.text, value, span: { ...el.inner } });
  }
  for (const list of ["Obciazenia", "Odliczenia"]) {
    const items = kids(rz[0], KSEF_NS, list);
    if (items.length) json[list] = items.map((it) => kids(it, KSEF_NS, "Kwota")[0]?.text.trim() ?? "");
  }
  return { json, bindings };
}
function checkEinvoiceConsistency(map, root2, xmlSha) {
  const ubl2 = map.profile !== "ksef-fa3";
  const ruleset = footingRulesetFor(map.profile);
  const footing = `${ruleset.id}@${ruleset.version}${ubl2 ? ", strict (rel 0)" : ""}`;
  const lines = lineElements(map, root2);
  const docTerms = ubl2 ? ["BT-106", "BT-107", "BT-108", "BT-109", "BT-110", "BT-112", "BT-113", "BT-114", "BT-115"] : ["P_15", ...KSEF_RULESET_BUCKETS];
  const doc3 = bindAll(map, root2, "document", 0, docTerms);
  const lineBound = lines.map((_, i) => bindAll(map, root2, "line", i, ubl2 ? UBL_LINE_TERMS : KSEF_LINE_TERMS));
  const lineAC = ubl2 ? lines.map((l) => lineAllowancesCharges(map, l)) : [];
  const rozliczenie = ubl2 ? null : ksefRozliczenie(root2);
  const extraction = {};
  const put = (o, key, b) => {
    const v = jsonValue(b);
    if (v !== void 0) o[key] = v;
  };
  if (ubl2) {
    put(extraction, "line_extension_amount", doc3.get("BT-106"));
    put(extraction, "allowance_total_amount", doc3.get("BT-107"));
    put(extraction, "charge_total_amount", doc3.get("BT-108"));
    put(extraction, "tax_exclusive_amount", doc3.get("BT-109"));
    put(extraction, "tax_amount", doc3.get("BT-110"));
    put(extraction, "tax_inclusive_amount", doc3.get("BT-112"));
    put(extraction, "prepaid_amount", doc3.get("BT-113"));
    put(extraction, "payable_rounding_amount", doc3.get("BT-114"));
    put(extraction, "payable_amount", doc3.get("BT-115"));
    extraction.lines = lineBound.map((lb, i) => {
      const o = {};
      put(o, "line_extension_amount", lb.get("BT-131"));
      put(o, "invoiced_quantity", lb.get("BT-129"));
      put(o, "price_amount", lb.get("BT-146"));
      put(o, "base_quantity", lb.get("BT-149"));
      const ac = lineAC[i];
      if ("problem" in ac) return o;
      if (ac.allowances.length) o.line_allowance_amount = cents(ac.allowances.reduce((a, b) => a + b.value, 0));
      if (ac.charges.length) o.line_charge_amount = cents(ac.charges.reduce((a, b) => a + b.value, 0));
      return o;
    });
  } else {
    for (const t of ["P_15", ...KSEF_RULESET_BUCKETS]) put(extraction, t, doc3.get(t));
    if (rozliczenie) extraction.Rozliczenie = rozliczenie.json;
    extraction.lines = lineBound.map((lb) => {
      const o = {};
      for (const t of KSEF_LINE_TERMS) put(o, t, lb.get(t));
      return o;
    });
  }
  const verdict = verifyDeclarative(extraction, ruleset, { now: () => /* @__PURE__ */ new Date(0), ...ubl2 ? { tolerance: { rel: 0, absCap: 0 } } : {} });
  const out = [];
  for (const hc of verdict.claims) {
    const m = /^(document|line\[(\d+)\])\.(.+)$/.exec(hc.claim_id);
    if (!m) continue;
    const scope = m[1];
    const li = m[2] !== void 0 ? Number(m[2]) : -1;
    const code2 = m[3];
    let rule_id, text, provenance, bound;
    let abstainWhy = null;
    if (ubl2) {
      if (code2 === "LINE_MATH_INT") {
        rule_id = map.profile === "peppol-bis3" ? "PEPPOL-EN16931-R120" : "BR-KSA-EN16931-11";
        text = "Invoice line net amount (BT-131) = BT-129 \xD7 (BT-146 / BT-149) + \u03A3 BT-141 \u2212 \u03A3 BT-136";
        const ac = lineAC[li];
        if ("problem" in ac) abstainWhy = `a line allowance/charge cannot be read: ${ac.problem}`;
        bound = [...lineBound[li].values(), ..."problem" in ac ? [] : [...ac.allowances, ...ac.charges].map((binding) => ({ ok: true, binding }))];
      } else {
        const r = UBL_RULE[code2];
        if (!r) continue;
        rule_id = r.id;
        text = r.text;
        bound = r.terms.flatMap((t) => t === "BT-131*" ? lineBound.map((lb) => lb.get("BT-131")) : doc3.has(t) ? [doc3.get(t)] : []);
      }
      provenance = "SPEC";
      if (code2 === "TAX_INCL_INT" && !doc3.get("BT-110")?.ok) abstainWhy = `BT-110 is not bound (${doc3.get("BT-110")?.detail ?? "absent"})`;
    } else if (KSEF_SPEC_RULE[code2]) {
      rule_id = KSEF_SPEC_RULE[code2].id;
      text = KSEF_SPEC_RULE[code2].text;
      provenance = "SPEC";
      bound = [...doc3.has("P_15") ? [doc3.get("P_15")] : [], ...(rozliczenie?.bindings ?? []).map((binding) => ({ ok: true, binding }))];
    } else {
      rule_id = `KSEF-HOUSE:${code2}`;
      text = KSEF_TEXT[code2] ?? code2;
      provenance = "HOUSE_RECON";
      bound = code2 === "GROSS_INT" ? [...doc3.values()] : [...lineBound[li].values()];
    }
    const operands = bound.filter((b) => b.ok).map((b) => ({ term: b.binding.term, xpath: b.binding.xpath, value: b.binding.value }));
    const evidence = bound.flatMap((b) => b.ok ? spanEvidence4(xmlSha, b.binding) : []);
    const claim_id = `xml.${scope}.${rule_id}`;
    const base = { claim_id, kind: "CONSISTENCY", tier: "DETERMINISTIC", field: hc.field, rule_id, rule_name: `${text} [house ${code2}, ${footing}]` };
    let claim, outcome, detail;
    if (abstainWhy !== null || hc.outcome === "INSUFFICIENT_DATA" || evidence.length === 0) {
      detail = abstainWhy ?? hc.insufficiency?.detail ?? "no operand element could be bound";
      outcome = "ABSTAIN";
      claim = {
        ...base,
        outcome: "INSUFFICIENT_DATA",
        asserted: null,
        evidence: [],
        locked: false,
        insufficiency: { reason: abstainWhy !== null ? "OUT_OF_RULESET_SCOPE" : hc.insufficiency?.reason ?? "FIELD_MISSING", detail },
        explanation: `${rule_id}: ${detail}; not checked.`
      };
    } else {
      outcome = hc.outcome;
      detail = hc.explanation;
      claim = {
        ...base,
        outcome: hc.outcome,
        asserted: hc.asserted,
        evidence,
        locked: hc.locked,
        ...hc.computation ? { computation: hc.computation } : {},
        ...hc.variance !== void 0 ? { variance: hc.variance } : {},
        explanation: `${rule_id} (${scope}): ${hc.explanation}${hc.outcome === "FAIL" ? " The invoice is internally inconsistent: its own elements do not satisfy the rule." : ""}`
      };
    }
    out.push({ claim_id, rule_id, house_code: code2, footing, scope, outcome, detail, provenance, operands, claim });
  }
  return out;
}

// packages/verify/src/twin-einvoice/judge.ts
var UNKNOWN_RULESET = { id: "twin-einvoice", version: "0.3.0", domain: "e-invoice" };
var AGGREGATION = "ANY_FAIL_FAILS_CONSISTENCY_ALONE_NEVER_PASSES";
var INSUFFICIENCY2 = {
  NO_TWIN: "REFERENCE_NOT_PROVIDED",
  UNSUPPORTED_PROFILE: "OUT_OF_RULESET_SCOPE",
  NOT_MAPPED: "OUT_OF_RULESET_SCOPE",
  ELEMENT_ABSENT: "REFERENCE_NOT_PROVIDED",
  AMBIGUOUS_ELEMENT: "AMBIGUOUS_REFERENCE",
  BINDING_UNPARSEABLE: "UNPARSEABLE",
  VALUE_UNPARSEABLE: "UNPARSEABLE",
  TEXT_VARIANT: "AMBIGUOUS_REFERENCE"
};
var SCOPED = /^(lines|vat_breakdown)\[(\d+)\]\.([A-Za-z0-9_]+)$/;
function resolveField(map, field) {
  const m = SCOPED.exec(field);
  if (m) {
    const scope = m[1] === "lines" ? "line" : "vat_breakdown";
    const fm2 = map.fields.find((f) => f.scope === scope && f.field === m[3]);
    return fm2 ? { fm: fm2, ref: { scope, index: Number(m[2]) } } : null;
  }
  const fm = map.fields.find((f) => f.scope === "document" && f.field === field);
  return fm ? { fm, ref: { scope: "document", index: 0 } } : null;
}
function einvoiceVerdictInput(xmlSha256, profile, claims, opts = {}) {
  const map = profile ? mapFor(profile) : null;
  const footing = profile && (opts.consistency ?? true) ? footingRulesetFor(profile) : null;
  return {
    xml_sha256: xmlSha256,
    profile,
    map: map ? `${map.id}@${map.version}` : `${UNKNOWN_RULESET.id}@${UNKNOWN_RULESET.version}`,
    tolerance: opts.tolerance ?? 5e-3,
    quantity_tolerance: opts.quantityTolerance ?? 5e-4,
    consistency: opts.consistency ?? true,
    footing: footing ? `${footing.id}@${footing.version}` : null,
    claims: claims.map((c) => ({ id: c.id, field: c.field, value: typeof c.value === "number" && !Number.isFinite(c.value) ? null : c.value, ...c.currency !== void 0 ? { currency: c.currency } : {} }))
  };
}
var idNorm = (s) => s.replace(/\s+/g, "").toUpperCase();
var textNorm = (s) => s.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
function claimNumber(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  return parseDecimal(v);
}
function claimString(v) {
  if (typeof v === "number") return Number.isFinite(v) && Number.isInteger(v) ? String(v) : null;
  const t = v.trim();
  return t.length ? t : null;
}
function adjacentDigitSwaps(s) {
  const out = /* @__PURE__ */ new Set();
  for (let i = 0; i + 1 < s.length; i++) {
    const a = s[i], b = s[i + 1];
    if (a !== b && /\d/.test(a) && /\d/.test(b)) out.add(s.slice(0, i) + b + a + s.slice(i + 2));
  }
  return out;
}
var fixed2 = (x) => Math.abs(x).toFixed(2);
function bindCached(ctx, fm, ref2) {
  const k = `${fm.scope}:${ref2.index}:${fm.field}`;
  let b = ctx.cache.get(k);
  if (!b) {
    b = bindField4(ctx.map, ctx.root, fm, ref2);
    ctx.cache.set(k, b);
  }
  return b;
}
function otherBindings(ctx, fm, ref2, kinds) {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  const add = (f, r) => {
    if (!kinds.includes(f.kind)) return;
    const b = bindCached(ctx, f, r);
    if (!b.ok || seen.has(b.binding.span.start)) return;
    seen.add(b.binding.span.start);
    out.push(b.binding);
  };
  for (const f of ctx.map.fields) if (f.scope === "document") add(f, { scope: "document", index: 0 });
  if (ref2.scope !== "document") {
    for (const f of ctx.map.fields) if (f.scope === ref2.scope) add(f, ref2);
  }
  const self = bindCached(ctx, fm, ref2);
  return out.filter((b) => !(self.ok && b.span.start === self.binding.span.start));
}
var matchRef = (b) => ({ field: b.field, term: b.term, xpath: b.xpath, value: b.value });
function compare(ctx, fm, ref2, b, c, tol, qtol) {
  const where = `${b.term} ${b.xpath} = ${JSON.stringify(b.raw.trim())}`;
  const fail = (diagnosis, why, matches) => ({ outcome: "FAIL", reason: "MISMATCH", diagnosis, detail: `${why}; the binding element is ${where}`, ...matches?.length ? { matches } : {} });
  const unparseable2 = (what) => ({ outcome: "ABSTAIN", reason: "VALUE_UNPARSEABLE", detail: `the asserted value ${JSON.stringify(c.value)} is not ${what}; nothing is guessed` });
  if (fm.kind === "amount" || fm.kind === "quantity" || fm.kind === "rate") {
    const v = claimNumber(c.value);
    if (v === null) return unparseable2('a plain number (numbers, or strings like "1234.56"; no thousands separators or symbols)');
    const bv = b.value;
    const t = fm.kind === "amount" ? tol : qtol;
    if (Math.abs(v - bv) <= t + 1e-9) {
      if (fm.kind === "amount" && c.currency !== void 0) {
        const elCur = b.currency ?? documentCurrency(ctx);
        if (elCur && c.currency.trim().toUpperCase() !== elCur.toUpperCase()) return fail("CURRENCY", `the amount matches but the asserted currency ${c.currency} is not the element's ${elCur}`);
      }
      return { outcome: "PASS", reason: "MATCH", detail: `equals ${where}${b.currency ? ` ${b.currency}` : ""}` };
    }
    if (fm.kind === "rate" && bv !== 0 && Math.abs(v * 100 - bv) <= t * 100 + 1e-9) {
      return { outcome: "ABSTAIN", reason: "VALUE_UNPARSEABLE", detail: `the asserted rate ${v} reads as a fraction of the element's percentage ${bv}; the representation is not guessed` };
    }
    if (bv !== 0 && Math.abs(v + bv) <= t + 1e-9) return fail("SIGN", `the sign is inverted (${v} vs ${bv})`);
    if (bv !== 0) {
      for (const k of [1, 2, 3, 6]) for (const r of [10 ** k, 10 ** -k]) if (Math.abs(v - bv * r) <= Math.max(t, Math.abs(bv * r) * 1e-9)) return fail("SCALE", `off by a factor of ${r >= 1 ? r : `1/${1 / r}`} (${v} vs ${bv}): a currency-unit or scale error`);
    }
    const others = otherBindings(ctx, fm, ref2, ["amount", "quantity", "rate"]).filter((o) => Math.abs(o.value - v) <= t + 1e-9);
    if (others.length) return fail("OTHER_FIELD", `it is ${others.map((o) => `${o.term} (${o.field})`).join(" / ")}, another element's value`, others.slice(0, 3).map(matchRef));
    if (adjacentDigitSwaps(fixed2(bv)).has(fixed2(v)) && Math.sign(v) === Math.sign(bv)) return fail("TRANSPOSITION", `two adjacent digits are transposed (${v} vs ${bv})`);
    return fail("UNLOCATED", `${v} differs from the element and equals no other mapped element`);
  }
  if (fm.kind === "date") {
    if (typeof c.value !== "string" || parseIsoDate(c.value) === null) return unparseable2("an ISO calendar date YYYY-MM-DD (other layouts are ambiguous: day/month order is never guessed)");
    const v = c.value.trim();
    if (v === b.value) return { outcome: "PASS", reason: "MATCH", detail: `equals ${where}` };
    const [y, mo, d] = v.split("-");
    if (`${y}-${d}-${mo}` === b.value) return fail("DAY_MONTH_SWAP", `day and month are swapped (${v} vs ${b.value})`);
    const others = otherBindings(ctx, fm, ref2, ["date"]).filter((o) => o.value === v);
    if (others.length) return fail("OTHER_FIELD", `it is ${others.map((o) => `${o.term} (${o.field})`).join(" / ")}, another date`, others.slice(0, 3).map(matchRef));
    return fail("UNLOCATED", `${v} differs from the element and equals no other mapped date`);
  }
  if (fm.kind === "time") {
    if (typeof c.value !== "string" || parseTime(c.value) === null) return unparseable2("a time HH:mm:ss");
    return c.value.trim() === b.value ? { outcome: "PASS", reason: "MATCH", detail: `equals ${where}` } : fail("UNLOCATED", `${c.value.trim()} differs from the element`);
  }
  const s = claimString(c.value);
  if (s === null) return unparseable2("a non-empty string");
  const bs = b.value;
  const counterpart = () => {
    if (!fm.counterpart) return null;
    const cf = ctx.map.fields.find((f) => f.scope === fm.scope && f.field === fm.counterpart);
    if (!cf) return null;
    const cb = bindCached(ctx, cf, ref2);
    return cb.ok ? cb.binding : null;
  };
  if (fm.kind === "identifier" || fm.kind === "code") {
    if (s === bs.trim()) return { outcome: "PASS", reason: "MATCH", detail: `equals ${where}` };
    if (idNorm(s) === idNorm(bs)) return { outcome: "PASS", reason: "MATCH", detail: `equals ${where} after removing whitespace and case`, normalizations: ["whitespace_removed", "case_folded"] };
    const cp2 = counterpart();
    if (cp2 && idNorm(cp2.value) === idNorm(s)) return fail("SWAPPED_PARTY", `it is the counterparty's ${cp2.term} (${cp2.field})`, [matchRef(cp2)]);
    const others = otherBindings(ctx, fm, ref2, ["identifier", "code"]).filter((o) => idNorm(o.value) === idNorm(s));
    if (others.length) return fail("OTHER_FIELD", `it is ${others.map((o) => `${o.term} (${o.field})`).join(" / ")}, another element's value`, others.slice(0, 3).map(matchRef));
    if (adjacentDigitSwaps(idNorm(bs)).has(idNorm(s))) return fail("TRANSPOSITION", `two adjacent digits are transposed (${s} vs ${bs.trim()})`);
    return fail("UNLOCATED", `${JSON.stringify(s)} differs from the element`);
  }
  if (textNorm(s) === textNorm(bs)) {
    return { outcome: "PASS", reason: "MATCH", detail: `equals ${where}${s === bs.trim() ? "" : " after Unicode, whitespace and case normalisation"}`, ...s === bs.trim() ? {} : { normalizations: ["nfkc", "whitespace_collapsed", "case_folded"] } };
  }
  const cp = counterpart();
  if (cp && textNorm(cp.value) === textNorm(s)) return fail("SWAPPED_PARTY", `it is the counterparty's ${cp.term} (${cp.field})`, [matchRef(cp)]);
  return { outcome: "ABSTAIN", reason: "TEXT_VARIANT", detail: `${JSON.stringify(s)} differs from ${where} beyond normalisation and is not the counterparty's; names vary legitimately, so text is not judged further` };
}
function documentCurrency(ctx) {
  const fm = ctx.map.fields.find((f) => f.scope === "document" && f.field === "currency");
  if (!fm) return void 0;
  const b = bindCached(ctx, fm, { scope: "document", index: 0 });
  return b.ok ? b.binding.value : void 0;
}
function bindingEvidence(xmlSha, b, normalizations) {
  return [
    {
      locator: { kind: "span", source_hash: xmlSha, start: b.span.start, end: b.span.end },
      value: b.value,
      original: b.raw,
      normalizations: [`kind=${b.kind}`, ...b.currency ? [`currencyID=${b.currency}`] : [], ...normalizations ?? []],
      confidence: 100,
      role: "REFERENCE"
    },
    { locator: { kind: "field", source: "evidence", path: b.xpath }, value: `${b.term} ${b.name}`, confidence: 100, role: "CONTEXT" }
  ];
}
function verifyEinvoiceTwin(xml, claims, opts = {}) {
  const xmlSha = sha256(xml);
  const tol = opts.tolerance ?? 5e-3;
  const qtol = opts.quantityTolerance ?? 5e-4;
  let root2 = null;
  let parseError = null;
  try {
    root2 = parseXml(xml);
  } catch (e) {
    if (e instanceof XmlParseError) parseError = e.message;
    else throw e;
  }
  const det = root2 ? opts.profile ? { profile: opts.profile, detail: `profile forced by the caller: ${opts.profile}` } : detectProfile(root2) : { profile: null, detail: `not well-formed XML: ${parseError}` };
  const map = det.profile ? mapFor(det.profile) : null;
  const ctx = root2 && map ? { map, root: root2, cache: /* @__PURE__ */ new Map() } : null;
  const judgments = [], out = [];
  for (const c of claims) {
    const resolved = map ? resolveField(map, c.field) : null;
    const term = resolved ? resolved.fm.term : "UNMAPPED";
    const base = {
      claim_id: `${c.id}.twin`,
      kind: "CROSS_REFERENCE",
      tier: "DETERMINISTIC",
      field: c.field,
      asserted: typeof c.value === "number" && !Number.isFinite(c.value) ? null : c.value,
      rule_id: `TWIN_XML:${term}`,
      rule_name: resolved ? `Extracted value equals the invoice's binding element ${resolved.fm.term} (${resolved.fm.name})` : "Extracted value equals the invoice's binding element",
      locked: false
    };
    const abstain = (reason, detail, binding) => {
      judgments.push({ claim_id: c.id, field: c.field, value: c.value, outcome: "ABSTAIN", reason, detail, ...binding ? { binding } : {} });
      out.push({ ...base, outcome: "INSUFFICIENT_DATA", evidence: [], insufficiency: { reason: INSUFFICIENCY2[reason], detail: `${reason}: ${detail}` }, explanation: `${c.field}: ${detail}; abstaining.` });
    };
    if (!root2) {
      abstain("NO_TWIN", `the document is ${det.detail}`);
      continue;
    }
    if (!map || !ctx) {
      abstain("UNSUPPORTED_PROFILE", `the document is ${det.detail}`);
      continue;
    }
    if (!resolved) {
      abstain("NOT_MAPPED", `${map.id}@${map.version} does not map "${c.field}" (no verified primary-source mapping for this profile)`);
      continue;
    }
    const b = bindCached(ctx, resolved.fm, resolved.ref);
    if (!b.ok) {
      abstain(b.reason, b.detail, b.binding);
      continue;
    }
    const r = compare(ctx, resolved.fm, resolved.ref, b.binding, c, tol, qtol);
    if (r.outcome === "ABSTAIN") {
      abstain(r.reason, r.detail, b.binding);
      continue;
    }
    judgments.push({
      claim_id: c.id,
      field: c.field,
      value: c.value,
      outcome: r.outcome,
      reason: r.reason,
      detail: r.detail,
      binding: b.binding,
      ...r.diagnosis ? { diagnosis: r.diagnosis } : {},
      ...r.matches ? { matches: r.matches } : {},
      ...r.normalizations ? { normalizations: r.normalizations } : {}
    });
    const numeric = typeof b.binding.value === "number" && claimNumber(c.value) !== null;
    const computation = {
      formula: `claim = ${b.binding.term} (${b.binding.declared_xpath})`,
      operands: { element: b.binding.value, raw: b.binding.raw },
      result: b.binding.value,
      ...numeric ? { tolerance: { abs: resolved.fm.kind === "amount" ? tol : qtol } } : {}
    };
    const ev = [...bindingEvidence(xmlSha, b.binding, r.normalizations), ...(r.matches ?? []).map((m) => ({ locator: { kind: "field", source: "evidence", path: m.xpath }, value: m.value, confidence: 100, role: "CONTEXT" }))];
    out.push({
      ...base,
      outcome: r.outcome,
      locked: r.outcome === "PASS",
      evidence: ev,
      computation,
      ...r.outcome === "FAIL" && numeric ? { variance: Math.round((claimNumber(c.value) - b.binding.value) * 1e6) / 1e6 } : {},
      explanation: `${c.field} = ${JSON.stringify(c.value)}: ${r.detail}.${r.diagnosis ? ` [${r.diagnosis}]` : ""}`
    });
  }
  const consistency = ctx && (opts.consistency ?? true) ? checkEinvoiceConsistency(ctx.map, ctx.root, xmlSha) : [];
  for (const k of consistency) out.push(k.claim);
  const coverage = { claims_total: out.length, claims_checked: 0, claims_pass: 0, claims_fail: 0, claims_insufficient: 0 };
  for (const c of out) {
    if (c.outcome === "PASS") coverage.claims_pass++;
    else if (c.outcome === "FAIL") coverage.claims_fail++;
    else coverage.claims_insufficient++;
  }
  coverage.claims_checked = coverage.claims_pass + coverage.claims_fail;
  const outcomes = {
    extraction: partOutcome(judgments.map((j) => j.outcome)),
    footing: ctx && (opts.consistency ?? true) ? partOutcome(consistency.map((k) => k.outcome)) : null
  };
  const outcome = aggregateOutcome(AGGREGATION, out);
  const input = einvoiceVerdictInput(xmlSha, det.profile, claims, opts);
  const input_hash = hashOf(input);
  const ruleset = map ? { id: map.id, version: map.version, domain: map.domain } : UNKNOWN_RULESET;
  const verdict = {
    schema_version: SCHEMA_VERSION,
    verdict_id: deriveVerdictId(input_hash, ruleset, ENGINE_VERSION),
    issued_at: (opts.now ?? (() => /* @__PURE__ */ new Date()))().toISOString(),
    engine_version: ENGINE_VERSION,
    ruleset,
    input_hash,
    replayable: true,
    document: { extraction_hash: hashOf(input.claims), ...opts.producer !== void 0 ? { producer: opts.producer } : {}, line_items: root2 && map ? lineElements(map, root2).length : 0 },
    references: { contract: false, evidence: 1, history: 0, source: true },
    outcome,
    aggregation: AGGREGATION,
    claims: out,
    coverage
  };
  return { verdict, judgments, consistency, outcomes, twin: { sha256: xmlSha, profile: det.profile, detail: det.detail, lines: verdict.document.line_items } };
}
function partOutcome(outcomes) {
  return outcomes.includes("FAIL") ? "FAIL" : outcomes.includes("PASS") ? "PASS" : "INSUFFICIENT_DATA";
}

// packages/verify/src/protocol/replay.ts
var ANNOTATIONS = ["channel", "ledger", "declared_accuracy", "action_context"];
var isObj5 = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
var takesTolerance = (x) => isObj5(x) && Object.prototype.hasOwnProperty.call(x, "extraction") && (Object.prototype.hasOwnProperty.call(x, "references") || isDeclarativeRuleset(x.ruleset));
function boundInputs(inputs, opts) {
  if (!opts.tolerance || !takesTolerance(inputs) || Object.prototype.hasOwnProperty.call(inputs, "tolerance")) return inputs;
  return { ...inputs, tolerance: toleranceIdentity(opts.tolerance) };
}
function replayInputProblem(x) {
  if (!isObj5(x)) return `not a verdict: ${x === null ? "null" : Array.isArray(x) ? "an array" : typeof x}, not a verdict object`;
  const missing = [];
  if (typeof x.verdict_id !== "string") missing.push("verdict_id");
  if (typeof x.input_hash !== "string") missing.push("input_hash");
  if (!isObj5(x.ruleset) || typeof x.ruleset.id !== "string" || typeof x.ruleset.version !== "string") missing.push("ruleset {id, version}");
  if (typeof x.engine_version !== "string") missing.push("engine_version");
  return missing.length ? `not a verdict: ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} missing or not a string, so no verdict_id can be derived` : void 0;
}
var STRUCTURE_ONLY_NOTE = "structure verified; outcome NOT re-performed";
function verifyReplay(verdict, inputs, opts = {}) {
  const problem = replayInputProblem(verdict);
  if (problem) return { ok: false, id_ok: false, expected_verdict_id: "", reason: problem, refused: true, outcome_verified: false, status: "REFUSED" };
  const expected_verdict_id = deriveVerdictId(verdict.input_hash, verdict.ruleset, verdict.engine_version);
  const id_ok = expected_verdict_id === verdict.verdict_id;
  const out = { ok: id_ok, id_ok, expected_verdict_id, outcome_verified: false, status: id_ok ? "STRUCTURE_ONLY" : "FAILED" };
  if (!id_ok) out.reason = `verdict_id does not derive from input_hash + ruleset@version + engine_version (expected ${expected_verdict_id})`;
  if (inputs === void 0) {
    if (id_ok) out.not_reperformed = `${STRUCTURE_ONLY_NOTE}: no inputs were supplied, so the check was not run again (the verdict_id binds the inputs, not the outcome)`;
    return out;
  }
  const bound = boundInputs(inputs, opts);
  let expected_input_hash;
  let legacy = false;
  try {
    expected_input_hash = hashOf(bound);
    if (bound !== inputs && expected_input_hash !== verdict.input_hash && hashOf(inputs) === verdict.input_hash) {
      expected_input_hash = verdict.input_hash;
      legacy = true;
    }
  } catch (e) {
    out.input_ok = false;
    out.ok = false;
    out.status = "FAILED";
    out.reason = `the supplied inputs cannot be canonicalized (${e.message}), so the input binding cannot be checked`;
    return out;
  }
  const input_ok = expected_input_hash === verdict.input_hash;
  out.input_ok = input_ok;
  out.expected_input_hash = expected_input_hash;
  out.ok = id_ok && input_ok;
  const unstated = takesTolerance(inputs) && !opts.tolerance && !Object.prototype.hasOwnProperty.call(inputs, "tolerance");
  if (id_ok && !input_ok) out.reason = `input_hash does not match the supplied inputs (expected ${expected_input_hash}) \u2014 this verdict is not for these inputs${unstated ? ". If it was issued under a rounding-tolerance override, restate it: the input identity includes the override" : ""}`;
  if (!out.ok) {
    out.status = "FAILED";
    return out;
  }
  const r = reperform(verdict, bound, opts, legacy);
  if ("not" in r) {
    out.not_reperformed = `${STRUCTURE_ONLY_NOTE}: ${r.not}`;
    return out;
  }
  out.reperformed = r.result;
  if (r.result.identical) {
    out.outcome_verified = true;
    out.status = "REPERFORMED";
  } else {
    out.ok = false;
    out.status = "FAILED";
    const override = (r.result.engine.startsWith("verify:") || r.result.engine === "declarative") && !opts.tolerance ? ". If it was issued under a rounding-tolerance override, restate it (a verdict issued before 2026-09-28 does not commit to it in input_hash)" : "";
    out.reason = `the re-performed verdict differs from the presented one at \`${r.result.first_difference}\`: the check run again on these inputs does not give this verdict (${r.result.engine}, engine ${ENGINE_VERSION})${override}`;
  }
  return out;
}
function reperform(presented, inputs, opts, legacy = false) {
  if (presented.engine_version !== ENGINE_VERSION) {
    return { not: `the verdict was issued by engine ${presented.engine_version}; this is engine ${ENGINE_VERSION}, and a check is re-performed only by the engine that made it` };
  }
  if (!isObj5(inputs)) return { not: "the inputs are not an object, so no engine takes them" };
  let x;
  try {
    x = structuredClone(inputs);
  } catch {
    x = inputs;
  }
  const producer = typeof presented.document?.producer === "string" ? presented.document.producer : void 0;
  const now = () => {
    const d = new Date(presented.issued_at);
    return isNaN(d.getTime()) ? /* @__PURE__ */ new Date(0) : d;
  };
  const common = { now, ...producer !== void 0 ? { producer } : {} };
  const rs = presented.ruleset;
  let engine;
  let run;
  const has2 = (...keys) => keys.every((k) => Object.prototype.hasOwnProperty.call(x, k));
  const tol = opts.tolerance ?? (isObj5(x.tolerance) ? x.tolerance : void 0);
  if (has2("twin_sha256")) {
    engine = "twin";
    if (opts.document === void 0) return { not: "a twin verdict's inputs commit to the filing by its sha256, not its text: supply the iXBRL document to re-perform it" };
    const map = [FS_CORE_TWIN_MAP, FS_CORE_TWIN_MAP_V02, FS_CORE_TWIN_MAP_V021].find((m) => `${m.id}@${m.version}` === x.map);
    if (!map) return { not: `no twin map ${String(x.map)} in this build` };
    const statement = (map.binding ?? "document") === "statement";
    if (statement && x.presentation_sha256 !== null && opts.presentation === void 0) {
      return { not: `the twin map ${String(x.map)} binds through the filing's presentation linkbase: supply it (pre / filing summary / schema) to re-perform` };
    }
    run = () => {
      const presentation = statement && opts.presentation ? parseTwinPresentation(opts.presentation, { links: map.links === "strict" ? "strict" : "v0.2" }) : void 0;
      return verifyAgainstTwin(opts.document, x.claims, {
        ...common,
        periodEnd: x.period_end,
        periodToleranceDays: x.period_tolerance_days,
        tolerance: x.tolerance,
        map,
        ...statement ? { presentation: presentation ?? null } : {}
      }).verdict;
    };
  } else if (has2("xml_sha256")) {
    engine = "twin-einvoice";
    if (opts.document === void 0) return { not: "an e-invoice twin verdict's inputs commit to the XML by its sha256, not its text: supply the XML to re-perform it" };
    run = () => verifyEinvoiceTwin(opts.document, x.claims, {
      ...common,
      tolerance: x.tolerance,
      quantityTolerance: x.quantity_tolerance,
      consistency: x.consistency,
      ...typeof x.profile === "string" ? { profile: x.profile } : {}
    }).verdict;
  } else if (has2("action", "sources") && rs.id === "action") {
    engine = "action";
    run = () => verifyAction(x.action, x.sources, common);
  } else if (has2("ap", "policy")) {
    engine = "ap";
    run = () => verifyInvoiceMatch(x.ap, { ...common, policy: x.policy }).verdict;
  } else if (has2("citations", "sources") && rs.id === "legal") {
    engine = "legal";
    run = () => verifyCitations(x.citations, x.sources, common);
  } else if (has2("documents", "ruleset")) {
    engine = "reconcile";
    run = () => reconcile(x.documents, x.ruleset, { now });
  } else if (has2("extraction", "ruleset") && isDeclarativeRuleset(x.ruleset)) {
    engine = "declarative";
    run = () => verifyDeclarative(x.extraction, x.ruleset, { ...common, ...tol ? { tolerance: tol } : {} });
  } else if (has2("extraction", "references", "source")) {
    const builtin = RULESET_VERSIONS.find((b) => b.id === rs.id && b.version === rs.version) ?? RULESETS.find((b) => b.id === rs.id);
    if (!builtin) return { not: `no built-in ruleset '${rs.id}' in this build (a declarative ruleset's inputs carry the ruleset itself)` };
    engine = `verify:${builtin.id}`;
    const refs = isObj5(x.references) ? x.references : {};
    run = () => verify(x.extraction, {
      ...common,
      ruleset: builtin,
      references: { ...refs.contract !== null && refs.contract !== void 0 ? { contract: refs.contract } : {}, evidence: refs.evidence, history: refs.history },
      ...x.source !== null && x.source !== void 0 ? { source: x.source } : {},
      ...tol ? { tolerance: tol } : {}
    });
  } else {
    return { not: `no engine in this build takes inputs shaped { ${Object.keys(x).sort().join(", ")} } for ruleset ${rs.id}@${rs.version}` };
  }
  let again;
  try {
    again = run();
  } catch (e) {
    return { not: `the ${engine} engine could not run on these inputs (${e.message})` };
  }
  if (legacy) again = { ...again, input_hash: presented.input_hash, verdict_id: presented.verdict_id };
  if (again.ruleset.id !== rs.id || again.ruleset.version !== rs.version) {
    return { not: `this build's ${engine} engine is ruleset ${again.ruleset.id}@${again.ruleset.version}; the verdict is ${rs.id}@${rs.version}, and a check is re-performed only under the ruleset that made it` };
  }
  if (again.input_hash !== presented.input_hash) {
    return { result: { engine, identical: false, first_difference: "input_hash" } };
  }
  const result = compareBodies(presented, again, engine);
  if (legacy) result.annotations = [...result.annotations ?? [], "input_hash", "verdict_id"];
  return { result };
}
function compareBodies(presented, again, engine) {
  const strip = (v) => {
    const { issued_at: _t, ...rest } = v;
    for (const k of ANNOTATIONS) delete rest[k];
    return rest;
  };
  const a = strip(again);
  const p = strip(presented);
  const annotations = [
    ...ANNOTATIONS.filter((k) => presented[k] !== void 0),
    ...typeof presented.document?.producer === "string" ? ["document.producer"] : []
  ];
  const identical = canonicalize(a) === canonicalize(p);
  const first = identical ? void 0 : firstDifference(a, p, "") ?? "(canonical bytes)";
  return { engine, identical, ...first !== void 0 ? { first_difference: first } : {}, ...annotations.length ? { annotations } : {} };
}
function firstDifference(a, b, path) {
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return path || "(root)";
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i++) {
      if (i >= a.length || i >= b.length) return `${path}[${i}]`;
      const d = firstDifference(a[i], b[i], `${path}[${i}]`);
      if (d !== void 0) return d;
    }
    return void 0;
  }
  if (isObj5(a) && isObj5(b)) {
    const keys = [...Object.keys(a), ...Object.keys(b).filter((k) => !Object.prototype.hasOwnProperty.call(a, k))];
    for (const k of keys) {
      const d = firstDifference(a[k], b[k], path ? `${path}.${k}` : k);
      if (d !== void 0) return d;
    }
    return void 0;
  }
  return canonicalize(a) === canonicalize(b) ? void 0 : path || "(root)";
}

// packages/verify/src/opinion/dispute.ts
var fmt = (v) => v === void 0 ? "\u2014" : JSON.stringify(v);
var realNorms = (e) => (e.normalizations ?? []).filter((n) => !n.startsWith("already_"));
function aggregate(v, claims = v.claims) {
  return aggregateOutcome(v.aggregation, claims);
}
function outcomeIf(v, claim, as) {
  return aggregate(v, v.claims.map((c) => c === claim ? { outcome: as, kind: c.kind } : c));
}
function overturnsToFlag(n, o, minReviewed, threshold) {
  for (let x = 0; x < 1e6; x++) if (n + x >= minReviewed && (o + x) / (n + x) >= threshold) return x;
  return 1e6;
}
function upheldToUnflag(n, o, threshold) {
  for (let y = 1; y < 1e6; y++) if (o / (n + y) < threshold) return y;
  return 1e6;
}
function disputeOpinion(input) {
  const { snapshot, scope, trusted_keys, root_keys, ...rest } = input;
  return disputeOpinionOnView(openSnapshot(snapshot, { ...scope ? { scope } : {}, ...trusted_keys ? { trusted_keys } : {}, ...root_keys?.length ? { root_keys } : {} }), rest);
}
function disputeOpinionOnView(view, input) {
  const rec = view.records.find((r) => (recordFacts(r) ?? r.verdict).verdict_id === input.verdict_id);
  if (!rec) {
    throw new Error(view.scope ? `verdict ${input.verdict_id} is not on tenant ${view.scope.tenant_id}'s book of record; an opinion is only given on the tenant's own recorded verdict` : `verdict ${input.verdict_id} is not on the supplied book of record; an opinion is only given on a recorded verdict`);
  }
  const v = rec.verdict;
  const claim = input.claim_id !== void 0 ? v.claims.find((c) => c.claim_id === input.claim_id) : v.claims.find((c) => c.outcome === v.outcome) ?? v.claims.find((c) => c.outcome === "FAIL") ?? v.claims[0];
  if (!claim) throw new Error(input.claim_id !== void 0 ? `verdict ${v.verdict_id} has no claim ${input.claim_id}` : `verdict ${v.verdict_id} has no claims to dispute`);
  const minReviewed = input.precedent?.min_reviewed ?? 5;
  const threshold = input.precedent?.flag_threshold ?? 0.2;
  const confidence = input.confidence ?? 0.95;
  const method = input.method ?? "wilson";
  const domain = v.ruleset.domain;
  const verb = claim.outcome === "FAIL" ? "FAILed" : claim.outcome === "PASS" ? "PASSed" : "abstained";
  const reasoned = claim.tier !== "DETERMINISTIC";
  const recordById = new Map(view.records.map((r) => [(recordFacts(r) ?? r.verdict).verdict_id, r]));
  const verdictsOf = (ids) => new Map(ids.flatMap((id) => {
    const r = recordById.get(id);
    return r ? [[id, r.verdict]] : [];
  }));
  const prec = view.records.filter((r) => r.review && r.verdict.verdict_id !== v.verdict_id && r.verdict.ruleset.domain === domain && r.verdict.outcome === claim.outcome && r.verdict.claims.some((c) => c.rule_id === claim.rule_id && c.outcome === claim.outcome)).sort((x, y) => Number(y.review.decision === "OVERTURNED") - Number(x.review.decision === "OVERTURNED") || y.review.decided_at.localeCompare(x.review.decided_at) || x.verdict.verdict_id.localeCompare(y.verdict.verdict_id));
  const pn = prec.length;
  const po = prec.filter((r) => r.review.decision === "OVERTURNED").length;
  const pu = pn - po;
  const flagged = claim.outcome !== "INSUFFICIENT_DATA" && pn >= minReviewed && po / pn >= threshold;
  const piv = rateInterval(po, pn, confidence, method);
  const overturnedIds = prec.filter((r) => r.review.decision === "OVERTURNED").map((r) => r.verdict.verdict_id);
  const premises = [];
  premises.push(chainPremise("P1", view));
  premises.push(replayPremise("P2", "disputed", [v.verdict_id], verdictsOf([v.verdict_id]), { allowReasoned: reasoned }));
  let next = 3;
  if (input.inputs !== void 0) {
    const rp = verifyReplay(v, input.inputs);
    premises.push({
      id: `P${next++}`,
      statement: `Verdict \`${v.verdict_id}\` is FOR the supplied inputs: its input_hash re-derives from them.`,
      check: "verifyReplay (protocol/replay) with inputs",
      refs: [view.refOf(v.verdict_id)],
      verified: rp.ok,
      detail: rp.ok ? "input binding verified" : rp.reason ?? "input binding failed"
    });
  }
  const pClaim = `P${next++}`;
  const invariantErrors = [];
  if (claim.outcome === "INSUFFICIENT_DATA") {
    if (!claim.insufficiency) invariantErrors.push("an abstention without an explained insufficiency");
  } else {
    if (claim.evidence.length === 0) invariantErrors.push(`${claim.outcome} without evidence`);
    if (claim.insufficiency) invariantErrors.push(`${claim.outcome} carrying an insufficiency`);
    if (claim.tier !== "DETERMINISTIC" && claim.tier !== "REASONED") invariantErrors.push(`tier ${claim.tier}`);
    const guessed = claim.evidence.filter((e) => e.confidence < MIN_VERDICT_CONFIDENCE);
    if (guessed.length) invariantErrors.push(`${guessed.length} operand(s) below confidence ${MIN_VERDICT_CONFIDENCE}`);
  }
  const claimDesc = claim.outcome === "INSUFFICIENT_DATA" ? `abstained: ${claim.insufficiency?.reason ?? "?"} (${claim.insufficiency?.detail ?? claim.explanation})` : `${claim.outcome}: ${claim.explanation}`;
  premises.push({
    id: pClaim,
    statement: `Claim \`${claim.claim_id}\` (${claim.rule_name}, rule \`${claim.rule_id}\`) ${claimDesc}. Its ${claim.evidence.length} cited cell(s) are exact-path bindings${claim.outcome === "INSUFFICIENT_DATA" ? " (or none)" : ` at confidence \u2265 ${MIN_VERDICT_CONFIDENCE}`}.`,
    check: reasoned ? "the schema invariants (evidence on PASS/FAIL; insufficiency iff abstained; no guessed operand); REASONED tier: an advisory" : "the schema invariants (evidence on PASS/FAIL; insufficiency iff abstained; DETERMINISTIC tier; no guessed operand)",
    refs: [view.refOf(v.verdict_id)],
    verified: invariantErrors.length === 0,
    detail: invariantErrors.length === 0 ? "claim invariants hold" : invariantErrors.join("; ")
  });
  const pAgg = `P${next++}`;
  const agg = aggregate(v);
  const cov = v.coverage;
  const counts = { pass: v.claims.filter((c) => c.outcome === "PASS").length, fail: v.claims.filter((c) => c.outcome === "FAIL").length, ins: v.claims.filter((c) => c.outcome === "INSUFFICIENT_DATA").length };
  const aggOk = agg === v.outcome && cov.claims_pass === counts.pass && cov.claims_fail === counts.fail && cov.claims_insufficient === counts.ins && cov.claims_total === v.claims.length;
  premises.push({
    id: pAgg,
    statement: `The document outcome ${v.outcome} follows from its ${v.claims.length} claim(s) under ${v.aggregation} (${counts.pass} PASS \xB7 ${counts.fail} FAIL \xB7 ${counts.ins} can't-tell).`,
    check: "the aggregation rule, recomputed from the claims",
    refs: [view.refOf(v.verdict_id)],
    verified: aggOk,
    detail: aggOk ? "aggregation and coverage recompute" : `recomputed ${agg} with ${JSON.stringify(counts)} against recorded ${v.outcome} / ${JSON.stringify(cov)}`
  });
  const pPrec = `P${next++}`;
  const precIds = prec.map((r) => r.verdict.verdict_id);
  const precReplay = replayPremise(pPrec, "precedent", precIds, verdictsOf(precIds));
  premises.push({
    id: pPrec,
    statement: `Precedent for \`${claim.rule_id}\` in '${domain}': ${pn} reviewed ${claim.outcome} verdict(s) on which it ${verb}; ${pu} upheld, ${po} overturned.${pn ? ` Each replays.` : ""}`,
    check: `${precReplay.check}, read from the ledger's REVIEW events`,
    refs: [...precReplay.refs, ...overturnedIds.map((id) => view.refOf(id))],
    verified: precReplay.verified && view.content_verified,
    detail: !view.content_verified ? "precedent read from an unverified record set" : precReplay.detail
  });
  const pPrior = `P${next++}`;
  const own = view.eventsFor(v.verdict_id).review;
  premises.push({
    id: pPrior,
    statement: rec.review ? `A person has already ruled on this verdict: ${rec.review.decision} (${rec.review.reviewer_id}, ${rec.review.decided_at})${rec.review.note ? `: "${rec.review.note}"` : ""}.` : "No person has ruled on this verdict yet.",
    check: "the ledger's REVIEW events (openSnapshot.eventsFor)",
    refs: [view.refOf(v.verdict_id)],
    verified: view.content_verified && (rec.review ? own !== void 0 : own === void 0),
    detail: view.content_verified ? "read from a content-verified chain" : "read from an unverified record set"
  });
  const formula = claim.computation?.formula ?? claim.rule_name;
  const tol = claim.computation?.tolerance;
  const tolText = tol ? ` (tolerance${tol.abs !== void 0 ? ` \xB1${tol.abs}` : ""}${tol.rel !== void 0 ? ` rel ${tol.rel}` : ""})` : "";
  const cells = [
    { cell: `${claim.field}: asserted side`, value: claim.asserted, premise: pClaim },
    ...claim.computation ? [{ cell: "expected side (recomputed / reference)", value: claim.computation.result, premise: pClaim }] : [],
    ...claim.variance !== void 0 ? [{ cell: "variance (asserted \u2212 expected)", value: claim.variance, premise: pClaim }] : [],
    ...tol?.abs !== void 0 ? [{ cell: "tolerance (abs)", value: tol.abs, premise: pClaim }] : [],
    ...claim.evidence.map((e) => ({
      cell: e.locator.kind === "field" ? `${e.locator.source}:${e.locator.path} (confidence ${e.confidence}${realNorms(e).length ? `; ${realNorms(e).join(", ")}` : ""})` : `span ${short(e.locator.source_hash)}[${e.locator.start}..${e.locator.end}] (confidence ${e.confidence})`,
      value: e.value,
      premise: pClaim
    })),
    ...claim.insufficiency ? [{ cell: "insufficiency", value: `${claim.insufficiency.reason}: ${claim.insufficiency.detail}`, premise: pClaim }] : []
  ];
  const held = v.outcome === "FAIL" ? "the FAIL is surfaced at record and advise, and holds the action at gate and autonomy" : v.outcome === "INSUFFICIENT_DATA" ? "the abstention is surfaced at record and advise, and holds the action at gate and autonomy" : "the action goes where the rung sends a PASS";
  let readings;
  if (reasoned) {
    readings = [
      { id: "A", label: "The advisory stands", statement: `The judgement-tier finding stands as advice: ${claim.explanation}`, cells, consequence: "People and agents may proceed with the data. The advisory stays on record, shown with the evidence it rests on; it never held the action." },
      { id: "B", label: "Dismiss the advisory", statement: "The judgement is wrong, or does not matter for this document.", cells, consequence: "It is dismissed. Nothing about the action changes, because an advisory never held it." }
    ];
  } else if (claim.outcome === "FAIL") {
    const alt = outcomeIf(v, claim, "PASS");
    readings = [
      { id: "A", label: "The FAIL stands", statement: `The two sides of \`${formula}\` disagree for \`${claim.field}\`: ${fmt(claim.asserted)} against ${fmt(claim.computation?.result)}${claim.variance !== void 0 ? ` (variance ${claim.variance})` : ""}${tolText}. The document, as extracted, is wrong here.`, cells, consequence: `The document stays ${v.outcome}; ${held}.` },
      { id: "B", label: "Overturn: the check is wrong here", statement: `The document is right and the check misread it: an operand was bound or normalized wrongly, or \`${claim.rule_id}\` is not the right rule for this document (a question of LAW).`, cells, consequence: `This claim would count as PASS; the document outcome would become ${alt}${alt === "FAIL" ? " (other claims still FAIL it)" : ""}.` }
    ];
  } else if (claim.outcome === "PASS") {
    readings = [
      { id: "A", label: "The PASS stands", statement: `The two sides of \`${formula}\` agree for \`${claim.field}\`: ${fmt(claim.asserted)} against ${fmt(claim.computation?.result)}${tolText}.`, cells, consequence: `The document stays ${v.outcome}; ${held}.` },
      { id: "B", label: "Overturn: the check missed an error", statement: `The cited values are as bound, but the assertion is wrong in a way \`${claim.rule_id}\` does not see, or a cited value is wrong at its source.`, cells, consequence: "This claim would count as FAIL; the document outcome would become FAIL." }
    ];
  } else {
    const missing = claim.insufficiency?.missing?.length ? claim.insufficiency.missing.join(", ") : "the missing input";
    readings = [
      { id: "A", label: "The abstention stands", statement: `The check could not run: ${claim.insufficiency?.reason ?? "INSUFFICIENT_DATA"} (${claim.insufficiency?.detail ?? claim.explanation}).`, cells, consequence: "A person decides this claim; nothing acts on it automatically." },
      { id: "B", label: "Overturn: the data suffices", statement: `${missing} was in fact available (under another name, or in a reference not supplied), so the check should have run.`, cells, consequence: "The rule would run on that data; no ruling can say how it comes out. Only a re-run, which is a new verdict with a new id, can." }
    ];
  }
  const authorities = [
    { source: "ruleset", cite: `${v.ruleset.id}@${v.ruleset.version} (${domain}) \xB7 ${claim.rule_id}`, quote: `${claim.rule_name}: ${formula}${tolText}` },
    { source: "verdict schema", cite: "VERDICT-SCHEMA v0 \xA7design rules 2\u20133", quote: "Three outcomes, never a fourth. PASS (the check ran and held) \xB7 FAIL (the check ran and did not hold) \xB7 INSUFFICIENT_DATA (the check could not run \u2014 the inputs did not permit a determination). \u2026 ANY_FAIL_FAILS: FAIL if any claim FAILs; else INSUFFICIENT_DATA if no claim could run; else PASS" },
    ...claim.outcome !== "INSUFFICIENT_DATA" ? [{ source: "verdict schema", cite: "VERDICT-SCHEMA v0 \xA7honesty rules", quote: `A verdict is never issued on a guessed field. \u2026 any PASS/FAIL resting on an operand below ${MIN_VERDICT_CONFIDENCE} becomes INSUFFICIENT_DATA / AMBIGUOUS_FIELD, with the guessed operand still shown so the developer can name it properly.` }] : [],
    { source: "Riposte earned-voice doctrine", cite: "VERDICT-SCHEMA v0.1 \xA7opinions", quote: "The deterministic check settles FACT, and FACT replays. Whether a rule applies to a document is LAW, and a ruling on LAW is a person's. Riposte proposes; a person signs or overrules." },
    ...reasoned ? [{ source: "Riposte channel doctrine", cite: "VERDICT-SCHEMA v0.1 \xA7typed channels", quote: "Judgement-tier findings are COUNSEL, never VERDICT: advisories with a strength, shown with the evidence they rest on, and they never hold the action." }] : []
  ];
  const whose = view.scope ? ` (tenant \`${view.scope.tenant_id}\`'s own record)` : "";
  const precedent = {
    summary: pn === 0 ? `No reviewed ${claim.outcome} verdict in '${domain}'${whose} on which \`${claim.rule_id}\` ${verb}: this rule has no precedent yet.` : `${pn} reviewed ${claim.outcome} verdict(s) in '${domain}'${whose} on which \`${claim.rule_id}\` ${verb}: ${pu} upheld, ${po} overturned (${pct2(po / pn)}; ${pct2(confidence)} one-sided ${method} bounds [${pct2(piv.lower)}, ${pct2(piv.upper)}]). ${flagged ? `At or above the review-queue threshold (\u2265 ${minReviewed} reviewed, \u2265 ${pct2(threshold)} overturned).` : `Below the review-queue threshold (\u2265 ${minReviewed} reviewed, \u2265 ${pct2(threshold)} overturned).`} Attribution is a heuristic: a review is credited to every rule that ${verb} on the verdict, because the ledger does not record which rule a reviewer disagreed with.`,
    entries: prec.map((r) => ({
      verdict_id: r.verdict.verdict_id,
      outcome: r.verdict.outcome,
      decision: r.review.decision,
      reviewer_id: r.review.reviewer_id,
      decided_at: r.review.decided_at,
      ...r.review.note !== void 0 ? { note: r.review.note } : {},
      ref: view.refOf(r.verdict.verdict_id),
      dispute: disputeCommand(r.verdict.verdict_id, r.verdict.claims.find((c) => c.rule_id === claim.rule_id && c.outcome === claim.outcome)?.claim_id)
    }))
  };
  const scope = `Claim \`${claim.claim_id}\` of verdict \`${v.verdict_id}\` only (${v.ruleset.id}@${v.ruleset.version}, engine ${v.engine_version}). FACT (the recomputation) is never re-ruled: it replays. A signed ruling on LAW here becomes precedent for \`${claim.rule_id}\` in '${domain}'${view.scope ? ` for tenant \`${view.scope.tenant_id}\`` : ""}.`;
  let ruling;
  if (reasoned) {
    ruling = { disposition: "REFER", favors: null, status: "PROPOSED", scope, takes_effect: "nothing changes: an advisory never holds the action", statement: "Referred: this is a judgement-tier finding, advice and never a VERDICT. It did not hold the action. Whether to act on it or dismiss it is a person's decision." };
  } else if (claim.outcome === "INSUFFICIENT_DATA") {
    ruling = { disposition: "UPHOLD", favors: "A", status: "PROPOSED", scope, takes_effect: "nothing changes", statement: `Upheld: the abstention stands. A ruling cannot manufacture data; supply ${claim.insufficiency?.missing?.join(", ") || "what is missing"} and re-run (a new verdict, a new id).` };
  } else if (flagged) {
    ruling = { disposition: "REFER", favors: null, status: "PROPOSED", scope, takes_effect: "nothing changes until a person rules on the LAW question", statement: `Referred: the FACT stands (the recomputation replays on exact-path operands), but \`${claim.rule_id}\` is on the review queue: people overturned ${po} of ${pn} reviewed ${claim.outcome} verdict(s) it drove. Whether it is the right rule for this document is LAW, and it goes to a person.` };
  } else {
    ruling = { disposition: "UPHOLD", favors: "A", status: "PROPOSED", scope, takes_effect: "nothing changes unless a person overrules", statement: `Upheld: the ${claim.outcome} stands. It is deterministic, replays, and rests on exact-path operands; the rule's precedent (${pu} upheld, ${po} overturned of ${pn}) gives no ground to refer it.` };
  }
  if (rec.review) ruling.note = `A person has already ruled on this verdict (${rec.review.decision}, ${rec.review.reviewer_id}, ${rec.review.decided_at}). An opinion never overrules a person; their ruling stands over this proposal.`;
  const dissent = [];
  const arguesFor = ruling.disposition === "REFER" ? "upholding" : "overturning";
  dissent.push({ topic: "sample_size", premise: pPrec, argument: pn === 0 ? `There is no precedent at all for \`${claim.rule_id}\`: nothing on the record says how often people agree with it.` : `The precedent is ${pn} review(s)${pn < minReviewed ? `, under the ${minReviewed} the review queue asks for: too thin to clear the rule or to flag it` : ""}, and each is credited heuristically (a review of a verdict counts for every rule that ${verb} on it), so fewer than ${pn} of them may be rulings about \`${claim.rule_id}\` itself.` });
  dissent.push({ topic: "confidence_interval", premise: pPrec, argument: pn === 0 ? "With no reviews, the overturn rate could be anything from 0% to 100%." : `The ${pct2(confidence)} one-sided ${method} bounds on how often people overturn \`${claim.rule_id}\` are [${pct2(piv.lower)}, ${pct2(piv.upper)}]${arguesFor === "overturning" ? `: the rule may be wrong as often as ${pct2(piv.upper)} of the time` : `: it may be wrong as rarely as ${pct2(piv.lower)} of the time`}.` });
  dissent.push({ topic: "counter_cases", premise: pPrec, argument: arguesFor === "overturning" ? po ? `${po} time(s) a person overturned this rule's ${claim.outcome} (${overturnedIds.slice(0, 8).map((x) => `\`${short(x)}\``).join(", ")}${overturnedIds.length > 8 ? ", \u2026" : ""}).` : "No person has overturned this rule yet, so there is no counter-case to point to; the dissent rests on the reading itself." : `${pu} time(s) people upheld this rule's ${claim.outcome}; the overturns may share a cause (a document type the rule does not describe) that this document does not have.` });
  dissent.push({ topic: "consequence_tier", argument: input.consequence ? `The workflow is declared tier '${input.consequence.tier}'${input.consequence.description ? ` (${input.consequence.description})` : ""}; ${claim.outcome === "FAIL" ? "a wrong FAIL holds legitimate work at that stake" : claim.outcome === "PASS" ? "a wrong PASS lets an error through at that stake" : "an abstention costs a person's time at that stake"}.` : `No consequence tier is declared for this dispute; the stake visible on the verdict is ${claim.variance !== void 0 ? `a variance of ${claim.variance}` : "not stated"}.` });
  if (claim.outcome === "FAIL") {
    if (claim.variance !== void 0 && tol?.abs !== void 0) dissent.push({ topic: "tolerance", premise: pClaim, argument: `The miss is ${Math.abs(claim.variance)} against a tolerance of ${tol.abs}${Math.abs(claim.variance) <= tol.abs * 10 ? ": close enough that a rounding convention the rule does not know could explain it" : ""}.` });
    const normed = claim.evidence.filter((e) => realNorms(e).length);
    if (normed.length) dissent.push({ topic: "normalization", premise: pClaim, argument: `${normed.length} operand(s) were normalized before comparison (${[...new Set(normed.flatMap(realNorms))].join(", ")}). A normalization is a reading, and a misreading would flip this claim.` });
    dissent.push({ topic: "law", argument: `The recomputation is FACT, but whether \`${claim.rule_id}\` should bind this document is LAW. A document the ruleset does not describe (a credit note, a partial shipment, a negotiated exception) can fail a rule it was never meant to meet.` });
  } else if (claim.outcome === "PASS") {
    if (cov.claims_insufficient > 0) dissent.push({ topic: "coverage", premise: pAgg, argument: `${cov.claims_insufficient} claim(s) on this verdict could not run. A PASS covers only what ran.` });
    if (claim.variance !== void 0 && claim.variance !== 0) dissent.push({ topic: "tolerance", premise: pClaim, argument: `A variance of ${claim.variance} was absorbed by the tolerance${tolText}; a tolerance too wide for this workflow hides real errors.` });
    dissent.push({ topic: "law", argument: `The ruleset checks only its own rules. An error it has no rule for passes \`${claim.rule_id}\` untouched.` });
  } else {
    dissent.push({ topic: "law", argument: "The field may be present under a name the ruleset does not know. An abstention caused by naming is a vocabulary gap, not a real absence." });
  }
  const overturn = [];
  if (claim.outcome === "INSUFFICIENT_DATA") {
    overturn.push({ premise: pClaim, evidence: `supplying ${claim.insufficiency?.missing?.join(", ") || "the missing input"} (or naming it as the ruleset expects)`, effect: "the rule runs; a re-run is a new verdict with a new id, and this abstention stays on the record as what was known then" });
  } else {
    const field = claim.evidence.find((e) => e.locator.kind === "field" && e.locator.source !== "computed") ?? claim.evidence.find((e) => e.locator.kind === "field");
    if (field && field.locator.kind === "field") overturn.push({ premise: pClaim, evidence: `the source document showing a cited cell was bound wrongly (e.g. \`${field.locator.source}:${field.locator.path}\` is not ${fmt(field.value)})`, effect: `the operand is corrected and the claim is re-run (a new verdict); if it then ${claim.outcome === "FAIL" ? "holds, this FAIL was a misread" : "fails, this PASS was a miss"}` });
    if (claim.outcome === "FAIL" && typeof claim.asserted === "number" && typeof claim.computation?.result === "number") {
      overturn.push({ premise: pClaim, evidence: `a reading of the cited cells under which the expected value lands within${tol?.abs !== void 0 ? ` \xB1${tol.abs}` : " tolerance"} of the asserted ${claim.asserted} (the check expected ${claim.computation.result})`, effect: "the claim holds; the FAIL was a misread" });
    }
    if (claim.outcome === "PASS" && tol) overturn.push({ premise: pClaim, evidence: `a signed ruling that the tolerance${tolText} is too wide for this workflow`, effect: "the rule is re-issued with a tighter tolerance (a new ruleset version) and verdicts re-run" });
    overturn.push({ evidence: `a person's signed ruling that \`${claim.rule_id}\` does not apply to this document`, effect: `the ${claim.outcome} is set aside for this document, and the ruling becomes precedent for \`${claim.rule_id}\` in '${domain}'` });
    if (ruling.disposition === "REFER") {
      overturn.push({ premise: pPrec, evidence: `${upheldToUnflag(pn, po, threshold)} more upheld review(s) of \`${claim.rule_id}\``, effect: "the rule leaves the review queue; a new opinion would propose UPHOLD" });
    } else {
      overturn.push({ premise: pPrec, evidence: `${overturnsToFlag(pn, po, minReviewed, threshold)} more overturned review(s) of \`${claim.rule_id}\`'s ${claim.outcome}s`, effect: "the rule reaches the review queue; a new opinion would REFER instead of UPHOLD" });
    }
  }
  overturn.push({ premise: "P1", evidence: "the ledger failing its integrity check (verifyContent)", effect: "every premise read from it is void; the opinion is withheld" });
  const title = `Dispute: \`${claim.claim_id}\` on verdict \`${short(v.verdict_id, 16)}\``;
  const question = `Verdict \`${v.verdict_id}\` (${v.ruleset.id}@${v.ruleset.version}) records claim \`${claim.claim_id}\` (${claim.rule_name}) as ${claim.outcome}. It is disputed. Should the ${claim.outcome === "INSUFFICIENT_DATA" ? "abstention" : claim.outcome} stand?`;
  return finalizeOpinion({
    subject: {
      kind: "DISPUTE",
      verdict_id: v.verdict_id,
      claim_id: claim.claim_id,
      rule_id: claim.rule_id,
      outcome: claim.outcome,
      tier: reasoned ? "REASONED" : "DETERMINISTIC",
      ruleset: { id: v.ruleset.id, version: v.ruleset.version, domain },
      precedent_rule: { min_reviewed: minReviewed, flag_threshold: threshold, confidence, method },
      ...input.consequence ? { consequence: { tier: input.consequence.tier, ...input.consequence.description !== void 0 ? { description: input.consequence.description } : {} } } : {},
      ...input.inputs !== void 0 ? { input_bound: true } : {},
      ...view.scope ? { tenant_id: view.scope.tenant_id } : {}
    },
    title,
    question,
    readings,
    authorities,
    precedent,
    ruling,
    dissent,
    overturn,
    premises
  }, sourceHashOf(view));
}

// packages/verify/src/opinion/render.ts
function refText(r) {
  switch (r.kind) {
    case "verdict": {
      const ev = [r.record_event ? `record #${r.record_event.seq} \`${short(r.record_event.entry_hash, 10)}\`` : "", r.review_event ? `review #${r.review_event.seq} \`${short(r.review_event.entry_hash, 10)}\`` : ""].filter(Boolean).join(", ");
      return `verdict \`${short(r.verdict_id, 16)}\`${ev ? ` (${ev})` : ""}`;
    }
    case "evidence_set":
      return `${r.label}: ${r.count} verdict(s), set \`${short(r.hash)}\``;
    case "ledger_head":
      return `ledger head \`${short(r.head)}\` (${r.length} events)`;
    case "policy":
      return `policy ${r.policy_id}@${r.version} \`${short(r.hash)}\``;
    case "calibration":
      return `calibration \`${short(r.hash)}\``;
    case "decision":
      return `${r.decision_kind} \`${short(r.decision_id)}\` (#${r.seq} \`${short(r.entry_hash, 10)}\`)`;
  }
}
var cellValue = (v) => v === null ? "\u2014" : typeof v === "number" ? String(Number(v.toPrecision(6))) : typeof v === "string" ? v : JSON.stringify(v);
var esc = (s) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
function renderOpinion(o) {
  const ok2 = o.premises.filter((p) => p.verified).length;
  const L = [];
  L.push(`# Opinion: ${o.title}`, "");
  const tenant = o.subject.tenant_id !== void 0 ? ` \xB7 tenant \`${o.subject.tenant_id}\`` : "";
  L.push(`\`opinion ${o.opinion_id}\` \xB7 **COUNSEL** (generated by ${o.provenance.generator} ${o.provenance.generator_version}; dismissible) \xB7 status **${o.ruling.status}**${o.ruling.urgent ? " \xB7 **URGENT**" : ""} \xB7 disposition **${o.ruling.disposition}**${tenant} \xB7 premises verified: ${ok2 === o.premises.length ? "\u2713" : "\u2717"} ${ok2}/${o.premises.length}`, "");
  L.push("> Riposte proposes; a person decides. The rung, and every ruling, change only by a person's decision. The verdicts cited are FACT: they replay. This opinion is advice about what follows from them, and every premise it rests on is checked by Riposte's own code (listed at the end).", "");
  L.push("## The question", "", o.question, "");
  L.push("## The candidate readings", "");
  const seen = /* @__PURE__ */ new Map();
  const key = (c) => JSON.stringify([c.cell, c.value, c.premise]);
  for (const r of o.readings) {
    L.push(`### Reading ${r.id}: ${r.label}`, "", r.statement, "");
    const fresh = r.cells.filter((c) => !seen.has(key(c)));
    const shared = [...new Set(r.cells.filter((c) => seen.has(key(c))).map((c) => seen.get(key(c))))];
    if (shared.length) L.push(`_Cites the same cells as Reading ${shared.join(", ")}${fresh.length ? ", plus:" : "."}_`, "");
    if (fresh.length) {
      L.push("| cell | value | premise |", "|---|---|---|");
      for (const c of fresh) L.push(`| ${esc(c.cell)} | ${esc(cellValue(c.value))} | ${c.premise} |`);
      L.push("");
    }
    for (const c of r.cells) if (!seen.has(key(c))) seen.set(key(c), r.id);
  }
  L.push("## The authorities", "");
  for (const a of o.authorities) L.push(`- **${a.source}** (${a.cite}): "${a.quote}"`);
  L.push("");
  L.push("## Precedent", "", o.precedent.summary, "");
  const shown2 = o.precedent.entries.slice(0, 12);
  for (const e of shown2) {
    L.push(`- \`${short(e.verdict_id, 16)}\` ${e.outcome} \u2192 **${e.decision}**${e.reviewer_id ? ` by ${e.reviewer_id}` : ""}${e.decided_at ? ` at ${e.decided_at}` : ""}${e.note ? `: "${e.note}"` : ""} (${refText(e.ref)}) \xB7 dispute: \`${e.dispute}\``);
  }
  if (o.precedent.entries.length > shown2.length) L.push(`- \u2026 ${o.precedent.entries.length - shown2.length} more in the JSON`);
  if (shown2.length) L.push("");
  L.push("## The footing consequences of each reading", "");
  for (const r of o.readings) L.push(`- **Reading ${r.id} (${r.label}):** ${r.consequence}`);
  L.push("");
  L.push("## The ruling and its scope", "");
  L.push(`**${o.ruling.statement}**`, "");
  L.push(`- **Scope:** ${o.ruling.scope}`);
  L.push(`- **Takes effect:** ${o.ruling.takes_effect}`);
  if (o.ruling.favors) L.push(`- **Adopts:** Reading ${o.ruling.favors}`);
  const declinedLabel = o.subject.kind !== "PROMOTION" ? "Declined by" : o.subject.question_kind === "PROMOTE" ? "Not now" : "Kept by";
  if (o.ruling.declined) L.push(`- **${declinedLabel}:** ${o.ruling.declined.signer_id} at ${o.ruling.declined.signed_at} (DECLINE \`${short(o.ruling.declined.decision_id)}\`, seq ${o.ruling.declined.seq}): "${o.ruling.declined.reason}"; stands until ${o.ruling.declined.re_raise_when}`);
  if (o.subject.kind === "PROMOTION" && o.subject.amends) L.push(`- **Amends:** GRANT \`${short(o.subject.amends.decision_id)}\` (seq ${o.subject.amends.seq}), the grant in force on the book of record`);
  if (o.ruling.note) L.push(`- **Note:** ${o.ruling.note}`);
  L.push("");
  L.push("## The steelmanned dissent", "");
  for (const d of o.dissent) L.push(`- **${d.topic.replace(/_/g, " ")}.** ${d.argument}${d.premise ? ` _(${d.premise})_` : ""}`);
  L.push("");
  L.push("## What would overturn it", "");
  for (const c of o.overturn) L.push(`- ${c.evidence} \u2192 ${c.effect}${c.premise ? ` _(${c.premise})_` : ""}`);
  L.push("");
  L.push("## Premises, each verified by Riposte's own checks", "");
  L.push("| # | premise | check | replayable refs | |", "|---|---|---|---|:-:|");
  for (const p of o.premises) {
    L.push(`| ${p.id} | ${esc(p.statement)} | ${esc(p.check)} | ${esc(p.refs.map(refText).join("; ") || "\u2014")} | ${p.verified ? "\u2713" : `\u2717 ${esc(p.detail)}`} |`);
  }
  L.push("", `_Source: \`${short(o.provenance.source_hash, 16)}\`. The full opinion, with every verdict id behind each evidence set, is the JSON; its id re-derives from its content._`, "");
  return L.join("\n");
}

// packages/verify/src/mine/grammar.ts
var DEFAULT_T_GRID = [0, 5e-3, 0.01, 0.02, 0.03, 0.05, 0.1];
var DEFAULT_EPS = { qty: 1e-9, money: 5e-3 };
var IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
var RESERVED = /* @__PURE__ */ new Set(["sum", "abs", "line_items"]);
var TYPES = /* @__PURE__ */ new Set(["qty", "money", "bool", "id", "ids"]);
function validateSchema(schema) {
  if (!schema || typeof schema !== "object") throw new Error("schema must be an object");
  const approve = Array.isArray(schema.approve) ? schema.approve : [schema.approve];
  if (!approve.length || !approve.every((a) => typeof a === "string" && a.length > 0)) throw new Error("schema.approve must be a non-empty label string (or array of them)");
  if (!schema.fields || typeof schema.fields !== "object" || Array.isArray(schema.fields)) throw new Error("schema.fields must be an object");
  const seen = /* @__PURE__ */ new Set();
  const check2 = (name, f, where) => {
    if (!IDENT.test(name) || RESERVED.has(name)) throw new Error(`schema ${where} field "${name}": names must be identifiers ([A-Za-z_][A-Za-z0-9_]*) and not sum/abs/line_items`);
    if (seen.has(name)) throw new Error(`schema field "${name}" is declared twice (document and line names share one namespace)`);
    seen.add(name);
    if (!f || !TYPES.has(f.type)) throw new Error(`schema ${where} field "${name}": type must be one of qty, money, bool, id, ids`);
    if (f.role !== void 0) {
      const ok2 = where === "line" ? f.type === "money" && (f.role === "price" || f.role === "amount") : f.type === "money" && (f.role === "total" || f.role === "extra");
      if (!ok2) throw new Error(`schema ${where} field "${name}": role "${f.role}" is not valid here (line money: price|amount; document money: total|extra)`);
    }
    if (f.eps !== void 0 && !(typeof f.eps === "number" && Number.isFinite(f.eps) && f.eps >= 0)) throw new Error(`schema field "${name}": eps must be a finite number >= 0`);
  };
  for (const [n, f] of Object.entries(schema.fields)) check2(n, f, "document");
  for (const [n, f] of Object.entries(schema.lines ?? {})) check2(n, f, "line");
}
function constSpec(field, dir, c) {
  return dir === "high" ? { scope: "document", form: "rel", op: "<=", left: { field }, right: { const: c }, eps: 0 } : { scope: "document", form: "rel", op: "<=", left: { const: c }, right: { field }, eps: 0 };
}
var approveLabels = (schema) => new Set(Array.isArray(schema.approve) ? schema.approve : [schema.approve]);
var epsOf = (f) => f.eps ?? (f.type === "qty" ? DEFAULT_EPS.qty : DEFAULT_EPS.money);
var dimOf = (f) => f.dim ?? (f.type === "money" && f.role ? `money:${f.role}` : f.type);
var isNumeric = (f) => f.type === "qty" || f.type === "money";
function renderTerm(t) {
  if ("field" in t) return t.field;
  if ("sum" in t) return `sum(${t.sum})`;
  if ("sumProduct" in t) return `sum(${t.sumProduct[0]}*${t.sumProduct[1]})`;
  if ("const" in t) return String(t.const);
  if ("plus" in t) return `${renderTerm(t.plus[0])} + ${renderTerm(t.plus[1])}`;
  return `${t.gated}*[${t.negate ? "not " : ""}${t.by}]`;
}
function buildGrammar(schema, tGrid = DEFAULT_T_GRID, opts = {}) {
  validateSchema(schema);
  const lines = Object.entries(schema.lines ?? {});
  const docs = Object.entries(schema.fields);
  const out = [];
  const dims = /* @__PURE__ */ new Map();
  for (const [n, f] of lines) if (isNumeric(f)) {
    const d2 = dimOf(f);
    if (!dims.has(d2)) dims.set(d2, []);
    dims.get(d2).push([n, f]);
  }
  const ordered = [];
  const unordered = [];
  for (const fs of dims.values()) {
    for (const [x, fx] of fs) for (const [y, fy] of fs) if (x !== y) ordered.push({ x, y, eps: Math.max(epsOf(fx), epsOf(fy)) });
    fs.forEach(([x, fx], i) => {
      for (const [y, fy] of fs.slice(i + 1)) unordered.push({ x, y, eps: Math.max(epsOf(fx), epsOf(fy)) });
    });
  }
  for (const { x, y, eps } of ordered) out.push({ id: `L1 ${x} <= ${y}`, family: "L1", spec: { scope: "line", form: "le", x, y, eps } });
  for (const { x, y, eps } of unordered) out.push({ id: `L2 ${x} = ${y}`, family: "L2", spec: { scope: "line", form: "eq", x, y, eps } });
  for (const { x, y, eps } of ordered) out.push({ id: `L3 ${x} <= ${y}*(1+t)`, family: "L3", spec: { scope: "line", form: "le_tol", x, y, eps }, tGrid: [...tGrid] });
  const sources = [];
  for (const [, f] of lines) {
    const s = f.source ?? "";
    if (!sources.includes(s)) sources.push(s);
  }
  const of = (s, pred) => lines.filter(([, f]) => (f.source ?? "") === s && pred(f)).map(([n]) => n);
  const qtyOf = (s) => of(s, (f) => f.type === "qty");
  const priceOf = (s) => of(s, (f) => f.type === "money" && f.role === "price");
  const amountOf = (s) => of(s, (f) => f.type === "money" && f.role === "amount");
  for (const [a, fa] of lines) {
    if (!(fa.type === "money" && fa.role === "amount")) continue;
    const s = fa.source ?? "";
    for (const q of qtyOf(s)) for (const p of priceOf(s)) out.push({ id: `L4 ${a} = ${q}*${p}`, family: "L4", spec: { scope: "line", form: "product", a, q, p, eps: epsOf(fa) } });
  }
  const lineValue = /* @__PURE__ */ new Map();
  for (const s of sources) {
    const amounts = amountOf(s);
    const terms = amounts.length ? amounts.map((a) => ({ sum: a })) : qtyOf(s).flatMap((q) => priceOf(s).map((p) => ({ sumProduct: [q, p] })));
    if (terms.length) lineValue.set(s, terms);
  }
  const totals = docs.filter(([, f]) => f.type === "money" && f.role === "total");
  const extras = docs.filter(([, f]) => f.type === "money" && f.role === "extra");
  const bools = docs.filter(([, f]) => f.type === "bool").map(([n]) => n);
  const d = (left, op, right, eps) => ({ id: `D ${renderTerm(left)} ${op} ${renderTerm(right)}`, family: "D", spec: { scope: "document", form: "rel", op, left, right, eps } });
  const own = (src) => lineValue.get(src) ?? [];
  const others = (src) => [...lineValue.entries()].filter(([s]) => s !== src).flatMap(([, t]) => t);
  for (const [T, fT] of totals) {
    const src = fT.source ?? "";
    const e = epsOf(fT);
    for (const S of own(src)) {
      out.push(d({ field: T }, "=", S, e));
      for (const [F2] of extras) out.push(d({ field: T }, "=", { plus: [S, { field: F2 }] }, e));
      for (const [F2] of extras) for (const b of bools) out.push(d({ field: T }, "=", { plus: [S, { gated: F2, by: b }] }, e));
    }
    for (const P of others(src)) {
      out.push(d({ field: T }, "<=", P, e));
      out.push(d({ field: T }, "=", P, e));
    }
  }
  for (const [F2, fF] of extras) {
    out.push(d({ field: F2 }, "<=", { const: 0 }, epsOf(fF)));
    for (const b of bools) out.push(d({ gated: F2, by: b, negate: true }, "<=", { const: 0 }, epsOf(fF)));
  }
  const ownSrcs = [...new Set(totals.map(([, f]) => f.source ?? ""))];
  for (const src of ownSrcs) {
    const e = Math.max(...totals.filter(([, f]) => (f.source ?? "") === src).map(([, f]) => epsOf(f)));
    for (const S of own(src)) for (const P of others(src)) out.push(d(S, "<=", P, e));
  }
  const idsF = docs.filter(([, f]) => f.type === "ids").map(([n]) => n);
  const idF = docs.filter(([, f]) => f.type === "id").map(([n]) => n);
  for (const list of idsF) for (const id of idF) out.push({ id: `I1 ${list} cites exactly one id = ${id}`, family: "I1", spec: { scope: "document", form: "ids_one", list, id } });
  idF.forEach((x, i) => {
    for (const y of idF.slice(i + 1)) out.push({ id: `I2 ${x} = ${y}`, family: "I2", spec: { scope: "document", form: "id_eq", x, y } });
  });
  if (opts.thresholds) {
    for (const [X, f] of docs) {
      if (!isNumeric(f)) continue;
      out.push({ id: `C ${X} <= c`, family: "C", spec: constSpec(X, "high", 0), learnConst: { field: X, dir: "high" } });
      out.push({ id: `C ${X} >= c`, family: "C", spec: constSpec(X, "low", 0), learnConst: { field: X, dir: "low" } });
    }
  }
  return out;
}
var num2 = (v) => typeof v === "number" && Number.isFinite(v) ? v : null;
var bool = (v) => v === true || v === 1 ? true : v === false || v === 0 ? false : null;
var normId = (s) => s.replace(/\s+/g, "").toUpperCase();
var one = (v) => {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v !== "string") return null;
  const n = normId(v);
  return n.length ? n : null;
};
var idSet = (v) => {
  if (typeof v === "string" || typeof v === "number") {
    const n = one(v);
    return n === null ? null : /* @__PURE__ */ new Set([n]);
  }
  if (!Array.isArray(v)) return null;
  const out = /* @__PURE__ */ new Set();
  for (const x of v) {
    if (typeof x !== "string" && typeof x !== "number") return null;
    const n = one(x);
    if (n !== null) out.add(n);
  }
  return out;
};
function valueOk(type, v) {
  if (type === "qty" || type === "money") return num2(v) !== null;
  if (type === "bool") return bool(v) !== null;
  if (type === "id") return one(v) !== null;
  return idSet(v) !== null;
}
function evalTerm(t, c) {
  if ("field" in t) return num2(c.fields[t.field]);
  if ("const" in t) return t.const;
  if ("sum" in t || "sumProduct" in t) {
    if (!c.lines) return null;
    let acc = 0;
    for (const l of c.lines) {
      if ("sum" in t) {
        const v = num2(l[t.sum]);
        if (v === null) return null;
        acc = acc + v;
      } else {
        const q = num2(l[t.sumProduct[0]]), p = num2(l[t.sumProduct[1]]);
        if (q === null || p === null) return null;
        acc = acc + q * p;
      }
    }
    return acc;
  }
  if ("plus" in t) {
    const a = evalTerm(t.plus[0], c), b = evalTerm(t.plus[1], c);
    return a === null || b === null ? null : a + b;
  }
  const g = bool(c.fields[t.by]), f = num2(c.fields[t.gated]);
  if (g === null || f === null) return null;
  return (t.negate ? !g : g) ? f : 0;
}
function anyLine(c, f) {
  if (!c.lines) return null;
  let undecided = false;
  for (const l of c.lines) {
    const r = f(l);
    if (r === true) return true;
    if (r === null) undecided = true;
  }
  return undecided ? null : false;
}
function violated(spec, c, t = 0) {
  switch (spec.form) {
    case "le":
      return anyLine(c, (l) => {
        const x = num2(l[spec.x]), y = num2(l[spec.y]);
        return x === null || y === null ? null : x > y + spec.eps;
      });
    case "eq":
      return anyLine(c, (l) => {
        const x = num2(l[spec.x]), y = num2(l[spec.y]);
        return x === null || y === null ? null : Math.abs(x - y) > spec.eps;
      });
    case "le_tol":
      return anyLine(c, (l) => {
        const x = num2(l[spec.x]), y = num2(l[spec.y]);
        return x === null || y === null ? null : x > y * (1 + t) + spec.eps;
      });
    case "product":
      return anyLine(c, (l) => {
        const a = num2(l[spec.a]), q = num2(l[spec.q]), p = num2(l[spec.p]);
        return a === null || q === null || p === null ? null : Math.abs(a - q * p) > spec.eps;
      });
    case "rel": {
      const L = evalTerm(spec.left, c), R = evalTerm(spec.right, c);
      if (L === null || R === null) return null;
      return spec.op === "=" ? Math.abs(L - R) > spec.eps : L > R + spec.eps;
    }
    case "ids_one": {
      const s = idSet(c.fields[spec.list]), id = one(c.fields[spec.id]);
      if (s === null || id === null) return null;
      return !(s.size === 1 && s.has(id));
    }
    case "id_eq": {
      const x = one(c.fields[spec.x]), y = one(c.fields[spec.y]);
      return x === null || y === null ? null : x !== y;
    }
  }
}
function worstRatio(spec, c) {
  if (!c.lines) return null;
  let worst = null;
  for (const l of c.lines) {
    const x = num2(l[spec.x]), y = num2(l[spec.y]);
    if (x === null || y === null) continue;
    const r = y > 0 ? x / y - 1 : x > y + spec.eps ? Infinity : null;
    if (r !== null && (worst === null || r > worst)) worst = r;
  }
  return worst;
}

// packages/verify/src/mine/stats.ts
function hypergeomAllHolds(N, H, k) {
  let p = 1;
  for (let i = 0; i < k; i++) p *= (H - i) / (N - i);
  return p;
}
var logFact = [0];
function lf(n) {
  for (let i = logFact.length; i <= n; i++) logFact.push(logFact[i - 1] + Math.log(i));
  return logFact[n];
}
function logChoose(n, r) {
  return lf(n) - lf(r) - lf(n - r);
}
function hypergeomUpperTail(N, H, k, h) {
  if (![N, H, k, h].every(Number.isInteger) || N < 0 || H < 0 || H > N || k < 0 || k > N) {
    throw new RangeError(`hypergeomUpperTail: invalid arguments N=${N} H=${H} k=${k} h=${h}`);
  }
  const lo = Math.max(0, k - (N - H));
  const hi = Math.min(k, H);
  if (h <= lo) return 1;
  if (h > hi) return 0;
  const denom = logChoose(N, k);
  let s = 0;
  for (let x = h; x <= hi; x++) s += Math.exp(logChoose(H, x) + logChoose(N - H, k - x) - denom);
  return Math.min(1, s);
}
function groundingP(N, H, k, h) {
  return h === k ? hypergeomAllHolds(N, H, k) : hypergeomUpperTail(N, H, k, h);
}

// packages/verify/src/mine/judges.ts
function tally(spec, cases, t = 0) {
  const out = { decidable: 0, decidableHolds: 0, violators: [], holdViolators: [], approved: 0 };
  for (const c of cases) {
    const v = violated(spec, c, t);
    if (v === null) continue;
    out.decidable++;
    if (c.hold) out.decidableHolds++;
    if (!v) continue;
    out.violators.push(c.id);
    if (c.hold) out.holdViolators.push(c.id);
    else out.approved++;
  }
  return out;
}
var allowedApproved = (rate, nApproved) => Math.floor(rate * nApproved + 1e-9);
function judgeConsistency(t, rate) {
  const nA = t.decidable - t.decidableHolds;
  if (t.approved <= allowedApproved(rate, nA)) return { ok: true };
  return { ok: false, detail: rate > 0 ? `${t.approved} approved case(s) violate it (${t.approved}/${nA} > max rate ${rate})` : `${t.approved} approved case(s) violate it` };
}
function learnT(spec, cases, grid, rate) {
  return grid.find((tt) => judgeConsistency(tally(spec, cases, tt), rate).ok);
}
function judgeGrounding(t, g) {
  const k = t.violators.length, h = t.holdViolators.length;
  if (k === 0) return { fate: "VOID", p: 1, detail: t.decidable === 0 ? "no case could evaluate it (values missing)" : "no case violates it (always true here)" };
  const p = groundingP(t.decidable, t.decidableHolds, k, h);
  if (h < g.minHoldViolators || p > g.maxP) {
    const detail = t.approved === 0 ? `k=${k}, p=${p.toExponential(2)} (gate k>=${g.minHoldViolators}, p<=${g.maxP})` : `k=${k} (${h} holds, ${t.approved} approved), p=${p.toExponential(2)} (gate holds>=${g.minHoldViolators}, p<=${g.maxP})`;
    return { fate: "BASE_RATE", p, detail };
  }
  return { fate: "GROUNDED", p, detail: "" };
}
function judgeNovelty(grounded, minNewHolds) {
  const order = [...grounded].sort((a, b) => b.holdViolators.length - a.holdViolators.length || a.index - b.index);
  const covered = /* @__PURE__ */ new Set();
  const accepted = [];
  const decisions = [];
  for (const j of order) {
    const fresh = j.holdViolators.filter((v) => !covered.has(v));
    if (fresh.length >= minNewHolds) {
      decisions.push({ index: j.index, fate: "CANDLE", detail: `explains ${fresh.length} new hold(s)`, newHolds: fresh.length });
      accepted.push(j);
      for (const v of j.holdViolators) covered.add(v);
    } else {
      const by = accepted.map((a) => ({ a, o: j.holdViolators.filter((v) => a.holdViolators.includes(v)).length })).sort((x, y) => y.o - x.o)[0];
      decisions.push({ index: j.index, fate: "REDUNDANT", detail: `only ${fresh.length} new hold(s); covered by ${by?.a.id ?? "-"}`, newHolds: fresh.length });
    }
  }
  return { decisions, covered };
}

// packages/verify/src/mine/threshold.ts
var num3 = (v) => typeof v === "number" && Number.isFinite(v) ? v : null;
function learnConst(field, dir, cases, rate) {
  const at3 = /* @__PURE__ */ new Map();
  let H = 0, A2 = 0;
  for (const c2 of cases) {
    const x = num3(c2.fields[field]);
    if (x === null) continue;
    const e = at3.get(x) ?? { h: 0, a: 0 };
    at3.set(x, e);
    if (c2.hold) {
      e.h++;
      H++;
    } else {
      e.a++;
      A2++;
    }
  }
  const vals = [...at3.keys()].sort((a, b) => a - b);
  if (vals.length < 2) return { ok: false, fate: "VOID", detail: vals.length ? "fewer than two distinct values: no cut to learn" : "no case could evaluate it (values missing)" };
  const m = allowedApproved(rate, A2);
  const n = vals.length;
  const hBelow = [0], aBelow = [0];
  for (let i = 0; i < n; i++) {
    const e = at3.get(vals[i]);
    hBelow.push(hBelow[i] + e.h);
    aBelow.push(aBelow[i] + e.a);
  }
  let best = null;
  for (let j = 1; j < n; j++) {
    const approved = dir === "high" ? A2 - aBelow[j] : aBelow[j];
    if (approved > m) continue;
    const missed = dir === "high" ? hBelow[j] : H - hBelow[j];
    const err = missed + approved;
    if (!best || err < best.err || err === best.err && approved < best.approved) best = { j, err, approved, missed };
  }
  if (!best) return { ok: false, fate: "INCONSISTENT", detail: rate > 0 ? `every cut makes more than ${m} approved case(s) violate it (rate ${rate})` : "approved cases violate it at every cut" };
  const lo = vals[best.j - 1], hi = vals[best.j];
  const mid = lo + (hi - lo) / 2;
  const c = lo < mid && mid < hi ? mid : dir === "high" ? lo : hi;
  return { ok: true, learned: { c, lo, hi, approved: best.approved, missed: best.missed } };
}

// packages/verify/src/mine/miner.ts
var MINE_VERSION = "0.1.0";
var byId = (a, b) => a < b ? -1 : a > b ? 1 : 0;
var sortIds = (ids) => [...ids].sort(byId);
function resolveMineOptions(o = {}) {
  const r = {
    minHoldViolators: o.minHoldViolators ?? 5,
    maxP: o.maxP ?? 0.01,
    minNewHolds: o.minNewHolds ?? 3,
    tGrid: [...new Set(o.tGrid ?? DEFAULT_T_GRID)].sort((a, b) => a - b),
    maxApprovedViolationRate: o.maxApprovedViolationRate ?? 0,
    strictAlpha: o.strictAlpha ?? 0.05,
    thresholds: o.thresholds ?? false
  };
  if (!Number.isInteger(r.minHoldViolators) || r.minHoldViolators < 1) throw new Error("minHoldViolators must be an integer >= 1");
  if (!Number.isInteger(r.minNewHolds) || r.minNewHolds < 1) throw new Error("minNewHolds must be an integer >= 1");
  if (!(r.maxP > 0 && r.maxP <= 1)) throw new Error("maxP must be in (0, 1]");
  if (!(r.strictAlpha > 0 && r.strictAlpha <= 1)) throw new Error("strictAlpha must be in (0, 1]");
  if (!(r.maxApprovedViolationRate >= 0 && r.maxApprovedViolationRate < 1)) throw new Error("maxApprovedViolationRate must be in [0, 1)");
  if (!r.tGrid.length || !r.tGrid.every((t) => Number.isFinite(t) && t >= 0)) throw new Error("tGrid must be a non-empty list of finite numbers >= 0");
  return r;
}
function validateCaseTable(table) {
  if (!table || !Array.isArray(table.cases)) throw new Error("case table must be { cases: [...] }");
  const seen = /* @__PURE__ */ new Set();
  table.cases.forEach((c, i) => {
    const where = `case[${i}]`;
    if (!c || typeof c !== "object") throw new Error(`${where}: must be an object`);
    if (typeof c.id !== "string" || !c.id.length) throw new Error(`${where}: "id" must be a non-empty string`);
    if (seen.has(c.id)) throw new Error(`${where}: duplicate id "${c.id}"`);
    seen.add(c.id);
    if (typeof c.label !== "string") throw new Error(`${where} (${c.id}): "label" must be a string`);
    if (!c.fields || typeof c.fields !== "object" || Array.isArray(c.fields)) throw new Error(`${where} (${c.id}): "fields" must be an object`);
    if (c.lines !== void 0 && (!Array.isArray(c.lines) || !c.lines.every((l) => l && typeof l === "object" && !Array.isArray(l)))) throw new Error(`${where} (${c.id}): "lines" must be an array of objects`);
  });
}
function supportedInterval(spec, cases, rate, nApproved) {
  const approvedR = cases.filter((c) => !c.hold).map((c) => worstRatio(spec, c)).filter((r) => r !== null).sort((a, b) => b - a);
  const lo = approvedR[allowedApproved(rate, nApproved)] ?? null;
  const heldAbove = cases.filter((c) => c.hold).map((c) => worstRatio(spec, c)).filter((r) => r !== null && (lo === null || r > lo + 1e-9));
  const hi = heldAbove.length ? Math.min(...heldAbove) : null;
  const fin = (x) => x === null || !Number.isFinite(x) ? null : x;
  return { lo: fin(lo), hi: fin(hi) };
}
function mine(table, schema, options = {}) {
  validateSchema(schema);
  validateCaseTable(table);
  const opts = resolveMineOptions(options);
  const approve = approveLabels(schema);
  const cases = table.cases.map((c) => ({ id: c.id, label: c.label, hold: !approve.has(c.label), fields: c.fields, lines: Array.isArray(c.lines) ? c.lines : null }));
  const grammar = buildGrammar(schema, opts.tGrid, { thresholds: opts.thresholds });
  const variants = grammar.reduce((a, g) => a + (g.tGrid?.length ?? 1), 0);
  const strictGate = opts.strictAlpha / variants;
  const rate = opts.maxApprovedViolationRate;
  const rows = [];
  for (const g of grammar) {
    let t;
    let spec = g.spec;
    let learned;
    if (g.learnConst) {
      const r = learnConst(g.learnConst.field, g.learnConst.dir, cases, rate);
      if (!r.ok) {
        const at3 = tally(g.spec, cases);
        rows.push({ grounded: false, holdViolators: [], j: {
          id: g.id,
          family: g.family,
          spec: g.spec,
          fate: r.fate,
          detail: r.detail,
          k: 0,
          holds: 0,
          approved: 0,
          decidable: at3.decidable,
          decidable_holds: at3.decidableHolds,
          p: 1,
          strict: false,
          violators: []
        } });
        continue;
      }
      learned = r.learned;
      spec = constSpec(g.learnConst.field, g.learnConst.dir, learned.c);
    }
    if (g.tGrid) {
      t = learnT(g.spec, cases, g.tGrid, rate);
      if (t === void 0) {
        const at3 = tally(g.spec, cases, g.tGrid[g.tGrid.length - 1]);
        rows.push({ grounded: false, holdViolators: [], j: {
          id: g.id,
          family: g.family,
          spec: g.spec,
          fate: "INCONSISTENT",
          detail: rate > 0 ? `the approved-violation limit (rate ${rate}) is exceeded at every t in the grid` : "approved cases violate it at every t in the grid",
          k: 0,
          holds: 0,
          approved: 0,
          decidable: at3.decidable,
          decidable_holds: at3.decidableHolds,
          p: 1,
          strict: false,
          violators: []
        } });
        continue;
      }
    }
    const tl = tally(spec, cases, t ?? 0);
    const base = {
      id: g.id,
      family: g.family,
      spec,
      ...t !== void 0 ? { t } : {},
      ...learned ? { c: learned.c } : {},
      k: tl.violators.length,
      holds: tl.holdViolators.length,
      approved: tl.approved,
      decidable: tl.decidable,
      decidable_holds: tl.decidableHolds,
      violators: sortIds(tl.violators)
    };
    const cons = judgeConsistency(tl, rate);
    const interval = learned ? { lo: learned.lo, hi: learned.hi } : void 0;
    if (!cons.ok) {
      rows.push({ grounded: false, holdViolators: tl.holdViolators, j: { ...base, fate: "INCONSISTENT", detail: cons.detail, p: 1, strict: false } });
      continue;
    }
    const gr = judgeGrounding(tl, opts);
    const grounded = gr.fate === "GROUNDED";
    rows.push({ grounded, holdViolators: tl.holdViolators, ...interval ? { interval } : {}, j: { ...base, fate: grounded ? "REDUNDANT" : gr.fate, detail: gr.detail, p: gr.p, strict: grounded && gr.p <= strictGate } });
  }
  const { decisions, covered } = judgeNovelty(
    rows.map((r, index2) => ({ index: index2, id: r.j.id, holdViolators: r.holdViolators, grounded: r.grounded })).filter((r) => r.grounded),
    opts.minNewHolds
  );
  const candles = [];
  const constInterval = /* @__PURE__ */ new Map();
  for (const d of decisions) {
    const j = rows[d.index].j;
    const iv = rows[d.index].interval;
    if (iv) constInterval.set(j, iv);
    j.fate = d.fate;
    j.detail = d.detail;
    j.new_holds = d.newHolds;
    if (d.fate === "CANDLE") candles.push(j);
  }
  const labelOf = new Map(cases.map((c) => [c.id, c.label]));
  for (const c of candles) {
    const m = {};
    for (const v of c.violators) {
      const l = labelOf.get(v);
      m[l] = (m[l] ?? 0) + 1;
    }
    c.violator_labels = Object.fromEntries(Object.keys(m).sort(byId).map((k) => [k, m[k]]));
    if (c.spec.form === "le_tol") c.interval = supportedInterval(c.spec, cases, rate, c.decidable - c.decidable_holds);
    const iv = constInterval.get(c);
    if (iv) c.interval = iv;
  }
  const holdIds = cases.filter((c) => c.hold).map((c) => c.id);
  const missing = {};
  for (const [n, f] of Object.entries(schema.fields)) {
    const k = cases.filter((c) => !valueOk(f.type, c.fields[n])).length;
    if (k) missing[n] = k;
  }
  for (const [n, f] of Object.entries(schema.lines ?? {})) {
    const k = cases.filter((c) => !c.lines || c.lines.some((l) => !valueOk(f.type, l[n]))).length;
    if (k) missing[n] = k;
  }
  const subcent = (v) => typeof v === "number" && Number.isFinite(v) && Math.abs(Math.round(v * 100) - v * 100) > 1e-6;
  const subcent_money_fields = [
    ...Object.entries(schema.fields).filter(([n, f]) => f.type === "money" && cases.some((c) => subcent(c.fields[n]))).map(([n]) => n),
    ...Object.entries(schema.lines ?? {}).filter(([n, f]) => f.type === "money" && cases.some((c) => (c.lines ?? []).some((l) => subcent(l[n])))).map(([n]) => n)
  ];
  return {
    engine: "riposte-mine",
    mine_version: MINE_VERSION,
    engine_version: ENGINE_VERSION,
    options: opts,
    schema,
    data: {
      cases: cases.length,
      holds: holdIds.length,
      approves: cases.length - holdIds.length,
      table_hash: hashOf(table),
      excluded: table.excluded ?? [],
      missing,
      subcent_money_fields
    },
    grammar: { forms: grammar.length, variants, strict_gate: strictGate },
    candles,
    morgue: rows.map((r) => r.j).filter((j) => j.fate !== "CANDLE"),
    explained: { holds: holdIds.filter((id) => covered.has(id)).length, of: holdIds.length, unexplained: sortIds(holdIds.filter((id) => !covered.has(id))) }
  };
}

// packages/verify/src/ledger/report.ts
function bookRefusal(db) {
  const at3 = db.check.brokenAt !== void 0 ? ` at event ${db.check.brokenAt}` : "";
  return `the book of record does not verify${at3} (${db.check.reason ?? "unknown"}): a tampered, mis-signed or unanchored book grants nothing, so no rung is read from it`;
}

// packages/verify/src/mine/compile.ts
var NotExpressible = class extends Error {
};
function literal(x) {
  const s = String(x);
  if (!/^[0-9]+(\.[0-9]+)?$/.test(s)) throw new NotExpressible(`the constant ${s} cannot be written as a plain decimal literal in the expression language`);
  return s;
}
function expr(t, used) {
  if ("field" in t) {
    used.add(t.field);
    return t.field;
  }
  if ("sum" in t) {
    used.add(t.sum);
    return `sum(${t.sum})`;
  }
  if ("sumProduct" in t) throw new NotExpressible(`sum(${t.sumProduct[0]}*${t.sumProduct[1]}) is a sum of a per-line product; declarative sum() takes one role and there are no line-level computed roles`);
  if ("const" in t) return literal(t.const);
  if ("plus" in t) return `${expr(t.plus[0], used)} + ${expr(t.plus[1], used)}`;
  used.add(t.gated);
  used.add(t.by);
  return t.negate ? `${t.gated} * (1 - ${t.by})` : `${t.gated} * ${t.by}`;
}
function toCheck(spec, t, code2, name, used) {
  switch (spec.form) {
    case "le":
      used.add(spec.x);
      used.add(spec.y);
      return { code: code2, name, scope: "line", left: spec.x, op: "<=", right: spec.y, tol: spec.eps, field: spec.x };
    case "eq":
      used.add(spec.x);
      used.add(spec.y);
      return { code: code2, name, scope: "line", left: spec.x, op: "=", right: spec.y, tol: spec.eps, field: spec.x };
    case "le_tol": {
      if (t === void 0) throw new NotExpressible("no learned tolerance");
      const right = `${spec.y} * (1 + ${literal(t)})`;
      used.add(spec.x);
      used.add(spec.y);
      return { code: code2, name, scope: "line", left: spec.x, op: "<=", right, tol: spec.eps, field: spec.x };
    }
    case "product":
      used.add(spec.a);
      used.add(spec.q);
      used.add(spec.p);
      return { code: code2, name, scope: "line", left: spec.a, op: "=", right: `${spec.q} * ${spec.p}`, tol: spec.eps, field: spec.a };
    case "rel": {
      const local = /* @__PURE__ */ new Set();
      const left = expr(spec.left, local), right = expr(spec.right, local);
      for (const u of local) used.add(u);
      const field = "field" in spec.left ? spec.left.field : "gated" in spec.left ? spec.left.gated : void 0;
      return { code: code2, name, left, op: spec.op, right, tol: spec.eps, ...field ? { field } : {} };
    }
    case "ids_one":
      used.add(spec.list);
      used.add(spec.id);
      return { code: code2, name, compare: "identifier", left: spec.list, op: "=", right: spec.id, field: spec.list };
    case "id_eq":
      used.add(spec.x);
      used.add(spec.y);
      return { code: code2, name, compare: "identifier", left: spec.x, op: "=", right: spec.y, field: spec.x };
  }
}
var KIND = { qty: "quantity", money: "amount", bool: "bool", id: "identifier", ids: "identifier" };
function compileRuleset(report, options = {}) {
  const checks = [];
  const map = [];
  const not_expressible = [];
  const used = /* @__PURE__ */ new Set();
  report.candles.forEach((c) => {
    const code2 = `M${map.length + 1}`;
    const local = /* @__PURE__ */ new Set();
    try {
      checks.push(toCheck(c.spec, c.t, code2, c.id, local));
      for (const u of local) used.add(u);
      map.push({ code: code2, candle: c.id });
    } catch (e) {
      if (!(e instanceof NotExpressible)) throw e;
      not_expressible.push({ candle: c.id, reason: e.message });
    }
  });
  const fields = {};
  for (const [n, f] of Object.entries(report.schema.fields)) if (used.has(n)) fields[n] = { paths: [n], kind: KIND[f.type] };
  for (const [n, f] of Object.entries(report.schema.lines ?? {})) if (used.has(n)) fields[n] = { paths: [n], kind: KIND[f.type], line: true };
  const ruleset = {
    id: options.id ?? "mined",
    version: options.version ?? "0.1.0",
    name: options.name ?? `Mined ruleset (${report.candles.length} candle(s); riposte-mine ${report.mine_version}; table ${report.data.table_hash.slice(0, 12)})`,
    domain: "mined",
    lineArrayKeys: ["line_items"],
    fields,
    checks,
    tolerance: { rel: 0, absCap: 0 }
  };
  const warnings = [];
  const subcent = report.data.subcent_money_fields.filter((f) => used.has(f));
  if (subcent.length) warnings.push(`money field(s) ${subcent.join(", ")} hold sub-cent values; the engine's amount normaliser rounds to cents, so the enforced ruleset may disagree with the miner on them`);
  if (!checks.length) warnings.push("no candle compiled: the ruleset has no checks and every verdict will be INSUFFICIENT_DATA");
  if (not_expressible.length) warnings.push(`${not_expressible.length} candle(s) could not be expressed; the ruleset under-enforces (a PASS does not mean those rules hold)`);
  return { ruleset, checks: map, not_expressible, complete: not_expressible.length === 0, lint: lintRuleset(ruleset), warnings };
}

// packages/verify/src/mine/index.ts
function mineRules(table, schema, options = {}, compile = {}) {
  const report = mine(table, schema, options);
  return { report, compiled: compileRuleset(report, compile) };
}
function caseTableFromRows(rows) {
  return { cases: rows.map((r) => r && typeof r === "object" && typeof r.id === "number" ? { ...r, id: String(r.id) } : r) };
}

// packages/verify/src/http/openapi.ts
var verdictRef = { type: "object", description: "The Verdict proof object \u2014 see docs/VERDICT-SCHEMA-v0.md." };
var jsonBody = (required, props) => ({
  required: true,
  content: { "application/json": { schema: { type: "object", required, properties: props } } }
});
var verdictResponse = { "200": { description: "A Verdict.", content: { "application/json": { schema: verdictRef } } }, "400": { description: "Bad request." }, "413": { description: "The body is over the transport cap (4 MiB by default)." } };
var OPENAPI = {
  openapi: "3.1.0",
  info: {
    title: "Verify \u2014 deterministic document & action verification",
    version: ENGINE_VERSION,
    description: "Verify already-extracted document data and proposed agent actions. PASS / FAIL / INSUFFICIENT_DATA with a replayable proof. Never guesses."
  },
  paths: {
    "/v1/health": { get: { summary: "Health + engine version.", responses: { "200": { description: "ok" } } } },
    "/v1/openapi.json": { get: { summary: "This OpenAPI 3.1 description.", responses: { "200": { description: "The spec." } } } },
    "/v1/verify": {
      post: {
        summary: "Verify a document under a built-in ruleset (invoice / pay-app).",
        requestBody: jsonBody(["extraction"], { extraction: { type: "object" }, ruleset: { type: "string", enum: ["invoice", "pay-app"] }, references: { type: "object" }, source: { type: "object" }, tolerance: { type: "object" }, producer: { type: "string" } }),
        responses: verdictResponse
      }
    },
    "/v1/verify/declared": {
      post: {
        summary: "Verify a document under a DECLARATIVE (JSON) ruleset \u2014 any document type, any language, no code.",
        requestBody: jsonBody(["extraction", "ruleset"], { extraction: { type: "object" }, ruleset: { type: "object" } }),
        responses: verdictResponse
      }
    },
    "/v1/verify/action": {
      post: {
        summary: "Ground a proposed agent action against an allow-list or source before it executes.",
        requestBody: jsonBody(["action"], { action: { type: "object" }, sources: { type: "object" } }),
        responses: verdictResponse
      }
    },
    "/v1/action/check": {
      post: {
        summary: "Check one proposed tool call at a rung: the verify_action verdict, its notice (every FAIL / ABSTAIN with its evidence and a dispute path), and the disposition the hold adapters deliver.",
        description: "Dispositions: hold (a FAIL or ABSTAIN at gate / autonomy: it waits for a person) \xB7 review (a PASS at gate: a person reviews it) \xB7 surface (a FAIL or ABSTAIN at advise: shown in-flow, not held) \xB7 record (a FAIL or ABSTAIN at record: a notice, not held) \xB7 proceed (a PASS at record / advise, or at autonomy within the declared bounds). `holds` is true for hold and review. Stateless: the rung is `level` (default record, the day-1 default). Managed tier: name `workflow_id` and the rung is read from the book of record instead (the GRANT in force, else the declared settings, else record); a `level` may restate it, never change it. The verdict is recorded to the caller\u2019s book like any other.",
        requestBody: jsonBody(["action"], {
          action: { type: "object", required: ["tool"], properties: { tool: { type: "string" }, arguments: { type: "object" } } },
          sources: { type: "object", properties: {
            text: { type: "string" },
            allowed: { type: "object" },
            require: { type: "array", items: { type: "string" } },
            records: {
              type: "array",
              minItems: 1,
              items: { type: "object", additionalProperties: { type: ["string", "number"] } },
              description: "Approved records: each one argument values approved together (e.g. one invoice's amount and payee account); every record names the same arguments. The arguments they name are grounded only when they all equal ONE record: a value approved for one record combined with another record's value FAILs (mix-and-match), and a partial tuple (a record-named argument missing) abstains. Verdicts that use records name rule action@0.1.0."
            }
          } },
          level: { type: "string", enum: ["record", "advise", "gate", "autonomy"] },
          workflow_id: { type: "string", description: "(managed tier) tenant/ruleset@version: read the rung from the book of record. The deployment\u2019s declared policy governs every GRANT, whatever policy the grant names: one still pending a second signature (a tier declaring grant_signatures), at a tier the policy does not declare, or above the tier\u2019s max_rung has no effect on it, and the response lists it in no_effect with its notice; notices says when the grant in force names another policy." }
        }),
        responses: {
          "200": { description: "ActionCheckSurface: tool, level, level_source (request | default | grant | declaration | none), workflow_id?, disposition, holds, call_hash, verdict (a standard replayable Verdict), notice, notice_markdown." },
          "400": { description: "Bad request (no action, malformed sources, an unknown rung)." },
          "401": { description: "Unauthorized (managed tier)." },
          "404": { description: "(managed tier) The workflow is not the caller\u2019s." },
          "409": { description: "(managed tier) The request states a rung other than the one on record, or the book of record does not verify (it grants nothing)." }
        }
      }
    },
    "/v1/verify/citations": {
      post: {
        summary: "Cite-check: does each quotation appear verbatim in the supplied opinion text.",
        requestBody: jsonBody(["citations"], { citations: { type: "array", items: { type: "object" } }, sources: { type: "object" } }),
        responses: verdictResponse
      }
    },
    "/v1/verify/quotes": {
      post: {
        summary: "Does a quoted passage / numeric value appear in a source text.",
        requestBody: jsonBody(["source_text"], { source_text: { type: "string" }, quotes: { type: "array" }, values: { type: "array" } }),
        responses: { "200": { description: "source hash + per-assertion claims." } }
      }
    },
    "/v1/verify/batch": {
      post: {
        summary: "Verify many documents in one call; returns an outcome summary + each verdict.",
        requestBody: jsonBody(["items"], { items: { type: "array", items: { type: "object" } } }),
        responses: { "200": { description: "Batch result: count, per-outcome summary, and the verdicts." }, "400": { description: "Bad request." } }
      }
    },
    "/v1/ruleset/lint": {
      post: {
        summary: "Validate a declarative ruleset before it runs (structure, formulas, role references).",
        requestBody: jsonBody(["ruleset"], { ruleset: { type: "object" } }),
        responses: { "200": { description: "Lint result: ok, errors[], warnings[]." }, "400": { description: "Bad request." } }
      }
    },
    "/v1/ruleset/measure": {
      post: {
        summary: "Mint a measured DeclaredAccuracy: run a declarative ruleset over a labeled set (never estimated).",
        requestBody: jsonBody(["ruleset", "cases"], { ruleset: { type: "object" }, cases: { type: "array", items: { type: "object", required: ["extraction", "label"], properties: { extraction: { type: "object" }, label: { type: "string", enum: ["CLEAN", "ERROR"] } } } } }),
        responses: { "200": { description: "accuracy (fp/fn/abstain + measured_on hash), metrics, and per-case rows." }, "400": { description: "Bad request." } }
      }
    },
    "/v1/mine": {
      post: {
        summary: "Propose the rules behind labelled decisions (rule mining): candles with exact p-values, the morgue, and a compiled declarative ruleset.",
        requestBody: jsonBody(["cases", "schema"], { cases: { type: "array", items: { type: "object", required: ["id", "label", "fields"] } }, schema: { type: "object", required: ["approve", "fields"] }, max_approved_violation_rate: { type: "number" }, thresholds: { type: "boolean" }, ruleset_id: { type: "string" } }),
        responses: { "200": { description: "{ report, compiled }: candles (proposals for a human), morgue, explained holds, and the compiled ruleset." }, "400": { description: "Bad request (including a malformed case table or schema)." } }
      }
    },
    "/v1/twin": {
      post: {
        summary: "Structured-twin check: extracted financial-statement values against the filing\u2019s own inline-XBRL facts (never a table re-read from the HTML). PASS / FAIL with a diagnosis / ABSTAIN with a reason.",
        description: "map_version 0.1.0 (default; ruleset 0.1) binds over the whole document; 0.2.0 (ruleset 0.2) binds only concepts the filing\u2019s presentation linkbase places on a face statement (supply pre / filing_summary / schema flat, or presentation nested; without a linkbase every claim abstains NO_PRESENTATION_LINKBASE). 0.2.1 (ruleset 0.2.1, opt-in) is 0.2 plus us-gaap scope-variant concept families, the cash roll as the tie-break between disagreeing face lines (ABSTAIN AMBIGUOUS_LINE, the insufficiency AMBIGUOUS_REFERENCE, when it cannot decide), an exact power-of-ten SCALE FAIL against anchored figures, and a strict linkbase reading. It FAILED its pre-registered held-out check (2026-09-28) and every 0.2.1 result says so in map_status. The body may be up to 32 MiB (a whole filing); most routes take 4 MiB. In the managed tier the verdict is recorded to the caller\u2019s book like any other.",
        requestBody: jsonBody(["html", "period_end", "claims"], {
          html: { type: "string", description: "The primary inline-XBRL document, as text." },
          period_end: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          claims: { type: "array", items: { type: "object", required: ["id", "field", "value"], properties: { id: { type: "string" }, field: { type: "string" }, value: { type: "number" } } } },
          tolerance: { type: "number", minimum: 0 },
          period_tolerance_days: { type: "number", minimum: 0 },
          map_version: { type: "string", enum: ["0.1.0", "0.2.0", "0.2.1"] },
          ruleset: { type: "string", enum: ["0.1", "0.2", "0.2.1", "0.1.0", "0.2.0"], description: "The twin ruleset: 0.1 = map 0.1.0 (default), 0.2 = map 0.2.0, 0.2.1 = map 0.2.1 (opt-in; held-out prereg FAIL, stated in map_status). With map_version too, the two must agree." },
          pre: { type: "string", description: "For ruleset 0.2, flat: the presentation linkbase (*_pre.xml)." },
          filing_summary: { type: "string", description: "For ruleset 0.2, flat: EDGAR FilingSummary.xml." },
          schema: { type: "string", description: "For ruleset 0.2, flat: the extension schema (*.xsd)." },
          presentation: { type: "object", description: "The same texts, nested (one way, not both).", properties: { pre: { type: "string" }, filing_summary: { type: "string" }, schema: { type: "string" } } },
          producer: { type: "string" }
        }),
        responses: { "200": { description: "{ verdict, judgments, twin, map_status? }: a standard replayable Verdict (the VERDICT channel), the per-claim judgments, the twin\u2019s identity (sha256, facts, contexts), and for map 0.2.1 its measured status ({ map_version, offered: opt-in, measured, detail })." }, "400": { description: "Bad request (including a ruleset and a map_version that disagree, or presentation texts sent both flat and nested)." }, "413": { description: "The body is over the transport cap (32 MiB for this route)." } }
      }
    },
    "/v1/opinion": {
      post: {
        summary: "The courtroom opinion over the book of record: a dispute of one recorded verdict, or a voice question for a workflow. COUNSEL (generated, dismissible), never a VERDICT: it proposes, a person decides.",
        description: 'One question per opinion: { dispute: { verdict_id, claim_id? } }, or { policy, proposal }, or { policy, workflow_id, consequence_tier, granted | grant, bounds? }. Every premise is checked by Riposte\u2019s own code; if one fails the ruling is WITHHELD. Stateless: supply "ledger" (the chain export), and optionally "tenant_id" to read one tenant of a shared chain. Managed tier: omit "ledger" to read the caller\u2019s own book under the declared policy and the settings on record (a request may restate them, not change them); the opinion is scoped to the caller\u2019s tenant, so on a shared book its precedent, evidence and grants are the caller\u2019s own.',
        requestBody: jsonBody([], {
          ledger: { oneOf: [{ type: "string", description: "The chain export (ledger.chainJSONL())." }, { type: "object", required: ["events", "payloads"], properties: { events: { type: "array" }, payloads: { type: "array" } } }] },
          dispute: { type: "object", required: ["verdict_id"], properties: { verdict_id: { type: "string" }, claim_id: { type: "string" } } },
          inputs: { description: "For a dispute: the original inputs, to verify the verdict is FOR them." },
          policy: { type: "object", description: "The declared promotion policy (promotion-policy-v0)." },
          proposal: { type: "object", description: "A proposal (from GET /v1/voice/{workflow} or voice_assess) to argue." },
          workflow_id: { type: "string" },
          consequence_tier: { type: "string" },
          granted: { type: "string", enum: ["record", "advise", "gate", "autonomy"] },
          grant: { type: "object" },
          bounds: { type: "string" },
          tenant_id: { type: "string", description: "Read one tenant\u2019s records and decisions only (a shared chain). In the managed tier it is the caller\u2019s own; another is refused." },
          from_book: { type: "boolean", description: "For a voice question: read the rung from the GRANT in force on the book (workflow_id; consequence_tier only while nothing is granted)." },
          trusted_keys: { type: "object", description: 'With a supplied "ledger": anchor its signers ({ signer_id: PEM | [PEM] }). A chain export carries no anchors, so without them its decisions have no effect (D-ANCHOR) and the opinion names each. Refused in the managed tier: its ledger carries its own anchors.' },
          root_keys: { oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }], description: 'With a supplied "ledger": the root public key(s); the key registry on the book anchors the signers it registers.' }
        }),
        responses: {
          "200": { description: "{ opinion, markdown }: the opinion (the source of truth; its id re-derives from its content) and its reading copy." },
          "400": { description: "Bad request (no ledger, no policy for a voice question, a verdict not on the book, two questions at once)." },
          "413": { description: "The body is over the transport cap (32 MiB for this route: a chain export). A book that large is read by the managed tier from its own ledger." },
          "401": { description: "Unauthorized (managed tier)." },
          "404": { description: "(managed tier) The workflow or verdict is not on the caller\u2019s book." },
          "409": { description: "(managed tier) The request states settings other than those on record (the GRANT in force, or the declared settings)." }
        }
      }
    },
    "/v1/grant/cosign": {
      post: {
        summary: "(managed tier) Dual authorization: a second person\u2019s signed co-signature on a GRANT whose tier requires more than one signature (grant_signatures). Until it is co-signed the grant is PENDING and moves no rung.",
        description: "The body is the signed GRANT_COSIGN itself, made offline with the co-signer\u2019s own key (makeCosign + signDecision): it names the grant by decision_id and restates its workflow and level. It goes through the ledger\u2019s door, which verifies the signature and the anchoring and refuses a co-signature that would not count (the grant\u2019s own signer, a repeat signer, the same key or two ids on one key, an unanchored or superseded grant). It rides in a GRANT event; the chain format is unchanged.",
        requestBody: jsonBody(["decision", "public_key", "signature"], {
          decision: { type: "object", required: ["kind", "workflow_id", "grant", "level", "signer_id", "signed_at"], properties: { kind: { type: "string", enum: ["GRANT_COSIGN"] }, workflow_id: { type: "string" }, grant: { type: "string" }, level: { type: "string" }, signer_id: { type: "string" }, signed_at: { type: "string" }, note: { type: "string" } } },
          alg: { type: "string", enum: ["ed25519"] },
          public_key: { type: "string" },
          signature: { type: "string" },
          decision_id: { type: "string" }
        }),
        responses: {
          "200": { description: "{ tenant_id, appended, grant: { decision_id, workflow_id, level, signatures: { required, signers, cosigns, complete }, in_force }, no_effect }: the entry, the grant\u2019s signatures as the book now stands, and any notice still standing (a grant that needs more signatures stays pending)." },
          "400": { description: "Not a signed GRANT_COSIGN." },
          "401": { description: "Unauthorized." },
          "404": { description: "The grant is not on the caller\u2019s tenant\u2019s book, or not the managed tier (no ledger)." },
          "409": { description: "The door refused it (nothing is appended), or the book of record does not verify." }
        }
      }
    },
    "/v1/reconcile": {
      post: {
        summary: "Completeness reconciliation: the book of record against the customer\u2019s payment population (an AP payment register, a GL payments extract). Every payment lands in one class; PAID_DESPITE_HOLD is the control override.",
        description: 'Completeness: did every payment go through the control? The whole book is verified first (nothing is reconciled against a book that does not verify), then every population row lands in exactly one class (MATCHED, MISMATCHED, PAID_DESPITE_HOLD, CHECKED_AFTER_PAYMENT, AMBIGUOUS, BYPASSED, UNREADABLE) and every in-period verdict in one (MATCHED, ORPHAN, AMBIGUOUS, UNKEYED). Declared, never guessed: the mapping names each column and key rule; amounts are exact decimals; dates are never sniffed. The report binds the book head and length, the population (sha256 of the exact bytes when sent as text or base64, and rows_hash), the mapping and the options, and carries a clock-free report_hash. Completeness of the population itself is the customer\u2019s responsibility: this proves the book covers the population given. Stateless: supply "ledger" (the chain export), optionally "tenant_id" and "trusted_keys" / "root_keys". Managed tier: omit "ledger"; the caller\u2019s own book is read with the ledger\u2019s own anchors, the scope is the caller\u2019s tenant whatever the body says (another tenant or its workflow is refused), and on a shared book the report\u2019s summary of the book is the caller\u2019s slice. The body may be up to 32 MiB (a payment register).',
        requestBody: jsonBody(["population", "mapping"], {
          population: {
            oneOf: [
              { type: "object", required: ["format"], properties: { format: { type: "string", enum: ["csv", "jsonl"] }, text: { type: "string" }, base64: { type: "string", description: "The export\u2019s exact bytes (its sha256 is bound as the file was)." }, delimiter: { type: "string", enum: [",", ";", "	", "|"] } } },
              { type: "object", required: ["rows"], properties: { rows: { type: "array", items: { type: "object" } } } },
              { type: "array", items: { type: "object" } }
            ]
          },
          mapping: { type: "object", description: "The declared completeness mapping (completeness-mapping-v0): key fields, population columns, book field sources, key normalization, tolerances." },
          ledger: { oneOf: [{ type: "string", description: "The chain export (ledger.chainJSONL())." }, { type: "object", required: ["events", "payloads"], properties: { events: { type: "array" }, payloads: { type: "array" } } }], description: "Stateless only: the book of record. Refused in the managed tier, which reads the caller\u2019s own book." },
          extractions: { type: "array", description: "The checked extractions (or proposed actions), for extraction book sources; each is used only if its hash is on the book." },
          tenant_id: { type: "string", description: "Read one tenant\u2019s records only (a shared chain). In the managed tier it is the caller\u2019s own; another is refused." },
          workflows: { type: "array", items: { type: "string" } },
          rulesets: { type: "array", items: { type: "string" } },
          period: { type: "object", properties: { since: { type: "string" }, until: { type: "string" } }, description: "The period the population covers, on the book\u2019s clock (since inclusive, until exclusive)." },
          rungs: { type: "object", description: "A declared rung per workflow, used only for a workflow with no anchored GRANT on the book." },
          interval: { type: "object", properties: { method: { type: "string" }, confidence: { type: "number" }, sidedness: { type: "string" } } },
          include_matched: { type: "boolean" },
          trusted_keys: { type: "object", description: "Stateless only: anchor the chain\u2019s signers ({ signer_id: PEM | [PEM] }). Without anchors a GRANT has no effect and the rung falls back to the declared one, then record." },
          root_keys: { oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }], description: "Stateless only: the root public key(s); the key registry on the book anchors the signers it registers." },
          policy: { type: "object", description: "Stateless only: the declared promotion policy; the rung a record was held at is read with the GRANTs it admits, whatever policy a grant names. The managed tier reads under its own declared policy and refuses one here." }
        }),
        responses: {
          "200": { description: "{ report, markdown } (managed tier: { tenant_id, report, markdown }): the CompletenessReport (binds, population and book by class, coverage with its bound, $ totals by currency, every exception with its row and verdict, resolved holds, clean, boundary, report_hash) and its reading copy. clean is true only when every row is MATCHED." },
          "400": { description: "Bad request, or a refused input: a mapping, population value or book the engine will not reconcile (the message names the row, line and column)." },
          "401": { description: "Unauthorized (managed tier)." },
          "404": { description: "(managed tier) Another tenant, or another tenant\u2019s workflow." },
          "409": { description: "(managed tier) The book of record does not verify: nothing is reconciled against it." },
          "413": { description: "The body is over the transport cap (32 MiB for this route)." }
        }
      }
    },
    "/v1/succession/replay": {
      post: {
        summary: "The replay a person reviews before carrying a grant to a new ruleset version, or a signed succession\u2019s replay re-performed. Read-only: nothing is signed or appended.",
        description: 'A new ruleset version is a new workflow and starts at record; a person carries the grant in force with a signed GRANT that carries this replay (verify succession). Without "check": the grant in force on "from" (under "policy" when given) and every verdict recorded under "from" re-performed under the "to" ruleset with the inputs supplied: counts, each change and its direction, how many loosen (a change to PASS, which needs its own stated reason), and each verdict not re-performed with why. With "signer_id", "reason" and "policy": also the unsigned GRANT, to be signed where the person\u2019s key lives. With "check" (a succession GRANT\u2019s decision id): its signed replay re-performed over its own span; ok when byte-identical.',
        requestBody: jsonBody(["ledger", "inputs"], {
          ledger: { oneOf: [{ type: "string", description: "The chain export (ledger.chainJSONL())." }, { type: "object", required: ["events", "payloads"], properties: { events: { type: "array" }, payloads: { type: "array" } } }] },
          inputs: { oneOf: [{ type: "array", items: { type: "object", required: ["verdict_id", "inputs"], properties: { verdict_id: { type: "string" }, inputs: { type: "object" } } } }, { type: "object", description: '{ "<verdict_id>": inputs }' }], description: "The inputs each recorded verdict was issued on; a verdict without them is counted as not re-performed." },
          from: { type: "string", description: "<tenant>/<ruleset>@<old version>" },
          to: { type: "string", description: "<tenant>/<ruleset>@<new version>" },
          check: { type: "string", description: "A succession GRANT\u2019s decision id (or a unique prefix of 12+ hex characters): re-perform its replay." },
          ruleset: { type: "object", description: "The new version as a declarative ruleset, when this build does not hold it." },
          tolerance: { type: "object", properties: { rel: { type: "number" }, absCap: { type: "number" } } },
          policy: { type: "object", description: "The declared promotion policy: the grant in force is read under it." },
          signer_id: { type: "string" },
          reason: { type: "string" },
          loosening_reason: { type: "string" },
          level: { type: "string" },
          signed_at: { type: "string" },
          note: { type: "string" },
          trusted_keys: { type: "object" },
          root_keys: { oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }] }
        }),
        responses: {
          "200": { description: '{ surface_version, from, to, carries, replay, not_reperformed, loosens, unsigned?, chain } or, with "check", { surface_version, from, to, check: { ok, differences, signed, reperformed, book }, chain }.' },
          "400": { description: "Bad request, a book that does not verify, or a refused succession (a raised rung, a loosening without its reason, nothing to carry)." },
          "413": { description: "The body is over the transport cap (32 MiB for this route)." }
        }
      }
    },
    "/v1/voice/{workflow}": {
      get: {
        summary: "(managed tier) A workflow\u2019s voice: the rung it runs at (ALWAYS the one a person granted; nothing here changes it) and any open proposal (a promotion, or an URGENT demotion with its failing cases for dispute).",
        description: "Read from the caller\u2019s book of record under the deployment\u2019s declared policy. BOOK FIRST: the rung is the GRANT in force on the book (a person\u2019s signed decision; cited in assessment.book, and a proposal a person declined is held back until the evidence changes); the deployment\u2019s declared settings cover only workflows with no GRANT. An undeclared, ungranted workflow is at record, the day-1 default, and nothing is weighed. Nothing is proposed from a book whose content does not verify.",
        parameters: [{ name: "workflow", in: "path", required: true, schema: { type: "string" }, description: "The workflow id, tenant/ruleset@version, URL-encoded (e.g. acme%2Finvoice%400.0.1)." }],
        responses: {
          "200": { description: "VoiceSurface: workflow_id, level (= granted), earned, declared, handling, open_proposal, basis (the open demotion\u2019s: failure = urgent, unevidenced = a standing notice; else null), no_effect (decisions for the workflow on the book with NO effect, each with its notice: a signer not anchored, or a GRANT PENDING the signatures its tier requires, with pending: { required, signed_by }), evidence (the book\u2019s evidence audit behind the assessment: draws, what counts, what was set aside and why, surveillance findings, canaries, reviewers; null when the tier declares none), book (chain status), verified, note, and the full assessment." },
          "400": { description: "Bad workflow id." },
          "401": { description: "Unauthorized." },
          "404": { description: "Not a workflow of the caller\u2019s tenant, or not the managed tier (no ledger)." },
          "409": { description: "The settings on record are refused by the policy (an undeclared tier, a grant made under other settings): a person\u2019s to correct. Or the book of record does not verify: a tampered, mis-signed or unanchored book grants nothing, and no rung is read from it." }
        }
      }
    },
    "/v1/queue/{workflow}": {
      get: {
        summary: "(managed tier) The reviewer\u2019s queue for a workflow: every item drawn for review (a random, chain-seeded draw anyone can re-derive) and not yet reviewed, oldest period first, each with the date it is due by.",
        description: "Read from the caller\u2019s book of record under the deployment\u2019s declared policy. The draw rates follow the tier: the GRANT in force\u2019s, else the deployment\u2019s declared tier for the workflow. With no policy, no tier, or a tier without a sampling plan, nothing is drawn and the note says so. An item left unreviewed past its due date is a deviation: under autonomy it raises an urgent, failure-basis demotion proposal.",
        parameters: [{ name: "workflow", in: "path", required: true, schema: { type: "string" }, description: "The workflow id, tenant/ruleset@version, URL-encoded (e.g. acme%2Finvoice%400.0.1)." }],
        responses: {
          "200": { description: "ReviewQueueSurface: tenant_id, workflow_id, policy (id, version, hash; null when none), consequence_tier, items [{ verdict_id, stratum (PASS | FAIL), period_start, due_by, rung }], count, note." },
          "400": { description: "Bad workflow id." },
          "401": { description: "Unauthorized." },
          "404": { description: "Not a workflow of the caller\u2019s tenant, or not the managed tier (no ledger)." },
          "409": { description: "The book of record does not verify (no draw is read from it), or the settings on record are refused by the policy (a tier it does not declare, a grant made under another policy)." }
        }
      }
    },
    "/v1/ledger/stats": { get: { summary: "(managed tier) Verdict counts + real-world overturn rate for the caller\u2019s tenant.", responses: { "200": { description: "LedgerStats." }, "401": { description: "Unauthorized." } } } },
    "/v1/ledger/report": { get: { summary: "(managed tier) The tenant book-of-record report (Markdown): volume, overturn, calibration, what Riposte is asking for this month (open proposals with their rulings; FAIL / ABSTAIN notices by rung), tamper-evidence.", responses: { "200": { description: "tenant_id + markdown." }, "401": { description: "Unauthorized." } } } },
    "/v1/ledger/calibration": { get: { summary: "(managed tier) Per-rule human-overturn calibration + the flagged review queue.", responses: { "200": { description: "CalibrationReport." }, "401": { description: "Unauthorized." } } } }
  }
};

// packages/verify/src/reconcile/completeness/types.ts
var CompletenessRefused = class extends Error {
  row;
  line;
  constructor(message2, where = {}) {
    super(message2);
    this.name = "CompletenessRefused";
    if (where.row !== void 0) this.row = where.row;
    if (where.line !== void 0) this.line = where.line;
  }
};
var KEY_FIELDS = ["invoice_number", "vendor_id"];
var POPULATION_FIELDS = ["invoice_number", "vendor_id", "amount", "currency", "invoice_date", "payment_date", "payment_id"];
var BOOK_FIELDS = ["invoice_number", "vendor_id", "amount", "currency", "invoice_date"];
var POPULATION_CLASSES = ["MATCHED", "MISMATCHED", "PAID_DESPITE_HOLD", "CHECKED_AFTER_PAYMENT", "AMBIGUOUS", "BYPASSED", "UNREADABLE"];
var MATCH_PRECEDENCE = ["PAID_DESPITE_HOLD", "MISMATCHED", "CHECKED_AFTER_PAYMENT"];
var BOOK_CLASSES = ["MATCHED", "ORPHAN", "AMBIGUOUS", "UNKEYED"];

// packages/verify/src/reconcile/completeness/book.ts
var isLedger = (b) => typeof b.chainJSONL === "function";
function readBook2(input, anchors = {}) {
  const chain = isLedger(input) ? input.snapshot ? input.snapshot() : parseChainJSONL(input.chainJSONL()) : input;
  if (!chain || !Array.isArray(chain.events) || !Array.isArray(chain.payloads)) {
    throw new CompletenessRefused("the book must be a Ledger or a chain export { events, payloads }");
  }
  const db = readDecisionBook(chain.events, chain.payloads, anchors);
  if (!db.ok) {
    const at3 = db.check.brokenAt !== void 0 ? ` at event ${db.check.brokenAt}` : "";
    throw new CompletenessRefused(`the book does not verify${at3} (${db.check.reason ?? "unknown"}): nothing is reconciled against a broken book`);
  }
  const recs = /* @__PURE__ */ new Map();
  const latestOwner = /* @__PURE__ */ new Map();
  const rk2 = (t, id) => `${t}\0${id}`;
  for (let i = 0; i < chain.events.length; i++) {
    const ev = chain.events[i];
    const p = chain.payloads[i];
    if (!p || typeof p !== "object") continue;
    if (p.type === "RECORD" && p.verdict && typeof p.verdict.verdict_id === "string") {
      const tenant = String(p.tenant_id ?? "");
      const id = p.verdict.verdict_id;
      const at3 = { seq: ev.seq, entry_hash: ev.entry_hash, recorded_at: p.recorded_at ?? ev.ts };
      const prior = recs.get(rk2(tenant, id));
      const r = p.verdict.ruleset;
      const workflow_id = `${tenant}/${r?.id}@${r?.version}`;
      const problem = proofProblem(p.verdict);
      recs.set(rk2(tenant, id), {
        tenant_id: tenant,
        verdict_id: id,
        workflow_id,
        verdict: p.verdict,
        first_record: prior?.first_record ?? at3,
        record: at3,
        record_seqs: [...prior?.record_seqs ?? [], ev.seq],
        ...prior?.review ? { review: prior.review } : {},
        ...problem ? { not_verdict: problem } : {}
      });
      latestOwner.set(id, tenant);
    } else if (p.type === "REVIEW" && typeof p.verdict_id === "string" && p.review) {
      const tenant = p.tenant_id ?? latestOwner.get(p.verdict_id);
      const rec = tenant !== void 0 ? recs.get(rk2(tenant, p.verdict_id)) : void 0;
      if (!rec) continue;
      rec.review = {
        decision: p.review.decision,
        reviewer_id: p.review.reviewer_id,
        decided_at: p.review.decided_at,
        seq: ev.seq,
        first_decided_at: rec.review?.first_decided_at ?? p.review.decided_at
      };
    }
  }
  const signersOf = (tenant_id) => {
    const out = /* @__PURE__ */ new Set();
    for (const e of [...db.decisions, ...db.cosigns, ...db.canaries]) if (decisionTenant(e.signed.decision) === tenant_id) out.add(e.signed.decision.signer_id);
    for (const e of db.signed_reviews) if (e.tenant_id === tenant_id) out.add(e.signer_id);
    return out;
  };
  return { head: db.check.head, length: db.check.length, unanchored: [...db.unanchored], decisions: db.decisions, records: [...recs.values()], signersOf };
}

// packages/verify/src/reconcile/completeness/population.ts
import { createHash as createHash3 } from "node:crypto";
var PopulationRefused = class extends Error {
  row;
  line;
  constructor(message2, where = {}) {
    super(message2);
    this.name = "PopulationRefused";
    if (where.row !== void 0) this.row = where.row;
    if (where.line !== void 0) this.line = where.line;
  }
};
var BOM = "\uFEFF";
function decode2(input) {
  if (typeof input === "string") {
    const buf = Buffer.from(input, "utf8");
    return { text: input.startsWith(BOM) ? input.slice(1) : input, sha256: createHash3("sha256").update(buf).digest("hex"), bytes: buf.length };
  }
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(input);
  } catch {
    throw new PopulationRefused("the population is not valid UTF-8");
  }
  return { text, sha256: createHash3("sha256").update(input).digest("hex"), bytes: input.byteLength };
}
function parseCsvRecords(text, delim) {
  const out = [];
  const n = text.length;
  let i = 0;
  let line3 = 1;
  const refuse = (why, startLine) => {
    const rec = out.length;
    throw new PopulationRefused(`${rec === 0 ? "the header" : `row ${rec}`} (line ${startLine}): ${why}`, { row: rec, line: startLine });
  };
  while (i < n) {
    const recLine = line3;
    if (text[i] === "\n" || text[i] === "\r" && text[i + 1] === "\n") {
      if (/^[\r\n]*$/.test(text.slice(i))) break;
      refuse("a blank line inside the file (a record with no fields); remove it or quote an empty field", recLine);
    }
    const fields = [];
    for (; ; ) {
      let field = "";
      if (text[i] === '"') {
        const openLine = line3;
        i++;
        for (; ; ) {
          if (i >= n) refuse(`a quoted field opened on line ${openLine} is never closed`, recLine);
          const ch = text[i];
          if (ch === '"') {
            if (text[i + 1] === '"') {
              field += '"';
              i += 2;
              continue;
            }
            i++;
            break;
          }
          if (ch === "\n") line3++;
          field += ch;
          i++;
        }
        if (i < n && text[i] !== delim && text[i] !== "\n" && !(text[i] === "\r" && text[i + 1] === "\n")) {
          refuse(`unexpected ${JSON.stringify(text[i])} after a closing quote (a quoted field must end at a delimiter or line break)`, recLine);
        }
      } else {
        const start = i;
        while (i < n && text[i] !== delim && text[i] !== "\n" && text[i] !== "\r") {
          if (text[i] === '"') refuse("a double quote inside an unquoted field (quote the field and double the quote)", recLine);
          i++;
        }
        if (text[i] === "\r" && text[i + 1] !== "\n") refuse("a bare carriage return outside quotes", recLine);
        field = text.slice(start, i);
      }
      fields.push(field);
      if (i >= n) break;
      if (text[i] === delim) {
        i++;
        continue;
      }
      i += text[i] === "\r" ? 2 : 1;
      line3++;
      break;
    }
    out.push({ fields, line: recLine });
  }
  return out;
}
function readPopulationCSV(input, opts = {}) {
  const delim = opts.delimiter ?? ",";
  if (![",", ";", "	", "|"].includes(delim)) throw new PopulationRefused(`delimiter must be one of , ; tab | (got ${JSON.stringify(delim)})`);
  const { text, sha256: digest, bytes } = decode2(input);
  const recs = parseCsvRecords(text, delim);
  if (recs.length === 0) throw new PopulationRefused("the population is empty: no header record");
  const header = recs[0].fields;
  const seen = /* @__PURE__ */ new Set();
  header.forEach((h, j) => {
    if (h.trim() === "") throw new PopulationRefused(`the header's column ${j + 1} has no name`, { row: 0, line: 1 });
    if (seen.has(h)) throw new PopulationRefused(`the header names column ${JSON.stringify(h)} twice`, { row: 0, line: 1 });
    seen.add(h);
  });
  const rows = [];
  for (let r = 1; r < recs.length; r++) {
    const { fields, line: line3 } = recs[r];
    if (fields.length !== header.length) {
      throw new PopulationRefused(`row ${r} (line ${line3}) has ${fields.length} field${fields.length === 1 ? "" : "s"}; the header has ${header.length}`, { row: r, line: line3 });
    }
    const values = {};
    header.forEach((h, j) => {
      values[h] = fields[j];
    });
    rows.push({ row: r, line: line3, values });
  }
  return { population_version: "population-v0", format: "csv", sha256: digest, bytes, columns: [...header], rows };
}
function readPopulationJSONL(input) {
  const { text, sha256: digest, bytes } = decode2(input);
  const lines = text.split("\n");
  let last = lines.length - 1;
  while (last >= 0 && lines[last].replace(/\r$/, "").trim() === "") last--;
  const rows = [];
  for (let j = 0; j <= last; j++) {
    const s = lines[j].replace(/\r$/, "");
    const lineNo = j + 1;
    const rowNo = rows.length + 1;
    if (s.trim() === "") throw new PopulationRefused(`line ${lineNo}: a blank line inside the file`, { row: rowNo, line: lineNo });
    let v;
    try {
      v = JSON.parse(s);
    } catch (e) {
      throw new PopulationRefused(`row ${rowNo} (line ${lineNo}) is not JSON: ${e.message}`, { row: rowNo, line: lineNo });
    }
    if (v === null || typeof v !== "object" || Array.isArray(v)) throw new PopulationRefused(`row ${rowNo} (line ${lineNo}) is not a JSON object`, { row: rowNo, line: lineNo });
    rows.push({ row: rowNo, line: lineNo, values: v });
  }
  return { population_version: "population-v0", format: "jsonl", sha256: digest, bytes, rows };
}
function readPopulation(input, format, opts = {}) {
  if (format === "csv") return readPopulationCSV(input, opts);
  if (format === "jsonl") return readPopulationJSONL(input);
  throw new PopulationRefused(`population format must be csv or jsonl (got ${JSON.stringify(format)})`);
}
function populationFromRows(rows) {
  return {
    population_version: "population-v0",
    format: "rows",
    rows: rows.map((values, j) => {
      if (values === null || typeof values !== "object" || Array.isArray(values)) throw new PopulationRefused(`row ${j + 1} is not an object`, { row: j + 1 });
      return { row: j + 1, line: j + 1, values: { ...values } };
    })
  };
}
function populationRowsHash(p) {
  return hashOf(p.rows.map((r) => r.values));
}

// packages/verify/src/reconcile/completeness/values.ts
var TEN = 10n;
var pow10 = (n) => TEN ** BigInt(n);
function normDec(units, scale) {
  while (scale > 0 && units % TEN === 0n) {
    units /= TEN;
    scale--;
  }
  return { units, scale };
}
var at2 = (d, scale) => d.units * pow10(scale - d.scale);
function decAdd(a, b) {
  const s = Math.max(a.scale, b.scale);
  return normDec(at2(a, s) + at2(b, s), s);
}
function decSub(a, b) {
  const s = Math.max(a.scale, b.scale);
  return normDec(at2(a, s) - at2(b, s), s);
}
function decMul(a, b) {
  return normDec(a.units * b.units, a.scale + b.scale);
}
function decAbs(a) {
  return a.units < 0n ? { units: -a.units, scale: a.scale } : a;
}
function decCmp(a, b) {
  const s = Math.max(a.scale, b.scale);
  const x = at2(a, s), y = at2(b, s);
  return x < y ? -1 : x > y ? 1 : 0;
}
var DEC_ZERO = { units: 0n, scale: 0 };
function decToString(d) {
  const neg = d.units < 0n;
  const digits = (neg ? -d.units : d.units).toString();
  if (d.scale === 0) return (neg ? "-" : "") + digits;
  const padded = digits.padStart(d.scale + 1, "0");
  return (neg ? "-" : "") + padded.slice(0, padded.length - d.scale) + "." + padded.slice(padded.length - d.scale);
}
function decFromLiteral(s) {
  const m = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(s);
  if (!m) return void 0;
  const [, sign, int = "", frac = "", exp] = m;
  if (int === "" && frac === "") return void 0;
  let units = BigInt((int || "0") + frac);
  let scale = frac.length;
  if (exp !== void 0) {
    const e = Number(exp);
    if (!Number.isSafeInteger(e) || Math.abs(e) > 400) return void 0;
    if (e >= scale) {
      units *= pow10(e - scale);
      scale = 0;
    } else scale -= e;
  }
  if (sign === "-") units = -units;
  return normDec(units, scale);
}
var NUMBER_EXACT_LIMIT = 1e15;
function decFromNumber(n) {
  if (!Number.isFinite(n)) return { problem: `${n} is not a finite number` };
  if (Math.abs(n) >= NUMBER_EXACT_LIMIT) return { problem: `${n} is too large to be read exactly from a number; supply it as a string` };
  const d = decFromLiteral(String(n));
  return d ?? { problem: `${n} does not print as a decimal` };
}
function effectiveAmountFormat(f = {}) {
  const decimal = f.decimal ?? ".";
  const group = f.group ?? "";
  if (decimal !== "." && decimal !== ",") throw new RangeError(`amount_format.decimal must be "." or "," (got ${JSON.stringify(f.decimal)})`);
  if (![",", ".", " ", "'", ""].includes(group)) throw new RangeError(`amount_format.group must be one of "," "." " " "'" or "" (got ${JSON.stringify(f.group)})`);
  if (group !== "" && group === decimal) throw new RangeError(`amount_format.group and amount_format.decimal cannot both be ${JSON.stringify(decimal)}`);
  const strip = f.strip ?? [];
  if (!Array.isArray(strip) || strip.some((s) => typeof s !== "string" || s === "" || /[\d]/.test(s))) throw new RangeError("amount_format.strip must be a list of non-empty symbols without digits");
  return { decimal, group, strip: [...strip], parens_negative: f.parens_negative ?? false, trailing_minus: f.trailing_minus ?? false };
}
var escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function readAmount(raw, fmt2) {
  if (typeof raw === "number") return decFromNumber(raw);
  if (typeof raw !== "string") return { problem: `${JSON.stringify(raw)} is not an amount (a number or text)` };
  let s = raw.trim();
  for (const sym of fmt2.strip) s = s.split(sym).join("");
  s = s.trim();
  let neg = false;
  if (fmt2.parens_negative && /^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1).trim();
  }
  if (fmt2.trailing_minus && s.endsWith("-") && !s.startsWith("-")) {
    neg = !neg;
    s = s.slice(0, -1).trim();
  }
  let sign = "";
  if (s.startsWith("-") || s.startsWith("+")) {
    sign = s[0];
    s = s.slice(1);
  }
  const d = escapeRe(fmt2.decimal);
  const plain = new RegExp(`^\\d+(?:${d}\\d+)?$|^${d}\\d+$`);
  let body;
  if (plain.test(s)) body = s;
  else if (fmt2.group !== "") {
    const g = escapeRe(fmt2.group);
    if (new RegExp(`^\\d{1,3}(?:${g}\\d{3})+(?:${d}\\d+)?$`).test(s)) body = s.split(fmt2.group).join("");
  }
  if (body === void 0) {
    const hint = fmt2.group === "" && /\d[,.' ]\d{3}(?:\D|$)/.test(s) ? " (it looks digit-grouped: declare amount_format.group to read it)" : "";
    return { problem: `${JSON.stringify(raw)} is not an amount under the declared format (decimal ${JSON.stringify(fmt2.decimal)}, group ${JSON.stringify(fmt2.group)})${hint}` };
  }
  const lit = decFromLiteral(sign + body.replace(fmt2.decimal, "."));
  if (!lit) return { problem: `${JSON.stringify(raw)} is not an amount` };
  return neg ? { units: -lit.units, scale: lit.scale } : lit;
}
function readConstant(raw, what) {
  const d = typeof raw === "number" ? decFromNumber(raw) : typeof raw === "string" ? decFromLiteral(raw.trim()) ?? { problem: "not a decimal" } : { problem: "not a number" };
  if ("problem" in d) throw new RangeError(`${what}: ${JSON.stringify(raw)} ${d.problem}`);
  if (d.units < 0n) throw new RangeError(`${what} cannot be negative (got ${JSON.stringify(raw)})`);
  return d;
}
var DATE_FORMATS = ["YYYY-MM-DD", "ISO", "MM/DD/YYYY", "DD/MM/YYYY", "DD.MM.YYYY", "YYYYMMDD"];
var DATE_RE = {
  "YYYY-MM-DD": { re: /^(\d{4})-(\d{2})-(\d{2})$/, y: 1, m: 2, d: 3 },
  ISO: { re: /^(\d{4})-(\d{2})-(\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/, y: 1, m: 2, d: 3 },
  "MM/DD/YYYY": { re: /^(\d{2})\/(\d{2})\/(\d{4})$/, y: 3, m: 1, d: 2 },
  "DD/MM/YYYY": { re: /^(\d{2})\/(\d{2})\/(\d{4})$/, y: 3, m: 2, d: 1 },
  "DD.MM.YYYY": { re: /^(\d{2})\.(\d{2})\.(\d{4})$/, y: 3, m: 2, d: 1 },
  YYYYMMDD: { re: /^(\d{4})(\d{2})(\d{2})$/, y: 1, m: 2, d: 3 }
};
function assertDateFormat(f, what) {
  if (!DATE_FORMATS.includes(f)) throw new RangeError(`${what} must be one of ${DATE_FORMATS.join(" | ")} (got ${JSON.stringify(f)})`);
  return f;
}
function readDate(raw, fmt2) {
  const s = typeof raw === "string" ? raw.trim() : typeof raw === "number" && Number.isInteger(raw) ? String(raw) : void 0;
  if (s === void 0) return { problem: `${JSON.stringify(raw)} is not a date` };
  const spec = DATE_RE[fmt2];
  const m = spec.re.exec(s);
  if (!m) return { problem: `${JSON.stringify(raw)} is not a ${fmt2} date` };
  const y = Number(m[spec.y]), mo = Number(m[spec.m]), d = Number(m[spec.d]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (mo < 1 || mo > 12 || d < 1 || dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
    return { problem: `${JSON.stringify(raw)} is not a calendar date (read as ${fmt2})` };
  }
  return `${m[spec.y]}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
function daysBetween(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);
}
function readUtcOffset(raw) {
  const m = typeof raw === "string" ? /^([+-])(\d{2}):?(\d{2})$/.exec(raw.trim()) : null;
  if (!m) throw new RangeError(`payment_date_utc_offset must look like "+00:00" or "-05:00" (got ${JSON.stringify(raw)})`);
  const mins = Number(m[2]) * 60 + Number(m[3]);
  if (Number(m[2]) > 14 || Number(m[3]) > 59) throw new RangeError(`payment_date_utc_offset out of range: ${JSON.stringify(raw)}`);
  return m[1] === "-" ? -mins : mins;
}
function localDateOf(instant, offsetMinutes) {
  const ms2 = Date.parse(instant);
  return new Date(ms2 + offsetMinutes * 6e4).toISOString().slice(0, 10);
}
function effectiveKeyRules(r = {}, what) {
  const c = r.case ?? "preserve";
  if (!["preserve", "upper", "lower"].includes(c)) throw new RangeError(`${what}.case must be preserve | upper | lower (got ${JSON.stringify(r.case)})`);
  if (r.remove !== void 0 && typeof r.remove !== "string") throw new RangeError(`${what}.remove must be a string of characters`);
  return { trim: r.trim ?? true, remove: r.remove ?? "", case: c, strip_leading_zeros: r.strip_leading_zeros ?? false };
}
function keyText(raw) {
  if (raw === void 0 || raw === null) return void 0;
  if (typeof raw === "string") return raw;
  if (typeof raw === "number") return Number.isFinite(raw) ? String(raw) : { problem: `${raw} is not a key` };
  return { problem: `${JSON.stringify(raw)} is not a key (text or a number)` };
}
function normalizeKey(s, r) {
  let k = r.trim ? s.trim() : s;
  if (r.remove) {
    const drop = /* @__PURE__ */ new Set([...r.remove]);
    k = [...k].filter((ch) => !drop.has(ch)).join("");
  }
  if (r.case === "upper") k = k.toUpperCase();
  else if (r.case === "lower") k = k.toLowerCase();
  if (r.strip_leading_zeros) k = k.replace(/^0+(?=.)/, "");
  return k;
}
function normalizeCurrency(raw) {
  if (raw === void 0 || raw === null) return void 0;
  if (typeof raw !== "string") return { problem: `${JSON.stringify(raw)} is not a currency code` };
  const c = raw.trim().toUpperCase();
  return c === "" ? void 0 : c;
}

// packages/verify/src/reconcile/completeness/engine.ts
var COMPLETENESS_BOUNDARY = [
  "Completeness of the population itself is the customer's IPE responsibility; this proves the book covers the population you gave it.",
  "Every population row is read as a payment. A voided or reversed payment in the export is still a row here.",
  "A match proves a verdict for this key is on the verified book. It does not prove the extraction is faithful to the paper document: that is the check's own job, measured separately.",
  "The book verified whole before any record was read. Its head is not externally anchored by this report: a party with write access to the store could recompute the chain. Anchor the head to make it third-party provable.",
  "Orphans can mean an item was paid outside this population. A PASS orphan is the one window this report has into whether the population is incomplete.",
  "PAID DESPITE HOLD sees only holds that are on the book. A held action the deployment did not record reads here as BYPASSED (a payment with no verdict), still an exception, but not named as an override.",
  "A rung is read only from a GRANT whose signer is anchored to a person (trusted or registered keys); an unanchored GRANT has no effect, and the rung falls back to the declared one, then to record."
];
var COVERAGE_NOTE = "For the population given, the counts are exact: it is a census, not a sample. The bound treats this period as one draw from the process that produced it: the per-payment not-on-book rate the data cannot rule out for that process.";
var COMPARABLE = ["vendor_id", "amount", "currency", "invoice_date"];
function isSource(s) {
  if (!s || typeof s !== "object" || Array.isArray(s)) return false;
  const k = Object.keys(s);
  if (k.length !== 1) return false;
  const v = s[k[0]];
  return (k[0] === "extraction" || k[0] === "claim") && typeof v === "string" && v.trim() !== "";
}
function effectiveCompletenessMapping(m) {
  const bad2 = (why) => {
    throw new CompletenessRefused(`mapping: ${why}`);
  };
  if (!m || typeof m !== "object") bad2("a mapping object is required");
  if (m.mapping_version !== "completeness-mapping-v0") bad2(`mapping_version must be "completeness-mapping-v0" (got ${JSON.stringify(m.mapping_version)})`);
  if (!Array.isArray(m.key) || m.key.length === 0) bad2("key must name at least one of invoice_number, vendor_id");
  const key = [...new Set(m.key)];
  if (key.length !== m.key.length) bad2("key names a field twice");
  for (const k of key) if (!KEY_FIELDS.includes(k)) bad2(`key field ${JSON.stringify(k)} is not one of ${KEY_FIELDS.join(", ")}`);
  const cols = m.population?.columns;
  if (!cols || typeof cols !== "object") bad2("population.columns is required");
  for (const [f, c] of Object.entries(cols)) {
    if (c === void 0) continue;
    if (!POPULATION_FIELDS.includes(f)) bad2(`population.columns names an unknown field ${JSON.stringify(f)} (fields: ${POPULATION_FIELDS.join(", ")})`);
    if (typeof c !== "string" || c === "") bad2(`population.columns.${f} must be a column name`);
  }
  const fields = m.book?.fields;
  if (!fields || typeof fields !== "object") bad2("book.fields is required");
  for (const [f, srcs] of Object.entries(fields)) {
    if (srcs === void 0) continue;
    if (!BOOK_FIELDS.includes(f)) bad2(`book.fields names an unknown field ${JSON.stringify(f)} (fields: ${BOOK_FIELDS.join(", ")})`);
    if (!Array.isArray(srcs) || srcs.length === 0 || !srcs.every(isSource)) bad2(`book.fields.${f} must be a non-empty list of { extraction: "<path>" } or { claim: "<claim_id>" }`);
  }
  for (const k of key) {
    if (!cols[k]) bad2(`key field ${k} has no population column`);
    if (!fields[k]) bad2(`key field ${k} has no book source`);
  }
  const wrap = (what, f) => {
    try {
      return f();
    } catch (e) {
      return bad2(`${what}: ${e.message}`);
    }
  };
  const tolAbs = wrap("amount_tolerance.abs", () => readConstant(m.amount_tolerance?.abs ?? 0, "amount_tolerance.abs"));
  const tolRel = wrap("amount_tolerance.rel", () => readConstant(m.amount_tolerance?.rel ?? 0, "amount_tolerance.rel"));
  const days = m.date_tolerance_days ?? 0;
  if (!Number.isInteger(days) || days < 0) bad2(`date_tolerance_days must be a non-negative integer (got ${JSON.stringify(m.date_tolerance_days)})`);
  const offset = m.payment_date_utc_offset ?? "+00:00";
  wrap("payment_date_utc_offset", () => readUtcOffset(offset));
  const onMal = m.on_malformed ?? "refuse";
  if (onMal !== "refuse" && onMal !== "report") bad2(`on_malformed must be refuse or report (got ${JSON.stringify(m.on_malformed)})`);
  const normalize2 = {};
  for (const k of KEY_FIELDS) normalize2[k] = wrap(`normalize.${k}`, () => effectiveKeyRules(m.normalize?.[k], `normalize.${k}`));
  for (const k of Object.keys(m.normalize ?? {})) if (!KEY_FIELDS.includes(k)) bad2(`normalize names an unknown key field ${JSON.stringify(k)}`);
  const compared = COMPARABLE.filter((f) => !key.includes(f) && cols[f] !== void 0 && fields[f] !== void 0);
  const sortObj = (o) => Object.fromEntries(Object.keys(o).filter((k) => o[k] !== void 0).sort().map((k) => [k, o[k]]));
  return {
    mapping_version: "completeness-mapping-v0",
    key: KEY_FIELDS.filter((k) => key.includes(k)),
    population: {
      columns: sortObj(cols),
      amount_format: wrap("population.amount_format", () => effectiveAmountFormat(m.population.amount_format)),
      date_format: wrap("population.date_format", () => assertDateFormat(m.population.date_format ?? "YYYY-MM-DD", "population.date_format"))
    },
    book: {
      fields: sortObj(Object.fromEntries(Object.entries(fields).filter(([, s]) => s !== void 0).map(([f, s]) => [f, s.map((x) => ({ ...x }))]))),
      amount_format: wrap("book.amount_format", () => effectiveAmountFormat(m.book.amount_format)),
      date_format: wrap("book.date_format", () => assertDateFormat(m.book.date_format ?? "YYYY-MM-DD", "book.date_format"))
    },
    normalize: normalize2,
    amount_tolerance: { abs: decToString(tolAbs), rel: decToString(tolRel) },
    date_tolerance_days: days,
    payment_date_utc_offset: offset,
    on_malformed: onMal,
    compared
  };
}
function getPath3(obj, path) {
  const parts = path.replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean);
  let cur = obj;
  for (const p of parts) {
    if (cur === null || typeof cur !== "object") return void 0;
    cur = cur[p];
  }
  return cur;
}
var blank = (v) => v === void 0 || v === null || typeof v === "string" && v.trim() === "";
function readPopulationRow(r, m, csv) {
  const val2 = (f) => {
    const col = m.population.columns[f];
    if (col === void 0) return void 0;
    if (csv || Object.prototype.hasOwnProperty.call(r.values, col)) return r.values[col];
    return getPath3(r.values, col);
  };
  const problems = [];
  const problem = (field, raw, why) => {
    problems.push({ field, column: m.population.columns[field], value: typeof raw === "string" ? raw : JSON.stringify(raw), why });
  };
  const ref2 = { row: r.row, line: r.line, key: {} };
  const missingKey = [];
  for (const k of KEY_FIELDS) {
    if (m.population.columns[k] === void 0) continue;
    const raw = val2(k);
    if (blank(raw)) {
      if (m.key.includes(k)) missingKey.push(k);
      continue;
    }
    const t = keyText(raw);
    if (t === void 0) continue;
    if (typeof t === "object") {
      problem(k, raw, t.problem);
      continue;
    }
    const norm2 = normalizeKey(t, m.normalize[k]);
    if (norm2 === "") {
      if (m.key.includes(k)) missingKey.push(k);
      continue;
    }
    if (m.key.includes(k)) ref2.key[k] = norm2;
    if (k === "vendor_id") ref2.vendor_id = norm2;
  }
  const pid = val2("payment_id");
  if (!blank(pid)) ref2.payment_id = String(pid);
  let amount;
  const rawAmt = val2("amount");
  if (!blank(rawAmt)) {
    const a = readAmount(rawAmt, m.population.amount_format);
    if ("problem" in a) problem("amount", rawAmt, a.problem);
    else {
      amount = a;
      ref2.amount = decToString(a);
    }
  }
  const rawCur = val2("currency");
  const c = normalizeCurrency(rawCur);
  if (typeof c === "object") problem("currency", rawCur, c.problem);
  else if (c !== void 0) ref2.currency = c;
  for (const f of ["invoice_date", "payment_date"]) {
    const raw = val2(f);
    if (blank(raw)) continue;
    const d = readDate(raw, m.population.date_format);
    if (typeof d === "object") problem(f, raw, d.problem);
    else ref2[f] = d;
  }
  const keyString = missingKey.length === 0 && problems.every((p) => !m.key.includes(p.field)) ? m.key.map((k) => ref2.key[k] ?? "").join("\0") : void 0;
  return { ref: ref2, ...amount !== void 0 ? { amount } : {}, ...keyString !== void 0 ? { keyString } : {}, missingKey, problems };
}
function readBookRecord(v, m, extractions) {
  const ex = extractions.get(v.verdict.document?.extraction_hash);
  const sources = {};
  const raw = (f) => {
    for (const s of m.book.fields[f] ?? []) {
      let value;
      let source;
      if ("extraction" in s) {
        if (ex === void 0) continue;
        value = getPath3(ex, s.extraction);
        source = `extraction:${s.extraction}`;
      } else {
        value = v.verdict.claims?.find((c) => c.claim_id === s.claim)?.asserted;
        source = `claim:${s.claim}`;
      }
      if (!blank(value)) return { value, source };
    }
    return void 0;
  };
  const ref2 = {
    verdict_id: v.verdict_id,
    tenant_id: v.tenant_id,
    workflow_id: v.workflow_id,
    outcome: v.verdict.outcome,
    record_seq: v.record.seq,
    entry_hash: v.record.entry_hash,
    recorded_at: v.record.recorded_at,
    first_recorded_at: v.first_record.recorded_at,
    key: {},
    sources
  };
  const missingKey = [];
  const keyWhy = [];
  const unreadable = {};
  for (const k of KEY_FIELDS) {
    if (m.book.fields[k] === void 0) continue;
    const r = raw(k);
    const t = r ? keyText(r.value) : void 0;
    const norm2 = typeof t === "string" ? normalizeKey(t, m.normalize[k]) : void 0;
    if (!r || typeof t !== "string" || !norm2) {
      if (m.key.includes(k)) {
        missingKey.push(k);
        keyWhy.push(!r ? `${k}: no declared source yielded a value${ex === void 0 && (m.book.fields[k] ?? []).some((s) => "extraction" in s) ? " (its extraction was not supplied)" : ""}` : `${k}: ${typeof t === "object" ? t.problem : "empty after normalization"}`);
      } else if (r && k === "vendor_id") unreadable.vendor_id = typeof t === "object" ? t.problem : "empty after normalization";
      continue;
    }
    sources[k] = r.source;
    if (m.key.includes(k)) ref2.key[k] = norm2;
    if (k === "vendor_id") ref2.vendor_id = norm2;
  }
  let amount;
  const ra = raw("amount");
  if (ra) {
    const a = readAmount(ra.value, m.book.amount_format);
    if ("problem" in a) unreadable.amount = a.problem;
    else {
      amount = a;
      ref2.amount = decToString(a);
      sources.amount = ra.source;
    }
  }
  const rc = raw("currency");
  if (rc) {
    const c = normalizeCurrency(rc.value);
    if (typeof c === "object") unreadable.currency = c.problem;
    else if (c !== void 0) {
      ref2.currency = c;
      sources.currency = rc.source;
    }
  }
  const rd = raw("invoice_date");
  if (rd) {
    const d = readDate(rd.value, m.book.date_format);
    if (typeof d === "object") unreadable.invoice_date = d.problem;
    else {
      ref2.invoice_date = d;
      sources.invoice_date = rd.source;
    }
  }
  const keyString = missingKey.length === 0 ? m.key.map((k) => ref2.key[k] ?? "").join("\0") : void 0;
  const usedExtraction = ex !== void 0 && Object.values(sources).some((s) => s?.startsWith("extraction:")) ? v.verdict.document.extraction_hash : void 0;
  return { view: v, ref: ref2, ...amount !== void 0 ? { amount } : {}, ...keyString !== void 0 ? { keyString } : {}, missingKey, keyWhy, unreadable, usedExtraction };
}
function rungAt(decisions, granted, declared, workflow_id, seq, reading) {
  if (granted.has(workflow_id)) {
    const g = grantAt(decisions, workflow_id, seq, reading);
    return g ? { level: g.signed.decision.level, from: "grant", grant: g } : { level: "record", from: "grant" };
  }
  const d = declared[workflow_id];
  return d !== void 0 ? { level: d, from: "declared" } : { level: "record", from: "none" };
}
function holdOf(b, decisions, granted, declared, reading) {
  const o = b.view.verdict.outcome;
  if (o !== "FAIL" && o !== "INSUFFICIENT_DATA") return void 0;
  for (const seq of b.view.record_seqs) {
    const r = rungAt(decisions, granted, declared, b.view.workflow_id, seq, reading);
    if (ACTION_HANDLING[r.level]?.[o] === "HOLD") return r;
  }
  return void 0;
}
function addTo(totals, currency, amount) {
  if (amount === void 0) return;
  const c = currency ?? "UNSPECIFIED";
  totals[c] = decAdd(totals[c] ?? DEC_ZERO, amount);
}
var totalsOut = (t) => Object.fromEntries(Object.keys(t).sort().map((k) => [k, decToString(t[k])]));
function checkInterval(i) {
  const method = i?.method ?? "clopper-pearson";
  const confidence = i?.confidence ?? 0.95;
  const sidedness = i?.sidedness ?? "one-sided";
  if (method !== "wilson" && method !== "clopper-pearson") throw new CompletenessRefused(`interval.method must be wilson or clopper-pearson (got ${JSON.stringify(method)})`);
  if (!(confidence >= 0.5 && confidence < 1)) throw new CompletenessRefused(`interval.confidence must be in [0.5, 1) (got ${confidence})`);
  if (sidedness !== "one-sided" && sidedness !== "two-sided") throw new CompletenessRefused(`interval.sidedness must be one-sided or two-sided (got ${JSON.stringify(sidedness)})`);
  return { method, confidence, sidedness };
}
function reconcileCompleteness(population, book, mapping, options = {}) {
  const m = effectiveCompletenessMapping(mapping);
  const interval = checkInterval(options.interval);
  const offsetMin = readUtcOffset(m.payment_date_utc_offset);
  const scope = options.scope ?? {};
  const period = {};
  for (const k of ["since", "until"]) {
    const v = options.period?.[k];
    if (v === void 0) continue;
    const ms2 = Date.parse(v);
    if (Number.isNaN(ms2)) throw new CompletenessRefused(`period.${k} is not an ISO-8601 instant: ${JSON.stringify(v)}`);
    period[k] = new Date(ms2).toISOString();
  }
  const declared = options.rungs ?? {};
  const reading = options.policy ? { policies: [options.policy], governing_policy: options.policy } : {};
  const csv = population.format === "csv";
  if (csv && population.columns) {
    for (const [f, col] of Object.entries(m.population.columns)) {
      if (!population.columns.includes(col)) throw new CompletenessRefused(`mapping: population.columns.${f} names column ${JSON.stringify(col)}, which the header does not have (header: ${population.columns.map((c) => JSON.stringify(c)).join(", ")})`);
    }
  }
  const bv = readBook2(book, options.anchors ?? {});
  const grants = bv.decisions.filter((e) => e.signed.decision.kind === "GRANT");
  const granted = new Set(grants.filter(isAnchored).map((e) => e.signed.decision.workflow_id));
  const own = (t) => scope.tenant_id === void 0 || t === scope.tenant_id;
  const unanchored_grants = grants.filter((e) => !isAnchored(e) && own(tenantOfWorkflow(e.signed.decision.workflow_id))).map((e) => ({ decision_id: e.decision_id, seq: e.seq, workflow_id: e.signed.decision.workflow_id, level: e.signed.decision.level, signer_id: e.signed.decision.signer_id }));
  const extractions = /* @__PURE__ */ new Map();
  for (const x of options.extractions ?? []) extractions.set(hashOf(x), x);
  const inPeriod = (at3) => (period.since === void 0 || at3 >= period.since) && (period.until === void 0 || at3 < period.until);
  const not_verdict = [];
  let out_of_scope = 0;
  const scoped = [];
  for (const v of bv.records) {
    if (!own(v.tenant_id)) continue;
    const rs = v.verdict.ruleset;
    if (scope.tenant_id !== void 0 && v.tenant_id !== scope.tenant_id || scope.workflows !== void 0 && !scope.workflows.includes(v.workflow_id) || scope.rulesets !== void 0 && !scope.rulesets.includes(String(rs?.id))) {
      out_of_scope++;
      continue;
    }
    if (v.not_verdict) {
      not_verdict.push({ verdict_id: v.verdict_id, tenant_id: v.tenant_id, why: v.not_verdict });
      continue;
    }
    scoped.push(readBookRecord(v, m, extractions));
  }
  const ownRecords = bv.records.filter((r) => own(r.tenant_id));
  const ownSigners = scope.tenant_id === void 0 ? void 0 : bv.signersOf(scope.tenant_id);
  const usedExtractions = new Set(scoped.map((b) => b.usedExtraction).filter((h) => h !== void 0));
  const rows = population.rows.map((r) => readPopulationRow(r, m, csv));
  const unreadable = [];
  for (const r of rows) {
    if (r.problems.length === 0) continue;
    if (m.on_malformed === "refuse") {
      const p = r.problems[0];
      throw new CompletenessRefused(`row ${r.ref.row} (line ${r.ref.line}), column ${JSON.stringify(p.column)}: ${p.why}. Declare the format that reads it, or on_malformed: "report" to list the row as UNREADABLE`, { row: r.ref.row, line: r.ref.line });
    }
    unreadable.push({ row: r.ref.row, line: r.ref.line, problems: r.problems });
  }
  const groups = /* @__PURE__ */ new Map();
  const group = (k) => {
    let g = groups.get(k);
    if (!g) {
      g = { pops: [], books: [] };
      groups.set(k, g);
    }
    return g;
  };
  const bypassed = [];
  for (const r of rows) {
    if (r.problems.length > 0) continue;
    if (r.keyString === void 0) {
      bypassed.push({ population: r.ref, reason: "NO_KEY", duplicate_key: false });
      continue;
    }
    group(r.keyString).pops.push(r);
  }
  const unkeyed = [];
  for (const b of scoped) {
    if (b.keyString === void 0) {
      if (inPeriod(b.ref.recorded_at)) unkeyed.push({ book: b.ref, missing: b.missingKey, why: b.keyWhy });
      continue;
    }
    group(b.keyString).books.push(b);
  }
  const matchedAll = [];
  const ambiguous = [];
  const orphans = [];
  const popClass = /* @__PURE__ */ new Map();
  const bookClass = /* @__PURE__ */ new Map();
  const tolAbs = readConstant(m.amount_tolerance.abs, "abs"), tolRel = readConstant(m.amount_tolerance.rel, "rel");
  for (const g of groups.values()) {
    if (g.pops.length === 0) {
      for (const b2 of g.books) {
        bookClass.set(b2, "ORPHAN");
        if (inPeriod(b2.ref.recorded_at)) orphans.push({ book: b2.ref, held: holdOf(b2, bv.decisions, granted, declared, reading) !== void 0, reviewed: b2.view.review !== void 0 });
      }
      continue;
    }
    if (g.books.length === 0) {
      for (const r3 of g.pops) {
        bypassed.push({ population: r3.ref, reason: "NO_VERDICT", duplicate_key: g.pops.length > 1 });
        popClass.set(r3.ref.row, "BYPASSED");
      }
      continue;
    }
    if (g.pops.length > 1 || g.books.length > 1) {
      const shape = g.pops.length > 1 && g.books.length > 1 ? "MANY_TO_MANY" : g.books.length > 1 ? "BOOK_DUPLICATES" : "POPULATION_DUPLICATES";
      ambiguous.push({
        key: { ...g.pops[0].ref.key },
        shape,
        population: g.pops.map((r3) => r3.ref).sort((a, b2) => a.row - b2.row),
        book: g.books.map((b2) => b2.ref).sort((a, b2) => a.record_seq - b2.record_seq)
      });
      for (const r3 of g.pops) popClass.set(r3.ref.row, "AMBIGUOUS");
      for (const b2 of g.books) bookClass.set(b2, "AMBIGUOUS");
      continue;
    }
    const r = g.pops[0], b = g.books[0];
    bookClass.set(b, "MATCHED");
    const differences = [];
    const uncompared = [];
    const missing = (f, side) => {
      uncompared.push({ field: f, why: side === "book" && b.unreadable[f] ? `unreadable on the book: ${b.unreadable[f]}` : `missing ${side === "book" ? "on the book" : "in the population"}` });
    };
    const currencyDiffers = m.compared.includes("currency") && r.ref.currency !== void 0 && b.ref.currency !== void 0 && r.ref.currency !== b.ref.currency;
    for (const f of m.compared) {
      const pv = f === "amount" ? r.ref.amount : r.ref[f];
      const bvv = f === "amount" ? b.ref.amount : b.ref[f];
      if (pv === void 0) {
        missing(f, "population");
        continue;
      }
      if (bvv === void 0) {
        missing(f, "book");
        continue;
      }
      const src = b.ref.sources[f] ?? "";
      if (f === "amount") {
        const diff = decSub(b.amount, r.amount);
        const big = decCmp(decAbs(b.amount), decAbs(r.amount)) >= 0 ? decAbs(b.amount) : decAbs(r.amount);
        const rel = decMul(tolRel, big);
        const allowed = decCmp(tolAbs, rel) >= 0 ? tolAbs : rel;
        if (decCmp(decAbs(diff), allowed) > 0) differences.push({ field: f, population: pv, book: bvv, book_source: src, ...currencyDiffers ? {} : { delta: decToString(diff) } });
      } else if (f === "invoice_date") {
        const d = daysBetween(pv, bvv);
        if (Math.abs(d) > m.date_tolerance_days) differences.push({ field: f, population: pv, book: bvv, book_source: src, delta: String(d) });
      } else if (pv !== bvv) {
        differences.push({ field: f, population: pv, book: bvv, book_source: src });
      }
    }
    const flags = [];
    let hold;
    const held = holdOf(b, bv.decisions, granted, declared, reading);
    if (held) {
      const rv = b.view.review;
      const resolution = !rv ? "NONE" : r.ref.payment_date === void 0 ? "UNORDERED" : localDateOf(rv.first_decided_at, offsetMin) > r.ref.payment_date ? "AFTER_PAYMENT" : "ON_OR_BEFORE_PAYMENT";
      hold = {
        rung: held.level,
        rung_from: held.from,
        ...held.grant ? { grant: { decision_id: held.grant.decision_id, seq: held.grant.seq, signer_id: held.grant.signed.decision.signer_id } } : {},
        resolution,
        ...rv ? { review: { ...rv } } : {}
      };
      if (resolution === "NONE" || resolution === "AFTER_PAYMENT") flags.push("PAID_DESPITE_HOLD");
    }
    if (differences.length > 0) flags.push("MISMATCHED");
    let late;
    if (r.ref.payment_date !== void 0) {
      const day = localDateOf(b.ref.first_recorded_at, offsetMin);
      if (day > r.ref.payment_date) {
        late = { first_recorded_day: day, payment_date: r.ref.payment_date };
        flags.push("CHECKED_AFTER_PAYMENT");
      }
    }
    flags.sort((x, y) => MATCH_PRECEDENCE.indexOf(x) - MATCH_PRECEDENCE.indexOf(y));
    const cls = flags[0] ?? "MATCHED";
    popClass.set(r.ref.row, cls);
    matchedAll.push({ class: cls, flags, population: r.ref, book: b.ref, differences, uncompared, ...hold ? { hold } : {}, ...late ? { late } : {} });
  }
  for (const u of unreadable) popClass.set(u.row, "UNREADABLE");
  for (const x of bypassed) popClass.set(x.population.row, "BYPASSED");
  matchedAll.sort((a, b) => a.population.row - b.population.row);
  bypassed.sort((a, b) => a.population.row - b.population.row);
  ambiguous.sort((a, b) => a.population[0].row - b.population[0].row);
  orphans.sort((a, b) => a.book.record_seq - b.book.record_seq);
  unkeyed.sort((a, b) => a.book.record_seq - b.book.record_seq);
  unreadable.sort((a, b) => a.row - b.row);
  not_verdict.sort((a, b) => a.tenant_id.localeCompare(b.tenant_id) || a.verdict_id.localeCompare(b.verdict_id));
  const byClass = Object.fromEntries(POPULATION_CLASSES.map((c) => [c, 0]));
  const amtByClass = Object.fromEntries(POPULATION_CLASSES.map((c) => [c, {}]));
  const popTotals = {};
  let rowsWithoutAmount = 0;
  for (const r of rows) {
    const c = popClass.get(r.ref.row);
    byClass[c]++;
    if (r.amount === void 0) {
      rowsWithoutAmount++;
      continue;
    }
    addTo(popTotals, r.ref.currency, r.amount);
    addTo(amtByClass[c], r.ref.currency, r.amount);
  }
  const bookByClass = Object.fromEntries(BOOK_CLASSES.map((c) => [c, 0]));
  const bookAmt = Object.fromEntries(BOOK_CLASSES.map((c) => [c, {}]));
  let inPeriodCount = 0, matchedOutsidePeriod = 0;
  for (const b of scoped) {
    const c = b.keyString === void 0 ? "UNKEYED" : bookClass.get(b);
    if (!inPeriod(b.ref.recorded_at)) {
      if (c === "MATCHED") matchedOutsidePeriod++;
      continue;
    }
    inPeriodCount++;
    bookByClass[c]++;
    addTo(bookAmt[c], b.ref.currency, b.amount);
  }
  const n = rows.length;
  const on_book = byClass.MATCHED + byClass.MISMATCHED + byClass.PAID_DESPITE_HOLD + byClass.CHECKED_AFTER_PAYMENT;
  const not_on_book = n - on_book;
  const iv = rateInterval(not_on_book, n, interval.confidence, interval.method, interval.sidedness);
  const dated = matchedAll.filter((x) => x.population.payment_date !== void 0);
  const anyPaymentDate = m.population.columns.payment_date !== void 0;
  const exceptions = {
    paid_despite_hold: matchedAll.filter((x) => x.class === "PAID_DESPITE_HOLD"),
    mismatched: matchedAll.filter((x) => x.class === "MISMATCHED"),
    checked_after_payment: matchedAll.filter((x) => x.class === "CHECKED_AFTER_PAYMENT"),
    ambiguous,
    bypassed,
    unreadable,
    orphans,
    unkeyed
  };
  const resolvedItems = matchedAll.filter((x) => x.hold && (x.hold.resolution === "ON_OR_BEFORE_PAYMENT" || x.hold.resolution === "UNORDERED"));
  const cleanPairs = matchedAll.filter((x) => x.class === "MATCHED");
  const rungWorkflows = [...new Set(scoped.map((b) => b.view.workflow_id))].sort();
  const extractionHashes = [...extractions.keys()].sort();
  const body = {
    report_version: "completeness-v0",
    engine_version: ENGINE_VERSION,
    binds: {
      book: { head: bv.head, length: bv.length },
      population: {
        format: population.format,
        ...population.sha256 !== void 0 ? { sha256: population.sha256 } : {},
        ...population.bytes !== void 0 ? { bytes: population.bytes } : {},
        rows: n,
        rows_hash: populationRowsHash(population)
      },
      mapping_hash: hashOf(m),
      options_hash: hashOf({ scope, period, rungs: declared, interval, anchors: options.anchors ?? null, ...options.policy ? { policy: hashOf(options.policy) } : {} }),
      extractions: { supplied: options.extractions?.length ?? 0, distinct: extractions.size, used: usedExtractions.size, set_hash: hashOf(extractionHashes) },
      matched_hash: hashOf(cleanPairs.map((x) => [x.population.row, x.book.tenant_id, x.book.verdict_id]))
    },
    mapping: m,
    scope: { ...scope },
    period: { ...period },
    population: { rows: n, by_class: byClass },
    book: {
      verified: true,
      unanchored_signers: scope.tenant_id === void 0 ? bv.unanchored : bv.unanchored.filter((s) => ownSigners.has(s)),
      unanchored_grants,
      tenants: [...new Set(ownRecords.map((r) => r.tenant_id))].sort(),
      records: ownRecords.length,
      out_of_scope,
      not_verdict,
      in_scope: scoped.length,
      in_period: inPeriodCount,
      by_class: bookByClass,
      matched_outside_period: matchedOutsidePeriod,
      rungs: rungWorkflows.map((w) => ({ workflow_id: w, from: granted.has(w) ? "grant" : declared[w] !== void 0 ? "declared" : "none" }))
    },
    coverage: {
      population_rows: n,
      on_book,
      not_on_book,
      rate: n === 0 ? null : on_book / n,
      bound: {
        ...interval,
        words: describeBound(interval.confidence, interval.method, interval.sidedness),
        not_on_book_upper: iv.upper,
        coverage_lower: Math.max(0, Math.floor((1 - iv.upper) * 1e12) / 1e12)
      },
      ...anyPaymentDate ? { before_payment: { rows_with_date: dated.length, checked_by_payment_date: dated.filter((x) => !x.late).length, checked_after: dated.filter((x) => x.late).length } } : {},
      note: COVERAGE_NOTE
    },
    amounts: {
      population: totalsOut(popTotals),
      by_class: Object.fromEntries(POPULATION_CLASSES.map((c) => [c, totalsOut(amtByClass[c])])),
      rows_without_amount: rowsWithoutAmount,
      book_in_period: Object.fromEntries(BOOK_CLASSES.map((c) => [c, totalsOut(bookAmt[c])]))
    },
    exceptions,
    resolved_holds: {
      count: resolvedItems.length,
      upheld: resolvedItems.filter((x) => x.hold.review.decision === "UPHELD").length,
      overturned: resolvedItems.filter((x) => x.hold.review.decision === "OVERTURNED").length,
      items: resolvedItems
    },
    matched_with_uncompared: matchedAll.filter((x) => x.uncompared.length > 0).length,
    ...options.include_matched ? { matched: cleanPairs } : {},
    clean: byClass.MATCHED === n,
    boundary: [...COMPLETENESS_BOUNDARY]
  };
  const report_hash = hashOf(body);
  return { ...body, report_hash, ...options.now ? { generated_at: options.now().toISOString() } : {} };
}

// packages/verify/src/reconcile/completeness/render.ts
var cell = (s) => s === void 0 || s === "" ? "\u2014" : String(s).replace(/\|/g, "\\|").replace(/[\r\n]+/g, " ");
var code = (s) => s === void 0 ? "\u2014" : "`" + s.replace(/`/g, "'").replace(/\|/g, "\\|") + "`";
var pct3 = (x) => `${Number((x * 100).toPrecision(4))}%`;
var money = (t) => {
  const ks = Object.keys(t);
  return ks.length === 0 ? "\u2014" : ks.map((k) => `${t[k]} ${k}`).join(" \xB7 ");
};
var keyOf = (k) => Object.entries(k).map(([f, v]) => `${f}=${v}`).join(", ");
var rowRef = (p) => `${p.row}${p.payment_id !== void 0 ? ` (${cell(p.payment_id)})` : ""}`;
var verdictRef2 = (b) => `${code(b.verdict_id)} @${b.record_seq}`;
var LABEL = {
  MATCHED: "MATCHED",
  MISMATCHED: "MISMATCHED",
  PAID_DESPITE_HOLD: "PAID DESPITE HOLD",
  CHECKED_AFTER_PAYMENT: "CHECKED AFTER PAYMENT",
  AMBIGUOUS: "AMBIGUOUS",
  BYPASSED: "BYPASSED",
  UNREADABLE: "UNREADABLE",
  ORPHAN: "ORPHAN",
  UNKEYED: "UNKEYED"
};
function more(L, total, shown2) {
  if (total > shown2) L.push("", `\u2026 and ${total - shown2} more (in the JSON report).`);
}
function holdWords(x) {
  const h = x.hold;
  if (!h) return "\u2014";
  const by = h.rung_from === "grant" && h.grant ? `GRANT ${code(h.grant.decision_id.slice(0, 12))} by ${cell(h.grant.signer_id)}` : "declared rung";
  const res = h.resolution === "NONE" ? "no person has reviewed it" : h.resolution === "AFTER_PAYMENT" ? `first reviewed ${h.review.first_decided_at.slice(0, 10)}, after the payment` : h.resolution === "UNORDERED" ? `reviewed (${h.review.decision}); no payment date to order it by` : `reviewed ${h.review.first_decided_at.slice(0, 10)} (${h.review.decision})`;
  return `held at \`${h.rung}\` (${by}); ${res}`;
}
function renderCompletenessReport(r, opts = {}) {
  const max = opts.max_rows ?? 50;
  const L = [];
  const pb = r.binds.population;
  L.push("# Completeness reconciliation", "");
  L.push(`**What this covers.** The book of record at head ${code(r.binds.book.head)} (${r.binds.book.length} events), verified whole before any record was read, reconciled against the population ${pb.sha256 !== void 0 ? code(pb.sha256) : `rows ${code(pb.rows_hash)}`} (${pb.format}${pb.bytes !== void 0 ? `, ${pb.bytes} bytes` : ""}, ${pb.rows} rows).`);
  L.push(`Mapping ${code(r.binds.mapping_hash.slice(0, 16))} \xB7 options ${code(r.binds.options_hash.slice(0, 16))} \xB7 engine ${r.engine_version} \xB7 report ${code(r.report_hash)}${r.generated_at ? ` \xB7 generated ${r.generated_at}` : ""}.`);
  const sc = [r.scope.tenant_id !== void 0 ? `tenant \`${r.scope.tenant_id}\`` : "", r.scope.workflows ? `workflows ${r.scope.workflows.map((w) => code(w)).join(", ")}` : "", r.scope.rulesets ? `rulesets ${r.scope.rulesets.map((w) => code(w)).join(", ")}` : ""].filter(Boolean);
  const pe = [r.period.since ? `from ${r.period.since}` : "", r.period.until ? `until ${r.period.until}` : ""].filter(Boolean);
  L.push(`Scope: ${sc.length ? sc.join("; ") : "every record on the book"}. Period (book clock): ${pe.length ? pe.join(" ") : "the whole book"}.`, "");
  L.push(`> ${r.boundary[0]}`, "");
  const c = r.coverage;
  L.push("## The answer", "");
  L.push(`- **${r.clean ? "Clean" : "Not clean"}.** ${c.on_book} of ${c.population_rows} payments (${c.rate === null ? "n/a" : pct3(c.rate)}) went through the check and have exactly one verdict on the book; ${c.not_on_book} did not (BYPASSED ${r.population.by_class.BYPASSED}, AMBIGUOUS ${r.population.by_class.AMBIGUOUS}, UNREADABLE ${r.population.by_class.UNREADABLE}).`);
  L.push(`- **Bound (${c.bound.words}):** the not-on-book rate the data cannot rule out is ${pct3(c.bound.not_on_book_upper)} (coverage at least ${pct3(c.bound.coverage_lower)}). ${c.note}`);
  if (c.before_payment) L.push(`- **Checked by the payment date:** ${c.before_payment.checked_by_payment_date} of ${c.before_payment.rows_with_date} dated payments on the book; ${c.before_payment.checked_after} were checked only after they were paid.`);
  L.push(`- **Exceptions:** PAID DESPITE HOLD ${r.population.by_class.PAID_DESPITE_HOLD} \xB7 MISMATCHED ${r.population.by_class.MISMATCHED} \xB7 CHECKED AFTER PAYMENT ${r.population.by_class.CHECKED_AFTER_PAYMENT}. Orphans on the book: ${r.book.by_class.ORPHAN}.`, "");
  L.push("## The population", "");
  L.push("| class | rows | amount |", "|---|---:|---|");
  for (const k of POPULATION_CLASSES) L.push(`| ${LABEL[k]} | ${r.population.by_class[k]} | ${money(r.amounts.by_class[k])} |`);
  L.push(`| **total** | **${r.population.rows}** | **${money(r.amounts.population)}** |`, "");
  if (r.amounts.rows_without_amount) L.push(`${r.amounts.rows_without_amount} row(s) have no readable amount and are not in the totals.`, "");
  const pdh = r.exceptions.paid_despite_hold;
  L.push(`## PAID DESPITE HOLD (${pdh.length}): a control override`, "");
  if (pdh.length === 0) L.push("None. No payment was made on a FAIL/ABSTAIN that the book held at gate or autonomy without a person's resolution.", "");
  else {
    L.push("Paid, while the book says the verdict was held at a holding rung and no person had resolved it by the payment date.", "");
    L.push("| row | key | paid | payment date | verdict | outcome | hold |", "|---|---|---|---|---|---|---|");
    for (const x of pdh.slice(0, max)) L.push(`| ${rowRef(x.population)} | ${cell(keyOf(x.population.key))} | ${cell(x.population.amount)} ${cell(x.population.currency ?? "")} | ${cell(x.population.payment_date)} | ${verdictRef2(x.book)} | ${x.book.outcome} | ${holdWords(x)} |`);
    more(L, pdh.length, Math.min(max, pdh.length));
    L.push("");
  }
  const mm = r.exceptions.mismatched;
  L.push(`## MISMATCHED (${mm.length}): what was checked is not what was paid`, "");
  if (mm.length === 0) L.push("None.", "");
  else {
    L.push("| row | key | field | paid | on the book | book source | \u0394 (book \u2212 paid) | verdict |", "|---|---|---|---|---|---|---|---|");
    let shown2 = 0;
    for (const x of mm.slice(0, max)) {
      for (const d of x.differences) L.push(`| ${rowRef(x.population)} | ${cell(keyOf(x.population.key))} | ${d.field} | ${cell(d.population)} | ${cell(d.book)} | ${code(d.book_source)} | ${cell(d.delta)} | ${verdictRef2(x.book)} |`);
      shown2++;
    }
    more(L, mm.length, shown2);
    L.push("");
  }
  const late = r.exceptions.checked_after_payment;
  L.push(`## CHECKED AFTER PAYMENT (${late.length}): the check did not gate these`, "");
  if (late.length === 0) L.push(r.coverage.before_payment ? "None." : "Not assessed: the population declares no payment date.", "");
  else {
    L.push(`Dates compared on the payer's calendar (UTC offset ${r.mapping.payment_date_utc_offset}); a check on the same day as the payment is not flagged.`, "");
    L.push("| row | key | payment date | first on the book | verdict |", "|---|---|---|---|---|");
    for (const x of late.slice(0, max)) L.push(`| ${rowRef(x.population)} | ${cell(keyOf(x.population.key))} | ${x.late.payment_date} | ${x.late.first_recorded_day} | ${verdictRef2(x.book)} |`);
    more(L, late.length, Math.min(max, late.length));
    L.push("");
  }
  const amb = r.exceptions.ambiguous;
  L.push(`## AMBIGUOUS (${amb.length} key${amb.length === 1 ? "" : "s"}, ${r.population.by_class.AMBIGUOUS} row${r.population.by_class.AMBIGUOUS === 1 ? "" : "s"}): not resolved, by design`, "");
  if (amb.length === 0) L.push("None.", "");
  else {
    L.push("| key | shape | rows | verdicts |", "|---|---|---|---|");
    for (const g of amb.slice(0, max)) L.push(`| ${cell(keyOf(g.key))} | ${g.shape === "POPULATION_DUPLICATES" ? "several payments, one verdict (a possible duplicate payment)" : g.shape === "BOOK_DUPLICATES" ? "one payment, several verdicts" : "several of each"} | ${g.population.map(rowRef).join(", ")} | ${g.book.map((b2) => `${verdictRef2(b2)} ${b2.outcome}${b2.tenant_id ? ` (${cell(b2.tenant_id)})` : ""}`).join(", ")} |`);
    more(L, amb.length, Math.min(max, amb.length));
    L.push("");
  }
  const by = r.exceptions.bypassed;
  L.push(`## BYPASSED (${by.length}): paid with no verdict on the book`, "");
  if (by.length === 0) L.push("None.", "");
  else {
    L.push("| row | key | paid | payment date | why |", "|---|---|---|---|---|");
    for (const x of by.slice(0, max)) L.push(`| ${rowRef(x.population)} | ${cell(keyOf(x.population.key))} | ${cell(x.population.amount)} ${cell(x.population.currency ?? "")} | ${cell(x.population.payment_date)} | ${x.reason === "NO_KEY" ? "the row has no key value" : "no in-scope verdict has this key"}${x.duplicate_key ? "; the key repeats in the population" : ""} |`);
    more(L, by.length, Math.min(max, by.length));
    L.push("");
  }
  const un = r.exceptions.unreadable;
  if (un.length > 0) {
    L.push(`## UNREADABLE (${un.length}): the declared format could not read these rows`, "");
    L.push("| row | line | column | value | why |", "|---|---|---|---|---|");
    for (const u of un.slice(0, max)) for (const p of u.problems) L.push(`| ${u.row} | ${u.line} | ${cell(p.column)} | ${code(p.value)} | ${cell(p.why)} |`);
    more(L, un.length, Math.min(max, un.length));
    L.push("");
  }
  const b = r.book;
  L.push("## The book side", "");
  L.push(`${b.records} record(s) on the book across ${b.tenants.length} tenant(s); ${b.in_scope} in scope (${b.out_of_scope} outside it${b.not_verdict.length ? `, ${b.not_verdict.length} not a VERDICT` : ""}); ${b.in_period} recorded in the period. ${b.matched_outside_period} record(s) from outside the period matched a payment in it.`, "");
  L.push("| class (in period) | records | amount |", "|---|---:|---|");
  for (const k of BOOK_CLASSES) L.push(`| ${LABEL[k]} | ${b.by_class[k]} | ${money(r.amounts.book_in_period[k])} |`);
  L.push("");
  const or = r.exceptions.orphans;
  if (or.length > 0) {
    L.push(`**Orphans (${or.length}).** A verdict in the period with no payment. A held FAIL/ABSTAIN that was never paid is the control working. A PASS orphan was checked and not paid in this population: open, paid elsewhere, or a sign the population is incomplete.`, "");
    L.push("| verdict | outcome | held | reviewed | key | recorded |", "|---|---|---|---|---|---|");
    for (const o of or.slice(0, max)) L.push(`| ${verdictRef2(o.book)} | ${o.book.outcome} | ${o.held ? "yes" : "no"} | ${o.reviewed ? "yes" : "no"} | ${cell(keyOf(o.book.key))} | ${o.book.recorded_at} |`);
    more(L, or.length, Math.min(max, or.length));
    L.push("");
  }
  const uk = r.exceptions.unkeyed;
  if (uk.length > 0) {
    L.push(`**Unkeyed (${uk.length}).** A verdict whose declared key could not be read (supply its extraction, or declare a claim source). It could not be matched, so it cannot vouch for any payment.`, "");
    L.push("| verdict | outcome | why |", "|---|---|---|");
    for (const u of uk.slice(0, max)) L.push(`| ${verdictRef2(u.book)} | ${u.book.outcome} | ${cell(u.why.join("; "))} |`);
    more(L, uk.length, Math.min(max, uk.length));
    L.push("");
  }
  if (b.not_verdict.length > 0) {
    L.push(`**Not a VERDICT (${b.not_verdict.length}).** Never counted as the control operating.`, "");
    for (const x of b.not_verdict.slice(0, max)) L.push(`- ${code(x.verdict_id)} (${cell(x.tenant_id)}): ${cell(x.why)}`);
    more(L, b.not_verdict.length, Math.min(max, b.not_verdict.length));
    L.push("");
  }
  L.push(`**Rungs.** ${b.rungs.length === 0 ? "No workflow in scope." : b.rungs.map((w) => `${code(w.workflow_id)}: ${w.from === "grant" ? "read from signed GRANTs on the book, at the time of each record" : w.from === "declared" ? "declared (no GRANT on the book)" : "record (nothing granted or declared; nothing is held)"}`).join(" \xB7 ")}.`);
  for (const g of b.unanchored_grants) L.push(`GRANT ${code(g.decision_id.slice(0, 12))} (${code(g.level)} for ${code(g.workflow_id)}, by ${cell(g.signer_id)}, seq ${g.seq}) is not anchored to a person: it has no effect on any rung here.`);
  if (b.unanchored_signers.length) L.push(`Decision signers not anchored to a person (no trusted keys supplied): ${b.unanchored_signers.map((s) => code(s)).join(", ")}.`);
  L.push("");
  const rh = r.resolved_holds;
  L.push(`## Holds a person resolved before payment (${rh.count}: UPHELD ${rh.upheld}, OVERTURNED ${rh.overturned})`, "");
  if (rh.count === 0) L.push("None.", "");
  else {
    L.push("Not exceptions. Listed so a person can sample them: an UPHELD FAIL that was then paid means a person confirmed the finding and the payment was made anyway.", "");
    L.push("| row | key | verdict | outcome | review |", "|---|---|---|---|---|");
    for (const x of rh.items.slice(0, max)) L.push(`| ${rowRef(x.population)} | ${cell(keyOf(x.population.key))} | ${verdictRef2(x.book)} | ${x.book.outcome} | ${holdWords(x)} |`);
    more(L, rh.count, Math.min(max, rh.count));
    L.push("");
  }
  if (r.matched_with_uncompared > 0) L.push(`${r.matched_with_uncompared} matched row(s) had a compared field missing or unreadable on one side; those fields were not compared (see \`uncompared\` in the JSON).`, "");
  const m = r.mapping;
  L.push("## How it was matched (declared)", "");
  L.push(`- **Key:** ${m.key.join(" + ")}. Normalization, both sides, in order (trim \u2192 remove \u2192 case \u2192 leading zeros): ${m.key.map((k) => {
    const n = m.normalize[k];
    return `${k}: trim ${n.trim ? "on" : "off"}, remove ${n.remove ? code(n.remove) : "none"}, case ${n.case}, strip leading zeros ${n.strip_leading_zeros ? "on" : "off"}`;
  }).join("; ")}.`);
  L.push(`- **Compared on a match:** ${m.compared.length ? m.compared.join(", ") : "nothing beyond the key"}. Amount tolerance: ${m.amount_tolerance.abs === "0" && m.amount_tolerance.rel === "0" ? "exact" : `the larger of ${m.amount_tolerance.abs} and ${m.amount_tolerance.rel} \xD7 the larger amount`}. Invoice-date tolerance: ${m.date_tolerance_days === 0 ? "exact" : `${m.date_tolerance_days} day(s)`}. Currency: trimmed, upper-cased, exact.`);
  L.push(`- **Population columns:** ${Object.entries(m.population.columns).map(([f, col]) => `${f} \u2190 ${code(col)}`).join(", ")}. Dates ${m.population.date_format}; amounts decimal ${code(m.population.amount_format.decimal)}, grouping ${m.population.amount_format.group ? code(m.population.amount_format.group) : "none"}${m.population.amount_format.strip.length ? `, stripping ${m.population.amount_format.strip.map((s) => code(s)).join(" ")}` : ""}${m.population.amount_format.parens_negative ? ", (x) negative" : ""}${m.population.amount_format.trailing_minus ? ", trailing minus" : ""}.`);
  L.push(`- **Book fields:** ${Object.entries(m.book.fields).map(([f, s]) => `${f} \u2190 ${(s ?? []).map((x) => "extraction" in x ? `extraction ${code(x.extraction)}` : `claim ${code(x.claim)}`).join(" then ")}`).join("; ")}. An extraction counts only when its hash is the one on the book (${r.binds.extractions.used} of ${r.binds.extractions.distinct} supplied extraction(s) used).`);
  L.push(`- **Payment dates** are the payer's calendar at UTC offset ${m.payment_date_utc_offset}. A malformed population value: ${m.on_malformed === "refuse" ? "refused (the default)" : "reported UNREADABLE"}.`, "");
  L.push("## What this proves, and what it does not", "");
  for (const line3 of r.boundary) L.push(`- ${line3}`);
  L.push(`- Why it matters: AS 1105 .10 asks the auditor to "Test the accuracy and completeness of the information, or test the controls over the accuracy and completeness of that information" (PCAOB, quoted from pcaobus.org by the research lane \u2713). This report is the completeness half for the book; the population's own completeness is tested at its source.`);
  L.push("");
  return L.join("\n");
}

// packages/verify/src/http/dual.ts
var governing = governingRead;

// packages/verify/src/http/surfaces.ts
var SurfaceInputError = class extends Error {
  constructor(message2) {
    super(message2);
    this.name = "SurfaceInputError";
  }
};
var isObj6 = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
var optString = (a, key) => {
  const v = a[key];
  if (v === void 0) return void 0;
  if (typeof v !== "string") throw new SurfaceInputError(`"${key}" must be a string`);
  return v;
};
var DECLARATION_KEYS = ["consequence_tier", "granted", "grant", "bounds"];
function snapshotFromJson(x, key = "ledger") {
  if (typeof x === "string") {
    try {
      return snapshotFromChainJSONL(x);
    } catch (e) {
      throw new SurfaceInputError(`"${key}" is not a chain export (one JSON event per line, each with its payload): ${e.message}`);
    }
  }
  if (isObj6(x) && Array.isArray(x.events)) {
    if (!Array.isArray(x.payloads)) throw new SurfaceInputError(`"${key}" carries events without their payloads: the chain's content cannot be verified without them`);
    return { events: x.events, payloads: x.payloads };
  }
  throw new SurfaceInputError(`"${key}" is required: the book of record as the chain export (ledger.chainJSONL()) string, or { events, payloads }`);
}
function policyFromJson(x) {
  if (!isObj6(x)) throw new SurfaceInputError('"policy" is required: the declared promotion policy (promotion-policy-v0). The bars are a business and risk decision; there is no default');
  const p = x;
  const lint = lintPolicy(p);
  if (!lint.ok) throw new SurfaceInputError(`the promotion policy does not lint: ${lint.errors.join("; ")}`);
  return p;
}
var hasDeclarationArgs = (a) => DECLARATION_KEYS.some((k) => a[k] !== void 0);
function declarationFromJson(a) {
  const workflow_id = optString(a, "workflow_id");
  if (!workflow_id) throw new SurfaceInputError('"workflow_id" is required (tenant/ruleset@version, e.g. "acme/invoice@0.0.1")');
  let grant;
  if (a.grant !== void 0) {
    if (!isObj6(a.grant)) throw new SurfaceInputError(`"grant" must be the person's grant record {level, signer_id, signed_at, policy, consequence_tier}`);
    grant = a.grant;
  }
  const tier = optString(a, "consequence_tier") ?? grant?.consequence_tier;
  if (!tier) throw new SurfaceInputError('"consequence_tier" is required (a tier declared in the policy), or a "grant" that names one');
  const granted = optString(a, "granted") ?? grant?.level ?? "record";
  if (!VOICE_LADDER.includes(granted)) throw new SurfaceInputError(`"granted" must be one of ${VOICE_LADDER.join(", ")}`);
  const bounds = optString(a, "bounds");
  return { workflow_id, consequence_tier: tier, granted, ...bounds !== void 0 ? { bounds } : {}, ...grant ? { grant } : {} };
}
function rootKeysFromJson(x) {
  if (typeof x === "string" && x) return [x];
  if (Array.isArray(x) && x.length > 0 && x.every((k) => typeof k === "string" && k)) return x;
  throw new SurfaceInputError('"root_keys" must be the root public key (PEM), or an array of them');
}
function anchorsFromJson(a) {
  return {
    ...a.trusted_keys !== void 0 ? { trusted_keys: trustedKeysFromJson(a.trusted_keys) } : {},
    ...a.root_keys !== void 0 ? { root_keys: rootKeysFromJson(a.root_keys) } : {}
  };
}
function trustedKeysFromJson(x) {
  if (!isObj6(x)) throw new SurfaceInputError('"trusted_keys" must be { "<signer_id>": "<public key PEM>" | ["<PEM>", ...] }');
  for (const [id, k] of Object.entries(x)) {
    if (!(typeof k === "string" || Array.isArray(k) && k.every((p) => typeof p === "string"))) throw new SurfaceInputError(`"trusted_keys.${id}" must be a public key PEM or an array of them`);
  }
  return x;
}
function actionDisposition(n) {
  if (n.action === "HOLD") return "hold";
  if (n.action === "SURFACE") return n.handling.delivery === "in-flow" ? "surface" : "record";
  return n.handling.PASS === "HUMAN_REVIEW" ? "review" : "proceed";
}
var isScalarValue = (x) => typeof x === "string" || typeof x === "number";
function recordsProblem(x) {
  if (!Array.isArray(x) || x.length === 0) return "must be a non-empty array of approved records, each { <argument>: <approved value> } (values approved together)";
  let names;
  for (const [i, r] of x.entries()) {
    if (!isObj6(r) || Object.keys(r).length === 0) return `[${i}] must be a non-empty object: { <argument>: <approved value> }`;
    const bad2 = Object.entries(r).find(([, v]) => !isScalarValue(v));
    if (bad2) return `[${i}].${bad2[0]} must be a string or a number (an approved value)`;
    const these = Object.keys(r).sort().join(", ");
    if (names === void 0) names = these;
    else if (these !== names) return `[${i}] names ${these}, but [0] names ${names}: every record must name the same arguments`;
  }
  return void 0;
}
function actionFromJson(a) {
  const act = a.action;
  if (!isObj6(act) || typeof act.tool !== "string" || !act.tool) throw new SurfaceInputError('"action" is required: { tool, arguments } (the proposed tool call)');
  if (act.arguments !== void 0 && !isObj6(act.arguments)) throw new SurfaceInputError('"action.arguments" must be an object (the proposed arguments)');
  const sources = {};
  if (a.sources !== void 0) {
    const s = a.sources;
    if (!isObj6(s)) throw new SurfaceInputError('"sources" must be { text?, allowed?, records?, require? } (what counts as an approved source)');
    if (s.text !== void 0) {
      if (typeof s.text !== "string") throw new SurfaceInputError('"sources.text" must be a string (the source document the agent read)');
      sources.text = s.text;
    }
    if (s.allowed !== void 0) {
      if (!isObj6(s.allowed)) throw new SurfaceInputError('"sources.allowed" must be { <argument>: [approved values] }');
      for (const [k, v] of Object.entries(s.allowed)) {
        if (!Array.isArray(v) || !v.every(isScalarValue)) throw new SurfaceInputError(`"sources.allowed.${k}" must be an array of approved values (strings or numbers)`);
      }
      sources.allowed = s.allowed;
    }
    if (s.records !== void 0) {
      const problem = recordsProblem(s.records);
      if (problem) throw new SurfaceInputError(`"sources.records" ${problem}`);
      sources.records = s.records;
    }
    if (s.require !== void 0) {
      if (!Array.isArray(s.require) || !s.require.every((x) => typeof x === "string")) throw new SurfaceInputError('"sources.require" must be an array of argument names');
      sources.require = s.require;
    }
  }
  return { action: { tool: act.tool, arguments: act.arguments ?? {} }, sources };
}
function levelFromJson(x, key = "level") {
  if (x === void 0) return void 0;
  if (typeof x !== "string" || !VOICE_LADDER.includes(x)) throw new SurfaceInputError(`"${key}" must be one of ${VOICE_LADDER.join(", ")}`);
  return x;
}
function actionCheckFromJson(a, opts = {}) {
  if (!opts.resolved && a.workflow_id !== void 0) {
    throw new SurfaceInputError(`"workflow_id" reads the rung from a book of record, which is the managed tier's (createService({ ledger }): POST /v1/action/check). Stateless, pass the rung a person granted as "level"`);
  }
  const { action, sources } = actionFromJson(a);
  const asked = levelFromJson(a.level);
  const level = opts.resolved?.level ?? asked ?? "record";
  const level_source = opts.resolved?.source ?? (asked !== void 0 ? "request" : "default");
  const verdict = verifyAction(action, sources, opts.now ? { now: opts.now } : {});
  const notice = actionNotice(verdict, level);
  const disposition = actionDisposition(notice);
  return {
    surface_version: "action-check-v0",
    tool: action.tool,
    level,
    level_source,
    ...opts.resolved ? { workflow_id: opts.resolved.workflow_id } : {},
    disposition,
    holds: disposition === "hold" || disposition === "review",
    call_hash: hashOf({ tool: action.tool, arguments: action.arguments }),
    verdict,
    notice,
    notice_markdown: renderActionNotice(notice),
    ...opts.resolved?.no_effect?.length ? { no_effect: opts.resolved.no_effect } : {},
    ...opts.resolved?.notices?.length ? { notices: opts.resolved.notices } : {}
  };
}
function opinionFromJson(a, ctx = {}) {
  const snapshot = a.ledger !== void 0 ? snapshotFromJson(a.ledger) : ctx.snapshot;
  if (!snapshot) throw new SurfaceInputError('"ledger" is required: the book of record as the chain export (ledger.chainJSONL()) string, or { events, payloads }');
  const asked = optString(a, "tenant_id");
  if (asked !== void 0 && !asked) throw new SurfaceInputError('"tenant_id" must be a tenant id');
  if (ctx.scope && asked !== void 0 && asked !== ctx.scope.tenant_id) {
    throw new SurfaceInputError(`"tenant_id" is the caller's own here (${ctx.scope.tenant_id}); an opinion is never read under another tenant's scope`);
  }
  const scope = ctx.scope ?? (asked !== void 0 ? { tenant_id: asked } : void 0);
  const anchors = anchorsFromJson(a);
  if (a.ledger === void 0 && (anchors.trusted_keys || anchors.root_keys)) {
    throw new SurfaceInputError('"trusted_keys" / "root_keys" anchor the signers of a chain export you supply as "ledger"; the book read here carries its own anchors, and a request never adds to them');
  }
  const scoped = { ...scope ? { scope } : {}, ...anchors };
  let opinion;
  if (a.dispute !== void 0) {
    if (a.proposal !== void 0 || a.workflow_id !== void 0 || a.from_book !== void 0 || hasDeclarationArgs(a)) {
      throw new SurfaceInputError('one question per opinion: a "dispute", or a voice question (a "proposal", or a "workflow_id" and its settings), not both');
    }
    const d = a.dispute;
    if (!isObj6(d) || typeof d.verdict_id !== "string" || !d.verdict_id) throw new SurfaceInputError('"dispute" must be { verdict_id, claim_id? }');
    if (d.claim_id !== void 0 && typeof d.claim_id !== "string") throw new SurfaceInputError('"dispute.claim_id" must be a string');
    try {
      opinion = disputeOpinion({
        snapshot,
        verdict_id: d.verdict_id,
        ...typeof d.claim_id === "string" ? { claim_id: d.claim_id } : {},
        ...a.inputs !== void 0 ? { inputs: a.inputs } : {},
        ...scoped
      });
    } catch (e) {
      throw new SurfaceInputError(e.message);
    }
  } else {
    const policy = a.policy !== void 0 ? policyFromJson(a.policy) : ctx.policy;
    if (!policy) throw new SurfaceInputError('"policy" is required for a voice question (the declared promotion policy; there is no default), or "dispute" for a dispute');
    if (a.from_book !== void 0 && typeof a.from_book !== "boolean") throw new SurfaceInputError('"from_book" must be true or false');
    try {
      if (a.from_book === true) {
        const flags = ["proposal", "granted", "grant", "bounds"].filter((k) => a[k] !== void 0);
        if (flags.length) throw new SurfaceInputError(`"from_book" reads the rung from the GRANT in force on the book, so ${flags.map((k) => `"${k}"`).join(", ")} cannot be passed with it (a flag never overrides a person's signed grant)`);
        const workflow_id = optString(a, "workflow_id");
        if (!workflow_id) throw new SurfaceInputError('"workflow_id" is required with "from_book" (tenant/ruleset@version)');
        const tier = optString(a, "consequence_tier");
        opinion = promotionOpinion({ snapshot, policy, workflow_id, ...tier !== void 0 ? { consequence_tier: tier } : {}, ...ctx.calibration ? { calibration: ctx.calibration } : {}, ...scoped });
      } else if (a.proposal !== void 0) {
        if (!isObj6(a.proposal)) throw new SurfaceInputError('"proposal" must be a proposal object (from voice_assess / GET /v1/voice)');
        if (a.workflow_id !== void 0 || hasDeclarationArgs(a)) throw new SurfaceInputError('a "proposal" defines the question (its workflow, tier, bounds and rung); do not also pass a workflow_id or settings');
        opinion = promotionOpinion({ snapshot, policy, proposal: a.proposal, ...ctx.calibration ? { calibration: ctx.calibration } : {}, ...scoped });
      } else {
        let declaration;
        if (hasDeclarationArgs(a) || !ctx.settings) {
          declaration = declarationFromJson(a);
        } else {
          const workflow_id = optString(a, "workflow_id");
          if (!workflow_id) throw new SurfaceInputError('"workflow_id" is required (tenant/ruleset@version), or a "proposal", or a "dispute"');
          const s = ctx.settings(workflow_id);
          if (!s) throw new SurfaceInputError(`no settings are declared for ${workflow_id} (a consequence tier and a rung): supply "consequence_tier" and "granted", or declare them`);
          declaration = { ...s, workflow_id };
        }
        opinion = promotionOpinion({ snapshot, policy, declaration, ...ctx.calibration ? { calibration: ctx.calibration } : {}, ...scoped });
      }
    } catch (e) {
      throw e instanceof SurfaceInputError ? e : new SurfaceInputError(e.message);
    }
  }
  return { opinion, markdown: renderOpinion(opinion) };
}
var TWIN_MAPS = { "0.1.0": FS_CORE_TWIN_MAP, "0.2.0": FS_CORE_TWIN_MAP_V02, "0.2.1": FS_CORE_TWIN_MAP_V021 };
var TWIN_MAP_VERSIONS = Object.keys(TWIN_MAPS);
var TWIN_RULESETS = { "0.1": "0.1.0", "0.1.0": "0.1.0", "0.2": "0.2.0", "0.2.0": "0.2.0", "0.2.1": "0.2.1" };
var TWIN_MAP_STATUS = {
  "0.2.1": {
    map_version: "0.2.1",
    offered: "opt-in",
    measured: "held-out prereg FAIL (2026-09-28)",
    detail: "Pre-registered design (sha256 2f170fa3\u2026) checked on 200 fresh 2026q2 filings: false flags in 4 of 200 filings (2%, the bar), abstentions on correct values 1.22% (bar 1.0%), anchored scale recall 38 of 50; scale-error recall 3,532 of 3,532. It improves on 0.2 on each of those numbers and still fails its bars. Its ABSTAIN reason AMBIGUOUS_LINE (the cash roll could not choose between face lines) is the insufficiency AMBIGUOUS_REFERENCE."
  }
};
var TWIN_PRESENTATION_KEYS = ["pre", "filing_summary", "schema"];
function twinFromJson(a, opts = {}) {
  const html = a.html;
  if (typeof html !== "string" || html.length === 0) throw new SurfaceInputError(`"html" is required: the filing's primary inline-XBRL document, as text`);
  const periodEnd = a.period_end;
  if (typeof periodEnd !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)) throw new SurfaceInputError('"period_end" is required, as YYYY-MM-DD');
  if (!Array.isArray(a.claims)) throw new SurfaceInputError('"claims" is required: an array of {id, field, value}');
  const claims = a.claims.map((c, i) => {
    if (!isObj6(c) || typeof c.id !== "string" || typeof c.field !== "string" || typeof c.value !== "number") {
      throw new SurfaceInputError(`claims[${i}] needs id (string), field (string) and value (number)`);
    }
    return { id: c.id, field: c.field, value: c.value };
  });
  const num4 = (key) => {
    const v = a[key];
    if (v === void 0) return void 0;
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) throw new SurfaceInputError(`"${key}" must be a non-negative number`);
    return v;
  };
  const tolerance = num4("tolerance");
  const periodToleranceDays = num4("period_tolerance_days");
  const asked = optString(a, "map_version");
  if (asked !== void 0 && !(asked in TWIN_MAPS)) throw new SurfaceInputError(`"map_version" must be one of ${TWIN_MAP_VERSIONS.join(", ")}`);
  const rs = optString(a, "ruleset");
  if (rs !== void 0 && !(rs in TWIN_RULESETS)) throw new SurfaceInputError(`"ruleset" must be one of ${Object.keys(TWIN_RULESETS).join(", ")} (the twin map version)`);
  const byRuleset = rs !== void 0 ? TWIN_RULESETS[rs] : void 0;
  if (asked !== void 0 && byRuleset !== void 0 && asked !== byRuleset) {
    throw new SurfaceInputError(`"ruleset" ${rs} is map ${byRuleset}, but "map_version" says ${asked}: pass one, or two that agree`);
  }
  const mapVersion = asked ?? byRuleset ?? "0.1.0";
  const map = TWIN_MAPS[mapVersion];
  const statement = (map.binding ?? "document") === "statement";
  const flat = TWIN_PRESENTATION_KEYS.filter((k) => a[k] !== void 0 && a[k] !== null);
  const nested = a.presentation !== void 0 && a.presentation !== null;
  if (flat.length && nested) {
    throw new SurfaceInputError(`the presentation texts arrive one way: as "presentation" { pre, filing_summary, schema }, or flat (${flat.map((k) => `"${k}"`).join(", ")}), not both`);
  }
  let presentation;
  if (flat.length || nested) {
    const named = nested ? '"presentation" is' : `${flat.map((k) => `"${k}"`).join(", ")} ${flat.length === 1 ? "is" : "are"}`;
    if (!statement) throw new SurfaceInputError(`${named} read only by statement-anchored maps (ruleset 0.2 or 0.2.1, map_version 0.2.0 or 0.2.1); map ${mapVersion} binds over the whole document`);
    const p = nested ? a.presentation : a;
    if (!isObj6(p)) throw new SurfaceInputError(`"presentation" must be { pre?, filing_summary?, schema? } (the filing's presentation texts)`);
    const text = (k) => {
      const v = p[k];
      if (v === void 0 || v === null) return null;
      if (typeof v !== "string") throw new SurfaceInputError(`"${nested ? "presentation." : ""}${k}" must be a string`);
      return v;
    };
    const links = map.links;
    presentation = parseTwinPresentation({ pre: text("pre"), filingSummary: text("filing_summary"), schema: text("schema") }, links === "strict" ? { links } : {});
  }
  const producer = optString(a, "producer");
  let result;
  try {
    result = verifyAgainstTwin(html, claims, {
      periodEnd,
      map,
      ...tolerance !== void 0 ? { tolerance } : {},
      ...periodToleranceDays !== void 0 ? { periodToleranceDays } : {},
      ...statement ? { presentation: presentation ?? null } : {},
      ...producer !== void 0 ? { producer } : {},
      ...opts.now ? { now: opts.now } : {}
    });
  } catch (e) {
    throw new SurfaceInputError(e.message);
  }
  const status = TWIN_MAP_STATUS[mapVersion];
  return status ? { ...result, map_status: status } : result;
}
var DELIMITERS = [",", ";", "	", "|"];
function populationFromJson(x) {
  try {
    if (Array.isArray(x)) return populationFromRows(x);
    if (!isObj6(x)) throw new SurfaceInputError('"population" is required: { format: "csv" | "jsonl", text | base64 } (the export itself), or { rows: [...] }');
    if (x.rows !== void 0) {
      if (!Array.isArray(x.rows)) throw new SurfaceInputError('"population.rows" must be an array of row objects');
      if (x.text !== void 0 || x.base64 !== void 0) throw new SurfaceInputError('"population" is rows, or the export as text / base64: one, not both');
      return populationFromRows(x.rows);
    }
    const format = x.format;
    if (format !== "csv" && format !== "jsonl") throw new SurfaceInputError('"population.format" must be "csv" or "jsonl" (declared, never sniffed)');
    if (x.text === void 0 === (x.base64 === void 0)) throw new SurfaceInputError('"population" carries the export as "text" or as "base64": exactly one');
    let bytes;
    if (x.text !== void 0) {
      if (typeof x.text !== "string") throw new SurfaceInputError('"population.text" must be a string');
      bytes = x.text;
    } else {
      if (typeof x.base64 !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(x.base64)) throw new SurfaceInputError('"population.base64" must be base64 text');
      bytes = Buffer.from(x.base64, "base64");
    }
    const delimiter = x.delimiter;
    if (delimiter !== void 0 && (format !== "csv" || !DELIMITERS.includes(delimiter))) {
      throw new SurfaceInputError(`"population.delimiter" is for csv, one of ${DELIMITERS.map((d) => JSON.stringify(d)).join(", ")}`);
    }
    return readPopulation(bytes, format, delimiter !== void 0 ? { delimiter } : {});
  } catch (e) {
    if (e instanceof PopulationRefused) throw new SurfaceInputError(`population refused: ${e.message}`);
    throw e;
  }
}
var stringsOf = (a, key) => {
  const v = a[key];
  if (v === void 0) return void 0;
  if (!Array.isArray(v) || !v.every((x) => typeof x === "string")) throw new SurfaceInputError(`"${key}" must be an array of strings`);
  return v;
};
var objectOf = (a, key) => {
  const v = a[key];
  if (v === void 0) return void 0;
  if (!isObj6(v)) throw new SurfaceInputError(`"${key}" must be an object`);
  return v;
};
function reconcileFromJson(a, ctx = {}) {
  const managed = ctx.book !== void 0;
  if (managed && a.ledger !== void 0) {
    throw new SurfaceInputError(`"ledger": this service reconciles against the caller's own book of record; reconcile a chain export offline (verify reconcile) or with the stateless service`);
  }
  if (managed && (a.trusted_keys !== void 0 || a.root_keys !== void 0)) {
    throw new SurfaceInputError('"trusted_keys" / "root_keys" anchor the signers of a chain export you supply as "ledger"; the book read here carries its own anchors, and a request never adds to them');
  }
  if (managed && a.policy !== void 0) {
    throw new SurfaceInputError(`"policy": the rungs here are read under the deployment's declared policy; a request never substitutes its own`);
  }
  const policy = managed ? ctx.policy : a.policy !== void 0 ? policyFromJson(a.policy) : void 0;
  const asked = optString(a, "tenant_id");
  if (ctx.tenant_id !== void 0 && asked !== void 0 && asked !== ctx.tenant_id) {
    throw new SurfaceInputError(`"tenant_id" ${JSON.stringify(asked)} is not this caller's: a reconciliation here reads the caller's own records only`);
  }
  const tenant_id = ctx.tenant_id ?? asked;
  const workflows2 = stringsOf(a, "workflows");
  const rulesets = stringsOf(a, "rulesets");
  if (ctx.tenant_id !== void 0) {
    const foreign = (workflows2 ?? []).filter((w) => !w.startsWith(`${ctx.tenant_id}/`));
    if (foreign.length) throw new SurfaceInputError(`"workflows" ${foreign.map((w) => JSON.stringify(w)).join(", ")} ${foreign.length === 1 ? "is" : "are"} not this caller's (a workflow id is tenant/ruleset@version)`);
  }
  const book = ctx.book ?? snapshotFromJson(a.ledger);
  if (!isObj6(a.mapping)) throw new SurfaceInputError('"mapping" is required: the declared completeness mapping (completeness-mapping-v0)');
  const population = populationFromJson(a.population);
  const period = objectOf(a, "period");
  const rungs = objectOf(a, "rungs");
  for (const [wf, level] of Object.entries(rungs ?? {})) {
    if (!VOICE_LADDER.includes(level)) throw new SurfaceInputError(`"rungs.${wf}" must be one of ${VOICE_LADDER.join(", ")}`);
  }
  const interval = objectOf(a, "interval");
  if (a.extractions !== void 0 && !Array.isArray(a.extractions)) throw new SurfaceInputError('"extractions" must be an array (the checked extractions or proposed actions; each is used only if its hash is on the book)');
  if (a.include_matched !== void 0 && typeof a.include_matched !== "boolean") throw new SurfaceInputError('"include_matched" must be a boolean');
  const anchors = managed ? {} : anchorsFromJson(a);
  const scope = { ...tenant_id !== void 0 ? { tenant_id } : {}, ...workflows2 ? { workflows: workflows2 } : {}, ...rulesets ? { rulesets } : {} };
  const options = {
    ...Object.keys(scope).length ? { scope } : {},
    ...period ? { period } : {},
    ...a.extractions !== void 0 ? { extractions: a.extractions } : {},
    ...rungs ? { rungs } : {},
    ...interval ? { interval } : {},
    ...anchors.trusted_keys || anchors.root_keys ? { anchors } : {},
    ...a.include_matched === true ? { include_matched: true } : {},
    ...policy ? { policy } : {}
  };
  let report;
  try {
    report = reconcileCompleteness(population, book, a.mapping, options);
  } catch (e) {
    if (e instanceof CompletenessRefused || e instanceof PopulationRefused) throw new SurfaceInputError(`reconciliation refused: ${e.message}`);
    throw e;
  }
  return { report, markdown: renderCompletenessReport(report) };
}

// packages/verify/src/ledger/succession.ts
var isObj7 = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
var has = (x, ...keys) => keys.every((k) => Object.prototype.hasOwnProperty.call(x, k));
var FIXED = () => /* @__PURE__ */ new Date(0);
function workflows(from, to) {
  const a = rulesetWorkflow(from), b = rulesetWorkflow(to);
  if (!a || !b) throw new DecisionRefused(`a succession is between versions of one ruleset: both workflows are <tenant>/<ruleset>@<version> (${from} \u2192 ${to})`);
  if (a.tenant !== b.tenant || a.ruleset !== b.ruleset || a.version === b.version) {
    throw new DecisionRefused(`a succession carries a tenant's grant to another version of the same ruleset: ${from} \u2192 ${to} is not one`);
  }
  return { ruleset: b.ruleset, version: b.version };
}
function targetOf(to, given) {
  if (given !== void 0) {
    if (given.id !== to.ruleset || given.version !== to.version) return `the ruleset given is ${given.id}@${given.version}, not ${to.ruleset}@${to.version}`;
    return isDeclarativeRuleset(given) ? { declarative: given } : { builtin: given };
  }
  const builtin = RULESET_VERSIONS.find((r) => r.id === to.ruleset && r.version === to.version);
  return builtin ? { builtin } : `this build holds no ruleset ${to.ruleset}@${to.version}: pass it (a declarative ruleset) as \`ruleset\``;
}
function reperformUnder(target, inputs, tol) {
  const tolerance = tol ?? (isObj7(inputs.tolerance) ? inputs.tolerance : void 0);
  let x;
  try {
    x = structuredClone(inputs);
  } catch {
    x = inputs;
  }
  if ("builtin" in target && has(x, "extraction", "references", "source")) {
    const refs = isObj7(x.references) ? x.references : {};
    return verify(x.extraction, {
      now: FIXED,
      ruleset: target.builtin,
      references: { ...refs.contract !== null && refs.contract !== void 0 ? { contract: refs.contract } : {}, evidence: refs.evidence, history: refs.history },
      ...x.source !== null && x.source !== void 0 ? { source: x.source } : {},
      ...tolerance ? { tolerance } : {}
    });
  }
  if ("declarative" in target && has(x, "extraction", "ruleset") && isDeclarativeRuleset(x.ruleset)) {
    return verifyDeclarative(x.extraction, target.declarative, { now: FIXED, ...tolerance ? { tolerance } : {} });
  }
  return `no engine re-performs inputs shaped { ${Object.keys(x).sort().join(", ")} } under ${"builtin" in target ? "a built-in" : "a declarative"} ruleset`;
}
function successionReplay(book, from, to, opts) {
  const next = workflows(from, to);
  const { events, payloads } = "snapshot" in book ? book.snapshot() : book;
  const through = opts.through ?? events.length;
  if (!Number.isInteger(through) || through < 0 || through > events.length) throw new DecisionRefused(`through ${through} is not a position on this book (0 to ${events.length})`);
  const target = targetOf(next, opts.ruleset);
  const seen = /* @__PURE__ */ new Set();
  const changed = [];
  const not = [];
  let reperformed = 0;
  for (let i = 0; i < through; i++) {
    const ev = events[i];
    if (ev.type !== "RECORD" || seen.has(ev.verdict_id) || recordWorkflow(payloads[i]) !== from) continue;
    seen.add(ev.verdict_id);
    const v = payloads[i].verdict;
    const skip = (reason) => {
      not.push({ verdict_id: v.verdict_id, reason });
    };
    if (typeof target === "string") {
      skip(target);
      continue;
    }
    const inputs = opts.inputs(v);
    if (inputs === void 0) {
      skip("no inputs supplied");
      continue;
    }
    if (!isObj7(inputs)) {
      skip("the inputs are not an object");
      continue;
    }
    const bind = verifyReplay(v, inputs, opts.tolerance ? { tolerance: opts.tolerance } : {});
    if (!bind.id_ok || bind.input_ok !== true) {
      skip("the inputs supplied are not the ones it was issued on (they do not hash to its input_hash)");
      continue;
    }
    let again;
    try {
      again = reperformUnder(target, inputs, opts.tolerance);
    } catch (e) {
      again = `the engine could not run on its inputs (${e.message})`;
    }
    if (typeof again === "string") {
      skip(again);
      continue;
    }
    if (again.ruleset.id !== next.ruleset || again.ruleset.version !== next.version) {
      skip(`the engine ran ${again.ruleset.id}@${again.ruleset.version}, not ${next.ruleset}@${next.version}`);
      continue;
    }
    reperformed++;
    if (again.outcome !== v.outcome) changed.push({ verdict_id: v.verdict_id, from: v.outcome, to: again.outcome });
  }
  const byId2 = (x, y) => x.verdict_id < y.verdict_id ? -1 : x.verdict_id > y.verdict_id ? 1 : 0;
  return {
    replay: {
      replay_version: "succession-replay-v0",
      through,
      head: through === 0 ? GENESIS : events[through - 1].entry_hash,
      engine_version: ENGINE_VERSION,
      recorded: seen.size,
      reperformed,
      changed: changed.sort(byId2)
    },
    not_reperformed: not.sort(byId2)
  };
}
function checkSuccessionReplay(book, grant, opts) {
  const s = grant.signed.decision.succeeds;
  if (!s) throw new DecisionRefused(`GRANT ${grant.decision_id} carries no succession`);
  const again = successionReplay(book, s.from, grant.signed.decision.workflow_id, { ...opts, through: s.replay.through }).replay;
  const signed = s.replay;
  const differences = [];
  for (const k of ["through", "head", "engine_version", "recorded", "reperformed"]) {
    if (again[k] !== signed[k]) differences.push(`${k}: signed ${signed[k]}, re-performed ${again[k]}`);
  }
  const key = (c) => `${c.verdict_id} ${c.from}\u2192${c.to}`;
  const was = new Set(signed.changed.map(key)), now = new Set(again.changed.map(key));
  for (const c of signed.changed) if (!now.has(key(c))) differences.push(`changed: signed ${key(c)}, not re-performed so`);
  for (const c of again.changed) if (!was.has(key(c))) differences.push(`changed: re-performed ${key(c)}, not in the signed replay`);
  return { ok: differences.length === 0 && hashOf(again) === hashOf(signed), replay: again, differences };
}
function successionGrant(input, policy) {
  const fd = input.from.signed.decision;
  if (fd.kind !== "GRANT") throw new DecisionRefused("a succession carries a GRANT");
  const level = input.level ?? fd.level;
  if (DECISION_LEVELS.indexOf(level) > DECISION_LEVELS.indexOf(fd.level)) throw new DecisionRefused(`a succession carries a rung, it never raises one: ${level} is above the grant's ${fd.level}`);
  const bounds = input.bounds ?? fd.bounds;
  const succeeds = {
    from: fd.workflow_id,
    grant: input.from.decision_id,
    reason: input.reason,
    replay: structuredClone(input.replay),
    ...input.loosening_reason !== void 0 ? { loosening_reason: input.loosening_reason } : {}
  };
  const common = {
    workflow_id: input.to,
    level,
    consequence_tier: fd.consequence_tier,
    ...bounds !== void 0 ? { bounds } : {},
    signer_id: input.signer_id,
    signed_at: input.signed_at,
    ...input.note !== void 0 ? { note: input.note } : {},
    // D-DUAL carries over on autonomy: the old grant's count, never fewer (a step down needs one person, as any does).
    ...level === "autonomy" && fd.signatures !== void 0 ? { signatures: fd.signatures } : {},
    succeeds
  };
  if (policy) return grantUnderPolicy(policy, common);
  return makeGrant({ ...common, policy: { ...fd.policy } });
}

// packages/verify/src/http/succession.ts
var isObj8 = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
var str = (a, k) => {
  if (a[k] === void 0) return void 0;
  if (typeof a[k] !== "string" || !a[k]) throw new SurfaceInputError(`"${k}" must be a non-empty string`);
  return a[k];
};
function inputsFromJson(x) {
  const rows = Array.isArray(x) ? x : isObj8(x) ? Object.entries(x).map(([verdict_id, inputs]) => ({ verdict_id, inputs })) : void 0;
  if (!rows) throw new SurfaceInputError('"inputs" is required: [{ verdict_id, inputs }] or { "<verdict_id>": inputs }, the inputs each recorded verdict was issued on');
  const out = /* @__PURE__ */ new Map();
  for (const r of rows) {
    if (!isObj8(r) || typeof r.verdict_id !== "string" || !isObj8(r.inputs)) throw new SurfaceInputError('"inputs" items must be { verdict_id, inputs: { ... } }');
    if (out.has(r.verdict_id)) throw new SurfaceInputError(`"inputs" gives verdict ${r.verdict_id} twice`);
    out.set(r.verdict_id, r.inputs);
  }
  return out;
}
function toleranceFromJson(x) {
  if (x === void 0) return void 0;
  if (!isObj8(x) || typeof x.rel !== "number" || typeof x.absCap !== "number" || !(x.rel >= 0) || !(x.absCap >= 0)) {
    throw new SurfaceInputError('"tolerance" must be { "rel": <fraction \u2265 0>, "absCap": <amount \u2265 0> }');
  }
  return { rel: x.rel, absCap: x.absCap };
}
function successionFromJson(a) {
  const snap = snapshotFromJson(a.ledger);
  if (!snap.events) throw new SurfaceInputError('"ledger" is required: the book of record as the chain export (ledger.chainJSONL()) string, or { events, payloads }');
  const seed = { events: snap.events, payloads: snap.payloads ?? [] };
  let led;
  try {
    led = new MemoryLedger({ seed, ...anchorsFromJson(a) });
  } catch (e) {
    throw new SurfaceInputError(`the book could not be read: ${e.message}`);
  }
  const db = led.decisionBook();
  if (!db.ok) throw new SurfaceInputError(bookRefusal(db));
  const inputs = inputsFromJson(a.inputs);
  if (a.ruleset !== void 0 && !isDeclarativeRuleset(a.ruleset)) throw new SurfaceInputError('"ruleset" must be a declarative ruleset (a built-in one is found by the "to" version)');
  const opts = {
    inputs: (v) => inputs.get(v.verdict_id),
    ...a.ruleset !== void 0 ? { ruleset: a.ruleset } : {},
    ...a.tolerance !== void 0 ? { tolerance: toleranceFromJson(a.tolerance) } : {}
  };
  const chain = { length: db.check.length, head: db.check.head };
  const ref2 = str(a, "check");
  if (ref2 !== void 0) {
    const foreign = ["from", "to", "signer_id", "reason", "loosening_reason", "level", "signed_at", "note"].filter((k) => a[k] !== void 0);
    if (foreign.length) throw new SurfaceInputError(`"check" re-performs a succession already on the book: ${foreign.map((k) => `"${k}"`).join(", ")} cannot be given with it`);
    if (!/^[0-9a-f]{12,}$/.test(ref2)) throw new SurfaceInputError(`"check" must be the succession GRANT's decision id (hex), or a unique prefix of at least 12 characters`);
    const hits = db.decisions.filter((e) => e.signed.decision.kind === "GRANT" && e.decision_id.startsWith(ref2));
    if (hits.length !== 1) throw new SurfaceInputError(hits.length ? `"check" ${ref2} names ${hits.length} grants on the book: give more of the decision id` : `no GRANT ${ref2} on the book`);
    const g2 = hits[0];
    const s = g2.signed.decision.succeeds;
    if (!s) throw new SurfaceInputError(`GRANT ${g2.decision_id.slice(0, 12)} carries no succession: there is no replay to check`);
    const c = checkSuccessionReplay(led, g2, opts);
    return {
      surface_version: "succession-replay-v0",
      from: s.from,
      to: g2.signed.decision.workflow_id,
      check: { decision_id: g2.decision_id, ok: c.ok, differences: c.differences, signed: s.replay, reperformed: c.replay, ...g2.replay ? { book: g2.replay } : {} },
      chain
    };
  }
  const from = str(a, "from"), to = str(a, "to");
  if (!from || !to) throw new SurfaceInputError(`"from" and "to" are required (<tenant>/<ruleset>@<version>), or "check" (a succession GRANT's decision id)`);
  const policy = a.policy !== void 0 ? policyFromJson(a.policy) : void 0;
  const g = grantInForce(db.decisions, from, governing(policy));
  let r;
  let unsigned;
  try {
    r = successionReplay(led, from, to, opts);
    const signer_id = str(a, "signer_id"), reason = str(a, "reason");
    if (signer_id !== void 0 || reason !== void 0) {
      if (!signer_id || !reason || !policy) throw new SurfaceInputError('the unsigned GRANT needs "signer_id", "reason" and "policy" together');
      if (!g) throw new SurfaceInputError(`nothing is granted on ${from}${policy ? ` under ${policy.policy_id}@${policy.version}` : ""}: there is no grant to carry`);
      const level = str(a, "level");
      if (level !== void 0 && !VOICE_LADDER.includes(level)) throw new SurfaceInputError(`"level" must be one of ${VOICE_LADDER.join(", ")}`);
      const loosening_reason = str(a, "loosening_reason"), note = str(a, "note");
      unsigned = successionGrant({
        from: g,
        to,
        replay: r.replay,
        reason,
        signer_id,
        signed_at: str(a, "signed_at") ?? (/* @__PURE__ */ new Date()).toISOString(),
        ...level !== void 0 ? { level } : {},
        ...loosening_reason !== void 0 ? { loosening_reason } : {},
        ...note !== void 0 ? { note } : {}
      }, policy);
    }
  } catch (e) {
    if (e instanceof DecisionRefused) throw new SurfaceInputError(`the succession is refused: ${e.message}`);
    throw e;
  }
  const gd = g?.signed.decision;
  return {
    surface_version: "succession-replay-v0",
    from,
    to,
    carries: g && gd ? { decision_id: g.decision_id, workflow_id: gd.workflow_id, level: gd.level, consequence_tier: gd.consequence_tier, signer_id: gd.signer_id, seq: g.seq } : null,
    replay: r.replay,
    not_reperformed: r.not_reperformed,
    loosens: r.replay.changed.filter(loosens).length,
    ...unsigned ? { unsigned } : {},
    chain
  };
}

// packages/verify/src/http/router.ts
var ok = (json) => ({ status: 200, json });
var bad = (message2) => ({ status: 400, json: { error: message2 } });
var notFound = () => ({ status: 404, json: { error: "not found" } });
var isObj9 = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
function route(req) {
  const path = req.path.replace(/\/+$/, "") || "/";
  if (req.method === "GET" && (path === "/v1/health" || path === "/health")) return ok({ status: "ok", engine_version: ENGINE_VERSION });
  if (req.method === "GET" && (path === "/v1/openapi.json" || path === "/openapi.json")) return ok(OPENAPI);
  if (req.method === "GET" && /^\/v1\/voice(\/|$)/.test(path)) {
    return { status: 404, json: { error: "GET /v1/voice/{workflow} is served by the managed tier (a ledger and a declared promotion policy: createService({ ledger, voice })). Stateless: POST /v1/opinion with your chain export, or the MCP tool voice_assess." } };
  }
  if (req.method === "GET" && /^\/v1\/queue(\/|$)/.test(path)) {
    return { status: 404, json: { error: "GET /v1/queue/{workflow} is served by the managed tier (a ledger and a declared promotion policy: createService({ ledger, voice })). Offline: reviewQueue(ledger, workflow_id, policy) (src/surveillance)." } };
  }
  if (req.method !== "POST") return notFound();
  if (path === "/v1/grant/cosign") {
    return { status: 404, json: { error: "POST /v1/grant/cosign appends to a book of record, which the managed tier holds (createService({ ledger })). Offline: verify grant --cosign <grant_decision_id>." } };
  }
  const b = req.body;
  if (!isObj9(b)) return bad("request body must be a JSON object");
  try {
    switch (path) {
      case "/v1/verify": {
        if (!isObj9(b.extraction)) return bad('"extraction" object is required');
        const { extraction, ...opts } = b;
        return ok(verify(extraction, opts));
      }
      case "/v1/verify/declared": {
        if (!isObj9(b.extraction)) return bad('"extraction" object is required');
        if (!isDeclarativeRuleset(b.ruleset)) return bad('a valid declarative "ruleset" (fields + checks) is required');
        return ok(verifyDeclarative(b.extraction, b.ruleset));
      }
      case "/v1/ruleset/lint":
        return ok(lintRuleset(b.ruleset ?? b));
      case "/v1/ruleset/measure": {
        if (!isDeclarativeRuleset(b.ruleset)) return bad('a valid declarative "ruleset" (fields + checks) is required');
        if (!Array.isArray(b.cases)) return bad('a "cases" array of { extraction, label } is required');
        return ok(measureRuleset(b.ruleset, b.cases));
      }
      case "/v1/verify/batch": {
        if (!Array.isArray(b.items)) return bad('"items" array is required');
        return ok(verifyBatch(b.items));
      }
      case "/v1/verify/action": {
        if (!isObj9(b.action)) return bad('"action" object is required');
        return ok(verifyAction(b.action, isObj9(b.sources) ? b.sources : {}));
      }
      case "/v1/action/check":
        return ok(actionCheckFromJson(b));
      case "/v1/verify/citations": {
        if (!Array.isArray(b.citations)) return bad('"citations" array is required');
        return ok(verifyCitations(b.citations, isObj9(b.sources) ? b.sources : {}));
      }
      case "/v1/verify/quotes": {
        if (typeof b.source_text !== "string") return bad('"source_text" string is required');
        const quotes = Array.isArray(b.quotes) ? b.quotes : [];
        const values = Array.isArray(b.values) ? b.values : [];
        return ok(verifyAgainstSource(b.source_text, quotes, values));
      }
      case "/v1/mine": {
        if (!Array.isArray(b.cases)) return bad('a "cases" array of { id, label, fields, lines? } is required');
        if (!isObj9(b.schema)) return bad('a "schema" object { approve, fields, lines? } is required');
        const opts = {};
        if (typeof b.max_approved_violation_rate === "number") opts.maxApprovedViolationRate = b.max_approved_violation_rate;
        if (b.thresholds === true) opts.thresholds = true;
        return ok(mineRules(caseTableFromRows(b.cases), b.schema, opts, typeof b.ruleset_id === "string" ? { id: b.ruleset_id } : {}));
      }
      case "/v1/opinion":
        return ok(opinionFromJson(b));
      case "/v1/twin":
        return ok(twinFromJson(b));
      case "/v1/reconcile":
        return ok(reconcileFromJson(b));
      case "/v1/succession/replay":
        return ok(successionFromJson(b));
      default:
        return notFound();
    }
  } catch (e) {
    if (e instanceof SurfaceInputError) return bad(e.message);
    return bad(`verification error: ${e.message}`);
  }
}

// packages/verify/src/http/serve.ts
import { createServer } from "node:http";
var MiB = 1024 * 1024;
var DEFAULT_LIMITS = Object.freeze({
  maxBodyBytes: 4 * MiB,
  routeMaxBodyBytes: Object.freeze({ "/v1/twin": 32 * MiB, "/v1/opinion": 32 * MiB, "/v1/reconcile": 32 * MiB, "/v1/succession/replay": 32 * MiB }),
  drainBytes: 256 * 1024,
  requestTimeoutMs: 3e4,
  headersTimeoutMs: 1e4,
  idleTimeoutMs: 3e4,
  keepAliveTimeoutMs: 5e3,
  timeoutCheckIntervalMs: 1e3
});
function resolveLimits(limits = {}) {
  const r = {
    ...DEFAULT_LIMITS,
    ...limits,
    routeMaxBodyBytes: { ...DEFAULT_LIMITS.routeMaxBodyBytes, ...limits.routeMaxBodyBytes ?? {} }
  };
  const cap = (name, v) => {
    if (!Number.isSafeInteger(v) || v < 1) throw new RangeError(`${name} must be a positive integer (bytes), not ${String(v)}`);
  };
  cap("maxBodyBytes", r.maxBodyBytes);
  for (const [p, v] of Object.entries(r.routeMaxBodyBytes)) cap(`routeMaxBodyBytes[${JSON.stringify(p)}]`, v);
  if (!Number.isSafeInteger(r.drainBytes) || r.drainBytes < 0) throw new RangeError(`drainBytes must be a non-negative integer (bytes), not ${String(r.drainBytes)}`);
  for (const k of ["requestTimeoutMs", "headersTimeoutMs", "idleTimeoutMs", "keepAliveTimeoutMs"]) {
    if (!Number.isSafeInteger(r[k]) || r[k] < 0) throw new RangeError(`${k} must be a non-negative integer (ms), not ${String(r[k])}`);
  }
  if (!Number.isSafeInteger(r.timeoutCheckIntervalMs) || r.timeoutCheckIntervalMs < 1) throw new RangeError(`timeoutCheckIntervalMs must be a positive integer (ms), not ${String(r.timeoutCheckIntervalMs)}`);
  if (r.requestTimeoutMs > 0 && r.headersTimeoutMs > r.requestTimeoutMs) {
    throw new RangeError(`headersTimeoutMs (${r.headersTimeoutMs}) must not exceed requestTimeoutMs (${r.requestTimeoutMs}): the headers are part of the request`);
  }
  return r;
}
var pathOf = (url) => (url ?? "/").split("?")[0].replace(/\/+$/, "") || "/";
function bodyLimitFor(limits, url) {
  const r = limits.routeMaxBodyBytes ?? DEFAULT_LIMITS.routeMaxBodyBytes;
  const own = r[pathOf(url)];
  return own ?? limits.maxBodyBytes ?? DEFAULT_LIMITS.maxBodyBytes;
}
var headersOf = (req) => {
  const h = {};
  for (const [k, v] of Object.entries(req.headers)) h[k.toLowerCase()] = Array.isArray(v) ? v.join(", ") : v;
  return h;
};
var declaredLength = (req) => {
  const v = req.headers?.["content-length"];
  if (typeof v !== "string" || !/^\d+$/.test(v)) return void 0;
  const n = Number(v);
  return Number.isSafeInteger(n) ? n : void 0;
};
var tooLarge = (cap, path) => ({
  error: `request body too large: ${path} accepts at most ${cap} bytes (the transport stops reading past it)`,
  max_body_bytes: cap
});
function nodeHandler(dispatch, limits = {}) {
  const lim = resolveLimits(limits);
  return (req, res) => {
    const path = pathOf(req.url);
    const cap = bodyLimitFor(lim, req.url ?? "/");
    const routed = (req.url ?? "/").split("?")[0];
    let done = false;
    let chunks = [];
    let size = 0;
    let drained;
    let hungUp = false;
    const send = (status, body, extra = {}) => {
      if (done) return;
      done = true;
      chunks = [];
      let text;
      try {
        text = JSON.stringify(body);
        if (typeof text !== "string") throw new TypeError("not serializable");
      } catch {
        status = 500;
        text = JSON.stringify({ error: "internal error: the response could not be serialized" });
      }
      try {
        res.writeHead(status, { "content-type": "application/json", ...extra });
        res.end(text);
      } catch {
      }
    };
    const hangUp = () => {
      const r = req;
      if (typeof r.destroy === "function") r.destroy();
      else if (typeof req.pause === "function") req.pause();
    };
    const declared = declaredLength(req);
    if (declared !== void 0 && declared > cap) {
      if (declared > lim.drainBytes) {
        send(413, tooLarge(cap, path), { connection: "close" });
        if (typeof req.pause === "function") req.pause();
        return;
      }
      send(413, tooLarge(cap, path));
      drained = 0;
    }
    req.on("data", (c) => {
      const n = typeof c === "string" ? Buffer.byteLength(c, "utf8") : c.length;
      if (drained !== void 0) {
        drained += n;
        if (drained > lim.drainBytes && !hungUp) {
          hungUp = true;
          hangUp();
        }
        return;
      }
      if (done) return;
      size += n;
      if (size > cap) {
        send(413, tooLarge(cap, path));
        drained = 0;
        return;
      }
      chunks.push(typeof c === "string" ? Buffer.from(c, "utf8") : c);
    });
    req.on("error", () => {
      done = true;
      chunks = [];
    });
    req.on("end", () => {
      if (done) return;
      let body;
      const raw = Buffer.concat(chunks).toString("utf8");
      chunks = [];
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw);
        } catch {
          send(400, { error: "invalid JSON body" });
          return;
        }
      }
      let r;
      try {
        r = dispatch({ method: req.method ?? "GET", path: routed, body, headers: headersOf(req) });
      } catch {
        send(500, { error: "internal error" });
        return;
      }
      send(r.status, r.json);
    });
  };
}
function createHttpServer(dispatch, opts = {}) {
  const lim = resolveLimits(opts);
  const server = createServer({
    requestTimeout: lim.requestTimeoutMs,
    headersTimeout: lim.headersTimeoutMs,
    keepAliveTimeout: lim.keepAliveTimeoutMs,
    connectionsCheckingInterval: lim.timeoutCheckIntervalMs
  }, nodeHandler(dispatch, lim));
  server.setTimeout(lim.idleTimeoutMs);
  return server;
}
function limitsFromEnv(env = process.env) {
  const out = {};
  const int = (k) => {
    const v = env[k];
    if (v === void 0 || v === "") return void 0;
    if (!/^\d+$/.test(v)) throw new RangeError(`${k} must be a non-negative integer, not ${JSON.stringify(v)}`);
    return Number(v);
  };
  const body = int("VERIFY_MAX_BODY_BYTES"), reqT = int("VERIFY_REQUEST_TIMEOUT_MS"), hdrT = int("VERIFY_HEADERS_TIMEOUT_MS"), idle = int("VERIFY_IDLE_TIMEOUT_MS");
  if (body !== void 0) out.maxBodyBytes = body;
  if (reqT !== void 0) out.requestTimeoutMs = reqT;
  if (hdrT !== void 0) out.headersTimeoutMs = hdrT;
  if (idle !== void 0) out.idleTimeoutMs = idle;
  return out;
}
function serve(port = Number(process.env.PORT ?? 8080), opts = {}) {
  const { host, ...limits } = opts;
  const server = createHttpServer(route, limits);
  const listening = () => {
    process.stdout.write(`verify HTTP server listening on :${port}
`);
  };
  if (host !== void 0) server.listen(port, host, listening);
  else server.listen(port, listening);
  return server;
}
if (process.argv[1] && (process.argv[1].endsWith("serve.js") || process.argv[1].endsWith("serve.ts"))) serve(void 0, limitsFromEnv());

// packages/receipts/src/ap-gate.ts
function apGate(modelDecision, docs, opts = {}) {
  const check2 = verifyInvoiceMatch(docs, { ...opts.policy ? { policy: opts.policy } : {}, ...opts.now ? { now: opts.now } : {} });
  const c = check2.decision;
  if (c === "abstain") {
    return {
      action: "REVIEW",
      model_decision: modelDecision,
      checker_decision: c,
      effect: "HUMAN_REVIEW",
      check: check2,
      reason: `the checker could not verify these documents (${check2.reasons[0] ?? "undecided"}) \u2014 not executing the model's "${modelDecision}"`
    };
  }
  if (c !== modelDecision) {
    return {
      action: "REVIEW",
      model_decision: modelDecision,
      checker_decision: c,
      effect: "HUMAN_REVIEW",
      check: check2,
      reason: `the model says "${modelDecision}" but the checker says "${c}"${c !== "approve" ? ` \u2014 ${check2.reasons[0] ?? ""}` : ""}`
    };
  }
  return {
    action: "EXECUTE",
    model_decision: modelDecision,
    checker_decision: c,
    effect: c === "approve" ? "PAY" : "HOLD",
    check: check2,
    reason: c === "approve" ? "model and checker agree: all four checks pass" : `model and checker agree: ${c} \u2014 ${check2.reasons[0] ?? ""}`
  };
}

// packages/receipts/src/ap-resolve.ts
var money2 = (n) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
var qty = (n) => String(n);
var r2 = (n) => Math.round(n * 100) / 100;
function isTransposition(a, b) {
  if (a.length !== b.length || a === b) return false;
  const d = [...a].map((ch, i) => ch !== b[i] ? i : -1).filter((i) => i >= 0);
  return d.length === 2 && d[1] === d[0] + 1 && a[d[0]] === b[d[1]] && a[d[1]] === b[d[0]];
}
function invoiceLineFor(check2, docs, ruleId) {
  if (!docs) return null;
  const claim = check2.verdict.claims.find((c) => c.rule_id === ruleId && c.outcome === "FAIL");
  const loc = claim?.evidence.find((e) => e.role === "OPERAND")?.locator;
  if (!loc || loc.kind !== "span" || typeof loc.line !== "number") return null;
  const l = parseInvoice(docs.invoice).lines.find((x) => x.span.line === loc.line);
  return l ? { qty: l.qty, unit: l.unit, line: loc.line } : null;
}
function statedTotal(docs) {
  if (!docs) return null;
  const t = [...new Set(parseInvoice(docs.invoice).totals.map((x) => x.value))];
  return t.length === 1 ? t[0] : null;
}
function draftResolution(check2, documents) {
  const docs = typeof documents === "string" ? splitApLayout(documents) : documents ?? null;
  const g = check2.grounding;
  const inv = g.invoice_number ?? "your invoice";
  const po = g.po_number ?? "";
  const base = { decision: check2.decision, verdict_id: check2.verdict.verdict_id };
  const facts = [];
  const fact = (f) => {
    facts.push(f);
    return f.value;
  };
  if (g.invoice_number) fact({ label: "invoice number", value: g.invoice_number, source: "invoice" });
  if (g.item) fact({ label: "item", value: g.item, source: "purchase_order" });
  switch (check2.decision) {
    case "approve":
      return { ...base, kind: "none", subject: `${inv}: approved`, body: `${inv} matches the purchase order and the goods receipt. Nothing to send.`, facts };
    case "abstain":
      return { ...base, kind: "review", subject: `${inv}: needs a person`, body: `No draft: the checker could not read this invoice unambiguously.
- ${check2.reasons.join("\n- ")}`, facts };
    case "hold_quantity": {
      fact({ label: "PO number", value: po, source: "purchase_order" });
      const billed = fact({ label: "quantity billed", value: g.invoiced, source: "invoice" });
      const received = fact({ label: "quantity received", value: g.expected, source: "goods_receipt" });
      const excess = fact({ label: "units billed but not received", value: billed - received, source: "computed", from: ["quantity billed", "quantity received"] });
      const line3 = invoiceLineFor(check2, docs, "AP_QTY_RECEIVED");
      const total = statedTotal(docs);
      let credit = "", short2;
      if (line3) {
        fact({ label: "invoice unit price", value: line3.unit, source: "invoice", line: line3.line });
        const amt = fact({ label: "credit requested", value: r2(excess * line3.unit), source: "computed", from: ["units billed but not received", "invoice unit price"] });
        credit = ` That is ${money2(amt)} at your invoiced unit price of ${money2(line3.unit)}.`;
        if (total !== null) {
          fact({ label: "stated total", value: total, source: "invoice" });
          const now = fact({ label: "payable now", value: r2(total - amt), source: "computed", from: ["stated total", "credit requested"] });
          short2 = { payable_now: now, withheld: amt, stated_total: total };
        }
      }
      return {
        ...base,
        kind: "vendor_query",
        ...short2 ? { short_pay: short2 } : {},
        subject: `${inv} (${po}): billed ${qty(billed)} \xD7 ${g.item}, received ${qty(received)}`,
        body: `Hello,

${inv} against ${po} bills ${qty(billed)} \xD7 ${g.item}, but our goods receipt shows ${qty(received)} received. Please send a credit memo for the ${qty(excess)} unit(s) not delivered, or proof of delivery.${credit}` + (short2 ? `

We will pay ${money2(short2.payable_now)} now and hold ${money2(short2.withheld)} until this is resolved.` : "") + "\n\nThank you.",
        facts
      };
    }
    case "hold_price": {
      fact({ label: "PO number", value: po, source: "purchase_order" });
      const billed = fact({ label: "invoiced unit price", value: g.invoiced, source: "invoice" });
      const agreed = fact({ label: "PO unit price", value: g.expected, source: "purchase_order" });
      const over = fact({ label: "overcharge per unit", value: r2(billed - agreed), source: "computed", from: ["invoiced unit price", "PO unit price"] });
      const pct4 = fact({ label: "overcharge %", value: r2((billed - agreed) / agreed * 100), source: "computed", from: ["invoiced unit price", "PO unit price"] });
      const line3 = invoiceLineFor(check2, docs, "AP_PRICE_PO");
      const total = statedTotal(docs);
      let short2, extra = "";
      if (line3) {
        fact({ label: "quantity on the line", value: line3.qty, source: "invoice", line: line3.line });
        const amt = fact({ label: "overcharge on the line", value: r2(over * line3.qty), source: "computed", from: ["overcharge per unit", "quantity on the line"] });
        extra = ` Across ${qty(line3.qty)} unit(s) that is ${money2(amt)}.`;
        if (total !== null) {
          fact({ label: "stated total", value: total, source: "invoice" });
          const now = fact({ label: "payable now", value: r2(total - amt), source: "computed", from: ["stated total", "overcharge on the line"] });
          short2 = { payable_now: now, withheld: amt, stated_total: total };
        }
      }
      return {
        ...base,
        kind: "vendor_query",
        ...short2 ? { short_pay: short2 } : {},
        subject: `${inv} (${po}): ${g.item} billed at ${money2(billed)}, PO price ${money2(agreed)}`,
        body: `Hello,

${inv} bills ${g.item} at ${money2(billed)} per unit; ${po} agreed ${money2(agreed)} (${pct4}% over, beyond our tolerance).${extra} Please rebill at the PO price, or send the approved price change.` + (short2 ? `

We will pay ${money2(short2.payable_now)} now and hold ${money2(short2.withheld)} until this is resolved.` : "") + "\n\nThank you.",
        facts
      };
    }
    case "hold_total": {
      fact({ label: "PO number", value: po, source: "purchase_order" });
      const stated = fact({ label: "stated total", value: g.invoiced, source: "invoice" });
      const sum = fact({ label: "sum of lines (+ allowed freight)", value: g.expected, source: "computed", from: ["invoice line amounts"] });
      const diff = fact({ label: "difference", value: r2(Math.abs(stated - sum)), source: "computed", from: ["stated total", "sum of lines (+ allowed freight)"] });
      const dir = stated > sum ? "above" : "below";
      return {
        ...base,
        kind: "vendor_query",
        subject: `${inv} (${po}): total ${money2(stated)} does not match its lines (${money2(sum)})`,
        body: `Hello,

${inv} states a total of ${money2(stated)}, but its lines add up to ${money2(sum)}; the stated total is ${money2(diff)} ${dir} them. Please send a corrected invoice. We will hold payment until it arrives.

Thank you.`,
        facts
      };
    }
    case "hold_no_po": {
      const cited = typeof g.invoiced === "string" ? g.invoiced : null;
      const open = String(g.expected ?? po);
      if (cited) fact({ label: "PO cited on invoice", value: cited, source: "invoice" });
      fact({ label: "open PO", value: open, source: "purchase_order" });
      const typo = cited !== null && isTransposition(cited, open);
      return {
        ...base,
        kind: "vendor_query",
        subject: `${inv}: PO reference ${cited ?? "missing"}`,
        body: `Hello,

${inv} ${cited ? `cites ${cited}` : "does not cite a purchase order"}; the open order we have is ${open}.` + (typo ? ` That looks like two digits transposed.` : "") + ` Please confirm the PO, or reissue the invoice against ${open}.

Thank you.`,
        facts
      };
    }
    case "hold_duplicate":
      return { ...base, kind: "do_not_pay", subject: `${inv}: already booked, do not pay`, body: `${inv} matches an invoice already booked.
- ${check2.reasons.join("\n- ")}`, facts };
  }
  return { ...base, kind: "review", subject: `${inv}: needs a person`, body: check2.reasons.join("\n"), facts };
}

// packages/receipts/src/done.ts
function getPath4(obj, path) {
  if (path === "") return { found: true, value: obj };
  let cur = obj;
  for (const key of path.split(".")) {
    if (cur === null || typeof cur !== "object" || !(key in cur)) return { found: false };
    cur = cur[key];
  }
  return { found: true, value: cur };
}
function checkDone(claim, read) {
  const cache = /* @__PURE__ */ new Map();
  const load = (src) => {
    if (!cache.has(src)) {
      try {
        cache.set(src, { ok: true, value: read(src) });
      } catch (e) {
        cache.set(src, { ok: false, error: e.message });
      }
    }
    return cache.get(src);
  };
  const results = [];
  if (!claim.expectations.length) {
    return { outcome: "ABSTAIN", claim: claim.claim, results, observed: {}, message: `"${claim.claim}" came with nothing checkable \u2014 not accepted as done; state what should now be true.` };
  }
  for (const e of claim.expectations) {
    const st = load(e.source);
    if (!st.ok) {
      results.push({ source: e.source, path: e.path, outcome: "ABSTAIN", detail: `could not read ${e.source}: ${st.error}` });
      continue;
    }
    const got = getPath4(st.value, e.path);
    if (e.exists !== void 0 && e.equals === void 0) {
      const ok3 = got.found === e.exists;
      results.push({
        source: e.source,
        path: e.path,
        outcome: ok3 ? "PASS" : "FAIL",
        expected: e.exists ? "present" : "absent",
        actual: got.found ? "present" : "absent",
        detail: ok3 ? `${e.path} is ${got.found ? "present" : "absent"} as claimed` : `${e.path} is ${got.found ? "present" : "absent"}, but the claim says ${e.exists ? "present" : "absent"}`
      });
      continue;
    }
    if (e.equals === void 0) {
      results.push({ source: e.source, path: e.path, outcome: "ABSTAIN", detail: "expectation states neither `equals` nor `exists` \u2014 unverifiable" });
      continue;
    }
    if (!got.found) {
      results.push({ source: e.source, path: e.path, outcome: "FAIL", expected: e.equals, actual: void 0, detail: `${e.path} does not exist in ${e.source} \u2014 nothing was saved there` });
      continue;
    }
    const tol = e.tolerance ?? 5e-3;
    const ok2 = typeof e.equals === "number" && typeof got.value === "number" ? Math.abs(got.value - e.equals) <= tol : canonicalize(got.value) === canonicalize(e.equals);
    results.push({
      source: e.source,
      path: e.path,
      outcome: ok2 ? "PASS" : "FAIL",
      expected: e.equals,
      actual: got.value,
      detail: ok2 ? `${e.path} = ${canonicalize(got.value)} as claimed` : `${e.path} is ${canonicalize(got.value)}, not ${canonicalize(e.equals)}`
    });
  }
  const observed = {};
  for (const [src, st] of cache) observed[src] = st.ok ? hashOf(st.value) : `unreadable: ${st.error}`;
  const outcome = results.some((r) => r.outcome === "FAIL") ? "FAIL" : results.some((r) => r.outcome === "ABSTAIN") ? "ABSTAIN" : "PASS";
  const fails = results.filter((r) => r.outcome === "FAIL");
  const message2 = outcome === "PASS" ? `Verified: "${claim.claim}" \u2014 ${results.length} expectation(s) hold in the real state.` : outcome === "FAIL" ? `Not done: "${claim.claim}" is contradicted by the actual state \u2014 ${fails.map((f) => f.detail).join("; ")}.` : `Could not verify "${claim.claim}" \u2014 ${results.filter((r) => r.outcome === "ABSTAIN").map((r) => r.detail).join("; ")}. Not accepted as done.`;
  return { outcome, claim: claim.claim, results, observed, message: message2 };
}

// packages/receipts/src/ledger.ts
import { createHash as createHash4, createPrivateKey as createPrivateKey2, createPublicKey as createPublicKey3, sign as edSign2, verify as edVerify2 } from "node:crypto";
function memoryStore(seed = []) {
  const entries = [...seed];
  return { load: () => [...entries], append: (e) => {
    entries.push(e);
  } };
}
var GENESIS2 = "0".repeat(64);
var entryHash2 = (e) => sha256(canonicalize({ seq: e.seq, kind: e.kind, at: e.at, body: e.body, prev_hash: e.prev_hash }));
function keyFingerprint2(publicKeyPem) {
  const der = createPublicKey3(publicKeyPem).export({ type: "spki", format: "der" });
  return createHash4("sha256").update(der).digest("hex").slice(0, 16);
}
function openLedger(store = memoryStore(), opts = {}) {
  const now = opts.now ?? (() => /* @__PURE__ */ new Date());
  return {
    append(kind, body) {
      const all = store.load();
      const prev = all[all.length - 1];
      const partial = { seq: all.length, kind, at: now().toISOString(), body, prev_hash: prev ? prev.hash : GENESIS2 };
      const hash = entryHash2(partial);
      const entry = { ...partial, hash };
      if (opts.signingKey) {
        const key = createPrivateKey2(opts.signingKey);
        entry.signature = { alg: "ed25519", public_key: createPublicKey3(key).export({ type: "spki", format: "pem" }).toString(), sig: edSign2(null, Buffer.from(hash, "utf8"), key).toString("base64") };
      }
      store.append(entry);
      return entry;
    },
    entries: () => store.load(),
    verify: (policy) => verifyChain2(store.load(), policy)
  };
}
function verifyChain2(entries, policy = {}) {
  let prev = GENESIS2;
  let signed = 0;
  let unsigned = 0;
  const signers = /* @__PURE__ */ new Set();
  let expected = null;
  if (policy.publicKey) {
    try {
      expected = keyFingerprint2(policy.publicKey);
    } catch {
      return { ok: false, length: entries.length, head: prev, reason: "the expected public key could not be read", signed, unsigned, signers: [] };
    }
  }
  const fail = (i, reason) => ({ ok: false, length: entries.length, head: prev, broken_at: i, reason, signed, unsigned, signers: [...signers] });
  let anchored = !policy.head;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.seq !== i) return fail(i, `entry ${i} has seq ${e.seq} (reordered or removed entries)`);
    if (e.prev_hash !== prev) return fail(i, `entry ${i} does not follow entry ${i - 1} (chain broken)`);
    if (entryHash2(e) !== e.hash) return fail(i, `entry ${i} was altered after it was written`);
    if (e.signature) {
      let ok2 = false;
      let fp = "";
      try {
        ok2 = edVerify2(null, Buffer.from(e.hash, "utf8"), createPublicKey3(e.signature.public_key), Buffer.from(e.signature.sig, "base64"));
        fp = keyFingerprint2(e.signature.public_key);
      } catch {
        ok2 = false;
      }
      if (!ok2) return fail(i, `entry ${i} signature does not verify`);
      signers.add(fp);
      signed++;
      if (expected && fp !== expected) return fail(i, `entry ${i} is signed by key ${fp}, not the expected ${expected} (re-signed by someone else?)`);
    } else {
      unsigned++;
      if (policy.requireSigned) return fail(i, `entry ${i} is not signed (signatures required)`);
    }
    if (policy.head && e.hash === policy.head) anchored = true;
    prev = e.hash;
  }
  const base = { length: entries.length, head: prev, signed, unsigned, signers: [...signers] };
  if (!anchored) return { ok: false, ...base, reason: `the anchored hash ${policy.head.slice(0, 16)}\u2026 is not in this chain (rewritten or truncated since it was recorded)` };
  return { ok: true, ...base };
}

// packages/receipts/src/model-attest.ts
var ALIASES = /* @__PURE__ */ new Set(["opus", "sonnet", "haiku", "fable", "default", "auto", "best", "latest"]);
var PLACEHOLDER = /^<.*>$/;
function isFloatingAlias(id) {
  const s = id.trim().toLowerCase();
  return ALIASES.has(s) || s.endsWith("-latest");
}
function modelMatches(expected, resolved) {
  if (expected === resolved) return true;
  return resolved.startsWith(`${expected}-`) && /^\d{8}$/.test(resolved.slice(expected.length + 1));
}
var MAX_VIOLATIONS = 20;
function attestModels(events, policy = {}) {
  const sessionModel = events.find((e) => e.type === "session_model")?.model;
  const fromHost = !policy.allowed?.length && !policy.declared && Boolean(sessionModel);
  const expected = policy.allowed?.length ? policy.allowed : policy.declared ? [policy.declared] : sessionModel ? [sessionModel] : null;
  const out = {
    outcome: "PASS",
    models: {},
    first: null,
    last: null,
    replies: 0,
    switches: [],
    violations: [],
    violation_count: 0,
    skipped: 0,
    host_switches: [],
    expected,
    reasons: []
  };
  const floating = (expected ?? []).filter(isFloatingAlias);
  let pendingRequest = false;
  let pendingHost = null;
  for (const e of events) {
    if (e.type === "switch_requested") {
      pendingRequest = true;
      continue;
    }
    if (e.type === "host_switch") {
      pendingHost = e.reason;
      out.host_switches.push({ reason: e.reason, ...e.from ? { from: e.from } : {}, ...e.to ? { to: e.to } : {}, ...e.at ? { at: e.at } : {} });
      continue;
    }
    if (e.type === "session_model") continue;
    const m = typeof e.model === "string" ? e.model.trim() : "";
    if (!m || PLACEHOLDER.test(m)) {
      out.skipped++;
      continue;
    }
    const n = out.replies++;
    out.models[m] = (out.models[m] ?? 0) + 1;
    if (out.first === null) out.first = m;
    if (out.last !== null && m !== out.last) {
      const cause = pendingRequest ? "user_command" : pendingHost ? "host_fallback" : "unrecorded";
      out.switches.push({ from: out.last, to: m, ...e.at ? { at: e.at } : {}, reply: n, announced: cause === "user_command", cause, ...cause === "host_fallback" ? { host_reason: pendingHost } : {} });
      pendingRequest = false;
      pendingHost = null;
    }
    out.last = m;
    if (expected && !floating.length && !expected.some((x) => modelMatches(x, m))) {
      out.violation_count++;
      if (out.violations.length < MAX_VIOLATIONS) out.violations.push({ reply: n, model: m, ...e.at ? { at: e.at } : {} });
    }
  }
  if (floating.length) {
    out.outcome = "ABSTAIN";
    out.reasons.push(`declared model ${floating.map((f) => `"${f}"`).join(", ")} is a floating alias \u2014 it resolves to whatever is served today, so nothing can be attested against it. Pin an exact model id.`);
    if (out.first) out.reasons.push(`(for the record: replies came from ${Object.keys(out.models).join(", ")})`);
    return out;
  }
  if (!out.replies) {
    out.outcome = "ABSTAIN";
    out.reasons.push(events.length ? "no reply recorded which model produced it \u2014 cannot attest" : "no replies to attest");
    return out;
  }
  const silent = out.switches.filter((s) => !s.announced);
  if (out.violation_count) {
    out.outcome = "FAIL";
    const wrong = [...new Set(out.violations.map((v) => v.model))];
    out.reasons.push(`${out.violation_count} of ${out.replies} replies came from ${wrong.join(", ")} \u2014 declared ${expected.join(" | ")}`);
  }
  if (silent.length && policy.failOnSilentSwitch !== false) {
    out.outcome = "FAIL";
    const host = silent.filter((s) => s.cause === "host_fallback");
    const bare = silent.filter((s) => s.cause === "unrecorded");
    const list = (ss) => `${ss.slice(0, 3).map((s) => `${s.from} \u2192 ${s.to}${s.at ? ` at ${s.at}` : ""}`).join("; ")}${ss.length > 3 ? "; \u2026" : ""}`;
    if (host.length) out.reasons.push(`${host.length} model switch${host.length > 1 ? "es" : ""} made by the host, not asked for (${[...new Set(host.map((s) => s.host_reason))].join(", ")}): ${list(host)}`);
    if (bare.length) out.reasons.push(`${bare.length} silent model switch${bare.length > 1 ? "es" : ""} (nothing announced the change): ${list(bare)}`);
  }
  if (out.violation_count && out.host_switches.length && !out.switches.some((s) => s.cause === "host_fallback")) {
    out.reasons.push(`the host itself switched models: ${out.host_switches.map((h) => `${h.from ?? "?"} \u2192 ${h.to ?? "?"} (${h.reason})`).join("; ")}`);
  }
  if (fromHost && out.outcome !== "ABSTAIN") out.reasons.push(`(expected model taken from the host's own session start: ${sessionModel})`);
  if (out.outcome === "PASS") {
    const names = Object.keys(out.models);
    out.reasons.push(names.length === 1 ? `all ${out.replies} replies came from ${names[0]}${expected ? "" : " (no declared model \u2014 consistency only)"}` : `${out.replies} replies across ${names.join(", ")}; every change was announced${expected ? " and every model was expected" : ""}`);
  }
  if (out.skipped) out.reasons.push(`${out.skipped} event(s) carried no model (missing or placeholder) and were not attested`);
  return out;
}
function eventsFromReplies(replies) {
  return replies.map((r) => ({ type: "reply", model: r.model, ...r.created_at ? { at: r.created_at } : {}, ...r.id ? { id: r.id } : {} }));
}
var MODEL_COMMAND = /^\s*<command-name>\/?model<\/command-name>/;
function eventsFromClaudeCodeTranscript(jsonl) {
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const line3 of jsonl.split("\n")) {
    if (!line3.trim()) continue;
    let j;
    try {
      j = JSON.parse(line3);
    } catch {
      continue;
    }
    const msg = j.message ?? {};
    const at3 = typeof j.timestamp === "string" ? { at: j.timestamp } : {};
    if (j.type === "system" && j.subtype === "init" && typeof j.model === "string") {
      out.push({ type: "session_model", model: j.model, ...at3 });
      continue;
    }
    if (j.type === "system" && j.subtype === "model_refusal_fallback") {
      const cat = typeof j.api_refusal_category === "string" ? ` (${j.api_refusal_category})` : "";
      out.push({ type: "host_switch", reason: `safety-refusal fallback${cat}`, ...typeof j.original_model === "string" ? { from: j.original_model } : {}, ...typeof j.fallback_model === "string" ? { to: j.fallback_model } : {}, ...at3 });
      continue;
    }
    const command = j.type === "user" ? msg.content : j.type === "system" && j.subtype === "local_command" ? j.content : void 0;
    if (command !== void 0) {
      if (typeof command === "string" && MODEL_COMMAND.test(command)) out.push({ type: "switch_requested", ...typeof j.timestamp === "string" ? { at: j.timestamp } : {} });
      continue;
    }
    if (j.type !== "assistant") continue;
    const id = typeof msg.id === "string" ? msg.id : void 0;
    if (id) {
      if (seen.has(id)) continue;
      seen.add(id);
    }
    out.push({ type: "reply", model: typeof msg.model === "string" ? msg.model : null, ...typeof j.timestamp === "string" ? { at: j.timestamp } : {}, ...id ? { id } : {} });
  }
  return out;
}

// packages/receipts/src/claims.ts
var HEDGE = /\b(?:not|never|no longer|nothing|none|neither|nor|without|isn't|aren't|wasn't|weren't|doesn't|don't|didn't|won't|can't|cannot|couldn't|wouldn't|shouldn't|haven't|hasn't|hadn't|(?:i|you|we|they|it|that|he|she)'ll|when|fail(?:s|ed|ing|ure)?|except|should|would|will|might|may|could|expect(?:s|ed)?|if|unless|until|once|whether|hopefully|probably|likely|try|trying|tried|attempt(?:s|ed)?|want|need)\b/i;
var NUM2 = String.raw`(\d{1,3}(?:,\d{3})+|\d+)`;
var PATTERNS = [
  { kind: "tests_pass", re: new RegExp(String.raw`\b(?:all\s+)?(?:${NUM2}\s+(?:[a-z-]+\s+){0,2})?tests?\s+(?:(?:all|now|still)\s+)?(?:pass(?:es|ed|ing)?\b|(?:are|is)\s+(?:all\s+)?(?:passing|green)\b)|\btests?\s+(?:are\s+)?(?:all\s+)?green\b|\btest\s+suite\s+pass(?:es|ed)?\b`, "i") },
  { kind: "build_ok", re: /\b(?:the\s+)?(?:build|compil(?:e|es|ation)|type-?check(?:s|ing)?|tsc)\b(?:\s+(?:is|was|now|all|still))*\s+(?:succeed(?:s|ed)?|pass(?:es|ed)?|clean(?:ly)?|green)\b|\bbuilds?\s+(?:cleanly|clean|successfully|fine)\b|\bno\s+type\s+errors\b/i },
  // not "committed to" (a pledge), "last committed" / "last pushed 2024" (a report about something else), or "… by" (someone else)
  { kind: "committed", re: /\b(?<!last\s)committed\b(?!\s+(?:to|by)\b)|\bmade\s+(?:a|the)\s+commit\b/i },
  { kind: "pushed", re: /\b(?<!last\s)pushed\b(?!\s+(?:back|by)\b)/i },
  { kind: "file_written", re: /\b(?:created|wrote|added|saved)\s+`([^`\s]+\.[A-Za-z0-9]{1,8})`/i }
];
var COMPLETED = /^\s*(?:all\s+)?done\s*[.!—–-]|^\s*(?:all\s+)?done\s*$|(?:^[\s\-*•>#_]*(?:\*\*|__)?|\bI(?:'ve| have)?\s+|\bwe(?:'ve| have)?\s+|\b[a-z]+\s+and\s+)(?:fixed|implemented|resolved|completed|finished)\b(?!\s+(?:by|when)\b)|\b(?:is|are|it's|that's|everything's|everything is)\s+(?:now\s+)?(?:done|fixed|complete|working|resolved)\b|\bworks\s+now\b|\bnow\s+works\b/i;
function prose(text) {
  return text.replace(/```[\s\S]*?```/g, " ").replace(/~~~[\s\S]*?~~~/g, " ").replace(/"[^"\n]{1,160}"/g, " ").replace(/“[^”\n]{1,160}”/g, " ");
}
function sentences(text) {
  return prose(text).split(/\n+|(?<=[.!?])\s+(?=[A-Z*_(`"'])/).map((s) => s.trim()).filter(Boolean);
}
var toInt = (s) => s === void 0 ? void 0 : Number(s.replace(/,/g, ""));
function extractClaims(text, opts = {}) {
  const out = [];
  for (const s of sentences(text)) {
    if (HEDGE.test(s.replace(/`[^`]*`/g, " "))) continue;
    if (opts.strict && COMPLETED.test(s.replace(/`[^`]*`/g, " "))) out.push({ kind: "completed", claim: s.length > 200 ? `${s.slice(0, 197)}\u2026` : s });
    for (const { kind, re } of PATTERNS) {
      const m = s.match(re);
      if (!m) continue;
      const claim = s.length > 200 ? `${s.slice(0, 197)}\u2026` : s;
      if (kind === "tests_pass") {
        const n = toInt(m[1]);
        out.push(n === void 0 ? { kind, claim } : { kind, claim, count: n });
      } else if (kind === "file_written") out.push({ kind, claim, path: m[1] });
      else out.push({ kind, claim });
    }
  }
  return out;
}
var SHELL = /^(?:bash|shell|run_command|execute_command|terminal|exec)$/i;
var EDIT_TOOLS = /^(?:edit|write|multiedit|notebookedit|str_replace_based_edit_tool|apply_patch)$/i;
var DOC_FILE = /\.(?:md|mdx|txt|rst)$/i;
var TEST_CMD = /\b(?:vitest|jest|mocha|pytest|py\.test|phpunit|rspec|ava|tap)\b|\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test\b|\b(?:go|cargo|dotnet|mix|deno)\s+test\b|\bnode\s+--test\b/i;
var BUILD_CMD = /\btsc(?:\.cmd)?\b|\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:build|typecheck)\b|\b(?:cargo|go|dotnet)\s+build\b|\bmake\b|\b(?:gradle|mvn|webpack)\b|\b(?:vite|next)\s+build\b/i;
var COMMIT_CMD = /\bgit\s+(?:-[^\s]+\s+(?:[^\s-][^\s]*\s+)?)*commit\b/i;
var PUSH_CMD = /\bgit\s+(?:-[^\s]+\s+(?:[^\s-][^\s]*\s+)?)*push\b/i;
var ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;
function shellRuns(steps, upTo, cmd) {
  const results = /* @__PURE__ */ new Map();
  for (let i = 0; i < upTo; i++) {
    const s = steps[i];
    if (s.kind === "tool_result") results.set(s.id, s);
  }
  const runs = [];
  for (let i = 0; i < upTo; i++) {
    const s = steps[i];
    if (s.kind !== "tool_use" || !SHELL.test(s.name) || typeof s.input.command !== "string" || !cmd.test(s.input.command)) continue;
    const result = results.get(s.id);
    runs.push(result ? { use: s, result, index: i } : { use: s, index: i });
  }
  return runs;
}
function editAfter(steps, after, upTo) {
  for (let i = upTo - 1; i > after; i--) {
    const s = steps[i];
    if (s.kind !== "tool_use" || !EDIT_TOOLS.test(s.name)) continue;
    const p = String(s.input.file_path ?? s.input.path ?? s.input.notebook_path ?? "");
    if (p && DOC_FILE.test(p)) continue;
    return { path: p || "(unknown file)", ...s.at ? { at: s.at } : {} };
  }
  return null;
}
var excerpt = (text, re) => {
  const clean = text.replace(ANSI, "");
  const lines = clean.split("\n").map((l) => l.trim()).filter(Boolean);
  const hit = re ? lines.filter((l) => re.test(l)) : [];
  const pick = (hit.length ? hit : lines.slice(-3)).slice(-3).join(" \u23CE ");
  return pick.length > 240 ? `${pick.slice(0, 237)}\u2026` : pick;
};
var evidenceOf = (r, re) => ({
  tool: r.use.name,
  command: String(r.use.input.command).slice(0, 200),
  excerpt: r.result ? excerpt(r.result.text, re) : "(no result recorded)",
  ...r.result?.at ?? r.use.at ? { at: r.result?.at ?? r.use.at } : {},
  tool_use_id: r.use.id
});
function parseTestOutput(raw) {
  const text = raw.replace(ANSI, "");
  const passed = [];
  let failed = 0;
  let recognised = false;
  for (const line3 of text.split("\n")) {
    const l = line3.trim();
    if (/^(?:Tests:?\s|test result:|=+\s|# (?:pass|fail)\b|\d+\s+(?:passed|failed|passing|failing)\b)/i.test(l) || /\b\d+\s+(?:passed|failed)\b.*\bin\s+[\d.]+s\b/.test(l)) {
      const p = l.match(/(\d[\d,]*)\s+(?:passed|passing)\b/i) ?? l.match(/^# pass\s+(\d+)/i);
      const f = l.match(/(\d[\d,]*)\s+(?:failed|failing)\b/i) ?? l.match(/^# fail\s+(\d+)/i);
      if (p || f) recognised = true;
      if (p) passed.push(Number(p[1].replace(/,/g, "")));
      if (f) failed += Number(f[1].replace(/,/g, ""));
    }
    if (/^--- FAIL\b|^FAIL\s+\S/.test(l)) {
      recognised = true;
      failed += 1;
    }
    if (/^ok\s+\S+\s+[\d.]+s/.test(l)) {
      recognised = true;
      passed.push(1);
    }
  }
  return { passed, failed, recognised };
}
function checkOne(c, steps, upTo) {
  const stale = (r) => editAfter(steps, r.result ? steps.indexOf(r.result) : r.index, upTo);
  const unsupported = (reason, evidence) => ({ ...c, status: "UNSUPPORTED", reason, ...evidence ? { evidence } : {} });
  if (c.kind === "completed") {
    const runs = shellRuns(steps, upTo, TEST_CMD);
    const last = runs[runs.length - 1];
    const need = "a completion claim (strict) needs a passing test run after the last code edit";
    if (!last) return unsupported(`${need}; no test ran in this session`);
    if (!last.result) return unsupported(`${need}; the last run has no recorded result`, evidenceOf(last));
    const edited = stale(last);
    if (edited) return unsupported(`${need}; tests last ran before a later code edit (${edited.path}${edited.at ? ` at ${edited.at}` : ""})`, evidenceOf(last));
    const t = parseTestOutput(last.result.text);
    const ev = evidenceOf(last, /passed|failed|passing|failing|test result|# (?:pass|fail)|^ok\s|FAIL/i);
    if (t.failed > 0) return { ...c, status: "CONTRADICTED", reason: `claims completion, but the last test run reports ${t.failed} failing`, evidence: ev };
    if (last.result.isError) return { ...c, status: "CONTRADICTED", reason: "claims completion, but the last test run exited with an error", evidence: ev };
    if (!t.recognised || !t.passed.length) return unsupported(`${need}; the last run ended without a recognisable pass count`, ev);
    return { ...c, status: "SUPPORTED", reason: `tests ran after the last code edit: ${t.passed.join(" + ")} passing, 0 failing`, evidence: ev };
  }
  if (c.kind === "tests_pass" || c.kind === "build_ok") {
    const isTests = c.kind === "tests_pass";
    const runs = shellRuns(steps, upTo, isTests ? TEST_CMD : BUILD_CMD);
    const last = runs[runs.length - 1];
    if (!last) return unsupported(isTests ? "no test run anywhere in this session" : "no build or typecheck ran in this session");
    if (!last.result) return unsupported("the last run has no recorded result", evidenceOf(last));
    const edited = stale(last);
    if (edited) return unsupported(`${isTests ? "tests" : "the build"} last ran before a later code edit (${edited.path}${edited.at ? ` at ${edited.at}` : ""})`, evidenceOf(last));
    if (isTests) {
      const t = parseTestOutput(last.result.text);
      const ev2 = evidenceOf(last, /passed|failed|passing|failing|test result|# (?:pass|fail)|^ok\s|FAIL/i);
      if (t.failed > 0) return { ...c, status: "CONTRADICTED", reason: `the last test run reports ${t.failed} failing`, evidence: ev2 };
      if (last.result.isError) return { ...c, status: "CONTRADICTED", reason: "the last test run exited with an error", evidence: ev2 };
      if (!t.recognised || !t.passed.length) return unsupported("the last test run ended without a recognisable pass count", ev2);
      const sum = t.passed.reduce((a, b) => a + b, 0);
      if (c.count !== void 0 && c.count !== sum && !t.passed.includes(c.count))
        return { ...c, status: "CONTRADICTED", reason: `claims ${c.count}, the last run shows ${t.passed.join(" + ")} passing`, evidence: ev2 };
      return { ...c, status: "SUPPORTED", reason: `the last test run: ${t.passed.join(" + ")} passing, 0 failing`, evidence: ev2 };
    }
    const ev = evidenceOf(last, /error|warning|built|compiled|success/i);
    if (last.result.isError) return { ...c, status: "CONTRADICTED", reason: "the last build exited with an error", evidence: ev };
    if (/\berror(?:\s+TS\d+)?\s*:|\b[1-9]\d*\s+errors?\b|\bbuild failed\b/i.test(last.result.text.replace(ANSI, "")))
      return { ...c, status: "CONTRADICTED", reason: "the last build output reports errors", evidence: ev };
    return { ...c, status: "SUPPORTED", reason: "the last build/typecheck ran without errors", evidence: ev };
  }
  if (c.kind === "committed" || c.kind === "pushed") {
    const runs = shellRuns(steps, upTo, c.kind === "committed" ? COMMIT_CMD : PUSH_CMD);
    const last = runs[runs.length - 1];
    if (!last) return unsupported(`no git ${c.kind === "committed" ? "commit" : "push"} ran in this session`);
    if (!last.result) return unsupported("the last run has no recorded result", evidenceOf(last));
    const text = last.result.text.replace(ANSI, "");
    const ev = evidenceOf(last, /->|rejected|error|fatal|nothing to commit|changed|create mode|\[\S+ [0-9a-f]{7}/i);
    if (last.result.isError) return { ...c, status: "CONTRADICTED", reason: `the last git ${c.kind === "committed" ? "commit" : "push"} exited with an error`, evidence: ev };
    if (c.kind === "committed" && /nothing to commit|no changes added to commit/i.test(text)) return { ...c, status: "CONTRADICTED", reason: "git reported nothing to commit", evidence: ev };
    if (c.kind === "pushed" && /\[rejected\]|\berror:|\bfatal:/i.test(text)) return { ...c, status: "CONTRADICTED", reason: "the push was rejected", evidence: ev };
    return { ...c, status: "SUPPORTED", reason: `the last git ${c.kind === "committed" ? "commit" : "push"} succeeded`, evidence: ev };
  }
  const want = c.path.replace(/\\/g, "/").replace(/^\.\//, "");
  const results = /* @__PURE__ */ new Map();
  for (let i = 0; i < upTo; i++) {
    const s = steps[i];
    if (s.kind === "tool_result") results.set(s.id, s);
  }
  for (let i = upTo - 1; i >= 0; i--) {
    const s = steps[i];
    if (s.kind !== "tool_use") continue;
    const r = results.get(s.id);
    const ok2 = r && !r.isError;
    if (EDIT_TOOLS.test(s.name)) {
      const p = String(s.input.file_path ?? s.input.path ?? "").replace(/\\/g, "/");
      if (p === want || p.endsWith(`/${want}`)) {
        const ev = { tool: s.name, excerpt: p, tool_use_id: s.id, ...s.at ? { at: s.at } : {} };
        return ok2 ? { ...c, status: "SUPPORTED", reason: `${s.name} wrote ${p}`, evidence: ev } : { ...c, status: "CONTRADICTED", reason: `${s.name} on ${p} failed`, evidence: ev };
      }
    } else if (SHELL.test(s.name) && typeof s.input.command === "string" && s.input.command.replace(/\\/g, "/").includes(want) && /(?:>|\btee\b|\bcp\b|\bmv\b|\btouch\b|writeFileSync)/.test(s.input.command) && ok2) {
      return { ...c, status: "SUPPORTED", reason: "a shell command wrote it", evidence: { tool: s.name, command: s.input.command.slice(0, 200), excerpt: want, tool_use_id: s.id, ...s.at ? { at: s.at } : {} } };
    }
  }
  return unsupported(`no tool in this session wrote ${c.path}`);
}
function checkClaims(steps, finalIndex, opts = {}) {
  let end = finalIndex ?? -1;
  if (end < 0) {
    for (let i = steps.length - 1; i >= 0; i--) if (steps[i].kind === "assistant_text") {
      end = i;
      break;
    }
  }
  if (end < 0) return { outcome: "ABSTAIN", claims: [], reasons: ["no assistant message to check"] };
  let start = end;
  while (start > 0 && steps[start - 1].kind === "assistant_text") start--;
  const texts = steps.slice(start, end + 1);
  return checkMessageClaims(texts.map((t) => t.text).join("\n"), steps, start, texts[texts.length - 1].at, opts);
}
function checkMessageClaims(text, steps, upTo = steps.length, at3, opts = {}) {
  const claims = extractClaims(text, opts).map((c) => checkOne(c, steps, upTo));
  const base = at3 ? { final_message_at: at3 } : {};
  if (!claims.length) return { outcome: "ABSTAIN", claims, ...base, reasons: ["no checkable completion claims in the final message"] };
  const contra = claims.filter((c) => c.status === "CONTRADICTED");
  const unsup = claims.filter((c) => c.status === "UNSUPPORTED");
  const reasons = [...contra, ...unsup].map((c) => `${c.status}: "${c.claim}" \u2014 ${c.reason}`);
  if (contra.length) return { outcome: "FAIL", claims, ...base, reasons };
  if (unsup.length) return { outcome: "ABSTAIN", claims, ...base, reasons };
  return { outcome: "PASS", claims, ...base, reasons: [`all ${claims.length} claim(s) are backed by this session's tool results`] };
}
function turnEnds(steps) {
  const out = [];
  let lastText = -1;
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (s.kind === "assistant_text") lastText = i;
    else if (s.kind === "user_prompt" && lastText >= 0) {
      out.push(lastText);
      lastText = -1;
    }
  }
  if (lastText >= 0) out.push(lastText);
  return out;
}
var textOf = (c) => typeof c === "string" ? c : Array.isArray(c) ? c.map((x) => x && typeof x === "object" ? typeof x.text === "string" ? x.text : "" : "").join("\n") : "";
function sessionFromClaudeCodeTranscript(jsonl) {
  const steps = [];
  for (const line3 of jsonl.split("\n")) {
    if (!line3.trim()) continue;
    let j;
    try {
      j = JSON.parse(line3);
    } catch {
      continue;
    }
    const msg = j.message ?? {};
    const at3 = typeof j.timestamp === "string" ? j.timestamp : void 0;
    const stamp = at3 ? { at: at3 } : {};
    if (j.type === "assistant" && Array.isArray(msg.content)) {
      for (const b of msg.content) {
        if (b?.type === "text" && typeof b.text === "string") steps.push({ kind: "assistant_text", text: b.text, ...typeof msg.id === "string" ? { message_id: msg.id } : {}, ...stamp });
        else if (b?.type === "tool_use" && typeof b.id === "string") steps.push({ kind: "tool_use", id: b.id, name: String(b.name ?? ""), input: b.input && typeof b.input === "object" ? b.input : {}, ...stamp });
      }
    } else if (j.type === "user") {
      const c = msg.content;
      if (Array.isArray(c) && c.some((b) => b?.type === "tool_result")) {
        for (const b of c) if (b?.type === "tool_result" && typeof b.tool_use_id === "string") steps.push({ kind: "tool_result", id: b.tool_use_id, text: textOf(b.content), isError: b.is_error === true, ...stamp });
      } else if (!j.isMeta) {
        const t = textOf(c).trim();
        if (t && !/^<(?:command-|local-command-)/.test(t)) steps.push({ kind: "user_prompt", ...stamp });
      }
    }
  }
  return steps;
}

// packages/receipts/src/claims-command.ts
function auditTurns(jsonl, opts = {}) {
  const steps = sessionFromClaudeCodeTranscript(jsonl);
  const ends = turnEnds(steps);
  const audit = { turns: ends.length, turns_with_claims: 0, outcomes: { PASS: 0, FAIL: 0, ABSTAIN: 0 }, claims: { SUPPORTED: 0, CONTRADICTED: 0, UNSUPPORTED: 0 }, flagged: [] };
  for (const i of ends) {
    const r = checkClaims(steps, i, { strict: opts.strict === true });
    if (!r.claims.length) continue;
    audit.turns_with_claims++;
    audit.outcomes[r.outcome]++;
    for (const c of r.claims) {
      audit.claims[c.status]++;
      if (c.status !== "SUPPORTED") audit.flagged.push({ ...r.final_message_at ? { at: r.final_message_at } : {}, kind: c.kind, status: c.status, claim: c.claim, reason: c.reason });
    }
  }
  return audit;
}

// packages/receipts/src/version.ts
var CHECKER_VERSION = "0.0.1";
var CHECKER_IDS = {
  decision: "riposte.receipts.gate",
  claims_check: "riposte.receipts.claims",
  done_check: "riposte.receipts.done",
  ap_gate: "riposte.receipts.ap-gate",
  model_attest: "riposte.receipts.model-attest"
};
function checkerStamp(kind) {
  return { id: CHECKER_IDS[kind], version: CHECKER_VERSION };
}
function stamped(kind, body) {
  return { ...body, checker: checkerStamp(kind) };
}

// packages/receipts/src/mcp.ts
var PROTOCOL_VERSION = "2025-06-18";
var SERVER_INFO = { name: "receipts", version: "0.0.1" };
var TOOLS = [
  {
    name: "check_done",
    description: "Call this BEFORE telling the user a task is done. State the claim in your own words and what should now be true (file/record + JSON path + expected value). Receipts reads the REAL state and returns PASS (verified), FAIL (the claim is untrue \u2014 here is what is actually there) or ABSTAIN (could not verify \u2014 do not claim done). Every result is written to a tamper-evident receipt ledger.",
    inputSchema: {
      type: "object",
      properties: {
        claim: { type: "string", description: "What you are about to tell the user you did." },
        expectations: {
          type: "array",
          items: { type: "object", properties: {
            source: { type: "string", description: "JSON file path, relative to the workspace root." },
            path: { type: "string", description: 'Dotted path inside the JSON ("" = whole file).' },
            equals: { description: "The value that should now be there." },
            exists: { type: "boolean", description: "Or: whether the path should exist." }
          }, required: ["source", "path"] }
        }
      },
      required: ["claim", "expectations"]
    }
  },
  {
    name: "ap_gate",
    description: "Before paying or holding an invoice: give your decision (approve | hold_no_po | hold_quantity | hold_price | hold_total | hold_duplicate) and the three documents. A deterministic three-way match (invoice \u2194 PO \u2194 goods receipt) recomputes it; EXECUTE only if it agrees, otherwise REVIEW (a person decides). Returns what is wrong and where, and writes a receipt.",
    inputSchema: {
      type: "object",
      properties: {
        decision: { type: "string" },
        invoice: { type: "string" },
        purchase_order: { type: "string" },
        goods_receipt: { type: "string" },
        layout: { type: "string", description: "Or all three in one text with the ERP section markers." }
      },
      required: ["decision"]
    }
  },
  {
    name: "model_attest",
    description: 'Attest which model ACTUALLY answered, reply by reply, from what the host recorded (never from what a model says about itself). Give a Claude Code transcript (JSONL, path relative to the workspace root) or a list of API replies, plus the declared model id. PASS = every reply came from the declared model and no switch was silent; FAIL = a reply came from another model or the model changed with nothing announcing it; ABSTAIN = nothing to attest (no model recorded, or the declared id is a floating alias like "opus"). Every switch is listed. Writes a receipt.',
    inputSchema: {
      type: "object",
      properties: {
        transcript: { type: "string", description: "Claude Code session transcript (.jsonl), relative to the workspace root." },
        replies: { type: "array", items: { type: "object", properties: { model: { type: "string" }, created_at: { type: "string" }, id: { type: "string" } } }, description: "Or: API replies in order, each with the `model` the provider returned." },
        declared: { type: "string", description: "The exact model id the run was declared to use." },
        allowed: { type: "array", items: { type: "string" }, description: "Or: every acceptable exact model id." },
        fail_on_silent_switch: { type: "boolean", description: "FAIL on an unannounced model change (default true)." }
      }
    }
  },
  {
    name: "check_claims",
    description: 'Check the completion claims in a session\'s final message ("all tests pass", "the build is clean", "committed", "pushed", "created `x`") against what the session\'s own tools actually returned. Give a Claude Code transcript (JSONL, path relative to the workspace root). PASS = every claim is backed by the latest relevant tool result; FAIL = a claim is contradicted (a failing test run, a rejected push, a different count); ABSTAIN = a claim has no backing (never ran, ran before a later code edit) or there is nothing checkable. Set all_turns to audit every turn. Writes a receipt.',
    inputSchema: {
      type: "object",
      properties: {
        transcript: { type: "string", description: "Claude Code session transcript (.jsonl), relative to the workspace root." },
        all_turns: { type: "boolean", description: "Audit every turn-ending message instead of only the final one." }
      },
      required: ["transcript"]
    }
  },
  {
    name: "ledger_verify",
    description: "Verify the entire receipt ledger: every entry chained to the previous one, and (if signed) signed. Anyone can run this, with no trust in us. A chain alone cannot detect a whole-file rewrite, so pin a trust anchor: the expected public key, require_signed, and/or a head hash recorded earlier. Reports who signed (key fingerprints).",
    inputSchema: {
      type: "object",
      properties: {
        public_key: { type: "string", description: "PEM (SPKI) of the only key allowed to have signed entries." },
        require_signed: { type: "boolean", description: "Fail on any unsigned entry." },
        head: { type: "string", description: "A hash recorded earlier; the chain must still contain it." }
      }
    }
  }
];
function rootedPath(base, source) {
  if (isAbsolute(source)) throw new Error("absolute paths are not allowed; use a path relative to the workspace root");
  const full = resolve(base, source);
  const rel = relative(base, full);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("path escapes the workspace root");
  return full;
}
function rootedJsonReader(root2) {
  const base = resolve(root2);
  return (source) => JSON.parse(readFileSync(rootedPath(base, source), "utf8"));
}
function rootedTextReader(root2) {
  const base = resolve(root2);
  return (source) => readFileSync(rootedPath(base, source), "utf8");
}
var isObj10 = (x) => typeof x === "object" && x !== null && !Array.isArray(x);
var toolResult = (structured) => ({ content: [{ type: "text", text: JSON.stringify(structured, null, 2) }], structuredContent: structured, isError: false });
function callTool(name, args, deps2) {
  if (!isObj10(args)) throw new Error("tool arguments must be an object");
  if (name === "check_done") {
    if (typeof args.claim !== "string" || !Array.isArray(args.expectations)) throw new Error('check_done requires "claim" and "expectations"');
    const r = checkDone({ claim: args.claim, expectations: args.expectations }, deps2.read);
    const entry = deps2.ledger.append("done_check", stamped("done_check", r));
    return toolResult({ ...r, receipt: { seq: entry.seq, hash: entry.hash, signed: Boolean(entry.signature) } });
  }
  if (name === "ap_gate") {
    if (typeof args.decision !== "string") throw new Error('ap_gate requires "decision"');
    const docs = typeof args.layout === "string" ? splitApLayout(args.layout) : typeof args.invoice === "string" && typeof args.purchase_order === "string" && typeof args.goods_receipt === "string" ? { invoice: args.invoice, purchase_order: args.purchase_order, goods_receipt: args.goods_receipt } : null;
    if (!docs) throw new Error("ap_gate requires {invoice, purchase_order, goods_receipt} or {layout}");
    const g = apGate(args.decision, docs);
    const draft = g.check.decision !== "approve" ? draftResolution(g.check, docs) : void 0;
    const summary = {
      action: g.action,
      effect: g.effect,
      model_decision: g.model_decision,
      checker_decision: g.checker_decision,
      reason: g.reason,
      grounding: g.check.grounding,
      verdict_id: g.check.verdict.verdict_id,
      ...draft ? { resolution: { kind: draft.kind, subject: draft.subject, body: draft.body, ...draft.short_pay ? { short_pay: draft.short_pay } : {}, facts: draft.facts } } : {}
    };
    const entry = deps2.ledger.append("ap_gate", stamped("ap_gate", summary));
    return toolResult({ ...summary, receipt: { seq: entry.seq, hash: entry.hash, signed: Boolean(entry.signature) } });
  }
  if (name === "model_attest") {
    let events;
    let source;
    if (typeof args.transcript === "string") {
      if (!deps2.readText) throw new Error("this server cannot read transcripts (no text reader configured)");
      events = eventsFromClaudeCodeTranscript(deps2.readText(args.transcript));
      source = `transcript:${args.transcript}`;
    } else if (Array.isArray(args.replies)) {
      events = eventsFromReplies(args.replies);
      source = "replies";
    } else throw new Error('model_attest requires "transcript" or "replies"');
    const policy = {};
    if (typeof args.declared === "string") policy.declared = args.declared;
    if (Array.isArray(args.allowed)) policy.allowed = args.allowed.filter((x) => typeof x === "string");
    if (typeof args.fail_on_silent_switch === "boolean") policy.failOnSilentSwitch = args.fail_on_silent_switch;
    const a = attestModels(events, policy);
    const entry = deps2.ledger.append("model_attest", stamped("model_attest", { source, ...a }));
    return toolResult({ ...a, receipt: { seq: entry.seq, hash: entry.hash, signed: Boolean(entry.signature) } });
  }
  if (name === "check_claims") {
    if (typeof args.transcript !== "string") throw new Error('check_claims requires "transcript"');
    if (!deps2.readText) throw new Error("this server cannot read transcripts (no text reader configured)");
    const text = deps2.readText(args.transcript);
    const source = `transcript:${args.transcript}`;
    if (args.all_turns === true) {
      const a = auditTurns(text);
      const entry2 = deps2.ledger.append("claims_check", stamped("claims_check", { source, all_turns: true, ...a }));
      return toolResult({ ...a, receipt: { seq: entry2.seq, hash: entry2.hash, signed: Boolean(entry2.signature) } });
    }
    const r = checkClaims(sessionFromClaudeCodeTranscript(text));
    const entry = deps2.ledger.append("claims_check", stamped("claims_check", { source, ...r }));
    return toolResult({ ...r, receipt: { seq: entry.seq, hash: entry.hash, signed: Boolean(entry.signature) } });
  }
  if (name === "ledger_verify") {
    const policy = {};
    if (typeof args.public_key === "string") policy.publicKey = args.public_key;
    if (args.require_signed === true) policy.requireSigned = true;
    if (typeof args.head === "string") policy.head = args.head;
    return toolResult(deps2.ledger.verify(policy));
  }
  throw new Error(`unknown tool: ${name}`);
}
function handleRequest(req, deps2) {
  const id = req.id ?? null;
  if (req.id === void 0 || req.method.startsWith("notifications/")) return null;
  try {
    switch (req.method) {
      case "initialize":
        return { jsonrpc: "2.0", id, result: { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO } };
      case "tools/list":
        return { jsonrpc: "2.0", id, result: { tools: TOOLS } };
      case "tools/call": {
        const p = isObj10(req.params) ? req.params : {};
        return { jsonrpc: "2.0", id, result: callTool(String(p.name), p.arguments ?? {}, deps2) };
      }
      case "ping":
        return { jsonrpc: "2.0", id, result: {} };
      default:
        return { jsonrpc: "2.0", id, error: { code: -32601, message: `method not found: ${req.method}` } };
    }
  } catch (e) {
    return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: e.message }], isError: true } };
  }
}

// packages/receipts/src/file-store.ts
import { appendFileSync, existsSync, readFileSync as readFileSync2, mkdirSync } from "node:fs";
import { dirname } from "node:path";
function fileStore(path) {
  return {
    load: () => existsSync(path) ? readFileSync2(path, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [],
    append: (e) => {
      mkdirSync(dirname(path), { recursive: true });
      appendFileSync(path, JSON.stringify(e) + "\n");
    }
  };
}

// packages/receipts/src/stdio.ts
var root = process.env.RECEIPTS_ROOT ?? process.cwd();
var ledgerPath = process.env.RECEIPTS_LEDGER ?? join(root, "receipts.jsonl");
var signingKey = process.env.RECEIPTS_KEY ? readFileSync3(process.env.RECEIPTS_KEY, "utf8") : void 0;
var deps = { ledger: openLedger(fileStore(ledgerPath), signingKey ? { signingKey } : {}), read: rootedJsonReader(root), readText: rootedTextReader(root) };
var rl = createInterface({ input: process.stdin });
rl.on("line", (line3) => {
  if (!line3.trim()) return;
  let res;
  try {
    res = handleRequest(JSON.parse(line3), deps);
  } catch {
    res = { jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } };
  }
  if (res) process.stdout.write(JSON.stringify(res) + "\n");
});
