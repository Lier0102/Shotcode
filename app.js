(() => {
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('file-input');
  const previewSection = document.getElementById('preview-section');
  const previewImg = document.getElementById('preview-img');
  const langSelect = document.getElementById('lang-select');
  const rerunBtn = document.getElementById('rerun-btn');
  const resetBtn = document.getElementById('reset-btn');
  const progressWrap = document.getElementById('progress-wrap');
  const progressFill = document.getElementById('progress-fill');
  const progressText = document.getElementById('progress-text');
  const outputWrap = document.getElementById('output-wrap');
  const outputEl = document.getElementById('output');
  const detectedLangEl = document.getElementById('detected-lang');
  const copyBtn = document.getElementById('copy-btn');

  let currentImage = null;
  let worker = null;

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

  // paste from clipboard, anywhere on the page
  document.addEventListener('paste', (e) => {
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
        // Code-friendly Tesseract settings: assume a block of text, allow common code chars
        await worker.setParameters({
          tessedit_pageseg_mode: Tesseract.PSM ? Tesseract.PSM.SINGLE_BLOCK : '6',
          preserve_interword_spaces: '1',
        });
      }

      const { data } = await worker.recognize(currentImage);
      const cleaned = cleanupCode(data.text);
      showOutput(cleaned);
    } catch (err) {
      console.error(err);
      progressText.textContent = 'OCR failed: ' + (err && err.message ? err.message : err);
    } finally {
      rerunBtn.disabled = false;
    }
  }

  function cleanupCode(text) {
    // Tesseract often appends a trailing form-feed / extra blank lines
    let out = text.replace(/\f/g, '').replace(/[ ]/g, ' ');
    // Trim trailing whitespace per line
    out = out.split('\n').map((l) => l.replace(/[ \t]+$/, '')).join('\n');
    // Collapse 3+ blank lines into 2
    out = out.replace(/\n{3,}/g, '\n\n');
    // Strip leading/trailing blank lines
    out = out.replace(/^\s*\n+/, '').replace(/\n+\s*$/, '\n');
    return out;
  }

  // ---------- output rendering ----------
  function showOutput(text) {
    progressWrap.classList.add('hidden');
    outputWrap.classList.remove('hidden');

    const selected = langSelect.value;
    outputEl.textContent = text;
    // reset any previous highlight state
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
  }

  langSelect.addEventListener('change', () => {
    if (!outputWrap.classList.contains('hidden')) {
      // Re-render with the current text and new language
      const text = outputEl.textContent;
      showOutput(text);
    }
  });

  rerunBtn.addEventListener('click', () => runOCR());

  resetBtn.addEventListener('click', () => {
    currentImage = null;
    fileInput.value = '';
    previewImg.removeAttribute('src');
    previewSection.classList.add('hidden');
    outputWrap.classList.add('hidden');
    progressWrap.classList.add('hidden');
    outputEl.textContent = '';
  });

  // ---------- copy ----------
  copyBtn.addEventListener('click', async () => {
    const text = outputEl.textContent;
    try {
      await navigator.clipboard.writeText(text);
      copyBtn.textContent = 'Copied!';
      copyBtn.classList.add('copied');
      setTimeout(() => {
        copyBtn.textContent = 'Copy';
        copyBtn.classList.remove('copied');
      }, 1500);
    } catch {
      // Fallback
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      copyBtn.textContent = 'Copied!';
      setTimeout(() => (copyBtn.textContent = 'Copy'), 1500);
    }
  });

  function capitalize(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
})();
