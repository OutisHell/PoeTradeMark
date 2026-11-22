// 팝업과 거래소 사이드바가 같은 즐겨찾기 그룹 UI를 사용한다.
PTB.renderBookmarkGroups = function (list, view, options) {
  const { game, buildRow, refresh, gripSelector, canReorder, searching } = options;
  const { bookmarks, folders } = view;
  if (!game) {
    list.replaceChildren(...bookmarks.map(buildRow));
    return;
  }

  const t = (key, fallback) => PTB.i18n.t(key, fallback);
  const element = (tag, className, text) => {
    const el = document.createElement(tag);
    el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  };
  const button = (label) => {
    const el = element("button", "ptb-bm-button", label);
    el.type = "button";
    return el;
  };
  const status = element("div", "ptb-bm-status");
  status.setAttribute("role", "status");
  const menu = element("div", "ptb-bm-menu");
  menu.setAttribute("popover", "auto");
  menu.setAttribute("aria-label", t("bookmarkActions", "Bookmark actions"));
  async function save(action) {
    try {
      status.textContent = "";
      await action();
      return true;
    } catch (error) {
      console.error(error);
      status.textContent = t("folderSaveError", "Could not save the change.");
      return false;
    }
  }

  function menuButton(label, action) {
    const item = button(label);
    item.addEventListener("click", () => {
      menu.hidePopover();
      action();
    });
    return item;
  }

  function positionMenu(x, y) {
    const { width, height } = menu.getBoundingClientRect();
    menu.style.left = Math.max(4, Math.min(x, window.innerWidth - width - 4)) + "px";
    menu.style.top = Math.max(4, Math.min(y, window.innerHeight - height - 4)) + "px";
    menu.querySelector("button")?.focus({ preventScroll: true });
  }

  function openMenu(event, items) {
    event.preventDefault();
    event.stopPropagation();
    menu.replaceChildren(...items);
    if (!menu.matches(":popover-open")) menu.showPopover();
    const anchor = event.currentTarget.getBoundingClientRect();
    positionMenu(event.clientX || anchor.left, event.clientY || anchor.bottom);
  }

  function destinationMenu(label, destinations, move) {
    const trigger = button(label + " ›");
    trigger.addEventListener("click", () => {
      const { left, top } = menu.getBoundingClientRect();
      menu.replaceChildren(...destinations.map(({ id, name }) => menuButton(name, () => save(() => move(id)))));
      positionMenu(left, top);
    });
    return trigger;
  }

  function collectionActions(id) {
    const choices = [view.defaultCollection, ...view.collections]
      .filter((collection) => collection && collection.id !== view.collectionId)
      .map(({ id, name }) => ({ id, name: name || t("collectionDefault", "My bookmarks") }));
    return choices.length ? [destinationMenu(t("groupMoveCollection", "Move to collection"), choices,
      (destination) => PTB.collections.move(game, id, destination))] : [];
  }

  function editName(toggle, initialValue, action) {
    if (!toggle.isConnected) return;
    const form = element("form", "ptb-bm-form");
    const input = element("input", "ptb-bm-input");
    input.value = initialValue;
    input.required = true;
    input.setAttribute("aria-label", t("groupName", "Group name"));
    let finished = false;
    const finish = async (commit) => {
      if (finished) return;
      finished = true;
      const name = input.value.trim();
      if (commit && name && name !== initialValue && !await save(() => action(name))) {
        finished = false;
        input.focus();
        return;
      }
      form.replaceWith(toggle);
      refresh();
    };
    input.addEventListener("keydown", (event) => {
      if (event.isComposing) return;
      if (event.key === "Escape" || event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        finish(event.key === "Enter");
      }
    });
    form.addEventListener("submit", (event) => event.preventDefault());
    input.addEventListener("blur", () => finish(true));
    form.append(toggle.firstElementChild.cloneNode(true), input);
    toggle.replaceWith(form);
    input.focus();
    input.select();
  }

  let dragged = null;
  let highlight = null;
  function clearHighlight() {
    if (!highlight) return;
    highlight.removeAttribute("data-ptb-drop");
    highlight = null;
  }

  // dragover는 표시만 한다. 실제 drop 이벤트에서만 소속이나 순서를 저장한다.
  function dropTarget(target, getDropAction) {
    target.addEventListener("dragover", (event) => {
      const drop = dragged && getDropAction(event);
      if (!drop) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "move";
      let marker = target;
      if (drop.position !== "into" && !target.classList.contains("ptb-bm-gap")) {
        const row = target.classList.contains("ptb-bm-header") ? target.parentElement : target;
        marker = drop.position === "before" ? row.previousElementSibling : row.nextElementSibling;
      }
      if (!marker) return;
      if (highlight !== marker) clearHighlight();
      highlight = marker;
      marker.dataset.ptbDrop = drop.position;
    });
    target.addEventListener("dragleave", (event) => {
      if (!target.contains(event.relatedTarget)) clearHighlight();
    });
    target.addEventListener("drop", (event) => {
      const drop = dragged && getDropAction(event);
      if (!drop) return;
      event.preventDefault();
      event.stopPropagation();
      clearHighlight();
      save(drop.commit);
    });
  }
  function bindDrag(row, grip, data, wholeRow = false) {
    grip.draggable = true;
    row.draggable = wholeRow;
    row.addEventListener("dragstart", (event) => {
      if (event.target !== grip && !(wholeRow && event.target === row)) return;
      dragged = data;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("application/x-ptb-bookmark", data.id);
      row.classList.add("ptb-bm-dragging");
    });
    row.addEventListener("dragend", () => {
      if (dragged !== data) return;
      dragged = null;
      clearHighlight();
      row.classList.remove("ptb-bm-dragging");
      refresh();
    });
  }

  const newGroupName = () => t("groupNew", "New group");
  const groupBookmark = (targetId, sourceId) => PTB.folders.group(targetId, sourceId, newGroupName());
  const insertRoot = (id, targetId, after) => ({
    position: after ? "after" : "before",
    commit: () => PTB.storage.placeRoot(game, id, targetId, after),
  });
  const moveToGroup = (id, folderId) => ({
    position: "into",
    commit: () => PTB.storage.move(id, folderId),
  });
  const relativeY = (event, row) => {
    const rect = row.getBoundingClientRect();
    return (event.clientY - rect.top) / rect.height;
  };
  const canPlace = canReorder !== false && !searching;

  const groups = new Map(folders.map((folder) => [folder.id, []]));
  const rootBookmarks = new Map();
  for (const bookmark of bookmarks) {
    const group = groups.get(bookmark.folderId);
    if (group) group.push(bookmark);
    else rootBookmarks.set(bookmark.id, bookmark);
  }

  function insertMember(id, targetId, after, folderId) {
    const ids = groups.get(folderId).map((item) => item.id).filter((otherId) => otherId !== id);
    ids.splice(ids.indexOf(targetId) + Number(after), 0, id);
    return { position: after ? "after" : "before", commit: () => PTB.storage.reorder(game, ids, folderId) };
  }

  // 인접한 두 행의 가장자리와 실제 여백이 같은 삽입선을 공유한다.
  function addGaps(container, folderId) {
    const rows = Array.from(container.children);
    if (!rows.length) return;
    for (let i = 0; i <= rows.length; i++) {
      const gap = element("div", "ptb-bm-gap");
      gap.setAttribute("aria-hidden", "true");
      container.insertBefore(gap, rows[i] || null);
      dropTarget(gap, () => {
        if (!canPlace || (folderId && dragged.folderId !== folderId)) return null;
        const after = i === rows.length;
        const targetId = rows[after ? i - 1 : i].dataset.bmId;
        if (targetId === dragged.id) return null;
        return folderId ? insertMember(dragged.id, targetId, after, folderId) : insertRoot(dragged.id, targetId, after);
      });
    }
  }

  function makeBookmarkRow(bookmark, folderId) {
    const row = buildRow(bookmark);
    row.dataset.bmId = bookmark.id;
    bindDrag(row, row.querySelector(gripSelector) || row, { id: bookmark.id, folderId, group: false }, true);
    row.addEventListener("contextmenu", (event) => {
      const actions = [];
      const destinations = folders.filter((folder) => folder.id !== folderId);
      if (!folderId) actions.push(menuButton(t("groupCreate", "Group"), () => save(() => groupBookmark(bookmark.id, null))));
      if (destinations.length) {
        actions.push(destinationMenu(t("groupMove", "Move to group"), destinations,
          (id) => PTB.storage.move(bookmark.id, id)));
        const recent = destinations.find((folder) => folder.id === view.recentGroupId);
        if (recent) actions.push(menuButton(
          t("groupMoveRecent", "Move to “{name}”").replace("{name}", () => recent.name),
          () => save(() => PTB.storage.move(bookmark.id, recent.id))
        ));
      }
      if (folderId) actions.push(menuButton(
        t("groupExtract", "Remove from group"),
        () => save(() => PTB.storage.placeRoot(game, bookmark.id, folderId, true))
      ));
      openMenu(event, [...actions, ...collectionActions(bookmark.id)]);
    });
    dropTarget(row, (event) => {
      const { id } = dragged;
      if (id === bookmark.id) return null;
      const y = relativeY(event, row);
      const edge = y < 0.25 || y > 0.75;
      if (!folderId) {
        if (canPlace && (edge || dragged.group)) return insertRoot(id, bookmark.id, y > 0.5);
        if (dragged.group) return null;
        return { position: "into", commit: () => groupBookmark(bookmark.id, id) };
      }
      if (dragged.group) return null;
      if (dragged.folderId !== folderId) return moveToGroup(id, folderId);
      if (!canPlace) return null;
      return insertMember(id, bookmark.id, y > 0.5, folderId);
    });
    return row;
  }

  const groupRows = new Map();
  for (const folder of folders) {
    const items = groups.get(folder.id);
    if (searching && !items.length) continue;
    const section = element("section", "ptb-bm-group");
    section.dataset.bmId = folder.id;
    const header = element("div", "ptb-bm-header");
    const grip = element("span", "ptb-bm-grip", "⋮⋮");
    grip.title = t("groupDrag", "Drag group");
    const expanded = searching || !folder.collapsed;
    const toggle = button("");
    const caret = element("span", "ptb-bm-caret", expanded ? "▾" : "▸");
    caret.setAttribute("aria-hidden", "true");
    toggle.append(caret, element("span", "ptb-bm-name", folder.name));
    toggle.classList.add("ptb-bm-toggle");
    toggle.setAttribute("aria-expanded", String(expanded));
    toggle.disabled = Boolean(searching);
    toggle.addEventListener("click", () => save(() => PTB.folders.update(folder.id, { collapsed: expanded })));
    header.append(grip, toggle);
    section.appendChild(header);
    bindDrag(header, grip, { id: folder.id, folderId: null, group: true });
    header.addEventListener("contextmenu", (event) => openMenu(event, [
      menuButton(t("rename", "Rename"), () => editName(toggle, folder.name, (name) => PTB.folders.update(folder.id, { name }))),
      ...collectionActions(folder.id),
      menuButton(t("groupUngroup", "Ungroup"), () => save(() => PTB.folders.remove(folder.id))),
    ]));
    dropTarget(header, (event) => {
      const { id } = dragged;
      if (id === folder.id) return null;
      const y = relativeY(event, header);
      if (canPlace && (dragged.group || y < 0.25 || y > 0.75)) return insertRoot(id, folder.id, y > 0.5);
      if (dragged.group || dragged.folderId === folder.id) return null;
      return moveToGroup(id, folder.id);
    });
    if (expanded) {
      const body = element("div", "ptb-bm-items");
      for (const bookmark of items) body.appendChild(makeBookmarkRow(bookmark, folder.id));
      addGaps(body, folder.id);
      section.appendChild(body);
    }
    groupRows.set(folder.id, section);
  }

  const root = element("div", "ptb-bm-root");
  for (const id of view.rootOrder) {
    if (rootBookmarks.has(id)) root.appendChild(makeBookmarkRow(rootBookmarks.get(id), null));
    else if (groupRows.has(id)) root.appendChild(groupRows.get(id));
  }
  addGaps(root, null);
  if (!root.firstChild) root.appendChild(element("p", "ptb-bm-empty", t("emptyList", "No bookmarks yet.")));
  dropTarget(root, (event) => {
    if (!canPlace || event.target !== root || !dragged.folderId) return null;
    const { id } = dragged;
    return { position: "into", commit: () => PTB.storage.placeRoot(game, id, null) };
  });
  list.replaceChildren(status, root, menu);
};
