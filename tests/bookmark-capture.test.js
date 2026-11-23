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
      listing: { account: "private", price: { amount: 73, currency: "divine" } } }] },
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
  target.dataset.request = JSON.stringify({ game: "trade", league: "Standard", query: "current", ids: ["a", "b", "c"] });
  onRead({ target });
  const { observedAt, ...sample } = JSON.parse(target.dataset.sample);
  assert.ok(Number.isFinite(observedAt));
  assert.deepEqual(sample, {
    query: "current", firstResult: true, total: 2, rows: ["unique", null, null], matched: [true, true, false], known: true, decoding: false,
    prices: [{ amount: 73, currency: "divine" }, null, null],
  });
  assert.equal(requests.length, 3);
});

test("an initial result fetch under an opaque API ID belongs to the revisited compressed URL until a new search starts", async () => {
  const token = "H4sIAAAAAAAACm3MQQrDIBRF0b28sRSNqSVupYRi4w8Ikoh-ocW695J2mvHl3IbCjmuBbdgTh32DRaGlZveMhC5-vcDeG_idCBZu8xBYQ2TK_xA8LOiVYlgCXw7wGEYjr9JILT9K69sIAR_K8fSwnCt1ceqUmqTW2gzTiVtdLNTnPvcvEjf4crcAAAA";
  const location = new URL("https://poe.kakaogames.com/trade/search/Covens/" + token);
  let read;
  class Template { dataset = {}; }
  class Xhr {
    open() {} send() {}
    addEventListener(type, fn) { this.finish = fn; }
    respond(json) { this.status = 200; this.responseType = "json"; this.response = json; this.finish(); }
  }
  vm.runInNewContext(fs.readFileSync(require.resolve("../extension/src/content/listing-sample.js"), "utf8"), {
    location, URL, Event, window: {}, XMLHttpRequest: Xhr, HTMLTemplateElement: Template,
    document: { addEventListener: (_, fn) => { read = fn; }, dispatchEvent() {} },
  });
  const result = async (batch, id) => {
    const xhr = new Xhr();
    xhr.open("GET", "/api/trade/fetch/" + id + "?query=" + batch);
    xhr.send();
    xhr.respond({ result: [{ id, item: {}, listing: { price: { amount: 73, currency: "divine" } } }] });
    const target = new Template();
    target.dataset.request = JSON.stringify({ game: "trade", league: "Covens", query: token, ids: [id] });
    read({ target });
    return PTB.matchListingSample(JSON.parse(target.dataset.sample), token, await PTB.unpackTradeQuery(token));
  };
  assert.deepEqual((await result("opaque", "first"))?.prices, [{ amount: 73, currency: "divine" }]);
  const next = new Xhr();
  next.open("POST", "/api/trade/search/Covens");
  next.send();
  assert.equal(await result("different", "second"), null);
});

test("consecutive searches bind submitted filters and result IDs to the response, including out-of-order XHRs", () => {
  const listeners = {};
  let label = "Helmet stat";
  class Template {
    dataset = {};
    dispatchEvent() { this.dataset.labels = JSON.stringify({ labels: {}, statNames: [label] }); }
    remove() {}
  }
  class Xhr {
    open() {}
    send() {}
    addEventListener(_, callback) { this.finish = callback; }
    respond(id, result) {
      this.status = 200;
      this.responseType = "json";
      this.response = { id, result, total: result.length };
      this.finish();
    }
  }
  vm.runInNewContext(fs.readFileSync(require.resolve("../extension/src/content/listing-sample.js"), "utf8"), {
    window: {}, location: new URL("https://poe.kakaogames.com/trade/search/Covens/first"), URL, Event,
    document: { addEventListener: (name, cb) => { listeners[name] = cb; },
      createElement: () => new Template(), documentElement: { appendChild() {} } },
    XMLHttpRequest: Xhr, HTMLTemplateElement: Template,
  });
  const search = (type, stat) => {
    const xhr = new Xhr();
    xhr.open("POST", "/api/trade/search/Covens");
    xhr.send(JSON.stringify({ query: { type, stats: [{ type: "and", filters: [{ id: stat }] }] } }));
    return xhr;
  };
  const first = search("Helmet", "stat.a");
  label = "Belt stat";
  const second = search("Belt", "stat.b");
  second.respond("second", ["belt", "shared"]);
  first.respond("first", ["helmet", "shared"]);
  const target = new Template();
  target.dataset.request = JSON.stringify({ game: "trade", league: "Covens", query: "second",
    details: true, ids: ["helmet", "belt", "shared"] });
  listeners["ptb-read-listing-sample"]({ target });
  const sample = JSON.parse(target.dataset.sample);
  assert.deepEqual(sample.matched, [false, true, true]);
  assert.equal(sample.firstResult, false);
  assert.equal(sample.submitted.query.type, "Belt");
  const draft = { filters: [], statNames: ["Edited after search"], labels: sample.submitted.labels };
  assert.deepEqual(PTB.bookmarkSummary(sample.submitted.query, draft).filters, ["Belt stat"]);
  assert.deepEqual(PTB.bookmarkSummary(sample.submitted.query, { ...draft, labels: {} }).filters, ["stat.b"]);
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

test("the shared Covens link explicitly selects helmets without naming an item", async () => {
  const token = "H4sIAAAAAAAACo2R3W7DIAyF38XXqMq09WK8yjQhNziJJX4iMG2jiHefslRVuqrRuAGOOf4OMEMWlJJBzxBH4RhAQ6a2JDw5gqp-6xn01wwyjQQaMFhQ0LETSmuBLWgYMxUbD-tkJAo647gjUHBGV2gheA6g396bWtWOK1HmLBjaZ-_nS2so_kTJxM6QH2UyY6KOr8ZHm58T7PPbAWPepqjfy_nb9S_E_SD_fQFLV6HEMsEukoOQc9zTivsb-NjURbwT1zBms98sWxTqY5oevhSTjyUdBnKeBGqt6ia9aILpDv84NlUBnR-EZfwAqg_1bzwCAAA";
  const query = await PTB.unpackTradeQuery(token);
  const summary = PTB.bookmarkSummary(query, { title: "이전 검색", filters: [] }, PTB.tradeCategoryLabels.poe1.kr);
  assert.equal(query.filters.type_filters.filters.category.option, "armour.helmet");
  assert.equal(summary.title, "투구");
  assert.equal(summary.itemName, "");
  assert.ok(summary.filters.some(label => label.includes("130")));
  const fromApi = { query: "opaque", submitted: { query } };
  assert.equal(await PTB.matchListingSample(fromApi, token, query), fromApi);
  assert.equal(await PTB.matchListingSample(fromApi, token, { type: "Belt" }), null);
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
  assert.equal(PTB.bookmarkSummary({}, { filters: [] }, null,
    { rows: [null, rare, rare], matched: [false, true, true], total: 2 }).rarity, "rare");
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
  const summary = PTB.bookmarkSummary(query, { filters: [], labels: { [query.stats[0].filters[0].id]: "Stat filter" } }, {}, sample);
  assert.equal(summary.rarity, "unique");
  assert.equal(summary.title, "Stat filter");
  assert.equal(summary.itemName, "");
  assert.equal(await PTB.matchListingSample(received, linkId, { name: "Other" }), null);
  assert.equal(await PTB.matchListingSample(received, "opaque", null), null);
});
