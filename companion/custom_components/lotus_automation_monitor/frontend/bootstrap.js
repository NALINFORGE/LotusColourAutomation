/* Lotus Colour Automation compatibility bootstrap v2.
 * Current Home Assistant sessions should load overlay.js?v=<version> directly.
 * This file exists only for a pre-0.2.10 Core session that still references it.
 */
(() => {
  "use strict";
  window.__LOTUS_AUTOMATION_MONITOR_BOOTSTRAP__ = "2";
  const script = document.createElement("script");
  script.type = "text/javascript";
  script.async = false;
  script.src = `/lotus_automation_monitor/overlay.js?compat=${Date.now()}`;
  script.addEventListener("error", () => {
    console.error("[Lotus Colour Automation] Bootstrap de compatibilité: chargement impossible", script.src);
  }, { once: true });
  document.head.appendChild(script);
})();
