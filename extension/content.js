// Content script (isolated world). Builds the floating button + sidebar, injects
// the page-context bridge, and reads the article title (directly from the DOM)
// and body (via the bridge / CKEditor API, with an iframe-DOM read fallback).
//
// Stage 0 goal: prove we can read the editor. No backend, no auth, no write-back.
(function () {
  "use strict";

  // Only run UI/bridge logic in the top frame. The script also loads inside the
  // CKEditor iframe (all_frames), where it must do nothing.
  if (window.top !== window) return;

  const TAG = "AI_PROOFREADER";
  const SELECTORS = {
    editorContainer: "#cke_editor1",
    editorIframe: "iframe.cke_wysiwyg_frame",
    hiddenTextarea: 'textarea[ng-model="article.content"]',
    title: 'input.article-title, input#title, input[ng-model="article.title"]'
  };

  let bridgeInjected = false;
  let bridgeReady = false;
  const pending = new Map();
  let reqSeq = 0;

  // ---- Bridge plumbing ------------------------------------------------------

  function injectBridge() {
    if (bridgeInjected) return;
    bridgeInjected = true;
    const s = document.createElement("script");
    s.src = chrome.runtime.getURL("bridge.js");
    s.onload = () => s.remove();
    (document.head || document.documentElement).appendChild(s);
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.tag !== TAG) return;

    if (data.direction === "ready") {
      bridgeReady = true;
      return;
    }
    if (data.direction === "response" && pending.has(data.id)) {
      const { resolve, timer } = pending.get(data.id);
      clearTimeout(timer);
      pending.delete(data.id);
      resolve(data.payload);
    }
  });

  function askBridge(action, timeoutMs = 4000) {
    return new Promise((resolve) => {
      const id = ++reqSeq;
      const timer = setTimeout(() => {
        pending.delete(id);
        resolve({ error: "timeout" });
      }, timeoutMs);
      pending.set(id, { resolve, timer });
      window.postMessage({ tag: TAG, direction: "request", action, id }, "*");
    });
  }

  // ---- Reading --------------------------------------------------------------

  function readTitle() {
    const input = document.querySelector(SELECTORS.title);
    return input ? input.value : null;
  }

  // Fallback: read body straight from the CKEditor iframe DOM. Read/debug only.
  // Use the specific iframe class so the hidden propertiesFormNone iframe and
  // any other iframes are ignored.
  function readBodyFromIframe() {
    const iframe = document.querySelector(SELECTORS.editorIframe);
    if (!iframe) return null;
    try {
      const doc = iframe.contentDocument || iframe.contentWindow.document;
      if (!doc || !doc.body) return null;
      return { html: doc.body.innerHTML, plainText: doc.body.innerText };
    } catch (err) {
      return null;
    }
  }

  // Returns { source, editorName, html, plainText } or { error }.
  async function readBody() {
    const resp = await askBridge("GET_CKEDITOR_DATA");
    if (resp && !resp.error && typeof resp.html === "string") {
      return { source: "CKEditor API", ...resp };
    }
    const fb = readBodyFromIframe();
    if (fb) return { source: "iframe DOM (fallback)", editorName: null, ...fb };
    return { error: (resp && resp.error) || "could not read body" };
  }

  // ---- UI -------------------------------------------------------------------

  const BUTTON_ID = "ai-proofreader-button";
  const PANEL_ID = "ai-proofreader-panel";

  function el(tag, className, text) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text != null) e.textContent = text;
    return e;
  }

  function ensureButton() {
    if (document.getElementById(BUTTON_ID)) return; // idempotent
    const btn = el("button", "ai-proofreader-button", "AI korektura");
    btn.id = BUTTON_ID;
    btn.type = "button";
    btn.addEventListener("click", togglePanel);
    document.body.appendChild(btn);
  }

  function togglePanel() {
    const existing = document.getElementById(PANEL_ID);
    if (existing) {
      existing.remove();
      return;
    }
    openPanel();
  }

  function openPanel() {
    const panel = el("div", "ai-proofreader-panel");
    panel.id = PANEL_ID;

    const header = el("div", "ai-proofreader-header");
    header.appendChild(el("span", "ai-proofreader-title", "AI korektura — Stage 0"));
    const close = el("button", "ai-proofreader-close", "×");
    close.type = "button";
    close.title = "Zavřít";
    close.addEventListener("click", () => panel.remove());
    header.appendChild(close);
    panel.appendChild(header);

    const reloadBtn = el("button", "ai-proofreader-reload", "Načíst znovu");
    reloadBtn.type = "button";
    reloadBtn.addEventListener("click", () => loadInto(body));
    panel.appendChild(reloadBtn);

    const body = el("div", "ai-proofreader-body");
    panel.appendChild(body);

    document.body.appendChild(panel);
    loadInto(body);
  }

  function field(label, value, mono) {
    const wrap = el("div", "ai-proofreader-field");
    wrap.appendChild(el("div", "ai-proofreader-label", label));
    const val = el("div", "ai-proofreader-value" + (mono ? " ai-proofreader-mono" : ""));
    val.textContent = value;
    wrap.appendChild(val);
    return wrap;
  }

  async function loadInto(body) {
    body.textContent = "";
    body.appendChild(el("div", "ai-proofreader-status", "Načítám text z editoru…"));

    const title = readTitle();
    const result = await readBody();

    body.textContent = "";

    if (result.error) {
      body.appendChild(
        el("div", "ai-proofreader-status ai-proofreader-error",
          "Nepodařilo se přečíst tělo článku: " + result.error)
      );
    }

    body.appendChild(field("Zdroj", result.source || "—"));
    if (result.editorName) body.appendChild(field("CKEditor instance", result.editorName));
    body.appendChild(field("Titulek", title != null ? title : "(nenalezen)"));

    if (!result.error) {
      body.appendChild(field("Tělo (text)", result.plainText || "(prázdné)"));

      const details = el("details", "ai-proofreader-details");
      details.appendChild(el("summary", null, "Zobrazit HTML"));
      const pre = el("pre", "ai-proofreader-html");
      pre.textContent = result.html || "";
      details.appendChild(pre);
      body.appendChild(details);
    }
  }

  // ---- Editor detection across the AngularJS SPA ----------------------------

  function editorPresent() {
    return !!(
      document.querySelector(SELECTORS.editorContainer) ||
      document.querySelector(SELECTORS.editorIframe)
    );
  }

  function initWhenEditorAppears() {
    if (!editorPresent()) return;
    injectBridge();
    ensureButton();
  }

  let debounceTimer = null;
  function scheduleInit() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(initWhenEditorAppears, 250);
  }

  const observer = new MutationObserver(scheduleInit);
  observer.observe(document.documentElement, { childList: true, subtree: true });

  // Hash routing: the editor re-renders without a full reload on navigation.
  window.addEventListener("hashchange", () => {
    // The old button may be detached when the view re-renders; re-init covers it.
    scheduleInit();
  });

  scheduleInit();
})();
