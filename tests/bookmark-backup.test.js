const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const vm = require("node:vm");

function library(initial) {
  const state = structuredClone(initial);
  let onMessage;
  const runtime = {
    onMessage: { addListener(fn) { onMessage = fn; } },
    sendMessage(msg) { return new Promise((resolve) => onMessage(msg, {}, resolve)); },
  };
  const local = {
    async get(keys) { return Object.fromEntries(keys.map((k) => [k, structuredClone(state[k])])); },
    async set(patch) { Object.assign(state, structuredClone(patch)); },
  };
  const ctx = vm.createContext({ chrome: { storage: { local }, runtime }, URL, crypto: require("node:crypto").webcrypto, TextEncoder });
  function load(relative) {
    vm.runInContext(readFileSync(join(__dirname, "../extension/src", relative), "utf8"), ctx);
  }
  ctx.importScripts = (...paths) => paths.forEach((p) => load(join("background", p)));
  load("background/sw.js");
  return { state, backup: ctx.PTB.backup };
}
const mark = (id, game, extra) => ({ id, game, type: "search", host: "poe.kakaogames.com", title: id,
  league: "리그 이름", searchId: "ABCD1", ...extra });
const original = {
  bookmarks: [mark("one", undefined), mark("two", "poe2", { folderId: "group", filters: ["test"], iconUrl: "https://web.poecdn.com/test.png" })],
  bookmarkFolders: [{ id: "group", game: "poe2", name: "Maps", collapsed: true }],
  bookmarkRootOrder: { poe1: ["one"], poe2: ["group"] },
};
test("collection JSON preserves new rarity and leaves legacy and unknown values uncolored", async () => {
  const db = library({ bookmarks: [mark("new", "poe1", { rarity: "unique", titleColor: "#36a8fa" }), mark("old", "poe1"),
    mark("bad", "poe1", { rarity: "constructor", titleColor: "transparent" })] });
  const file = await db.backup.snapshot("poe1", "default");
  const dest = library({});
  await dest.backup.importFile(file, "new", "poe1", { name: "Build" });
  assert.deepEqual(dest.state.bookmarks.map(b => b.rarity), ["unique", undefined, undefined]);
  assert.deepEqual(dest.state.bookmarks.map(b => b.titleColor), ["#36a8fa", undefined, undefined]);
});
test("portable backup round-trips both games, groups, order and labels across separate profiles", async () => {
  const source = library({ ...original, accountToken: "secret" });
  const file = JSON.parse(JSON.stringify(await source.backup.snapshot()));
  assert.doesNotMatch(JSON.stringify(file), /secret|accountToken/);
  const dest = library({ bookmarks: [mark("old", "poe2")], ptbLang: "ko" });
  await dest.backup.importFile(file, "replace");
  assert.deepEqual(JSON.parse(JSON.stringify(await dest.backup.snapshot())), file);
  assert.equal(dest.state.bookmarks[0].game, "poe1");
  assert.equal(dest.state.ptbLang, "ko");
  assert.equal(dest.state.bookmarkFolders[0].collapsed, true);
});
test("merge preserves local edits and repeated import is idempotent", async () => {
  const file = await library(original).backup.snapshot();
  const dest = library({ bookmarks: [mark("local", "poe2"), mark("one", "poe1", { title: "Local name", league: "Standard", searchId: "LocalizedId" })] });
  await dest.backup.importFile(file, "merge");
  await dest.backup.importFile(file, "merge");
  assert.equal(dest.state.bookmarks.length, 3);
  assert.equal(dest.state.bookmarks.find((b) => b.id === "one").title, "Local name");
  assert.equal(dest.state.bookmarks.find((b) => b.id === "one").league, "Standard");
  assert.equal(dest.state.bookmarks.find((b) => b.id === "one").searchId, "LocalizedId");
  assert.deepEqual(dest.state.bookmarkRootOrder.poe2, ["local", "group"]);
});
test("portable backup preserves long compressed search links and escaped base64 characters", async () => {
  const ids = ["H4sIA" + "A_bZ-9".repeat(160), "aA%2BbB%3D%3D", "aA+bB=="];
  const source = library({ bookmarks: ids.map((searchId, i) => mark("mark-" + i, "poe2", { searchId })) });
  const backup = JSON.parse(JSON.stringify(await source.backup.snapshot()));
  const dest = library({});
  await dest.backup.importFile(backup, "replace");
  assert.deepEqual(dest.state.bookmarks.map((item) => item.searchId), ids);
});
test("malformed backup cannot overwrite existing data", async () => {
  const dest = library(original);
  const before = structuredClone(dest.state);
  for (const tamper of [
    (f) => { f.version = 99; },
    (f) => { f.bookmarks[0].host = "evil.test"; },
    (f) => { f.bookmarks[0].folderId = "group"; },
    (f) => { f.bookmarks[0].searchId = "../settings"; },
    (f) => { f.bookmarks[0].searchId = "%2E%2E"; },
    (f) => { f.bookmarks[0].searchId = "token?other"; },
    (f) => { f.bookmarks[0].searchId = "token%2fother"; },
    (f) => { f.bookmarks[0].searchId = "token#other"; },
    (f) => { f.bookmarks[0].league = "%2E%2E"; },
    (f) => { f.order.poe1 = []; },
    (f) => {
      f.defaultCollections = { poe1: null };
    },
  ]) {
    const file = await dest.backup.snapshot();
    tamper(file);
    await assert.rejects(dest.backup.importFile(file, "replace"));
    assert.deepEqual(dest.state, before);
  }
});

test("a game with zero collections can be read without recreating its default", async () => {
  const source = library({ bookmarkDefaultCollections: { poe1: null } });
  const data = await source.backup.snapshot();
  assert.equal(data.defaultCollections.poe1, null);
  assert.deepEqual(Array.from(source.backup.sourceCollections(data), c => c.game), ["poe2"]);
});

test("selected-game replace retains the other game's data, order, and recent group", async () => {
  const dest = library({ ...original, bookmarkRecentGroups: { poe1: "old1", poe2: "group" } });
  const source = library({ bookmarks: [mark("fresh1", "poe1"), mark("fresh2", "poe2")] });
  const file = await source.backup.snapshot("poe1");
  assert.equal(file.scope, "poe1");
  assert.deepEqual(Array.from(file.bookmarks, (item) => item.id), ["fresh1"]);
  await dest.backup.importFile(file, "replace", "poe1");
  assert.deepEqual(dest.state.bookmarks.map((item) => item.id), ["two", "fresh1"]);
  assert.deepEqual(dest.state.bookmarks[0], original.bookmarks[1]);
  assert.deepEqual(dest.state.bookmarkFolders, original.bookmarkFolders);
  assert.deepEqual(dest.state.bookmarkRootOrder, { poe1: ["fresh1"], poe2: ["group"] });
  assert.deepEqual(dest.state.bookmarkRecentGroups, { poe2: "group" });
});

test("reject mismatched single-game files and conflicting cross-game IDs before writing", async () => {
  const dest = library(original);
  const before = structuredClone(dest.state);
  const file = await library({ bookmarks: [mark("two", "poe1")] }).backup.snapshot("poe1");
  for (const mode of ["merge", "replace"]) {
    for (const scope of ["all", "poe1", "poe2"]) {
      await assert.rejects(dest.backup.importFile(file, mode, scope));
      assert.deepEqual(dest.state, before);
    }
  }
});

test("an original v1 full backup can restore just one game into an empty profile", async () => {
  const file = await library(original).backup.snapshot();
  delete file.scope;
  delete file.collections;
  delete file.sharedCollection;
  file.version = 1;
  const dest = library({});
  await dest.backup.importFile(file, "merge", "poe2");
  assert.deepEqual(dest.state.bookmarks.map((item) => item.id), ["two"]);
  assert.deepEqual(dest.state.bookmarkRootOrder, { poe2: ["group"] });
});

const withLists = {
  ...original,
  bookmarkCollections: [{ id: "atlas", game: "poe2", name: "Atlas supplies" }],
  bookmarkActiveCollections: { poe2: "atlas" },
  bookmarks: [...original.bookmarks, mark("map", "poe2", { collectionId: "atlas", folderId: "boss" })],
  bookmarkFolders: [...original.bookmarkFolders, { id: "boss", game: "poe2", collectionId: "atlas", name: "Bossing" }],
  bookmarkRootOrder: { poe1: ["one"], poe2: ["boss", "group"] },
};
test("single collection export and new import create independent grouped copies", async () => {
  const dest = library(withLists);
  const file = await dest.backup.snapshot("poe2", "atlas");
  assert.equal(file.sharedCollection, "atlas");
  assert.deepEqual(Array.from(file.bookmarks, (item) => item.id), ["map"]);
  assert.deepEqual(Array.from(file.order.poe2), ["boss"]);
  await dest.backup.importFile(file, "new", "poe2", { name: "My copy" });
  const clone = dest.state.bookmarkActiveCollections.poe2;
  assert.notEqual(clone, "atlas");
  assert.equal(dest.state.bookmarkCollections.find((c) => c.id === clone).name, "My copy");
  const [group] = dest.state.bookmarkFolders.filter((f) => f.collectionId === clone);
  const [mark] = dest.state.bookmarks.filter((b) => b.collectionId === clone);
  assert.notEqual(mark.id, "map");
  assert.notEqual(group.id, "boss");
  assert.equal(mark.folderId, group.id);
  assert.deepEqual(dest.state.bookmarkRootOrder.poe2, ["boss", "group", group.id]);
});

test("targeted merge remaps collisions idempotently, replace preserves all other collections", async () => {
  const dest = library(withLists);
  const file = await dest.backup.snapshot("poe2", "atlas");
  const target = { id: "default" };
  await dest.backup.importFile(file, "merge", "poe2", target);
  await dest.backup.importFile(file, "merge", "poe2", target);
  assert.equal(dest.state.bookmarks.length, 4);
  await dest.backup.importFile(file, "replace", "poe2", target);
  assert.deepEqual(dest.state.bookmarks.filter((b) => b.collectionId === "atlas"), withLists.bookmarks.slice(-1));
  assert.equal(dest.state.bookmarks.length, 3);
  const imported = dest.state.bookmarks.find((b) => b.collectionId === "default");
  const importedGroup = dest.state.bookmarkFolders.find((f) => f.collectionId === "default");
  assert.equal(imported.folderId, importedGroup.id);
  assert.notEqual(imported.id, "map");
  assert.equal(dest.state.bookmarkCollections.length, 1);
});

test("multi-collection full backup retains separate libraries and empty custom lists", async () => {
  const source = library({ ...withLists, bookmarkCollections: [...withLists.bookmarkCollections,
    { id: "empty", game: "poe1", name: "Empty" }] });
  const file = await source.backup.snapshot();
  const dest = library({});
  await dest.backup.importFile(file, "replace");
  assert.deepEqual(JSON.parse(JSON.stringify(await dest.backup.snapshot())), JSON.parse(JSON.stringify(file)));
  await assert.rejects(dest.backup.importFile(file, "replace", "poe2", { id: "atlas" }));
  await dest.backup.importFile(file, "new", "all", { name: "Shared" });
  assert.equal(dest.state.bookmarkCollections.length, 6);
  const ids = new Set(dest.state.bookmarks.map((item) => item.id));
  assert.equal(ids.size, 6);
});

test("merging an updated share into its imported copy keeps edits and appends new entries once", async () => {
  const source = library(withLists);
  const shared = await source.backup.snapshot("poe2", "atlas");
  const dest = library({});
  await dest.backup.importFile(shared, "new", "poe2", { name: "Shared drops" });
  const id = dest.state.bookmarkActiveCollections.poe2;
  dest.state.bookmarks[0].title = "My edited title";
  dest.state.bookmarkFolders[0].name = "My group name";
  source.state.bookmarks.push(mark("more", "poe2", { collectionId: "atlas", folderId: "boss" }));
  const updated = await source.backup.snapshot("poe2", "atlas");
  await dest.backup.importFile(updated, "merge", "poe2", { id });
  await dest.backup.importFile(updated, "merge", "poe2", { id });
  assert.deepEqual(dest.state.bookmarks.map((item) => item.title), ["My edited title", "more"]);
  assert.equal(dest.state.bookmarkFolders.length, 1);
  assert.equal(dest.state.bookmarkFolders[0].name, "My group name");
  assert.equal(dest.state.bookmarks[1].folderId, dest.state.bookmarkFolders[0].id);
  const ownExport = await dest.backup.snapshot("poe2", id);
  await dest.backup.importFile(ownExport, "merge", "poe2", { id });
  assert.equal(dest.state.bookmarks.length, 2);
});

test("backups round-trip renamed and removed defaults and keep metadata inside the selected scope", async () => {
  const defaults = { poe1: "My league", poe2: null };
  const db = library({ bookmarkDefaultCollections: defaults, bookmarkCollections: [{ id: "atlas", name: "Atlas", game: "poe2" }] });
  const full = await db.backup.snapshot();
  assert.deepEqual({ ...full.defaultCollections }, defaults);
  assert.deepEqual(Array.from(db.backup.sourceCollections(full), (entry) => entry.name), ["My league", "Atlas"]);
  assert.deepEqual({ ...db.backup.selectScope(full, "poe1").defaultCollections }, { poe1: "My league" });
  assert.equal((await db.backup.snapshot("poe2", "atlas")).defaultCollections, undefined);
  await assert.rejects(db.backup.snapshot("poe2", "default"));
  const copy = library({});
  await copy.backup.importFile(full, "replace");
  assert.deepEqual(copy.state.bookmarkDefaultCollections, defaults);
  const share = await db.backup.snapshot("poe1", "default");
  assert.equal(db.backup.sourceCollections(share)[0].name, "My league");
  const atlas = await db.backup.snapshot("poe2", "atlas");
  for (const mode of ["merge", "replace"]) {
    await assert.rejects(db.backup.importFile(atlas, mode, "poe2", { id: "default" }));
  }
  const legacy = await library({}).backup.snapshot("poe1");
  assert.equal(legacy.defaultCollections, undefined);
  await copy.backup.importFile(legacy, "replace", "poe1");
  assert.deepEqual(copy.state.bookmarkDefaultCollections, { poe2: null });
});

test("whole-game merge preserves local names and restores a missing default for imported records", async () => {
  const source = library({ bookmarks: [mark("saved", "poe1")], bookmarkDefaultCollections: { poe1: "Incoming" } });
  const file = await source.backup.snapshot("poe1");
  const db = library({ bookmarkDefaultCollections: { poe1: null } });
  await db.backup.importFile(file, "merge", "poe1");
  assert.equal(db.state.bookmarkDefaultCollections.poe1, "Incoming");
  db.state.bookmarkDefaultCollections.poe1 = "Local";
  await db.backup.importFile(file, "merge", "poe1");
  assert.equal(db.state.bookmarkDefaultCollections.poe1, "Local");
  const invalid = { ...file, defaultCollections: { poe1: null } };
  await assert.rejects(db.backup.importFile(invalid, "replace", "poe1"));
});
