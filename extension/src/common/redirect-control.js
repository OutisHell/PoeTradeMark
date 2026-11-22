(() => {
  let control;
  PTB.createRedirectControl = function (compact, redirectIcon) {
    if (control) return control;
    const el = (tag, cls) => {
      const node = document.createElement(tag);
      if (cls) node.className = cls;
      return node;
    };
    control = el("div", "ptb-redirect-control");
    const trigger = el("button", "ptb-sb-extlink ptb-redirect-trigger");
    const panel = el("div", "ptb-redirect-panel");
    const heading = el("h2", "ptb-pref-heading");
    const siteRow = el("label"), siteLabel = el("span"), select = el("select");
    const switchRow = el("label"), switchLabel = el("span"), toggle = el("input");
    function selectRow(name) {
      const row = el("div", "ptb-pref-row"), label = el("label"), select = el("select");
      select.id = "ptb-pref-" + name;
      label.htmlFor = select.id;
      row.append(label, select);
      return { row, label, select };
    }
    const gameField = selectRow("game"), leagueField = selectRow("league"), statusField = selectRow("status");
    const refresh = el("button", "ptb-league-refresh");
    refresh.type = "button";
    refresh.textContent = "↻";
    leagueField.row.insertBefore(refresh, leagueField.select);
    const snapshot = el("button", "ptb-snapshot");
    snapshot.type = "button";
    for (const [id, name] of [["poe1", "PoE 1"], ["poe2", "PoE 2"]]) gameField.select.add(new Option(name, id));
    const error = el("span", "ptb-redirect-error");
    toggle.type = "checkbox";
    toggle.setAttribute("role", "switch");
    error.setAttribute("role", "status");
    select.add(new Option("—", ""));
    for (const [code, [, name]] of Object.entries(PTB.tradeRegion.regions)) select.add(new Option(name, code));
    siteRow.append(siteLabel, select);
    switchRow.append(switchLabel, toggle);
    panel.append(heading, siteRow, gameField.row, leagueField.row, statusField.row, switchRow, snapshot, error);
    control.append(panel);
    let state = null, saving = false, revision = 0;
    let game = "poe1", pageGame = null, contextReady = false, catalog = null, catalogVersion = 0;
    const t = (key) => PTB.i18n.t(key);
    async function currentUrl() {
      if (compact) return location.href;
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      return tab?.url || "";
    }
    function renderProfile() {
      const profile = state?.profiles?.[game] || {};
      gameField.label.textContent = t("profileGame");
      gameField.row.hidden = Boolean(pageGame);
      gameField.select.value = game;
      leagueField.label.textContent = t("profileLeague") + " · PoE " + game.at(-1);
      refresh.title = t("refreshLeagues");
      refresh.setAttribute("aria-label", refresh.title);
      statusField.label.textContent = t("profileStatus");
      snapshot.textContent = t("profileSnapshot");
      snapshot.title = t("profileSnapshotHint");
      snapshot.hidden = !pageGame;
      snapshot.disabled = gameField.select.disabled = leagueField.select.disabled = statusField.select.disabled = !contextReady || !state || saving;
      if (saving) return;
      const entries = catalog?.leagues || [];
      const display = (l) => PTB.i18n.getLang() === "ko" ? l.text || l.id : l.id;
      const latest = entries.find((l) => l.id === catalog.latest);
      const options = [new Option("—", ""), new Option(t("profileLatest") + (latest ? " · " + display(latest) : ""), "@latest")];
      options.push(...entries.map((l) => new Option(display(l), l.id)));
      if (profile.league && !options.some((o) => o.value === profile.league)) options.push(new Option(profile.league, profile.league));
      leagueField.select.replaceChildren(...options);
      leagueField.select.value = profile.league || "";
      statusField.select.replaceChildren(new Option("—", ""),
        ...PTB.tradeRegion.statuses.map((id) => new Option(t("tradeStatus_" + id), id)));
      statusField.select.value = profile.status || "";
    }
    async function loadCatalog(force = false) {
      const version = ++catalogVersion;
      refresh.disabled = true;
      error.textContent = "";
      try {
        const response = await chrome.runtime.sendMessage({ cmd: "ptb-trade-leagues", game, force });
        if (version !== catalogVersion) return;
        if (!response?.value) throw Error("League catalog unavailable");
        catalog = response.value;
        renderProfile();
      } catch {
        if (version === catalogVersion) error.textContent = t("profileCatalogError");
      } finally {
        if (version === catalogVersion) refresh.disabled = false;
      }
    }
    refresh.addEventListener("click", () => loadCatalog(true));
    async function openProfile() {
      const href = await currentUrl();
      pageGame = PTB.tradeRegion.tradeUrl(href, "en") ? PTB.gameFromUrl(href) : null;
      contextReady = true;
      if (pageGame && pageGame !== game) { game = pageGame; catalog = null; }
      renderProfile();
      await loadCatalog();
    }
    gameField.select.addEventListener("change", () => {
      game = gameField.select.value;
      catalog = null;
      renderProfile();
      loadCatalog().catch(console.error);
    });
    function render() {
      renderProfile();
      heading.textContent = t("preferenceHeading");
      siteLabel.textContent = t("tradeSite");
      switchLabel.textContent = t("redirectTradeLinks");
      switchRow.title = t("redirectHint");
      select.disabled = toggle.disabled = !state || saving;
      if (state && !saving) {
        select.value = state.configured ? state.code : "";
        toggle.checked = state.enabled;
      }
      if (compact) {
        trigger.replaceChildren(state?.code ? state.code.toUpperCase() : redirectIcon);
        trigger.dataset.enabled = String(Boolean(state?.enabled));
        const label = state ? [heading.textContent, state.code.toUpperCase(),
          t(state.enabled ? "redirectEnabled" : "redirectDisabled")].filter(Boolean).join(" · ") : heading.textContent;
        trigger.title = label + "\n" + switchRow.title;
        trigger.setAttribute("aria-label", label);
      }
    }
    async function request(patch, capture = false) {
      const before = revision;
      if (patch || capture) saving = true;
      error.textContent = "";
      render();
      try {
        const msg = capture ? { cmd: "ptb-save-trade-snapshot", href: await currentUrl() } : { cmd: "ptb-redirect-settings", patch };
        const response = await chrome.runtime.sendMessage(msg);
        const settings = capture ? response?.value : response?.settings;
        if (!settings) throw Error(response?.error || "Redirect settings unavailable");
        if (revision === before) state = settings;
        if (capture) error.textContent = t("profileSaved");
      } catch (cause) {
        console.error(cause);
        error.textContent = t(capture ? "profileSnapshotHint" : "redirectError");
      } finally {
        if (patch || capture) saving = false;
        render();
      }
    }
    select.addEventListener("change", () => request({ code: select.value }));
    toggle.addEventListener("change", () => request({ enabled: toggle.checked }));
    leagueField.select.addEventListener("change", () => request({ profile: { game, league: leagueField.select.value } }));
    statusField.select.addEventListener("change", () => request({ profile: { game, status: statusField.select.value } }));
    snapshot.addEventListener("click", () => request(null, true));
    if (compact) {
      trigger.type = "button";
      trigger.setAttribute("aria-expanded", "false");
      panel.id = "ptb-redirect-settings";
      panel.setAttribute("popover", "auto");
      trigger.popoverTargetElement = panel;
      trigger.setAttribute("aria-controls", panel.id);
      function positionPanel() {
        const anchor = trigger.getBoundingClientRect();
        const width = document.documentElement.clientWidth, height = document.documentElement.clientHeight;
        const panelWidth = Math.min(304, width - 8);
        const below = height - anchor.bottom - 8, above = anchor.top - 8;
        const up = above > below;
        panel.style.width = panelWidth + "px";
        panel.style.maxHeight = Math.max(0, up ? above : below) + "px";
        panel.style.left = Math.max(4, Math.min(anchor.right - panelWidth, width - panelWidth - 4)) + "px";
        panel.style.top = up ? "auto" : anchor.bottom + 4 + "px";
        panel.style.bottom = up ? height - anchor.top + 4 + "px" : "auto";
      }
      panel.addEventListener("beforetoggle", (event) => {
        if (event.newState === "open") positionPanel();
      });
      panel.addEventListener("toggle", () => {
        const open = panel.matches(":popover-open");
        trigger.setAttribute("aria-expanded", String(open));
        if (open) {
          window.addEventListener("resize", positionPanel);
          openProfile().catch(console.error);
          select.focus();
          if (!state) request();
        } else {
          window.removeEventListener("resize", positionPanel);
        }
      });
      control.prepend(trigger);
    } else {
      openProfile().catch(console.error);
    }
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !changes.ptbRedirectSettings) return;
      revision++;
      const saved = changes.ptbRedirectSettings.newValue;
      state = saved && { ...saved, configured: true };
      if (state) render();
      else request();
    });
    PTB.i18n.onChange(render);
    request();
    return control;
  };
})();
