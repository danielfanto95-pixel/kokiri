/**
 * Shared auth/role gating. Kokiri has two roles: 'owner' (full access) and
 * 'member' (guest — scoped to whatever kokiri_sheets/dashboards they've been
 * explicitly granted via user_permissions, enforced server-side by RLS).
 * Guests are only ever allowed onto portal/dashboard pages; every other page
 * calls requireOwnerPage() and bounces non-owners to portals.html.
 */

export async function getActiveProfile(supabase) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { window.location.href = 'login.html'; return null; }
  const { data: profile } = await supabase.from('profiles').select('role, status').eq('id', session.user.id).maybeSingle();
  if (!profile || profile.status !== 'active') {
    await supabase.auth.signOut();
    window.location.href = 'login.html';
    return null;
  }
  return { session, profile };
}

/** Use on pages anyone with an active account may see (portals, dashboards, operations). */
export async function requireActiveUser(supabase) {
  return await getActiveProfile(supabase);
}

/** Use on every other page — owner only, guests get redirected to portals.html. */
export async function requireOwnerPage(supabase) {
  const result = await getActiveProfile(supabase);
  if (!result) return null;
  if (result.profile.role !== 'owner') {
    window.location.href = 'portals.html';
    return null;
  }
  return result;
}
