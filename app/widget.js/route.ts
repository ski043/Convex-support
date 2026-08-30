const loaderSource = String.raw`(function () {
  "use strict";

  var MESSAGE_MARKER = "marshaldesk-widget-v1";
  var BOOTSTRAP_TYPE = "bootstrap";
  var CONTEXT_TYPE = "context";
  var READY_TYPE = "ready";
  var TOKEN_TYPE = "token";
  var FRAME_TYPE = "frame";
  var COOKIE_PREFIX = "marshaldesk_vid_";
  var COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
  var BOOT_FLAG = "__marshaldeskWidgetBooted";
  var HISTORY_FLAG = "__marshaldeskWidgetHistoryPatched";
  var capturedScript = document.currentScript;

  function loaderScript() {
    if (capturedScript && capturedScript.tagName === "SCRIPT") {
      try {
        var capturedUrl = new URL(capturedScript.src, document.baseURI);
        if (capturedUrl.pathname.slice(-10) === "/widget.js") {
          return capturedScript;
        }
      } catch (_) {}
    }

    var scripts = document.getElementsByTagName("script");
    for (var index = scripts.length - 1; index >= 0; index -= 1) {
      var script = scripts[index];
      if (!script || !script.src || !script.getAttribute("data-workspace")) {
        continue;
      }
      try {
        var url = new URL(script.src, document.baseURI);
        if (url.pathname.slice(-10) === "/widget.js") {
          return script;
        }
      } catch (_) {}
    }
    return null;
  }

  function cookieSuffix(value) {
    var hash = 2166136261;
    for (var index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function readCookie(name) {
    var cookies = document.cookie ? document.cookie.split("; ") : [];
    for (var index = 0; index < cookies.length; index += 1) {
      var separator = cookies[index].indexOf("=");
      if (separator < 0 || cookies[index].slice(0, separator) !== name) continue;
      try {
        return decodeURIComponent(cookies[index].slice(separator + 1));
      } catch (_) {
        return null;
      }
    }
    return null;
  }

  function writeCookie(name, value) {
    var secure = location.protocol === "https:" ? "; Secure" : "";
    document.cookie =
      name +
      "=" +
      encodeURIComponent(value) +
      "; Max-Age=" +
      COOKIE_MAX_AGE_SECONDS +
      "; Path=/; SameSite=Lax" +
      secure;
  }

  function pageContext() {
    var pageUrl = null;
    try {
      pageUrl = (location.origin + location.pathname).slice(0, 2048);
    } catch (_) {}

    var pageTitle = null;
    if (typeof document.title === "string") {
      var trimmedTitle = document.title.trim();
      pageTitle = trimmedTitle ? trimmedTitle.slice(0, 160) : null;
    }
    return { pageUrl: pageUrl, pageTitle: pageTitle };
  }

  var script = loaderScript();
  if (!script) return;

  var workspaceId = (script.getAttribute("data-workspace") || "").trim();
  if (!workspaceId || workspaceId === "YOUR_WORKSPACE_ID") return;

  var loaderUrl;
  try {
    loaderUrl = new URL(script.src, document.baseURI);
  } catch (_) {
    return;
  }
  if (loaderUrl.protocol !== "http:" && loaderUrl.protocol !== "https:") return;
  if (window[BOOT_FLAG]) return;
  window[BOOT_FLAG] = true;

  var widgetOrigin = loaderUrl.origin;
  var parentOrigin = location.origin;
  var cookieName = COOKIE_PREFIX + cookieSuffix(workspaceId);
  var token = readCookie(cookieName);
  var bootstrapToken = null;
  var iframe = document.createElement("iframe");
  var lastFrame = { position: "bottomRight", width: 88, height: 88 };
  var lastContext = "";
  var contextQueued = false;

  iframe.src =
    widgetOrigin +
    "/embed?workspaceId=" +
    encodeURIComponent(workspaceId) +
    "&parentOrigin=" +
    encodeURIComponent(parentOrigin);
  iframe.title = "Chat with support";
  iframe.setAttribute("allowtransparency", "true");
  iframe.setAttribute("scrolling", "no");
  iframe.setAttribute("referrerpolicy", "no-referrer");
  iframe.style.cssText = [
    "position:fixed",
    "bottom:0",
    "right:0",
    "width:88px",
    "height:88px",
    "max-width:100vw",
    "max-height:100dvh",
    "border:0",
    "margin:0",
    "padding:0",
    "z-index:2147483647",
    "opacity:0",
    "pointer-events:none",
    "background:transparent",
    "color-scheme:light",
    "transition:opacity 120ms ease-out"
  ].join(";");

  function frameWindow() {
    return iframe.contentWindow;
  }

  function post(message) {
    var target = frameWindow();
    if (target) target.postMessage(message, widgetOrigin);
  }

  function postBootstrap() {
    post({
      marker: MESSAGE_MARKER,
      type: BOOTSTRAP_TYPE,
      token: typeof token === "string" && token ? token : null,
      bootstrapToken: bootstrapToken,
      context: pageContext()
    });
  }

  function postContext() {
    contextQueued = false;
    var context = pageContext();
    var serialized = JSON.stringify(context);
    if (serialized === lastContext) return;
    lastContext = serialized;
    post({ marker: MESSAGE_MARKER, type: CONTEXT_TYPE, context: context });
  }

  function queueContext() {
    if (contextQueued) return;
    contextQueued = true;
    window.setTimeout(postContext, 0);
  }

  function applyFrame(position, requestedWidth, requestedHeight) {
    if (
      typeof requestedWidth !== "number" ||
      typeof requestedHeight !== "number" ||
      !Number.isFinite(requestedWidth) ||
      !Number.isFinite(requestedHeight) ||
      requestedWidth <= 0 ||
      requestedHeight <= 0
    ) {
      return;
    }

    lastFrame = {
      position: position === "bottomLeft" ? "bottomLeft" : "bottomRight",
      width: Math.ceil(requestedWidth),
      height: Math.ceil(requestedHeight)
    };

    var viewportWidth = Math.max(
      1,
      window.innerWidth || document.documentElement.clientWidth || lastFrame.width
    );
    var viewportHeight = Math.max(
      1,
      window.innerHeight || document.documentElement.clientHeight || lastFrame.height
    );
    iframe.style.width = Math.min(lastFrame.width, viewportWidth) + "px";
    iframe.style.height = Math.min(lastFrame.height, viewportHeight) + "px";
    iframe.style.bottom = "0";
    iframe.style.top = "auto";

    if (lastFrame.position === "bottomLeft") {
      iframe.style.left = "0";
      iframe.style.right = "auto";
    } else {
      iframe.style.right = "0";
      iframe.style.left = "auto";
    }

    iframe.style.opacity = "1";
    iframe.style.pointerEvents = "auto";
  }

  window.addEventListener("message", function (event) {
    if (event.origin !== widgetOrigin || event.source !== frameWindow()) return;
    var data = event.data;
    if (!data || data.marker !== MESSAGE_MARKER || typeof data.type !== "string") return;

    if (data.type === READY_TYPE) {
      postBootstrap();
      return;
    }

    if (data.type === TOKEN_TYPE) {
      if (typeof data.token !== "string" || !data.token) return;
      token = data.token;
      writeCookie(cookieName, token);
      return;
    }

    if (data.type !== FRAME_TYPE) return;
    if (data.position !== "bottomLeft" && data.position !== "bottomRight") return;
    applyFrame(data.position, data.width, data.height);
  });

  window.addEventListener("resize", function () {
    applyFrame(lastFrame.position, lastFrame.width, lastFrame.height);
  });
  window.addEventListener("pageshow", queueContext);
  window.addEventListener("popstate", queueContext);
  window.addEventListener("hashchange", queueContext);
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) queueContext();
  });

  if (!window[HISTORY_FLAG]) {
    window[HISTORY_FLAG] = true;
    ["pushState", "replaceState"].forEach(function (method) {
      var original = history[method];
      if (typeof original !== "function") return;
      history[method] = function () {
        var result = original.apply(this, arguments);
        queueContext();
        return result;
      };
    });
  }

  if (typeof MutationObserver === "function") {
    var titleObserver = new MutationObserver(queueContext);
    var titleNode = document.querySelector("title");
    if (titleNode) {
      titleObserver.observe(titleNode, { childList: true, subtree: true, characterData: true });
    } else if (document.head) {
      titleObserver.observe(document.head, { childList: true, subtree: true });
    }
  }

  iframe.addEventListener("load", function () {
    lastContext = "";
    postBootstrap();
  });

  function mount() {
    (document.body || document.documentElement).appendChild(iframe);
  }

  function mountWhenReady() {
    if (document.body) {
      mount();
    } else {
      document.addEventListener("DOMContentLoaded", mount, { once: true });
    }
  }

  function requestBootstrap(attempt) {
    fetch(widgetOrigin + "/api/widget-bootstrap", {
      method: "POST",
      mode: "cors",
      credentials: "omit",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId: workspaceId })
    })
      .then(function (response) {
        if (!response.ok) throw new Error("bootstrap rejected");
        return response.json();
      })
      .then(function (result) {
        if (
          !result ||
          typeof result.bootstrapToken !== "string" ||
          !result.bootstrapToken ||
          result.bootstrapToken.length > 4096
        ) {
          throw new Error("invalid bootstrap");
        }
        bootstrapToken = result.bootstrapToken;
        mountWhenReady();
      })
      .catch(function (error) {
        if (attempt < 3) {
          window.setTimeout(function () {
            requestBootstrap(attempt + 1);
          }, attempt * 300);
          return;
        }
        window[BOOT_FLAG] = false;
        if (window.console && typeof window.console.warn === "function") {
          window.console.warn("Support widget bootstrap failed after 3 attempts.", error);
        }
      });
  }

  requestBootstrap(1);
})();`;

export async function GET() {
  return new Response(loaderSource, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
      "Content-Type": "application/javascript; charset=utf-8",
      "Cross-Origin-Resource-Policy": "cross-origin",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
