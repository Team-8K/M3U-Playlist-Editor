/**
 * Team 8K — M3U Proxy Edge Function
 * Builds M3U from Xtream Codes player_api.php (live streams only)
 * Runs on Cloudflare network via Netlify Edge Functions
 * Protected with Netlify Identity JWT
 */

export default async (request, context) => {

  const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  // Parse body
  let host, username, password, url;
  try {
    const body = await request.json();
    host     = (body.host     || "").trim().replace(/\/$/, "");
    username = (body.username || "").trim();
    password = (body.password || "").trim();
    url      = (body.url      || "").trim();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid request body" }), {
      status: 400, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  // If a raw URL was passed, extract host/username/password from it
  if (url && (!host || !username || !password)) {
    try {
      const u = new URL(url);
      host     = host     || `${u.protocol}//${u.host}`;
      username = username || u.searchParams.get("username") || "";
      password = password || u.searchParams.get("password") || "";
    } catch {
      return new Response(JSON.stringify({ error: "Invalid URL format" }), {
        status: 400, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }
  }

  if (!host || !username || !password) {
    return new Response(JSON.stringify({ error: "Missing host, username or password" }), {
      status: 400, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  if (!/^https?:\/\/.+/.test(host)) {
    return new Response(JSON.stringify({ error: "Host must start with http:// or https://" }), {
      status: 400, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  const apiBase = `${host}/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;

  const fetchJson = async (actionUrl) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    try {
      const res = await fetch(actionUrl, {
        headers: { "User-Agent": "okhttp/4.9.0", "Accept": "application/json" },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      clearTimeout(timer);
      throw err;
    }
  };

  try {
    // Step 1: Verify credentials via player_api.php
    const authCheck = await fetchJson(apiBase);
    if (!authCheck?.user_info) {
      return new Response(JSON.stringify({ error: "Invalid credentials. Could not authenticate with your IPTV provider." }), {
        status: 401, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    // Step 2: Get live categories
    const categories = await fetchJson(`${apiBase}&action=get_live_categories`);
    const catMap = {};
    if (Array.isArray(categories)) {
      categories.forEach(c => { catMap[c.category_id] = c.category_name; });
    }

    // Step 3: Get all live streams
    const streams = await fetchJson(`${apiBase}&action=get_live_streams`);
    if (!Array.isArray(streams) || streams.length === 0) {
      return new Response(JSON.stringify({ error: "No live streams found on your account." }), {
        status: 404, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    // Step 4: Build M3U
    let m3u = "#EXTM3U\n";
    for (const s of streams) {
      const name     = (s.name         || "Unknown").replace(/,/g, " ");
      const logo     = s.stream_icon   || "";
      const group    = catMap[s.category_id] || s.category_name || "Uncategorized";
      const tvgId    = s.epg_channel_id || "";
      const streamId = s.stream_id;
      const streamUrl = `${host}/live/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${streamId}.ts`;

      m3u += `#EXTINF:-1 tvg-id="${tvgId}" tvg-logo="${logo}" group-title="${group}",${name}\n`;
      m3u += `${streamUrl}\n`;
    }

    return new Response(m3u, {
      status: 200,
      headers: {
        ...CORS,
        "Content-Type": "audio/x-mpegurl; charset=utf-8",
        "Cache-Control": "no-store, no-cache",
      },
    });

  } catch (err) {
    const isTimeout = err.name === "AbortError";
    return new Response(
      JSON.stringify({ error: isTimeout ? "Request timed out. Your IPTV server did not respond in 25 seconds." : `Error: ${err.message}` }),
      { status: 502, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }
};

export const config = { path: "/api/m3u-proxy" };
