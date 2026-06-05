# shotcode

> Drop a screenshot of code. Get clean, copy-pasteable text.

A tiny static web app that runs OCR on a screenshot of code in your browser, then renders the result as a syntax-highlighted, copy-paste-ready code block. No backend, no signup, no images leave your machine.

![demo placeholder — record a GIF showing paste → OCR → copy](docs/demo.gif)

## Why

You see a chunk of code on StackOverflow, in a tweet, in a video, or in a screenshot a coworker sent — and you want to actually use it. Retyping is annoying. This is the smallest possible tool that fixes that.

## Features

- **Side-by-side workspace**: original image on the left, editable result on the right
- **Drag-to-select a region** before OCR — skip browser chrome, line numbers, and editor gutters by feeding only the code area to the recognizer (big accuracy win)
- **Zoom controls** (in / out / fit) for precise cropping on dense screenshots
- **Drop, click, or paste** (Ctrl+V anywhere) to load an image
- **In-browser OCR** with [Tesseract.js](https://github.com/naptha/tesseract.js) — nothing uploaded
- **Image enhancement pipeline**: upscales small screenshots, boosts contrast, and inverts dark themes
- **Toggleable cleanup** rules, all applied live without re-running OCR:
  - normalize smart quotes / dashes / NBSPs / zero-width chars / ligatures
  - strip leading line numbers (auto-detected)
  - strip Python `>>>`/`...` or shell `$`/`#` prompts (auto-detected, language-aware)
  - normalize indentation (tabs → 4 spaces, de-indent common leading whitespace)
- **Suspicious-pattern warnings**: flags unbalanced brackets/braces/parens and residual smart quotes
- **Review view** with per-word confidence underlines (wavy amber for &lt;70%, wavy red for &lt;50%) — hover for the exact score
- **Auto-detected syntax highlighting** via [highlight.js](https://github.com/highlightjs/highlight.js), or pick a language manually
- **In-place editing** for fixing the inevitable `l`/`1` or `O`/`0` slip
- **Copy or download** as a file with the right extension
- **Zero build step** — plain HTML/CSS/JS, deploys to GitHub Pages or any static host

## Run locally

It's a static site. Pick one:

```bash
# Python
python -m http.server 8000

# Node
npx serve .
```

Then open <http://localhost:8000>.

## Deploy to GitHub Pages

1. Push this repo to GitHub.
2. Settings → Pages → Source: `Deploy from a branch`, branch: `main`, folder: `/ (root)`.
3. Done. Your app is live at `https://<you>.github.io/<repo>/`.

## Limits & honest caveats

- Tesseract is good but not magic on code. Tiny fonts, low contrast, anti-aliased screenshots, and dark themes all hurt accuracy. Try the lightest theme + largest font you can.
- It currently OCRs English only (the `eng` traineddata). Code characters work, but exotic Unicode probably won't.
- Common confusions: `l` vs `1` vs `I`, `0` vs `O`, smart quotes, and lost indentation. Always eyeball the output before pasting into prod.

## Roadmap

- [ ] Optional "clean with LLM" mode (bring your own API key, stays client-side)
- [ ] Resizable crop selection (currently drag-to-redraw)
- [ ] Smarter indent recovery (detect modal indent unit, snap leading whitespace)
- [ ] PWA / installable, with the Tesseract model cached
- [ ] Multi-image batch

## License

MIT
