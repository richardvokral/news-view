// Runs in the PAGE's JS world (injected via <script src> by content.js), so it
// can see window.CKEDITOR, which the isolated content script cannot reach.
// Communicates with the content script purely through window.postMessage.
//
// Stage 0 implements read-only actions (PING, GET_CKEDITOR_DATA). Write-back
// (SET_CKEDITOR_DATA) is intentionally left for a later stage.
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

  function handle(action) {
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
      payload = handle(data.action);
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
