// Service worker (extension context). All backend network calls go through
// here: it has cross-origin privilege for the hosts declared in the manifest,
// so it avoids CORS and keeps the bearer token out of the page world.
//
// The token lives in chrome.storage.local under "session". The backend base URL
// defaults to production but can be overridden (e.g. localhost) from the sidebar.

const DEFAULT_API_BASE = "https://news-view.vercel.app";

async function getApiBase() {
  const { apiBase } = await chrome.storage.local.get("apiBase");
  return (apiBase || DEFAULT_API_BASE).replace(/\/+$/, "");
}

async function getStoredSession() {
  const { session } = await chrome.storage.local.get("session");
  return session || null;
}

async function handle(msg) {
  switch (msg && msg.type) {
    case "GET_STATE": {
      return {
        apiBase: await getApiBase(),
        defaultApiBase: DEFAULT_API_BASE,
        session: await getStoredSession(),
      };
    }

    case "SET_API_BASE": {
      const base = (msg.apiBase || "").trim() || DEFAULT_API_BASE;
      await chrome.storage.local.set({ apiBase: base });
      return { ok: true, apiBase: base.replace(/\/+$/, "") };
    }

    case "LOGIN": {
      const base = await getApiBase();
      // The access code is only sent when the user typed one; it is never
      // persisted (unlike the token, which is what later requests use).
      const payload = { email: msg.email };
      if (msg.secret) payload.secret = msg.secret;
      let res;
      try {
        res = await fetch(base + "/api/extension/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } catch (e) {
        return { error: "Síťová chyba: " + ((e && e.message) || e) };
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { error: data.error || "HTTP " + res.status };
      const session = {
        token: data.token,
        email: data.email,
        expiresAt: data.expiresAt,
      };
      await chrome.storage.local.set({ session });
      return { session };
    }

    case "LOGOUT": {
      await chrome.storage.local.remove("session");
      return { ok: true };
    }

    case "PROOFREAD": {
      const base = await getApiBase();
      const session = await getStoredSession();
      if (!session) return { error: "Nejste přihlášeni.", reauth: true };
      let res;
      try {
        res = await fetch(base + "/api/proofread", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + session.token,
          },
          body: JSON.stringify(msg.payload),
        });
      } catch (e) {
        return { error: "Síťová chyba: " + ((e && e.message) || e) };
      }
      if (res.status === 401) {
        await chrome.storage.local.remove("session");
        return { error: "Přihlášení vypršelo.", reauth: true };
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { error: data.error || "HTTP " + res.status };
      return { result: data };
    }

    default:
      return { error: "Unknown message" };
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  handle(msg)
    .then(sendResponse)
    .catch((e) => sendResponse({ error: String((e && e.message) || e) }));
  return true; // keep the channel open for the async response
});
