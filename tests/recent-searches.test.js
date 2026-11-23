const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
require("../extension/src/common/url.js");
require("../extension/src/common/storage.js");
require("../extension/src/background/recent-searches.js");
let saved;
beforeEach(() => {
  saved = {};
  global.chrome = { storage: { local: {
    get: async keys => Object.fromEntries([keys].flat().map(k => [k, structuredClone(saved[k])])),
    set: async patch => Object.assign(saved, structuredClone(patch)),
  } } };
});
const row = (id, game = "poe1") => ({ game, host: "www.pathofexile.com", league: "Standard", type: "search",
  searchId: id, title: "Search " + id, filters: ["Minimum 80"], lowPrice: { amount: 72, currency: "divine", at: 1 } });
const write = (item, at = Date.now()) => PTB.recentSearches.record(item, at);
test("recent searches are bounded per game by age, count and UTF-8 size", async () => {
  const now = Date.now();
  for (let i = 0; i < 33; i++) await write(row(String(i)), now - 1000 + i);
  await write(row("32"), now);
  await write(row("two", "poe2"));
  assert.equal(saved.ptbRecentPoe1.length, 30);
  assert.equal(saved.ptbRecentPoe1.at(-1).bookmark.searchId, "3");
  for (let i = 0; i < 24; i++) await write({ ...row("large"+i), filters: ["한".repeat(7000)] });
  assert.ok(Buffer.byteLength(JSON.stringify(saved.ptbRecentPoe1)) <= 256 * 1024);
  saved.ptbRecentPoe1[0].at = now - 8 * 86400000;
  await PTB.recentSearches.prune();
  assert.ok(saved.ptbRecentPoe1.every(entry => entry.at > now - 7 * 86400000));
  assert.equal(saved.ptbRecentPoe2.length, 1);
});
test("promotion moves the snapshot atomically and disabled recording drops future writes", async () => {
  const item = row("abc");
  await write(item);
  const entry = saved.ptbRecentPoe1[0];
  saved.bookmarkDefaultCollections = { poe1: null };
  await assert.rejects(PTB.recentSearches.promote("poe1", entry.id));
  assert.equal(saved.ptbRecentPoe1.length, 1);
  saved.bookmarkDefaultCollections = {};
  const bookmark = await PTB.recentSearches.promote("poe1", entry.id);
  assert.deepEqual(bookmark.lowPrice, item.lowPrice);
  assert.deepEqual(bookmark.filters, item.filters);
  assert.equal(saved.ptbRecentPoe1.length, 0);
  assert.equal(await PTB.recentSearches.promote("poe1", entry.id), null);
  await write(row("another"));
  await PTB.recentSearches.setEnabled(false);
  await write(row("ignored"));
  assert.deepEqual(saved.ptbRecentPoe1, []);
  assert.equal(saved.bookmarks.length, 1);
});
