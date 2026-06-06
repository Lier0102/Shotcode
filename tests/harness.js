// Test runner: walks cases, renders pass/fail to DOM and console.
// No framework, no build step, just ES modules.

export async function runCases(cases) {
  const results = {
    pass: 0, fail: 0, error: 0,
    groups: new Map(), // group → [{ name, status, error? }]
  };

  for (const { group, name, run } of cases) {
    if (!results.groups.has(group)) results.groups.set(group, []);
    const list = results.groups.get(group);
    try {
      await run();
      results.pass++;
      list.push({ name, status: 'pass' });
      console.log(`%c✓ %c[${group}] ${name}`, 'color: #3fb950', 'color: inherit');
    } catch (err) {
      if (err && err.isAssertion) {
        results.fail++;
        list.push({ name, status: 'fail', error: err });
        console.error(`✗ [${group}] ${name}\n   ${err.message}`, err.detail || '');
      } else {
        results.error++;
        list.push({ name, status: 'error', error: err });
        console.error(`! [${group}] ${name} — uncaught:`, err);
      }
    }
  }

  render(results);

  const total = results.pass + results.fail + results.error;
  console.info(
    `%c${results.pass}/${total} passed`,
    `color: ${results.fail + results.error === 0 ? '#3fb950' : '#f85149'}; font-weight: bold;`
  );
  return results;
}

function render(results) {
  const root = document.getElementById('results');
  if (!root) return;
  root.replaceChildren();

  const total = results.pass + results.fail + results.error;
  const allGreen = results.fail + results.error === 0;

  const summary = document.createElement('div');
  summary.className = 'summary ' + (allGreen ? 'ok' : 'bad');
  summary.innerHTML = `
    <span class="big">${results.pass} / ${total} passed</span>
    ${results.fail ? `<span class="pill pill-fail">${results.fail} failed</span>` : ''}
    ${results.error ? `<span class="pill pill-error">${results.error} errored</span>` : ''}
  `;
  root.appendChild(summary);

  for (const [groupName, cases] of results.groups) {
    const section = document.createElement('section');
    section.className = 'group';

    const header = document.createElement('h2');
    const groupPass = cases.filter(c => c.status === 'pass').length;
    header.innerHTML = `<span class="group-name">${escapeHtml(groupName)}</span>
      <span class="group-count">${groupPass}/${cases.length}</span>`;
    section.appendChild(header);

    const ul = document.createElement('ul');
    for (const c of cases) {
      const li = document.createElement('li');
      li.className = `case ${c.status}`;
      const icon = c.status === 'pass' ? '✓' : c.status === 'fail' ? '✗' : '!';
      const headerEl = document.createElement('div');
      headerEl.className = 'case-header';
      headerEl.innerHTML = `<span class="icon">${icon}</span><span class="name">${escapeHtml(c.name)}</span>`;
      li.appendChild(headerEl);

      if (c.error) {
        const details = document.createElement('details');
        details.open = true;
        const summaryEl = document.createElement('summary');
        summaryEl.textContent = c.error.message || String(c.error);
        details.appendChild(summaryEl);

        if (c.error.detail) {
          const d = c.error.detail;
          if ('expected' in d || 'actual' in d) {
            details.appendChild(diffRow('expected', d.expected));
            details.appendChild(diffRow('actual',   d.actual));
          } else {
            details.appendChild(diffRow('detail', d));
          }
        }
        if (c.status === 'error' && c.error.stack) {
          const pre = document.createElement('pre');
          pre.className = 'stack';
          pre.textContent = c.error.stack;
          details.appendChild(pre);
        }
        li.appendChild(details);
      }
      ul.appendChild(li);
    }
    section.appendChild(ul);
    root.appendChild(section);
  }
}

function diffRow(label, value) {
  const row = document.createElement('div');
  row.className = 'diff-row';

  const lbl = document.createElement('span');
  lbl.className = 'diff-label';
  lbl.textContent = label;
  row.appendChild(lbl);

  const pre = document.createElement('pre');
  pre.className = 'diff-value';
  pre.textContent = formatValue(value);
  row.appendChild(pre);
  return row;
}

function formatValue(v) {
  if (typeof v === 'string') return JSON.stringify(v);
  try { return JSON.stringify(v, null, 2); }
  catch { return String(v); }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
