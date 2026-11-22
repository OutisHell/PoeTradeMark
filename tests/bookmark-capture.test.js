const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
require("../extension/src/common/url.js");
require("../extension/src/common/storage.js");
require("../extension/src/common/rates.js");
require("../extension/src/common/bookmark-summary.js");
require("../extension/src/assets/trade-categories.js");

test("saving reads already received listings for this search without issuing another request", async () => {
  const requests = [];
  const responses = [
    { id: "current", total: 2, result: ["a", "b"] },
    { result: [{ id: "a", item: { baseType: "Leather Belt", name: "Headhunter", frameType: 3 },
      listing: { account: "private" } }] },
    { result: [{ id: "c", item: { baseType: "Bow", frameType: 2 } }] },
  ];
  let originalPromise;
  const window = { fetch(url) {
    requests.push(url);
    const data = responses.shift();
    originalPromise = Promise.resolve({ ok: true, clone: () => ({ json: async () => data }) });
    return originalPromise;
  } };
  class Template { dataset = {}; }
  let onRead;
  vm.runInNewContext(fs.readFileSync(require.resolve("../extension/src/content/listing-sample.js"), "utf8"), {
    window, location: new URL("https://www.pathofexile.com/trade/search/Standard/current"), URL,
    document: { addEventListener: (_, callback) => { onRead = callback; } },
    XMLHttpRequest: class {}, HTMLTemplateElement: Template,
  });
  for (const path of ["search/Standard", "fetch/a?query=current", "fetch/c?query=previous"]) {
    const pending = window.fetch("/api/trade/" + path);
    assert.equal(pending, originalPromise);
    await pending;
  }
  await new Promise(resolve => setImmediate(resolve));
  const target = new Template();
  target.dataset.request = JSON.stringify({ game: "trade", query: "current", ids: ["a", "b", "c"] });
  onRead({ target });
  assert.deepEqual(JSON.parse(target.dataset.sample), {
    query: "current", total: 2, rows: ["unique", null, null],
  });
  assert.equal(requests.length, 3);
});

test("only a named search or a single selected rarity colors a new bookmark", () => {
  const form = { title: "성좌의 가죽 갑옷", filters: [], rarity: "rare" };
  const query = { type: "성좌의 가죽 갑옷" };
  const rarity = (q) => PTB.bookmarkSummary(q, form).rarity;
  assert.equal(rarity({ ...query, name: "하이리의 노여움" }), "unique");
  assert.equal(rarity(query), undefined);
  for (const option of ["normal", "magic", "rare", "unique", "uniquefoil", "nonunique", "any"]) {
    const type_filters = { filters: { rarity: { option } } };
    assert.equal(rarity({ ...query, filters: { type_filters } }),
      ["nonunique", "any"].includes(option) ? undefined : option);
    assert.equal(rarity({ ...query, filters: { type_filters: { ...type_filters, disabled: true } } }), undefined);
  }
  assert.equal(rarity({ ...query, name: { option: "하이리의 노여움" },
    filters: { type_filters: { filters: { rarity: { option: "uniquefoil" } } } } }), "uniquefoil");
  assert.equal(rarity(null), "rare");
});

test("category titles and chips use the executed category's localized trade label", () => {
  const category = { option: "weapon.twomelee" };
  const query = { filters: { type_filters: { filters: { category } } } };
  const form = { category: "활", filters: [] };
  const labels = PTB.tradeCategoryLabels.poe1.kr;
  assert.equal(PTB.tradeCategoryLabels.poe2.kr["weapon.twomelee"], "임의의 양손 근접 무기");
  assert.equal(PTB.bookmarkSummary(query, form, labels).title, "양손 근접 무기");
  assert.deepEqual(PTB.bookmarkSummary({ ...query, name: "별의 탄생" }, form, labels).filters, ["양손 근접 무기"]);
  assert.equal(PTB.bookmarkSummary(null, form).title, "활");
  assert.doesNotMatch(PTB.bookmarkSummary(query, form).title, /weapon|twomelee|활/);
});

test("a completed query names the bookmark even with a blank or edited trade form", () => {
  const form = { title: "Unsubmitted", category: "", filters: [] };
  const query = { name: "Rigwald's Command", filters: {
    misc_filters: { filters: { ilvl: { min: 84 } } },
    trade_filters: { filters: { indexed: { option: "3days" } } },
  } };
  const summary = PTB.bookmarkSummary(query, form);
  assert.equal(summary.title, "Rigwald's Command");
  assert.ok(summary.filters.some(f => f.includes("84")));
  assert.ok(summary.filters.some(f => f.includes("3")));
  assert.equal(PTB.bookmarkSummary({ name: "Headhunter", type: { option: "Leather Belt" } }, form).title, "Headhunter Leather Belt");
  assert.match(PTB.bookmarkSummary({ filters: query.filters }, form).title, /84/);
  assert.equal(PTB.bookmarkSummary(null, form).title, "Unsubmitted");
});

test("mixed listing prices require a comparable rate, same-currency listings do not", () => {
  const p = (amount, currency) => ({ amount, currency });
  assert.deepEqual(PTB.rates.lowestListing([p(8, "divine"), p(4, "divine")], null), p(4, "divine"));
  const mixed = [p(1, "divine"), p(10, "chaos")];
  assert.equal(PTB.rates.lowestListing(mixed, null), null);
  assert.deepEqual(PTB.rates.lowestListing(mixed, { values: { chaos: 1, divine: 200 } }), p(10, "chaos"));
  assert.equal(PTB.rates.lowestListing([], null), null);
});

test("bookmark chips omit trade mode and rarity but keep other trade filters", () => {
  const q = { status: {option:"available"}, filters: {
    type_filters: {filters:{rarity:{option:"rare"}}}, trade_filters:{filters:{indexed:{option:"3days"}}},
  } };
  const s = PTB.bookmarkSummary(q, {filters:[]});
  assert.equal(s.rarity, "rare");
  assert.equal(s.filters.length, 1);
  assert.match(s.filters[0], /3 days/);
});

test("use loaded results for rarity only, keeping the explicit name or filter title", () => {
  const belt = "unique";
  const rare = "rare";
  const make = (rows, query = {}, total = 100) => PTB.bookmarkSummary(query, {filters:[]}, null, {rows,total});
  assert.equal(make([belt,belt,rare]).title, "(Untitled)");
  assert.equal(make([belt,belt,rare]).rarity, undefined);
  assert.equal(make([belt,belt,belt], {type:"Leather Belt"}).title, "Leather Belt");
  assert.equal(make([belt,belt,belt]).rarity, "unique");
  assert.equal(make([rare,rare,rare]).rarity, "rare");
  assert.equal(make([rare,rare,rare]).title, "(Untitled)");
  assert.equal(make([belt,rare,belt,rare]).title, "(Untitled)");
  assert.equal(make([belt,belt,null]).rarity, undefined);
  assert.equal(make([belt]).title, "(Untitled)");
  assert.equal(make([belt], {}, 1).rarity, "unique");
  assert.equal(make([belt,belt,"uniquefoil"]).rarity, "unique");
  assert.equal(make(["uniquefoil","uniquefoil","uniquefoil"]).rarity, "uniquefoil");
  assert.equal(make([belt,belt,null], {}, 2).title, "(Untitled)");
  assert.equal(make([belt,belt,belt], {name:"Explicit"}).title, "Explicit");
  assert.equal(make([rare,rare,rare], {type:"Ring"}).title, "Ring");
  assert.equal(make([rare,rare,rare], {filters:{type_filters:{filters:{rarity:{option:"nonunique"}}}}}).rarity, undefined);
});

test("the shared Korean stat search recognizes the equivalent ID returned by trade", async () => {
  const linkId = "H4sIAAAAAAAACiXLQQqAIBAF0Lv8dbSxouYqEWE5wYCU5AiFePeo1o-XEdVqiqCMI6gcOwiR13TaxTNK9XkEjRl6BwbB7g4VNvHK5w_iQOAreFlF6zfMZmjarm9NN6BMZSoP1bXfcGgAAAA";
  const responseId = "H4sIAAAAAAAAAyXLUQqAIBCE4bvMc_RiRXmViLDaYEFMdINCvHtWzNv_MQlRjJwROuHwwoeDRqT1DGaxhFx9XnhMkNtTUeM2VNjZCoUfeCuZLm95Zanfw6yGpu36VnUD8lT2ANW133BoAAAA";
  const received = { query: responseId, rows: Array(10).fill("unique"), total: 530 };
  const query = await PTB.unpackTradeQuery(linkId);
  const sample = await PTB.matchListingSample(received, linkId, query);
  const summary = PTB.bookmarkSummary(query, { filters: [], statNames: ["Stat filter"] }, {}, sample);
  assert.equal(summary.rarity, "unique");
  assert.equal(summary.title, "Stat filter");
  assert.equal(summary.itemName, "");
  assert.equal(await PTB.matchListingSample(received, linkId, { name: "Other" }), null);
  assert.equal(await PTB.matchListingSample(received, "opaque", null), null);
});
