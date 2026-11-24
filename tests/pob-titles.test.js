const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const path = require("node:path");

global.PTB = {};
global.chrome = { runtime: { getURL: file => "chrome-extension://test/" + file } };
global.fetch = async url => {
  assert.ok(url.startsWith(chrome.runtime.getURL("src/assets/pob-names/")));
  return Response.json(JSON.parse(await readFile(path.join(__dirname, "../extension", new URL(url).pathname), "utf8")));
};
require("../extension/src/background/pob-titles.js");

const samples = [
  ["kr", "영충 파멸", "심판 지팡이", "무거운 심판 지팡이 - 스킬"],
  ["fr", "Fléau tourbillonnant", "Bâton du jugement", "Bâton du jugement lourd de l'Adresse", "Vortex Bane"],
  ["de", "Brut-Bann", "Richterstab", "Schwerer Richterstab der Fertigkeit"],
  ["jp", "思案する破滅", "ジャッジメントスタッフ", "重い 技術の ジャッジメントスタッフ"],
  ["ru", "Вихревое проклятие", "Посох судьи", "Болезненный Посох судьи навыка", "Vortex Bane", "Burnished"],
  ["br", "Perdição da Ninhada", "Cajado do Julgamento", "Cajado do Julgamento Pesado da Habilidade"],
  ["es", "Armazón de la camada", "Báculo de juicio", "Báculo de juicio pesado de habilidad", "Brood Shell"],
  ["th", "Brood Bane", "Judgement Staff", "Heavy Judgement Staff of Skill"],
  ["tw", "種裔 禁域", "審判長杖", "重量的技巧之審判長杖"],
];
for (const [region, name, baseType, typeLine, rare = "Brood Bane", prefix = "Heavy"] of samples) {
  test(region + " rare and magic titles use the English word order", async () => {
    const names = { type: "Judgement Staff" };
    assert.deepEqual(await PTB.pobTitleLines({ rarity: "Rare", name, baseType }, names, "poe1", region),
      [rare, names.type]);
    assert.deepEqual(await PTB.pobTitleLines({ rarity: "Magic", typeLine, baseType }, names, "poe1", region),
      [prefix + " Judgement Staff of Skill"]);
  });
}
test("single affixes, an unknown title, and canonical English titles", async () => {
  const names = { type: "Judgement Staff" }, baseType = "심판 지팡이";
  for (const [typeLine, expected] of [["무거운 심판 지팡이", "Heavy Judgement Staff"],
    ["심판 지팡이 - 스킬", "Judgement Staff of Skill"], ["미등록 심판 지팡이", names.type]]) {
    assert.deepEqual(await PTB.pobTitleLines({ rarity: "Magic", typeLine, baseType }, names, "poe1", "kr"), [expected]);
  }
  assert.deepEqual(await PTB.pobTitleLines({ rarity: "Rare", name: "partiellement inconnu" }, names, "poe2", "fr"),
    ["Rare Judgement Staff", names.type]);
  assert.deepEqual(await PTB.pobTitleLines({ rarity: "Rare", name: "Brood Bane" }, names, "poe2", "en"),
    ["Brood Bane", names.type]);
});
test("the same localized affix can have different English names in the two games", async () => {
  const item = { rarity: "Magic", typeLine: "忠実な 棒", baseType: "棒" };
  assert.deepEqual(await PTB.pobTitleLines(item, { type: "Staff" }, "poe1", "jp"), ["Loyal Staff"]);
  assert.deepEqual(await PTB.pobTitleLines(item, { type: "Quarterstaff" }, "poe2", "jp"), ["Faithful Quarterstaff"]);
});
test("ambiguous title words use the English base and complete listing metadata can restore a magic title", async () => {
  const names = { type: "Judgement Staff" };
  assert.deepEqual(await PTB.pobTitleLines({ rarity: "Rare", name: "Fléau géniteur" }, names, "poe1", "fr"),
    ["Rare Judgement Staff", names.type]);
  assert.deepEqual(await PTB.pobTitleLines({ rarity: "Rare", name: "Brood Bane" }, names, "poe1", "kr"),
    ["Brood Bane", names.type]);
  const item = { rarity: "Magic", typeLine: "indéterminé", baseType: "Bâton du jugement" };
  for (const affixNames of [["de l'Adresse", "Lourd"], ["Heavy", "of Skill"]]) {
    assert.deepEqual(await PTB.pobTitleLines({ ...item, affixNames }, names, "poe1", "fr"),
      ["Heavy Judgement Staff of Skill"]);
  }
});
test("PoE2 formats compound magic titles and translated unique and normal names", async () => {
  const names = { type: "Quarterstaff" };
  assert.deepEqual(await PTB.pobTitleLines({ rarity: "Magic", typeLine: "重い 技術の 棒", baseType: "棒" }, names, "poe2", "jp"),
    ["Heavy Quarterstaff of Skill"]);
  assert.deepEqual(await PTB.pobTitleLines({ rarity: "Unique", name: "nom" }, { type: "Two-Stone Ring", name: "Rigwald's Crest" }, "poe2", "fr"),
    ["Rigwald's Crest", "Two-Stone Ring"]);
  assert.deepEqual(await PTB.pobTitleLines({ rarity: "Normal" }, names, "poe2", "fr"), ["Quarterstaff"]);
});
