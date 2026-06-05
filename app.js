(() => {
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('file-input');
  const previewSection = document.getElementById('preview-section');
  const previewImg = document.getElementById('preview-img');
  const langSelect = document.getElementById('lang-select');
  const rerunBtn = document.getElementById('rerun-btn');
  const resetBtn = document.getElementById('reset-btn');
  const preprocessToggle = document.getElementById('preprocess-toggle');
  const progressWrap = document.getElementById('progress-wrap');
  const progressFill = document.getElementById('progress-fill');
  const progressText = document.getElementById('progress-text');
  const outputWrap = document.getElementById('output-wrap');
  const outputEl = document.getElementById('output');
  const editArea = document.getElementById('edit-area');
  const detectedLangEl = document.getElementById('detected-lang');
  const confidenceEl = document.getElementById('confidence-badge');
  const copyBtn = document.getElementById('copy-btn');
  const downloadBtn = document.getElementById('download-btn');
  const editBtn = document.getElementById('edit-btn');

  let currentImage = null;
  let currentText = '';
  let worker = null;
  let isEditing = false;

  const LANG_TO_EXT = {
    python: 'py', javascript: 'js', typescript: 'ts', bash: 'sh',
    go: 'go', rust: 'rs', java: 'java', c: 'c', cpp: 'cpp',
    csharp: 'cs', ruby: 'rb', php: 'php', sql: 'sql',
    html: 'html', css: 'css', json: 'json', yaml: 'yaml',
    markdown: 'md', plaintext: 'txt',
  };

  // ---------- file handling ----------
  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInput.click();
    }
  });

  fileInput.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) handleFile(file);
  });

  ['dragenter', 'dragover'].forEach((evt) => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.add('drag-over');
    });
  });

  ['dragleave', 'drop'].forEach((evt) => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove('drag-over');
    });
  });

  dropzone.addEventListener('drop', (e) => {
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) handleFile(file);
  });

  // paste from clipboard, anywhere on the page (unless editing)
  document.addEventListener('paste', (e) => {
    if (isEditing) return;
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          handleFile(file);
          e.preventDefault();
          break;
        }
      }
    }
  });

  function handleFile(file) {
    if (!file.type.startsWith('image/')) {
      alert('Please drop an image file.');
      return;
    }
    currentImage = file;
    const url = URL.createObjectURL(file);
    previewImg.src = url;
    previewSection.classList.remove('hidden');
    outputWrap.classList.add('hidden');
    runOCR();
  }

  // ---------- image preprocessing ----------
  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }

  async function preprocessImage(file) {
    const img = await loadImage(file);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    // Upscale small images — Tesseract needs ~30px-tall characters to be reliable
    const targetMinWidth = 1400;
    const scale = img.naturalWidth < targetMinWidth
      ? Math.min(3, targetMinWidth / img.naturalWidth)
      : 1;

    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    // First pass: mean luminance (to detect dark theme)
    let sum = 0;
    const pixelCount = data.length / 4;
    for (let i = 0; i < data.length; i += 4) {
      sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    }
    const mean = sum / pixelCount;
    const isDarkTheme = mean < 128;

    // Second pass: grayscale, invert if dark, contrast stretch around midpoint
    const contrast = 1.5;
    for (let i = 0; i < data.length; i += 4) {
      let g = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      if (isDarkTheme) g = 255 - g;
      g = (g - 128) * contrast + 128;
      g = g < 0 ? 0 : g > 255 ? 255 : g;
      data[i] = data[i + 1] = data[i + 2] = g;
    }
    ctx.putImageData(imageData, 0, 0);
    return canvas;
  }

  // ---------- OCR ----------
  async function runOCR() {
    if (!currentImage) return;

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
              progressText.textContent = capitalize(m.status) + '…';
            }
          },
        });
        await worker.setParameters({
          tessedit_pageseg_mode: Tesseract.PSM ? Tesseract.PSM.SINGLE_BLOCK : '6',
          preserve_interword_spaces: '1',
        });
      }

      const usePreprocess = preprocessToggle.checked;
      const source = usePreprocess
        ? await preprocessImage(currentImage)
        : currentImage;

      const { data } = await worker.recognize(source);
      const cleaned = cleanupCode(data.text);
      currentText = cleaned;
      showOutput(cleaned, data.confidence);
    } catch (err) {
      console.error(err);
      progressText.textContent = 'OCR failed: ' + (err && err.message ? err.message : err);
    } finally {
      rerunBtn.disabled = false;
    }
  }

  // ---------- post-processing ----------
  function cleanupCode(text) {
    let out = text;
    // Curly/smart quotes → straight (Tesseract loves to insert these)
    out = out.replace(/[‘’‚‛′]/g, "'");
    out = out.replace(/[“”„‟″]/g, '"');
    // Em / en dashes → hyphen-minus (often appears for `--` flags or `->`)
    out = out.replace(/[–—−]/g, '-');
    // Ellipsis → three dots
    out = out.replace(/…/g, '...');
    // Non-breaking / zero-width spaces → regular space / removed
    out = out.replace(/ /g, ' ');
    out = out.replace(/[​-‍﻿]/g, '');
    // Form feeds
    out = out.replace(/\f/g, '');
    // Common ligatures
    out = out.replace(/ﬀ/g, 'ff').replace(/ﬁ/g, 'fi').replace(/ﬂ/g, 'fl');
    // Trim trailing whitespace per line
    out = out.split('\n').map((l) => l.replace(/[ \t]+$/, '')).join('\n');
    // Collapse 3+ blank lines into 2
    out = out.replace(/\n{3,}/g, '\n\n');
    // Strip leading/trailing blank lines, but keep one trailing newline
    out = out.replace(/^\s*\n+/, '').replace(/\s+$/, '\n');
    return out;
  }

  // ---------- output rendering ----------
  function showOutput(text, confidence) {
    progressWrap.classList.add('hidden');
    outputWrap.classList.remove('hidden');

    // exit edit mode if active
    if (isEditing) toggleEdit(false);

    currentText = text;
    renderHighlighted(text);

    if (typeof confidence === 'number') {
      const c = Math.round(confidence);
      confidenceEl.textContent = `${c}% confidence`;
      confidenceEl.classList.remove('hidden', 'low', 'mid', 'high');
      confidenceEl.classList.add(c >= 85 ? 'high' : c >= 65 ? 'mid' : 'low');
    } else {
      confidenceEl.classList.add('hidden');
    }
  }

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

  langSelect.addEventListener('change', () => {
    if (outputWrap.classList.contains('hidden')) return;
    renderHighlighted(currentText);
  });

  rerunBtn.addEventListener('click', () => runOCR());

  preprocessToggle.addEventListener('change', () => {
    if (currentImage) runOCR();
  });

  resetBtn.addEventListener('click', () => {
    currentImage = null;
    currentText = '';
    fileInput.value = '';
    previewImg.removeAttribute('src');
    previewSection.classList.add('hidden');
    outputWrap.classList.add('hidden');
    progressWrap.classList.add('hidden');
    outputEl.textContent = '';
    if (isEditing) toggleEdit(false);
  });

  // ---------- edit mode ----------
  function toggleEdit(forceState) {
    const next = typeof forceState === 'boolean' ? forceState : !isEditing;
    if (next === isEditing) return;
    isEditing = next;

    if (isEditing) {
      editArea.value = currentText;
      editArea.classList.remove('hidden');
      outputEl.parentElement.classList.add('hidden'); // hide <pre>
      editBtn.textContent = 'Done';
      editBtn.classList.add('active');
      editArea.focus();
    } else {
      currentText = editArea.value;
      renderHighlighted(currentText);
      editArea.classList.add('hidden');
      outputEl.parentElement.classList.remove('hidden');
      editBtn.textContent = 'Edit';
      editBtn.classList.remove('active');
    }
  }

  editBtn.addEventListener('click', () => toggleEdit());

  // ---------- copy ----------
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

  // ---------- download ----------
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

  function capitalize(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
})();
