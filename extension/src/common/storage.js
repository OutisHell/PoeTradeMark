// 즐겨찾기 목록은 각 화면에서 읽고, 변경은 백그라운드 워커에서 순서대로 처리한다.
globalThis.PTB = globalThis.PTB || {};

// GGG item-name colors (normalPopup through relicPopup). Frame 9 is a foil unique.
PTB.bookmarkRarityColors = Object.freeze({
  normal: "#c8c8c8", magic: "#8888ff", rare: "#ffff77", unique: "#af6025", uniquefoil: "#82ad6a",
});
PTB.isTitleColor = value => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);

PTB.bookmarkGame = function (bookmark) {
  return bookmark && bookmark.game === "poe2" ? "poe2" : "poe1";
};

const bookmarkArray = (value) => Array.isArray(value) ? value : [];

const priceTime = mark => mark.lowPrice?.at ?? mark.emptyPriceAt ?? (mark.lowPrice ? 0 : -1);
function setObservedPrice(mark, price, at) {
  mark.lowPrice = price;
  if (price) delete mark.emptyPriceAt;
  else mark.emptyPriceAt = at;
}

async function readBookmarkLists() {
  const { bookmarks, bookmarkFolders, bookmarkRootOrder, bookmarkRecentGroups, bookmarkCollections, bookmarkActiveCollections, bookmarkDefaultCollections } = await chrome.storage.local.get([
    "bookmarks", "bookmarkFolders", "bookmarkRootOrder", "bookmarkRecentGroups", "bookmarkCollections", "bookmarkActiveCollections", "bookmarkDefaultCollections",
  ]);
  return {
    bookmarks: bookmarkArray(bookmarks),
    folders: bookmarkArray(bookmarkFolders),
    rootOrders: bookmarkRootOrder || {},
    recentGroups: bookmarkRecentGroups || {},
    collections: bookmarkArray(bookmarkCollections),
    activeCollections: bookmarkActiveCollections || {},
    defaultCollections: bookmarkDefaultCollections || {},
  };
}

function collectionOf(record) {
  return record.collectionId || "default";
}

// Legacy records with no collectionId belong to this game's starting collection.
// An absent name uses the localized label. An explicit null records its deletion.
function defaultCollectionFor(game, defaultCollections) {
  if (!["poe1", "poe2"].includes(game) || defaultCollections[game] === null) return null;
  return { id: "default", game, name: defaultCollections[game] || "" };
}

function collectionById(game, id, state) {
  return id === "default" ? defaultCollectionFor(game, state.defaultCollections) :
    state.collections.find((item) => item.id === id && item.game === game);
}

function activeCollectionFor(game, state) {
  const id = state.activeCollections[game] || "default";
  if (collectionById(game, id, state)) return id;
  return defaultCollectionFor(game, state.defaultCollections)?.id || state.collections.find((item) => item.game === game)?.id;
}

function recentKeyFor(game, collectionId) {
  return collectionId === "default" ? game : `${game}:${collectionId}`;
}

function rootOrderFor(game, bookmarks, folders, rootOrders) {
  const groupIds = folders.filter((folder) => folder.game === game).map((folder) => folder.id);
  const groups = new Set(groupIds);
  const looseIds = bookmarks
    .filter((item) => PTB.bookmarkGame(item) === game && !groups.has(item.folderId))
    .map((item) => item.id);
  const rootIds = new Set([...looseIds, ...groupIds]);
  const saved = [...new Set(bookmarkArray(rootOrders[game]))].filter((id) => rootIds.has(id));
  const seen = new Set(saved);
  return [...looseIds.filter((id) => !seen.has(id)), ...saved, ...groupIds.filter((id) => !seen.has(id))];
}

async function writeBookmarkChange(action, ...args) {
  const response = await chrome.runtime.sendMessage({ cmd: "ptb-bookmark-write", action, args });
  if (!response?.ok) throw new Error(response?.error || "Bookmark storage unavailable");
  return response.result;
}

PTB.storage = {
  async hasCollection(game) {
    const { bookmarkCollections, bookmarkDefaultCollections } = await chrome.storage.local.get([
      "bookmarkCollections", "bookmarkDefaultCollections",
    ]);
    return !!defaultCollectionFor(game, bookmarkDefaultCollections || {}) ||
      bookmarkArray(bookmarkCollections).some((item) => item.game === game);
  },
  async listView(game) {
    const state = await readBookmarkLists();
    const { bookmarks, folders, rootOrders, recentGroups, collections, defaultCollections } = state;
    const active = {
      poe1: activeCollectionFor("poe1", state),
      poe2: activeCollectionFor("poe2", state),
    };
    const collectionId = active[game] || null;
    const gameFolders = folders.filter((folder) => folder.game === game && collectionOf(folder) === collectionId);
    const visible = bookmarks.filter((bookmark) => {
      const owner = PTB.bookmarkGame(bookmark);
      return (!game || game === owner) && active[owner] === collectionOf(bookmark);
    });
    return {
      bookmarks: visible.map((bookmark) => ({
        ...bookmark,
        game: PTB.bookmarkGame(bookmark),
        league: PTB.decodePathPart(bookmark.league),
      })),
      folders: gameFolders,
      collections: collections.filter((item) => item.game === game),
      defaultCollection: defaultCollectionFor(game, defaultCollections),
      collectionId,
      recentGroupId: gameFolders.find((folder) => folder.id === recentGroups[recentKeyFor(game, collectionId)])?.id ?? null,
      rootOrder: game ? rootOrderFor(game, visible, gameFolders, rootOrders) : [],
    };
  },
  async list(game) {
    return (await this.listView(game)).bookmarks;
  },
  add: (partial) => writeBookmarkChange("add", partial),
  recordBookmarkPrice: (id, href, price, at = price?.at) => writeBookmarkChange("recordBookmarkPrice", id, href, price, at),
  update: (id, patch) => writeBookmarkChange("update", id, patch),
  remove: (id) => writeBookmarkChange("remove", id),
  move: (id, folderId) => writeBookmarkChange("move", id, folderId),
  editSelected: (game, collection, ids, operation) => writeBookmarkChange("editSelected", game, collection, ids, operation),
  placeRoot: (game, id, targetId, after = false) => writeBookmarkChange("placeRoot", game, id, targetId, after),
  reorder: (game, ids, folderId = null) => writeBookmarkChange("reorder", game, ids, folderId),
};

PTB.collections = {
  move: (game, id, destination) => writeBookmarkChange("moveToCollection", game, id, destination),
  remove: (game, id) => writeBookmarkChange("removeCollection", game, id),
  add: (game, name) => writeBookmarkChange("addCollection", game, name),
  select: (game, id) => writeBookmarkChange("selectCollection", game, id),
  rename: (game, id, name) => writeBookmarkChange("renameCollection", game, id, name),
};

PTB.folders = {
  async list(game) {
    return (await PTB.storage.listView(game)).folders;
  },
  add: (game, name) => writeBookmarkChange("addFolder", game, name),
  group: (targetId, sourceId, name) => writeBookmarkChange("group", targetId, sourceId, name),
  update: (id, patch) => writeBookmarkChange("updateFolder", id, patch),
  remove: (id) => writeBookmarkChange("removeFolder", id),
};

function folderName(name) {
  const trimmed = String(name || "").trim();
  if (!trimmed) throw new Error("Folder name is required");
  return trimmed;
}

function newFolder(game, name, collectionId) {
  const folder = { id: crypto.randomUUID(), game, name: folderName(name), collapsed: false, createdAt: Date.now() };
  if (collectionId !== "default") folder.collectionId = collectionId;
  return folder;
}

function createBookmarkGroup(game, name, collectionId, folders) {
  const taken = new Set(folders.filter(f => f.game === game && collectionOf(f) === collectionId).map(f => f.name));
  const base = folderName(name);
  let unique = base;
  for (let i = 2; taken.has(unique); i++) unique = base + " " + i;
  return newFolder(game, unique, collectionId);
}

function collectionName(name) {
  const trimmed = String(name || "").trim();
  if (!trimmed) throw new Error("Collection name is required");
  return trimmed;
}

PTB.addBookmarkSnapshot = async function (partial, extraStorage = {}) {
  const state = await readBookmarkLists();
  const { bookmarks } = state;
  const game = PTB.bookmarkGame(partial);
  const collectionId = activeCollectionFor(game, state);
  if (!collectionId) throw new Error("Create a collection before saving bookmarks");
  // 같은 게임 안에서 같은 제목이 이미 있으면 뒤에 (2),(3)… 붙여 유일하게
  let title = partial.title;
  const base = (partial.title || "").trim();
  if (base) {
    const taken = new Set(bookmarks.filter((b) => PTB.bookmarkGame(b) === game && collectionOf(b) === collectionId).map((b) => b.title));
    title = base;
    let n = 2;
    while (taken.has(title)) {
      title = `${base} (${n})`;
      n += 1;
    }
  }
  const bookmark = {
    iconUrl: null,
    query: null,
    sort: null,
    ...partial,
    game,
    folderId: null,
    title,
    itemName: String(partial.itemName ?? partial.title ?? "").trim(),
    realm: partial.realm || PTB.hostToRealm(partial.host),
    id: crypto.randomUUID(),
    createdAt: Date.now(),
  };
  if (collectionId !== "default") bookmark.collectionId = collectionId;
  else delete bookmark.collectionId;
  bookmarks.unshift(bookmark);
  await chrome.storage.local.set({ ...extraStorage, bookmarks });
  return bookmark;
};

// 워커만 호출한다. 저장 배열을 읽고 쓰는 동안 다른 변경이 끼어들지 않는다.
PTB.bookmarkChanges = {
  async editSelected(game, collection, ids, operation) {
    const state = await readBookmarkLists();
    if (!["poe1", "poe2"].includes(game) || activeCollectionFor(game, state) !== collection ||
        !collection || !Array.isArray(ids) || !ids.length) throw Error("Selection unavailable");
    const selected = new Set(ids);
    const marks = state.bookmarks.filter(b => selected.has(b.id) && PTB.bookmarkGame(b) === game && collectionOf(b) === collection);
    if (marks.length !== selected.size) throw Error("Selection changed");
    const changes = { bookmarks: state.bookmarks };
    if (operation.kind === "location") {
      const { region, league } = operation;
      if ((!region && !league) || (region && !Object.hasOwn(PTB.tradeRegion.regions, region)) ||
          (league && (typeof league !== "string" || league.length > 160 || !league.trim() ||
            /[/\\?#%\x00-\x1f\x7f]/.test(league) || /^\.{1,2}$/.test(league)))) throw Error("Invalid trade destination");
      for (const mark of marks) {
        if (region) {
          const [host] = PTB.tradeRegion.regions[region];
          if (mark.host !== host && mark.type === "search" && mark.searchId.startsWith("H4sI")) {
            const href = await PTB.profileTradeUrl(PTB.buildTradeUrl(mark), region, { league: league || mark.league });
            mark.searchId = PTB.parseTradeUrl(href).searchId;
          }
          mark.host = host;
          mark.realm = region;
        }
        if (league) mark.league = league;
      }
    } else {
      const folders = state.folders.filter(f => f.game === game && collectionOf(f) === collection);
      const rootOrder = rootOrderFor(game, state.bookmarks, state.folders, state.rootOrders);
      let destination;
      let order = rootOrder.filter(id => !selected.has(id));
      if (operation.kind === "group") {
        const folder = createBookmarkGroup(game, operation.name, collection, folders);
        const parents = new Set(marks.map(b => b.folderId));
        const anchor = rootOrder.find(id => selected.has(id) || parents.has(id));
        const index = rootOrder.slice(0, rootOrder.indexOf(anchor)).filter(id => !selected.has(id)).length;
        order.splice(index, 0, folder.id);
        destination = folder.id;
        changes.bookmarkFolders = [...state.folders, folder];
      } else if (operation.kind === "move" && (operation.folderId === null || folders.some(f => f.id === operation.folderId))) {
        destination = operation.folderId;
        if (!destination) order = [...rootOrder, ...marks.filter(b => !rootOrder.includes(b.id)).map(b => b.id)];
      } else throw Error("Group unavailable");
      for (const mark of marks) mark.folderId = destination;
      changes.bookmarkRootOrder = { ...state.rootOrders, [game]: order };
      if (destination) changes.bookmarkRecentGroups = { ...state.recentGroups, [recentKeyFor(game, collection)]: destination };
    }
    await chrome.storage.local.set(changes);
  },
  async recordBookmarkPrice(id, href, price, at = price?.at) {
    if (!id || !Number.isFinite(at) || (price !== null &&
        (!Number.isFinite(price?.amount) || price.amount <= 0 || !price.currency || price.at !== at))) return;
    const saved = await chrome.storage.local.get(["bookmarks"]);
    const bookmarks = bookmarkArray(saved.bookmarks);
    const mark = bookmarks.find(item => item.id === id);
    if (!mark || PTB.buildTradeUrl(mark) !== href || priceTime(mark) >= at) return;
    setObservedPrice(mark, price, at);
    await chrome.storage.local.set({ bookmarks });
  },
  async moveToCollection(game, id, destination) {
    const state = await readBookmarkLists();
    const { bookmarks, folders, rootOrders, recentGroups } = state;
    if (!collectionById(game, destination, state)) {
      throw new Error("Collection unavailable");
    }
    const folder = folders.find((f) => f.id === id && f.game === game);
    const bookmark = bookmarks.find((b) => b.id === id && PTB.bookmarkGame(b) === game);
    const entry = folder || bookmark;
    if (!entry || collectionOf(entry) === destination) return;
    const order = rootOrderFor(game, bookmarks, folders, rootOrders).filter((rootId) => rootId !== id);
    const changes = { bookmarks, bookmarkRootOrder: { ...rootOrders, [game]: [...order, id] } };
    if (folder) {
      const source = collectionOf(folder);
      const recentKey = recentKeyFor(game, source);
      if (recentGroups[recentKey] === id) {
        delete recentGroups[recentKey];
        changes.bookmarkRecentGroups = recentGroups;
      }
      for (const member of bookmarks) {
        if (member.folderId === id && PTB.bookmarkGame(member) === game) member.collectionId = destination;
      }
      changes.bookmarkFolders = folders;
    } else {
      bookmark.folderId = null;
    }
    entry.collectionId = destination;
    await chrome.storage.local.set(changes);
  },

  async removeCollection(game, id) {
    const state = await readBookmarkLists();
    const { bookmarks, folders, collections, activeCollections, rootOrders, recentGroups } = state;
    if (!collectionById(game, id, state)) {
      throw new Error("Collection unavailable");
    }
    const keep = (item) => PTB.bookmarkGame(item) !== game || collectionOf(item) !== id;
    const remainingMarks = bookmarks.filter(keep);
    const remainingGroups = folders.filter(keep);
    const recent = { ...recentGroups };
    delete recent[recentKeyFor(game, id)];
    const remaining = collections.filter((c) => c.id !== id || c.game !== game);
    const defaults = { ...state.defaultCollections };
    if (id === "default") defaults[game] = null;
    const next = activeCollectionFor(game, { activeCollections, collections: remaining, defaultCollections: defaults });
    const changes = {
      bookmarks: remainingMarks,
      bookmarkFolders: remainingGroups,
      bookmarkCollections: remaining,
      bookmarkDefaultCollections: defaults,
      bookmarkActiveCollections: { ...activeCollections, [game]: next ?? null },
      bookmarkRootOrder: { ...rootOrders, [game]: rootOrderFor(game, remainingMarks, remainingGroups, rootOrders) },
      bookmarkRecentGroups: recent,
    };
    await chrome.storage.local.set(changes);
  },

  async addCollection(game, name) {
    if (game !== "poe1" && game !== "poe2") throw new Error("Trade game is required");
    const { collections, activeCollections } = await readBookmarkLists();
    const collection = { id: crypto.randomUUID(), game, name: collectionName(name) };
    await chrome.storage.local.set({
      bookmarkCollections: [...collections, collection],
      bookmarkActiveCollections: { ...activeCollections, [game]: collection.id },
    });
    return collection;
  },

  async selectCollection(game, id) {
    if (game !== "poe1" && game !== "poe2") throw new Error("Trade game is required");
    const state = await readBookmarkLists();
    if (!collectionById(game, id, state)) {
      throw new Error("Collection is unavailable for this game");
    }
    await chrome.storage.local.set({ bookmarkActiveCollections: { ...state.activeCollections, [game]: id } });
  },

  async renameCollection(game, id, name) {
    const state = await readBookmarkLists();
    const collection = collectionById(game, id, state);
    if (!collection) throw new Error("Collection is unavailable for this game");
    collection.name = collectionName(name);
    if (id === "default") {
      await chrome.storage.local.set({ bookmarkDefaultCollections: { ...state.defaultCollections, [game]: collection.name } });
    } else {
      await chrome.storage.local.set({ bookmarkCollections: state.collections });
    }
  },

  add(partial) { return PTB.addBookmarkSnapshot(partial); },

  async update(id, patch) {
    const { bookmarks } = await readBookmarkLists();
    const bookmark = bookmarks.find((item) => item.id === id);
    if (!bookmark) return;
    if (Object.hasOwn(patch, "title")) {
      bookmark.title = patch.title;
      delete bookmark.autoFilterTitle;
    }
    if (Object.values(PTB.bookmarkRarityColors).includes(patch.titleColor)) bookmark.titleColor = patch.titleColor;
    if (Object.hasOwn(patch, "lowPrice")) bookmark.lowPrice = patch.lowPrice;
    await chrome.storage.local.set({ bookmarks });
  },

  async remove(id) {
    const { bookmarks, folders, rootOrders } = await readBookmarkLists();
    const removed = bookmarks.find(item => item.id === id);
    if (!removed) return;
    const game = PTB.bookmarkGame(removed);
    const remaining = bookmarks.filter(item => item.id !== id);
    const changes = { bookmarks: remaining };
    if (rootOrders[game]?.length) {
      changes.bookmarkRootOrder = { ...rootOrders, [game]: rootOrderFor(game, remaining, folders, rootOrders) };
    }
    await chrome.storage.local.set(changes);
  },

  async move(id, folderId) {
    const { bookmarks, folders, recentGroups } = await readBookmarkLists();
    const bookmark = bookmarks.find((item) => item.id === id);
    if (!bookmark) return;
    const game = PTB.bookmarkGame(bookmark);
    const collectionId = collectionOf(bookmark);
    if (folderId !== null && !folders.some((folder) => folder.id === folderId && folder.game === game && collectionOf(folder) === collectionId)) {
      throw new Error("Folder is unavailable for this bookmark");
    }
    if ((bookmark.folderId || null) === folderId) return;
    bookmark.folderId = folderId;
    const changes = { bookmarks };
    if (folderId) changes.bookmarkRecentGroups = { ...recentGroups, [recentKeyFor(game, collectionId)]: folderId };
    await chrome.storage.local.set(changes);
  },

  async placeRoot(game, id, targetId, after) {
    if (game !== "poe1" && game !== "poe2") throw new Error("Trade game is required");
    if (id === targetId) return;
    const { bookmarks, folders, rootOrders } = await readBookmarkLists();
    const bookmark = bookmarks.find((item) => item.id === id && PTB.bookmarkGame(item) === game);
    const record = bookmark || folders.find((folder) => folder.id === id && folder.game === game);
    if (!record) return;
    if (targetId !== null) {
      const target = bookmarks.find((item) => item.id === targetId) || folders.find((folder) => folder.id === targetId);
      if (!target || collectionOf(target) !== collectionOf(record)) return;
    }
    const order = rootOrderFor(game, bookmarks, folders, rootOrders).filter((otherId) => otherId !== id);
    const targetIndex = targetId === null ? order.length : order.indexOf(targetId);
    if (targetIndex < 0) return;
    order.splice(targetIndex + Number(Boolean(after)), 0, id);
    if (bookmark) bookmark.folderId = null;
    await chrome.storage.local.set({
      bookmarks,
      bookmarkRootOrder: { ...rootOrders, [game]: order },
    });
  },

  async reorder(game, ids, folderId) {
    const state = await readBookmarkLists();
    const { bookmarks } = state;
    const collectionId = activeCollectionFor(game, state);
    const byId = new Map(bookmarks
      .filter((item) => PTB.bookmarkGame(item) === game && collectionOf(item) === collectionId && (item.folderId || null) === folderId)
      .map((item) => [item.id, item]));
    const ordered = [...new Set(ids)].filter((id) => byId.has(id));
    if (ordered.length < 2) return;
    const selected = new Set(ordered);
    let next = 0;
    await chrome.storage.local.set({
      bookmarks: bookmarks.map((item) => selected.has(item.id) ? byId.get(ordered[next++]) : item),
    });
  },

  async addFolder(game, name) {
    if (game !== "poe1" && game !== "poe2") throw new Error("Trade game is required");
    const state = await readBookmarkLists();
    const { folders, recentGroups } = state;
    const collectionId = activeCollectionFor(game, state);
    if (!collectionId) throw new Error("Create a collection before adding groups");
    const folder = newFolder(game, name, collectionId);
    await chrome.storage.local.set({
      bookmarkFolders: [...folders, folder],
      bookmarkRecentGroups: { ...recentGroups, [recentKeyFor(game, collectionId)]: folder.id },
    });
    return folder;
  },

  async group(targetId, sourceId, name) {
    const { bookmarks, folders, rootOrders, recentGroups } = await readBookmarkLists();
    const target = bookmarks.find((bookmark) => bookmark.id === targetId);
    if (!target || sourceId === targetId) return;
    const game = PTB.bookmarkGame(target);
    const collectionId = collectionOf(target);
    const rootOrder = rootOrderFor(game, bookmarks, folders, rootOrders);
    if (!rootOrder.includes(targetId)) throw new Error("The target already belongs to a group");
    const source = sourceId === null ? null : bookmarks.find((bookmark) => bookmark.id === sourceId);
    if (sourceId !== null && (!source || PTB.bookmarkGame(source) !== game || collectionOf(source) !== collectionId)) {
      throw new Error("Bookmarks must belong to the same game and collection");
    }
    const folder = createBookmarkGroup(game, name, collectionId, folders);
    target.folderId = folder.id;
    if (source) source.folderId = folder.id;
    await chrome.storage.local.set({
      bookmarks,
      bookmarkFolders: [...folders, folder],
      bookmarkRecentGroups: { ...recentGroups, [recentKeyFor(game, collectionId)]: folder.id },
      bookmarkRootOrder: {
        ...rootOrders,
        [game]: rootOrder.filter((id) => id !== sourceId).map((id) => id === targetId ? folder.id : id),
      },
    });
    return folder;
  },

  async updateFolder(id, patch) {
    const { folders } = await readBookmarkLists();
    const folder = folders.find((item) => item.id === id);
    if (!folder) return;
    if (Object.hasOwn(patch, "name")) folder.name = folderName(patch.name);
    if (typeof patch.collapsed === "boolean") folder.collapsed = patch.collapsed;
    await chrome.storage.local.set({ bookmarkFolders: folders });
  },

  async removeFolder(id) {
    const { bookmarks, folders, rootOrders, recentGroups } = await readBookmarkLists();
    const folder = folders.find((item) => item.id === id);
    if (!folder) return;
    const { game } = folder;
    const recentKey = recentKeyFor(game, collectionOf(folder));
    if (recentGroups[recentKey] === id) delete recentGroups[recentKey];
    const groupItems = bookmarks.filter((item) => item.folderId === id && PTB.bookmarkGame(item) === game);
    const order = rootOrderFor(game, bookmarks, folders, rootOrders)
      .flatMap((rootId) => rootId === id ? groupItems.map((item) => item.id) : [rootId]);
    await chrome.storage.local.set({
      bookmarks: bookmarks.map((item) => item.folderId === id ? { ...item, folderId: null } : item),
      bookmarkFolders: folders.filter((folder) => folder.id !== id),
      bookmarkRecentGroups: recentGroups,
      bookmarkRootOrder: { ...rootOrders, [game]: order },
    });
  },
};
