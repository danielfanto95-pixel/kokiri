// Per-row checklists — attach a 2-level-deep checklist (item -> sub-item) to any kokiri_rows
// row, mark items done, and save/apply reusable templates. Shared across Businesses and the
// Tasks portal (and anywhere else that wants it) so the modal/tree logic lives in one place.

function escapeHtml(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function ensureHost() {
  if (document.getElementById('kokiri-checklist-overlay')) return;
  const style = document.createElement('style');
  style.textContent = `
#kokiri-checklist-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: none; align-items: center; justify-content: center; z-index: 200; padding: 2rem; }
#kokiri-checklist-overlay.open { display: flex; }
#kokiri-checklist-box { background: #121a13; border: 1px solid rgba(163,214,140,0.32); border-radius: 12px; padding: 1.4rem 1.5rem; width: 520px; max-width: 100%; max-height: 82vh; display: flex; flex-direction: column; font-family: 'Inter', sans-serif; color: #e4ede0; }
#kokiri-checklist-box h2 { font-family: 'Cinzel', serif; font-size: 1.05rem; color: #a8e79f; margin-bottom: 0.2rem; }
#kokiri-checklist-box .kc-sub { font-family: 'IBM Plex Mono', monospace; font-size: 0.68rem; color: #6b8065; margin-bottom: 0.9rem; }
#kokiri-checklist-tree { overflow-y: auto; flex: 1; margin-bottom: 0.9rem; }
.kc-item { margin-bottom: 0.35rem; }
.kc-row { display: flex; align-items: center; gap: 0.5rem; background: #17201a; border: 1px solid rgba(163,214,140,0.14); border-radius: 7px; padding: 0.4rem 0.6rem; }
.kc-row.kc-sub-row { margin-left: 1.6rem; margin-top: 0.3rem; background: #141c15; }
.kc-row input[type="checkbox"] { flex-shrink: 0; width: 15px; height: 15px; accent-color: #7cc576; cursor: pointer; }
.kc-row .kc-text { flex: 1; font-size: 0.84rem; background: transparent; border: none; color: #e4ede0; outline: none; font-family: inherit; }
.kc-row.done .kc-text { color: #6b8065; text-decoration: line-through; }
.kc-row button { background: none; border: none; color: #6b8065; cursor: pointer; font-size: 0.78rem; padding: 0 0.2rem; flex-shrink: 0; }
.kc-row button:hover { color: #f87171; }
.kc-row .kc-addsub { color: #7cc576; }
.kc-row .kc-addsub:hover { color: #a8e79f; }
.kc-empty { color: #6b8065; font-size: 0.82rem; padding: 0.8rem 0.2rem; }
#kokiri-checklist-box .kc-addform { display: flex; gap: 0.5rem; margin-bottom: 0.9rem; }
#kokiri-checklist-box .kc-addform input { flex: 1; background: #17201a; border: 1px solid rgba(163,214,140,0.14); color: #e4ede0; border-radius: 6px; padding: 0.5rem 0.7rem; font-size: 0.84rem; font-family: inherit; }
#kokiri-checklist-box .kc-addform button, #kokiri-checklist-box .kc-toolbar button, #kokiri-checklist-box .kc-close {
  background: #a8e79f; color: #0c120d; border: none; border-radius: 6px; padding: 0.5rem 0.9rem; font-weight: 700; font-size: 0.8rem; cursor: pointer; white-space: nowrap; font-family: inherit;
}
#kokiri-checklist-box .kc-toolbar { display: flex; gap: 0.6rem; flex-wrap: wrap; align-items: center; border-top: 1px solid rgba(163,214,140,0.14); padding-top: 0.9rem; }
#kokiri-checklist-box .kc-toolbar select { background: #17201a; border: 1px solid rgba(163,214,140,0.14); color: #e4ede0; border-radius: 6px; padding: 0.5rem 0.6rem; font-size: 0.8rem; font-family: inherit; }
#kokiri-checklist-box .kc-toolbar button.kc-secondary { background: transparent; border: 1px solid rgba(163,214,140,0.32); color: #a8e79f; }
#kokiri-checklist-box .kc-close { background: transparent; border: 1px solid rgba(163,214,140,0.32); color: #9db396; margin-left: auto; }
`;
  document.head.appendChild(style);

  const overlay = document.createElement('div');
  overlay.id = 'kokiri-checklist-overlay';
  overlay.innerHTML = `
    <div id="kokiri-checklist-box">
      <h2 id="kc-title">☑ Checklist</h2>
      <div class="kc-sub" id="kc-progress"></div>
      <div id="kokiri-checklist-tree"><p class="kc-empty">Loading…</p></div>
      <div class="kc-addform">
        <input id="kc-new-item" placeholder="Add a step…">
        <button id="kc-add-btn">+ Add</button>
      </div>
      <div class="kc-toolbar">
        <button class="kc-secondary" id="kc-save-template">💾 Save as Template</button>
        <select id="kc-template-select"><option value="">Apply a template…</option></select>
        <button class="kc-secondary" id="kc-apply-template">Apply</button>
        <button class="kc-close" id="kc-close">Close</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => { if (e.target.id === 'kokiri-checklist-overlay') closeChecklistModal(); });
  document.getElementById('kc-close').addEventListener('click', closeChecklistModal);
}

export function closeChecklistModal() {
  const overlay = document.getElementById('kokiri-checklist-overlay');
  if (overlay) overlay.classList.remove('open');
}

function buildTree(items) {
  const byParent = {};
  items.forEach(it => { (byParent[it.parent_id || 'root'] = byParent[it.parent_id || 'root'] || []).push(it); });
  Object.values(byParent).forEach(arr => arr.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)));
  return byParent;
}

export async function getChecklistCounts(supabase, rowIds) {
  const counts = {};
  if (!rowIds.length) return counts;
  const { data } = await supabase.from('kokiri_checklist_items').select('row_id, done').in('row_id', rowIds);
  (data || []).forEach(it => {
    const c = counts[it.row_id] || { done: 0, total: 0 };
    c.total += 1;
    if (it.done) c.done += 1;
    counts[it.row_id] = c;
  });
  return counts;
}

export function checklistBadgeHtml(counts, rowId) {
  const c = counts[rowId];
  if (!c || !c.total) return '☑ Checklist';
  return `☑ ${c.done}/${c.total}`;
}

export async function openChecklistModal(supabase, { rowId, sheetId, rowLabel, onChange }) {
  ensureHost();
  const overlay = document.getElementById('kokiri-checklist-overlay');
  document.getElementById('kc-title').textContent = '☑ Checklist';
  document.getElementById('kc-progress').textContent = rowLabel ? `For: ${rowLabel}` : '';
  overlay.classList.add('open');

  let items = [];

  async function loadItems() {
    const { data } = await supabase.from('kokiri_checklist_items').select('*').eq('row_id', rowId).order('sort_order');
    items = data || [];
    renderTree();
  }

  function renderTree() {
    const total = items.length;
    const done = items.filter(i => i.done).length;
    document.getElementById('kc-progress').textContent = `${rowLabel ? `For: ${rowLabel} — ` : ''}${done}/${total} done`;

    const wrap = document.getElementById('kokiri-checklist-tree');
    if (!items.length) { wrap.innerHTML = '<p class="kc-empty">No steps yet — add one below, or apply a template.</p>'; if (onChange) onChange(); return; }
    const tree = buildTree(items);
    const topLevel = tree['root'] || [];
    wrap.innerHTML = topLevel.map(item => {
      const subItems = tree[item.id] || [];
      return `
        <div class="kc-item">
          <div class="kc-row ${item.done ? 'done' : ''}" data-id="${item.id}">
            <input type="checkbox" data-id="${item.id}" ${item.done ? 'checked' : ''}>
            <input class="kc-text" data-id="${item.id}" value="${escapeHtml(item.text)}">
            <button class="kc-addsub" data-id="${item.id}" title="Add sub-step">+ sub</button>
            <button class="kc-del" data-id="${item.id}" title="Delete">✕</button>
          </div>
          ${subItems.map(sub => `
            <div class="kc-row kc-sub-row ${sub.done ? 'done' : ''}" data-id="${sub.id}">
              <input type="checkbox" data-id="${sub.id}" ${sub.done ? 'checked' : ''}>
              <input class="kc-text" data-id="${sub.id}" value="${escapeHtml(sub.text)}">
              <button class="kc-del" data-id="${sub.id}" title="Delete">✕</button>
            </div>
          `).join('')}
        </div>
      `;
    }).join('');

    wrap.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.addEventListener('change', async () => {
      const it = items.find(i => i.id === cb.dataset.id);
      if (!it) return;
      it.done = cb.checked;
      await supabase.from('kokiri_checklist_items').update({ done: cb.checked, updated_at: new Date().toISOString() }).eq('id', it.id);
      renderTree();
      if (onChange) onChange();
    }));
    wrap.querySelectorAll('.kc-text').forEach(inp => inp.addEventListener('blur', async () => {
      const it = items.find(i => i.id === inp.dataset.id);
      if (!it || it.text === inp.value) return;
      it.text = inp.value;
      await supabase.from('kokiri_checklist_items').update({ text: inp.value, updated_at: new Date().toISOString() }).eq('id', it.id);
    }));
    wrap.querySelectorAll('.kc-del').forEach(btn => btn.addEventListener('click', async () => {
      await supabase.from('kokiri_checklist_items').delete().eq('id', btn.dataset.id);
      items = items.filter(i => i.id !== btn.dataset.id && i.parent_id !== btn.dataset.id);
      renderTree();
      if (onChange) onChange();
    }));
    wrap.querySelectorAll('.kc-addsub').forEach(btn => btn.addEventListener('click', async () => {
      const text = prompt('Sub-step:');
      if (!text || !text.trim()) return;
      const siblings = items.filter(i => i.parent_id === btn.dataset.id);
      const maxOrder = siblings.reduce((m, i) => Math.max(m, i.sort_order || 0), 0);
      const { data, error } = await supabase.from('kokiri_checklist_items').insert({
        row_id: rowId, sheet_id: sheetId, parent_id: btn.dataset.id, text: text.trim(), sort_order: maxOrder + 1,
      }).select().single();
      if (error) { alert('⚠ ' + error.message); return; }
      items.push(data);
      renderTree();
      if (onChange) onChange();
    }));
    if (onChange) onChange();
  }

  document.getElementById('kc-add-btn').onclick = async () => {
    const input = document.getElementById('kc-new-item');
    const text = input.value.trim();
    if (!text) return;
    const topLevel = items.filter(i => !i.parent_id);
    const maxOrder = topLevel.reduce((m, i) => Math.max(m, i.sort_order || 0), 0);
    const { data, error } = await supabase.from('kokiri_checklist_items').insert({
      row_id: rowId, sheet_id: sheetId, parent_id: null, text, sort_order: maxOrder + 1,
    }).select().single();
    if (error) { alert('⚠ ' + error.message); return; }
    items.push(data);
    input.value = '';
    renderTree();
  };
  document.getElementById('kc-new-item').onkeydown = (e) => { if (e.key === 'Enter') document.getElementById('kc-add-btn').click(); };

  document.getElementById('kc-save-template').onclick = async () => {
    if (!items.length) { alert('Nothing to save — add some steps first.'); return; }
    const name = prompt('Template name:');
    if (!name || !name.trim()) return;
    const { data: template, error } = await supabase.from('kokiri_checklist_templates').insert({ name: name.trim() }).select().single();
    if (error) { alert('⚠ ' + error.message); return; }
    const tree = buildTree(items);
    const topLevel = tree['root'] || [];
    for (const item of topLevel) {
      const { data: created } = await supabase.from('kokiri_checklist_template_items').insert({
        template_id: template.id, parent_id: null, text: item.text, sort_order: item.sort_order,
      }).select().single();
      const subItems = tree[item.id] || [];
      for (const sub of subItems) {
        await supabase.from('kokiri_checklist_template_items').insert({
          template_id: template.id, parent_id: created.id, text: sub.text, sort_order: sub.sort_order,
        });
      }
    }
    alert(`✓ Saved as template "${name.trim()}"`);
    await loadTemplateOptions();
  };

  async function loadTemplateOptions() {
    const { data: templates } = await supabase.from('kokiri_checklist_templates').select('id, name').order('name');
    const sel = document.getElementById('kc-template-select');
    sel.innerHTML = '<option value="">Apply a template…</option>' + (templates || []).map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
  }

  document.getElementById('kc-apply-template').onclick = async () => {
    const templateId = document.getElementById('kc-template-select').value;
    if (!templateId) { alert('Pick a template first.'); return; }
    const { data: templateItems } = await supabase.from('kokiri_checklist_template_items').select('*').eq('template_id', templateId).order('sort_order');
    const tree = buildTree(templateItems || []);
    const topLevel = tree['root'] || [];
    const topExisting = items.filter(i => !i.parent_id);
    let baseOrder = topExisting.reduce((m, i) => Math.max(m, i.sort_order || 0), 0);
    for (const item of topLevel) {
      baseOrder += 1;
      const { data: created } = await supabase.from('kokiri_checklist_items').insert({
        row_id: rowId, sheet_id: sheetId, parent_id: null, text: item.text, sort_order: baseOrder,
      }).select().single();
      items.push(created);
      const subItems = tree[item.id] || [];
      let subOrder = 0;
      for (const sub of subItems) {
        subOrder += 1;
        const { data: createdSub } = await supabase.from('kokiri_checklist_items').insert({
          row_id: rowId, sheet_id: sheetId, parent_id: created.id, text: sub.text, sort_order: subOrder,
        }).select().single();
        items.push(createdSub);
      }
    }
    renderTree();
  };

  await loadTemplateOptions();
  await loadItems();
}
