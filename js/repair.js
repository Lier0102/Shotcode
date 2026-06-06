// Pure brace-walk re-indenter. No DOM, no globals.

/**
 * Languages whose block structure is fully determined by paired brackets
 * ({ } [ ] ( )). Whitespace-sensitive languages — Python, YAML, Makefile,
 * Haskell, F#, etc. — are deliberately excluded: a brace walk on their
 * code would silently flatten or mangle indentation.
 *
 * The value `'auto'` is excluded because we don't know the language until
 * after highlight.js detects it, which happens *after* the cleanup pipeline
 * runs. Treat auto as "not brace" to avoid corrupting unknown content; the
 * user must explicitly pick a brace-family language to enable repair.
 */
export const BRACE_REPAIR_LANGS = new Set([
  'javascript', 'typescript',
  'java', 'c', 'cpp', 'csharp',
  'go', 'rust',
  'json', 'css', 'php',
]);

export function shouldRepairBrace(lang) {
  return BRACE_REPAIR_LANGS.has(lang);
}


/**
 * Re-indent text based on bracket depth. String- and comment-aware so
 * braces inside literals or comments don't move the cursor.
 *
 * Returns:
 *   text       — re-indented text (no added trailing newline)
 *   finalDepth — bracket depth at end of input; >0 means unclosed openers
 *   mismatched — true if a closer appeared with no matching opener
 *   maxDepth   — deepest bracket nesting seen
 *
 * Limitations:
 *   - Template-literal interpolation (`${...}`) is treated as string content.
 *     Multi-line `${...}` blocks will be re-indented as part of the string.
 *   - JSX/TSX is roughly fine because `{` and `}` are real code-level braces.
 *   - C# verbatim strings (@"...") and other exotic string forms are not modeled.
 */
export function repairBraceIndent(text, unit = '    ') {
  const lines = text.split('\n');
  const out = [];
  let depth = 0, maxDepth = 0;
  let inStr = null, inBlockCm = false, escaped = false;
  let mismatched = false;

  for (const rawLine of lines) {
    const stripped = rawLine.replace(/^[ \t]+/, '');

    if (stripped.length === 0) {
      out.push('');
      continue;
    }

    const firstChar = stripped[0];
    const leadCloser = !inStr && !inBlockCm &&
      (firstChar === '}' || firstChar === ']' || firstChar === ')');
    const indentDepth = Math.max(0, depth - (leadCloser ? 1 : 0));
    out.push(unit.repeat(indentDepth) + stripped);

    let inLineCm = false;
    for (let i = 0; i < stripped.length; i++) {
      const c = stripped[i];
      const n = stripped[i + 1];
      if (escaped) { escaped = false; continue; }
      if (inLineCm) break;
      if (inBlockCm) {
        if (c === '*' && n === '/') { inBlockCm = false; i++; }
        continue;
      }
      if (inStr) {
        if (c === '\\') { escaped = true; continue; }
        if (c === inStr) inStr = null;
        continue;
      }
      if (c === '/' && n === '/') { inLineCm = true; break; }
      if (c === '/' && n === '*') { inBlockCm = true; i++; continue; }
      if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
      if (c === '(' || c === '[' || c === '{') {
        depth++;
        if (depth > maxDepth) maxDepth = depth;
      } else if (c === ')' || c === ']' || c === '}') {
        depth--;
        if (depth < 0) { mismatched = true; depth = 0; }
      }
    }
  }

  return { text: out.join('\n'), finalDepth: depth, mismatched, maxDepth };
}
