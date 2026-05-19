/**
 * Team 8K — M3U Proxy Function
 * Protected with Netlify Identity JWT
 */

exports.handler = async function (event) {

  const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };

  // CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }

  // Only POST allowed
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: { ...CORS, "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  // ── Identity check ────────────────────────────────────────────
  // Netlify populates clientContext.user when Authorization: Bearer <jwt> is present
  // Log what we receive to debug
  const clientContext = event.clientContext || {};
  const user = clientContext.user;
  const authHeader = event.headers["authorization"] || event.headers["Authorization"] || "";

  console.log("clientContext keys:", Object.keys(clientContext));
  console.log("user present:", !!user);
  console.log("auth header present:", !!authHeader);

  if (!user && !authHeader.startsWith("Bearer ")) {
    return {
      statusCode: 401,
      headers: { ...CORS, "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Unauthorized. Please log in to use this feature." }),
    };
  }

  // ── Parse body ────────────────────────────────────────────────
  let targetUrl = "";
  try {
    const body = JSON.parse(event.body || "{}");
    targetUrl = (body.url || "").trim();
  } catch {
    return {
      statusCode: 400,
      headers: { ...CORS, "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Invalid request body" }),
    };
  }

  if (!targetUrl) {
    return {
      statusCode: 400,
      headers: { ...CORS, "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Missing 'url' in request body" }),
    };
  }

  if (!/^https?:\/\/.+/.test(targetUrl)) {
    return {
      statusCode: 400,
      headers: { ...CORS, "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Invalid URL. Must start with http:// or https://" }),
    };
  }

  // ── Fetch with multiple User-Agent fallbacks ──────────────────
  const userAgents = [
    "okhttp/4.9.0",
    "VLC/3.0.18 LibVLC/3.0.18",
    "Tivimate/4.7.0",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
  ];

  let lastError = "";

  for (const ua of userAgents) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20000);

      const upstream = await fetch(targetUrl, {
        method: "GET",
        headers: {
          "User-Agent": ua,
          "Accept": "*/*",
          "Accept-Encoding": "identity",
          "Connection": "keep-alive",
        },
        redirect: "follow",
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (upstream.status >= 400) {
        lastError = `Server returned HTTP ${upstream.status}`;
        continue;
      }

      const text = await upstream.text();

      if (!text.includes("#EXTM3U") && !text.includes("#EXTINF")) {
        return {
          statusCode: 422,
          headers: { ...CORS, "Content-Type": "application/json" },
          body: JSON.stringify({
            error: `Server did not return a valid M3U. Server said: ${text.slice(0, 300)}`,
          }),
        };
      }

      return {
        statusCode: 200,
        headers: {
          ...CORS,
          "Content-Type": "audio/x-mpegurl; charset=utf-8",
          "Cache-Control": "no-store, no-cache",
        },
        body: text,
      };

    } catch (err) {
      if (err.name === "AbortError") {
        return {
          statusCode: 504,
          headers: { ...CORS, "Content-Type": "application/json" },
          body: JSON.stringify({ error: "Request timed out after 20 seconds." }),
        };
      }
      lastError = err.message;
      continue;
    }
  }

  return {
    statusCode: 502,
    headers: { ...CORS, "Content-Type": "application/json" },
    body: JSON.stringify({ error: `Could not reach your IPTV server. Last error: ${lastError}` }),
  };
};
