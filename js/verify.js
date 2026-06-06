// Pure verification scanners. No DOM, no globals.
//   scanBalance         — bracket/quote balance with string- and comment-awareness
//   scanCleanupResidue  — flags smart-quote / em-dash residue after cleanup
//   findConfusables     — index-based Unicode confusable scan (used by review view too)
//   scanHomoglyphs      — context-aware ASCII confusable scan (0/O, 1/l/I) + Unicode

export const UNICODE_CONFUSABLES = {
  // Cyrillic lowercase → Latin
  'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'х': 'x', 'у': 'y',
  'і': 'i', 'ј': 'j', 'ѕ': 's', 'ԁ': 'd', 'һ': 'h',
  // Cyrillic uppercase → Latin
  'А': 'A', 'В': 'B', 'Е': 'E', 'К': 'K', 'М': 'M',
  'Н': 'H', 'О': 'O', 'Р': 'P', 'С': 'C', 'Т': 'T', 'Х': 'X',
  'Ѕ': 'S', 'Ј': 'J', 'І': 'I',
  // Greek lowercase → Latin
  'α': 'a', 'ο': 'o', 'ρ': 'p', 'ν': 'v',
  // Greek uppercase → Latin
  'Α': 'A', 'Β': 'B', 'Ε': 'E', 'Η': 'H', 'Ι': 'I', 'Κ': 'K',
  'Μ': 'M', 'Ν': 'N', 'Ο': 'O', 'Ρ': 'P', 'Τ': 'T', 'Υ': 'Y',
  'Χ': 'X', 'Ζ': 'Z',
};

/**
 * Walk text and emit structured Warning objects for bracket / quote balance
 * problems. Respects string literals (single, double, backtick) and line /
 * block comments so braces inside them don't count.
 */
export function scanBalance(text) {
  const stack = [];
  const warns = [];
  let line = 1, col = 1;
  let inStr = null;
  let lineCm = false, blockCm = false, escaped = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const n = text[i + 1];

    if (c === '\n') { line++; col = 1; lineCm = false; continue; }
    if (escaped)    { escaped = false; col++; continue; }
    if (lineCm)     { col++; continue; }
    if (blockCm) {
      if (c === '*' && n === '/') { blockCm = false; col += 2; i++; continue; }
      col++; continue;
    }
    if (inStr) {
      if (c === '\\') { escaped = true; col++; continue; }
      if (c === inStr.ch) { inStr = null; col++; continue; }
      col++; continue;
    }
    if (c === '/' && n === '/') { lineCm  = true; col += 2; i++; continue; }
    if (c === '/' && n === '*') { blockCm = true; col += 2; i++; continue; }
    if (c === '"' || c === "'" || c === '`') {
      inStr = { ch: c, line, col }; col++; continue;
    }
    if (c === '(' || c === '[' || c === '{') {
      stack.push({ ch: c, line, col });
    } else if (c === ')' || c === ']' || c === '}') {
      const expected = c === ')' ? '(' : c === ']' ? '[' : '{';
      const top = stack[stack.length - 1];
      if (!top) {
        warns.push({
          severity: 'error', code: 'extra-close', source: 'balance',
          message: `Extra '${c}' with no matching opener`,
          position: { line, col, length: 1 },
        });
      } else if (top.ch !== expected) {
        warns.push({
          severity: 'error', code: 'mismatch', source: 'balance',
          message: `'${c}' does not match '${top.ch}' opened earlier`,
          position: { line, col, length: 1 },
          related: { line: top.line, col: top.col },
        });
        stack.pop();
      } else {
        stack.pop();
      }
    }
    col++;
  }

  if (inStr) {
    warns.push({
      severity: 'warn', code: 'unterminated-string', source: 'balance',
      message: `Unterminated ${inStr.ch === '`' ? 'template' : 'string'} literal opened with ${inStr.ch}`,
      position: { line: inStr.line, col: inStr.col, length: 1 },
    });
  }
  for (const top of stack) {
    warns.push({
      severity: 'warn', code: 'unclosed', source: 'balance',
      message: `Unclosed '${top.ch}'`,
      position: { line: top.line, col: top.col, length: 1 },
    });
  }
  return warns;
}

/**
 * Heuristic detector for "Python indentation has been flattened" — usually
 * because OCR lost the leading whitespace. Fires when:
 *   - lang is 'python'
 *   - at least 2 lines end with ':' (block headers)
 *   - the next non-empty line after each such header has no leading whitespace
 *
 * This is independent of OCR confidence: text can be 95% recognized and
 * still semantically broken if indentation was lost. Returns a Warning[].
 *
 * NOT a fixer — Python indent recovery requires either syntactic awareness
 * or visual layout from the OCR bounding boxes. Both are out of scope here.
 */
export function scanPythonIndentLoss(text, lang) {
  if (lang !== 'python') return [];
  const lines = text.split('\n');
  let suspicious = 0;
  for (let i = 0; i < lines.length - 1; i++) {
    const line = lines[i];
    const stripped = line.replace(/\s+$/, '');
    if (!stripped.endsWith(':')) continue;
    // Skip lines that are obviously comments
    if (stripped.trim().startsWith('#')) continue;
    // Find next non-empty line
    let j = i + 1;
    while (j < lines.length && lines[j].trim().length === 0) j++;
    if (j >= lines.length) continue;
    if (!/^\s/.test(lines[j])) suspicious++;
  }
  if (suspicious < 2) return [];
  return [{
    severity: 'warn',
    code: 'python-indent-loss',
    source: 'cleanup',
    message:
      'Python indentation may be lost. Brace repair does not support whitespace-sensitive ' +
      'languages — verify the indentation manually before running this code.',
  }];
}

/**
 * Cleanup residue: things the normalize pass should have caught but didn't,
 * usually because the user turned the toggle off. Information-only warnings.
 */
export function scanCleanupResidue(text) {
  const warns = [];
  if (/[‘’“”]/.test(text)) {
    warns.push({
      severity: 'info', code: 'smart-quote-residue', source: 'cleanup',
      message: 'Smart quotes still present — toggle "Normalize chars" or edit manually',
    });
  }
  if (/[–—]/.test(text)) {
    warns.push({
      severity: 'info', code: 'dash-residue', source: 'cleanup',
      message: 'En/em dashes still present — usually `-` in code',
    });
  }
  return warns;
}

/**
 * Returns Unicode confusables in `text` as { idx, char, suggestion }.
 * Operates on a single string (a word or a full text), agnostic to context.
 * The review view uses this per-word; tests use it on full text.
 */
export function findConfusables(text) {
  const out = [];
  for (let i = 0; i < text.length; i++) {
    const suggestion = UNICODE_CONFUSABLES[text[i]];
    if (suggestion) out.push({ idx: i, char: text[i], suggestion });
  }
  return out;
}

// ----------------------------------------------------------------------
//  scanHomoglyphs: context-aware ASCII confusable detection
// ----------------------------------------------------------------------
const IDENT_RE  = /[A-Za-z0-9_$]/;
const ALPHA_RE  = /[A-Za-z_$]/;
const DIGIT_RE  = /[0-9]/;

// Whitelisted number-literal patterns. Stops `0xdeadbeef`, `1e10`, `1.5`,
// `100` from producing false positives inside the identifier-context scan.
const NUM_LIT_RE = /\b(0[xX][0-9a-fA-F]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\b/g;

function findNumberLiteralRanges(text) {
  const ranges = [];
  NUM_LIT_RE.lastIndex = 0;
  let m;
  while ((m = NUM_LIT_RE.exec(text)) !== null) {
    ranges.push([m.index, m.index + m[0].length]);
  }
  return ranges;
}

function isInsideRange(ranges, offset) {
  for (const [start, end] of ranges) {
    if (offset >= start && offset < end) return true;
  }
  return false;
}

/**
 * Walks the text and flags ASCII characters that are likely OCR confusions:
 *   - 0 ↔ O   when adjacent to the opposite category (digit ↔ letter)
 *   - 1 ↔ l/I when adjacent to the opposite category
 *
 * Gate: at least one neighbor must be an identifier character (so the suspect
 * is part of some multi-char identifier-shaped run). This is loose enough to
 * catch `O` at the end of `8O8O` but does also flag legitimate names ending
 * in a digit like `var1`. Accepted false-positive — the warning is informational.
 *
 * Also flags any Unicode confusable from `UNICODE_CONFUSABLES`, regardless
 * of context (rare and unambiguously suspicious).
 *
 * Skips string literals, line comments, block comments, and whole-token
 * number literals (hex, scientific, decimal). Tracks 1-based line/column.
 */
export function scanHomoglyphs(text) {
  const flags = [];
  const numLitRanges = findNumberLiteralRanges(text);

  let inStr = null, inLineCm = false, inBlockCm = false, escaped = false;
  let line = 1, col = 1;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const n = text[i + 1];

    if (c === '\n') { line++; col = 1; inLineCm = false; continue; }
    if (escaped)    { escaped = false; col++; continue; }
    if (inLineCm)   { col++; continue; }
    if (inBlockCm) {
      if (c === '*' && n === '/') { inBlockCm = false; col += 2; i++; continue; }
      col++; continue;
    }
    if (inStr) {
      if (c === '\\') { escaped = true; col++; continue; }
      if (c === inStr) inStr = null;
      col++; continue;
    }
    if (c === '/' && n === '/') { inLineCm  = true; col += 2; i++; continue; }
    if (c === '/' && n === '*') { inBlockCm = true; col += 2; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = c; col++; continue; }

    // Unicode confusables always fire (rare and unambiguously suspicious)
    const uniSug = UNICODE_CONFUSABLES[c];
    if (uniSug) {
      flags.push({
        offset: i, line, col, char: c, suggestion: uniSug,
        code: 'unicode-confusable',
        reason: `Unicode confusable for Latin '${uniSug}'`,
      });
      col++;
      continue;
    }

    // ASCII checks skip whole-token number literals
    if (isInsideRange(numLitRanges, i)) { col++; continue; }

    const prev = i > 0 ? text[i - 1] : '';
    const next = n || '';
    const inIdentRun = IDENT_RE.test(prev) || IDENT_RE.test(next);

    if (inIdentRun) {
      if (c === '0' && (ALPHA_RE.test(prev) || ALPHA_RE.test(next))) {
        flags.push({
          offset: i, line, col, char: c, suggestion: 'O',
          code: 'zero-or-oh',
          reason: "'0' (zero) adjacent to a letter — likely 'O'",
        });
      } else if (c === 'O' && (DIGIT_RE.test(prev) || DIGIT_RE.test(next))) {
        flags.push({
          offset: i, line, col, char: c, suggestion: '0',
          code: 'oh-or-zero',
          reason: "'O' (letter) adjacent to a digit — likely '0'",
        });
      } else if (c === '1' && (ALPHA_RE.test(prev) || ALPHA_RE.test(next))) {
        flags.push({
          offset: i, line, col, char: c, suggestion: 'l',
          code: 'one-or-ell',
          reason: "'1' (one) adjacent to a letter — likely 'l' or 'I'",
        });
      } else if ((c === 'l' || c === 'I') && (DIGIT_RE.test(prev) || DIGIT_RE.test(next))) {
        flags.push({
          offset: i, line, col, char: c, suggestion: '1',
          code: 'ell-or-one',
          reason: `'${c}' adjacent to a digit — likely '1'`,
        });
      }
    }

    col++;
  }

  return flags;
}
