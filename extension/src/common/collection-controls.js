globalThis.PTB = globalThis.PTB || {};

PTB.renderCollectionControls = function (container, game, view, refresh) {
  container.hidden = !game;
  if (!game) {
    container.replaceChildren();
    delete container.dataset.ptbState;
    return;
  }
  const activeId = view.collectionId;
  const collections = view.collections;
  const editButton = container.bookmarkEditButton ??= document.createElement("button");
  editButton.type = "button";
  const state = JSON.stringify([game, activeId, view.defaultCollection, collections, PTB.i18n.getLang()]);
  if (container.dataset.ptbState === state) return editButton;
  container.dataset.ptbState = state;
  const t = PTB.i18n.t;
  const labels = PTB.backupLabels();
  const active = activeId === "default" ? view.defaultCollection : collections.find((item) => item.id === activeId);
  const activeName = active?.name || t("collectionDefault");
  const select = document.createElement("select");
  select.className = "ptb-collection-select";
  select.setAttribute("aria-label", t("collectionSelect"));
  if (view.defaultCollection) select.add(new Option(view.defaultCollection.name || t("collectionDefault"), "default"));
  for (const item of collections) select.add(new Option(item.name, item.id));
  select.value = activeId;

  function button(key, className, action, text) {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "ptb-collection-" + className;
    el.title = t(key);
    el.setAttribute("aria-label", t(key));
    el.textContent = text || t(key);
    if (action) el.addEventListener("click", action);
    return el;
  }

  function showControls() {
    const add = button("collectionAdd", "add", () => edit(false), "+");
    if (!activeId) {
      container.replaceChildren(add, button("collectionImport", "import", chooseFile));
      return;
    }
    const more = button("collectionMore", "more", null, "⋯");
    const menu = document.createElement("div");
    menu.className = "ptb-collection-menu";
    menu.popover = "auto";
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", t("collectionMore"));
    more.popoverTargetElement = menu;
    more.setAttribute("aria-haspopup", "menu");
    more.setAttribute("aria-expanded", "false");
    function item(key, cls, action) {
      const el = button(key, cls, () => {
        menu.hidePopover();
        action();
      });
      el.setAttribute("role", "menuitem");
      el.tabIndex = -1;
      return el;
    }
    const items = [
      item("collectionRename", "rename", () => edit(true)),
      item("collectionImport", "import", chooseFile),
      item("collectionExport", "export", () => save(() => PTB.backup.download(game, activeId, activeName), labels.exportError)),
      item("collectionRemove", "remove", confirmRemove),
    ];
    menu.append(items[0], items[1], items[2], document.createElement("hr"), items[3]);
    let initial = 0;
    more.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      initial = event.key === "ArrowUp" ? items.length - 1 : 0;
      menu.showPopover({ source: more });
    });
    menu.addEventListener("beforetoggle", (event) => {
      if (event.newState === "open") menu.style.visibility = "hidden";
    });
    menu.addEventListener("toggle", () => {
      const open = menu.matches(":popover-open");
      more.setAttribute("aria-expanded", String(open));
      if (!open) return;
      const anchor = more.getBoundingClientRect();
      const width = document.documentElement.clientWidth, height = document.documentElement.clientHeight;
      const below = height - anchor.bottom - 8, above = anchor.top - 8;
      menu.style.maxHeight = "";
      const opensAbove = menu.offsetHeight > below && above > below;
      menu.style.maxHeight = Math.max(1, opensAbove ? above : below) + "px";
      const box = menu.getBoundingClientRect();
      menu.style.left = Math.max(4, Math.min(anchor.right - box.width, width - box.width - 4)) + "px";
      const top = opensAbove ? anchor.top - box.height - 4 : anchor.bottom + 4;
      menu.style.top = Math.max(4, Math.min(top, height - box.height - 4)) + "px";
      menu.style.visibility = "visible";
      items[initial].focus({ preventScroll: true });
      initial = 0;
    });
    menu.addEventListener("keydown", (event) => {
      const index = items.indexOf(document.activeElement);
      if (event.key === "Tab" || event.key === "Escape") {
        menu.hidePopover();
        more.focus();
        if (event.key === "Tab") return;
      } else if (event.key === "Home") items[0].focus();
      else if (event.key === "End") items.at(-1).focus();
      else if (event.key === "ArrowDown") items[(index + 1) % items.length].focus();
      else if (event.key === "ArrowUp") items[(index + items.length - 1) % items.length].focus();
      else return;
      event.preventDefault();
      event.stopPropagation();
    });
    container.replaceChildren(editButton, select, add, more, menu);
  }

  function notice(text, role) {
    container.querySelector('[role="alert"], [role="status"]')?.remove();
    const message = document.createElement("span");
    message.setAttribute("role", role);
    message.textContent = text;
    container.append(message);
  }
  async function save(action, fail = t("collectionError"), done) {
    const controls = container.querySelectorAll("select, input, button");
    for (const el of controls) el.disabled = true;
    try {
      await action();
      if (container.dataset.ptbState === state) delete container.dataset.ptbState;
      await refresh();
      container.querySelector("select, .ptb-collection-add")?.focus();
      if (done) notice(done, "status");
    } catch (error) {
      console.error(error);
      if (container.dataset.ptbState !== state) return;
      for (const el of controls) el.disabled = false;
      select.value = activeId;
      notice(fail, "alert");
    }
  }
  select.addEventListener("change", () => save(() => PTB.collections.select(game, select.value)));

  function cancel() {
    showControls();
    container.querySelector("select, .ptb-collection-add")?.focus();
  }
  function onEscape(event) {
    if (event.key === "Escape" && !event.isComposing && !event.target.disabled) {
      event.preventDefault();
      event.stopPropagation();
      cancel();
    }
  }
  let fileRequest = 0;
  function chooseFile() {
    const request = ++fileRequest;
    const picker = document.createElement("input");
    picker.type = "file";
    picker.accept = ".json,application/json";
    // Keep the FileList out of the trade site's DOM.
    picker.addEventListener("change", async () => {
      const file = picker.files[0];
      if (!file) return;
      try {
        const fileData = PTB.backup.validate(JSON.parse(await file.text()));
        if (request !== fileRequest || !select.isConnected) return;
        if (fileData.scope !== "all" && fileData.scope !== game) {
          notice(labels.importOnGame(fileData.scope === "poe1" ? "PoE 1" : "PoE 2"), "alert");
          return;
        }
        const data = PTB.backup.selectScope(fileData, game);
        reviewImport(data, file.name);
      } catch {
        if (request === fileRequest && select.isConnected) notice(labels.bad, "alert");
      }
    }, { once: true });
    picker.click();
  }
  function reviewImport(data, filename) {
    const panel = document.createElement("form");
    panel.className = "ptb-collection-form ptb-collection-review";
    const target = [game === "poe1" ? "PoE 1" : "PoE 2", active && activeName].filter(Boolean).join(" · ");
    const summary = document.createElement("span");
    summary.textContent = labels.summary(target, data.bookmarks.length, data.folders.length);
    const mode = document.createElement("select");
    mode.setAttribute("aria-label", labels.mode);
    if (activeId && PTB.backup.sourceCollections(data).length === 1) {
      mode.add(new Option(labels.merge, "merge"));
      mode.add(new Option(labels.replace, "replace"));
    }
    mode.add(new Option(labels.newCollection, "new"));
    const name = document.createElement("input");
    name.type = "text";
    name.maxLength = 120;
    name.setAttribute("aria-label", labels.name);
    name.placeholder = labels.name;
    name.value = (data.sharedCollection === "default" ? data.defaultCollections?.[game] :
      data.collections.find((c) => c.id === data.sharedCollection)?.name) ||
      filename.replace(/\.json$/i, "").slice(0, 120) || labels.imported;
    function updateMode() {
      name.required = mode.value === "new";
      name.hidden = !name.required;
    }
    mode.addEventListener("change", updateMode);
    updateMode();
    const apply = button("collectionImport", "apply", null, labels.apply);
    apply.type = "submit";
    const dismiss = button("collectionCancel", "cancel", cancel);
    panel.append(summary, mode, name, apply, dismiss);
    panel.addEventListener("keydown", onEscape);
    panel.addEventListener("submit", (event) => {
      event.preventDefault();
      const operation = mode.value;
      if (operation === "new" && !name.value.trim()) {
        name.value = "";
        name.reportValidity();
        return;
      }
      const destination = operation === "new" ? { name: name.value.trim() } : { id: activeId };
      const commit = () => save(() => PTB.backup.importFile(data, operation, game, destination), labels.bad, labels.done);
      if (operation !== "replace") return commit();
      const question = document.createElement("span");
      question.textContent = labels.confirm(target);
      const accept = button("collectionImport", "confirm-replace", commit, labels.apply);
      panel.replaceChildren(question, dismiss, accept);
      dismiss.focus();
    });
    container.replaceChildren(panel);
    mode.focus();
  }
  function edit(renaming) {
    const form = document.createElement("form");
    form.className = "ptb-collection-form";
    const input = document.createElement("input");
    input.className = "ptb-collection-name";
    input.type = "text";
    input.autocomplete = "off";
    input.required = true;
    input.placeholder = t("collectionName");
    input.setAttribute("aria-label", t("collectionName"));
    input.value = renaming ? activeName : "";
    const submit = button("collectionSave", "save");
    submit.type = "submit";
    form.append(input, submit, button("collectionCancel", "cancel", cancel));
    form.addEventListener("keydown", onEscape);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const name = input.value.trim();
      if (!name) {
        input.value = "";
        input.reportValidity();
        return;
      }
      save(() => renaming ? PTB.collections.rename(game, activeId, name) : PTB.collections.add(game, name));
    });
    container.replaceChildren(form);
    input.focus();
    input.select();
  }
  function confirmRemove() {
    const panel = document.createElement("div");
    panel.className = "ptb-collection-confirm";
    panel.setAttribute("role", "group");
    const question = document.createElement("span");
    question.textContent = t("collectionConfirm").replace("{name}", () => activeName);
    panel.setAttribute("aria-label", question.textContent);
    const dismiss = button("collectionCancel", "cancel", cancel);
    panel.append(question, dismiss, button("delete", "confirm-remove", () => save(() => PTB.collections.remove(game, activeId))));
    panel.addEventListener("keydown", onEscape);
    container.replaceChildren(panel);
    dismiss.focus();
  }
  showControls();
  return editButton;
};
