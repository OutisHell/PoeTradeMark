// Use the executed query when the trade link carries one. Short IDs rely on the trade form.

// Display labels from the regional trade filter catalogs, used for opaque search IDs.
const tradeRarityOptions = {
  "Item Rarity": ["Normal", "Magic", "Rare", "Unique", "Unique (Foil)"],
  "아이템 희귀도": ["일반", "마법", "희귀", "고유", "고유 (반짝이 버전)"],
  "アイテムレアリティ": ["ノーマル", "マジック", "レア", "ユニーク", "ユニーク（フォイル）"],
  "Gegenstandsseltenheit": ["Normal", "Magisch", "Selten", "Einzigartig", "Einzigartiger Gegenstand (Foil)"],
  "Rareté de l'objet": ["Normal", "Magique", "Rare", "Unique", "Objet unique (en version surbrillante)"],
  "Rareza de objeto": ["Normal", "Mágico", "Raro", "Único", "Único (brillante)"],
  "Raridade do Item": ["Normal", "Mágico", "Raro", "Único", "Único (Laminado)"],
  "Редкость предмета": ["Обычный", "Волшебный", "Редкий", "Уникальный", "Уникальный предмет (особый)"],
  "ระดับความหายาก": ["ธรรมดา", "เมจิก", "แรร์", "ยูนิค", "ไอเทมยูนิค (ฟอยล์)"],
  "物品稀有度": ["一般", "魔法", "稀有", "傳奇", "傳奇 (貼模)"],
};
PTB.tradeFormRarity = function (key, title, id, label) {
  const options = Object.hasOwn(tradeRarityOptions, title) ? tradeRarityOptions[title] : null;
  if (!options && key !== "rarity") return undefined;
  if (id) return id;
  return ["normal", "magic", "rare", "unique", "uniquefoil"][options?.indexOf(label)] || "";
};

PTB.matchListingSample = async function (sample, searchId, query) {
  if (!sample || sample.query === searchId || sample.landingQuery === searchId) return sample;
  if (!query) return null;
  try {
    const received = sample.submitted?.query ||
      (sample.query?.startsWith("H4sI") && await PTB.unpackTradeQuery(sample.query));
    if (!received) return null;
    return PTB.tradeQueryKey(received) === PTB.tradeQueryKey(query) ? sample : null;
  } catch {
    return null;
  }
};

function listingRarity(sample) {
  const rows = sample?.matched ? sample.rows.filter((_, index) => sample.matched[index]) : sample?.rows || [];
  if (!rows.length || (rows.length < 3 && rows.length !== sample.total)) return;
  if (Object.hasOwn(PTB.bookmarkRarityColors, rows[0]) && rows.every(rarity => rarity === rows[0])) return rows[0];
  if (rows.every(rarity => rarity === "unique" || rarity === "uniquefoil")) return "unique";
}

// The heading uses "Stat Filters" from GGG’s regional /js/translate.<locale>.js files.
const groupLabels = {
  en: { statFilters: "Stat Filters", and: "And", or: "Any", not: "None", count: "Count", weight: "Weighted sum", if: "If", unknown: "Unknown filter" },
  ko: { statFilters: "능력치 필터", and: "및", or: "하나 이상", not: "제외", count: "일치 개수", weight: "가중 합계", weight2: "가중치 적용 합계 v2", if: "만약", unknown: "알 수 없는 필터" },
  ja: { statFilters: "スタットフィルター", and: "すべて", or: "いずれか", not: "除外", count: "一致数", weight: "加重合計", if: "条件付き", unknown: "不明なフィルター" },
  fr: { statFilters: "Filtre de stats", and: "Et", or: "Au moins un", not: "Aucun", count: "Nombre", weight: "Somme pondérée", if: "Si", unknown: "Filtre inconnu" },
  es: { statFilters: "Filtros de estado", and: "Y", or: "Cualquiera", not: "Ninguno", count: "Cantidad", weight: "Suma ponderada", if: "Si", unknown: "Filtro desconocido" },
  de: { statFilters: "Filter: Eigenschaften", and: "Und", or: "Mindestens einer", not: "Keine", count: "Anzahl", weight: "Gewichtete Summe", if: "Falls", unknown: "Unbekannter Filter" },
  pt: { statFilters: "Filtros de Atributos", and: "E", or: "Qualquer", not: "Nenhum", count: "Contagem", weight: "Soma ponderada", if: "Se", unknown: "Filtro desconhecido" },
  ru: { statFilters: "Фильтр свойств", and: "И", or: "Любое", not: "Ни одного", count: "Количество", weight: "Взвешенная сумма", if: "Если", unknown: "Неизвестный фильтр" },
  th: { statFilters: "ม็อดที่ต้องมี...", and: "และ", or: "อย่างน้อยหนึ่ง", not: "ไม่มี", count: "จำนวน", weight: "ผลรวมถ่วงน้ำหนัก", if: "ถ้า", unknown: "ตัวกรองที่ไม่รู้จัก" },
  tw: { statFilters: "篩選器", and: "且", or: "任一", not: "排除", count: "符合數量", weight: "加權總和", if: "條件式", unknown: "未知篩選條件" },
};
const catalogValue = (map, id) => map && Object.hasOwn(map, id) ? map[id] : undefined;

PTB.bookmarkSummary = function (query, form, categoryLabels, sample, catalog, lang = "en") {
  const t = (key, fallback) => PTB.i18n?.t(key, fallback) || fallback;
  const text = value => typeof value === "string" ? value.trim() : "";
  const field = value => text(value?.option ?? value);
  const humanize = key => key.replace(/[_\.]/g, " ");
  const range = value => [
    value?.min != null && "≥ " + value.min,
    value?.max != null && "≤ " + value.max,
    value?.weight != null && "× " + value.weight,
  ].filter(Boolean).join(" · ");
  const types = query?.filters?.type_filters;
  const filter = types?.filters?.rarity;
  const option = query ? (!types?.disabled && !filter?.disabled ? field(filter) : "") : form.rarity;
  const named = query ? field(query.name) : form.named ? form.title : "";
  let rarity;
  if (option === "uniquefoil") rarity = "uniquefoil";
  else if (named) rarity = "unique";
  else if (Object.hasOwn(PTB.bookmarkRarityColors, option)) rarity = option;
  else if (!option || option === "any") rarity = listingRarity(sample);
  const base = query ? field(query.type) : named ? "" : form.title;
  const itemName = [...new Set([named, base].filter(Boolean))].join(" ") || text(query?.term);
  if (!query) {
    return { title: itemName || form.category || form.filters[0] || t("noTitle", "(Untitled)"),
      itemName, filters: form.filters, rarity };
  }
  const filters = [];
  const filterParts = [];
  const groups = groupLabels[lang] || groupLabels.en;
  let category = "";
  const labels = {
    ilvl: t("queryItemLevel", "Item level"), indexed: t("queryIndexed", "Listed within"),
    price: t("queryPrice", "Price"),
  };
  for (const [section, group] of Object.entries(query.filters || {})) {
    if (!group || group.disabled) continue;
    for (const [key, value] of Object.entries(group.filters || {})) {
      if (value == null || value.disabled) continue;
      if (key === "rarity" || key === "status") continue;
      const path = section + "." + key;
      const options = catalogValue(catalog?.options, path);
      if (key === "category") {
        const id = field(value);
        if (id && id !== "any") category = catalogValue(options, id) || catalogValue(categoryLabels, id)
          || (form.categoryId === id ? form.category : "");
        continue;
      }
      let option = value.option ?? (typeof value === "object" ? "" : value);
      if (option === "any" && !range(value)) continue;
      if (catalogValue(options, option)) option = options[option];
      else if (key === "indexed" && /^(\d+)days?$/.test(option)) {
        option = t("queryDays", "{n} days").replace("{n}", parseInt(option, 10));
      }
      const description = [range(value), option].filter(v => v !== "" && v != null && typeof v !== "object").join(" ");
      if (description) filters.push((catalogValue(catalog?.fields, path) || form.labels?.[key] || labels[key] || humanize(key)) + ": " + description);
    }
  }
  const stats = Array.isArray(query.stats) ? query.stats.filter(group => Array.isArray(group?.filters)) : [];
  let primary = filters[0];
  let firstStatGroup = true;
  for (const group of stats) {
    if (group.disabled) continue;
    const entries = [];
    for (const stat of group.filters || []) {
      if (typeof stat?.id !== "string" || !stat.id || stat.disabled) continue;
      const option = stat.value?.option;
      const value = [range(stat.value), catalogValue(catalogValue(catalog?.options, stat.id), option) ?? option]
        .filter(v => v != null && v !== "").join(" ");
      const name = catalogValue(catalog?.stats, stat.id) || form.labels?.[stat.id] || (catalog ? groups.unknown : stat.id);
      const kind = catalogValue(catalog?.groups, stat.id.split(".")[0]);
      entries.push({ text: value ? name + ": " + value : name,
        badge: kind?.type !== "explicit" ? kind : null });
    }
    if (!entries.length) continue;
    const defaultGroup = firstStatGroup && group.type === "and";
    firstStatGroup = false;
    if (defaultGroup && entries.length === 1) {
      primary ??= entries[0].text;
      filterParts[filters.length] = entries[0];
      filters.push(entries[0].text);
      continue;
    }
    const operator = defaultGroup ? groups.statFilters : catalogValue(groups, group.type) ||
      (group.type === "weight2" ? groups.weight + " v2" : group.type);
    const label = [operator, range(group.value)].filter(Boolean).join(" ");
    primary ??= group.type === "and" ? entries[0].text : label;
    filterParts[filters.length] = { label, entries };
    // Plain-text fallback for readers of earlier collection formats.
    filters.push(label + " · " + entries.map(entry => entry.text).join(" / "));
  }
  if (category && itemName) {
    filters.unshift(category);
    filterParts.unshift(null);
  }
  return { title: itemName || category || primary || t("noTitle", "(Untitled)"), itemName, filters, filterParts, rarity };
};

let catalogLang;
const catalogs = new Map();
function loadFilterCatalog(game, lang) {
  if (lang !== catalogLang) { catalogs.clear(); catalogLang = lang; }
  if (!catalogs.has(game)) {
    const url = chrome.runtime.getURL("src/assets/trade-filters/" + game + "/" + lang + ".json");
    const pending = fetch(url).then(response => {
      if (!response.ok) throw Error("Filter catalog unavailable");
      return response.json();
    }).catch(error => {
      if (catalogs.get(game) === pending) catalogs.delete(game);
      throw error;
    });
    catalogs.set(game, pending);
  }
  return catalogs.get(game);
}
PTB.loadFilterCatalog = loadFilterCatalog;

const displayQueries = new Map();
PTB.localizedBookmark = async function (bookmark, lang, catalogFor = loadFilterCatalog) {
  if (bookmark.type !== "search") return bookmark;
  try {
    let query = bookmark.filterQuery;
    if (!query && bookmark.searchId?.startsWith("H4sI")) {
      const id = bookmark.searchId;
      if (!displayQueries.has(id)) {
        if (displayQueries.size >= 128) displayQueries.delete(displayQueries.keys().next().value);
        displayQueries.set(id, PTB.unpackTradeQuery(id).catch(() => null));
      }
      query = await displayQueries.get(id);
    }
    if (!query) return bookmark;
    const catalog = await catalogFor(PTB.bookmarkGame(bookmark), lang);
    const summary = PTB.bookmarkSummary({ ...query, term: bookmark.itemName || query.term }, {}, null, null, catalog, lang);
    const base = bookmark.autoFilterTitle;
    const title = base && bookmark.title.startsWith(base) ? summary.title + bookmark.title.slice(base.length) : bookmark.title;
    return { ...bookmark, title, filters: summary.filters, filterParts: summary.filterParts };
  } catch {
    return bookmark;
  }
};

PTB.localizeBookmarkList = async function (bookmarks) {
  const lang = PTB.i18n.getLang();
  const result = [];
  // Imported collections may contain hundreds of gzip-encoded search URLs.
  for (let i = 0; i < bookmarks.length; i += 16) {
    const batch = bookmarks.slice(i, i + 16);
    result.push(...await Promise.all(batch.map(mark => PTB.localizedBookmark(mark, lang))));
  }
  return result;
};
