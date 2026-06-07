# shotcode

> A code-screenshot restoration tool. Faster than retyping, easier to verify, safer to copy.

shotcode turns screenshots of code into clean, copy-pasteable text — entirely in your browser. Crop to the code, pick a preprocessing preset, eyeball the confidence marks, fix the inevitable `l`/`1` slip, and ship.

![demo placeholder — record a GIF showing paste → crop → review → copy](docs/demo.gif)

## Quick start

It's a static site. Serve over HTTP (not `file://`):

```bash
python -m http.server 8000     # or: npx serve .
```

Then open <http://localhost:8000>. Paste a screenshot with Ctrl+V, drag a selection over the code area, and review the result.

## Features

**Workspace**
- Side-by-side image + editable output
- Drag-to-select crop region; zoom in / out / fit
- Drop, click, or paste images (Ctrl+V anywhere)

**OCR & cleanup**
- In-browser OCR via [Tesseract.js](https://github.com/naptha/tesseract.js)
- Preprocessing presets: Auto, Light theme, Dark theme, Low contrast, Tiny font, Terminal, None
- Toggleable cleanup, re-applied live without re-running OCR:
  - normalize smart quotes / dashes / NBSPs / zero-width chars / ligatures
  - strip leading line numbers (auto-detected)
  - strip Python `>>>`/`...` or shell `$`/`#` prompts (auto-detected, language-aware)
  - normalize indentation (tabs → spaces, strip common leading whitespace)
  - **repair indentation from brace depth** (string- and comment-aware brace-walk; off by default). The chip is automatically **disabled for whitespace-sensitive languages** (Python, YAML, Makefile, etc.) and for `auto` — pick an explicit brace-family language (JS/TS/Java/C/C++/C#/Go/Rust/JSON/CSS/PHP) to enable it.

**Verification**
- Per-word confidence underlines in Review view (wavy amber for &lt;70%, wavy red for &lt;50%)
- Inline Unicode confusable marks (Cyrillic/Greek look-alikes that resemble Latin letters) with a tooltip showing the suggested replacement
- Structured warnings for unbalanced brackets / braces / parens / quotes — with line:column and a "jump" button
- Indent-repair warnings when the brace walk ends with unclosed or extra closers
- **Python indent-loss warning** when the selected language is `python` and the OCR output looks flattened (multiple `:` headers followed immediately by unindented lines) — independent of OCR confidence, since text can read as high-confidence and still be semantically broken
- **Visual indentation recovery (experimental)** for Python and other whitespace-sensitive languages. When the language is `python`, a **Recover indent** button appears that proposes leading whitespace reconstructed from the x-coordinates of OCR word bounding boxes. **It never auto-applies**: a diff modal shows the before/after side-by-side with per-line confidence, and you click Apply to accept. Read the [Visual indent recovery](#visual-indent-recovery-experimental) section below before relying on it.
- Cancel a slow OCR run and retry with a different preset; low-confidence results suggest alternatives automatically

**Output**
- Auto-detected or manual syntax highlighting via [highlight.js](https://github.com/highlightjs/highlight.js)
- In-place editing
- Copy or download with the right file extension

## Tips for best results

- **Crop tight.** Excluding line-number gutters, sidebars, status bars, and browser chrome is the single biggest accuracy gain.
- **Larger characters generally OCR more reliably.** Bump the editor's font size before capturing if you can.
- **Use native screenshot tools, not photos of a monitor.** JPEG artifacts and screen moiré significantly hurt accuracy.
- **Monospace fonts only.** Proportional fonts produce poor results.
- **Try a different preset.** "Auto" handles most cases; switch to "Terminal" for dark terminal captures, "Tiny font" for small text.
- **Light themes tend to outperform dark themes**, though the enhancer can invert dark themes automatically.

## What this is not

- Not a general-purpose document OCR tool — for prose, use [Tesseract](https://github.com/tesseract-ocr/tesseract) directly or a cloud OCR API.
- Not for handwriting, math, or diagrams.
- Not a PDF reader — export your PDF page to PNG first.
- Not guaranteed correct. Every output should be reviewed before running.

## Privacy

- Images are processed locally in your browser using WebAssembly. **No backend.** No image upload. No account. No analytics.
- The page loads three dependencies from a CDN (`cdn.jsdelivr.net`): the Tesseract.js script, the highlight.js script, and the highlight.js theme CSS.
- The Tesseract worker fetches its WASM core and the `eng.traineddata` language file at runtime from `cdn.jsdelivr.net` and/or `tessdata.projectnaptha.com`. Browsers typically cache these, but **persistent offline support is not yet implemented** — that's PWA work on the roadmap.
- A Content-Security-Policy `<meta>` tag in `index.html` restricts script, style, image, and connection origins to the hosts above. Anything else is blocked by the browser.
- Subresource Integrity (SRI) hashes can be pinned on the two script tags and the theme stylesheet. Run `tools/refresh-sri.sh` to compute the current hashes and paste them in. The Tesseract worker's internal fetches (WASM, traineddata) cannot be SRI-checked from the page; their origins are restricted by CSP instead. A vendored-dependencies build script (in the roadmap) will close this gap for users who need stronger guarantees.

## Run tests

The cleanup, repair, and verification pipelines have a regression-test harness
that runs entirely in the browser. No Node, no bundler, no Jest — just open the
runner.

```bash
python -m http.server 8000   # or any static server
```

Then open <http://localhost:8000/tests/runner.html>. You'll see a pass/fail
summary at the top and per-case detail below. Failures also log to the browser
console with `actual` vs `expected` so you can diff in DevTools.

The current corpus is **pre-OCR text fixtures only** — it exercises the
algorithms that run after OCR. Real screenshot fixtures are future work.

Test groups covered:

- A. `normalizeChars` — smart quotes, dashes, NBSP, zero-width, ligatures
- B. `stripLineNumbers` — happy paths and negative cases for numeric literals
- C. `stripPrompts` — shell `$`, Python `>>>`, IPython `In [n]:`, and the bug
  where `#` comments were being treated as shell prompts
- D. `repairBraceIndent` — basic re-indent, nesting, comments, strings,
  template literals, mismatched and unclosed cases
- E. `scanBalance` / `scanCleanupResidue` — string-aware bracket and quote
  balance, smart-quote residue detection
- F. `scanHomoglyphs` — context-aware `0`/`O` and `1`/`l`/`I` detection,
  hex/scientific/decimal whitelisting, Cyrillic confusables
- G. `findConfusables` — the per-word helper used by the Review view
- H. `finalTrim` — blank-line collapsing and trailing whitespace
- I. brace-repair language gate — `shouldRepairBrace` true/false for known languages
- J. Python indent-loss detector — the heuristic warning, not a fixer
- K. brace repair stays language-agnostic — the gate is the policy
- L. visual indent recovery — `proposeVisualIndentation`, `groupWordsIntoVisualLines`, `estimateBaseX`, `estimateCharWidth`

If you add a cleanup rule or repair heuristic, add a fixture to `tests/cases.js`
in the same shape and reload the runner.

## Visual indent recovery (experimental)

Python (and YAML / Makefile / Haskell / F# in general) lose their meaning when leading whitespace is dropped. Tesseract often reads the characters correctly but throws away the whitespace, so a 95%-confidence OCR result can still be semantically broken.

shotcode's **Recover indent** button doesn't guess indentation from Python syntax. It uses the x-coordinates of OCR word bounding boxes:

1. Group words into visual lines by y-center proximity.
2. Estimate the page's left margin from the 10th percentile of `firstWord.x0`.
3. Estimate the monospace character width from the median of `bbox.width / text.length` across confident multi-character tokens.
4. For each line, convert `firstWord.x0 - baseX` into a count of indent units (default 4 spaces). Track per-line confidence as a function of how close that raw offset was to a clean multiple.
5. Rebuild each line with the new leading whitespace — never touching internal characters.

The result is displayed as a side-by-side diff with per-line confidence. **Nothing changes until you click Apply.** Multiple warning signals are surfaced before that:

- too few visual lines
- character width could not be estimated
- ≥30% of lines had ambiguous x-offsets
- implausible indent jumps (>2 levels in one step)
- (Python) colon-terminated lines followed by same-or-shallower indentation

Honest framing the UI sticks to:

- The output is called a **proposal**, never a "fix" or "correct version".
- The dialog reminds you to *review every line* before applying.
- Even after applying, the standard warning system continues to run on the new text.

Known limits:
- The algorithm assumes monospace input. Proportional fonts will produce garbage estimates.
- After applying, the cleanup chips re-run from the indented text (not the original OCR). If you wanted a different cleanup combination, toggle the chips before opening the recover modal.
- The "no auto-apply" guarantee only holds if you don't click Apply. There is no automatic mode.

## Deploy to GitHub Pages

1. Push this repo to GitHub.
2. Settings → Pages → Source: `Deploy from a branch`, branch: `main`, folder: `/ (root)`.
3. Live at `https://<you>.github.io/<repo>/`.

## Roadmap

- [ ] PWA / offline support (cache Tesseract WASM + traineddata)
- [ ] Vendored-dependency option for fully self-hosted use
- [ ] Diff preview before applying brace-based indent repair (currently applies live; off by default)
- [ ] Contextual `l`/`1`/`I` and `0`/`O` homoglyph detection (currently only Unicode confusables)
- [ ] Resizable crop selection (currently drag-to-redraw)
- [ ] Multi-image batch
- [ ] Optional, BYOK LLM cleanup — off by default, sends extracted text only, always shows a diff before applying

## License

MIT
