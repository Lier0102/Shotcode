(() => {
  // ============================================================
  //  DOM refs
  // ============================================================
  const $ = (id) => document.getElementById(id);

  const dropzone = $('dropzone');
  const fileInput = $('file-input');
  const controlsBar = $('controls-bar');
  const panes = $('panes');

  const langSelect = $('lang-select');
  const cleanupNormalize = $('cleanup-normalize');
  const cleanupLineNums = $('cleanup-line-nums');
  const cleanupPrompts = $('cleanup-prompts');
  const cleanupIndent = $('cleanup-indent');
  const presetSelect = $('preset-select');
  const presetDescription = $('preset-description');
  const rerunBtn = $('rerun-btn');
  const resetBtn = $('reset-btn');

  const progressWrap = $('progress-wrap');
  const progressFill = $('progress-fill');
  const progressText = $('progress-text');
  const cancelBtn = $('cancel-btn');

  const retryBanner = $('retry-banner');
  const retryMessage = $('retry-message');
  const retryActions = $('retry-actions');
  const retryDismiss = $('retry-dismiss');

  const previewImg = $('preview-img');
  const imageContainer = $('image-container');
  const imageStage = $('image-stage');
  const cropOverlay = $('crop-overlay');
  const cropRectEl = $('crop-rect');
  const selectionInfo = $('selection-info');

  const cropClearBtn = $('crop-clear-btn');
  const zoomInBtn = $('zoom-in-btn');
  const zoomOutBtn = $('zoom-out-btn');
  const zoomFitBtn = $('zoom-fit-btn');

  const detectedLangEl = $('detected-lang');
  const confidenceEl = $('confidence-badge');
  const warningsEl = $('warnings');
  const warningsSummary = $('warnings-summary');
  const warningsCount = $('warnings-count');
  const warningsList = $('warnings-list');
  const outputPre = $('output-pre');
  const outputEl = $('output');
  const editArea = $('edit-area');
  const reviewView = $('review-view');

  const viewBtn = $('view-btn');
  const editBtn = $('edit-btn');
  const downloadBtn = $('download-btn');
  const copyBtn = $('copy-btn');

  // ============================================================
  //  State
  // ============================================================
  let currentImage = null;     // File
  let loadedImage = null;      // HTMLImageElement
  let rawText = '';
  let rawWords = [];
  let currentText = '';
  let lastConfidence = null;
  let worker = null;
  let isEditing = false;
  let isReview = false;

  let zoom = 1;
  let imgW = 0, imgH = 0;
  let cropRect = null;
  let dragStart = null;

  let currentPresetId = 'auto';
  let ocrJobId = 0;            // monotonic; owns "current run"
  let ocrRunning = false;

  const LANG_TO_EXT = {
    python: 'py', javascript: 'js', typescript: 'ts', bash: 'sh',
    go: 'go', rust: 'rs', java: 'java', c: 'c', cpp: 'cpp',
    csharp: 'cs', ruby: 'rb', php: 'php', sql: 'sql',
    html: 'html', css: 'css', json: 'json', yaml: 'yaml',
    markdown: 'md', plaintext: 'txt',
  };

  // ============================================================
  //  Preprocessing presets (DSL)
  // ============================================================
  const PREPROCESS_PRESETS = [
    { id: 'auto', label: 'Auto', description: 'Upscale, grayscale, auto-invert dark, mild contrast',
      steps: [
        { op: 'upscale', targetWidth: 1400 },
        { op: 'grayscale' },
        { op: 'invertIfDark' },
        { op: 'contrast', amount: 1.5 },
      ] },
    { id: 'light', label: 'Light theme', description: 'For IDE / editor light themes',
      steps: [
        { op: 'upscale', targetWidth: 1400 },
        { op: 'grayscale' },
        { op: 'contrast', amount: 1.3 },
      ] },
    { id: 'dark', label: 'Dark theme', description: 'Forces invert before contrast',
      steps: [
        { op: 'upscale', targetWidth: 1400 },
        { op: 'grayscale' },
        { op: 'invert' },
        { op: 'contrast', amount: 1.5 },
      ] },
    { id: 'low-contrast', label: 'Low contrast', description: 'Aggressive contrast for faded shots',
      steps: [
        { op: 'upscale', targetWidth: 1600 },
        { op: 'grayscale' },
        { op: 'invertIfDark' },
        { op: 'contrast', amount: 2.2 },
      ] },
    { id: 'tiny-font', label: 'Tiny font', description: 'Heavier upscale + sharpen',
      steps: [
        { op: 'upscale', targetWidth: 2000 },
        { op: 'grayscale' },
        { op: 'invertIfDark' },
        { op: 'contrast', amount: 1.4 },
        { op: 'sharpen', amount: 0.5 },
      ] },
    { id: 'terminal', label: 'Terminal', description: 'Dark terminal with threshold',
      steps: [
        { op: 'upscale', targetWidth: 1400 },
        { op: 'grayscale' },
        { op: 'invert' },
        { op: 'contrast', amount: 1.7 },
        { op: 'threshold', method: 'fixed', value: 140 },
      ] },
    { id: 'none', label: 'None (raw)', description: 'Skip preprocessing entirely', steps: [] },
  ];

  function getPreset(id) { return PREPROCESS_PRESETS.find(p => p.id === id); }

  function sourceToCanvas(src) {
    if (src instanceof HTMLCanvasElement) return src;
    const w = src.naturalWidth || src.width;
    const h = src.naturalHeight || src.height;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(src, 0, 0);
    return c;
  }

  function mapPixels(canvas, fn) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    fn(img.data, canvas.width, canvas.height);
    ctx.putImageData(img, 0, 0);
    return canvas;
  }

  function stepUpscale(canvas, { targetWidth }) {
    if (canvas.width >= targetWidth) return canvas;
    const scale = Math.min(3, targetWidth / canvas.width);
    const out = document.createElement('canvas');
    out.width = Math.round(canvas.width * scale);
    out.height = Math.round(canvas.height * scale);
    const ctx = out.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(canvas, 0, 0, out.width, out.height);
    return out;
  }

  function stepGrayscale(canvas) {
    return mapPixels(canvas, (d) => {
      for (let i = 0; i < d.length; i += 4) {
        const g = 0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2];
        d[i] = d[i+1] = d[i+2] = g;
      }
    });
  }

  function stepInvert(canvas) {
    return mapPixels(canvas, (d) => {
      for (let i = 0; i < d.length; i += 4) {
        d[i] = 255 - d[i]; d[i+1] = 255 - d[i+1]; d[i+2] = 255 - d[i+2];
      }
    });
  }

  function stepInvertIfDark(canvas) {
    // Sample-based mean luminance — cheaper than scanning everything
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = img.data;
    const stride = Math.max(4, Math.floor(d.length / 4 / 50000)) * 4;
    let sum = 0, n = 0;
    for (let i = 0; i < d.length; i += stride) {
      sum += 0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2];
      n++;
    }
    return (sum / n) < 128 ? stepInvert(canvas) : canvas;
  }

  function stepContrast(canvas, { amount }) {
    return mapPixels(canvas, (d) => {
      for (let i = 0; i < d.length; i += 4) {
        for (let k = 0; k < 3; k++) {
          let v = (d[i+k] - 128) * amount + 128;
          d[i+k] = v < 0 ? 0 : v > 255 ? 255 : v;
        }
      }
    });
  }

  function stepThreshold(canvas, { value = 128 } = {}) {
    return mapPixels(canvas, (d) => {
      for (let i = 0; i < d.length; i += 4) {
        const g = 0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2];
        const v = g < value ? 0 : 255;
        d[i] = d[i+1] = d[i+2] = v;
      }
    });
  }

  // 3x3 unsharp mask: out = src * (1 + amount) - blur * amount (approx via sharpen kernel)
  function stepSharpen(canvas, { amount = 0.5 } = {}) {
    const w = canvas.width, h = canvas.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const src = ctx.getImageData(0, 0, w, h);
    const out = ctx.createImageData(w, h);
    const s = src.data, o = out.data;
    const center = 1 + 4 * amount;
    const side = -amount;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        for (let k = 0; k < 3; k++) {
          let v = s[i + k] * center;
          if (x > 0)     v += s[i - 4 + k] * side;
          if (x < w - 1) v += s[i + 4 + k] * side;
          if (y > 0)     v += s[i - w * 4 + k] * side;
          if (y < h - 1) v += s[i + w * 4 + k] * side;
          o[i + k] = v < 0 ? 0 : v > 255 ? 255 : v;
        }
        o[i + 3] = s[i + 3];
      }
    }
    ctx.putImageData(out, 0, 0);
    return canvas;
  }

  const STEP_FNS = {
    upscale: stepUpscale, grayscale: stepGrayscale, invert: stepInvert,
    invertIfDark: stepInvertIfDark, contrast: stepContrast,
    threshold: stepThreshold, sharpen: stepSharpen,
  };

  function applyPreset(source, presetId) {
    const preset = getPreset(presetId);
    if (!preset || !preset.steps.length) return source;
    let canvas = sourceToCanvas(source);
    for (const step of preset.steps) {
      const fn = STEP_FNS[step.op];
      if (fn) canvas = fn(canvas, step);
    }
    return canvas;
  }

  function populatePresetSelect() {
    for (const p of PREPROCESS_PRESETS) {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.label;
      opt.title = p.description;
      presetSelect.appendChild(opt);
    }
    presetSelect.value = currentPresetId;
    updatePresetDescription();
  }

  function updatePresetDescription() {
    const p = getPreset(currentPresetId);
    presetDescription.textContent = p ? p.description : '';
  }

  // ============================================================
  //  File handling
  // ============================================================
  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
  });

  fileInput.addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) handleFile(f);
  });

  ['dragenter', 'dragover'].forEach((evt) => {
    dropzone.addEventListener(evt, (e) => { e.preventDefault(); dropzone.classList.add('drag-over'); });
  });
  ['dragleave', 'drop'].forEach((evt) => {
    dropzone.addEventListener(evt, (e) => { e.preventDefault(); dropzone.classList.remove('drag-over'); });
  });

  dropzone.addEventListener('drop', (e) => {
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f && f.type.startsWith('image/')) handleFile(f);
  });

  document.addEventListener('dragover', (e) => {
    if (panes.classList.contains('hidden')) return;
    e.preventDefault();
  });
  document.addEventListener('drop', (e) => {
    if (panes.classList.contains('hidden')) return;
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f && f.type.startsWith('image/')) { e.preventDefault(); handleFile(f); }
  });

  document.addEventListener('paste', (e) => {
    if (isEditing) return;
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const f = item.getAsFile();
        if (f) { handleFile(f); e.preventDefault(); break; }
      }
    }
  });

  async function handleFile(file) {
    if (!file.type.startsWith('image/')) { alert('Please drop an image file.'); return; }
    currentImage = file;
    cropRect = null;
    clearRetryBanner();

    const url = URL.createObjectURL(file);
    previewImg.src = url;
    await new Promise((resolve, reject) => {
      previewImg.onload = resolve;
      previewImg.onerror = reject;
    });
    loadedImage = previewImg;
    imgW = previewImg.naturalWidth;
    imgH = previewImg.naturalHeight;

    dropzone.classList.add('hidden');
    controlsBar.classList.remove('hidden');
    panes.classList.remove('hidden');

    fitZoom();
    updateCropUI();
    runOCR();
  }

  // ============================================================
  //  Zoom + crop
  // ============================================================
  function fitZoom() {
    const cw = imageContainer.clientWidth - 32;
    const ch = imageContainer.clientHeight - 32;
    if (cw <= 0 || ch <= 0 || !imgW || !imgH) { setZoom(1); return; }
    setZoom(Math.min(cw / imgW, ch / imgH, 1));
  }

  function setZoom(z) {
    zoom = Math.max(0.1, Math.min(6, z));
    previewImg.style.width = (imgW * zoom) + 'px';
    previewImg.style.height = (imgH * zoom) + 'px';
    cropOverlay.style.width = (imgW * zoom) + 'px';
    cropOverlay.style.height = (imgH * zoom) + 'px';
    updateCropUI();
  }

  zoomInBtn.addEventListener('click', () => setZoom(zoom * 1.25));
  zoomOutBtn.addEventListener('click', () => setZoom(zoom / 1.25));
  zoomFitBtn.addEventListener('click', () => fitZoom());

  function updateCropUI() {
    if (!cropRect) {
      cropOverlay.classList.add('hidden');
      cropClearBtn.disabled = true;
      selectionInfo.textContent = 'Drag to select a region';
      return;
    }
    cropOverlay.classList.remove('hidden');
    cropRectEl.style.left = (cropRect.x * zoom) + 'px';
    cropRectEl.style.top = (cropRect.y * zoom) + 'px';
    cropRectEl.style.width = (cropRect.w * zoom) + 'px';
    cropRectEl.style.height = (cropRect.h * zoom) + 'px';
    cropClearBtn.disabled = false;
    selectionInfo.textContent = `Selection: ${Math.round(cropRect.w)} × ${Math.round(cropRect.h)} — Re-run OCR to apply`;
  }

  cropClearBtn.addEventListener('click', () => {
    cropRect = null;
    updateCropUI();
  });

  imageStage.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || !loadedImage) return;
    const rect = imageStage.getBoundingClientRect();
    const x = (e.clientX - rect.left) / zoom;
    const y = (e.clientY - rect.top) / zoom;
    dragStart = { x: clamp(x, 0, imgW), y: clamp(y, 0, imgH) };
    cropRect = { x: dragStart.x, y: dragStart.y, w: 0, h: 0 };
    updateCropUI();
    e.preventDefault();
  });

  window.addEventListener('mousemove', (e) => {
    if (!dragStart) return;
    const rect = imageStage.getBoundingClientRect();
    const x = clamp((e.clientX - rect.left) / zoom, 0, imgW);
    const y = clamp((e.clientY - rect.top) / zoom, 0, imgH);
    cropRect = {
      x: Math.min(dragStart.x, x),
      y: Math.min(dragStart.y, y),
      w: Math.abs(x - dragStart.x),
      h: Math.abs(y - dragStart.y),
    };
    updateCropUI();
  });

  window.addEventListener('mouseup', () => {
    if (!dragStart) return;
    dragStart = null;
    if (!cropRect || cropRect.w < 8 || cropRect.h < 8) {
      cropRect = null;
      updateCropUI();
    }
  });

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  function cropToCanvas(img, rect) {
    const c = document.createElement('canvas');
    c.width = Math.round(rect.w);
    c.height = Math.round(rect.h);
    const ctx = c.getContext('2d');
    ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h, 0, 0, c.width, c.height);
    return c;
  }

  // ============================================================
  //  OCR (with cancel + retry)
  // ============================================================
  async function initWorker() {
    worker = await Tesseract.createWorker('eng', 1, {
      logger: (m) => {
        if (m.status === 'recognizing text') {
          const pct = Math.round(m.progress * 100);
          progressFill.style.width = pct + '%';
          progressText.textContent = `Recognizing text… ${pct}%`;
        } else if (m.status) {
          progressText.textContent = cap(m.status) + '…';
        }
      },
    });
    await worker.setParameters({
      tessedit_pageseg_mode: Tesseract.PSM ? Tesseract.PSM.SINGLE_BLOCK : '6',
      preserve_interword_spaces: '1',
    });
  }

  async function runOCR() {
    if (!loadedImage) return;
    const job = ++ocrJobId;
    ocrRunning = true;
    clearRetryBanner();
    progressWrap.classList.remove('hidden');
    progressFill.style.width = '0%';
    progressText.textContent = 'Initializing OCR…';
    rerunBtn.disabled = true;

    try {
      if (!worker) await initWorker();
      if (job !== ocrJobId) return;

      let source = loadedImage;
      if (cropRect) source = cropToCanvas(loadedImage, cropRect);
      source = applyPreset(source, currentPresetId);

      const { data } = await worker.recognize(source);
      if (job !== ocrJobId) return;

      rawText = data.text;
      rawWords = collectWords(data);
      lastConfidence = data.confidence;
      reapplyCleanup();

      if (typeof data.confidence === 'number' && data.confidence < 60) {
        suggestRetry('lowconf', `${Math.round(data.confidence)}% overall`);
      }
    } catch (err) {
      if (job !== ocrJobId) return;     // cancelled — swallow rejection
      console.error(err);
      progressWrap.classList.add('hidden');
      suggestRetry('fail', err && err.message ? err.message : String(err));
    } finally {
      if (job === ocrJobId) {
        ocrRunning = false;
        rerunBtn.disabled = false;
      }
    }
  }

  async function cancelOCR() {
    if (!ocrRunning) return;
    ocrJobId++;                          // invalidate in-flight
    ocrRunning = false;
    if (worker) {
      const w = worker;
      worker = null;
      try { await w.terminate(); } catch { /* ignore */ }
    }
    progressWrap.classList.add('hidden');
    rerunBtn.disabled = false;
    suggestRetry('cancel');
  }

  cancelBtn.addEventListener('click', () => cancelOCR());

  function suggestRetry(reason, detail) {
    const msg =
      reason === 'cancel'  ? 'OCR cancelled.' :
      reason === 'fail'    ? `OCR failed${detail ? `: ${detail}` : ''}.` :
      reason === 'lowconf' ? `Low confidence${detail ? ` (${detail})` : ''}.` :
                             '';
    retryMessage.textContent = `${msg} Try another preprocessing preset:`;

    const alternatives = PREPROCESS_PRESETS
      .filter(p => p.id !== currentPresetId && p.id !== 'none')
      .slice(0, 3);

    retryActions.replaceChildren();
    for (const p of alternatives) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = p.label;
      btn.title = p.description;
      btn.addEventListener('click', () => {
        currentPresetId = p.id;
        presetSelect.value = p.id;
        updatePresetDescription();
        clearRetryBanner();
        runOCR();
      });
      retryActions.appendChild(btn);
    }
    retryBanner.classList.remove('hidden');
  }

  function clearRetryBanner() {
    retryBanner.classList.add('hidden');
    retryActions.replaceChildren();
  }

  retryDismiss.addEventListener('click', () => clearRetryBanner());

  // Tesseract v5: words may live on data.words OR nested in blocks
  function collectWords(data) {
    if (Array.isArray(data.words) && data.words.length) return data.words;
    const out = [];
    if (Array.isArray(data.blocks)) {
      for (const b of data.blocks) {
        for (const p of (b.paragraphs || [])) {
          for (const l of (p.lines || [])) {
            for (const w of (l.words || [])) out.push(w);
          }
        }
      }
    }
    return out;
  }

  // ============================================================
  //  Cleanup pipeline
  // ============================================================
  function reapplyCleanup() {
    progressWrap.classList.add('hidden');
    panes.classList.remove('hidden');

    let text = rawText;
    if (cleanupNormalize.checked) text = normalizeChars(text);
    if (cleanupLineNums.checked)  text = stripLineNumbers(text);
    if (cleanupPrompts.checked)   text = stripPrompts(text, langSelect.value);
    if (cleanupIndent.checked)    text = normalizeIndent(text);
    text = finalTrim(text);

    currentText = text;
    renderHighlighted(currentText);
    renderConfidence(lastConfidence);
    renderWarnings(buildWarnings(currentText));
    if (isReview) renderReviewView();
    if (isEditing) editArea.value = currentText;
  }

  function normalizeChars(text) {
    let out = text;
    out = out.replace(/[‘’‚‛′]/g, "'");
    out = out.replace(/[“”„‟″]/g, '"');
    out = out.replace(/[–—−]/g, '-');
    out = out.replace(/…/g, '...');
    out = out.replace(/ /g, ' ');                  // NBSP
    out = out.replace(/[​-‍﻿]/g, '');              // zero-width
    out = out.replace(/\f/g, '');
    out = out.replace(/ﬀ/g, 'ff').replace(/ﬁ/g, 'fi').replace(/ﬂ/g, 'fl');
    return out;
  }

  function stripLineNumbers(text) {
    const lines = text.split('\n');
    const nonEmpty = lines.filter(l => l.trim().length > 0);
    if (nonEmpty.length < 3) return text;
    const re = /^\s*\d{1,5}[\s:|.\)]\s+/;
    const matched = nonEmpty.filter(l => re.test(l)).length;
    if (matched < Math.max(3, nonEmpty.length * 0.6)) return text;
    return lines.map(l => l.replace(re, '')).join('\n');
  }

  function stripPrompts(text, lang) {
    const lines = text.split('\n');
    const pyRe = /^\s*(>>>|\.\.\.) ?/;
    const shRe = /^\s*[\$#] /;
    let py = 0, sh = 0;
    for (const l of lines) {
      if (pyRe.test(l)) py++;
      if (shRe.test(l)) sh++;
    }
    const favorsPy = lang === 'python';
    const favorsSh = lang === 'bash';
    if ((py >= 2 || favorsPy) && py >= sh) {
      return lines.map(l => l.replace(pyRe, '')).join('\n');
    }
    if (sh >= 2 || favorsSh) {
      return lines.map(l => l.replace(shRe, '')).join('\n');
    }
    return text;
  }

  function normalizeIndent(text) {
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

  function finalTrim(text) {
    let out = text.split('\n').map(l => l.replace(/[ \t]+$/, '')).join('\n');
    out = out.replace(/\n{3,}/g, '\n\n');
    out = out.replace(/^\s*\n+/, '').replace(/\s+$/, '\n');
    return out;
  }

  // ============================================================
  //  Warnings (structured)
  // ============================================================
  // Returns Warning[] from a single string-and-comment-aware walk over the text.
  function scanBalance(text) {
    const stack = [];
    const warns = [];
    let line = 1, col = 1;
    let inStr = null;        // { ch, line, col } | null
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

  function scanCleanupResidue(text) {
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

  function buildWarnings(text) {
    const all = [...scanBalance(text), ...scanCleanupResidue(text)];
    const sevOrder = { error: 0, warn: 1, info: 2 };
    return all.sort((a, b) => {
      const s = sevOrder[a.severity] - sevOrder[b.severity];
      if (s) return s;
      const al = a.position?.line ?? Infinity;
      const bl = b.position?.line ?? Infinity;
      return al - bl;
    });
  }

  function renderWarnings(warnings) {
    if (!warnings.length) {
      warningsEl.classList.add('hidden');
      warningsEl.classList.remove('has-error');
      warningsList.replaceChildren();
      warningsList.hidden = true;
      warningsSummary.setAttribute('aria-expanded', 'false');
      return;
    }
    warningsEl.classList.remove('hidden');
    const hasError = warnings.some(w => w.severity === 'error');
    warningsEl.classList.toggle('has-error', hasError);

    const n = warnings.length;
    warningsCount.textContent = `${n} issue${n === 1 ? '' : 's'}`;

    warningsList.replaceChildren();
    for (const w of warnings) {
      const li = document.createElement('li');
      li.className = `warning warning-${w.severity}`;

      const pos = document.createElement('span');
      pos.className = 'warning-pos';
      pos.textContent = w.position ? `L${w.position.line}:${w.position.col}` : '—';
      li.appendChild(pos);

      const msg = document.createElement('span');
      msg.className = 'warning-msg';
      msg.textContent = w.message;
      if (w.related) {
        const small = document.createElement('span');
        small.className = 'muted';
        small.textContent = ` (opened at L${w.related.line}:${w.related.col})`;
        msg.appendChild(small);
      }
      li.appendChild(msg);

      const goto = document.createElement('button');
      goto.type = 'button';
      goto.className = 'warning-goto';
      goto.textContent = 'jump';
      if (!w.position) { goto.disabled = true; }
      else goto.addEventListener('click', () => gotoLocation(w.position.line));
      li.appendChild(goto);

      warningsList.appendChild(li);
    }
  }

  warningsSummary.addEventListener('click', () => {
    const expanded = warningsSummary.getAttribute('aria-expanded') === 'true';
    warningsSummary.setAttribute('aria-expanded', String(!expanded));
    warningsList.hidden = expanded;
  });

  function gotoLocation(targetLine /* 1-based */) {
    // If we're in edit mode, focus the textarea and place caret at line start.
    if (isEditing) {
      const lines = editArea.value.split('\n');
      let offset = 0;
      for (let i = 0; i < Math.min(targetLine - 1, lines.length); i++) {
        offset += lines[i].length + 1;
      }
      editArea.focus();
      editArea.setSelectionRange(offset, offset);
      return;
    }
    // Review view doesn't share line geometry with the highlighted view;
    // switch back to code so the scroll target is actually visible.
    if (isReview) setViewMode('code');
    const cs = getComputedStyle(outputEl);
    const lineHeight = parseFloat(cs.lineHeight) || 21;
    const padTop = parseFloat(cs.paddingTop) || 0;
    const top = padTop + (targetLine - 1) * lineHeight - 24;
    outputPre.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  }

  // ============================================================
  //  Output rendering
  // ============================================================
  function renderHighlighted(text) {
    const selected = langSelect.value;
    outputEl.textContent = text;
    outputEl.removeAttribute('data-highlighted');
    outputEl.className = 'hljs';

    let detected = selected;
    if (selected === 'auto') {
      const result = hljs.highlightAuto(text);
      detected = result.language || 'plaintext';
      outputEl.classList.add('language-' + detected);
      outputEl.innerHTML = result.value;
    } else {
      outputEl.classList.add('language-' + selected);
      try {
        outputEl.innerHTML = hljs.highlight(text, { language: selected }).value;
      } catch {
        outputEl.textContent = text;
      }
    }
    detectedLangEl.textContent = detected;
    detectedLangEl.dataset.lang = detected;
  }

  function renderConfidence(confidence) {
    if (typeof confidence !== 'number') { confidenceEl.classList.add('hidden'); return; }
    const c = Math.round(confidence);
    confidenceEl.textContent = `${c}% confidence`;
    confidenceEl.classList.remove('hidden', 'low', 'mid', 'high');
    confidenceEl.classList.add(c >= 85 ? 'high' : c >= 65 ? 'mid' : 'low');
  }

  function renderReviewView() {
    reviewView.innerHTML = '';
    if (!rawWords.length) {
      reviewView.textContent = rawText;
      return;
    }
    const frag = document.createDocumentFragment();
    let prevLine = -1;
    let prevRight = null;
    for (const w of rawWords) {
      const lineKey = w.bbox ? Math.round(w.bbox.y0 / 5) * 5 : prevLine + 1;
      if (prevLine !== -1 && lineKey > prevLine + 4) {
        frag.appendChild(document.createTextNode('\n'));
      } else if (prevRight !== null && w.bbox) {
        const gap = w.bbox.x0 - prevRight;
        const spaces = Math.max(1, Math.round(gap / 8));
        frag.appendChild(document.createTextNode(' '.repeat(spaces)));
      } else if (prevLine !== -1) {
        frag.appendChild(document.createTextNode(' '));
      }
      const span = document.createElement('span');
      span.textContent = w.text;
      span.className = 'word';
      const conf = w.confidence ?? 100;
      if (conf < 50) span.classList.add('very-low-conf');
      else if (conf < 70) span.classList.add('low-conf');
      span.title = `${Math.round(conf)}% confidence`;
      frag.appendChild(span);
      prevLine = lineKey;
      prevRight = w.bbox ? w.bbox.x1 : null;
    }
    reviewView.appendChild(frag);
  }

  // ============================================================
  //  View / edit mode
  // ============================================================
  function setViewMode(mode) {
    outputPre.classList.toggle('hidden', mode !== 'code');
    editArea.classList.toggle('hidden', mode !== 'edit');
    reviewView.classList.toggle('hidden', mode !== 'review');

    isEditing = mode === 'edit';
    isReview = mode === 'review';

    editBtn.classList.toggle('active', isEditing);
    editBtn.textContent = isEditing ? 'Done' : 'Edit';
    viewBtn.classList.toggle('active', isReview);
    viewBtn.textContent = isReview ? 'Hide review' : 'Review';
  }

  editBtn.addEventListener('click', () => {
    if (isEditing) {
      currentText = editArea.value;
      renderHighlighted(currentText);
      renderWarnings(buildWarnings(currentText));
      setViewMode(isReview ? 'review' : 'code');
    } else {
      editArea.value = currentText;
      setViewMode('edit');
      editArea.focus();
    }
  });

  viewBtn.addEventListener('click', () => {
    if (isReview) {
      setViewMode(isEditing ? 'edit' : 'code');
    } else {
      renderReviewView();
      setViewMode('review');
    }
  });

  // ============================================================
  //  Wiring
  // ============================================================
  langSelect.addEventListener('change', () => { if (rawText) reapplyCleanup(); });

  [cleanupNormalize, cleanupLineNums, cleanupPrompts, cleanupIndent].forEach((el) =>
    el.addEventListener('change', () => { if (rawText) reapplyCleanup(); })
  );

  presetSelect.addEventListener('change', () => {
    currentPresetId = presetSelect.value;
    updatePresetDescription();
    // Deliberate: do NOT auto-run OCR — keep preset flipping cheap. User hits Re-run.
  });

  rerunBtn.addEventListener('click', () => runOCR());

  resetBtn.addEventListener('click', () => {
    if (ocrRunning) { cancelOCR(); }
    currentImage = null;
    loadedImage = null;
    rawText = '';
    rawWords = [];
    currentText = '';
    lastConfidence = null;
    cropRect = null;
    fileInput.value = '';
    previewImg.removeAttribute('src');
    dropzone.classList.remove('hidden');
    controlsBar.classList.add('hidden');
    panes.classList.add('hidden');
    progressWrap.classList.add('hidden');
    warningsEl.classList.add('hidden');
    outputEl.textContent = '';
    clearRetryBanner();
    setViewMode('code');
  });

  // ============================================================
  //  Copy + download
  // ============================================================
  copyBtn.addEventListener('click', async () => {
    const text = isEditing ? editArea.value : currentText;
    try {
      await navigator.clipboard.writeText(text);
      flashButton(copyBtn, 'Copied!');
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      flashButton(copyBtn, 'Copied!');
    }
  });

  downloadBtn.addEventListener('click', () => {
    const text = isEditing ? editArea.value : currentText;
    const lang = detectedLangEl.dataset.lang || langSelect.value || 'plaintext';
    const ext = LANG_TO_EXT[lang] || 'txt';
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `shotcode.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    flashButton(downloadBtn, 'Saved');
  });

  function flashButton(btn, label) {
    const original = btn.dataset.label || btn.textContent;
    btn.dataset.label = original;
    btn.textContent = label;
    btn.classList.add('flash');
    setTimeout(() => {
      btn.textContent = original;
      btn.classList.remove('flash');
    }, 1500);
  }

  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  // ============================================================
  //  Init
  // ============================================================
  populatePresetSelect();
})();
