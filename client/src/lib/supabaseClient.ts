/**
 * Lightweight Supabase REST helper for client-side usage.
 * Vercel exposes env vars prefixed with VITE_ to the browser build.
 */
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || (typeof process !== 'undefined' ? process.env.SUPABASE_URL : undefined);
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || (typeof process !== 'undefined' ? process.env.SUPABASE_ANON_KEY : undefined);

type Headers = Record<string, string>;

function getHeaders(): Headers {
  if (!supabaseUrl || !supabaseAnonKey) {
    console.warn("Supabase client is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY in .env.local/Vercel.");
    return {};
  }

  return {
    apikey: supabaseAnonKey,
    Authorization: `Bearer ${supabaseAnonKey}`,
    "Content-Type": "application/json",
  };
}

export async function fetchHighlightJobFromSupabase(id: string) {
  if (!supabaseUrl || !supabaseAnonKey) return null;

  const response = await fetch(`${supabaseUrl}/rest/v1/highlight_jobs?id=eq.${encodeURIComponent(id)}&limit=1`, {
    headers: getHeaders(),
  });

  if (!response.ok) {
    console.warn("Supabase status fetch failed", await response.text());
    return null;
  }

  const rows = await response.json();
  return rows?.[0] ?? null;
}

export { supabaseUrl, supabaseAnonKey };
