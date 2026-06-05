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

**Verification**
- Per-word confidence underlines in Review view (wavy amber for &lt;70%, wavy red for &lt;50%)
- Structured warnings for unbalanced brackets / braces / parens / quotes — with line:column and a "jump" button
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

## Deploy to GitHub Pages

1. Push this repo to GitHub.
2. Settings → Pages → Source: `Deploy from a branch`, branch: `main`, folder: `/ (root)`.
3. Live at `https://<you>.github.io/<repo>/`.

## Roadmap

- [ ] PWA / offline support (cache Tesseract WASM + traineddata)
- [ ] Vendored-dependency option for fully self-hosted use
- [ ] Brace-based indentation repair with diff preview
- [ ] Char-level homoglyph and Unicode confusable flags
- [ ] Resizable crop selection (currently drag-to-redraw)
- [ ] Multi-image batch
- [ ] Optional, BYOK LLM cleanup — off by default, sends extracted text only, always shows a diff before applying

## License

MIT
