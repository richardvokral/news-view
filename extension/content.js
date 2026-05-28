// Content script (isolated world). Builds the floating button + sidebar, injects
// the page-context bridge (CKEditor read/write), talks to the background service
// worker for all backend calls (login + proofread), and writes approved
// corrections back into the editor.
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
    title: 'input.article-title, input#title, input[ng-model="article.title"]',
  };

  const MODES = [
    { value: "pravopis_gramatika_interpunkce", label: "Pravopis, gramatika a interpunkce" },
    { value: "pravopis_gramatika", label: "Pravopis a gramatika" },
    { value: "jemna_stylistika", label: "Jemná stylistika" },
  ];

  let bridgeInjected = false;
  const pending = new Map();
  let reqSeq = 0;

  // ---- Bridge plumbing (page world: CKEditor) -------------------------------

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
    if (data.direction === "response" && pending.has(data.id)) {
      const { resolve, timer } = pending.get(data.id);
      clearTimeout(timer);
      pending.delete(data.id);
      resolve(data.payload);
    }
  });

  function askBridge(action, payload, timeoutMs = 8000) {
    return new Promise((resolve) => {
      const id = ++reqSeq;
      const timer = setTimeout(() => {
        pending.delete(id);
        resolve({ error: "timeout" });
      }, timeoutMs);
      pending.set(id, { resolve, timer });
      window.postMessage({ tag: TAG, direction: "request", action, id, payload }, "*");
    });
  }

  // ---- Background plumbing (backend) ----------------------------------------

  function bg(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (resp) => {
          if (chrome.runtime.lastError) {
            resolve({ error: chrome.runtime.lastError.message });
            return;
          }
          resolve(resp || {});
        });
      } catch (e) {
        resolve({ error: String((e && e.message) || e) });
      }
    });
  }

  // ---- Reading the article --------------------------------------------------

  function readTitleInput() {
    return document.querySelector(SELECTORS.title);
  }

  function readBodyFromIframe() {
    const iframe = document.querySelector(SELECTORS.editorIframe);
    if (!iframe) return null;
    try {
      const doc = iframe.contentDocument || iframe.contentWindow.document;
      if (!doc || !doc.body) return null;
      return { html: doc.body.innerHTML, plainText: doc.body.innerText };
    } catch (e) {
      return null;
    }
  }

  async function readBody() {
    const resp = await askBridge("GET_CKEDITOR_DATA");
    if (resp && !resp.error && typeof resp.html === "string") {
      return { source: "CKEditor API", ...resp };
    }
    const fb = readBodyFromIframe();
    if (fb) return { source: "iframe DOM (fallback)", editorName: null, ...fb };
    return { error: (resp && resp.error) || "nelze přečíst tělo" };
  }

  function currentArticleId() {
    const m = location.href.match(/\/edit\/[^/]+\/([^/?#]+)/);
    return m ? m[1] : null;
  }

  // ---- Write-back -----------------------------------------------------------

  function setTitleValue(text) {
    const input = readTitleInput();
    if (!input) return false;
    input.value = text;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  async function setBodyHtml(html) {
    const resp = await askBridge("SET_CKEDITOR_DATA", { html });
    return resp && !resp.error;
  }

  // Apply only accepted text replacements onto the original string (first match).
  function applyReplacements(text, suggestions) {
    let out = text;
    for (const s of suggestions) {
      if (!s.original) continue;
      const idx = out.indexOf(s.original);
      if (idx >= 0) {
        out = out.slice(0, idx) + s.replacement + out.slice(idx + s.original.length);
      }
    }
    return out;
  }

  // ---- UI helpers -----------------------------------------------------------

  const BUTTON_ID = "ai-proofreader-button";
  const PANEL_ID = "ai-proofreader-panel";

  function el(tag, className, text) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text != null) e.textContent = text;
    return e;
  }

  function ensureButton() {
    if (document.getElementById(BUTTON_ID)) return;
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

  // ---- Panel ----------------------------------------------------------------

  let panelBody = null;
  let state = { apiBase: "", session: null, defaultApiBase: "" };

  async function openPanel() {
    const panel = el("div", "ai-proofreader-panel");
    panel.id = PANEL_ID;

    const header = el("div", "ai-proofreader-header");
    header.appendChild(el("span", "ai-proofreader-title", "AI korektura"));
    const close = el("button", "ai-proofreader-close", "×");
    close.type = "button";
    close.title = "Zavřít";
    close.addEventListener("click", () => panel.remove());
    header.appendChild(close);
    panel.appendChild(header);

    panelBody = el("div", "ai-proofreader-body");
    panel.appendChild(panelBody);
    document.body.appendChild(panel);

    panelBody.appendChild(el("div", "ai-proofreader-status", "Načítám…"));
    state = await bg({ type: "GET_STATE" });
    render();
  }

  function render() {
    if (!panelBody) return;
    panelBody.textContent = "";
    if (!state || state.error) {
      panelBody.appendChild(
        el("div", "ai-proofreader-status ai-proofreader-error", "Chyba rozšíření: " + ((state && state.error) || "neznámá"))
      );
      return;
    }
    if (!state.session) {
      renderLogin();
    } else {
      renderMain();
    }
    renderFooter();
  }

  function renderLogin() {
    const wrap = el("div", "ai-proofreader-section");
    wrap.appendChild(el("div", "ai-proofreader-label", "Přihlášení e-mailem"));
    const input = el("input", "ai-proofreader-input");
    input.type = "email";
    input.placeholder = "vas@email.cz";
    wrap.appendChild(input);
    const btn = el("button", "ai-proofreader-primary", "Přihlásit");
    btn.type = "button";
    const msg = el("div", "ai-proofreader-status");
    btn.addEventListener("click", async () => {
      const email = input.value.trim();
      if (!email) return;
      btn.disabled = true;
      msg.textContent = "Přihlašuji…";
      const resp = await bg({ type: "LOGIN", email });
      btn.disabled = false;
      if (resp.error) {
        msg.className = "ai-proofreader-status ai-proofreader-error";
        msg.textContent = resp.error;
        return;
      }
      state.session = resp.session;
      render();
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") btn.click();
    });
    wrap.appendChild(btn);
    wrap.appendChild(msg);
    panelBody.appendChild(wrap);
  }

  function renderMain() {
    // Account row
    const acct = el("div", "ai-proofreader-acct");
    acct.appendChild(el("span", "ai-proofreader-acct-email", state.session.email));
    const logout = el("button", "ai-proofreader-link", "Odhlásit");
    logout.type = "button";
    logout.addEventListener("click", async () => {
      await bg({ type: "LOGOUT" });
      state.session = null;
      render();
    });
    acct.appendChild(logout);
    panelBody.appendChild(acct);

    // Controls
    const controls = el("div", "ai-proofreader-section");

    controls.appendChild(el("div", "ai-proofreader-label", "Režim"));
    const modeSel = el("select", "ai-proofreader-input");
    MODES.forEach((m) => {
      const opt = el("option", null, m.label);
      opt.value = m.value;
      modeSel.appendChild(opt);
    });
    controls.appendChild(modeSel);

    const fields = el("div", "ai-proofreader-checks");
    const titleChk = checkbox("Titulek", true);
    const bodyChk = checkbox("Tělo článku", true);
    fields.appendChild(titleChk.label);
    fields.appendChild(bodyChk.label);
    controls.appendChild(fields);

    const runBtn = el("button", "ai-proofreader-primary", "Zkontrolovat");
    runBtn.type = "button";
    controls.appendChild(runBtn);

    const status = el("div", "ai-proofreader-status");
    controls.appendChild(status);
    panelBody.appendChild(controls);

    const results = el("div", "ai-proofreader-results");
    panelBody.appendChild(results);

    runBtn.addEventListener("click", async () => {
      results.textContent = "";
      status.className = "ai-proofreader-status";
      const wantTitle = titleChk.input.checked;
      const wantBody = bodyChk.input.checked;
      if (!wantTitle && !wantBody) {
        status.textContent = "Vyberte titulek nebo tělo.";
        return;
      }
      status.textContent = "Čtu článek…";

      const titleInput = readTitleInput();
      const titleText = wantTitle && titleInput ? titleInput.value : null;
      let bodyRead = null;
      if (wantBody) {
        bodyRead = await readBody();
        if (bodyRead.error) {
          status.className = "ai-proofreader-status ai-proofreader-error";
          status.textContent = "Nelze přečíst tělo: " + bodyRead.error;
          return;
        }
      }
      const originalHtml = bodyRead ? bodyRead.html : null;

      status.textContent = "Kontroluji (AI)…";
      runBtn.disabled = true;
      const payload = {
        mode: modeSel.value,
        articleId: currentArticleId(),
        sourceUrl: location.href,
        fields: {},
      };
      if (titleText != null) payload.fields.title = titleText;
      if (originalHtml != null) payload.fields.bodyHtml = originalHtml;

      const resp = await bg({ type: "PROOFREAD", payload });
      runBtn.disabled = false;

      if (resp.error) {
        status.className = "ai-proofreader-status ai-proofreader-error";
        status.textContent = resp.error;
        if (resp.reauth) {
          state.session = null;
          render();
        }
        return;
      }
      status.textContent = "";
      renderResults(results, resp.result, { titleText, originalHtml });
    });
  }

  function checkbox(labelText, checked) {
    const label = el("label", "ai-proofreader-check");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = !!checked;
    label.appendChild(input);
    label.appendChild(document.createTextNode(" " + labelText));
    return { label, input };
  }

  // ---- Results / review -----------------------------------------------------

  function renderResults(container, result, original) {
    container.textContent = "";
    const suggestions = Array.isArray(result.suggestions) ? result.suggestions : [];

    // The backend doesn't echo the corrected text — we reconstruct it here from
    // the suggestion list (for the "Vložit celou opravenou verzi" shortcut).
    const titleSugg = suggestions.filter((s) => s.field === "title");
    const bodySugg = suggestions.filter((s) => s.field === "body");
    const correctedTitle =
      original.titleText != null ? applyReplacements(original.titleText, titleSugg) : null;
    const correctedHtml =
      original.originalHtml != null ? applyReplacements(original.originalHtml, bodySugg) : null;

    if (result.summary) {
      container.appendChild(field("Shrnutí", result.summary));
    }
    if (result.usage) {
      const u = result.usage;
      const cost = typeof u.costCzk === "number" ? u.costCzk.toFixed(2) + " Kč" : "";
      container.appendChild(
        el("div", "ai-proofreader-meta", (u.modelLabel || u.model || "") + (cost ? " · ~" + cost : ""))
      );
    }
    if (Array.isArray(result.warnings) && result.warnings.length) {
      const w = el("div", "ai-proofreader-warn");
      w.appendChild(el("div", "ai-proofreader-label", "Upozornění"));
      result.warnings.forEach((x) => w.appendChild(el("div", null, "• " + x)));
      container.appendChild(w);
    }

    // A suggestion is "usable" if its `original` snippet can be found
    // verbatim in the source (otherwise applying it is a no-op).
    function sourceFor(s) {
      return s.field === "title" ? original.titleText : original.originalHtml;
    }
    function isApplicable(s) {
      const src = sourceFor(s);
      return !!s.original && typeof src === "string" && src.indexOf(s.original) >= 0;
    }

    const checks = [];
    if (suggestions.length) {
      const list = el("div", "ai-proofreader-suggestions");
      list.appendChild(el("div", "ai-proofreader-label", "Návrhy (" + suggestions.length + ")"));
      suggestions.forEach((s, i) => {
        const applicable = isApplicable(s);
        const row = el(
          "div",
          "ai-proofreader-suggestion" + (applicable ? "" : " ai-proofreader-suggestion-bad")
        );
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = applicable;
        cb.disabled = !applicable;
        checks[i] = cb;
        const main = el("div", "ai-proofreader-suggestion-main");
        const change = el("div", "ai-proofreader-change");
        const del = el("span", "ai-proofreader-del", s.original || "");
        const arrow = el("span", null, " → ");
        const ins = el("span", "ai-proofreader-ins", s.replacement || "");
        change.appendChild(del);
        change.appendChild(arrow);
        change.appendChild(ins);
        main.appendChild(change);
        if (s.explanation) main.appendChild(el("div", "ai-proofreader-expl", s.explanation));
        const pills = el("div", null);
        pills.appendChild(
          el("span", "ai-proofreader-pill", (s.field === "title" ? "titulek" : "tělo") + " · " + (s.type || ""))
        );
        if (!applicable) {
          pills.appendChild(
            el("span", "ai-proofreader-pill ai-proofreader-pill-bad", "nelze najít v textu")
          );
        }
        main.appendChild(pills);
        const cbWrap = el("label", "ai-proofreader-cb");
        cbWrap.appendChild(cb);
        row.appendChild(cbWrap);
        row.appendChild(main);
        list.appendChild(row);
      });
      container.appendChild(list);
    } else {
      const emptyMsg = result.summary && /chyb|oprav/i.test(result.summary)
        ? "Model nenavrhl žádné konkrétní opravy (vrátil jen shrnutí). Zkuste jiný model nebo upravte prompt v adminu."
        : "Žádné návrhy — text je v pořádku.";
      container.appendChild(el("div", "ai-proofreader-status", emptyMsg));
    }

    // Action buttons.
    const actions = el("div", "ai-proofreader-actions");
    const noteEl = el("div", "ai-proofreader-status");

    const applySel = el("button", "ai-proofreader-primary", "Vložit vybrané");
    applySel.type = "button";
    applySel.addEventListener("click", async () => {
      const accepted = suggestions.filter((_, i) => checks[i] && checks[i].checked);
      await writeBack(
        original,
        {
          title:
            original.titleText != null
              ? applyReplacements(original.titleText, accepted.filter((s) => s.field === "title"))
              : null,
          bodyHtml:
            original.originalHtml != null
              ? applyReplacements(original.originalHtml, accepted.filter((s) => s.field === "body"))
              : null,
        },
        noteEl
      );
    });

    const applyAll = el("button", "ai-proofreader-secondary", "Vložit celou opravenou verzi");
    applyAll.type = "button";
    applyAll.addEventListener("click", async () => {
      await writeBack(
        original,
        { title: correctedTitle, bodyHtml: correctedHtml },
        noteEl
      );
    });

    actions.appendChild(applySel);
    actions.appendChild(applyAll);
    container.appendChild(actions);
    container.appendChild(noteEl);
  }

  async function writeBack(original, next, noteEl) {
    let wroteTitle = false;
    let wroteBody = false;
    if (original.titleText != null && next.title != null) {
      wroteTitle = setTitleValue(next.title);
    }
    if (original.originalHtml != null && next.bodyHtml != null) {
      wroteBody = await setBodyHtml(next.bodyHtml);
    }
    noteEl.className = "ai-proofreader-status";
    if (wroteTitle || wroteBody) {
      const parts = [];
      if (wroteTitle) parts.push("titulek");
      if (wroteBody) parts.push("tělo");
      noteEl.textContent = "Vloženo (" + parts.join(", ") + "). Nezapomeňte uložit článek v CMS.";
    } else {
      noteEl.className = "ai-proofreader-status ai-proofreader-error";
      noteEl.textContent = "Vložení se nezdařilo.";
    }
  }

  function field(label, value) {
    const wrap = el("div", "ai-proofreader-field");
    wrap.appendChild(el("div", "ai-proofreader-label", label));
    wrap.appendChild(el("div", "ai-proofreader-value", value));
    return wrap;
  }


  function renderFooter() {
    const footer = el("div", "ai-proofreader-footer");
    const details = el("details", null);
    details.appendChild(el("summary", null, "Nastavení serveru"));
    const input = el("input", "ai-proofreader-input");
    input.type = "text";
    input.value = state.apiBase || "";
    input.placeholder = state.defaultApiBase || "";
    const saveBtn = el("button", "ai-proofreader-link", "Uložit URL");
    saveBtn.type = "button";
    saveBtn.addEventListener("click", async () => {
      const resp = await bg({ type: "SET_API_BASE", apiBase: input.value.trim() });
      if (resp && resp.apiBase) state.apiBase = resp.apiBase;
    });
    details.appendChild(input);
    details.appendChild(saveBtn);
    footer.appendChild(details);
    panelBody.appendChild(footer);
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
  window.addEventListener("hashchange", scheduleInit);
  scheduleInit();
})();
