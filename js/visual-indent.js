// Visual indent recovery for whitespace-sensitive languages (Python first).
//
// IMPORTANT: this module does NOT guess indentation from Python syntax. It
// reconstructs indentation from the x-coordinates of OCR word bounding boxes,
// which is independent of language semantics. Result is a PROPOSAL — never
// applied silently. The caller is responsible for the preview-and-confirm UX.

/**
 * @typedef {Object} Word
 * @property {string} text
 * @property {number} [confidence]
 * @property {{x0:number,y0:number,x1:number,y1:number}} [bbox]
 */

/**
 * @typedef {Object} VisualLine
 * @property {Word[]} words
 * @property {number} y0
 * @property {number} y1
 * @property {number} firstX
 * @property {string} text
 */

/**
 * @typedef {Object} ProposedLine
 * @property {string} original
 * @property {string} proposed
 * @property {number} indentLevel
 * @property {number} leadingSpaces
 * @property {number} confidence
 * @property {string} [reason]
 */

/**
 * @typedef {Object} IndentProposal
 * @property {string} text
 * @property {ProposedLine[]} lines
 * @property {Array<object>} warnings
 * @property {{baseX:number, charWidth:number, indentUnit:number, lineCount:number, uncertainLineCount:number}} metrics
 */

const DEFAULT_INDENT_UNIT = 4;

/**
 * Group OCR words into visual lines using y-center proximity. Robust to
 * the words arriving in any order; output is sorted top-to-bottom and each
 * line's words are sorted left-to-right.
 *
 * Two words are on the same line if the absolute difference between their
 * y-centers is less than half the larger of their heights. This handles
 * minor baseline jitter without merging adjacent lines.
 */
export function groupWordsIntoVisualLines(words) {
  if (!Array.isArray(words) || !words.length) return [];

  // Pre-sort by y0 then x0 so adjacent words naturally come together
  const sorted = words.slice().sort((a, b) => {
    const ay = a.bbox?.y0 ?? 0;
    const by = b.bbox?.y0 ?? 0;
    if (Math.abs(ay - by) > 4) return ay - by;
    return (a.bbox?.x0 ?? 0) - (b.bbox?.x0 ?? 0);
  });

  /** @type {VisualLine[]} */
  const lines = [];

  for (const w of sorted) {
    const bbox = w.bbox || { x0: 0, y0: 0, x1: 0, y1: 0 };
    const yCenter = (bbox.y0 + bbox.y1) / 2;
    const height = Math.max(1, bbox.y1 - bbox.y0);

    // Find an existing line whose y-center is within tolerance
    let matched = null;
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      const lineCenter = (line.y0 + line.y1) / 2;
      const lineHeight = Math.max(1, line.y1 - line.y0);
      const tol = Math.max(lineHeight, height) * 0.5;
      if (Math.abs(yCenter - lineCenter) <= tol) {
        matched = line;
        break;
      }
      // Sorted by y0 — once we're past the tolerance window, stop walking back
      if (lineCenter < yCenter - tol * 2) break;
    }

    if (matched) {
      matched.words.push(w);
      matched.y0 = Math.min(matched.y0, bbox.y0);
      matched.y1 = Math.max(matched.y1, bbox.y1);
    } else {
      lines.push({ words: [w], y0: bbox.y0, y1: bbox.y1, firstX: bbox.x0, text: '' });
    }
  }

  // Sort each line by x0 and derive firstX/text
  for (const line of lines) {
    line.words.sort((a, b) => (a.bbox?.x0 ?? 0) - (b.bbox?.x0 ?? 0));
    line.firstX = line.words[0].bbox?.x0 ?? 0;
    line.text = line.words.map(w => w.text).join(' ');
  }

  // Sort lines top-to-bottom
  lines.sort((a, b) => a.y0 - b.y0);
  return lines;
}

/**
 * Robust left-margin estimate. Takes the 10th percentile of firstX values so
 * one stray indented top line doesn't push the base.
 */
export function estimateBaseX(lines) {
  if (!lines.length) return 0;
  const xs = lines.map(l => l.firstX).slice().sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(xs.length - 1, Math.floor(xs.length * 0.1)));
  return xs[idx];
}

/**
 * Median of (word_width / text_length) across confident multi-char tokens.
 * Skips short tokens (length < 3) and low-confidence words (<50%).
 * Returns 0 when no samples qualify — the caller must treat this as a failure.
 */
export function estimateCharWidth(lines) {
  /** @type {number[]} */
  const samples = [];
  for (const line of lines) {
    for (const w of line.words) {
      if (!w.bbox || !w.text) continue;
      const len = w.text.length;
      if (len < 3) continue;
      if ((w.confidence ?? 100) < 50) continue;
      const width = w.bbox.x1 - w.bbox.x0;
      if (width <= 0) continue;
      samples.push(width / len);
    }
  }
  if (!samples.length) return 0;
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)];
}

/**
 * Convert one visual line's firstX into an indent level + a 0..100 confidence
 * score based on how close the raw offset is to a clean indent-unit multiple.
 */
function computeIndent(line, baseX, charWidth, indentUnit) {
  if (charWidth <= 0) return { indentLevel: 0, leadingSpaces: 0, confidence: 0, reason: 'no character width estimate' };

  const offsetPx = Math.max(0, line.firstX - baseX);
  const rawSpaces = offsetPx / charWidth;
  const normalized = rawSpaces / indentUnit;
  const indentLevel = Math.max(0, Math.round(normalized));
  const leadingSpaces = indentLevel * indentUnit;

  // distance from the nearest integer indent level (0..0.5)
  const distFromInt = Math.abs(normalized - indentLevel);
  // 0 -> 100% confidence, 0.5 -> 0%
  const confidence = Math.max(0, Math.min(100, 100 * (1 - distFromInt / 0.5)));

  let reason;
  if (confidence < 50) {
    reason = `x-offset ${offsetPx.toFixed(1)}px ≈ ${rawSpaces.toFixed(2)} chars, ambiguous between indent levels`;
  }
  return { indentLevel, leadingSpaces, confidence, reason };
}

/**
 * Walks rawText line by line and pairs each non-empty line with the next
 * visual line (in order). Empty lines are preserved as empty without
 * consuming a visual line. Visual lines without a matching raw line are
 * appended at the end (rare; only happens if cleanup added blank lines).
 */
function buildProposedLines(rawText, visualLines, baseX, charWidth, indentUnit) {
  const rawLines = (rawText || '').split('\n');
  const indentInfo = visualLines.map(l => ({
    line: l,
    ...computeIndent(l, baseX, charWidth, indentUnit),
  }));

  /** @type {ProposedLine[]} */
  const out = [];
  let vi = 0;
  let uncertainLineCount = 0;

  for (const original of rawLines) {
    if (original.trim().length === 0) {
      // Preserve blanks; do not consume a visual line
      out.push({ original, proposed: '', indentLevel: 0, leadingSpaces: 0, confidence: 100 });
      continue;
    }
    if (vi >= indentInfo.length) {
      // Out of visual lines — keep the original line untouched
      out.push({
        original, proposed: original, indentLevel: 0, leadingSpaces: 0, confidence: 0,
        reason: 'no matching visual line for this row',
      });
      continue;
    }
    const info = indentInfo[vi++];
    const stripped = original.replace(/^[ \t]+/, '');
    const proposed = ' '.repeat(info.leadingSpaces) + stripped;
    if (info.confidence < 50) uncertainLineCount++;
    out.push({
      original,
      proposed,
      indentLevel: info.indentLevel,
      leadingSpaces: info.leadingSpaces,
      confidence: Math.round(info.confidence),
      reason: info.reason,
    });
  }

  return { proposedLines: out, uncertainLineCount };
}

/**
 * Main entry. Returns an IndentProposal with proposed text and per-line detail,
 * a warnings array (may be empty), and metrics that drove the decisions.
 *
 * The caller is responsible for showing a diff and getting explicit user consent
 * before applying `proposal.text` anywhere.
 */
export function proposeVisualIndentation({ words, rawText, language, indentUnit } = {}) {
  const unit = Number.isInteger(indentUnit) && indentUnit > 0 ? indentUnit : DEFAULT_INDENT_UNIT;
  const visualLines = groupWordsIntoVisualLines(words || []);
  const warnings = [];

  if (visualLines.length < 2) {
    warnings.push({
      severity: 'warn', code: 'visual-indent-insufficient-lines', source: 'visual-indent',
      message: 'Too few visual lines to infer indentation reliably.',
    });
  }

  const baseX = estimateBaseX(visualLines);
  const charWidth = estimateCharWidth(visualLines);

  if (charWidth <= 0) {
    warnings.push({
      severity: 'warn', code: 'visual-indent-no-char-width', source: 'visual-indent',
      message: 'Could not estimate a character width — too few confident multi-char word samples or missing bounding boxes.',
    });
  }

  const { proposedLines, uncertainLineCount } =
    buildProposedLines(rawText, visualLines, baseX, charWidth, unit);

  const metrics = {
    baseX, charWidth, indentUnit: unit,
    lineCount: visualLines.length,
    uncertainLineCount,
  };

  const proposal = {
    text: proposedLines.map(l => l.proposed).join('\n'),
    lines: proposedLines,
    warnings,
    metrics,
  };

  // Run extra structural validation (Python-specific colon checks, jump checks)
  proposal.warnings.push(...validateIndentProposal(proposal, language));
  return proposal;
}

/**
 * Extra checks layered on top of a built proposal:
 *   - too few visual lines → info
 *   - >=30% of lines uncertain → warn
 *   - implausible level jumps (>2 in one step) → warn
 *   - Python: colon-terminated line followed by same-or-shallower indent → warn
 */
export function validateIndentProposal(proposal, language) {
  const warnings = [];
  const { metrics, lines } = proposal;

  if (metrics.lineCount < 3) {
    warnings.push({
      severity: 'info', code: 'visual-indent-thin', source: 'visual-indent',
      message: 'Only a handful of visual lines available; the proposal may be unreliable.',
    });
  }

  const uncertainThreshold = Math.max(2, Math.floor(metrics.lineCount * 0.3));
  if (metrics.uncertainLineCount >= uncertainThreshold) {
    warnings.push({
      severity: 'warn', code: 'visual-indent-uncertain', source: 'visual-indent',
      message: `${metrics.uncertainLineCount} of ${metrics.lineCount} lines had ambiguous x-offsets — verify per-line confidence in the diff before applying.`,
    });
  }

  // Implausible jumps (e.g., from level 0 to level 5 in one step)
  let jumpHits = 0;
  let prevLevel = null;
  for (const ln of lines) {
    if (ln.original.trim().length === 0) continue;
    if (prevLevel !== null && Math.abs(ln.indentLevel - prevLevel) > 2) jumpHits++;
    prevLevel = ln.indentLevel;
  }
  if (jumpHits >= 2) {
    warnings.push({
      severity: 'warn', code: 'visual-indent-jumpy', source: 'visual-indent',
      message: `Detected ${jumpHits} suspiciously large indent jumps (>2 levels) — proposal may be wrong.`,
    });
  }

  if (language === 'python') {
    let colonLines = 0;
    let suspicious = 0;
    for (let i = 0; i < lines.length - 1; i++) {
      const cur = lines[i];
      const stripped = cur.original.trim();
      if (!stripped.endsWith(':')) continue;
      if (stripped.startsWith('#')) continue;
      colonLines++;
      let j = i + 1;
      while (j < lines.length && lines[j].original.trim().length === 0) j++;
      if (j >= lines.length) break;
      const next = lines[j];
      if (next.leadingSpaces <= cur.leadingSpaces) suspicious++;
    }
    if (colonLines >= 2 && suspicious >= 2) {
      warnings.push({
        severity: 'warn', code: 'visual-indent-colon-no-deeper', source: 'visual-indent',
        message: `${suspicious} of ${colonLines} colon-terminated lines were followed by same-or-shallower indent — proposal may still be wrong.`,
      });
    }
  }

  return warnings;
}
