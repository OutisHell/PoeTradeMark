const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
require("../extension/src/common/url.js");
require("../extension/src/common/storage.js");

beforeEach(() => {
  const saved = { bookmarks: [{ id: "old", title: "Map" }, { id: "two", game: "poe2", title: "Map" }] };
  global.chrome = {
    storage: { local: {
      async get(keys) { return Object.fromEntries(keys.map((key) => [key, structuredClone(saved[key])])); },
      async set(patch) { Object.assign(saved, structuredClone(patch)); },
    } },
    runtime: {
      async sendMessage({ action, args }) {
        const result = await PTB.bookmarkChanges[action](...args);
        return { ok: true, result };
      },
    },
  };
});

test("selects new collections and displays each game's active collection away from trade", async () => {
  const list = await PTB.collections.add("poe1", "  Maps  ");
  assert.equal(list.name, "Maps");
  const empty = await PTB.storage.listView("poe1");
  assert.equal(empty.collectionId, list.id);
  assert.deepEqual(empty.bookmarks, []);
  const map = await PTB.storage.add({ title: "Map", game: "poe1", host: "www.pathofexile.com" });
  assert.equal(map.title, "Map");
  assert.equal(map.collectionId, list.id);
  assert.deepEqual((await PTB.storage.list(null)).map((item) => item.id), [map.id, "two"]);
  await PTB.collections.rename("poe1", list.id, "League");
  assert.equal((await PTB.storage.listView("poe1")).collections[0].name, "League");
  await assert.rejects(PTB.collections.select("poe2", list.id));
  await PTB.collections.rename("poe1", "default", "Original maps");
  await PTB.collections.select("poe1", "default");
  assert.equal((await PTB.storage.listView("poe1")).defaultCollection.name, "Original maps");
  assert.deepEqual((await PTB.storage.listView("poe1")).rootOrder, ["old"]);
  assert.deepEqual((await PTB.storage.list(null)).map((item) => item.id), ["old", "two"]);
});

test("deleting the starting collection removes only its game data and keeps subsequent saves reachable", async () => {
  const group = await PTB.folders.group("old", null, "Old group");
  const other = await PTB.collections.add("poe1", "Build");
  const item = await PTB.storage.add({ game: "poe1", title: "Boots" });
  await PTB.collections.select("poe1", "default");
  await PTB.collections.remove("poe1", "default");
  const view = await PTB.storage.listView("poe1");
  assert.equal(view.defaultCollection, null);
  assert.equal(view.collectionId, other.id);
  assert.deepEqual(view.rootOrder, [item.id]);
  assert.deepEqual((await PTB.storage.list("poe2")).map((b) => b.id), ["two"]);
  await assert.rejects(PTB.collections.select("poe1", "default"));
  await assert.rejects(PTB.collections.move("poe1", item.id, "default"));
  await assert.rejects(PTB.collections.rename("poe1", "default", "Restored"));
  const saved = await chrome.storage.local.get(["bookmarks", "bookmarkFolders", "bookmarkRecentGroups"]);
  assert.ok(!saved.bookmarks.some((b) => b.id === "old"));
  assert.ok(!saved.bookmarkFolders.some((f) => f.id === group.id));
  assert.equal(saved.bookmarkRecentGroups.poe1, undefined);
  await PTB.collections.remove("poe1", other.id);
  const fresh = await PTB.storage.listView("poe1");
  assert.equal(await PTB.storage.hasCollection("poe1"), false);
  assert.equal(await PTB.storage.hasCollection("poe2"), true);
  assert.equal(fresh.defaultCollection, null);
  assert.equal(fresh.collectionId, null);
  assert.deepEqual(fresh.bookmarks, []);
  await assert.rejects(PTB.storage.add({ game: "poe1", title: "No collection" }));
  await assert.rejects(PTB.folders.add("poe1", "No collection"));
  assert.equal((await PTB.storage.listView("poe2")).collectionId, "default");
  const created = await PTB.collections.add("poe1", "New build");
  assert.equal(await PTB.storage.hasCollection("poe1"), true);
  const next = await PTB.storage.add({ game: "poe1", title: "First" });
  assert.equal(next.collectionId, created.id);
  assert.equal((await PTB.storage.listView("poe1")).defaultCollection, null);
  assert.deepEqual((await PTB.storage.listView("poe1")).rootOrder, [next.id]);
});

test("groups, recent destinations and root order stay inside each collection", async () => {
  const legacyGroup = await PTB.folders.add("poe1", "Group");
  const list = await PTB.collections.add("poe1", "Build");
  const item = await PTB.storage.add({ title: "New", game: "poe1", host: "www.pathofexile.com" });
  await assert.rejects(PTB.folders.group(item.id, "old", "Cross"));
  await assert.rejects(PTB.storage.move(item.id, legacyGroup.id));
  const group = await PTB.folders.group(item.id, null, "Group");
  assert.equal(group.name, "Group");
  assert.equal(group.collectionId, list.id);
  assert.equal((await PTB.storage.listView("poe1")).recentGroupId, group.id);
  await PTB.storage.placeRoot("poe1", item.id, legacyGroup.id, true);
  assert.equal((await PTB.storage.list("poe1"))[0].folderId, group.id);
  await PTB.storage.placeRoot("poe1", item.id, group.id, true);
  await PTB.collections.select("poe1", "default");
  const initial = await PTB.storage.listView("poe1");
  assert.equal(initial.recentGroupId, legacyGroup.id);
  assert.deepEqual(initial.rootOrder, ["old", legacyGroup.id]);
  await PTB.storage.placeRoot("poe1", "old", legacyGroup.id, true);
  await PTB.collections.select("poe1", list.id);
  assert.deepEqual((await PTB.storage.listView("poe1")).rootOrder, [group.id, item.id]);
});
