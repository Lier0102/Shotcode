# Manual QA: Visual Indent Recovery (Python)

This checklist exercises the parts of visual indent recovery that the
automated harness can't reach: real OCR, real bbox data, DOM interaction,
focus management, and the post-apply pipeline.

**Estimated time:** 25–35 minutes for a full pass.

**Prerequisites**
- Serve over HTTP (`python -m http.server 8000`) — `file://` will fail under CSP.
- Have a few Python screenshots ready:
  1. Simple class with one method (light theme preferred).
  2. Class with nested `if` / `for` (the previous AbstractHTTPClient screenshot works).
  3. Decorated method (e.g. `@property`, `@abstractmethod`).
  4. Function with a long type annotation (`Optional[Dict[str, Any]]`-style).
  5. `async def` method.
  6. Multi-line function signature with hanging close paren.

---

## 1. Modal interaction (regression of the `<dialog>` → `<div>` fix)

Open one Python screenshot, let OCR finish, click **Recover indent**.

- [ ] Modal opens **centered** in the viewport (not at the top edge).
- [ ] Backdrop dims the page behind it (visibly blurred / darkened).
- [ ] Initial focus lands on the **Cancel** button.
- [ ] Body scroll is locked while the modal is open (try scrolling the page — should not move).

Now exercise every close path. After each, re-open the modal and try the next:

- [ ] **× button** closes the modal.
- [ ] **Cancel button** closes the modal.
- [ ] **Backdrop click** (click outside the modal card) closes the modal.
- [ ] **Escape key** closes the modal.
- [ ] **Apply button** closes the modal *and* applies the proposal.

After closing:

- [ ] Body scroll is restored.
- [ ] No console errors or warnings related to the modal.

---

## 2. Language gating

- [ ] With `auto-detect` + Python screenshot loaded → button is visible only after detection lands on `python`.
- [ ] Switch language to `javascript` → button hides immediately.
- [ ] Switch language to `java` → button hides.
- [ ] Switch back to `python` → button reappears.
- [ ] Switch to `auto` before OCR has run (no rawText) → button hidden.
- [ ] While OCR is running (use a large screenshot to give yourself a window) → button hidden.
- [ ] After **New image / Reset** → button hidden, modal closed if open.

Brace-repair regression:

- [ ] With Python selected, the **Repair indent (brace)** chip is disabled (greyed out).
- [ ] Switching to a brace language enables it again.

---

## 3. Content cases

For each screenshot, click **Recover indent**, read the diff carefully, then Apply.
Verify the expected indent levels are produced.

### 3a. Simple class with method
Expected layout after Apply:
```python
class Foo:
    def bar(self):
        return 1
```
- [ ] `class` line unchanged.
- [ ] `def` line at 4 spaces.
- [ ] body line at 8 spaces.

### 3b. Method with nested if
Expected:
```python
class Foo:
    def bar(self, x):
        if x > 0:
            return 1
        return 0
```
- [ ] `if` and trailing `return 0` both at 8 spaces.
- [ ] `return 1` inside the `if` at 12 spaces.

### 3c. Decorator preservation
Expected:
```python
class A:
    @property
    def name(self):
        return self._name
```
- [ ] `@property` at 4 spaces (same as `def`).
- [ ] body line at 8 spaces.

### 3d. Blank line preservation
With a class containing two methods separated by a blank line:
- [ ] The blank line in the proposal stays blank (not collapsed, not consumed by a visual line).
- [ ] Second method indents at the same depth as the first.

### 3e. Comment lines
With comments at both module and method level:
- [ ] Module-level `#` comment at column 0.
- [ ] Method-body `#` comment indented to the body level (8 spaces inside a class method).

### 3f. Long type annotation
Function with `Optional[Dict[str, Any]] = None`:
- [ ] The long token does **not** destabilize the per-char width estimate.
- [ ] The metrics row in the modal shows a `char width` near what you'd expect for the screenshot's font size (no wild outlier).
- [ ] Body line indents to the expected level.

### 3g. async def
```python
async def fetch(url):
    return await get(url)
```
- [ ] `async def` line at column 0.
- [ ] body line at 4 spaces.

### 3h. Multi-line function signature (line wrap)
```python
def foo(
    arg1,
    arg2,
):
    pass
```
- [ ] Continuation lines (`arg1`, `arg2`) indent to 4 spaces.
- [ ] The hanging `):` returns to column 0 (matches the screenshot).
- [ ] `pass` indents to 4 spaces.

### 3i. Completely lost leading whitespace (the headline scenario)
Use the AbstractHTTPClient screenshot. Before Apply, the right-pane output
should look like every line is flush-left. Open the diff:
- [ ] The proposal shows 0 / 4 / 8 / 12 / 8-space indents for class / method / if / body / return.
- [ ] Per-line confidence column is mostly high (>=85%).
- [ ] No `visual-indent-jumpy` warning.

After Apply:
- [ ] Output is properly indented Python.
- [ ] The `python-indent-loss` warning **disappears** (verify in the warnings banner).

---

## 4. Uncertain / degenerate inputs

### 4a. Low-confidence indent inference
Use a noisy screenshot (small font, dark theme, JPEG compression). Open Recover:
- [ ] Metrics row shows `uncertain` count >0.
- [ ] Per-line confidence column has amber (<75%) or red (<50%) rows.
- [ ] The header lists `visual-indent-uncertain` warning when ≥30% of lines are uncertain.
- [ ] **Apply is still enabled** (uncertainty does not block apply — only no-charWidth does).

### 4b. Insufficient visual lines
Crop the screenshot to one or two lines and re-run OCR, then Recover:
- [ ] `visual-indent-insufficient-lines` warning is shown.
- [ ] `visual-indent-thin` info warning may appear.

### 4c. Implausible indent jumps
Hard to reproduce naturally — only fires when levels jump >2 in a single step.
If you have a screenshot with hanging-indent style continuation lines that put
a body token at column 16+ relative to a column-0 def:
- [ ] `visual-indent-jumpy` warning is shown.

### 4d. No char width estimate
Mock this by reloading without running OCR (button hidden — can't test from UI).
Or in DevTools, run:
```js
proposeVisualIndentation({ words: [{text:'foo',confidence:90}], rawText:'foo', language:'python' })
```
- [ ] Returns a proposal whose `metrics.charWidth === 0`.
- [ ] `warnings` includes `visual-indent-no-char-width`.

---

## 5. Post-apply state

After applying a proposal:

- [ ] `python-indent-loss` warning is gone (verify the warnings banner count drops).
- [ ] Cleanup chips still affect output as expected (toggle one off, watch text change).
- [ ] Edit mode still works — entering and exiting preserves content.
- [ ] Copy / Download produce the indented version.
- [ ] Re-run OCR (button at the top) regenerates from the original image; the recovered indent is **discarded** (this is intentional — re-OCR starts from scratch).
- [ ] New image / Reset clears everything.

---

## 6. Honest framing

These are deliberate UX checks against silent rewrites.

- [ ] Modal title is "**Proposed** visual indentation" — never "Fixed" or "Corrected".
- [ ] Subtitle includes "**Review every line** before applying — this is an estimate, not a fix."
- [ ] Apply only happens when the user clicks Apply. No keyboard shortcut auto-applies.
- [ ] After apply, no "fixed" or "corrected" language appears anywhere in the output area or warnings.

---

## Recording results

If anything fails, capture:
- The screenshot used (or describe it).
- A console screenshot.
- The proposed diff (right-click the modal → Inspect → screenshot the table).

File issues against `tests/manual-qa-visual-indent.md` so we can extend
this list with each new known-bad case.
