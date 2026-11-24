// Localized clients inflect and reorder both rare-name words and magic affixes.
// The bundled dictionaries use the game's Words, Mods and ClientStrings rows.
(() => {
  const regions = new Set(["kr", "de", "fr", "jp", "ru", "br", "es", "th", "tw"]);
  const normalized = text => text.normalize("NFC").replace(/’/g, "'").replace(/\s+/g, " ").trim().toLowerCase();
  let cachedKey, cachedWords;

  async function loadWords(game, region) {
    if (!["poe1", "poe2"].includes(game) || !regions.has(region)) throw Error("Unknown title catalog");
    const key = game + "/" + region;
    if (cachedKey !== key || !cachedWords) {
      cachedKey = key;
      cachedWords = fetch(chrome.runtime.getURL("src/assets/pob-names/" + key + ".json"))
        .then(response => {
          if (!response.ok) throw Error("Missing title catalog");
          return response.json();
        }).catch(error => {
          if (cachedKey === key) cachedWords = undefined;
          throw error;
        });
    }
    return cachedWords;
  }

  // Some languages join words without a space. Require every character of the
  // displayed title to match a dictionary part in the client's declared order.
  function matchParts(text, format, dictionaries, emit) {
    const order = Array.from(format.matchAll(/\{(\d)\}/g), m => Number(m[1]));
    const parts = [];
    function match(remaining, position) {
      const slot = order[position], dictionary = dictionaries[slot];
      const last = position === order.length - 1;
      for (let cut = last ? remaining.length : 1; cut <= remaining.length; cut++) {
        const word = remaining.slice(0, cut);
        if (!Object.hasOwn(dictionary, word)) continue;
        parts[slot] = dictionary[word];
        if (last) emit(parts);
        else if (cut < remaining.length) match(remaining.slice(cut).trimStart(), position + 1);
      }
    }
    if (text && text.length <= 256) match(text, 0);
  }

  function rareTitle(title, words, base) {
    if (words.rareExceptions && Object.hasOwn(words.rareExceptions, title)) return words.rareExceptions[title];
    const choices = new Set();
    matchParts(normalized(title), words.formats[0], [words.rarePrefix, words.rareSuffix],
      parts => choices.add(parts.join(" ")));
    if (choices.size === 1) return [...choices][0];
    // Some localized listings retain the English generated name. Latin
    // letters alone do not distinguish it from a French or Spanish name.
    if (!choices.size && /^[A-Za-z' -]+$/.test(title)) {
      const prefixes = new Set(Object.values(words.rarePrefix));
      const suffixes = new Set(Object.values(words.rareSuffix));
      for (let i = title.indexOf(" "); i > 0; i = title.indexOf(" ", i + 1)) {
        if (prefixes.has(title.slice(0, i)) && suffixes.has(title.slice(i + 1))) return title;
      }
    }
    return "Rare " + base;
  }

  const magicForms = [["prefix"], ["suffix"], ["prefix", "suffix"], ["prefix", "prefix"], ["suffix", "suffix"]];
  function magicTitle(item, base, words) {
    const title = normalized(item.typeLine || ""), localBase = normalized(item.baseType || "");
    if (!title || !localBase || title === localBase) return base;
    const choices = new Set();
    for (const [index, kinds] of magicForms.entries()) {
      const dictionaries = [{ [localBase]: base }, ...kinds.map(kind => words[kind])];
      matchParts(title, words.formats[index + 1], dictionaries, parts => {
        const prefixes = [], suffixes = [];
        kinds.forEach((kind, i) => (kind === "prefix" ? prefixes : suffixes).push(parts[i + 1]));
        choices.add([...prefixes, base, ...suffixes].join(" "));
      });
    }
    if (choices.size === 1) return [...choices][0];
    // The trade payload can carry both affix names separately, even when the
    // client changes the spelling of its base in the full title.
    if (Array.isArray(item.affixNames) && item.affixNames.length === 2 && item.affixNames.every(name => typeof name === "string")) {
      const [a, b] = item.affixNames;
      const fromMods = new Set();
      function affix(table, raw) {
        const key = normalized(raw);
        return Object.hasOwn(table, key) ? table[key] : Object.values(table).find(english => english === raw);
      }
      for (const [p, s] of [[a, b], [b, a]]) {
        const prefix = affix(words.prefix, p), suffix = affix(words.suffix, s);
        if (prefix && suffix) {
          const name = [prefix, base, suffix].join(" ");
          if (!choices.size || choices.has(name)) fromMods.add(name);
        }
      }
      if (fromMods.size === 1) return [...fromMods][0];
    }
    return base;
  }

  PTB.pobTitleLines = async function (item, names, game, region) {
    if (!names.type) throw Error("Missing English base");
    if (item.rarity === "Rare" && item.name) {
      const title = region === "en" ? item.name : rareTitle(item.name, await loadWords(game, region), names.type);
      return [title, names.type];
    }
    if (item.rarity === "Magic" && item.typeLine && item.typeLine !== item.baseType) {
      return [region === "en" ? item.typeLine : magicTitle(item, names.type, await loadWords(game, region))];
    }
    return item.name && names.name ? [names.name, names.type] : [names.type];
  };
})();
