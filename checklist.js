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
.kc-row .kc-move { color: #6b8065; font-size: 0.7rem; }
.kc-row .kc-move:hover { color: #a8e79f; }
.kc-row .kc-move:disabled { opacity: 0.25; cursor: default; }
.kc-row .kc-move:disabled:hover { color: #6b8065; }
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
        <button class="kc-secondary" id="kc-manage-templates">🗂 Manage Templates</button>
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

function ensureTemplateHost() {
  if (document.getElementById('kokiri-template-overlay')) return;
  const style = document.createElement('style');
  style.textContent = `
#kokiri-template-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.7); display: none; align-items: center; justify-content: center; z-index: 210; padding: 2rem; }
#kokiri-template-overlay.open { display: flex; }
#kokiri-template-box { background: #121a13; border: 1px solid rgba(163,214,140,0.32); border-radius: 12px; padding: 1.4rem 1.5rem; width: 560px; max-width: 100%; max-height: 84vh; display: flex; flex-direction: column; font-family: 'Inter', sans-serif; color: #e4ede0; }
#kokiri-template-box h2 { font-family: 'Cinzel', serif; font-size: 1.05rem; color: #a8e79f; margin-bottom: 0.9rem; }
.kt-list { overflow-y: auto; flex: 1; margin-bottom: 0.9rem; }
.kt-template-row { display: flex; align-items: center; gap: 0.6rem; background: #17201a; border: 1px solid rgba(163,214,140,0.14); border-radius: 7px; padding: 0.55rem 0.75rem; margin-bottom: 0.4rem; cursor: pointer; }
.kt-template-row:hover { border-color: rgba(163,214,140,0.32); }
.kt-template-row .kt-name { flex: 1; font-size: 0.86rem; }
.kt-template-row .kt-count { font-family: 'IBM Plex Mono', monospace; font-size: 0.68rem; color: #6b8065; }
.kt-template-row .kt-del { background: none; border: none; color: #6b8065; cursor: pointer; font-size: 0.78rem; }
.kt-template-row .kt-del:hover { color: #f87171; }
.kt-back { background: none; border: none; color: #a8e79f; cursor: pointer; font-size: 0.78rem; margin-bottom: 0.7rem; text-align: left; padding: 0; }
#kokiri-template-box .kt-addform { display: flex; gap: 0.5rem; margin-bottom: 0.9rem; }
#kokiri-template-box .kt-addform input { flex: 1; background: #17201a; border: 1px solid rgba(163,214,140,0.14); color: #e4ede0; border-radius: 6px; padding: 0.5rem 0.7rem; font-size: 0.84rem; font-family: inherit; }
#kokiri-template-box .kt-addform button, #kokiri-template-box .kt-toolbar button {
  background: #a8e79f; color: #0c120d; border: none; border-radius: 6px; padding: 0.5rem 0.9rem; font-weight: 700; font-size: 0.8rem; cursor: pointer; white-space: nowrap; font-family: inherit;
}
#kokiri-template-box .kt-toolbar { display: flex; gap: 0.6rem; border-top: 1px solid rgba(163,214,140,0.14); padding-top: 0.9rem; }
#kokiri-template-box .kt-toolbar .kt-close { background: transparent; border: 1px solid rgba(163,214,140,0.32); color: #9db396; margin-left: auto; }
`;
  document.head.appendChild(style);

  const overlay = document.createElement('div');
  overlay.id = 'kokiri-template-overlay';
  overlay.innerHTML = `
    <div id="kokiri-template-box">
      <h2 id="kt-title">🗂 Manage Templates</h2>
      <div class="kt-mode-toggle" style="display:flex;gap:0.5rem;margin-bottom:0.9rem;">
        <button class="kt-mode-btn" id="kt-mode-checklist" data-mode="checklist" style="flex:1;background:#17201a;border:1px solid rgba(163,214,140,0.32);color:#a8e79f;border-radius:6px;padding:0.45rem;font-size:0.78rem;cursor:pointer;">☑ Checklist Templates</button>
        <button class="kt-mode-btn" id="kt-mode-sections" data-mode="sections" style="flex:1;background:transparent;border:1px solid rgba(163,214,140,0.14);color:#9db396;border-radius:6px;padding:0.45rem;font-size:0.78rem;cursor:pointer;">🗂 Sections Templates</button>
      </div>
      <div id="kokiri-template-body" class="kt-list"><p class="kc-empty">Loading…</p></div>
      <div class="kt-toolbar">
        <button class="kt-close" id="kt-close">Close</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => { if (e.target.id === 'kokiri-template-overlay') closeTemplateManager(); });
  document.getElementById('kt-close').addEventListener('click', closeTemplateManager);
}

export function closeTemplateManager() {
  const overlay = document.getElementById('kokiri-template-overlay');
  if (overlay) overlay.classList.remove('open');
}

export async function openTemplateManager(supabase) {
  ensureHost();
  ensureTemplateHost();
  document.getElementById('kokiri-template-overlay').classList.add('open');
  document.getElementById('kt-close').onclick = async () => {
    closeTemplateManager();
    const sel = document.getElementById('kc-template-select');
    if (sel) {
      const { data: templates } = await supabase.from('kokiri_checklist_templates').select('id, name').order('name');
      sel.innerHTML = '<option value="">Apply a template…</option>' + (templates || []).map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
    }
  };

  function setMode(mode) {
    document.getElementById('kt-mode-checklist').style.background = mode === 'checklist' ? '#17201a' : 'transparent';
    document.getElementById('kt-mode-checklist').style.borderColor = mode === 'checklist' ? 'rgba(163,214,140,0.32)' : 'rgba(163,214,140,0.14)';
    document.getElementById('kt-mode-checklist').style.color = mode === 'checklist' ? '#a8e79f' : '#9db396';
    document.getElementById('kt-mode-sections').style.background = mode === 'sections' ? '#17201a' : 'transparent';
    document.getElementById('kt-mode-sections').style.borderColor = mode === 'sections' ? 'rgba(163,214,140,0.32)' : 'rgba(163,214,140,0.14)';
    document.getElementById('kt-mode-sections').style.color = mode === 'sections' ? '#a8e79f' : '#9db396';
    if (mode === 'checklist') renderTemplateList(supabase);
    else renderSectionTemplateList(supabase);
  }
  document.getElementById('kt-mode-checklist').onclick = () => setMode('checklist');
  document.getElementById('kt-mode-sections').onclick = () => setMode('sections');

  await renderTemplateList(supabase);
}

async function renderTemplateList(supabase) {
  document.getElementById('kt-title').textContent = '🗂 Manage Templates';
  const body = document.getElementById('kokiri-template-body');
  const { data: templates } = await supabase.from('kokiri_checklist_templates').select('id, name').order('name');
  const { data: allItems } = await supabase.from('kokiri_checklist_template_items').select('template_id');
  const counts = {};
  (allItems || []).forEach(i => { counts[i.template_id] = (counts[i.template_id] || 0) + 1; });

  body.innerHTML = (templates && templates.length)
    ? templates.map(t => `
      <div class="kt-template-row" data-id="${t.id}">
        <span class="kt-name">${escapeHtml(t.name)}</span>
        <span class="kt-count">${counts[t.id] || 0} item${(counts[t.id] || 0) === 1 ? '' : 's'}</span>
        <button class="kt-del" data-id="${t.id}" title="Delete template">✕</button>
      </div>
    `).join('')
    : '<p class="kc-empty">No templates yet — add one below.</p>';
  body.innerHTML += `
    <div class="kt-addform" style="margin-top:0.8rem;">
      <input id="kt-new-template" placeholder="New template name…">
      <button id="kt-add-template">+ New Template</button>
    </div>
  `;

  body.querySelectorAll('.kt-template-row').forEach(row => row.addEventListener('click', (e) => {
    if (e.target.classList.contains('kt-del')) return;
    renderTemplateEditor(supabase, row.dataset.id);
  }));
  body.querySelectorAll('.kt-del').forEach(btn => btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!confirm('Delete this template? This cannot be undone.')) return;
    await supabase.from('kokiri_checklist_templates').delete().eq('id', btn.dataset.id);
    await renderTemplateList(supabase);
  }));
  document.getElementById('kt-add-template').onclick = async () => {
    const input = document.getElementById('kt-new-template');
    const name = input.value.trim();
    if (!name) return;
    const { data, error } = await supabase.from('kokiri_checklist_templates').insert({ name }).select().single();
    if (error) { alert('⚠ ' + error.message); return; }
    await renderTemplateEditor(supabase, data.id);
  };
  document.getElementById('kt-new-template').onkeydown = (e) => { if (e.key === 'Enter') document.getElementById('kt-add-template').click(); };
}

async function renderTemplateEditor(supabase, templateId) {
  const { data: template } = await supabase.from('kokiri_checklist_templates').select('id, name').eq('id', templateId).single();
  document.getElementById('kt-title').textContent = `🗂 ${template.name}`;
  const body = document.getElementById('kokiri-template-body');

  let items = [];
  async function loadItems() {
    const { data } = await supabase.from('kokiri_checklist_template_items').select('*').eq('template_id', templateId).order('sort_order');
    items = data || [];
    renderTree();
  }

  function renderTree() {
    const tree = buildTree(items);
    const topLevel = tree['root'] || [];
    const treeHtml = topLevel.length ? topLevel.map((item, idx) => {
      const subItems = tree[item.id] || [];
      return `
        <div class="kc-item">
          <div class="kc-row" data-id="${item.id}">
            <button class="kc-move" data-id="${item.id}" data-dir="-1" title="Move up" ${idx === 0 ? 'disabled' : ''}>▲</button>
            <button class="kc-move" data-id="${item.id}" data-dir="1" title="Move down" ${idx === topLevel.length - 1 ? 'disabled' : ''}>▼</button>
            <input class="kc-text" data-id="${item.id}" value="${escapeHtml(item.text)}">
            <button class="kc-addsub" data-id="${item.id}" title="Add sub-step">+ sub</button>
            <button class="kc-del" data-id="${item.id}" title="Delete">✕</button>
          </div>
          ${subItems.map((sub, subIdx) => `
            <div class="kc-row kc-sub-row" data-id="${sub.id}">
              <button class="kc-move" data-id="${sub.id}" data-dir="-1" title="Move up" ${subIdx === 0 ? 'disabled' : ''}>▲</button>
              <button class="kc-move" data-id="${sub.id}" data-dir="1" title="Move down" ${subIdx === subItems.length - 1 ? 'disabled' : ''}>▼</button>
              <input class="kc-text" data-id="${sub.id}" value="${escapeHtml(sub.text)}">
              <button class="kc-del" data-id="${sub.id}" title="Delete">✕</button>
            </div>
          `).join('')}
        </div>
      `;
    }).join('') : '<p class="kc-empty">No steps yet — add one below.</p>';

    body.innerHTML = `
      <button class="kt-back" id="kt-back">← Back to templates</button>
      <div>${treeHtml}</div>
      <div class="kt-addform" style="margin-top:0.8rem;">
        <input id="kt-new-item" placeholder="Add a step…">
        <button id="kt-add-item">+ Add</button>
      </div>
    `;

    document.getElementById('kt-back').addEventListener('click', () => renderTemplateList(supabase));
    body.querySelectorAll('.kc-text').forEach(inp => inp.addEventListener('blur', async () => {
      const it = items.find(i => i.id === inp.dataset.id);
      if (!it || it.text === inp.value) return;
      it.text = inp.value;
      await supabase.from('kokiri_checklist_template_items').update({ text: inp.value }).eq('id', it.id);
    }));
    body.querySelectorAll('.kc-del').forEach(btn => btn.addEventListener('click', async () => {
      await supabase.from('kokiri_checklist_template_items').delete().eq('id', btn.dataset.id);
      items = items.filter(i => i.id !== btn.dataset.id && i.parent_id !== btn.dataset.id);
      renderTree();
    }));
    body.querySelectorAll('.kc-addsub').forEach(btn => btn.addEventListener('click', async () => {
      const text = prompt('Sub-step:');
      if (!text || !text.trim()) return;
      const siblings = items.filter(i => i.parent_id === btn.dataset.id);
      const maxOrder = siblings.reduce((m, i) => Math.max(m, i.sort_order || 0), 0);
      const { data, error } = await supabase.from('kokiri_checklist_template_items').insert({
        template_id: templateId, parent_id: btn.dataset.id, text: text.trim(), sort_order: maxOrder + 1,
      }).select().single();
      if (error) { alert('⚠ ' + error.message); return; }
      items.push(data);
      renderTree();
    }));
    body.querySelectorAll('.kc-move').forEach(btn => btn.addEventListener('click', async () => {
      await moveSibling(supabase, 'kokiri_checklist_template_items', items, btn.dataset.id, parseInt(btn.dataset.dir, 10));
      renderTree();
    }));
    document.getElementById('kt-add-item').onclick = async () => {
      const input = document.getElementById('kt-new-item');
      const text = input.value.trim();
      if (!text) return;
      const topLevelItems = items.filter(i => !i.parent_id);
      const maxOrder = topLevelItems.reduce((m, i) => Math.max(m, i.sort_order || 0), 0);
      const { data, error } = await supabase.from('kokiri_checklist_template_items').insert({
        template_id: templateId, parent_id: null, text, sort_order: maxOrder + 1,
      }).select().single();
      if (error) { alert('⚠ ' + error.message); return; }
      items.push(data);
      renderTree();
    };
    document.getElementById('kt-new-item').onkeydown = (e) => { if (e.key === 'Enter') document.getElementById('kt-add-item').click(); };
  }

  await loadItems();
}

// ---------- Sections Templates (flat, reusable lists of section names — e.g. "apply this set of
// sections to a new business in one click") ----------
async function renderSectionTemplateList(supabase) {
  document.getElementById('kt-title').textContent = '🗂 Sections Templates';
  const body = document.getElementById('kokiri-template-body');
  const { data: templates } = await supabase.from('kokiri_section_templates').select('id, name').order('name');
  const { data: allItems } = await supabase.from('kokiri_section_template_items').select('template_id');
  const counts = {};
  (allItems || []).forEach(i => { counts[i.template_id] = (counts[i.template_id] || 0) + 1; });

  body.innerHTML = (templates && templates.length)
    ? templates.map(t => `
      <div class="kt-template-row" data-id="${t.id}">
        <span class="kt-name">${escapeHtml(t.name)}</span>
        <span class="kt-count">${counts[t.id] || 0} section${(counts[t.id] || 0) === 1 ? '' : 's'}</span>
        <button class="kt-del" data-id="${t.id}" title="Delete template">✕</button>
      </div>
    `).join('')
    : '<p class="kc-empty">No sections templates yet — add one below.</p>';
  body.innerHTML += `
    <div class="kt-addform" style="margin-top:0.8rem;">
      <input id="kt-new-sectiontemplate" placeholder="New sections template name…">
      <button id="kt-add-sectiontemplate">+ New Template</button>
    </div>
  `;

  body.querySelectorAll('.kt-template-row').forEach(row => row.addEventListener('click', (e) => {
    if (e.target.classList.contains('kt-del')) return;
    renderSectionTemplateEditor(supabase, row.dataset.id);
  }));
  body.querySelectorAll('.kt-del').forEach(btn => btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!confirm('Delete this sections template? This cannot be undone.')) return;
    await supabase.from('kokiri_section_templates').delete().eq('id', btn.dataset.id);
    await renderSectionTemplateList(supabase);
  }));
  document.getElementById('kt-add-sectiontemplate').onclick = async () => {
    const input = document.getElementById('kt-new-sectiontemplate');
    const name = input.value.trim();
    if (!name) return;
    const { data, error } = await supabase.from('kokiri_section_templates').insert({ name }).select().single();
    if (error) { alert('⚠ ' + error.message); return; }
    await renderSectionTemplateEditor(supabase, data.id);
  };
  document.getElementById('kt-new-sectiontemplate').onkeydown = (e) => { if (e.key === 'Enter') document.getElementById('kt-add-sectiontemplate').click(); };
}

async function renderSectionTemplateEditor(supabase, templateId) {
  const { data: template } = await supabase.from('kokiri_section_templates').select('id, name').eq('id', templateId).single();
  document.getElementById('kt-title').textContent = `🗂 ${template.name}`;
  const body = document.getElementById('kokiri-template-body');

  let items = [];
  async function loadItems() {
    const { data } = await supabase.from('kokiri_section_template_items').select('*').eq('template_id', templateId).order('sort_order');
    items = data || [];
    renderList();
  }

  function renderList() {
    const sorted = [...items].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    const listHtml = sorted.length ? sorted.map((item, idx) => `
      <div class="kc-row" data-id="${item.id}">
        <button class="kc-move" data-id="${item.id}" data-dir="-1" title="Move up" ${idx === 0 ? 'disabled' : ''}>▲</button>
        <button class="kc-move" data-id="${item.id}" data-dir="1" title="Move down" ${idx === sorted.length - 1 ? 'disabled' : ''}>▼</button>
        <input class="kc-text" data-id="${item.id}" value="${escapeHtml(item.name)}">
        <button class="kc-del" data-id="${item.id}" title="Delete">✕</button>
      </div>
    `).join('') : '<p class="kc-empty">No sections yet — add one below.</p>';

    body.innerHTML = `
      <button class="kt-back" id="kt-back">← Back to sections templates</button>
      <div>${listHtml}</div>
      <div class="kt-addform" style="margin-top:0.8rem;">
        <input id="kt-new-sectionitem" placeholder="Add a section name…">
        <button id="kt-add-sectionitem">+ Add</button>
      </div>
    `;

    document.getElementById('kt-back').addEventListener('click', () => renderSectionTemplateList(supabase));
    body.querySelectorAll('.kc-text').forEach(inp => inp.addEventListener('blur', async () => {
      const it = items.find(i => i.id === inp.dataset.id);
      if (!it || it.name === inp.value) return;
      it.name = inp.value;
      await supabase.from('kokiri_section_template_items').update({ name: inp.value }).eq('id', it.id);
    }));
    body.querySelectorAll('.kc-del').forEach(btn => btn.addEventListener('click', async () => {
      await supabase.from('kokiri_section_template_items').delete().eq('id', btn.dataset.id);
      items = items.filter(i => i.id !== btn.dataset.id);
      renderList();
    }));
    body.querySelectorAll('.kc-move').forEach(btn => btn.addEventListener('click', async () => {
      await moveSibling(supabase, 'kokiri_section_template_items', items, btn.dataset.id, parseInt(btn.dataset.dir, 10));
      renderList();
    }));
    document.getElementById('kt-add-sectionitem').onclick = async () => {
      const input = document.getElementById('kt-new-sectionitem');
      const name = input.value.trim();
      if (!name) return;
      const maxOrder = items.reduce((m, i) => Math.max(m, i.sort_order || 0), 0);
      const { data, error } = await supabase.from('kokiri_section_template_items').insert({
        template_id: templateId, name, sort_order: maxOrder + 1,
      }).select().single();
      if (error) { alert('⚠ ' + error.message); return; }
      items.push(data);
      renderList();
    };
    document.getElementById('kt-new-sectionitem').onkeydown = (e) => { if (e.key === 'Enter') document.getElementById('kt-add-sectionitem').click(); };
  }

  await loadItems();
}

// For host pages that want to offer "apply a sections template" when creating something new
// (e.g. Businesses' "+ New Business" flow) without opening the full manager modal.
export async function listSectionTemplates(supabase) {
  const { data } = await supabase.from('kokiri_section_templates').select('id, name').order('name');
  return data || [];
}
export async function getSectionTemplateItems(supabase, templateId) {
  const { data } = await supabase.from('kokiri_section_template_items').select('*').eq('template_id', templateId).order('sort_order');
  return data || [];
}

function buildTree(items) {
  const byParent = {};
  items.forEach(it => { (byParent[it.parent_id || 'root'] = byParent[it.parent_id || 'root'] || []).push(it); });
  Object.values(byParent).forEach(arr => arr.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)));
  return byParent;
}

// Swaps sort_order with the previous/next sibling that shares the same parent_id, so an item
// can move within its own group (row stays a row, sub-item stays a sub-item under the same parent).
async function moveSibling(supabase, table, items, itemId, direction) {
  const item = items.find(i => i.id === itemId);
  if (!item) return;
  const siblings = items.filter(i => (i.parent_id || null) === (item.parent_id || null)).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  const idx = siblings.findIndex(s => s.id === itemId);
  const swapIdx = idx + direction;
  if (swapIdx < 0 || swapIdx >= siblings.length) return;
  const other = siblings[swapIdx];
  const a = item.sort_order, b = other.sort_order;
  await supabase.from(table).update({ sort_order: b }).eq('id', item.id);
  await supabase.from(table).update({ sort_order: a }).eq('id', other.id);
  item.sort_order = b;
  other.sort_order = a;
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
    wrap.innerHTML = topLevel.map((item, idx) => {
      const subItems = tree[item.id] || [];
      return `
        <div class="kc-item">
          <div class="kc-row ${item.done ? 'done' : ''}" data-id="${item.id}">
            <button class="kc-move" data-id="${item.id}" data-dir="-1" title="Move up" ${idx === 0 ? 'disabled' : ''}>▲</button>
            <button class="kc-move" data-id="${item.id}" data-dir="1" title="Move down" ${idx === topLevel.length - 1 ? 'disabled' : ''}>▼</button>
            <input type="checkbox" data-id="${item.id}" ${item.done ? 'checked' : ''}>
            <input class="kc-text" data-id="${item.id}" value="${escapeHtml(item.text)}">
            <button class="kc-addsub" data-id="${item.id}" title="Add sub-step">+ sub</button>
            <button class="kc-del" data-id="${item.id}" title="Delete">✕</button>
          </div>
          ${subItems.map((sub, subIdx) => `
            <div class="kc-row kc-sub-row ${sub.done ? 'done' : ''}" data-id="${sub.id}">
              <button class="kc-move" data-id="${sub.id}" data-dir="-1" title="Move up" ${subIdx === 0 ? 'disabled' : ''}>▲</button>
              <button class="kc-move" data-id="${sub.id}" data-dir="1" title="Move down" ${subIdx === subItems.length - 1 ? 'disabled' : ''}>▼</button>
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
    wrap.querySelectorAll('.kc-move').forEach(btn => btn.addEventListener('click', async () => {
      await moveSibling(supabase, 'kokiri_checklist_items', items, btn.dataset.id, parseInt(btn.dataset.dir, 10));
      renderTree();
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

  document.getElementById('kc-manage-templates').onclick = async () => {
    await openTemplateManager(supabase);
  };

  await loadTemplateOptions();
  await loadItems();
}
