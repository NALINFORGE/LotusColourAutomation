(() => {
  const state = {
    overview: null,
    filter: "all",
    search: "",
    selected: null,
    timer: null,
    loadingTrace: false,
  };

  const el = (id) => document.getElementById(id);
  const listEl = el("list");
  const drawer = el("drawer");
  const scrim = el("scrim");

  const statusLabels = {
    idle: "Au repos",
    running: "En cours",
    long_running: "Exécution longue",
    error: "Erreur",
    disabled: "Désactivé",
    unavailable: "Indisponible",
  };

  const domainLabels = {
    automation: "Automatisation",
    script: "Script",
  };

  function apiUrl(path) {
    const raw = window.location.href.split(/[?#]/)[0];
    const base = raw.endsWith("/") ? raw : `${raw}/`;
    return new URL(path, base).toString();
  }

  function formatDate(value) {
    if (!value) return "Jamais";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(date);
  }

  function formatDuration(seconds) {
    if (seconds === null || seconds === undefined) return "—";
    const n = Math.max(0, Number(seconds) || 0);
    if (n < 60) return `${n} s`;
    const minutes = Math.floor(n / 60);
    const secs = n % 60;
    if (minutes < 60) return `${minutes} min ${secs.toString().padStart(2, "0")} s`;
    const hours = Math.floor(minutes / 60);
    return `${hours} h ${(minutes % 60).toString().padStart(2, "0")} min`;
  }

  function makeText(tag, text, className = "") {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.textContent = text ?? "";
    return node;
  }

  function matchesFilter(item) {
    const f = state.filter;
    if (f === "automation" || f === "script") return item.domain === f;
    if (f === "running") return item.status === "running" || item.status === "long_running";
    if (f === "error") return item.status === "error";
    return true;
  }

  function matchesSearch(item) {
    if (!state.search) return true;
    const haystack = `${item.name} ${item.entity_id}`.toLocaleLowerCase("fr");
    return haystack.includes(state.search);
  }

  function setFilter(filter) {
    state.filter = filter;
    document.querySelectorAll(".filter").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.filter === filter);
    });
    renderList();
  }

  function renderMetrics() {
    const c = state.overview?.counts || {};
    el("countTotal").textContent = c.total ?? "–";
    el("countRunning").textContent = c.running ?? "–";
    el("countErrors").textContent = c.errors ?? "–";
    el("countAutomations").textContent = c.automations ?? "–";
    el("countScripts").textContent = c.scripts ?? "–";
  }

  function renderWarnings() {
    const warnings = state.overview?.warnings || [];
    const box = el("warningBox");
    if (!warnings.length) {
      box.classList.add("hidden");
      box.textContent = "";
      return;
    }
    box.textContent = warnings.join(" • ");
    box.classList.remove("hidden");
  }

  function renderList() {
    if (!state.overview) return;
    const items = state.overview.items.filter((item) => matchesFilter(item) && matchesSearch(item));
    listEl.replaceChildren();

    for (const item of items) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = `item ${item.status}`;
      row.dataset.entityId = item.entity_id;
      row.addEventListener("click", () => openItem(item));

      const bar = document.createElement("span");
      bar.className = "status-bar";
      row.appendChild(bar);

      const name = document.createElement("div");
      name.className = "item-name";
      name.appendChild(makeText("strong", item.name));
      name.appendChild(makeText("span", item.entity_id, "entity-id"));
      row.appendChild(name);

      const actionCell = document.createElement("div");
      actionCell.className = "item-cell";
      actionCell.appendChild(makeText("span", "Étape"));
      actionCell.appendChild(makeText("b", item.last_step || "—"));
      row.appendChild(actionCell);

      const timeCell = document.createElement("div");
      timeCell.className = "item-cell";
      timeCell.appendChild(makeText("span", item.status === "running" || item.status === "long_running" ? "Durée" : "Dernier lancement"));
      timeCell.appendChild(makeText("b", item.status === "running" || item.status === "long_running" ? formatDuration(item.duration_seconds) : formatDate(item.last_triggered)));
      row.appendChild(timeCell);

      const badge = makeText("span", statusLabels[item.status] || item.status, `badge ${item.status}`);
      row.appendChild(badge);
      listEl.appendChild(row);
    }

    el("emptyState").classList.toggle("hidden", items.length > 0);
  }

  function renderSummary(item) {
    const root = el("currentSummary");
    root.replaceChildren();
    const cells = [
      ["État", statusLabels[item.status] || item.status],
      ["Exécutions actives", String(item.current ?? 0)],
      ["Mode", item.mode || "—"],
      ["Étape actuelle / dernière", item.last_step || "—"],
      ["Durée active", formatDuration(item.duration_seconds)],
      ["Dernier lancement", formatDate(item.last_triggered)],
    ];
    for (const [label, value] of cells) {
      const cell = document.createElement("div");
      cell.className = "summary-cell";
      cell.appendChild(makeText("span", label));
      cell.appendChild(makeText("strong", value));
      root.appendChild(cell);
    }
  }

  function renderHistory(item) {
    const history = el("runHistory");
    history.replaceChildren();
    const traces = item.traces || [];
    el("traceCount").textContent = `${traces.length} trace${traces.length > 1 ? "s" : ""}`;

    for (const trace of traces) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "run-button";
      if (trace.error) button.classList.add("error");
      if (state.selected?.runId === trace.run_id) button.classList.add("active");
      button.appendChild(makeText("span", formatDate(trace.start), "run-date"));
      let runState = trace.state === "running" ? "En cours" : trace.error ? "Erreur" : "Terminée";
      if (trace.not_triggered) runState = "Non déclenchée";
      button.appendChild(makeText("span", `${runState}${trace.last_step ? ` • ${trace.last_step}` : ""}`, "run-state"));
      button.addEventListener("click", () => {
        state.selected.runId = trace.run_id;
        renderHistory(item);
        loadTrace(item.domain, item.item_id, trace.run_id);
      });
      history.appendChild(button);
    }
  }

  function renderTracePayload(payload) {
    const trace = payload?.trace || {};
    const steps = payload?.steps || [];
    el("traceState").textContent = trace.state === "running" ? "En cours" : trace.state === "stopped" ? "Terminée" : (trace.state || "");

    const traceError = el("traceError");
    if (trace.error) {
      traceError.textContent = trace.error;
      traceError.classList.remove("hidden");
    } else {
      traceError.textContent = "";
      traceError.classList.add("hidden");
    }

    const root = el("steps");
    root.replaceChildren();
    el("noTrace").classList.toggle("hidden", steps.length > 0);

    for (const step of steps) {
      const row = document.createElement("div");
      row.className = `step ${step.status}`;
      const dot = document.createElement("span");
      dot.className = "step-dot";
      row.appendChild(dot);

      const body = document.createElement("div");
      const title = document.createElement("div");
      title.className = "step-title";
      title.appendChild(makeText("span", step.label || step.path));
      title.appendChild(makeText("span", formatDate(step.timestamp), "muted"));
      body.appendChild(title);
      body.appendChild(makeText("div", step.path, "step-path"));

      const errors = [];
      if (step.error) errors.push(step.error);
      if (Array.isArray(step.template_errors)) errors.push(...step.template_errors);
      if (errors.length) body.appendChild(makeText("div", errors.join(" • "), "step-error-text"));

      row.appendChild(body);
      root.appendChild(row);
    }
  }

  async function loadTrace(domain, itemId, runId) {
    if (!runId || state.loadingTrace) return;
    state.loadingTrace = true;
    try {
      const response = await fetch(apiUrl(`api/trace/${encodeURIComponent(domain)}/${encodeURIComponent(itemId)}/${encodeURIComponent(runId)}`), { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      if (state.selected && state.selected.runId === runId) renderTracePayload(payload);
    } catch (error) {
      if (state.selected && state.selected.runId === runId) {
        el("traceError").textContent = `Lecture de la trace impossible : ${error.message}`;
        el("traceError").classList.remove("hidden");
        el("steps").replaceChildren();
        el("noTrace").classList.remove("hidden");
      }
    } finally {
      state.loadingTrace = false;
    }
  }

  function openItem(item) {
    const defaultRun = item.active_run_id || item.traces?.[0]?.run_id || null;
    state.selected = {
      entityId: item.entity_id,
      domain: item.domain,
      itemId: item.item_id,
      runId: defaultRun,
    };

    el("detailDomain").textContent = domainLabels[item.domain] || item.domain;
    el("detailTitle").textContent = item.name;
    el("detailEntity").textContent = item.entity_id;
    renderSummary(item);
    renderHistory(item);
    el("steps").replaceChildren();
    el("traceError").classList.add("hidden");
    el("noTrace").classList.toggle("hidden", Boolean(defaultRun));

    drawer.classList.add("open");
    drawer.setAttribute("aria-hidden", "false");
    scrim.classList.remove("hidden");

    if (defaultRun) loadTrace(item.domain, item.item_id, defaultRun);
  }

  function closeDrawer() {
    drawer.classList.remove("open");
    drawer.setAttribute("aria-hidden", "true");
    scrim.classList.add("hidden");
    state.selected = null;
  }

  function syncOpenItem() {
    if (!state.selected || !state.overview) return;
    const item = state.overview.items.find((x) => x.entity_id === state.selected.entityId);
    if (!item) return;

    renderSummary(item);
    const runningNow = item.status === "running" || item.status === "long_running";
    if (runningNow && item.active_run_id && state.selected.runId !== item.active_run_id) {
      state.selected.runId = item.active_run_id;
    }
    renderHistory(item);
    if (state.selected.runId) loadTrace(item.domain, item.item_id, state.selected.runId);
  }

  function setConnection(mode, text) {
    const c = el("connection");
    c.classList.remove("ok", "error");
    if (mode) c.classList.add(mode);
    el("connectionText").textContent = text;
  }

  async function refreshCompanionStatus() {
    const box = el("nativeOverlayStatus");
    if (!box) return;
    try {
      const response = await fetch(apiUrl("api/companion"), { cache: "no-store" });
      const payload = await response.json();
      box.classList.remove("hidden", "ok", "warn", "error");
      if (payload.loaded) {
        box.classList.add("ok");
        box.textContent = "Surcouche native v0.2 chargée : les listes et éditeurs Home Assistant peuvent être colorés en temps réel.";
      } else if (payload.restart_required) {
        box.classList.add("warn");
        box.textContent = "Surcouche native installée. Redémarrez Home Assistant une fois pour la charger dans l’interface native.";
      } else if (payload.error || payload.status_error) {
        box.classList.add("error");
        box.textContent = `Compagnon frontend non installé : ${payload.error || payload.status_error}`;
      } else {
        box.classList.add("warn");
        box.textContent = "Surcouche native non chargée. Vérifiez les journaux de l’application et la configuration du compagnon frontend.";
      }
    } catch (error) {
      box.classList.remove("hidden", "ok", "warn");
      box.classList.add("error");
      box.textContent = `État de la surcouche indisponible : ${error.message}`;
    }
  }

  async function refresh() {
    try {
      const response = await fetch(apiUrl("api/overview"), { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      state.overview = payload;
      renderMetrics();
      renderWarnings();
      renderList();
      syncOpenItem();
      setConnection("ok", `Connecté • v${payload.version}`);

      const seconds = Math.max(1, Number(payload.refresh_interval) || 2);
      clearTimeout(state.timer);
      state.timer = setTimeout(refresh, seconds * 1000);
    } catch (error) {
      setConnection("error", `Erreur : ${error.message}`);
      clearTimeout(state.timer);
      state.timer = setTimeout(refresh, 4000);
    }
  }

  document.querySelectorAll(".filter").forEach((btn) => btn.addEventListener("click", () => setFilter(btn.dataset.filter)));
  document.querySelectorAll(".metric").forEach((btn) => btn.addEventListener("click", () => setFilter(btn.dataset.filter)));
  el("search").addEventListener("input", (event) => {
    state.search = event.target.value.trim().toLocaleLowerCase("fr");
    renderList();
  });
  el("closeDrawer").addEventListener("click", closeDrawer);
  scrim.addEventListener("click", closeDrawer);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeDrawer();
  });

  refreshCompanionStatus();
  refresh();
})();
