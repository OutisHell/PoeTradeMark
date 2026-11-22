// Backup files contain only the two bookmark libraries and their display order.
(() => {
  const format = "poe-trademark-bookmarks";
  const version = 2;
  const games = ["poe1", "poe2"];
  const tradeHost = /^(?:(?:[a-z0-9-]+\.)*pathofexile\.(?:com|tw)|poe\.kakaogames\.com)$/;
  const invalid = () => { throw new Error("Invalid or unsupported bookmark backup"); };
  const isText = (value) => typeof value === "string";
  const isGame = (value) => games.includes(value);
  const validScope = (value) => value === "all" || isGame(value);
  const inScope = (game, scope) => scope === "all" || game === scope;
  const isId = (value) => isText(value) && /^[\w-]{1,128}$/.test(value);
  const safeSegment = (value) => !!value.trim() && !/[\/\\\x00-\x1f\x7f]/.test(value) && !/^\.{1,2}$/.test(value);

  function isSearchToken(value) {
    // Trade also accepts full compressed queries as one opaque URL segment.
    // Keep the exact encoding since decoding and re-encoding can change a token.
    if (!isText(value) || !/^(?:[A-Za-z0-9._~!$&'()*+,;=:@-]|%[0-9A-Fa-f]{2})+$/.test(value)) return false;
    try {
      const decoded = decodeURIComponent(value);
      return safeSegment(decoded) && !/[?#%]/.test(decoded);
    } catch { return false; }
  }

  function iconUrl(value, host) {
    if (!isText(value) || !value) return null;
    try {
      const url = new URL(value, "https://" + host);
      if (url.protocol === "https:" && !url.username && !url.password && !url.port &&
          (tradeHost.test(url.hostname) || /^(?:[a-z0-9-]+\.)*poecdn\.com$/.test(url.hostname))) {
        return url.href;
      }
    } catch { /* Older bookmarks may have a stale icon. */ }
    return null;
  }

  function cleanBookmark(record) {
    if (!record || !isId(record.id) || !isGame(record.game) ||
        !isText(record.host) || !tradeHost.test(record.host) ||
        !["search", "exchange"].includes(record.type) ||
        !isText(record.league) || !safeSegment(PTB.decodePathPart(record.league)) ||
        !isSearchToken(record.searchId) || !isText(record.title) ||
        (record.folderId != null && !isId(record.folderId)) ||
        (record.filters != null && !(Array.isArray(record.filters) && record.filters.every(isText)))) invalid();
    const { id, game, host, type, league, searchId, title } = record;
    const low = record.lowPrice;
    return {
      id, game, host, type, league, searchId, title, realm: PTB.hostToRealm(host),
      ...(record.collectionId != null ? { collectionId: record.collectionId } : {}),
      folderId: record.folderId || null,
      createdAt: Number.isFinite(record.createdAt) ? record.createdAt : 0,
      itemName: isText(record.itemName) ? record.itemName : title,
      filters: record.filters || [], iconUrl: iconUrl(record.iconUrl, host),
      lowPrice: low && Number.isFinite(low.amount) && isText(low.currency)
        ? { amount: low.amount, currency: low.currency, ...(Number.isFinite(low.at) ? { at: low.at } : {}) } : null,
    };
  }

  function scopedDefaults(defaults, scope) {
    const entries = Object.entries(defaults || {}).filter(([game]) => inScope(game, scope));
    return entries.length ? { defaultCollections: Object.fromEntries(entries) } : {};
  }

  function validate(file) {
    if (!file || file.format !== format || ![1, version].includes(file.version) ||
        !Array.isArray(file.bookmarks) || !Array.isArray(file.folders) || !file.order) invalid();
    const folders = file.folders.map((item) => {
      if (!item || !isId(item.id) || !isGame(item.game) || !isText(item.name) || !item.name.trim()) invalid();
      return { id: item.id, game: item.game, name: item.name, collapsed: item.collapsed === true,
        ...(item.collectionId != null ? { collectionId: item.collectionId } : {}),
        createdAt: Number.isFinite(item.createdAt) ? item.createdAt : 0 };
    });
    const bookmarks = file.bookmarks.map(cleanBookmark);
    const folderById = new Map(folders.map((item) => [item.id, item]));
    const items = [...folders, ...bookmarks];
    const scope = file.scope === undefined ? "all" : file.scope;
    if (!validScope(scope) || items.some((item) => !inScope(item.game, scope))) invalid();
    if (file.collections !== undefined && !Array.isArray(file.collections)) invalid();
    const collections = (file.collections || []).map((item) => {
      if (!item || !isId(item.id) || item.id === "default" || !isGame(item.game) ||
          !inScope(item.game, scope) || !isText(item.name) || !item.name.trim()) invalid();
      return { id: item.id, game: item.game, name: item.name };
    });
    const catalog = new Map(collections.map((item) => [item.id, item.game]));
    if (catalog.size !== collections.length) invalid();
    if (items.some((item) => item.collectionId != null && item.collectionId !== "default" &&
        catalog.get(item.collectionId) !== item.game)) invalid();
    const sharedId = file.sharedCollection ?? null;
    if (file.defaultCollections !== undefined) {
      const defaults = file.defaultCollections;
      if (!defaults || typeof defaults !== "object" || Array.isArray(defaults)) invalid();
      for (const [game, name] of Object.entries(defaults)) {
        if (!isGame(game) || !inScope(game, scope) || (sharedId !== null && sharedId !== "default") ||
            (name !== null && (!isText(name) || !name.trim()))) invalid();
        if (name === null && (sharedId === "default" || !collections.some((item) => item.game === game) ||
            items.some((item) => item.game === game && collectionOf(item) === "default"))) invalid();
      }
    }
    if (sharedId !== null && (!isGame(scope) || (sharedId !== "default" && catalog.get(sharedId) !== scope) ||
        items.some((item) => collectionOf(item) !== sharedId) || collections.some((item) => item.id !== sharedId))) invalid();
    if (new Set(items.map((item) => item.id)).size !== items.length) invalid();
    for (const mark of bookmarks) {
      if (mark.folderId && (folderById.get(mark.folderId)?.game !== mark.game ||
          collectionOf(folderById.get(mark.folderId)) !== collectionOf(mark))) invalid();
    }
    const order = {};
    for (const game of games) {
      const ids = file.order[game];
      const roots = new Set(items.filter((item) => item.game === game && !item.folderId).map((item) => item.id));
      if (!Array.isArray(ids) || ids.length !== roots.size || !ids.every((id) => roots.delete(id))) invalid();
      order[game] = [...ids];
    }
    return { format, version, scope, bookmarks, folders, order, collections, sharedCollection: sharedId,
      ...scopedDefaults(file.defaultCollections, scope) };
  }

  function selectScope(file, scope) {
    if (!validScope(scope) || (file.scope !== "all" && file.scope !== scope)) invalid();
    if (scope === "all") return file;
    const { defaultCollections, ...rest } = file;
    return {
      ...rest, scope, ...scopedDefaults(defaultCollections, scope),
      bookmarks: file.bookmarks.filter((item) => item.game === scope),
      folders: file.folders.filter((item) => item.game === scope),
      collections: file.collections.filter((item) => item.game === scope),
      order: { poe1: [], poe2: [], [scope]: file.order[scope] },
    };
  }

  async function snapshot(scope = "all", sharedCollection = null) {
    if (!validScope(scope)) invalid();
    const state = await readBookmarkLists();
    if (sharedCollection !== null && (!isGame(scope) || !collectionById(scope, sharedCollection, state))) invalid();
    const belongs = (item) => sharedCollection === null || collectionOf(item) === sharedCollection;
    const bookmarks = state.bookmarks.filter(belongs);
    const folders = state.folders.filter(belongs);
    const collections = state.collections.filter((item) => inScope(item.game, scope) &&
      (sharedCollection === null || item.id === sharedCollection));
    const { rootOrders } = state;
    const order = {};
    const validFolders = new Map(folders.map((folder) => [folder.id, folder.game]));
    for (const game of games) order[game] = inScope(game, scope) ? rootOrderFor(game, bookmarks, folders, rootOrders) : [];
    return validate({
      format, version, scope, folders: folders.filter((item) => inScope(item.game, scope)), order,
      sharedCollection, collections,
      ...(sharedCollection === null || sharedCollection === "default" ? scopedDefaults(state.defaultCollections, scope) : {}),
      bookmarks: bookmarks.filter((item) => inScope(PTB.bookmarkGame(item), scope)).map((item) => ({
        ...item, game: PTB.bookmarkGame(item),
        folderId: validFolders.get(item.folderId) === PTB.bookmarkGame(item) ? item.folderId : null,
      })),
    });
  }

  function sourceCollections(data) {
    const defaults = new Set([...data.bookmarks, ...data.folders]
      .filter((item) => collectionOf(item) === "default").map((item) => item.game));
    return games.filter((game) => inScope(game, data.scope)).flatMap((game) => {
      const custom = data.collections.filter((item) => item.game === game);
      const primary = defaultCollectionFor(game, data.defaultCollections || {});
      const includeDefault = primary && (primary.name || defaults.has(game) || !custom.length);
      return [...(includeDefault ? [primary] : []), ...custom];
    });
  }

  // Remap IDs when copying between collections so both versions can be edited independently.
  // Deterministic remaps let a second merge of the same source skip existing copies.
  async function mappedId(collectionId, sourceId) {
    const bytes = new TextEncoder().encode(JSON.stringify([collectionId, sourceId]));
    const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    return Array.from(hash, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  async function prepareCopies(data, state, mode, destination) {
    const sources = sourceCollections(data);
    if (mode !== "new" && (!isGame(data.scope) || sources.length !== 1 ||
        !collectionById(data.scope, destination.id, state))) invalid();
    const fresh = [];
    const active = { ...state.activeCollections };
    const bySource = new Map();
    for (const source of sources) {
      let id = destination.id;
      if (mode === "new") {
        const desired = destination.name?.trim();
        if (!desired) invalid();
        const siblings = [...state.collections, ...fresh].filter((c) => c.game === source.game);
        const named = sources.filter((c) => c.game === source.game).length > 1 && source.name;
        const base = named ? desired + " · " + source.name : desired;
        let name = base;
        for (let n = 2; siblings.some((c) => c.name === name); n++) name = base + " (" + n + ")";
        id = crypto.randomUUID();
        if (!fresh.some((c) => c.game === source.game)) active[source.game] = id;
        fresh.push({ id, name, game: source.game });
      }
      bySource.set(source.game + ":" + source.id, id);
    }
    const occupied = new Map([...state.bookmarks, ...state.folders].map((item) => [item.id, item]));
    const ids = new Map();
    const records = [...data.bookmarks, ...data.folders];
    await Promise.all(records.map(async (item) => {
      const target = bySource.get(item.game + ":" + collectionOf(item));
      const remapped = await mappedId(item.game + ":" + target, item.id);
      const inTarget = (entry) => entry && PTB.bookmarkGame(entry) === item.game && collectionOf(entry) === target;
      const original = occupied.get(item.id);
      // An export of this very collection can already contain remapped IDs.
      // Prefer its existing identity; a source share maps deterministically into the copy.
      const keepsOriginal = mode !== "new" && !inTarget(occupied.get(remapped)) &&
        (inTarget(original) || (!original && collectionOf(item) === target));
      ids.set(item.id, keepsOriginal ? item.id : remapped);
    }));
    function copy(item) {
      const result = { ...item, id: ids.get(item.id), collectionId: bySource.get(item.game + ":" + collectionOf(item)) };
      if (item.folderId) result.folderId = ids.get(item.folderId);
      return result;
    }
    return {
      ...data, bookmarks: data.bookmarks.map(copy), folders: data.folders.map(copy), collections: fresh,
      active, order: Object.fromEntries(games.map((game) => [game, data.order[game].map((id) => ids.get(id))])),
    };
  }

  // Match stable local IDs across repeated imports. Keep the local copy on overlap.
  PTB.bookmarkChanges.importBackup = async (file, mode, scope = "all", destination = null) => {
    if (!["merge", "replace", "new"].includes(mode)) invalid();
    let data = selectScope(validate(file), scope);
    const state = await readBookmarkLists();
    const { bookmarks, folders, rootOrders, recentGroups, collections, activeCollections } = state;
    const defaults = { ...state.defaultCollections };
    if (mode === "new" || destination) {
      if (!destination) invalid();
      data = await prepareCopies(data, state, mode, destination);
    } else if (data.sharedCollection !== null) invalid();
    if (mode === "replace") {
      const keep = (item) => !inScope(PTB.bookmarkGame(item), scope) || (destination && collectionOf(item) !== destination.id);
      const keepMarks = bookmarks.filter(keep);
      const keepFolders = folders.filter(keep);
      const keepIds = new Set([...keepMarks, ...keepFolders].map((item) => item.id));
      if ([...data.bookmarks, ...data.folders].some((item) => keepIds.has(item.id))) invalid();
      const recent = { ...recentGroups };
      for (const key of Object.keys(recent)) {
        const [game, id = "default"] = key.split(":");
        if (inScope(game, scope) && (!destination || destination.id === id)) delete recent[key];
      }
      const order = { ...rootOrders };
      for (const game of games.filter((game) => inScope(game, scope))) {
        order[game] = destination ? rootOrderFor(game, keepMarks, keepFolders, rootOrders).concat(data.order[game]) : data.order[game];
      }
      const catalog = destination ? collections : [...collections.filter((c) => !inScope(c.game, scope)), ...data.collections];
      if (new Set(catalog.map((c) => c.id)).size !== catalog.length) invalid();
      const active = { ...activeCollections };
      for (const game of games) {
        if (inScope(game, scope) && !catalog.some((c) => c.game === game && c.id === active[game])) delete active[game];
        if (!destination && inScope(game, scope)) {
          delete defaults[game];
          if (Object.hasOwn(data.defaultCollections || {}, game)) defaults[game] = data.defaultCollections[game];
        }
      }
      await chrome.storage.local.set({
        bookmarks: [...keepMarks, ...data.bookmarks], bookmarkFolders: [...keepFolders, ...data.folders],
        bookmarkCollections: catalog, bookmarkActiveCollections: active, bookmarkRootOrder: order,
        bookmarkRecentGroups: recent, ...(!destination ? { bookmarkDefaultCollections: defaults } : {}),
      });
      return;
    }
    const ids = new Set([...bookmarks, ...folders].map((item) => item.id));
    const localFolder = new Map(folders.map((item) => [item.id, item]));
    const localMark = new Map(bookmarks.map((item) => [item.id, item]));
    const localCatalog = new Map(collections.map((item) => [item.id, item]));
    for (const c of data.collections) {
      if (localCatalog.has(c.id) && localCatalog.get(c.id).game !== c.game) invalid();
    }
    for (const folder of data.folders) {
      const existing = localFolder.get(folder.id);
      if (ids.has(folder.id) && (!existing || existing.game !== folder.game || collectionOf(existing) !== collectionOf(folder))) invalid();
    }
    for (const mark of data.bookmarks) {
      if (!ids.has(mark.id)) continue;
      const existing = localMark.get(mark.id);
      if (!existing || PTB.bookmarkGame(existing) !== mark.game || collectionOf(existing) !== collectionOf(mark) || existing.type !== mark.type ||
          existing.searchId !== mark.searchId || PTB.decodePathPart(existing.league) !== PTB.decodePathPart(mark.league)) invalid();
    }
    const order = { ...rootOrders };
    for (const game of games.filter((game) => inScope(game, scope))) {
      order[game] = rootOrderFor(game, bookmarks, folders, rootOrders)
        .concat(data.order[game].filter((id) => !ids.has(id)));
      if (!destination && !defaults[game]) {
        const hasDefaultItems = (items) => items.some((item) => PTB.bookmarkGame(item) === game && collectionOf(item) === "default");
        const name = data.defaultCollections?.[game];
        if (name && !hasDefaultItems([...bookmarks, ...folders])) defaults[game] = name;
        else if (defaults[game] === null && hasDefaultItems([...data.bookmarks, ...data.folders])) delete defaults[game];
      }
    }
    await chrome.storage.local.set({
      bookmarks: bookmarks.concat(data.bookmarks.filter((item) => !ids.has(item.id))),
      bookmarkFolders: folders.concat(data.folders.filter((item) => !ids.has(item.id))),
      bookmarkRootOrder: order,
      ...(!destination ? { bookmarkDefaultCollections: defaults } : {}),
      bookmarkCollections: collections.concat(data.collections.filter((c) => !localCatalog.has(c.id))),
      ...(mode === "new" ? { bookmarkActiveCollections: data.active } : {}),
    });
  };

  async function download(scope, collection, defaultName) {
    if (!isGame(scope) || !isId(collection)) invalid();
    const backup = await snapshot(scope, collection);
    const data = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(data);
    try {
      const sharedName = backup.collections.find((c) => c.id === backup.sharedCollection)?.name ||
        (backup.sharedCollection === "default" ? backup.defaultCollections?.[scope] || defaultName : "");
      const fileName = sharedName.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").slice(0, 60);
      const link = document.createElement("a");
      link.href = url;
      link.download = ["poe-trademark", backup.scope, fileName, new Date().toISOString().slice(0, 10)]
        .filter(Boolean).join("-") + ".json";
      link.click();
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }

  PTB.backup = { validate, selectScope, snapshot, sourceCollections, download,
    importFile: (file, mode, scope = "all", destination = null) => writeBookmarkChange("importBackup", file, mode, scope, destination) };
})();
