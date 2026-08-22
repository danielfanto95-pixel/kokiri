// Sitewide keyword search — jump to any registered page or Kokiri sheet by name/description/category.
// Injects a search box into the topbar and wires up a live-filtered dropdown.

function escapeHtml(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

export async function initPageSearch(supabase) {
  const topbar = document.querySelector('.topbar');
  if (!topbar || document.getElementById('kokiri-search-wrap')) return;

  if (!document.getElementById('kokiri-search-styles')) {
    const style = document.createElement('style');
    style.id = 'kokiri-search-styles';
    style.textContent = `
      #kokiri-search-wrap { position: relative; width: 220px; }
      #kokiri-search-input {
        width: 100%; background: var(--surface2, #17201a); border: 1px solid var(--border, rgba(163,214,140,0.14));
        color: var(--text, #e4ede0); border-radius: 100px; padding: 0.4rem 0.9rem; font-family: inherit; font-size: 0.8rem;
      }
      #kokiri-search-input:focus { outline: none; border-color: var(--leaf-bright, #a8e79f); }
      #kokiri-search-results {
        display: none; position: absolute; top: calc(100% + 6px); left: 0; width: 320px; max-height: 360px; overflow-y: auto;
        background: var(--surface, #121a13); border: 1px solid var(--border-bright, rgba(163,214,140,0.32)); border-radius: 10px;
        box-shadow: 0 8px 30px rgba(0,0,0,0.5); z-index: 50; padding: 0.4rem;
      }
      .kokiri-search-result { display: block; padding: 0.5rem 0.7rem; border-radius: 7px; text-decoration: none; margin-bottom: 0.15rem; }
      .kokiri-search-result:hover { background: var(--surface2, #17201a); }
      .kokiri-search-result .srn { color: var(--text, #e4ede0); font-size: 0.83rem; font-weight: 600; display: block; }
      .kokiri-search-result .srm { color: var(--dim, #6b8065); font-size: 0.65rem; font-family: 'IBM Plex Mono', monospace; text-transform: uppercase; }
      #kokiri-search-empty { color: var(--muted, #9db396); font-size: 0.8rem; padding: 0.6rem 0.7rem; }
      @media (max-width: 900px) { #kokiri-search-wrap { display: none; } }
    `;
    document.head.appendChild(style);
  }

  const wrap = document.createElement('div');
  wrap.id = 'kokiri-search-wrap';
  wrap.innerHTML = `
    <input type="text" id="kokiri-search-input" placeholder="🔍 Search pages…" autocomplete="off">
    <div id="kokiri-search-results"></div>
  `;
  topbar.insertBefore(wrap, topbar.firstChild);

  const [{ data: pages }, { data: sheets }] = await Promise.all([
    supabase.from('kokiri_pages').select('name, url, description, category').order('name'),
    supabase.from('kokiri_sheets').select('name, slug').order('name'),
  ]);

  const items = [
    ...(pages || []).map(p => ({ name: p.name, url: p.url, meta: p.category || 'Page', description: p.description || '' })),
    ...(sheets || []).map(s => ({ name: s.name, url: `app.html#${s.slug}`, meta: 'Sheet', description: '' })),
  ];

  const input = document.getElementById('kokiri-search-input');
  const results = document.getElementById('kokiri-search-results');

  function render(list) {
    if (!list.length) {
      results.innerHTML = '<div id="kokiri-search-empty">No matches.</div>';
      results.style.display = 'block';
      return;
    }
    results.innerHTML = list.slice(0, 10).map(p => `
      <a class="kokiri-search-result" href="${escapeHtml(p.url)}">
        <span class="srn">${escapeHtml(p.name)}</span>
        <span class="srm">${escapeHtml(p.meta)}</span>
      </a>
    `).join('');
    results.style.display = 'block';
  }

  function search() {
    const q = input.value.trim().toLowerCase();
    if (!q) { results.style.display = 'none'; return; }
    const matched = items.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q) ||
      p.meta.toLowerCase().includes(q)
    );
    render(matched);
  }

  input.addEventListener('input', search);
  input.addEventListener('focus', () => { if (input.value.trim()) search(); });
  document.addEventListener('click', (e) => { if (!wrap.contains(e.target)) results.style.display = 'none'; });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { results.style.display = 'none'; input.blur(); }
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); input.focus(); }
  });
}
