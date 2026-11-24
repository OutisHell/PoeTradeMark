// The shipped tables were extracted from PoE 3.30.0.4 and PoE2 4.5.5.3.
// Generate the packaged title dictionaries from matching pathofexile-dat table
// exports. In separate poe1/ and poe2/ directories, run pathofexile-dat@16.0.1
// with config.json containing the game's CDN patch (or Steam directory) and:
//   "tables": [
//     {"name":"Words","columns":["Wordlist","Text","Text2"]},
//     {"name":"Mods","columns":["Id","Name","GenerationType"]},
//     {"name":"ClientStrings","columns":["Id","Text"]}
//   ]
// Include all languages (the CLI default). Then run:
//   node tools/harvest-pob-names.mjs <parent of poe1/ and poe2/>
// To refresh the older Korean dictionary separately, pass --legacy-ko.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

const namesSource = "https://raw.githubusercontent.com/chomg88/colding-poe-ko2en/45d0498811a4651892b3fb55234ea9a898957234/web/public/data/dict-names-3ce7c78318.json.gz";
const gameData = "west-duo/poe-game-data";
const revision = "48aa81af3473a9a3a99f3f6a6eb9b56ecc73accc";

async function get(url) {
  const response = await fetch(url);
  if (!response.ok) throw Error(url + " returned " + response.status);
  return response;
}

async function buildLegacyKorean() {
  const names = JSON.parse(gunzipSync(Buffer.from(await (await get(namesSource)).arrayBuffer())));
  const rarePrefix = {}, rareSuffix = {}, rareExceptions = {};
  // Two fixed words expose the other half of each translated name, even when
  // the Korean prefix contains spaces. Preserve every exceptional full name.
  for (const [ko, en] of Object.entries(names)) {
    if (ko.endsWith(" 파멸") && en.endsWith(" Bane")) rarePrefix[ko.slice(0, -3)] = en.slice(0, -5);
    if (ko.startsWith("영충 ") && en.startsWith("Brood ")) rareSuffix[ko.slice(3)] = en.slice(6);
  }
  for (const [ko, en] of Object.entries(names)) {
    let composed;
    for (let i = ko.indexOf(" "); i > 0; i = ko.indexOf(" ", i + 1)) {
      const prefix = rarePrefix[ko.slice(0, i)], suffix = rareSuffix[ko.slice(i + 1)];
      if (prefix && suffix) { composed = prefix + " " + suffix; break; }
    }
    if (composed !== en) rareExceptions[ko] = en;
  }

  const { tree } = await (await get("https://api.github.com/repos/" + gameData + "/git/trees/" + revision + "?recursive=1")).json();
  const magic = {};
  for (const game of ["poe1", "poe2"]) {
    const tables = { prefix: {}, suffix: {} };
    const files = tree.filter(entry => entry.path.startsWith(game + "/modifiers/json/") && entry.path.endsWith(".json"));
    if (!files.length) throw Error("Missing modifiers for " + game);
    for (let start = 0; start < files.length; start += 6) {
      const batch = await Promise.all(files.slice(start, start + 6).map(async file =>
        (await get("https://raw.githubusercontent.com/" + gameData + "/" + revision + "/" + file.path)).json()));
      for (const data of batch) {
        for (const kind of ["prefix", "suffix"]) {
          for (const { name } of data.buckets?.normal?.[kind] || []) {
            if (!name?.kr || !name.en) continue;
            const key = name.kr.replace(/^\s*-\s*/, "").trim();
            const table = tables[kind];
            if (!Object.hasOwn(table, key)) table[key] = name.en;
            else if (table[key] !== name.en) table[key] = null;
          }
        }
      }
    }
    for (const table of Object.values(tables)) {
      for (const [key, value] of Object.entries(table)) if (!value) delete table[key];
      if (!Object.keys(table).length) throw Error("Empty affix table for " + game);
    }
    magic[game] = tables;
  }

  const output = new URL("../extension/src/assets/pob-names-ko.json", import.meta.url);
  await writeFile(output, JSON.stringify({ rarePrefix, rareSuffix, rareExceptions, magic }) + "\n");
}

const languages = {
  kr: "Korean", de: "German", fr: "French", jp: "Japanese", ru: "Russian",
  br: "Portuguese", es: "Spanish", th: "Thai", tw: "Traditional Chinese",
};
const formats = ["RareNameFormat2Words", "MagicNamePrefix", "MagicNameSuffix",
  "MagicNamePrefixSuffix", "MagicNamePrefixPrefix", "MagicNameSuffixSuffix"];
const normalized = text => text.normalize("NFC").replace(/’/g, "'").replace(/\s+/g, " ").trim().toLowerCase();

function add(table, local, english) {
  const key = normalized(local);
  if (!key || !english || key === "nonexistent") return;
  if (!Object.hasOwn(table, key)) table[key] = english.trim();
  else if (table[key] !== english.trim()) table[key] = null;
}

function addForms(table, local, english) {
  if (!local.includes("<")) return add(table, local, english);
  // A single mod can be displayed in several genders and numbers.
  for (const [, form] of local.matchAll(/<(?:if|elif):[^>]+>\{([^{}]*)\}/g)) add(table, form, english);
}

async function buildNames(root) {
  const assets = new URL("../extension/src/assets/", import.meta.url);
  const legacy = JSON.parse(await readFile(new URL("pob-names-ko.json", assets), "utf8"));
  for (const game of ["poe1", "poe2"]) {
    const table = async (language, name) =>
      JSON.parse(await readFile(join(root, game, "tables", language, name + ".json"), "utf8"));
    const [words, mods] = await Promise.all([table("English", "Words"), table("English", "Mods")]);
    const directory = new URL("pob-names/" + game + "/", assets);
    await mkdir(directory, { recursive: true });
    for (const [region, language] of Object.entries(languages)) {
      const [localWords, localMods, strings] = await Promise.all([
        table(language, "Words"), table(language, "Mods"), table(language, "ClientStrings"),
      ]);
      const data = { rarePrefix: {}, rareSuffix: {}, prefix: {}, suffix: {}, formats: [] };
      for (const word of words) {
        if (word.Wordlist !== 1 && word.Wordlist !== 2) continue;
        const local = localWords[word._index];
        if (local.Wordlist !== word.Wordlist || local.Text !== word.Text) throw Error("Words row mismatch: " + language);
        addForms(word.Wordlist === 1 ? data.rarePrefix : data.rareSuffix, local.Text2, word.Text2);
      }
      for (const mod of mods) {
        if ((mod.GenerationType !== 1 && mod.GenerationType !== 2) || !mod.Name) continue;
        const local = localMods[mod._index];
        if (local.Id !== mod.Id) throw Error("Mods row mismatch: " + language);
        addForms(mod.GenerationType === 1 ? data.prefix : data.suffix, local.Name, mod.Name);
      }
      for (const id of formats) {
        const format = strings.find(s => s.Id === id)?.Text;
        if (!format || /[^{}012\s]/.test(format)) throw Error("Unexpected format " + id + " in " + language);
        data.formats.push(format);
      }
      if (region === "kr") {
        // Keep established translations for older trade titles and exceptional complete names.
        data.rareExceptions = legacy.rareExceptions;
        for (const kind of ["rarePrefix", "rareSuffix"]) {
          for (const [ko, en] of Object.entries(legacy[kind])) data[kind][normalized(ko)] ??= en;
        }
        for (const kind of ["prefix", "suffix"]) {
          for (const [ko, en] of Object.entries(legacy.magic[game][kind])) {
            const key = normalized((kind === "suffix" ? "- " : "") + ko);
            data[kind][key] ??= en;
          }
        }
      }
      for (const dict of [data.rarePrefix, data.rareSuffix, data.prefix, data.suffix]) {
        for (const [key, value] of Object.entries(dict)) if (!value) delete dict[key];
        if (!Object.keys(dict).length) throw Error("Empty dictionary: " + game + "/" + language);
      }
      await writeFile(new URL(region + ".json", directory), JSON.stringify(data) + "\n");
    }
  }
}
if (!process.argv[2] || process.argv[2] === "--legacy-ko") await buildLegacyKorean();
else await buildNames(process.argv[2]);
