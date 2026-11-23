// Only the worker mutates history, in the same write queue as collection changes.
(() => {
  const keys = { poe1: "ptbRecentPoe1", poe2: "ptbRecentPoe2" };
  const week = 7 * 86400000;
  const maxBytes = 256 * 1024;
  function keyFor(game) {
    if (!Object.hasOwn(keys, game)) throw Error("Invalid game");
    return keys[game];
  }
  async function read(game) {
    const key = keyFor(game);
    const data = await chrome.storage.local.get([key, "ptbRecentEnabled"]);
    const stored = data[key] || [];
    const entries = stored.filter(e => e.at > Date.now() - week);
    return { key, entries, expired: entries.length !== stored.length, enabled: data.ptbRecentEnabled !== false };
  }
  async function list(game) {
    const { key, entries, expired, enabled } = await read(game);
    if (expired) await chrome.storage.local.set({ [key]: entries });
    return { enabled, entries };
  }
  PTB.recentSearches = {
    list,
    async prune() {
      for (const game of Object.keys(keys)) await list(game);
    },
    async record(bookmark, at) {
      if (!Number.isFinite(at) || at <= Date.now() - week || at > Date.now()) return;
      const { key, entries, enabled } = await read(bookmark.game);
      if (!enabled) return;
      const href = PTB.buildTradeUrl(bookmark);
      const previous = entries.find(e => PTB.buildTradeUrl(e.bookmark) === href);
      if (previous && previous.at >= at) return;
      const entry = { id: previous?.id || crypto.randomUUID(), at, bookmark };
      const bytes = value => new Blob([JSON.stringify(value)]).size;
      if (bytes([entry]) > maxBytes) return;
      const next = [entry, ...entries.filter(e => e !== previous)].sort((a, b) => b.at - a.at).slice(0, 30);
      let size = 2;
      const keep = [];
      for (const e of next) {
        size += bytes(e) + (keep.length ? 1 : 0);
        if (size > maxBytes) break;
        keep.push(e);
      }
      await chrome.storage.local.set({ [key]: keep });
    },
    async promote(game, id, href, at) {
      const { entries, key, enabled } = await read(game);
      if (!enabled) return null;
      const entry = entries.find(e => id ? e.id === id : e.at === at && PTB.buildTradeUrl(e.bookmark) === href);
      if (!entry) return null;
      return PTB.addBookmarkSnapshot(entry.bookmark, { [key]: entries.filter(e => e !== entry) });
    },
    clear(game) { return chrome.storage.local.set({ [keyFor(game)]: [] }); },
    setEnabled(enabled) {
      return chrome.storage.local.set(enabled === true ? { ptbRecentEnabled: true } :
        { ptbRecentEnabled: false, ptbRecentNoticeSeen: true, ptbRecentPoe1: [], ptbRecentPoe2: [] });
    },
  };
})();
