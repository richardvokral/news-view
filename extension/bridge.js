// Runs in the PAGE's JS world (injected via <script src> by content.js), so it
// can see window.CKEDITOR, which the isolated content script cannot reach.
// Communicates with the content script purely through window.postMessage.
//
// Read actions: PING, GET_CKEDITOR_DATA. Write-back: SET_CKEDITOR_DATA goes
// through the CKEditor API (not raw iframe DOM) and notifies AngularJS via the
// backing textarea so the CMS save workflow sees the change.
(function () {
  "use strict";

  const TAG = "AI_PROOFREADER";
  const CONTENT_TEXTAREA = 'textarea[ng-model="article.content"]';

  // Pick the editor instance backing the article body. Don't assume "editor1":
  // prefer the instance whose element is the article-content textarea, then any
  // instance attached to that textarea by name, else the first instance.
  function findArticleEditor() {
    const CK = window.CKEDITOR;
    if (!CK || !CK.instances) return null;

    const names = Object.keys(CK.instances);
    if (names.length === 0) return null;

    const textarea = document.querySelector(CONTENT_TEXTAREA);

    for (const name of names) {
      const editor = CK.instances[name];
      if (!editor) continue;
      const el = editor.element && editor.element.$;
      if (textarea && el === textarea) return editor;
    }

    if (textarea && textarea.id && CK.instances[textarea.id]) {
      return CK.instances[textarea.id];
    }

    return CK.instances[names[0]] || null;
  }

  function htmlToPlainText(html) {
    const tmp = document.createElement("div");
    tmp.innerHTML = html || "";
    // Normalize non-breaking spaces to regular spaces for display.
    return (tmp.textContent || "").replace(/ /g, " ").trim();
  }

  function handle(action, payload) {
    switch (action) {
      case "PING":
        return { ready: !!(window.CKEDITOR && window.CKEDITOR.instances) };

      case "GET_CKEDITOR_DATA": {
        const editor = findArticleEditor();
        if (!editor) {
          return { error: "CKEDITOR instance not found" };
        }
        const html = editor.getData();
        return {
          html,
          plainText: htmlToPlainText(html),
          editorName: editor.name || null
        };
      }

      case "SET_CKEDITOR_DATA": {
        const editor = findArticleEditor();
        if (!editor) {
          return { error: "CKEDITOR instance not found" };
        }
        const html = payload && typeof payload.html === "string" ? payload.html : "";
        try {
          editor.setData(html);
          if (typeof editor.updateElement === "function") editor.updateElement();
          try { editor.fire("change"); } catch (e) {}
        } catch (e) {
          return { error: String((e && e.message) || e) };
        }
        // Notify AngularJS (ng-model="article.content") via the backing textarea
        // so the CMS registers an unsaved change.
        const textarea = document.querySelector(CONTENT_TEXTAREA);
        if (textarea) {
          textarea.dispatchEvent(new Event("input", { bubbles: true }));
          textarea.dispatchEvent(new Event("change", { bubbles: true }));
        }
        return { ok: true };
      }

      default:
        return { error: "Unknown action: " + action };
    }
  }

  window.addEventListener("message", function (event) {
    // Only accept messages from this same window, addressed to us, as requests.
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.tag !== TAG || data.direction !== "request") return;

    let payload;
    try {
      payload = handle(data.action, data.payload);
    } catch (err) {
      payload = { error: String((err && err.message) || err) };
    }

    window.postMessage(
      { tag: TAG, direction: "response", id: data.id, payload },
      "*"
    );
  });

  // Announce readiness so the content script can stop polling early if it likes.
  window.postMessage({ tag: TAG, direction: "ready" }, "*");
})();
