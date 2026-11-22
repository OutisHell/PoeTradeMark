// Each popup or sidebar owns its selection. Storage refreshes can rebuild the rows.
const bookmarkSelections = new WeakMap();

PTB.bookmarkBatch = function (list, game, view, refresh, toggle) {
  const scope = game + ":" + view.collectionId;
  let state = bookmarkSelections.get(list);
  if (state?.scope !== scope) {
    state = { scope, editing: false, ids: new Set() };
    bookmarkSelections.set(list, state);
  }
  const available = new Set(view.bookmarks.map(mark => mark.id));
  for (const id of state.ids) if (!available.has(id)) state.ids.delete(id);
  const t = key => PTB.i18n.t(key);
  const toolbar = document.createElement("div");
  toolbar.className = "ptb-batch-toolbar";
  function button(label) {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "ptb-bm-button";
    el.textContent = label;
    return el;
  }
  toggle.textContent = t(state.editing ? "bulkDone" : "rateEdit");
  toggle.disabled = state.busy || !state.editing && !available.size;
  toggle.setAttribute("aria-pressed", String(state.editing));
  toggle.onclick = () => {
    bookmarkSelections.set(list, { scope, editing: !state.editing, ids: new Set() });
    refresh();
  };
  if (!state.editing) return { editing: false };

  const checks = [];
  const count = document.createElement("span");
  count.setAttribute("role", "status");
  const selectAll = button(t("bulkSelectAll"));
  selectAll.onclick = () => {
    if (state.ids.size === available.size) state.ids.clear();
    else state.ids = new Set(available);
    sync();
  };
  function select(label, options, value) {
    const el = document.createElement("select");
    el.className = "ptb-bm-input";
    el.setAttribute("aria-label", label);
    el.add(new Option(label, ""));
    for (const [id, name] of options) el.add(new Option(name, id));
    el.value = value || "";
    return el;
  }
  const action = select(t("bookmarkActions"), [["group", t("groupCreate")], ["move", t("groupMove")],
    ["location", t("bulkLocation")]], state.kind);
  const fields = document.createElement("div");
  fields.className = "ptb-batch-fields";
  const apply = button(t("bulkApply"));
  const error = document.createElement("span");
  error.className = "ptb-bm-status";
  error.setAttribute("role", "alert");
  error.textContent = state.error || "";
  toolbar.append(selectAll, count, action, fields, error);

  function sync() {
    count.textContent = t("bulkSelected").replace("{n}", state.ids.size);
    selectAll.textContent = t(available.size && state.ids.size === available.size ? "bulkClearAll" : "bulkSelectAll");
    selectAll.disabled = !!state.busy || !available.size;
    action.disabled = !!state.busy;
    const ready = state.kind === "group" ? state.name?.trim() : state.kind === "move" ? state.folder :
      state.kind === "location" && (state.region || state.league);
    apply.disabled = state.busy || !state.ids.size || !ready;
    for (const [box, ids] of checks) {
      const n = ids.reduce((total, id) => total + Number(state.ids.has(id)), 0);
      box.disabled = state.busy || !ids.length;
      box.checked = !!n && n === ids.length;
      box.indeterminate = !!n && n < ids.length;
    }
  }
  function checkbox(ids, label) {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.className = "ptb-batch-check";
    box.setAttribute("aria-label", label);
    checks.push([box, ids]);
    box.onchange = () => {
      for (const id of ids) box.checked ? state.ids.add(id) : state.ids.delete(id);
      sync();
    };
    return box;
  }
  async function loadLeagues(el, reload, force = false) {
    reload.disabled = true;
    try {
      const response = await chrome.runtime.sendMessage({ cmd: "ptb-trade-leagues", game, force });
      if (!el.isConnected) return;
      if (!response?.value?.leagues?.length) throw Error();
      const options = response.value.leagues.map(league =>
        new Option(PTB.i18n.getLang() === "ko" ? league.text || league.id : league.id, league.id));
      el.replaceChildren(new Option(t("bulkKeepLeague"), ""), ...options);
      el.value = state.league || "";
      if (el.selectedIndex === -1) el.selectedIndex = 0;
      state.league = el.value;
      el.disabled = false;
      if (error.textContent === t("profileCatalogError")) error.textContent = "";
    } catch {
      if (el.isConnected) {
        error.textContent = t("profileCatalogError");
        if (el.options.length === 1) {
          el.disabled = true;
          state.league = "";
        }
      }
    } finally {
      reload.disabled = false;
    }
    sync();
  }
  function showFields() {
    fields.replaceChildren();
    if (state.kind === "group") {
      const name = document.createElement("input");
      name.className = "ptb-bm-input";
      name.placeholder = t("groupName");
      name.setAttribute("aria-label", name.placeholder);
      name.value = state.name ?? t("groupNew");
      state.name = name.value;
      name.oninput = () => { state.name = name.value; sync(); };
      fields.append(name);
    } else if (state.kind === "move") {
      const dest = select(t("groupMove"), [["@root", t("groupExtract")], ...view.folders.map(f => [f.id, f.name])], state.folder);
      state.folder = dest.value;
      dest.onchange = () => { state.folder = dest.value; sync(); };
      fields.append(dest);
    } else if (state.kind === "location") {
      const region = select(t("bulkKeepSite"), Object.entries(PTB.tradeRegion.regions).map(([id, [, label]]) => [id, label]), state.region);
      const league = select(t("bulkKeepLeague"), [], "");
      const reload = button("↻");
      reload.title = t("refreshLeagues");
      reload.setAttribute("aria-label", reload.title);
      reload.onclick = () => loadLeagues(league, reload, true);
      region.onchange = () => { state.region = region.value; sync(); };
      league.onchange = () => { state.league = league.value; sync(); };
      fields.append(region, reload, league);
      loadLeagues(league, reload);
    }
    if (state.kind) fields.append(apply);
    sync();
  }
  action.onchange = () => { state.kind = action.value; state.error = error.textContent = ""; showFields(); };
  apply.onclick = async () => {
    if (apply.disabled) return;
    state.busy = toggle.disabled = true;
    sync();
    try {
      await PTB.storage.editSelected(game, view.collectionId, [...state.ids], {
        kind: state.kind, name: state.name?.trim(), folderId: state.folder === "@root" ? null : state.folder,
        region: state.region, league: state.league,
      });
      state.ids.clear();
      state.kind = state.folder = state.region = state.league = state.error = "";
      delete state.name;
    } catch (err) {
      console.error(err);
      state.error = t("folderSaveError");
    } finally {
      state.busy = false;
      refresh();
    }
  };
  showFields();
  return { toolbar, editing: true, checkbox, sync };
};
