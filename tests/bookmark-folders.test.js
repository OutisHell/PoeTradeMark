const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { randomUUID } = require("node:crypto");
const vm = require("node:vm");

function extension() {
  const saved = { bookmarks: [{ id: "legacy", title: "Old" }, { id: "two", game: "poe2" }] };
  const local = {
    async get(keys) {
      return Object.fromEntries([keys].flat().map((key) => [key, structuredClone(saved[key])]));
    },
    async set(patch) {
      Object.assign(saved, structuredClone(patch));
    },
  };
  let handler;
  const runtime = {
    getURL: (path) => path,
    onMessage: { addListener(fn) { handler = fn; } },
    sendMessage(msg) {
      return new Promise((resolve) => {
        if (!handler(structuredClone(msg), {}, resolve)) resolve(undefined);
      });
    },
  };
  function context() {
    return vm.createContext({ chrome: { storage: { local }, runtime }, crypto: { randomUUID }, URL,
      Blob, Response, CompressionStream, DecompressionStream, atob, btoa,
      fetch: async path => ({ ok: true, json: async () => JSON.parse(readFileSync(join(__dirname, "../extension", path), "utf8")) }),
    });
  }
  function load(ctx, path) {
    vm.runInContext(readFileSync(join(__dirname, "../extension/src", path), "utf8"), ctx);
  }
  const worker = context();
  worker.importScripts = (...paths) => paths.forEach((path) => load(worker, join("background", path)));
  load(worker, "background/sw.js");
  function client() {
    const ctx = context();
    load(ctx, "common/url.js");
    load(ctx, "common/storage.js");
    return ctx.PTB;
  }
  return [client(), client()];
}

test("transferring a group keeps its members together and deleting its collection only removes that collection", async () => {
  const [ptb] = extension();
  const kept = await ptb.storage.add({ game: "poe1", title: "Keep", realm: "en" });
  const group = await ptb.folders.group("legacy", null, "Maps");
  const target = await ptb.collections.add("poe1", "Shared");
  const wrongGame = await ptb.collections.add("poe2", "Other");
  await assert.rejects(ptb.collections.move("poe1", group.id, wrongGame.id));
  await ptb.collections.move("poe1", group.id, target.id);
  let view = await ptb.storage.listView("poe1");
  assert.deepEqual(Array.from(view.rootOrder), [group.id]);
  assert.equal(view.bookmarks[0].folderId, group.id);
  await ptb.collections.move("poe1", "legacy", "default");
  await assert.rejects(ptb.collections.remove("poe1", wrongGame.id));
  await ptb.collections.remove("poe1", target.id);
  view = await ptb.storage.listView("poe1");
  assert.equal(view.collectionId, "default");
  assert.equal(view.folders.length, 0);
  assert.deepEqual(Array.from(view.rootOrder), [kept.id, "legacy"]);
  assert.equal(view.bookmarks.find((b) => b.id === "legacy").folderId, null);
  assert.equal((await ptb.storage.listView("poe2")).collectionId, wrongGame.id);
});

test("folders stay in their game and reject cross-game moves", async () => {
  const [ptb] = extension();
  const folder = await ptb.folders.add("poe2", " Maps ");
  assert.equal((await ptb.folders.list("poe1")).length, 0);
  assert.equal((await ptb.folders.list("poe2"))[0].name, "Maps");
  await assert.rejects(ptb.storage.move("legacy", folder.id));
  assert.equal((await ptb.storage.list("poe1"))[0].folderId, undefined);
});

test("bulk groups include members from multiple groups and validate the entire selection before moving", async () => {
  const [ptb] = extension();
  const added = await ptb.storage.add({game:"poe1", title:"A"});
  const source = await ptb.folders.group("legacy", null, "Source");
  const ids = ["legacy", added.id];
  const edit = (selected, op) => ptb.storage.editSelected("poe1", "default", selected, op);
  await assert.rejects(edit([...ids, "two"], {kind:"group", name:"Wrong game"}));
  await edit(ids, {kind:"group", name:"Together"});
  let view = await ptb.storage.listView("poe1");
  const target = view.folders.find(f => f.name === "Together");
  assert.equal(view.folders.length, 2);
  assert.ok(view.bookmarks.every(b => b.folderId === target.id));
  assert.equal(view.recentGroupId, target.id);
  await edit(ids, {kind:"move", folderId:source.id});
  assert.ok((await ptb.storage.list("poe1")).every(b => b.folderId === source.id));
  await edit(ids, {kind:"move", folderId:null});
  view = await ptb.storage.listView("poe1");
  assert.ok(view.bookmarks.every(b => !b.folderId && view.rootOrder.includes(b.id)));
  await ptb.collections.add("poe1", "Other");
  await assert.rejects(edit(ids, {kind:"move", folderId:target.id}));
});

test("bulk location edits change only requested URL fields and preserve the recorded minimum", async () => {
  const [ptb] = extension();
  const lowPrice = { amount: 7, currency: "chaos", at: 123 };
  const base = {game:"poe2", league:"Standard", host:"www.pathofexile.com", realm:"en", searchId:"abc", lowPrice};
  const marks = [await ptb.storage.add({...base, type:"search", title:"A"}), await ptb.storage.add({...base, type:"exchange", title:"B"})];
  const ids = marks.map(b => b.id);
  for (const [patch, host, league] of [
    [{region:"kr"}, "poe.kakaogames.com", "Standard"],
    [{league:"Other League"}, "poe.kakaogames.com", "Other League"],
    [{region:"de", league:"Standard"}, "de.pathofexile.com", "Standard"],
  ]) {
    await ptb.storage.editSelected("poe2", "default", ids, {kind:"location", ...patch});
    for (const b of (await ptb.storage.list("poe2")).filter(b => ids.includes(b.id))) {
      assert.equal(ptb.buildTradeUrl(b), "https://" + host + "/trade2/" + b.type + "/poe2/" + encodeURIComponent(league) + "/abc");
      assert.equal(b.realm, ptb.hostToRealm(host));
      assert.deepEqual({...b.lowPrice}, lowPrice);
    }
  }
  await assert.rejects(ptb.storage.editSelected("poe2", "default", ids, {kind:"location", league:"../bad"}));
});

test("changing trade site translates compressed searches and rolls back a batch containing an unknown name", async () => {
  const [ptb] = extension();
  const encode = name => require("node:zlib").gzipSync(JSON.stringify({name, stats:[]})).toString("base64url");
  const record = {game:"poe1", host:"www.pathofexile.com", realm:"en", type:"search", league:"Standard"};
  const unknown = await ptb.storage.add({...record, searchId:encode("Unknown catalog entry"), title:"Other"});
  const known = await ptb.storage.add({...record, searchId:encode("Rigwald's Command"), title:"My search"});
  const change = ids => ptb.storage.editSelected("poe1", "default", ids, {kind:"location", region:"kr"});
  await assert.rejects(change([known.id, unknown.id]));
  const findKnown = async () => (await ptb.storage.list("poe1")).find(b => b.id === known.id);
  assert.equal((await findKnown()).host, record.host);
  assert.equal((await findKnown()).searchId, known.searchId);
  await change([known.id]);
  const moved = await findKnown();
  assert.equal(moved.host, "poe.kakaogames.com");
  assert.equal(moved.title, "My search");
  assert.equal((await ptb.unpackTradeQuery(moved.searchId)).name, "리그월드의 명령");
});

test("folder state survives reload and deletion returns its bookmarks to unfiled", async () => {
  const [popup, sidebar] = extension();
  const folder = await popup.folders.add("poe2", "Maps");
  await sidebar.storage.move("two", folder.id);
  assert.equal((await popup.storage.list("poe2"))[0].folderId, folder.id);
  await popup.folders.update(folder.id, { name: "Endgame", collapsed: true });
  const updated = (await sidebar.folders.list("poe2"))[0];
  assert.equal(updated.name, "Endgame");
  assert.equal(updated.collapsed, true);
  await sidebar.folders.remove(folder.id);
  assert.equal((await popup.folders.list("poe2")).length, 0);
  assert.equal((await popup.storage.list("poe2"))[0].folderId, null);
  await assert.rejects(sidebar.storage.move("two", folder.id));
});

test("moves and price updates from different extension pages are both saved", async () => {
  const [popup, sidebar] = extension();
  const folder = await popup.folders.add("poe2", "Maps");
  await Promise.all([
    popup.storage.move("two", folder.id),
    sidebar.storage.update("two", { lowPrice: { amount: 2, currency: "divine" } }),
  ]);
  const [bookmark] = await popup.storage.list("poe2");
  assert.equal(bookmark.folderId, folder.id);
  assert.equal(bookmark.lowPrice.amount, 2);
  await sidebar.storage.move("two", null);
  assert.equal((await popup.storage.list("poe2"))[0].folderId, null);
});

test("reordering only moves bookmarks in the specified folder", async () => {
  const [ptb] = extension();
  const folder = await ptb.folders.add("poe1", "Maps");
  const first = await ptb.storage.add({ game: "poe1", title: "First", realm: "en" });
  const second = await ptb.storage.add({ game: "poe1", title: "Second", realm: "en" });
  await ptb.storage.move(first.id, folder.id);
  await ptb.storage.move(second.id, folder.id);
  await ptb.storage.reorder("poe1", ["legacy", first.id, second.id], folder.id);
  assert.deepEqual(Array.from(await ptb.storage.list("poe1"), (item) => item.id), [first.id, second.id, "legacy"]);
});

test("overlapping bookmarks creates one group at the target's place in the list", async () => {
  const [ptb] = extension();
  const source = await ptb.storage.add({ game: "poe1", title: "Source", realm: "en" });
  const standalone = await ptb.storage.add({ game: "poe1", title: "Standalone", realm: "en" });
  const group = await ptb.folders.group("legacy", source.id, "Maps");
  const view = await ptb.storage.listView("poe1");
  assert.deepEqual(Array.from(view.rootOrder), [standalone.id, group.id]);
  assert.deepEqual(Array.from(view.bookmarks.filter((bookmark) => bookmark.folderId === group.id), (bookmark) => bookmark.id), [source.id, "legacy"]);
  await assert.rejects(ptb.folders.group(standalone.id, "two", "Wrong game"));
  assert.equal((await ptb.folders.list("poe1")).length, 1);
});

test("context grouping and root placement interleave groups and standalone bookmarks", async () => {
  const [popup, sidebar] = extension();
  const first = await popup.storage.add({ game: "poe1", title: "First", realm: "en" });
  const group = await popup.folders.group(first.id, null, "Maps");
  await sidebar.storage.placeRoot("poe1", group.id, "legacy", true);
  assert.deepEqual(Array.from((await popup.storage.listView("poe1")).rootOrder), ["legacy", group.id]);
  await sidebar.storage.placeRoot("poe1", first.id, group.id, true);
  assert.deepEqual(Array.from((await popup.storage.listView("poe1")).rootOrder), ["legacy", group.id, first.id]);
  await popup.storage.move(first.id, group.id);
  await popup.folders.remove(group.id);
  assert.deepEqual(Array.from((await popup.storage.listView("poe1")).rootOrder), ["legacy", first.id]);
});

test("recent destination follows grouping and moves per game across popup and sidebar", async () => {
  const [popup, sidebar] = extension();
  assert.equal((await sidebar.storage.listView("poe1")).recentGroupId, null);
  const first = await popup.folders.add("poe1", "Maps");
  const otherGame = await sidebar.folders.group("two", null, "Gear");
  const second = await sidebar.folders.group("legacy", null, "Rings");
  assert.equal((await popup.storage.listView("poe1")).recentGroupId, second.id);
  await sidebar.storage.move("legacy", first.id);
  assert.equal((await popup.storage.listView("poe1")).recentGroupId, first.id);
  await assert.rejects(popup.storage.move("legacy", otherGame.id));
  await popup.storage.move("legacy", null);
  await sidebar.folders.remove(second.id);
  assert.equal((await popup.storage.listView("poe1")).recentGroupId, first.id);
  await popup.folders.remove(first.id);
  assert.equal((await sidebar.storage.listView("poe1")).recentGroupId, null);
  assert.equal((await popup.storage.listView("poe2")).recentGroupId, otherGame.id);
});
