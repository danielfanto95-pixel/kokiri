import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient('https://qahriykfwknuoqctsaek.supabase.co', 'sb_publishable_nPF5goHAWj0iAiUOnhnXPA_8qd3b2mU');

function esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

const badgeStyle = 'display:inline-flex;align-items:center;gap:0.4rem;font-family:"IBM Plex Mono",monospace;font-size:0.68rem;color:var(--dim,#888);background:var(--surface2,#1a1a1a);border:1px solid var(--border,rgba(255,255,255,0.1));border-radius:100px;padding:0.25rem 0.7rem;margin-bottom:0.6rem;';
const linkStyle = 'color:var(--leaf-bright,#9ff5ff);text-decoration:none;';
const btnStyle = 'font-family:"IBM Plex Mono",monospace;font-size:0.68rem;color:var(--gold,#ffd76a);background:var(--surface2,#1a1a1a);border:1px dashed var(--border-bright,rgba(255,255,255,0.3));border-radius:100px;padding:0.25rem 0.7rem;margin-bottom:0.6rem;cursor:pointer;';

/**
 * Renders a "Source: X" badge into containerEl for a given page/section, or an
 * "+ Add Source" prompt if no root data source has been declared for it yet.
 * Every portal/dashboard section is required to have one or the other.
 */
export async function renderSourceBadge(containerEl, page, sectionKey, sectionLabel) {
  if (!containerEl) return;
  const { data } = await supabase.from('kokiri_section_sources').select('*').eq('page', page).eq('section_key', sectionKey).maybeSingle();

  if (data) {
    const isSheet = data.source_type === 'sheet';
    const label = isSheet
      ? `<a href="app.html#${encodeURIComponent(data.source_ref)}" style="${linkStyle}">${esc(data.source_label)}</a>`
      : esc(data.source_label);
    const typeTag = data.source_type === 'sheet' ? '' : ` (${data.source_type})`;
    containerEl.innerHTML = `<span style="${badgeStyle}">📊 Source: ${label}${typeTag}</span>`;
    return;
  }

  containerEl.innerHTML = `<button style="${btnStyle}">⚠ No source set — + Add Source</button>`;
  containerEl.querySelector('button').addEventListener('click', async () => {
    const name = prompt(`"${sectionLabel}" has no declared root data source yet.\n\nName a new Kokiri sheet to create as its source (it will appear in the main Kokiri sheet list too):`);
    if (!name) return;
    const slug = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || ('source-' + Date.now());
    const { data: sheet, error } = await supabase.from('kokiri_sheets').insert({ name, slug, sort_order: 999 }).select().single();
    if (error) { alert('⚠ ' + error.message); return; }
    await supabase.from('kokiri_columns').insert({ sheet_id: sheet.id, name: 'Entry', column_key: 'entry', sort_order: 0 });
    await supabase.from('kokiri_section_sources').insert({
      page, section_key: sectionKey, section_label: sectionLabel,
      source_type: 'sheet', source_ref: slug, source_label: name,
    });
    renderSourceBadge(containerEl, page, sectionKey, sectionLabel);
  });
}

/** Finds every element with data-lineage-page/data-lineage-section attributes and renders its badge. */
export async function initLineageBadges(root = document) {
  const slots = root.querySelectorAll('[data-lineage-page]');
  await Promise.all([...slots].map(el =>
    renderSourceBadge(el, el.dataset.lineagePage, el.dataset.lineageSection, el.dataset.lineageLabel || el.dataset.lineageSection)
  ));
}

const SOURCE_TYPE_ICON = { table: '🔗', composite: '🧮', external: '🌐' };

/**
 * Every portal/dashboard/macro section is registered as a data source (kokiri_section_sources).
 * Sheet-backed sources already appear in the Kokiri sidebar as sheets; this appends the
 * non-sheet ones (tables/composites — Agents, Dashboards, Replicas, Documents, etc.) too,
 * so the "Kokiri: Sources + database" nav group is the complete index of every data source.
 */
export async function appendNonSheetSourcesToNav(navSheetsElId = 'nav-sheets') {
  const el = document.getElementById(navSheetsElId);
  if (!el) return;
  const { data } = await supabase.from('kokiri_section_sources').select('*').neq('source_type', 'sheet').order('source_label');
  if (!data || !data.length) return;
  const seen = new Set();
  const links = [];
  for (const row of data) {
    const key = row.source_ref;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push(`<a class="nav-link" href="${esc(row.page)}">${SOURCE_TYPE_ICON[row.source_type] || '🔗'} ${esc(row.source_label)}</a>`);
  }
  el.insertAdjacentHTML('beforeend', links.join(''));
}
