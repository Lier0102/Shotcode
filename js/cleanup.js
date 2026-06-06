// Pure cleanup functions. No DOM, no globals.
// Imported by both app.js (production) and tests/cases.js (regression tests).

/**
 * Replace look-alike Unicode characters that Tesseract loves to insert
 * with their ASCII equivalents.
 */
export function normalizeChars(text) {
  let out = text;
  // Curly / smart quotes
  out = out.replace(/[‘’‚‛′]/g, "'");
  out = out.replace(/[“”„‟″]/g, '"');
  // En / em / minus dashes
  out = out.replace(/[–—−]/g, '-');
  // Ellipsis
  out = out.replace(/…/g, '...');
  // Non-breaking space
  out = out.replace(/ /g, ' ');
  // Zero-width characters (ZWSP, ZWNJ, ZWJ, BOM)
  out = out.replace(/[​-‍﻿]/g, '');
  // Form feed
  out = out.replace(/\f/g, '');
  // Common ligatures
  out = out.replace(/ﬀ/g, 'ff').replace(/ﬁ/g, 'fi').replace(/ﬂ/g, 'fl');
  return out;
}

/**
 * Strip leading line numbers if most non-empty lines begin with one.
 * Requires:
 *   - at least 3 non-empty lines
 *   - >=60% of non-empty lines match the leading-number pattern
 *   - separator after the digit followed by additional whitespace
 *     (avoids stripping decimals like `1.5 const` and false positives like `1const`)
 */
export function stripLineNumbers(text) {
  const lines = text.split('\n');
  const nonEmpty = lines.filter(l => l.trim().length > 0);
  if (nonEmpty.length < 3) return text;
  const re = /^\s*\d{1,5}[\s:|.\)]\s+/;
  const matched = nonEmpty.filter(l => re.test(l)).length;
  if (matched < Math.max(3, nonEmpty.length * 0.6)) return text;
  return lines.map(l => l.replace(re, '')).join('\n');
}

/**
 * Strip Python REPL, IPython, or shell prompts — whichever dominates.
 * Safety: a bare `# ` is treated as a shell prompt ONLY when the language
 * is explicitly shell/bash. Otherwise `# foo` is a Python/Ruby/JS comment
 * and must be preserved.
 *
 * Auto-detects from line content but respects an explicit `lang` hint.
 */
export function stripPrompts(text, lang) {
  const lines = text.split('\n');
  const pyRe = /^\s*(>>>|\.\.\.) ?/;
  const ipyInRe = /^\s*In ?\[\d+\]:\s?/;
  const ipyOutRe = /^\s*Out ?\[\d+\]:\s?/;
  const shDollarRe = /^\s*\$ /;
  const shHashRe = /^\s*# /;

  let py = 0, ipy = 0, shD = 0;
  for (const l of lines) {
    if (pyRe.test(l)) py++;
    if (ipyInRe.test(l) || ipyOutRe.test(l)) ipy++;
    if (shDollarRe.test(l)) shD++;
  }

  const favorsPy = lang === 'python';
  const favorsSh = lang === 'bash' || lang === 'shell';

  if ((py >= 2 || favorsPy) && py >= shD) {
    return lines.map(l => l.replace(pyRe, '')).join('\n');
  }
  if (ipy >= 2 || (favorsPy && ipy >= 1)) {
    return lines.map(l => l.replace(ipyInRe, '').replace(ipyOutRe, '')).join('\n');
  }
  if (shD >= 2 || favorsSh) {
    return lines.map(l => {
      let out = l.replace(shDollarRe, '');
      // Only strip leading `# ` when we know the source is shell — otherwise
      // those are likely Python / Ruby / JS comments.
      if (favorsSh) out = out.replace(shHashRe, '');
      return out;
    }).join('\n');
  }
  return text;
}

/**
 * Tabs → 4 spaces, then strip the common leading-whitespace prefix from
 * non-empty lines. Lossy: useful when the OCR captured a uniformly-indented
 * snippet but the absolute column is meaningless.
 */
export function normalizeIndent(text) {
  let out = text.replace(/\t/g, '    ');
  const lines = out.split('\n');
  const nonEmpty = lines.filter(l => l.trim().length > 0);
  if (!nonEmpty.length) return out;
  let minLead = Infinity;
  for (const l of nonEmpty) {
    const m = l.match(/^( *)/);
    if (m) minLead = Math.min(minLead, m[1].length);
  }
  if (minLead > 0 && minLead !== Infinity) {
    const prefix = ' '.repeat(minLead);
    out = lines.map(l => l.startsWith(prefix) ? l.slice(minLead) : l).join('\n');
  }
  return out;
}

/**
 * Final whitespace pass: trim trailing space per line, collapse 3+ blank
 * lines, strip leading/trailing blank lines, ensure single trailing newline.
 */
export function finalTrim(text) {
  let out = text.split('\n').map(l => l.replace(/[ \t]+$/, '')).join('\n');
  out = out.replace(/\n{3,}/g, '\n\n');
  out = out.replace(/^\s*\n+/, '').replace(/\s+$/, '\n');
  return out;
}
