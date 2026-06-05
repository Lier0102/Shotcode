(() => {
  // ---------- DOM ----------
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
  const preprocessToggle = $('preprocess-toggle');
  const rerunBtn = $('rerun-btn');
  const resetBtn = $('reset-btn');

  const progressWrap = $('progress-wrap');
  const progressFill = $('progress-fill');
  const progressText = $('progress-text');

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
  const outputPre = $('output-pre');
  const outputEl = $('output');
  const editArea = $('edit-area');
  const reviewView = $('review-view');

  const viewBtn = $('view-btn');
  const editBtn = $('edit-btn');
  const downloadBtn = $('download-btn');
  const copyBtn = $('copy-btn');

  // ---------- state ----------
  let currentImage = null;     // File
  let loadedImage = null;      // HTMLImageElement
  let rawText = '';            // raw OCR text
  let rawWords = [];           // Tesseract word objects
  let currentText = '';        // cleaned text
  let lastConfidence = null;
  let worker = null;
  let isEditing = false;
  let isReview = false;

  let zoom = 1;
  let imgW = 0, imgH = 0;
  let cropRect = null;         // { x, y, w, h } in natural-image pixels
  let dragStart = null;

  const LANG_TO_EXT = {
    python: 'py', javascript: 'js', typescript: 'ts', bash: 'sh',
    go: 'go', rust: 'rs', java: 'java', c: 'c', cpp: 'cpp',
    csharp: 'cs', ruby: 'rb', php: 'php', sql: 'sql',
    html: 'html', css: 'css', json: 'json', yaml: 'yaml',
    markdown: 'md', plaintext: 'txt',
  };

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

  // Drop anywhere once panes are showing
  document.addEventListener('dragover', (e) => {
    if (panes.classList.contains('hidden')) return;
    e.preventDefault();
  });
  document.addEventListener('drop', (e) => {
    if (panes.classList.contains('hidden')) return;
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f && f.type.startsWith('image/')) { e.preventDefault(); handleFile(f); }
  });

  // Paste
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

    // Load to <img>
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

  // Drag-to-select
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
  //  Preprocessing
  // ============================================================
  function preprocessSource(source) {
    const srcW = source.naturalWidth || source.width;
    const srcH = source.naturalHeight || source.height;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    const targetMinWidth = 1400;
    const scale = srcW < targetMinWidth ? Math.min(3, targetMinWidth / srcW) : 1;

    canvas.width = Math.round(srcW * scale);
    canvas.height = Math.round(srcH * scale);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    // Mean luminance for dark-theme detection
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) {
      sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    }
    const mean = sum / (data.length / 4);
    const dark = mean < 128;
    const contrast = 1.5;

    for (let i = 0; i < data.length; i += 4) {
      let g = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      if (dark) g = 255 - g;
      g = (g - 128) * contrast + 128;
      g = g < 0 ? 0 : g > 255 ? 255 : g;
      data[i] = data[i + 1] = data[i + 2] = g;
    }
    ctx.putImageData(imageData, 0, 0);
    return canvas;
  }

  // ============================================================
  //  OCR
  // ============================================================
  async function runOCR() {
    if (!loadedImage) return;

    progressWrap.classList.remove('hidden');
    progressFill.style.width = '0%';
    progressText.textContent = 'Initializing OCR…';
    rerunBtn.disabled = true;

    try {
      if (!worker) {
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

      let source = loadedImage;
      if (cropRect) source = cropToCanvas(loadedImage, cropRect);
      if (preprocessToggle.checked) source = preprocessSource(source);

      const { data } = await worker.recognize(source);
      rawText = data.text;
      rawWords = collectWords(data);
      lastConfidence = data.confidence;
      reapplyCleanup();
    } catch (err) {
      console.error(err);
      progressText.textContent = 'OCR failed: ' + (err && err.message ? err.message : err);
    } finally {
      rerunBtn.disabled = false;
    }
  }

  // Tesseract v5 may give words on data.words OR nested under blocks/paragraphs/lines.
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
  //  Cleanup
  // ============================================================
  function reapplyCleanup() {
    progressWrap.classList.add('hidden');
    panes.classList.remove('hidden');

    let text = rawText;
    if (cleanupNormalize.checked) text = normalizeChars(text);
    if (cleanupLineNums.checked) text = stripLineNumbers(text);
    if (cleanupPrompts.checked) text = stripPrompts(text, langSelect.value);
    if (cleanupIndent.checked) text = normalizeIndent(text);
    text = finalTrim(text);

    currentText = text;
    renderHighlighted(currentText);
    renderConfidence(lastConfidence);
    renderWarnings(detectSuspicious(currentText));
    if (isReview) renderReviewView();
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

  // Strip leading line numbers if most non-empty lines have them
  function stripLineNumbers(text) {
    const lines = text.split('\n');
    const nonEmpty = lines.filter(l => l.trim().length > 0);
    if (nonEmpty.length < 3) return text;
    const re = /^\s*\d+[\s:|.\)]\s+/;
    const matched = nonEmpty.filter(l => re.test(l)).length;
    if (matched < Math.max(3, nonEmpty.length * 0.6)) return text;
    return lines.map(l => l.replace(re, '')).join('\n');
  }

  // Strip Python or shell prompts (whichever dominates)
  function stripPrompts(text, lang) {
    const lines = text.split('\n');
    const pyRe = /^\s*(>>>|\.\.\.)\s?/;
    const shRe = /^\s*[\$#]\s+/;
    let py = 0, sh = 0;
    for (const l of lines) {
      if (pyRe.test(l)) py++;
      if (shRe.test(l)) sh++;
    }
    // Respect explicit language pick
    const langFavorsPy = lang === 'python';
    const langFavorsSh = lang === 'bash';
    if ((py >= 2 || langFavorsPy) && py >= sh) {
      return lines.map(l => l.replace(pyRe, '')).join('\n');
    }
    if (sh >= 2 || langFavorsSh) {
      return lines.map(l => l.replace(shRe, '')).join('\n');
    }
    return text;
  }

  // Tabs → 4 spaces, then strip common leading indent
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
  //  Warnings (suspicious patterns)
  // ============================================================
  function detectSuspicious(text) {
    const issues = [];
    const counts = { '(': 0, ')': 0, '[': 0, ']': 0, '{': 0, '}': 0 };
    let inSingle = false, inDouble = false, inBacktick = false, escaped = false;
    for (const c of text) {
      if (escaped) { escaped = false; continue; }
      if (c === '\\') { escaped = true; continue; }
      if (!inDouble && !inBacktick && c === "'") inSingle = !inSingle;
      else if (!inSingle && !inBacktick && c === '"') inDouble = !inDouble;
      else if (!inSingle && !inDouble && c === '`') inBacktick = !inBacktick;
      else if (!inSingle && !inDouble && !inBacktick && c in counts) counts[c]++;
    }
    if (counts['('] !== counts[')']) issues.push(`Unbalanced parentheses (${counts['(']} open, ${counts[')']} close)`);
    if (counts['['] !== counts[']']) issues.push(`Unbalanced brackets (${counts['[']} open, ${counts[']']} close)`);
    if (counts['{'] !== counts['}']) issues.push(`Unbalanced braces (${counts['{']} open, ${counts['}']} close)`);
    if (/[‘’“”]/.test(text)) issues.push('Smart quotes still present — toggle "Normalize chars" or fix manually');
    if (/[–—]/.test(text)) issues.push('En/em dashes still present — these are usually `-` in code');
    return issues;
  }

  function renderWarnings(issues) {
    if (!issues.length) { warningsEl.classList.add('hidden'); warningsEl.innerHTML = ''; return; }
    const ul = document.createElement('ul');
    for (const i of issues) {
      const li = document.createElement('li');
      li.textContent = i;
      ul.appendChild(li);
    }
    warningsEl.innerHTML = '';
    warningsEl.appendChild(ul);
    warningsEl.classList.remove('hidden');
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
    // mode: 'code' | 'edit' | 'review'
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
      renderWarnings(detectSuspicious(currentText));
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
  langSelect.addEventListener('change', () => {
    if (!rawText) return;
    reapplyCleanup();
  });

  [cleanupNormalize, cleanupLineNums, cleanupPrompts, cleanupIndent].forEach((el) =>
    el.addEventListener('change', () => { if (rawText) reapplyCleanup(); })
  );

  preprocessToggle.addEventListener('change', () => { if (loadedImage) runOCR(); });

  rerunBtn.addEventListener('click', () => runOCR());

  resetBtn.addEventListener('click', () => {
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
})();
