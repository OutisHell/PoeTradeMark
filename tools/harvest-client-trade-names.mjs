// node tools/harvest-client-trade-names.mjs <exports-root>
// Run pathofexile-dat@16.0.1 in <exports-root>/poe1 and <exports-root>/poe2
// using "patch": "3.30.0.4" and "patch": "4.5.5.3" respectively in config.json.
// Export all languages and these tables:
// [{"name":"Words","columns":["Wordlist","Text","Text2"]},{"name":"BaseItemTypes","columns":["Id","Name"]}]
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.argv[2];
if (!root) throw Error("Pass the root directory containing the poe1 and poe2 table exports");
const languages = {
  kr: "Korean", jp: "Japanese", de: "German", fr: "French", es: "Spanish",
  br: "Portuguese", ru: "Russian", th: "Thai", tw: "Traditional Chinese",
};
const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));
const writeJson = (file, data) => writeFile(file, JSON.stringify(data) + "\n");

function add(map, key, value) {
  if (!key) return;
  key = key.toLowerCase();
  if (!map.has(key)) map.set(key, new Set());
  map.get(key).add(value);
}

function onlyValue(values) {
  return values?.size === 1 ? values.values().next().value : null;
}

async function readTranslations(game, language, table, id, label) {
  const readTable = (locale) => readJson(join(root, game, "tables", locale, table + ".json"));
  const [source, target] = await Promise.all([readTable("English"), readTable(language)]);
  if (source.length !== target.length) throw Error(`Inconsistent ${game}/${language}/${table} row count`);
  const forward = new Map(), reverse = new Map();
  for (const row of source) {
    if (table === "Words" && row.Wordlist !== 6) continue; // Unique item names.
    const paired = target[row._index];
    if (!row[id] || paired?._index !== row._index || paired[id] !== row[id]) {
      throw Error(`Mismatched ${game}/${language}/${table} row ${row._index}`);
    }
    const english = row[label]?.trim();
    // Thai gems carry font sizing markup in the game files.
    const localized = paired[label]?.replace(/<size:\d+>\{([^{}]*)\}/g, "$1").trim();
    add(forward, english, localized || null);
    add(reverse, localized, english || null);
  }
  return { forward, reverse };
}

function inboundAliases(english, localized, reverse) {
  const shipped = new Map();
  localized.forEach((value, i) => add(shipped, value, english[i]));
  const englishNames = new Set(english.filter(Boolean).map(value => value.toLowerCase()));
  const aliases = {};
  for (const [key, candidates] of reverse) {
    const name = onlyValue(candidates);
    if (!name) continue;
    const existing = shipped.get(key);
    if (!existing && !englishNames.has(name.toLowerCase())) continue; // Exclude unused client records.
    if (onlyValue(existing)) continue; // Already translates without the alias.
    if (existing && [...existing].some(value => value && value.toLowerCase() !== name.toLowerCase())) continue;
    aliases[key] = name;
  }
  return aliases;
}

for (const game of ["poe1", "poe2"]) {
  const packDir = new URL(`../extension/src/assets/trade-names/${game}/`, import.meta.url);
  const aliasDir = new URL(`../extension/src/assets/pob-base-aliases/${game}/`, import.meta.url);
  await mkdir(aliasDir, { recursive: true });
  const english = await readJson(new URL("en.json", packDir));
  for (const [region, language] of Object.entries(languages)) {
    const file = new URL(region + ".json", packDir);
    const fromClient = region === "tw" || (game === "poe2" && region === "th");
    const pack = fromClient ? {} : await readJson(file);
    const aliases = {};
    for (const [field, table, id, label] of [
      ["name", "Words", "Text", "Text2"],
      ["type", "BaseItemTypes", "Id", "Name"],
    ]) {
      const { forward, reverse } = await readTranslations(game, language, table, id, label);
      if (fromClient) pack[field] = english[field].map(value => value && onlyValue(forward.get(value.toLowerCase())));
      if (!pack[field].some(Boolean)) throw Error(`Empty ${game}/${region} ${field} catalog`);
      aliases[field] = inboundAliases(english[field], pack[field], reverse);
    }
    if (fromClient) await writeJson(file, pack);
    await writeJson(new URL(region + ".json", aliasDir), aliases);
  }
}
