/* Lotus Colour Automation 0.2.13 - native Home Assistant overlay (single-file runtime) */
(() => {
  "use strict";

  const VERSION = "0.2.13";
    const TRACE_REFRESH_MS = 2000;
  const REGISTRY_REFRESH_MS = 30000;
  const DECORATE_MS = 650;
  const TRACE_DETAIL_REFRESH_MS = 1200;
  const GROUP_UNDEFINED = "zzzzz_undefined";
  const ADDON_PANEL_PATH = "/local_lotus_automation_monitor";
  const NATIVE_AUTOMATION_PATH = "/config/automation/dashboard";

  // IMPORTANT: normal is the HA accent/enable colour, never the warning colour.
  // Orange is reserved strictly for an entity that is currently executing.
  const COLORS = {
    normal: "var(--primary-color, #03a9f4)",
    running: "var(--warning-color, #ff9800)",
    error: "var(--error-color, #db4437)",
    disabled: "var(--disabled-text-color, #9e9e9e)",
    done: "var(--success-color, #43a047)",
  };

  const state = {
    hass: null,
    traceByDomain: { automation: new Map(), script: new Map() },
    registry: new Map(),
    statusByEntity: new Map(),
    traceTimer: null,
    registryTimer: null,
    decorateTimer: null,
    lastTraceError: null,
    detailByRun: new Map(),
    detailPending: new Set(),
    mutationObserver: null,
    observedRoots: new WeakSet(),
    mutationReconcileTimer: null,
    navigationTimers: new Set(),
  };

  function log(...args) {
    console.debug(`[Lotus Colour Automation ${VERSION}]`, ...args);
  }

  function warn(...args) {
    console.warn(`[Lotus Colour Automation ${VERSION}]`, ...args);
  }

  function getHass() {
    return document.querySelector("home-assistant")?.hass || null;
  }

  async function callWS(message) {
    const hass = state.hass || getHass();
    if (!hass) throw new Error("Home Assistant indisponible");
    if (typeof hass.callWS === "function") return hass.callWS(message);
    if (hass.connection?.sendMessagePromise) {
      return hass.connection.sendMessagePromise(message);
    }
    throw new Error("API WebSocket Home Assistant indisponible");
  }

  function asDate(value) {
    if (!value) return 0;
    const n = Date.parse(value);
    return Number.isFinite(n) ? n : 0;
  }

  // Keep Home Assistant's microsecond ordering for very fast consecutive steps.
  // Date.parse() only keeps milliseconds, which can otherwise merge several trace events.
  function asTraceTime(value) {
    const ms = asDate(value);
    if (!ms) return 0;
    const match = String(value).match(/\.(\d+)(?:Z|[+-]\d{2}:?\d{2})$/);
    if (!match) return ms * 1000;
    const fraction = (match[1] + "000000").slice(0, 6);
    const extraMicros = Number(fraction.slice(3, 6)) || 0;
    return ms * 1000 + extraMicros;
  }

  function groupTraces(domain, traces) {
    const grouped = new Map();
    for (const trace of Array.isArray(traces) ? traces : []) {
      const itemId = String(trace?.item_id || "");
      if (!itemId) continue;
      if (!grouped.has(itemId)) grouped.set(itemId, []);
      grouped.get(itemId).push(trace);
    }
    for (const entries of grouped.values()) {
      entries.sort((a, b) => asDate(b?.timestamp?.start) - asDate(a?.timestamp?.start));
    }
    state.traceByDomain[domain] = grouped;
  }

  function candidateItemIds(entityId, stateObj) {
    const result = [];
    const attrId = stateObj?.attributes?.id;
    if (attrId !== undefined && attrId !== null && attrId !== "") result.push(String(attrId));
    if (entityId.includes(".")) result.push(entityId.split(".", 2)[1]);
    return [...new Set(result)];
  }

  function tracesForEntity(domain, entityId, stateObj) {
    const grouped = state.traceByDomain[domain] || new Map();
    for (const itemId of candidateItemIds(entityId, stateObj)) {
      const traces = grouped.get(itemId);
      if (traces?.length) return traces;
    }
    return [];
  }

  function errorText(error) {
    if (!error) return "";
    if (typeof error === "string") return error;
    if (typeof error === "object") {
      if (typeof error.message === "string") return error.message;
      if (typeof error.error === "string") return error.error;
      try { return JSON.stringify(error); } catch (_err) { return String(error); }
    }
    return String(error);
  }

  function isTraceError(trace) {
    return Boolean(trace && (trace.error || trace.script_execution === "error" || trace.state === "error"));
  }

  function computeEntityStatus(entityId) {
    const hass = state.hass;
    if (!hass || !entityId) return null;
    const domain = entityId.split(".", 1)[0];
    if (domain !== "automation" && domain !== "script") return null;

    const stateObj = hass.states?.[entityId];
    const registry = state.registry.get(entityId);
    const traces = tracesForEntity(domain, entityId, stateObj);
    const latest = traces[0] || null;
    const runningTrace = traces.find((trace) => trace?.state === "running") || null;
    const current = Number(stateObj?.attributes?.current || 0);

    // Disabled means explicitly disabled, not simply idle.
    const registryDisabled = Boolean(registry?.disabled_by);
    const automationDisabled = domain === "automation" && stateObj?.state === "off";
    const disabled = registryDisabled || automationDisabled;

    // Running is deliberately strict. Idle/ready entities must NEVER become orange.
    const running = !disabled && (
      current > 0 ||
      runningTrace !== null ||
      (domain === "script" && stateObj?.state === "on")
    );

    let status = "normal";
    let trace = latest;
    if (disabled) {
      status = "disabled";
    } else if (running) {
      status = "running";
      trace = runningTrace || latest;
    } else if (isTraceError(latest)) {
      status = "error";
    }

    return {
      entityId,
      domain,
      status,
      trace,
      latest,
      runningTrace,
      lastStep: trace?.last_step || null,
      error: status === "error" ? errorText(latest?.error) : "",
    };
  }

  function rebuildStatusMap() {
    const hass = state.hass;
    if (!hass?.states) return;
    const map = new Map();
    for (const entityId of Object.keys(hass.states)) {
      if (!entityId.startsWith("automation.") && !entityId.startsWith("script.")) continue;
      const status = computeEntityStatus(entityId);
      if (status) map.set(entityId, status);
    }
    for (const entityId of state.registry.keys()) {
      if (!entityId.startsWith("automation.") && !entityId.startsWith("script.")) continue;
      if (!map.has(entityId)) {
        const status = computeEntityStatus(entityId);
        if (status) map.set(entityId, status);
      }
    }
    state.statusByEntity = map;
  }

  async function refreshTraces() {
    state.hass = getHass();
    if (!state.hass) return;
    try {
      const [automation, script] = await Promise.all([
        callWS({ type: "trace/list", domain: "automation" }),
        callWS({ type: "trace/list", domain: "script" }),
      ]);
      groupTraces("automation", automation);
      groupTraces("script", script);
      state.lastTraceError = null;
      rebuildStatusMap();
    } catch (err) {
      const text = String(err?.message || err);
      if (state.lastTraceError !== text) {
        warn("Lecture des traces impossible :", text);
        state.lastTraceError = text;
      }
      rebuildStatusMap();
    }
  }

  async function refreshRegistry() {
    state.hass = getHass();
    if (!state.hass) return;
    try {
      const entries = await callWS({ type: "config/entity_registry/list" });
      state.registry = new Map((Array.isArray(entries) ? entries : []).map((entry) => [entry.entity_id, entry]));
      rebuildStatusMap();
    } catch (err) {
      warn("Registre d'entités indisponible :", err?.message || err);
    }
  }

  function allShadowRoots(root = document) {
    const roots = [];
    const visit = (node) => {
      roots.push(node);
      const elements = node.querySelectorAll ? node.querySelectorAll("*") : [];
      for (const el of elements) if (el.shadowRoot) visit(el.shadowRoot);
    };
    visit(root);
    return roots;
  }

  function deepQueryAll(selector, root = document) {
    const result = [];
    const seen = new Set();
    for (const scope of allShadowRoots(root)) {
      const matches = scope.querySelectorAll ? scope.querySelectorAll(selector) : [];
      for (const match of matches) {
        if (!seen.has(match)) {
          seen.add(match);
          result.push(match);
        }
      }
    }
    return result;
  }

  function isLegacyAddonUrl(value) {
    if (!value) return false;
    try {
      const url = new URL(value, window.location.origin);
      return url.origin === window.location.origin &&
        (url.pathname === ADDON_PANEL_PATH || url.pathname.startsWith(`${ADDON_PANEL_PATH}/`));
    } catch (_err) {
      return false;
    }
  }

  function diagnosticBypassRequested() {
    return new URLSearchParams(window.location.search).get("diagnostic") === "1";
  }

  function navigateToNativeAutomations({ replace = false } = {}) {
    if (window.location.pathname === NATIVE_AUTOMATION_PATH) return;
    const method = replace ? "replaceState" : "pushState";
    window.history[method](null, "", NATIVE_AUTOMATION_PATH);
    window.dispatchEvent(new CustomEvent("location-changed", { detail: { replace } }));
  }

  function redirectLegacyAddonRoute() {
    if (diagnosticBypassRequested()) return false;
    const path = window.location.pathname || "";
    if (path !== ADDON_PANEL_PATH && !path.startsWith(`${ADDON_PANEL_PATH}/`)) return false;
    navigateToNativeAutomations({ replace: true });
    return true;
  }

  function patchSidebarLinks() {
    for (const anchor of deepQueryAll("a[href]")) {
      const href = anchor.getAttribute("href") || "";
      if (!isLegacyAddonUrl(href)) continue;
      anchor.setAttribute("href", NATIVE_AUTOMATION_PATH);
      anchor.dataset.lamNativeAutomationTarget = "1";
      anchor.setAttribute("title", "Automatisations");
    }
  }

  function onGlobalNavigationClick(event) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const path = typeof event.composedPath === "function" ? event.composedPath() : [];
    const anchor = path.find((node) => node?.tagName === "A" && typeof node.getAttribute === "function");
    if (!anchor) return;
    const href = anchor.getAttribute("href") || "";
    if (!isLegacyAddonUrl(href) && anchor.dataset?.lamNativeAutomationTarget !== "1") return;
    event.preventDefault();
    event.stopImmediatePropagation();
    navigateToNativeAutomations();
  }

  function inferTableDomain(table) {
    const data = Array.isArray(table.data) ? table.data : [];
    for (const item of data) {
      const id = item?.entity_id;
      if (typeof id !== "string") continue;
      if (id.startsWith("automation.")) return "automation";
      if (id.startsWith("script.")) return "script";
    }
    return null;
  }

  function rowCells(row) {
    return Array.from(row?.querySelectorAll?.(":scope > .mdc-data-table__cell") || []);
  }

  function clearEntityRowDecoration(row) {
    row.classList?.remove("lam-row-running", "lam-row-error");
    row.removeAttribute?.("data-lam-status");
    for (const cell of rowCells(row)) {
      if (cell.dataset?.lamEntityCell === "1") {
        cell.style.removeProperty("background-color");
        cell.style.removeProperty("box-shadow");
        delete cell.dataset.lamEntityCell;
      }
    }
  }

  function decorateEntityRow(row, entityStatus) {
    clearEntityRowDecoration(row);
    if (!entityStatus || !["running", "error"].includes(entityStatus.status)) return;

    // Do not append DIVs to a <tr>: it is invalid table markup and can distort HA layout.
    const cells = rowCells(row);
    if (!cells.length) return;
    const color = COLORS[entityStatus.status];
    const wash = entityStatus.status === "running"
      ? "color-mix(in srgb, var(--warning-color, #ff9800) 7%, transparent)"
      : "color-mix(in srgb, var(--error-color, #db4437) 7%, transparent)";

    cells.forEach((cell, index) => {
      cell.dataset.lamEntityCell = "1";
      cell.style.backgroundColor = wash;
      if (index === 0) cell.style.boxShadow = `inset 5px 0 0 ${color}`;
    });
    row.dataset.lamStatus = entityStatus.status;
    row.classList.add(`lam-row-${entityStatus.status}`);
  }

  function categoryStatusSet(table, groupName) {
    const statuses = new Set();
    const groupColumn = table.groupColumn;
    const data = Array.isArray(table.data) ? table.data : [];
    if (!groupColumn) return statuses;

    for (const item of data) {
      const entityId = item?.entity_id;
      if (typeof entityId !== "string") continue;
      const itemGroup = item?.[groupColumn];
      const matches = groupName === GROUP_UNDEFINED
        ? itemGroup === undefined || itemGroup === null || itemGroup === ""
        : String(itemGroup ?? "") === String(groupName);
      if (!matches) continue;
      const itemStatus = state.statusByEntity.get(entityId) || computeEntityStatus(entityId);
      if (itemStatus) statuses.add(itemStatus.status);
    }
    return statuses;
  }

  function categoryOrder(statuses) {
    return ["normal", "running", "error", "disabled"].filter((s) => statuses.has(s));
  }

  function groupRowIsExpanded(row, domain) {
    // HA renders member rows immediately after an expanded group header.
    // Collapsed groups jump directly to the next group header.
    let next = row?.nextElementSibling || null;
    while (next) {
      if (next.classList?.contains("mdc-data-table__row")) {
        return typeof next.rowId === "string" && next.rowId.startsWith(`${domain}.`);
      }
      next = next.nextElementSibling;
    }
    return false;
  }

  function clearCategoryDecoration(row) {
    row?.removeAttribute?.("data-lam-category");
    for (const cell of rowCells(row)) {
      if (cell.dataset?.lamCategoryCell === "1") {
        cell.style.removeProperty("background-image");
        cell.style.removeProperty("background-size");
        cell.style.removeProperty("background-repeat");
        cell.style.removeProperty("background-position");
        delete cell.dataset.lamCategoryCell;
      }
    }
  }

  function categoryGradient(statuses) {
    if (!statuses.length) return "none";
    const n = statuses.length;
    const stops = [];
    statuses.forEach((statusName, index) => {
      const start = (index * 100) / n;
      const end = ((index + 1) * 100) / n;
      const color = COLORS[statusName];
      stops.push(`${color} ${start}%`, `${color} ${end}%`);
    });
    return `linear-gradient(to bottom, ${stops.join(", ")})`;
  }

  function decorateCategoryHeader(table, header, domain) {
    const row = header.closest?.(".mdc-data-table__row") || header.parentElement;
    if (!row) return;
    clearCategoryDecoration(row);

    // The category bar is a summary only when it hides its members.
    if (groupRowIsExpanded(row, domain)) return;

    const groupName = header.group;
    if (groupName === undefined || groupName === null) return;
    const statuses = categoryOrder(categoryStatusSet(table, groupName));
    if (!statuses.length) return;

    const cells = rowCells(row);
    if (!cells.length) return;
    const firstCell = cells[0];
    firstCell.dataset.lamCategoryCell = "1";
    firstCell.style.backgroundImage = categoryGradient(statuses);
    firstCell.style.backgroundSize = "6px 100%";
    firstCell.style.backgroundRepeat = "no-repeat";
    firstCell.style.backgroundPosition = "left top";
    row.dataset.lamCategory = statuses.join(",");

    const labels = { normal: "Actif au repos", running: "En cours", error: "Erreur", disabled: "Désactivé" };
    header.title = statuses.map((s) => labels[s]).join(" · ");
  }

  function decorateTables() {
    for (const table of deepQueryAll("ha-data-table")) {
      const domain = inferTableDomain(table);
      if (!domain || !table.shadowRoot) continue;
      const root = table.shadowRoot;

      for (const row of deepQueryAll(".mdc-data-table__row", root)) {
        if (typeof row.rowId === "string" && row.rowId.startsWith(`${domain}.`)) {
          const entityStatus = state.statusByEntity.get(row.rowId) || computeEntityStatus(row.rowId);
          decorateEntityRow(row, entityStatus);
        }
      }

      for (const header of deepQueryAll(".group-header", root)) {
        decorateCategoryHeader(table, header, domain);
      }
    }
  }

  const PATH_ALIASES = {
    action: ["action", "actions", "sequence"], actions: ["actions", "action", "sequence"],
    sequence: ["sequence", "actions", "action"], condition: ["condition", "conditions"],
    conditions: ["conditions", "condition"], trigger: ["trigger", "triggers"], triggers: ["triggers", "trigger"],
  };

  function resolveConfigNode(config, path) {
    let node = config;
    if (!path || typeof path !== "string") return null;
    for (const token of path.split("/")) {
      if (!token) continue;
      if (Array.isArray(node)) {
        const index = Number(token);
        if (!Number.isInteger(index) || index < 0 || index >= node.length) return null;
        node = node[index];
        continue;
      }
      if (node && typeof node === "object") {
        if (Object.prototype.hasOwnProperty.call(node, token)) { node = node[token]; continue; }
        const aliases = PATH_ALIASES[token] || [token];
        let found = false;
        for (const alias of aliases) {
          if (Object.prototype.hasOwnProperty.call(node, alias)) { node = node[alias]; found = true; break; }
        }
        if (found) continue;
      }
      return null;
    }
    return node;
  }

  function traceRunKey(entityStatus) {
    const trace = entityStatus?.trace || entityStatus?.latest;
    const runId = trace?.run_id;
    if (!entityStatus?.domain || !runId) return null;
    const stateObj = state.hass?.states?.[entityStatus.entityId];
    const itemId = trace?.item_id || candidateItemIds(entityStatus.entityId, stateObj)[0];
    if (!itemId) return null;
    return {
      key: `${entityStatus.domain}|${String(itemId)}|${String(runId)}`,
      domain: entityStatus.domain,
      itemId: String(itemId),
      runId: String(runId),
    };
  }

  function pruneTraceDetails() {
    if (state.detailByRun.size <= 30) return;
    const entries = [...state.detailByRun.entries()]
      .sort((a, b) => Number(a[1]?.fetchedAt || 0) - Number(b[1]?.fetchedAt || 0));
    for (const [key] of entries.slice(0, Math.max(0, entries.length - 20))) state.detailByRun.delete(key);
  }

  function ensureTraceDetail(entityStatus) {
    const info = traceRunKey(entityStatus);
    if (!info) return null;
    const cached = state.detailByRun.get(info.key) || null;
    const now = Date.now();
    const cachedRunning = cached?.data?.state === "running";
    if (cached && (!cachedRunning || now - cached.fetchedAt < TRACE_DETAIL_REFRESH_MS)) return cached.data;
    if (state.detailPending.has(info.key)) return cached?.data || null;

    state.detailPending.add(info.key);
    callWS({ type: "trace/get", domain: info.domain, item_id: info.itemId, run_id: info.runId })
      .then((data) => {
        if (data && typeof data === "object") {
          state.detailByRun.set(info.key, { data, fetchedAt: Date.now() });
          pruneTraceDetails();
        }
      })
      .catch((err) => warn(`Trace détaillée ${info.domain}.${info.itemId}/${info.runId} indisponible :`, err?.message || err))
      .finally(() => {
        state.detailPending.delete(info.key);
        window.setTimeout(decorate, 0);
      });
    return cached?.data || null;
  }

  function ensureEditorRowStyle(row) {
    const root = row.shadowRoot;
    if (!root || root.querySelector("style[data-lam-editor-style]")) return;
    const style = document.createElement("style");
    style.dataset.lamEditorStyle = "1";
    style.textContent = `
      :host(.lam-trace-running), :host(.lam-trace-error), :host(.lam-trace-done) { border-radius: var(--ha-border-radius-md, 10px); }
      :host(.lam-trace-running) ha-card { border-color: var(--warning-color, #ff9800) !important; box-shadow: inset 4px 0 0 var(--warning-color, #ff9800) !important; }
      :host(.lam-trace-error) ha-card { border-color: var(--error-color, #db4437) !important; box-shadow: inset 4px 0 0 var(--error-color, #db4437) !important; }
      :host(.lam-trace-done) ha-card { border-color: color-mix(in srgb, var(--success-color, #43a047) 55%, var(--divider-color, #e0e0e0)) !important; box-shadow: inset 4px 0 0 var(--success-color, #43a047) !important; }
      :host(.lam-trace-running) ha-expansion-panel, :host(.lam-trace-running) ha-automation-row { --primary-color: var(--warning-color, #ff9800); }
      :host(.lam-trace-error) ha-expansion-panel, :host(.lam-trace-error) ha-automation-row { --primary-color: var(--error-color, #db4437); }
      .lam-execution-banner {
        box-sizing: border-box;
        width: 100%;
        min-height: 23px;
        padding: 4px 9px;
        font-size: var(--ha-font-size-m, 14px);
        line-height: var(--ha-line-height-normal, 1.4);
        font-weight: 500;
        text-align: center;
        pointer-events: none;
        overflow-wrap: anywhere;
        border-radius: var(--ha-border-radius-md, 10px) var(--ha-border-radius-md, 10px) 0 0;
      }
      .lam-execution-banner.running { color: var(--warning-color,#ff9800); background: color-mix(in srgb,var(--warning-color,#ff9800) 14%,var(--card-background-color,#fff)); }
      .lam-execution-banner.done { color: var(--success-color,#43a047); background: color-mix(in srgb,var(--success-color,#43a047) 13%,var(--card-background-color,#fff)); }
      .lam-execution-banner.error { color: var(--error-color,#db4437); background: color-mix(in srgb,var(--error-color,#db4437) 13%,var(--card-background-color,#fff)); }
      .lam-execution-banner .lam-banner-error { display:block; margin-top:2px; font-weight:400; }
      ::slotted(.lam-execution-duration[slot="icons"]) {
        display: inline-flex;
        align-items: center;
        white-space: nowrap;
        margin-inline: 4px 2px;
        padding: 2px 7px;
        border-radius: 999px;
        font-size: var(--ha-font-size-m, 14px);
        line-height: var(--ha-line-height-normal, 1.4);
        font-weight: 600;
        color: var(--success-color, #43a047);
        background: color-mix(in srgb, var(--success-color, #43a047) 10%, transparent);
        pointer-events: none;
      }
    `;
    root.appendChild(style);
  }

  function allEditorRows(editor) {
    if (!editor?.shadowRoot) return [];
    return deepQueryAll("ha-automation-action-row, ha-automation-condition-row, ha-automation-trigger-row", editor.shadowRoot);
  }

  function clearEditorRows(editor, keepTarget = null, keepSignature = "") {
    for (const row of allEditorRows(editor)) {
      row.classList.remove("lam-trace-running", "lam-trace-error", "lam-trace-done");
      if (!row.shadowRoot) continue;
      // Remove the old 0.2.3 note format as well as stale execution banners.
      row.shadowRoot.querySelectorAll(".lam-trace-note[data-lam-note]").forEach((node) => node.remove());
      row.shadowRoot.querySelectorAll(".lam-execution-banner[data-lam-banner]").forEach((node) => {
        const keep = row === keepTarget && node.dataset.lamBanner === keepSignature;
        if (!keep) node.remove();
      });
      row.querySelectorAll(":scope > .lam-execution-duration[data-lam-duration]").forEach((node) => node.remove());
    }
  }

  function nodeForEditorRow(row) {
    if (row.action !== undefined) return row.action;
    if (row.condition !== undefined) return row.condition;
    if (row.trigger !== undefined) return row.trigger;
    return undefined;
  }

  function findBestTraceRow(editor, fullPath) {
    const rows = allEditorRows(editor);
    if (!rows.length || !editor.config || !fullPath) return null;
    const parts = String(fullPath).split("/").filter(Boolean);
    for (let end = parts.length; end >= 1; end -= 1) {
      const node = resolveConfigNode(editor.config, parts.slice(0, end).join("/"));
      if (node === null || node === undefined) continue;
      const row = rows.find((item) => nodeForEditorRow(item) === node);
      if (row) return row;
    }
    return null;
  }

  function formatClock(value) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    const locale = state.hass?.locale?.language || undefined;
    try {
      return new Intl.DateTimeFormat(locale, {
        hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
      }).format(date);
    } catch (_err) {
      return date.toLocaleTimeString();
    }
  }

  function traceEvents(detail) {
    const rows = [];
    const traceMap = detail?.trace;
    if (!traceMap || typeof traceMap !== "object") return rows;
    for (const [path, events] of Object.entries(traceMap)) {
      if (!Array.isArray(events)) continue;
      events.forEach((event, index) => {
        if (!event || typeof event !== "object" || !event.timestamp) return;
        rows.push({ path: String(path), event, index, time: asTraceTime(event.timestamp) });
      });
    }
    rows.sort((a, b) => a.time - b.time || a.path.localeCompare(b.path) || a.index - b.index);
    return rows;
  }

  function matchingTraceEvents(editor, row, events) {
    const node = nodeForEditorRow(row);
    if (node === undefined || !editor?.config) return [];
    return events.filter((item) => resolveConfigNode(editor.config, item.path) === node);
  }

  function inferOperationEnd(detail, events, path, startValue) {
    const start = asTraceTime(startValue);
    if (!start || !path) return null;
    const prefix = `${path}/`;
    for (const item of events) {
      if (item.time <= start) continue;
      if (item.path === path || item.path.startsWith(prefix)) continue;
      return item.event.timestamp || null;
    }
    const finish = detail?.timestamp?.finish;
    return asTraceTime(finish) > start ? finish : null;
  }

  function eventHasError(event) {
    return Boolean(event?.error || (Array.isArray(event?.template_errors) && event.template_errors.length));
  }

  function eventErrorText(event) {
    if (event?.error) return errorText(event.error);
    if (Array.isArray(event?.template_errors) && event.template_errors.length) return event.template_errors.join(" · ");
    return "";
  }

  function isSkippedOperation(row, event) {
    const node = nodeForEditorRow(row);
    if (node && typeof node === "object" && node.enabled === false) return true;
    return event?.result?.enabled === false;
  }

  function executionInfoForRow(editor, row, detail, events, activeRow) {
    const matches = matchingTraceEvents(editor, row, events);
    if (!matches.length) return null; // Not reached yet: keep native HA rendering.

    // Repeated operations can create multiple TraceElements for the same path.
    // The banner reports the most recent occurrence in the current/last run.
    const match = matches[matches.length - 1];
    const event = match.event;
    if (isSkippedOperation(row, event)) return null;

    const activePath = String(detail?.last_step || "");
    const isActiveRow = activeRow === row;
    const isActiveAncestor = !isActiveRow && activePath && activePath.startsWith(`${match.path}/`);

    const explicitError = eventHasError(event);
    const terminalError = Boolean(detail?.error || detail?.script_execution === "error");
    const errorHere = explicitError || (terminalError && isActiveRow);

    if (detail?.state === "running" && isActiveRow) {
      return {
        kind: "running",
        start: event.timestamp,
        end: null,
        error: "",
        path: match.path,
      };
    }

    if (errorHere) {
      return {
        kind: "error",
        start: event.timestamp,
        end: inferOperationEnd(detail, events, match.path, event.timestamp) || detail?.timestamp?.finish || null,
        error: eventErrorText(event) || errorText(detail?.error),
        path: match.path,
      };
    }

    // A container whose current/error child is still executing is not complete yet.
    if (isActiveAncestor && (detail?.state === "running" || terminalError)) return null;

    return {
      kind: "done",
      start: event.timestamp,
      end: inferOperationEnd(detail, events, match.path, event.timestamp) || detail?.timestamp?.finish || null,
      error: "",
      path: match.path,
    };
  }

  function bannerText(info) {
    const start = formatClock(info.start);
    if (info.kind === "running") return `Lotus · En cours · Début ${start}`;
    if (info.kind === "error") {
      const stop = formatClock(info.end);
      return `Lotus · Erreur · Début ${start} · Arrêt ${stop}`;
    }
    return `Lotus · Terminé · Début ${start} · Fin ${formatClock(info.end)}`;
  }

  function bannerSignature(info) {
    return [info.kind, info.path, info.start || "", info.end || "", info.error || ""].join("|");
  }

  function executionDurationMs(info) {
    if (!info?.start || !info?.end) return 0;
    const start = asTraceTime(info.start);
    const end = asTraceTime(info.end);
    return end > start ? (end - start) / 1000 : 0;
  }

  function formatExecutionDuration(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return "";
    if (ms < 1000) return `${Math.max(1, Math.round(ms))} ms`;
    const totalSeconds = ms / 1000;
    if (totalSeconds < 10) {
      const rounded = Math.round(totalSeconds * 10) / 10;
      return `${String(rounded).replace(".", ",")} s`;
    }
    const seconds = Math.round(totalSeconds);
    if (seconds < 60) return `${seconds} s`;
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    if (minutes < 60) return rest ? `${minutes} min ${rest} s` : `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const restMinutes = minutes % 60;
    return restMinutes ? `${hours} h ${restMinutes} min` : `${hours} h`;
  }

  function durationSignature(info) {
    return [info?.path || "", info?.start || "", info?.end || ""].join("|");
  }

  function applyExecutionDuration(row, info) {
    if (!row || row.tagName !== "HA-AUTOMATION-ACTION-ROW" || info?.kind !== "done") return;
    const duration = formatExecutionDuration(executionDurationMs(info));
    if (!duration) return;
    const signature = durationSignature(info);
    let chip = Array.from(row.querySelectorAll(":scope > .lam-execution-duration[data-lam-duration]"))
      .find((node) => node.dataset.lamDuration === signature) || null;
    if (chip) {
      if (chip.textContent !== duration) chip.textContent = duration;
      return;
    }
    row.querySelectorAll(":scope > .lam-execution-duration[data-lam-duration]").forEach((node) => node.remove());
    chip = document.createElement("span");
    chip.className = "lam-execution-duration";
    chip.slot = "icons";
    chip.dataset.lamDuration = signature;
    chip.textContent = duration;
    chip.setAttribute("aria-label", `Temps d’exécution : ${duration}`);
    chip.title = `Temps d’exécution : ${duration}`;
    const firstNativeIcon = Array.from(row.children).find((node) =>
      node !== chip && node.getAttribute?.("slot") === "icons" && !node.classList?.contains("lam-execution-duration")
    );
    row.insertBefore(chip, firstNativeIcon || null);
  }

  function bannerHost(row) {
    if (!row?.shadowRoot) return null;
    return row.shadowRoot.querySelector("ha-card")
      || row.shadowRoot.querySelector("ha-expansion-panel")
      || row.shadowRoot.querySelector("ha-automation-row")
      || null;
  }

  function applyExecutionBanner(row, info) {
    if (!row?.shadowRoot || !info) return;
    ensureEditorRowStyle(row);
    row.classList.add(`lam-trace-${info.kind}`);
    const signature = bannerSignature(info);

    let banner = Array.from(row.shadowRoot.querySelectorAll(".lam-execution-banner[data-lam-banner]"))
      .find((node) => node.dataset.lamBanner === signature) || null;
    if (banner) return;

    row.shadowRoot.querySelectorAll(".lam-execution-banner[data-lam-banner]").forEach((node) => node.remove());
    banner = document.createElement("div");
    banner.className = `lam-execution-banner ${info.kind}`;
    banner.dataset.lamBanner = signature;

    const main = document.createElement("span");
    main.textContent = bannerText(info);
    banner.appendChild(main);
    if (info.kind === "error" && info.error) {
      const detailLine = document.createElement("span");
      detailLine.className = "lam-banner-error";
      detailLine.textContent = info.error;
      banner.appendChild(detailLine);
    }

    const host = bannerHost(row);
    if (host) host.prepend(banner);
    else row.shadowRoot.appendChild(banner);
  }

  function decorateEditor(editor) {
    const entityId = editor.currentEntityId || editor.entityId;
    if (!entityId || typeof entityId !== "string") {
      clearEditorRows(editor);
      return;
    }

    const entityStatus = state.statusByEntity.get(entityId) || computeEntityStatus(entityId);
    if (!entityStatus || !entityStatus.trace) {
      clearEditorRows(editor);
      return;
    }

    const detail = ensureTraceDetail(entityStatus);
    if (!detail?.trace || !editor.config) {
      clearEditorRows(editor);
      return;
    }

    const events = traceEvents(detail);
    const activeRow = detail?.last_step ? findBestTraceRow(editor, detail.last_step) : null;
    const decorations = [];
    for (const row of allEditorRows(editor)) {
      const info = executionInfoForRow(editor, row, detail, events, activeRow);
      if (info) decorations.push({ row, info, signature: bannerSignature(info) });
    }

    const keep = new Map(decorations.map((item) => [item.row, item.signature]));
    for (const row of allEditorRows(editor)) {
      const signature = keep.get(row) || "";
      row.classList.remove("lam-trace-running", "lam-trace-error", "lam-trace-done");
      if (!row.shadowRoot) continue;
      row.shadowRoot.querySelectorAll(".lam-trace-note[data-lam-note]").forEach((node) => node.remove());
      row.shadowRoot.querySelectorAll(".lam-execution-banner[data-lam-banner]").forEach((node) => {
        if (!signature || node.dataset.lamBanner !== signature) node.remove();
      });
      const durationInfo = decorations.find((item) => item.row === row)?.info || null;
      const durationSig = durationInfo?.kind === "done" ? durationSignature(durationInfo) : "";
      row.querySelectorAll(":scope > .lam-execution-duration[data-lam-duration]").forEach((node) => {
        if (!durationSig || node.dataset.lamDuration !== durationSig) node.remove();
      });
    }

    for (const { row, info } of decorations) {
      applyExecutionBanner(row, info);
      applyExecutionDuration(row, info);
    }
  }

  function decorateEditors() {
    for (const editor of deepQueryAll("ha-automation-editor, ha-script-editor")) decorateEditor(editor);
  }

  function isRelevantPage() {
    const path = window.location.pathname || "";
    return path.startsWith("/config/automation") || path.startsWith("/config/script");
  }

  function decorate() {
    patchSidebarLinks();
    redirectLegacyAddonRoute();
    state.hass = getHass();
    if (!state.hass || !isRelevantPage()) return;
    decorateTables();
    decorateEditors();
  }

  function observeAvailableRoots() {
    const observer = state.mutationObserver;
    if (!observer) return;
    for (const root of allShadowRoots(document)) {
      if (state.observedRoots.has(root)) continue;
      try {
        observer.observe(root, { childList: true, subtree: true });
        state.observedRoots.add(root);
      } catch (_err) {}
    }
  }

  function scheduleMutationReconcile() {
    if (state.mutationReconcileTimer) return;
    state.mutationReconcileTimer = window.setTimeout(() => {
      state.mutationReconcileTimer = null;
      observeAvailableRoots();
      decorate();
    }, 80);
  }

  function setupDomObserver() {
    if (state.mutationObserver || typeof MutationObserver !== "function") return;
    state.mutationObserver = new MutationObserver(() => scheduleMutationReconcile());
    observeAvailableRoots();
  }

  function clearNavigationTimers() {
    for (const timer of state.navigationTimers) window.clearTimeout(timer);
    state.navigationTimers.clear();
  }

  function scheduleNavigationReconcile({ refresh = false } = {}) {
    clearNavigationTimers();
    const delays = [0, 75, 250, 500, 1000, 2000];
    delays.forEach((delay, index) => {
      const timer = window.setTimeout(() => {
        state.navigationTimers.delete(timer);
        if (redirectLegacyAddonRoute()) return;
        state.hass = getHass();
        observeAvailableRoots();
        if (refresh && index === 0) refreshTraces();
        decorate();
      }, delay);
      state.navigationTimers.add(timer);
    });
  }

  function teardownPreviousRuntime() {
    const previous = window.__LOTUS_AUTOMATION_MONITOR_RUNTIME__;
    if (!previous || previous.version === VERSION || typeof previous.teardown !== "function") return;
    try { previous.teardown(); } catch (_err) {}
  }

  function start() {
    if (window.__LOTUS_AUTOMATION_MONITOR_OVERLAY__ === VERSION) return;
    teardownPreviousRuntime();
    window.__LOTUS_AUTOMATION_MONITOR_OVERLAY__ = VERSION;
    log("Surcouche native chargée");

    const onLocationChanged = () => scheduleNavigationReconcile({ refresh: true });
    const onPopState = () => scheduleNavigationReconcile({ refresh: true });
    const onPageShow = () => scheduleNavigationReconcile({ refresh: true });

    // Install lifecycle hooks before redirecting the historical Ingress route.
    // In 0.2.10, returning immediately after that redirect prevented every timer
    // and listener below from being installed until the browser was refreshed.
    window.addEventListener("click", onGlobalNavigationClick, true);
    window.addEventListener("location-changed", onLocationChanged);
    window.addEventListener("popstate", onPopState);
    window.addEventListener("pageshow", onPageShow);

    setupDomObserver();
    patchSidebarLinks();
    redirectLegacyAddonRoute();

    state.hass = getHass();
    refreshRegistry();
    refreshTraces();
    decorate();
    scheduleNavigationReconcile({ refresh: true });

    state.registryTimer = window.setInterval(refreshRegistry, REGISTRY_REFRESH_MS);
    state.traceTimer = window.setInterval(refreshTraces, TRACE_REFRESH_MS);
    state.decorateTimer = window.setInterval(() => {
      observeAvailableRoots();
      decorate();
    }, DECORATE_MS);

    window.__LOTUS_AUTOMATION_MONITOR_RUNTIME__ = {
      version: VERSION,
      teardown() {
        if (state.registryTimer) window.clearInterval(state.registryTimer);
        if (state.traceTimer) window.clearInterval(state.traceTimer);
        if (state.decorateTimer) window.clearInterval(state.decorateTimer);
        if (state.mutationReconcileTimer) window.clearTimeout(state.mutationReconcileTimer);
        clearNavigationTimers();
        state.mutationObserver?.disconnect();
        state.mutationObserver = null;
        state.observedRoots = new WeakSet();
        window.removeEventListener("click", onGlobalNavigationClick, true);
        window.removeEventListener("location-changed", onLocationChanged);
        window.removeEventListener("popstate", onPopState);
        window.removeEventListener("pageshow", onPageShow);
        window.__LOTUS_AUTOMATION_MONITOR_OVERLAY__ = undefined;
      },
    };
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
