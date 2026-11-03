/* Share actions: copy page URL and page Markdown to clipboard.
   Vanilla JS, no dependencies. Works on full page loads and across
   StupidGreen SPA navigation via UI.onReload. */
(function () {
  "use strict";

  function copyText(text, btn) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        flashCopied(btn);
      }).catch(function () {
        fallbackCopy(text, btn);
      });
    } else {
      fallbackCopy(text, btn);
    }
  }

  function fallbackCopy(text, btn) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
    } catch (e) {
      /* clipboard unavailable */
    }
    document.body.removeChild(ta);
    flashCopied(btn);
  }

  function flashCopied(btn) {
    var label = btn.querySelector(".share-label");
    if (!label) return;
    if (!label.dataset.original) {
      label.dataset.original = label.textContent;
    }
    label.textContent = "Copied!";
    btn.classList.add("is-copied");
    setTimeout(function () {
      label.textContent = label.dataset.original;
      btn.classList.remove("is-copied");
    }, 1500);
  }

  function initShareButtons() {
    document.querySelectorAll("[data-share-url]").forEach(function (btn) {
      if (btn.dataset.shareBound) return;
      btn.dataset.shareBound = "1";
      btn.addEventListener("click", function () {
        copyText(window.location.href, btn);
      });
    });
    document.querySelectorAll("[data-share-md]").forEach(function (btn) {
      if (btn.dataset.shareBound) return;
      btn.dataset.shareBound = "1";
      btn.addEventListener("click", function () {
        var el = document.querySelector("#share-markdown-content");
        if (!el) return;
        try {
          copyText(JSON.parse(el.textContent).markdown, btn);
        } catch (e) {
          /* invalid markdown payload */
        }
      });
    });
  }

  if (window.UI && typeof window.UI.onReload === "function") {
    window.UI.onReload(initShareButtons);
  }
  document.addEventListener("DOMContentLoaded", initShareButtons);
})();
