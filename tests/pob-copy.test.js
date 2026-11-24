const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "../extension");
const asset = name => JSON.parse(fs.readFileSync(path.join(root, "src/assets", name), "utf8"));

function offlineWorker() {
  const external = [];
  const context = vm.createContext({ URL, PTB: {}, atob, TextDecoder, Uint8Array, AbortSignal, Response, DecompressionStream,
    chrome: { runtime: { getURL: name => "chrome-extension://test/" + name } },
    fetch: async url => {
      const resource = new URL(url);
      if (resource.protocol !== "chrome-extension:") { external.push(resource.href); return new Response(null, { status: 403 }); }
      return new Response(fs.readFileSync(path.join(root, resource.pathname.slice(1))));
    },
  });
  const imports = fs.readFileSync(path.join(root, "src/background/sw.js"), "utf8").split("\n")[0];
  for (const [, file] of imports.matchAll(/"([^"]+)"/g)) {
    if (!/pob-|trade-search|common\/url|common\/trade-region/.test(file)) continue;
    vm.runInContext(fs.readFileSync(path.join(root, "src/background", file), "utf8"), context);
  }
  return { PTB: context.PTB, external };
}

test("a German trade result copies in English even if every remote request returns 403", async () => {
  const { PTB, external } = offlineWorker();
  const raw = ["Gegenstandsklasse: Ringe", "Seltenheit: Normal", "Goldring", "--------",
    "Gegenstandsstufe: 84", "--------", "Fügt 3 bis 7 physischen Schaden hinzu", "--------", "+15% zu Feuer- und Kältewiderstand"].join("\n");
  const item = { name: "", baseType: "Goldring", typeLine: "Goldring", rarity: "Normal", ilvl: 84,
    nativeText: Buffer.from(raw).toString("base64"), mods: [
      { hash: "stat.explicit.stat_1940865751", description: "Fügt 3 bis 7 physischen Schaden hinzu" },
      { hash: "stat.implicit.stat_2915988346", description: "+15% zu Feuer- und Kältewiderstand" }] };
  const text = await PTB.pobItemText(item, "de.pathofexile.com", "poe1");
  assert.match(text, /Rarity: Normal\nGold Ring/);
  assert.match(text, /Item Level: 84/);
  assert.match(text, /Adds 3 to 7 Physical Damage/);
  assert.match(text, /\+15% to Fire and Cold Resistances \(implicit\)/);
  await assert.rejects(() => PTB.pobItemText(null, "de.pathofexile.com", "poe1"));
  assert.deepEqual(external, []);
});


test("captures the Korean ring from the already loaded result, including its exact mana roll", async () => {
  const ring = {
    name: "리그월드의 문양", baseType: "쌍보석 반지", ilvl: 80, frameType: 3,
    requirements: [{ name: "레벨", type: 62, values: [["20", 0]] }],
    implicitMods: [{ description: "화염 및 냉기 저항 +15%", hash: "stat.implicit.stat_2915988346" }],
    explicitMods: [
      { description: "처치 시 10레벨 영체 늑대 소환 발동", hash: "stat.explicit.stat_1468606528" },
      { description: "마나 재생 속도 25% 증가", hash: "stat.explicit.stat_789117908", mods: [{ magnitudes: [{ min: "20", max: "30" }] }] },
    ],
    extended: { hashes: { implicit: [["implicit.stat_2915988346", [0]]],
      explicit: [["explicit.stat_1468606528", [1]], ["explicit.stat_789117908", [0]]] } },
  };
  const document = new EventTarget();
  class Template extends EventTarget { dataset = {}; }
  const response = { result: [{ id: "ring", item: ring }] };
  const window = { fetch: async () => ({ ok: true, clone: () => ({ json: async () => response }) }) };
  vm.runInNewContext(fs.readFileSync(require.resolve("../extension/src/content/listing-sample.js"), "utf8"), {
    location: new URL("https://poe.kakaogames.com/trade/search/Covens/test"), URL, Event,
    window, XMLHttpRequest: class {}, HTMLTemplateElement: Template, document,
  });
  const collected = new Promise(resolve => document.addEventListener("ptb-listings-ready", resolve, { once: true }));
  await window.fetch("/api/trade/fetch/ring?query=test");
  await collected;
  function read(request) {
    const template = new Template();
    template.dataset.request = JSON.stringify({ game: "trade", league: "Covens", ...request });
    const event = new Event("ptb-read-pob-item");
    Object.defineProperty(event, "target", { value: template });
    document.dispatchEvent(event);
    return JSON.parse(template.dataset.result);
  }
  const snapshot = read({ id: "ring" });
  const { PTB, external } = offlineWorker();
  const text = await PTB.pobItemText(snapshot, "poe.kakaogames.com", "poe1");
  assert.match(text, /Rigwald's Crest\nTwo-Stone Ring/);
  assert.match(text, /Level: 20/);
  assert.match(text, /Item Level: 80/);
  assert.match(text, /\+15% to Fire and Cold Resistances/);
  assert.match(text, /Trigger Level 10 Summon Spectral Wolf on Kill/);
  assert.match(text, /25% increased Mana Regeneration Rate/);
  assert.deepEqual(external, []);
});

const markets = [
  ["en", "www.pathofexile.com", "Gold Ring", "Item Level"],
  ["kr", "poe.kakaogames.com", "황금 반지", "아이템 레벨"],
  ["de", "de.pathofexile.com", "Goldring", "Gegenstandsstufe"],
  ["fr", "fr.pathofexile.com", "Anneau en or", "Niveau de l'objet"],
  ["jp", "jp.pathofexile.com", "金の指輪", "アイテムレベル"],
  ["es", "es.pathofexile.com", "Anillo de oro", "Nivel de objeto"],
  ["br", "br.pathofexile.com", "Anel de Ouro", "Nível do Item"],
  ["ru", "ru.pathofexile.com", "Золотое кольцо", "Уровень предмета"],
  ["th", "th.pathofexile.com", "Gold Ring", "เลเวลไอเทม"],
  ["tw", "pathofexile.tw", "金光戒指", "物品等級"],
];
for (const game of ["poe1", "poe2"]) {
  test(game + " copies equipment from every trade language using packaged data only", async () => {
    const { PTB, external } = offlineWorker();
    const id = "implicit.stat_2915988346";
    for (const [region, host, fixtureBase, level] of markets) {
      const base = region === "fr" && game === "poe2" ? "Bague en or" : fixtureBase;
      const code = ({ kr: "ko", jp: "ja", br: "pt" })[region] || region;
      const stats = asset("trade-filters/" + game + "/" + code + ".json").stats;
      const line = stats[id].replace("#", game === "poe2" ? "+15" : "15");
      const raw = ["Item Class: Rings", "Rarity: Normal", base, "--------", level + ": 84", "--------", line].join("\n");
      const item = { rarity: "Normal", baseType: base, typeLine: base, mods: [{ hash: "stat." + id, description: line }],
        nativeText: Buffer.from(raw).toString("base64") };
      const text = await PTB.pobItemText(item, host, game);
      assert.ok(text.includes("Rarity: Normal\nGold Ring"), region + "\n" + text);
      assert.ok(text.includes("Item Level: 84"), region);
      assert.ok(text.includes("+15% to Fire and Cold Resistances"), region);
    }
    assert.deepEqual(external, []);
  });
}

test("client templates preserve reordered roll slots, option IDs and negative variants", async () => {
  const { PTB, external } = offlineWorker();
  const jp = await PTB.pobStats("poe1", "jp");
  assert.equal(await jp({ description: "トラップを投げると3秒間移動スピードが16%増加する", hash: "stat.explicit.stat_3102860761" }),
    "16% increased Movement Speed for 3 seconds on Throwing a Trap");
  assert.equal(await jp({ description: "禁じられた肉体に一致するモッドがあればバーサーカーを割り当てる", hash: "stat.explicit.stat_1190333629" }),
    "Allocates Berserker if you have the matching modifier on Forbidden Flesh");
  const br = await PTB.pobStats("poe1", "br");
  assert.equal(await br({ description: "Velocidade de Ataque reduzida em 7%", hash: "stat.explicit.stat_210067635" }), "7% reduced Attack Speed");
  await assert.rejects(() => br({ description: "Unknown modifier 37%", hash: "stat.explicit.unknown" }));
  assert.deepEqual(external, []);
});
