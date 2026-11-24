// Generate aligned name/type arrays. Each row identifies the same item in every locale.
// Sources are build-time only. The extension loads just the two languages being used.
// After updating the English rows, run harvest-client-trade-names.mjs to align the client-derived packs.
import { mkdir, writeFile } from "node:fs/promises";

const translated = "https://raw.githubusercontent.com/gw1108/PathOfExile_Translated/ab5c6a714462f1a6428dad7270f7c8822acf3994/dist/poe1";
const exchange = "https://raw.githubusercontent.com/Kvan7/Exiled-Exchange-2/cca30662bf31eaf38bd711e2ec1a6b899a06c40e/renderer/public/data";
const extracted = "https://raw.githubusercontent.com/west-duo/poe-game-data/48aa81af3473a9a3a99f3f6a6eb9b56ecc73accc";
const languages = { en: "en", kr: "ko", jp: "ja", de: "de", fr: "fr", es: "es", br: "pt-BR", ru: "ru", th: "th" };
const fields = ["name", "type"];

async function get(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(url + " returned " + response.status);
  return response;
}
const json = async (url) => (await get(url)).json();

for (const game of ["poe1", "poe2"]) {
  const records = { name: new Map(), type: new Map() };
  function add(field, english, lang, value) {
    if (!english || !value) return;
    const key = english.toLowerCase();
    if (!records[field].has(key)) records[field].set(key, {});
    const record = records[field].get(key);
    if (record[lang] === undefined) record[lang] = value;
    else if (record[lang] !== value) record[lang] = null; // Ambiguous trade text.
  }
  if (game === "poe1") {
    for (const [field, dataset] of [["name", "uniques"], ["type", "base_items"]]) {
      const english = await json(translated + "/" + dataset + "/en.json");
      for (const [region, locale] of Object.entries(languages)) {
        const names = region === "en" ? english : await json(translated + "/" + dataset + "/" + locale + ".json");
        for (const [id, name] of Object.entries(names)) add(field, english[id], region, name);
      }
    }
  } else {
    for (const [region, locale] of Object.entries(languages)) {
      if (region === "th") continue; // No Thai item catalog in this snapshot.
      const path = locale === "pt-BR" ? "pt" : locale;
      const rows = await (await get(exchange + "/" + path + "/items.ndjson")).text();
      for (const line of rows.trim().split("\n")) {
        const item = JSON.parse(line);
        const field = item.namespace === "UNIQUE" ? "name" : "type";
        add(field, item.refName, "en", item.refName);
        add(field, item.refName, region, item.name);
      }
    }
  }
  // Retain the original converter's coverage and the Korean trade site's exact spelling.
  const api = game === "poe1" ? "trade" : "trade2";
  const [catalog, uniques, bases] = await Promise.all([
    json("https://poe.kakaogames.com/api/" + api + "/data/items"),
    json(extracted + "/" + game + "/uniques/json/uniques.json"), json(extracted + "/" + game + "/names/kr.json"),
  ]);
  const entries = catalog.result.flatMap((group) => group.entries);
  for (const field of fields) {
    const valid = new Set(entries.map((entry) => entry[field]));
    const pairs = field === "type" ? Object.entries(bases) : uniques.map(({ name }) => [name.en, name.kr]);
    for (const record of records[field].values()) {
      if (!valid.has(record.kr)) delete record.kr;
    }
    for (const [english, korean] of pairs) {
      if (!english || !valid.has(korean)) continue;
      add(field, english, "kr", korean);
      if (!records[field].get(english.toLowerCase()).en) add(field, english, "en", english);
    }
  }
  const dir = new URL("../extension/src/assets/trade-names/" + game + "/", import.meta.url);
  await mkdir(dir, { recursive: true });
  for (const region of Object.keys(languages)) {
    if (game === "poe2" && region === "th") continue;
    const data = Object.fromEntries(fields.map((field) => [field, [...records[field].values()].map((r) => r[region] ?? null)]));
    if (fields.some((field) => !data[field].some(Boolean))) throw new Error("Empty catalog " + game + "/" + region);
    await writeFile(new URL(region + ".json", dir), JSON.stringify(data) + "\n");
  }
}
