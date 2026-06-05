# shotcode

> Drop a screenshot of code. Get clean, copy-pasteable text.

A tiny static web app that runs OCR on a screenshot of code in your browser, then renders the result as a syntax-highlighted, copy-paste-ready code block. No backend, no signup, no images leave your machine.

![demo placeholder — record a GIF showing paste → OCR → copy](docs/demo.gif)

## Why

You see a chunk of code on StackOverflow, in a tweet, in a video, or in a screenshot a coworker sent — and you want to actually use it. Retyping is annoying. This is the smallest possible tool that fixes that.

## Features

- **Drop, click, or paste** (Ctrl+V anywhere on the page) an image
- **In-browser OCR** with [Tesseract.js](https://github.com/naptha/tesseract.js) — nothing uploaded
- **Auto-detected syntax highlighting** via [highlight.js](https://github.com/highlightjs/highlight.js), or pick a language manually
- **One-click copy** to clipboard
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
- [ ] Indentation normalization heuristics
- [ ] PWA / installable
- [ ] Multi-image batch

## License

MIT
