// Regression test cases for shotcode's cleanup / repair / verify pipelines.
// Pre-OCR text fixtures only. Real-screenshot fixtures come in a later phase.

import {
  normalizeChars, stripLineNumbers, stripPrompts, normalizeIndent, finalTrim,
} from '../js/cleanup.js';
import { repairBraceIndent, shouldRepairBrace, BRACE_REPAIR_LANGS } from '../js/repair.js';
import {
  scanBalance, scanCleanupResidue, findConfusables, scanHomoglyphs, scanPythonIndentLoss,
} from '../js/verify.js';
import {
  proposeVisualIndentation, groupWordsIntoVisualLines, estimateBaseX, estimateCharWidth,
} from '../js/visual-indent.js';
import { eq, deepEq, ok, notOk, some, none, countOf } from './assert.js';

// ----------------------------------------------------------------------
//  Synthetic OCR word builder
//
// Monospace font assumption: 8 px per character, 16 px line height.
// Position by *column* and *row*, not raw pixels — keeps tests readable.
// ----------------------------------------------------------------------
const CHAR_W = 8;
const LINE_H = 16;
function w(text, col, row, conf = 90) {
  return {
    text,
    confidence: conf,
    bbox: {
      x0: col * CHAR_W,
      y0: row * LINE_H,
      x1: (col + text.length) * CHAR_W,
      y1: (row + 1) * LINE_H,
    },
  };
}

export const cases = [

  // ----------------------------------------------------------------------
  //  A. normalize cleanup
  // ----------------------------------------------------------------------
  { group: 'A. normalize', name: 'A1 smart quotes → straight', run: () => {
    eq(
      normalizeChars('“hello” ‘world’'),
      '"hello" \'world\''
    );
  }},

  { group: 'A. normalize', name: 'A2 en/em dash → hyphen', run: () => {
    eq(normalizeChars('a – b — c'), 'a - b - c');
  }},

  { group: 'A. normalize', name: 'A3 zero-width chars stripped', run: () => {
    // U+200B ZWSP, U+200C ZWNJ, U+200D ZWJ, U+FEFF BOM
    eq(
      normalizeChars('he​l‌l‍o﻿'),
      'hello'
    );
  }},

  { group: 'A. normalize', name: 'A4 ligatures expanded', run: () => {
    eq(normalizeChars('oﬀice ﬁnd ﬂag'), 'office find flag');
  }},

  { group: 'A. normalize', name: 'A5 NBSP → regular space', run: () => {
    eq(normalizeChars('foo bar'), 'foo bar');
  }},

  // ----------------------------------------------------------------------
  //  B. line number stripping
  // ----------------------------------------------------------------------
  { group: 'B. line numbers', name: 'B1 strip numbered prefix when 3+ lines match', run: () => {
    const input  = '1  const a = 1;\n2  console.log(a);\n3  export default a;';
    const output = 'const a = 1;\nconsole.log(a);\nexport default a;';
    eq(stripLineNumbers(input), output);
  }},

  { group: 'B. line numbers', name: 'B2 only some lines numbered → no strip', run: () => {
    const input = '1  hello\nconst b = 2;\nconst c = 3;';
    eq(stripLineNumbers(input), input);
  }},

  { group: 'B. line numbers', name: 'B3 numeric literals are not stripped', run: () => {
    const input = 'const v0 = 1;\nconst v1 = 2;\nconst v2 = 3;';
    eq(stripLineNumbers(input), input);
  }},

  { group: 'B. line numbers', name: 'B4 colon-separator format is stripped', run: () => {
    const input  = '1: const a = 1;\n2: const b = 2;\n3: const c = 3;';
    const output = 'const a = 1;\nconst b = 2;\nconst c = 3;';
    eq(stripLineNumbers(input), output);
  }},

  // ----------------------------------------------------------------------
  //  C. shell / REPL prompt stripping
  // ----------------------------------------------------------------------
  { group: 'C. prompts', name: 'C1 strip shell $ prompts', run: () => {
    const input  = '$ npm install express\n$ node app.js\n';
    const output = 'npm install express\nnode app.js\n';
    eq(stripPrompts(input), output);
  }},

  { group: 'C. prompts', name: 'C2 $var (no space) is not stripped', run: () => {
    const input = 'echo $var\necho $other\n';
    eq(stripPrompts(input), input);
  }},

  { group: 'C. prompts', name: 'C3 strip Python >>> and ... prompts', run: () => {
    const input  = '>>> def foo():\n...     return 1\n>>> foo()\n';
    const output = 'def foo():\n    return 1\nfoo()\n';
    eq(stripPrompts(input), output);
  }},

  { group: 'C. prompts', name: 'C4 strip IPython In[n]: prompts', run: () => {
    const input  = 'In [1]: x = 1\nIn [2]: y = 2\n';
    const output = 'x = 1\ny = 2\n';
    eq(stripPrompts(input), output);
  }},

  { group: 'C. prompts', name: 'C5 Python # comments are NOT stripped as shell prompts', run: () => {
    // Two `# ` lines used to (incorrectly) trigger shell-prompt stripping.
    // After the fix, `#` is only stripped when language is explicitly shell.
    const input =
      '# module header\n' +
      '# usage:\n' +
      'def foo():\n' +
      '    pass\n';
    eq(stripPrompts(input), input);
  }},

  // ----------------------------------------------------------------------
  //  D. brace-based indent repair
  // ----------------------------------------------------------------------
  { group: 'D. brace repair', name: 'D1 basic class re-indent', run: () => {
    const input =
      'class Main {\n' +
      'public static void main(String[] args) {\n' +
      'System.out.println("hi");\n' +
      '}\n' +
      '}';
    const expected =
      'class Main {\n' +
      '    public static void main(String[] args) {\n' +
      '        System.out.println("hi");\n' +
      '    }\n' +
      '}';
    const r = repairBraceIndent(input);
    eq(r.text, expected);
    eq(r.finalDepth, 0);
    notOk(r.mismatched);
  }},

  { group: 'D. brace repair', name: 'D2 nested if/for blocks', run: () => {
    const input =
      'function f() {\n' +
      'if (x) {\n' +
      'for (let i = 0; i < 10; i++) {\n' +
      'console.log(i);\n' +
      '}\n' +
      '}\n' +
      '}';
    const expected =
      'function f() {\n' +
      '    if (x) {\n' +
      '        for (let i = 0; i < 10; i++) {\n' +
      '            console.log(i);\n' +
      '        }\n' +
      '    }\n' +
      '}';
    eq(repairBraceIndent(input).text, expected);
  }},

  { group: 'D. brace repair', name: 'D3 line comment with brace is ignored', run: () => {
    const input  = 'function f() {\n// closing brace: }\nreturn 1;\n}';
    const expected =
      'function f() {\n' +
      '    // closing brace: }\n' +
      '    return 1;\n' +
      '}';
    eq(repairBraceIndent(input).text, expected);
  }},

  { group: 'D. brace repair', name: 'D4 block comment with brace is ignored', run: () => {
    const input  = 'function f() {\n/* } */ return 1;\n}';
    const expected =
      'function f() {\n' +
      '    /* } */ return 1;\n' +
      '}';
    eq(repairBraceIndent(input).text, expected);
  }},

  { group: 'D. brace repair', name: 'D5 string contents with brace are ignored', run: () => {
    const input  = 'const x = "{";\nconst y = "}";';
    const r = repairBraceIndent(input);
    eq(r.finalDepth, 0);
    notOk(r.mismatched);
    eq(r.text, 'const x = "{";\nconst y = "}";');
  }},

  { group: 'D. brace repair', name: 'D6 template-literal ${} on single line unaffected', run: () => {
    const input = 'const x = `${a + b}`;';
    const r = repairBraceIndent(input);
    eq(r.text, input);
    eq(r.finalDepth, 0);
  }},

  { group: 'D. brace repair', name: 'D7 extra closing brace marks mismatched', run: () => {
    const r = repairBraceIndent('foo()\n}');
    ok(r.mismatched, 'expected mismatched=true for stray closer');
  }},

  { group: 'D. brace repair', name: 'D8 unclosed opener leaves finalDepth > 0', run: () => {
    const r = repairBraceIndent('function f() {\nreturn 1;');
    eq(r.finalDepth, 1);
    notOk(r.mismatched);
  }},

  // ----------------------------------------------------------------------
  //  E. bracket / quote balance warnings
  // ----------------------------------------------------------------------
  { group: 'E. balance', name: 'E1 balanced code emits no warnings', run: () => {
    const w = scanBalance('function foo() { return [1, 2]; }');
    eq(w.length, 0);
  }},

  { group: 'E. balance', name: 'E2 missing close → unclosed warning', run: () => {
    const w = scanBalance('function foo() { return 1;');
    some(w, x => x.code === 'unclosed' && x.position && x.position.line === 1);
  }},

  { group: 'E. balance', name: 'E3 extra close → extra-close warning', run: () => {
    const w = scanBalance('function foo() } return 1;');
    some(w, x => x.code === 'extra-close');
  }},

  { group: 'E. balance', name: 'E4 unterminated string → unterminated-string warning', run: () => {
    const w = scanBalance('const x = "hello;');
    some(w, x => x.code === 'unterminated-string');
  }},

  { group: 'E. balance', name: 'E5 braces inside strings are not counted', run: () => {
    const w = scanBalance('const x = "{";');
    eq(w.length, 0);
  }},

  { group: 'E. balance', name: 'E6 braces inside line comments are not counted', run: () => {
    const w = scanBalance('// {\nconst x = 1;');
    eq(w.length, 0);
  }},

  { group: 'E. balance', name: 'E7 cleanup residue (smart quotes) → info warning', run: () => {
    const w = scanCleanupResidue('const x = “hi”;');
    some(w, x => x.code === 'smart-quote-residue');
  }},

  // ----------------------------------------------------------------------
  //  F. suspicious character detection
  // ----------------------------------------------------------------------
  { group: 'F. homoglyphs', name: 'F1 0 between letters is flagged in p0rt', run: () => {
    const flags = scanHomoglyphs('const p0rt = 1;');
    some(flags, f => f.char === '0' && f.suggestion === 'O' && f.code === 'zero-or-oh');
  }},

  { group: 'F. homoglyphs', name: 'F2 O between digits is flagged in 8O8O', run: () => {
    const flags = scanHomoglyphs('const x = 8O8O;');
    countOf(flags, f => f.char === 'O' && f.suggestion === '0', 2,
      'expected both Os in 8O8O to be flagged');
  }},

  { group: 'F. homoglyphs', name: 'F3 hex literal 0xdeadbeef is not flagged', run: () => {
    eq(scanHomoglyphs('const x = 0xdeadbeef;').length, 0);
  }},

  { group: 'F. homoglyphs', name: 'F4 scientific 1e10 is not flagged', run: () => {
    eq(scanHomoglyphs('const x = 1e10;').length, 0);
  }},

  { group: 'F. homoglyphs', name: 'F5 l between letters (userlnput) is NOT flagged (conservative)', run: () => {
    // Documents current conservative behavior. If `l/I` ambiguity rules
    // tighten later, this test should be updated to expect a flag.
    eq(scanHomoglyphs('const userlnput = input;').length, 0);
  }},

  { group: 'F. homoglyphs', name: 'F6 plain integer literal 100 is not flagged', run: () => {
    eq(scanHomoglyphs('const x = 100;').length, 0);
  }},

  { group: 'F. homoglyphs', name: 'F7 Cyrillic confusable inside identifier is flagged', run: () => {
    // 'а' is Cyrillic U+0430 (looks like Latin 'a')
    const flags = scanHomoglyphs('const vаr = 1;');
    some(flags, f => f.char === 'а' && f.suggestion === 'a' && f.code === 'unicode-confusable');
  }},

  { group: 'F. homoglyphs', name: 'F8 confusables inside strings are NOT flagged', run: () => {
    // Inside a string literal, the content is user data — don't second-guess.
    const flags = scanHomoglyphs('const s = "p0rt 8O8O";');
    eq(flags.length, 0);
  }},

  { group: 'F. homoglyphs', name: 'F9 confusables inside comments are NOT flagged', run: () => {
    const flags = scanHomoglyphs('// p0rt 8O8O\nconst x = 1;');
    eq(flags.length, 0);
  }},

  // ----------------------------------------------------------------------
  //  G. findConfusables (per-word helper used by review view)
  // ----------------------------------------------------------------------
  { group: 'G. findConfusables', name: 'G1 detects Cyrillic а inside a word', run: () => {
    const flags = findConfusables('vаr');
    eq(flags.length, 1);
    eq(flags[0].char, 'а');
    eq(flags[0].suggestion, 'a');
    eq(flags[0].idx, 1);
  }},

  { group: 'G. findConfusables', name: 'G2 returns empty for pure-ASCII identifier', run: () => {
    eq(findConfusables('variable').length, 0);
  }},

  // ----------------------------------------------------------------------
  //  I. brace-repair language gate
  // ----------------------------------------------------------------------
  { group: 'I. brace-lang gate', name: 'I1 javascript is brace-family', run: () => {
    ok(shouldRepairBrace('javascript'));
  }},

  { group: 'I. brace-lang gate', name: 'I2 typescript / java / c / cpp / csharp / go / rust / json / css / php are all in the set', run: () => {
    for (const l of ['typescript', 'java', 'c', 'cpp', 'csharp', 'go', 'rust', 'json', 'css', 'php']) {
      ok(shouldRepairBrace(l), `expected '${l}' to be in BRACE_REPAIR_LANGS`);
    }
  }},

  { group: 'I. brace-lang gate', name: 'I3 python is NOT brace-family', run: () => {
    notOk(shouldRepairBrace('python'));
  }},

  { group: 'I. brace-lang gate', name: 'I4 yaml / bash / sql / markdown / plaintext are NOT brace-family', run: () => {
    for (const l of ['yaml', 'bash', 'sql', 'markdown', 'plaintext', 'html']) {
      notOk(shouldRepairBrace(l), `expected '${l}' to NOT be in BRACE_REPAIR_LANGS`);
    }
  }},

  { group: 'I. brace-lang gate', name: "I5 'auto' is treated as not brace (must pick explicit lang)", run: () => {
    notOk(shouldRepairBrace('auto'));
  }},

  { group: 'I. brace-lang gate', name: 'I6 unknown / undefined / empty string returns false', run: () => {
    notOk(shouldRepairBrace(undefined));
    notOk(shouldRepairBrace(''));
    notOk(shouldRepairBrace('klingon'));
  }},

  // ----------------------------------------------------------------------
  //  J. Python indent-loss detection
  // ----------------------------------------------------------------------
  { group: 'J. python indent loss', name: 'J1 flattened class/def chain triggers warning', run: () => {
    // The user's reported case: every colon header is immediately followed
    // by an unindented body line.
    const input =
      'class AbstractHTTPClient(metaclass=ABCMeta):\n' +
      'def __new__(cls, *args, **kwargs):\n' +
      'if not hasattr(cls, "_instance"):\n' +
      'cls._instance = super().__new__(cls)\n' +
      'return cls._instance\n' +
      '@abstractmethod\n' +
      'def __init__(self):\n' +
      'pass';
    const w = scanPythonIndentLoss(input, 'python');
    some(w, x => x.code === 'python-indent-loss');
  }},

  { group: 'J. python indent loss', name: 'J2 properly indented python emits no warning', run: () => {
    const input =
      'class Foo:\n' +
      '    def bar(self):\n' +
      '        return 1\n' +
      '\n' +
      '    def baz(self):\n' +
      '        return 2\n';
    eq(scanPythonIndentLoss(input, 'python').length, 0);
  }},

  { group: 'J. python indent loss', name: 'J3 detector is gated on lang === python', run: () => {
    // Even with the suspicious pattern, scanner is silent for non-Python.
    const input =
      'class Foo:\n' +
      'def bar(self):\n' +
      'return 1\n' +
      'class Baz:\n' +
      'def qux(self):\n' +
      'pass';
    eq(scanPythonIndentLoss(input, 'javascript').length, 0);
    eq(scanPythonIndentLoss(input, 'auto').length, 0);
    eq(scanPythonIndentLoss(input, undefined).length, 0);
  }},

  { group: 'J. python indent loss', name: 'J4 fewer than 2 suspicious blocks → no warning (noise floor)', run: () => {
    // One block header without indent is not enough; could be a real one-liner.
    const input =
      'class Foo:\n' +
      'pass\n' +
      '\n' +
      'def bar():\n' +
      '    return 1\n';
    eq(scanPythonIndentLoss(input, 'python').length, 0);
  }},

  { group: 'J. python indent loss', name: 'J5 comment lines ending with colon are ignored', run: () => {
    // A `# Note:` line should not contribute to the suspicious count.
    const input =
      '# Note:\n' +
      'x = 1\n' +
      '# TODO:\n' +
      'y = 2\n';
    eq(scanPythonIndentLoss(input, 'python').length, 0);
  }},

  // ----------------------------------------------------------------------
  //  K. brace repair still works for brace-family fixtures
  //     (covered by D1-D8 — these are sanity-coverage assertions that the
  //     core algorithm remains independent of the language gate)
  // ----------------------------------------------------------------------
  { group: 'K. brace repair sanity', name: 'K1 repairBraceIndent does not know about languages', run: () => {
    // The pure function is language-agnostic; the gate lives in app.js.
    // If someone wires repair into a python pipeline by accident, the function
    // still runs but produces flattened/wrong output — that's exactly why the
    // runtime guard exists. This test just documents that contract.
    const r = repairBraceIndent('class Main {\nint x = 1;\n}');
    eq(r.text, 'class Main {\n    int x = 1;\n}');
  }},

  { group: 'K. brace repair sanity', name: 'K2 BRACE_REPAIR_LANGS is the single source of truth', run: () => {
    ok(BRACE_REPAIR_LANGS instanceof Set);
    ok(BRACE_REPAIR_LANGS.has('javascript'));
    ok(!BRACE_REPAIR_LANGS.has('python'));
  }},

  // ----------------------------------------------------------------------
  //  L. Visual indent recovery (proposeVisualIndentation)
  //
  //  Each test gives synthetic Tesseract-shaped word data with bboxes and the
  //  corresponding flattened OCR text. Asserts the proposed text reconstructs
  //  the original visual indentation.
  // ----------------------------------------------------------------------
  { group: 'L. visual indent', name: 'L1 simple class/function gets 4/8-space indent', run: () => {
    const words = [
      w('class', 0, 0),  w('Foo:', 6, 0),
      w('def', 4, 1),    w('bar(self):', 8, 1),
      w('return', 8, 2), w('1', 15, 2),
    ];
    const rawText = 'class Foo:\ndef bar(self):\nreturn 1';
    const p = proposeVisualIndentation({ words, rawText, language: 'python' });
    eq(p.text, 'class Foo:\n    def bar(self):\n        return 1');
    eq(p.metrics.charWidth, CHAR_W);
    eq(p.metrics.indentUnit, 4);
  }},

  { group: 'L. visual indent', name: 'L2 nested if block preserves return-to-outer-indent', run: () => {
    const words = [
      w('def', 0, 0),    w('foo():', 4, 0),
      w('if', 4, 1),     w('x:', 7, 1),
      w('return', 8, 2), w('1', 15, 2),
      w('return', 4, 3), w('0', 11, 3),
    ];
    const rawText = 'def foo():\nif x:\nreturn 1\nreturn 0';
    const p = proposeVisualIndentation({ words, rawText, language: 'python' });
    eq(p.text, 'def foo():\n    if x:\n        return 1\n    return 0');
  }},

  { group: 'L. visual indent', name: 'L3 decorators stay at outer indent', run: () => {
    const words = [
      w('@decorator', 0, 0),
      w('def', 0, 1), w('foo():', 4, 1),
      w('pass', 4, 2),
    ];
    const rawText = '@decorator\ndef foo():\npass';
    const p = proposeVisualIndentation({ words, rawText, language: 'python' });
    eq(p.text, '@decorator\ndef foo():\n    pass');
  }},

  { group: 'L. visual indent', name: 'L4 blank lines preserved as blanks, do not consume visual lines', run: () => {
    const words = [
      w('class', 0, 0),  w('Foo:', 6, 0),
      w('def', 4, 1),    w('bar(self):', 8, 1),
      w('return', 8, 2), w('1', 15, 2),
      // row 3 is blank — no words
      w('def', 4, 4),    w('baz(self):', 8, 4),
      w('return', 8, 5), w('2', 15, 5),
    ];
    const rawText = 'class Foo:\ndef bar(self):\nreturn 1\n\ndef baz(self):\nreturn 2';
    const p = proposeVisualIndentation({ words, rawText, language: 'python' });
    eq(
      p.text,
      'class Foo:\n    def bar(self):\n        return 1\n\n    def baz(self):\n        return 2'
    );
  }},

  { group: 'L. visual indent', name: 'L5 comments are indented like normal lines', run: () => {
    const words = [
      w('#', 0, 0),    w('top', 2, 0), w('comment', 6, 0),
      w('def', 0, 1),  w('foo():', 4, 1),
      w('#', 4, 2),    w('inside', 6, 2), w('comment', 13, 2),
      w('pass', 4, 3),
    ];
    const rawText = '# top comment\ndef foo():\n# inside comment\npass';
    const p = proposeVisualIndentation({ words, rawText, language: 'python' });
    eq(p.text, '# top comment\ndef foo():\n    # inside comment\n    pass');
  }},

  { group: 'L. visual indent', name: 'L6 long type annotation does not destabilize charWidth', run: () => {
    const words = [
      w('def', 0, 0),
      w('foo(x:', 4, 0),
      w('Optional[Dict[str,str]]', 11, 0),       // 23-char "word" at col 11
      w(')', 35, 0),
      w('pass', 4, 1),
    ];
    const rawText = 'def foo(x: Optional[Dict[str,str]] )\npass';
    const p = proposeVisualIndentation({ words, rawText, language: 'python' });
    eq(p.metrics.charWidth, CHAR_W, 'charWidth should remain stable at 8');
    eq(p.lines[1].leadingSpaces, 4);
  }},

  { group: 'L. visual indent', name: 'L7 noisy x position flagged as uncertain', run: () => {
    // The 'def' word sits at x0=46 — halfway between indent levels 1 (32) and 2 (64).
    const words = [
      w('class', 0, 0), w('Foo:', 6, 0),
      { text: 'def', confidence: 90, bbox: { x0: 46, y0: 16, x1: 46 + 24, y1: 32 } },
      { text: 'bar(self):', confidence: 90, bbox: { x0: 80, y0: 16, x1: 80 + 80, y1: 32 } },
      w('return', 8, 2), w('1', 15, 2),
    ];
    const rawText = 'class Foo:\ndef bar(self):\nreturn 1';
    const p = proposeVisualIndentation({ words, rawText, language: 'python' });
    ok(p.metrics.uncertainLineCount >= 1, 'expected at least one uncertain line');
    // The middle line's per-line confidence should be < 50
    const middle = p.lines.find(l => l.original.startsWith('def'));
    ok(middle && middle.confidence < 50,
      `middle-line confidence should be < 50, got ${middle && middle.confidence}`);
  }},

  { group: 'L. visual indent', name: 'L8 missing bbox data → no-char-width warning + zero charWidth', run: () => {
    const words = [
      { text: 'foo', confidence: 90 },  // no bbox
      { text: 'bar', confidence: 90 },
    ];
    const p = proposeVisualIndentation({
      words, rawText: 'foo\nbar', language: 'python',
    });
    some(p.warnings, x => x.code === 'visual-indent-no-char-width');
    eq(p.metrics.charWidth, 0);
  }},

  { group: 'L. visual indent', name: 'L9 only leading whitespace changes — content preserved verbatim', run: () => {
    const words = [
      w('class', 0, 0),  w('Foo:', 6, 0),
      w('def', 4, 1),    w('bar(self,', 8, 1), w('value):', 18, 1),
      w('return', 8, 2), w('value', 15, 2),
    ];
    const rawText = 'class Foo:\ndef bar(self, value):\nreturn value';
    const p = proposeVisualIndentation({ words, rawText, language: 'python' });
    for (const ln of p.lines) {
      eq(
        ln.original.replace(/^[ \t]+/, ''),
        ln.proposed.replace(/^[ \t]+/, ''),
        `content drifted on line: ${JSON.stringify({ original: ln.original, proposed: ln.proposed })}`
      );
    }
  }},

  { group: 'L. visual indent', name: 'L10 empty input → empty proposal with insufficient-lines warning', run: () => {
    const p = proposeVisualIndentation({ words: [], rawText: '', language: 'python' });
    eq(p.text, '');
    some(p.warnings, x => x.code === 'visual-indent-insufficient-lines');
  }},

  { group: 'L. visual indent', name: 'L11 groupWordsIntoVisualLines clusters by y-center', run: () => {
    const lines = groupWordsIntoVisualLines([
      w('a', 0, 0), w('b', 2, 0),
      w('c', 0, 1),
      w('d', 0, 5),
    ]);
    eq(lines.length, 3);
    eq(lines[0].words.length, 2);
    eq(lines[1].words[0].text, 'c');
    eq(lines[2].words[0].text, 'd');
  }},

  { group: 'L. visual indent', name: 'L12 estimateBaseX uses 10th percentile of firstX', run: () => {
    const lines = [
      { firstX: 0,  words: [] }, { firstX: 32, words: [] }, { firstX: 32, words: [] },
      { firstX: 64, words: [] }, { firstX: 64, words: [] }, { firstX: 64, words: [] },
    ];
    eq(estimateBaseX(lines), 0);
  }},

  { group: 'L. visual indent', name: 'L13 estimateCharWidth ignores low-confidence and short tokens', run: () => {
    const lines = [{
      words: [
        w('aa', 0, 0),                              // too short
        w('foo', 0, 0, 40),                          // low confidence
        w('bar', 0, 0),                              // good sample
        w('baz', 0, 0),                              // good sample
        w('hello', 0, 0),                            // good sample
      ],
    }];
    eq(estimateCharWidth(lines), CHAR_W);
  }},

  { group: 'L. visual indent', name: 'L14 async def gets the same 4-space body indent as def', run: () => {
    const words = [
      w('async', 0, 0),  w('def', 6, 0), w('fetch():', 10, 0),
      w('return', 4, 1), w('await', 11, 1), w('get()', 17, 1),
    ];
    const rawText = 'async def fetch():\nreturn await get()';
    const p = proposeVisualIndentation({ words, rawText, language: 'python' });
    eq(p.text, 'async def fetch():\n    return await get()');
  }},

  { group: 'L. visual indent', name: 'L15 multi-line def signature with hanging close paren', run: () => {
    // def foo(
    //     arg1,
    //     arg2,
    // ):
    //     pass
    const words = [
      w('def', 0, 0),   w('foo(', 4, 0),
      w('arg1,', 4, 1),
      w('arg2,', 4, 2),
      w('):', 0, 3),
      w('pass', 4, 4),
    ];
    const rawText = 'def foo(\narg1,\narg2,\n):\npass';
    const p = proposeVisualIndentation({ words, rawText, language: 'python' });
    eq(p.text, 'def foo(\n    arg1,\n    arg2,\n):\n    pass');
  }},

  { group: 'L. visual indent', name: 'L16 try / except / finally bodies all at 4 spaces', run: () => {
    const words = [
      w('try:', 0, 0),
      w('do_something()', 4, 1),
      w('except', 0, 2),  w('Exception', 7, 2), w('as', 17, 2), w('e:', 20, 2),
      w('handle(e)', 4, 3),
      w('finally:', 0, 4),
      w('cleanup()', 4, 5),
    ];
    const rawText = 'try:\ndo_something()\nexcept Exception as e:\nhandle(e)\nfinally:\ncleanup()';
    const p = proposeVisualIndentation({ words, rawText, language: 'python' });
    eq(
      p.text,
      'try:\n    do_something()\nexcept Exception as e:\n    handle(e)\nfinally:\n    cleanup()'
    );
  }},

  { group: 'L. visual indent', name: 'L17 multiple methods stay at consistent class-body indent', run: () => {
    const words = [
      w('class', 0, 0),  w('Foo:', 6, 0),
      w('def', 4, 1),    w('a(self):', 8, 1),
      w('return', 8, 2), w('1', 15, 2),
      // blank row 3 — no words
      w('def', 4, 4),    w('b(self):', 8, 4),
      w('return', 8, 5), w('2', 15, 5),
      // blank row 6 — no words
      w('def', 4, 7),    w('c(self):', 8, 7),
      w('return', 8, 8), w('3', 15, 8),
    ];
    const rawText =
      'class Foo:\n' +
      'def a(self):\n' +
      'return 1\n' +
      '\n' +
      'def b(self):\n' +
      'return 2\n' +
      '\n' +
      'def c(self):\n' +
      'return 3';
    const p = proposeVisualIndentation({ words, rawText, language: 'python' });
    // All three method `def` lines should land at exactly 4 spaces — drift here
    // would mean charWidth / baseX is being recomputed inconsistently.
    const methodDefs = p.lines.filter(l => l.original.startsWith('def'));
    eq(methodDefs.length, 3);
    for (const m of methodDefs) eq(m.leadingSpaces, 4, `def line not at 4 spaces: ${m.proposed}`);
    const returns = p.lines.filter(l => l.original.startsWith('return'));
    for (const r of returns) eq(r.leadingSpaces, 8, `return line not at 8 spaces: ${r.proposed}`);
  }},

  { group: 'L. visual indent', name: 'L18 implausible level jumps (>2) trigger visual-indent-jumpy', run: () => {
    // Two top-level defs with bodies wildly over-indented at level 6.
    const words = [
      w('def', 0, 0),  w('a():', 4, 0),
      w('pass', 24, 1),
      w('def', 0, 2),  w('b():', 4, 2),
      w('pass', 24, 3),
    ];
    const rawText = 'def a():\npass\ndef b():\npass';
    const p = proposeVisualIndentation({ words, rawText, language: 'python' });
    some(p.warnings, x => x.code === 'visual-indent-jumpy');
  }},

  { group: 'L. visual indent', name: 'L19 whitespace-only line is treated as blank (output is empty)', run: () => {
    const words = [
      w('foo', 0, 0),
      w('bar', 0, 2),
    ];
    const rawText = 'foo\n   \nbar';
    const p = proposeVisualIndentation({ words, rawText, language: 'python' });
    eq(p.text, 'foo\n\nbar');
    eq(p.lines[1].proposed, '');
  }},

  { group: 'L. visual indent', name: 'L20 >=30% uncertain lines triggers visual-indent-uncertain', run: () => {
    // Two of four visual lines have firstX halfway between indent levels.
    const ambiguous = (text, x0, y0) => ({
      text, confidence: 90, bbox: { x0, y0, x1: x0 + text.length * CHAR_W, y1: y0 + LINE_H },
    });
    const words = [
      w('class', 0, 0),   w('Foo:', 6, 0),
      ambiguous('def', 46, 16),  ambiguous('bar(self):', 78, 16),  // x=46 → ambiguous
      w('return', 8, 2),  w('1', 15, 2),
      ambiguous('def', 46, 48),  ambiguous('baz(self):', 78, 48),  // x=46 again
    ];
    const rawText = 'class Foo:\ndef bar(self):\nreturn 1\ndef baz(self):';
    const p = proposeVisualIndentation({ words, rawText, language: 'python' });
    ok(p.metrics.uncertainLineCount >= 2,
       `expected at least 2 uncertain lines, got ${p.metrics.uncertainLineCount}`);
    some(p.warnings, x => x.code === 'visual-indent-uncertain');
  }},

  { group: 'L. visual indent', name: 'L21 leading whitespace completely lost is the exact target scenario', run: () => {
    // This is the AbstractHTTPClient-style screenshot: every OCR line starts
    // flush left, the visual layout is the only signal we have.
    const words = [
      w('class', 0, 0),  w('AbstractHTTPClient(metaclass=ABCMeta):', 6, 0),
      w('def', 4, 1),    w('__new__(cls,', 8, 1), w('*args,', 21, 1), w('**kwargs):', 28, 1),
      w('if', 8, 2),     w('not', 11, 2), w('hasattr(cls,', 15, 2), w('"_instance"):', 28, 2),
      w('cls._instance', 12, 3), w('=', 26, 3), w('super().__new__(cls)', 28, 3),
      w('return', 8, 4), w('cls._instance', 15, 4),
    ];
    // Raw text has every line flush-left
    const rawText =
      'class AbstractHTTPClient(metaclass=ABCMeta):\n' +
      'def __new__(cls, *args, **kwargs):\n' +
      'if not hasattr(cls, "_instance"):\n' +
      'cls._instance = super().__new__(cls)\n' +
      'return cls._instance';
    const p = proposeVisualIndentation({ words, rawText, language: 'python' });
    // Spot-check the leading whitespace on each line
    eq(p.lines[0].leadingSpaces, 0, 'class line at column 0');
    eq(p.lines[1].leadingSpaces, 4, 'def at column 4');
    eq(p.lines[2].leadingSpaces, 8, 'if at column 8');
    eq(p.lines[3].leadingSpaces, 12, 'body at column 12');
    eq(p.lines[4].leadingSpaces, 8, 'return at column 8');
  }},

  { group: 'L. visual indent', name: 'L22 confidence and indent-loss warnings are independent', run: () => {
    // Every word at high confidence (95) but x-positions ambiguous — the proposal
    // should still flag the lines as uncertain even though OCR was confident.
    const ambig = (text, x0, y0) => ({
      text, confidence: 95, bbox: { x0, y0, x1: x0 + text.length * CHAR_W, y1: y0 + LINE_H },
    });
    const words = [
      ambig('class', 0, 0), ambig('Foo:', 48, 0),
      ambig('def',   46, 16), ambig('bar(self):', 78, 16),
      ambig('def',   46, 48), ambig('baz(self):', 78, 48),
    ];
    const rawText = 'class Foo:\ndef bar(self):\ndef baz(self):';
    const p = proposeVisualIndentation({ words, rawText, language: 'python' });
    ok(p.metrics.uncertainLineCount >= 1,
       'high OCR confidence does not imply low indent uncertainty');
  }},

  // ----------------------------------------------------------------------
  //  H. finalTrim
  // ----------------------------------------------------------------------
  { group: 'H. finalTrim', name: 'H1 collapses 3+ blank lines to 2', run: () => {
    eq(finalTrim('a\n\n\n\nb'), 'a\n\nb\n');
  }},

  { group: 'H. finalTrim', name: 'H2 trims trailing whitespace per line', run: () => {
    eq(finalTrim('a   \nb\t\n'), 'a\nb\n');
  }},
];
