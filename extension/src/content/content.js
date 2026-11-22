(() => {
  "use strict";

  const BUTTON_ID = "ptb-bookmark-button";
  const BUTTON_CLASS = "ptb-bookmark-button";
  const SAVED_CLASS = "ptb-is-saved";
  const BUSY_CLASS = "ptb-is-busy";
  const URL_POLL_MS = 1000;
  const FEEDBACK_MS = 1400;
  const GITHUB_URL = "https://github.com/danij91/PoeTradeMark";

  const state = {
    button: null,
    collectionGame: null,
    hasCollection: false,
    href: "",
    saving: false,
    feedbackTimer: 0,
    sidebar: null,
    sidebarOpen: false,
    redirectSettings: undefined,
  };

  const message = (key, fallback) => {
    try {
      if (globalThis.PTB && PTB.i18n) return PTB.i18n.t(key, fallback);
    } catch (_error) {
      // fall through
    }
    return fallback;
  };

  const parseCurrentUrl = () => {
    try {
      const parseTradeUrl = globalThis.PTB?.parseTradeUrl;
      if (typeof parseTradeUrl !== "function") {
        return null;
      }

      const info = parseTradeUrl(globalThis.location?.href || "");
      return info && info.searchId ? info : null;
    } catch (_error) {
      return null;
    }
  };

  const cleanText = (value) =>
    String(value || "")
      .replace(/\s+/g, " ")
      .trim();

  const copyToClipboard = (text) => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).catch(() => {});
        return;
      }
    } catch (_e) {}
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed;opacity:0;pointer-events:none;";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    } catch (_e) {}
  };

  const queryOne = (root, selectors) => {
    for (const selector of selectors) {
      try {
        const match = root.querySelector(selector);
        if (match) {
          return match;
        }
      } catch (_error) {
        return null;
      }
    }

    return null;
  };

  // 거래소 결과 DOM(KR poe.kakaogames.com / 글로벌 동일 코드베이스)에 맞춘 셀렉터.
  // 결과 1행 = `.resultset .row[data-id]`, 아이콘 = 그 안의 `.icon img`(…/gen/image/…),
  // 제목 = `.item-popup__header-line`(첫 줄 = 아이템명). 사이트 로고를 피하려 행 내부로 한정.
  const RESULT_ROW_SELECTORS = [
    ".resultset .row[data-id]",
    ".results .row[data-id]",
    ".row[data-id]",
    ".resultset .row",
    ".search-results .row",
  ];

  const ICON_SELECTORS = [
    ".icon img",
    ".iconContainer img",
    "img[src*='/gen/image/']",
    "img[src*='poecdn']",
  ];

  // 검색창에 입력/선택된 아이템명. 라이브 확인: `.search-left input`의 value 속성에 들어있음
  // (`.multiselect__single` 아님). 결과 첫 행 이름과 다를 수 있어(예: 결과 "삿된 ..." vs 검색 "비스 모티스 ...")
  // 사용자가 검색한 이름을 우선한다.
  const readSearchTitle = () => {
    try {
      const sl =
        document.querySelector(".search-panel .search-left") ||
        document.querySelector(".search-left");
      if (!sl) return "";
      const input =
        sl.querySelector("input.multiselect__input") || sl.querySelector("input");
      const single = sl.querySelector(".multiselect__single");
      return cleanText(single?.textContent) || cleanText(input?.defaultValue) ||
        (input && !sl.querySelector(".multiselect--active") ? cleanText(input.value) : "");
    } catch (_error) {
      return "";
    }
  };

  // 아이템 유형(카테고리). 검색창에 이름이 없을 때 제목 폴백으로 사용.
  // 고급필터의 첫 드롭다운(.multiselect.filter-select)이 곧 "아이템 유형" 필터(언어 무관).
  // 선택값은 .multiselect__single 에 들어가고, 미선택(=모두/Any)이면 그 요소가 없어 "" 반환.
  const readItemType = () => {
    const control = document.querySelector(".search-advanced [data-id='category'], .search-advanced [data-filter='category']") ||
      document.querySelector(".search-advanced .multiselect.filter-select");
    const native = control?.matches("select") ? control : control?.querySelector("select");
    const selected = control?.querySelector(".multiselect__single");
    return { category: cleanText(native?.selectedOptions[0]?.textContent || selected?.textContent),
      categoryId: native?.value || selected?.dataset.value || "" };
  };

  // 적용된 필터들(스탯 + 그 외)을 사람이 읽는 문자열로. 라이브 확인:
  //  - 스탯 모드(.mutate-type 보유) → 모드 텍스트 자체("소환수가 불경한 힘 보유").
  //  - 그 외(방어구/홈/희귀도 등) → "필터명: 값"(.modified 인 select/input 만). 툴팁(.filter-tip) 제거.
  const captureFilters = () => {
    try {
      const cleanLabel = (el) => {
        if (!el) return "";
        const clone = el.cloneNode(true);
        clone.querySelectorAll(".filter-tip, .mutate-type").forEach((n) => n.remove());
        return cleanText(clone.textContent);
      };
      const out = [];
      const labels = {};
      const statNames = [];
      let rarity;
      const filters = document.querySelectorAll(".search-advanced .filter");
      for (const f of filters) {
        const titleEl = f.querySelector(".filter-title");
        const name = cleanLabel(titleEl);
        if (!name || f.matches(".disabled, [aria-disabled='true']")) continue;
        const key = f.dataset.id || f.dataset.filter;
        if (key === "status" || key === "trade_status" || name === message("profileStatus", "Trade mode") ||
            name === "거래 방식" || name === "Trade mode") continue;
        const native = f.querySelector("select");
        const single = f.querySelector(".multiselect__single");
        const optionId = native?.value || single?.dataset.value;
        if (optionId && optionId !== "any" && PTB.tradeRegion.statuses.includes(optionId)) continue;
        const selectedRarity = PTB.tradeFormRarity(key, name, optionId,
          cleanText(native?.selectedOptions[0]?.textContent || single?.textContent));
        if (selectedRarity !== undefined) {
          rarity = selectedRarity || (f.querySelector(".modified") ? "unclassified" : undefined);
          continue;
        }
        if (key) labels[key] = name;
        const vals = [];
        f.querySelectorAll(".multiselect.modified .multiselect__single").forEach((s) => {
          const v = cleanText(s.textContent);
          if (v) vals.push(v);
        });
        // 스탯 모드의 오른쪽 min/max 등 값 박스(.modified)까지 캡처
        f.querySelectorAll("input.modified").forEach((i) => {
          if (i.value) vals.push((i.placeholder ? i.placeholder + " " : "") + i.value);
        });
        let label = "";
        if (titleEl.querySelector(".mutate-type")) {
          statNames.push(name);
          label = vals.length ? name + ": " + vals.join(", ") : name; // 스탯 모드 = 모드 텍스트(+값)
        } else if (vals.length) {
          label = name + ": " + vals.join(", ");
        }
        if (label && !out.includes(label)) out.push(label);
      }
      return { filters: out, labels, statNames, rarity };
    } catch (_error) {
      return { filters: [], labels: {}, statNames: [] };
    }
  };

  function currentListingSample(info) {
    if (info.type !== "search") return null;
    const resultList = document.querySelector(".resultset, .search-results, .results") || document;
    const ids = [...new Set(Array.from(resultList.querySelectorAll(".row[data-id]"), row => row.dataset.id).filter(Boolean))].slice(0, 600);
    if (!ids.length) return null;
    const bridge = document.createElement("template");
    bridge.dataset.request = JSON.stringify({ ids, query: info.searchId, league: info.league, game: info.game === "poe2" ? "trade2" : "trade" });
    document.documentElement.appendChild(bridge);
    try {
      bridge.dispatchEvent(new Event("ptb-read-listing-sample", { bubbles: true }));
      const sample = JSON.parse(bridge.dataset.sample || "null");
      return Array.isArray(sample?.rows) && sample.rows.length === ids.length ? sample : null;
    } catch {
      return null;
    } finally { bridge.remove(); }
  }

  const captureResultDetails = async (info) => {
    const sample = currentListingSample(info);
    const row = queryOne(document, RESULT_ROW_SELECTORS);
    const iconUrl = row ? queryOne(row, ICON_SELECTORS)?.src || null : null;
    const form = { title: readSearchTitle(), ...readItemType(), ...captureFilters() };
    let query = null;
    if (info.type === "search" && info.searchId.startsWith("H4sI")) {
      try { query = await PTB.unpackTradeQuery(info.searchId); } catch { /* Read the form for unsupported tokens. */ }
    }
    if (!query && info.type === "search" && form.title) {
      const named = await chrome.runtime.sendMessage({ cmd: "ptb-named-selection", title: form.title }).catch(() => false);
      if (named === true) form.named = true;
    }
    const categoryLabels = PTB.tradeCategoryLabels[info.game]?.[info.realm];
    const matchingSample = await PTB.matchListingSample(sample, info.searchId, query);
    return { ...PTB.bookmarkSummary(query, form, categoryLabels, matchingSample), iconUrl };
  };

  const setBookmarkFace = (button, saved) => {
    try {
      const label = !state.hasCollection ? message("collectionStart") :
        saved ? message("saved", "Saved") : message("bookmarkButton", "Bookmark");
      setIconBtn(button, saved ? "check" : "starPlus", label);
    } catch (_error) {}
  };

  const showSavedFeedback = () => {
    const button = state.button;
    if (!button) {
      return;
    }

    clearTimeout(state.feedbackTimer);
    button.classList.add(SAVED_CLASS);
    setBookmarkFace(button, true);

    state.feedbackTimer = setTimeout(() => {
      try {
        button.classList.remove(SAVED_CLASS);
        button.disabled = !state.hasCollection;
        setBookmarkFace(button, false);
      } catch (_error) {
        // The button may have been removed after a route change.
      }
    }, FEEDBACK_MS);
  };

  const handleSave = async (event) => {
    try {
      event.preventDefault();
      event.stopPropagation();
    } catch (_error) {
      // Click events from the extension button should be cancelable, but do not depend on it.
    }

    if (state.saving || !state.hasCollection) {
      return;
    }

    const info = parseCurrentUrl();
    const storage = globalThis.PTB?.storage;
    if (!info || typeof storage?.add !== "function") {
      reconcile();
      return;
    }

    state.saving = true;

    try {
      const button = ensureButton();
      if (button) {
        button.disabled = true;
        button.classList.add(BUSY_CLASS);
      }

      const lowPrice = observedMinimum(info, readListingPrices());
      const { title, itemName, iconUrl, filters, rarity } = await captureResultDetails(info);
      await storage.add({
        ...info,
        title,
        itemName,
        ...(rarity ? { rarity } : {}),
        iconUrl,
        filters,
        query: null,
        sort: null,
        lowPrice: lowPrice,
      });

      showSavedFeedback();
    } catch (_error) {
      const button = state.button;
      if (button) {
        button.disabled = !state.hasCollection;
        setBookmarkFace(button, false);
      }
    } finally {
      state.saving = false;
      if (state.button) {
        state.button.classList.remove(BUSY_CLASS);
      }
    }
  };

  function ensureButton() {
    try {
      if (!document.body) {
        return null;
      }

      let button = state.button || document.getElementById(BUTTON_ID);
      if (!button) {
        button = document.createElement("button");
        button.id = BUTTON_ID;
        button.type = "button";
        button.className = BUTTON_CLASS;
        button.addEventListener("click", handleSave);
        document.body.appendChild(button);
      }

      state.button = button;
      button.hidden = false;
      if (!state.saving && !button.classList.contains(SAVED_CLASS)) {
        button.disabled = !state.hasCollection;
        setBookmarkFace(button, false);
      }

      return button;
    } catch (_error) {
      return null;
    }
  }

  const hideButton = () => {
    try {
      if (state.button) {
        state.button.hidden = true;
      }
    } catch (_error) {
      // Ignore DOM detach during navigation.
    }
  };

  let collectionRead = 0;
  async function refreshSaveAvailability(game) {
    const version = ++collectionRead;
    state.collectionGame = game;
    state.hasCollection = false;
    if (state.button) state.button.disabled = true;
    if (!game) return;
    try {
      const available = await PTB.storage.hasCollection(game);
      if (version !== collectionRead || game !== parseCurrentUrl()?.game) return;
      state.hasCollection = available;
      if (!available && state.button) {
        clearTimeout(state.feedbackTimer);
        state.button.classList.remove(SAVED_CLASS);
      }
      ensureButton();
    } catch (_error) { /* Keep saving disabled until storage is available. */ }
  }

  function applyGameTheme() {
    const game = PTB.gameFromUrl ? PTB.gameFromUrl(globalThis.location?.href || "") : null;
    try {
      if (document.body) document.body.classList.toggle("ptb-game-poe2", game === "poe2");
    } catch (_e) {
      // ignore
    }
    const fxbar = state.sidebar && state.sidebar.querySelector(".ptb-sb-fxbar");
    if (fxbar) fxbar.hidden = game !== "poe1" && game !== "poe2";
  }

  function reconcile() {
    try {
      const href = globalThis.location?.href || "";
      const info = parseCurrentUrl();
      const hrefChanged = state.href !== href;
      state.href = href;
      applyGameTheme();
      renderPreferredSiteLink();

      const game = info?.game || null;
      if (state.collectionGame !== game) refreshSaveAvailability(game);
      if (info) {
        ensureButton();
      } else {
        hideButton();
      }
      if (hrefChanged && state.sidebarOpen) renderSidebarList();
      if (hrefChanged) {
        lastObservation = "";
        fx.league = "";
        refreshListingFx().catch(() => {});
      }
    } catch (_error) {
      hideButton();
    }
  }

  const scheduleReconcile = () => {
    globalThis.setTimeout(reconcile, 0);
  };

  const patchHistory = () => {
    try {
      for (const method of ["pushState", "replaceState"]) {
        const original = globalThis.history?.[method];
        if (typeof original !== "function") {
          continue;
        }

        globalThis.history[method] = function patchedHistoryMethod(...args) {
          const result = original.apply(this, args);
          scheduleReconcile();
          return result;
        };
      }
    } catch (_error) {
      // Polling still covers SPA URL changes.
    }
  };

  // ── 우측 고정 즐겨찾기 사이드바 (페이지 내 도킹 패널) ──────────────
  const SIDEBAR_TOGGLE_ID = "ptb-sidebar-toggle";
  const SIDEBAR_OPEN_KEY = "ptbSidebarOpen";

  const sbEl = (tag, className, text) => {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  };

  const lucideEl = (name, size) => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", String(size || 16));
    svg.setAttribute("height", String(size || 16));
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    (ICO[name] || []).forEach((item) => {
      const node = document.createElementNS("http://www.w3.org/2000/svg", item[0]);
      const attrs = item[1] || {};
      Object.keys(attrs).forEach((k) => node.setAttribute(k, attrs[k]));
      svg.appendChild(node);
    });
    return svg;
  };

  const setIconBtn = (el, name, label) => {
    el.textContent = "";
    el.appendChild(lucideEl(name));
    if (label) {
      el.title = label;
      el.setAttribute("aria-label", label);
    }
  };

  const ICO = {
    redirect: [["path", { d: "M3 20v-6a4 4 0 0 1 4-4h14m-6-6 6 6-6 6" }]],
    chevronsRight: [
      ["path", { d: "m6 17 5-5-5-5" }],
      ["path", { d: "m13 17 5-5-5-5" }],
    ],
    copy: [
      ["rect", { width: "14", height: "14", x: "8", y: "8", rx: "2", ry: "2" }],
      ["path", { d: "M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" }],
    ],
    trash: [
      ["path", { d: "M10 11v6" }],
      ["path", { d: "M14 11v6" }],
      ["path", { d: "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" }],
      ["path", { d: "M3 6h18" }],
      ["path", { d: "M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" }],
    ],
    list: [
      ["path", { d: "M3 12h.01" }],
      ["path", { d: "M3 18h.01" }],
      ["path", { d: "M3 6h.01" }],
      ["path", { d: "M8 12h13" }],
      ["path", { d: "M8 18h13" }],
      ["path", { d: "M8 6h13" }],
    ],
    starPlus: [
      ["path", { d: "M11.013 18.582 6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.12 2.12 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.12 2.12 0 0 0 1.597-1.16l2.309-4.679a.53.53 0 0 1 .95 0l2.31 4.679a2.12 2.12 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904L20 11.5" }],
      ["path", { d: "M15 18h6" }],
      ["path", { d: "M18 15v6" }],
    ],
    dollar: [
      ["line", { x1: "12", x2: "12", y1: "2", y2: "22" }],
      ["path", { d: "M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" }],
    ],
    table: [
      ["path", { d: "M12 3v18" }],
      ["rect", { width: "18", height: "18", x: "3", y: "3", rx: "2" }],
      ["path", { d: "M3 9h18" }],
      ["path", { d: "M3 15h18" }],
    ],
    pencil: [
      ["path", { d: "M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" }],
      ["path", { d: "m15 5 4 4" }],
    ],
    refresh: [
      ["path", { d: "M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" }],
      ["path", { d: "M21 3v5h-5" }],
      ["path", { d: "M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" }],
      ["path", { d: "M8 16H3v5" }],
    ],
    check: [["path", { d: "M20 6 9 17l-5-5" }]],
    x: [
      ["path", { d: "M18 6 6 18" }],
      ["path", { d: "m6 6 12 12" }],
    ],
    globe: [
      ["circle", { cx: "12", cy: "12", r: "10" }],
      ["path", { d: "M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" }],
      ["path", { d: "M2 12h20" }],
    ],
    search: [
      ["path", { d: "m21 21-4.34-4.34" }],
      ["circle", { cx: "11", cy: "11", r: "8" }],
    ],
    github: [
      ["path", { d: "M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" }],
      ["path", { d: "M9 18c-4.51 2-5-2-7-2" }],
    ],
  };

  const closeLangMenus = () => {
    document.querySelectorAll(".ptb-sb-langmenu, .ptb-langmenu").forEach((el) => {
      el.hidden = true;
    });
  };

  const buildLangPicker = () => {
    const wrap = sbEl("div", "ptb-sb-langwrap");
    const btn = sbEl("button", "ptb-sb-langbtn");
    btn.type = "button";
    btn.title = message("language", "Language");
    btn.appendChild(lucideEl("globe"));
    const menu = sbEl("div", "ptb-sb-langmenu");
    menu.hidden = true;
    const fill = () => {
      menu.textContent = "";
      const cur = PTB.i18n.getLang();
      PTB.i18n.LANGS.forEach((code) => {
        const item = sbEl("button", "ptb-sb-langopt" + (code === cur ? " ptb-on" : ""));
        item.type = "button";
        item.textContent = PTB.i18n.LANG_NAMES[code] || code;
        item.addEventListener("click", (e) => {
          e.stopPropagation();
          PTB.i18n.setLang(code);
          menu.hidden = true;
        });
        menu.appendChild(item);
      });
    };
    fill();
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = menu.hidden;
      closeLangMenus();
      if (open) {
        fill();
        menu.hidden = false;
      }
    });
    wrap.appendChild(btn);
    wrap.appendChild(menu);
    return wrap;
  };

  const ninjaSlug = (league) => {
    let s = String(league || "").trim().toLowerCase();
    if (!s) return "";
    if (s === "hardcore" || s === "standard") return s;
    let hc = false;
    if (/^(hardcore|hc)\s+/.test(s)) {
      hc = true;
      s = s.replace(/^(hardcore|hc)\s+/, "");
    }
    s = s.replace(/[^a-z0-9]+/g, "");
    if (hc && s) s += "hc";
    return s;
  };

  const poedbLang = () => {
    const lang = PTB.i18n && PTB.i18n.getLang ? PTB.i18n.getLang() : "en";
    const map = { en: "us", ko: "kr", ja: "jp", ru: "ru", de: "de", fr: "fr", es: "sp", th: "th", pt: "pt", tw: "tw" };
    return map[lang] || "us";
  };

  const buildLinkBtn = (kind, title) => {
    const a = sbEl("a", "ptb-sb-extlink");
    a.target = "_blank";
    a.rel = "noopener";
    a.title = title;
    if (kind === "github") {
      a.appendChild(lucideEl("github", 16));
      if (GITHUB_URL) a.href = GITHUB_URL;
      else a.addEventListener("click", (e) => e.preventDefault());
      return a;
    }
    if (kind === "poedb") {
      a.appendChild(sbEl("span", "ptb-sb-exttext", "DB"));
    } else {
      const img = document.createElement("img");
      img.className = "ptb-sb-exticon";
      img.alt = title;
      img.draggable = false;
      try {
        img.src = chrome.runtime.getURL("src/assets/brand/ninja.png");
      } catch (_e) {}
      a.appendChild(img);
    }
    const sync = () => {
      const game = currentGame();
      const league = currentLeague();
      const loc = poedbLang();
      if (kind === "poedb") {
        a.href = game === "poe2" ? "https://poe2db.tw/" + loc + "/" : "https://poedb.tw/" + loc + "/";
      } else {
        const slug = ninjaSlug(league);
        if (game === "poe2") a.href = slug ? "https://poe.ninja/poe2/economy/" + slug + "/currency" : "https://poe.ninja/poe2/";
        else a.href = slug ? "https://poe.ninja/poe1/economy/" + slug + "/currency" : "https://poe.ninja/poe1/";
      }
    };
    a.addEventListener("click", sync);
    a.addEventListener("mouseenter", sync);
    sync();
    return a;
  };

  const formatListedAmount = (n) => {
    const a = Number(n);
    if (!Number.isFinite(a)) return "";
    if (Math.abs(a - Math.round(a)) < 1e-9) return String(Math.round(a));
    return PTB.rates && PTB.rates.format3 ? PTB.rates.format3(a) : String(Math.round(a * 1000) / 1000);
  };

  const buildSidebarRow = (bookmark) => {
    const row = sbEl("div", "ptb-sb-row");

    const thumb = sbEl("div", "ptb-sb-thumb");
    if (bookmark.iconUrl) {
      const img = document.createElement("img");
      img.src = bookmark.iconUrl;
      img.alt = "";
      img.loading = "lazy";
      thumb.appendChild(img);
    } else {
      thumb.textContent = cleanText(bookmark.title || "?").slice(0, 1);
    }

    const main = sbEl("div", "ptb-sb-main");
    const nameRow = sbEl("div", "ptb-sb-namerow");
    const pencil = sbEl("button", "ptb-sb-pencil");
    pencil.type = "button";
    pencil.title = message("rename", "Rename");
    pencil.appendChild(lucideEl("pencil"));
    const titleEl = sbEl("div", "ptb-sb-title", bookmark.title || bookmark.searchId || "");
    PTB.colorBookmarkTitle(titleEl, bookmark);
    pencil.addEventListener("click", (e) => {
      e.stopPropagation();
      PTB.editBookmarkTitle(titleEl, bookmark, "ptb-sb-title-input", renderSidebarList);
    });
    nameRow.appendChild(pencil);
    nameRow.appendChild(titleEl);
    const tagRow = sbEl("div", "ptb-sb-tagrow");
    const priceEl = buildLowPriceRow(bookmark);
    if (priceEl && priceEl.firstChild) tagRow.appendChild(priceEl);
    const realmLabel =
      globalThis.PTB && PTB.realmLabel ? PTB.realmLabel(bookmark.realm) : (bookmark.realm || "").toUpperCase();
    tagRow.appendChild(sbEl("span", "ptb-sb-realm", realmLabel));
    if (bookmark.league) tagRow.appendChild(sbEl("span", "ptb-sb-league", bookmark.league));
    main.appendChild(tagRow);
    main.appendChild(nameRow);

    const actions = sbEl("div", "ptb-sb-actions");
    const jumpBtn = sbEl("a", "ptb-sb-btn ptb-sb-jump ptb-sb-ico");
    jumpBtn.title = message("jump", "Open");
    jumpBtn.appendChild(lucideEl("chevronsRight"));
    try {
      const buildTradeUrl = globalThis.PTB && PTB.buildTradeUrl;
      if (typeof buildTradeUrl === "function") jumpBtn.href = buildTradeUrl(bookmark);
    } catch (_e) {}
    const copyBtn = sbEl("button", "ptb-sb-btn ptb-sb-ico");
    copyBtn.type = "button";
    copyBtn.title = message("copyUrl", "Copy");
    copyBtn.appendChild(lucideEl("copy"));
    copyBtn.addEventListener("click", () => {
      try {
        const buildTradeUrl = globalThis.PTB && PTB.buildTradeUrl;
        const url = typeof buildTradeUrl === "function" ? buildTradeUrl(bookmark) : "";
        if (!url) return;
        copyToClipboard(url);
        copyBtn.textContent = "";
        copyBtn.appendChild(lucideEl("check"));
        copyBtn.title = message("copied", "Copied");
        setTimeout(() => {
          try {
            copyBtn.textContent = "";
            copyBtn.appendChild(lucideEl("copy"));
            copyBtn.title = message("copyUrl", "Copy");
          } catch (_e) {}
        }, 1300);
      } catch (_e) {}
    });
    const deleteBtn = sbEl("button", "ptb-sb-btn ptb-sb-del ptb-sb-ico");
    deleteBtn.type = "button";
    deleteBtn.title = message("delete", "Delete");
    deleteBtn.appendChild(lucideEl("trash"));
    deleteBtn.addEventListener("click", async () => {
      try {
        await PTB.storage.remove(bookmark.id);
      } catch (_error) {}
    });
    actions.appendChild(PTB.tradeRegion.splitButton(jumpBtn, bookmark));
    actions.appendChild(copyBtn);
    actions.appendChild(deleteBtn);

    const grip = sbEl("span", "ptb-sb-rategrip", "⋮⋮");
    grip.title = message("folderDrag", "Drag bookmark");

    row.appendChild(grip);
    row.appendChild(thumb);
    row.appendChild(main);
    PTB.appendBookmarkFilters(row, bookmark.filters, "ptb-sb-filters", "ptb-sb-chip");
    row.appendChild(actions);
    return row;
  };

  const bookmarkMatches = (bookmark, q) => {
    if (!q) return true;
    const needle = q.toLowerCase();
    const title = String(bookmark.title || "").toLowerCase();
    const item = String(bookmark.itemName || "").toLowerCase();
    return title.indexOf(needle) !== -1 || item.indexOf(needle) !== -1;
  };

  let sidebarListVersion = 0;
  const renderSidebarList = async () => {
    try {
      const list = state.sidebar && state.sidebar.querySelector(".ptb-sb-list");
      if (!list) return;
      const version = ++sidebarListVersion;
      const game = currentGame();
      const view = await PTB.storage.listView(game);
      if (version !== sidebarListVersion || game !== currentGame()) return;
      const editButton = PTB.renderCollectionControls(state.sidebar.querySelector(".ptb-collection-controls"), game, view, renderSidebarList);
      if (list.dataset.ptbGame === game && list.dataset.ptbCollection === view.collectionId &&
          list.querySelector(".ptb-bm-dragging, .ptb-bm-form, .ptb-title-editor")) return;
      list.dataset.ptbGame = game || "";
      list.dataset.ptbCollection = view.collectionId || "";
      const q = String(fx.bmQuery || "").trim();
      PTB.renderBookmarkGroups(list, view, {
        game,
        editButton,
        buildRow: buildSidebarRow,
        gripSelector: ".ptb-sb-rategrip",
        refresh: renderSidebarList,
        canReorder: !q,
        searching: Boolean(q),
        filterBookmark: q ? bookmark => bookmarkMatches(bookmark, q) : null,
      });
    } catch (_error) {
      // best-effort
    }
  };

  const ensureSidebar = () => {
    if (state.sidebar && document.body && document.body.contains(state.sidebar)) {
      return state.sidebar;
    }
    if (!document.body) return null;
    const sidebar = sbEl("aside", "ptb-sidebar");
    const header = sbEl("div", "ptb-sb-header");
    const mark = document.createElement("img");
    mark.src = chrome.runtime.getURL("icons/icon48.png");
    mark.alt = "PoE Trade Mark";
    mark.width = mark.height = 26;
    mark.draggable = false;
    header.appendChild(mark);
    header.appendChild(buildLinkBtn("poedb", "PoEDB"));
    header.appendChild(buildLinkBtn("ninja", "poe.ninja"));
    header.appendChild(buildLinkBtn("github", "GitHub"));
    header.appendChild(PTB.createRedirectControl(true, lucideEl("redirect")));
    const searchBtn = sbEl("button", "ptb-sb-searchbtn");
    searchBtn.type = "button";
    setIconBtn(searchBtn, "search", message("searchBookmarks", "Search"));
    searchBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      fx.bmSearchOpen = !fx.bmSearchOpen;
      searchBtn.classList.toggle("ptb-on", fx.bmSearchOpen);
      const bar = sidebar.querySelector(".ptb-sb-searchbar");
      if (bar) bar.hidden = !fx.bmSearchOpen;
      if (fx.bmSearchOpen) {
        const inp = bar && bar.querySelector(".ptb-sb-searchinput");
        if (inp) inp.focus();
      } else {
        fx.bmQuery = "";
        const inp = bar && bar.querySelector(".ptb-sb-searchinput");
        if (inp) inp.value = "";
        renderSidebarList();
      }
    });
    header.appendChild(searchBtn);
    if (globalThis.PTB && PTB.i18n) header.appendChild(buildLangPicker());
    const closeBtn = sbEl("button", "ptb-sb-close");
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", message("close", "Close"));
    closeBtn.appendChild(lucideEl("x", 14));
    closeBtn.addEventListener("click", () => setSidebarOpen(false));
    header.appendChild(closeBtn);
    sidebar.appendChild(header);
    const searchBar = sbEl("div", "ptb-sb-searchbar");
    searchBar.hidden = true;
    const searchInput = document.createElement("input");
    searchInput.type = "search";
    searchInput.className = "ptb-sb-searchinput";
    searchInput.placeholder = message("searchBookmarks", "Search");
    const searchClear = sbEl("button", "ptb-sb-searchclear");
    searchClear.type = "button";
    searchClear.hidden = true;
    setIconBtn(searchClear, "x", message("clearSearch", "Clear"));
    searchInput.addEventListener("input", () => {
      fx.bmQuery = searchInput.value;
      searchClear.hidden = !String(fx.bmQuery || "").trim();
      renderSidebarList();
    });
    searchClear.addEventListener("click", () => {
      searchInput.value = "";
      fx.bmQuery = "";
      searchClear.hidden = true;
      searchInput.focus();
      renderSidebarList();
    });
    searchBar.appendChild(searchInput);
    searchBar.appendChild(searchClear);
    sidebar.appendChild(searchBar);
    const fxbar = sbEl("div", "ptb-sb-fxbar");
    fxbar.hidden = true;
    const fxLabel = sbEl("span", "ptb-sb-fxlabel");
    fxLabel.appendChild(lucideEl("dollar", 16));
    fxLabel.title = message("baseCurrency", "Base");
    fxbar.appendChild(fxLabel);
    fxbar.appendChild(sbEl("div", "ptb-sb-bases"));
    const rateBtn = sbEl("button", "ptb-sb-ratebtn");
    rateBtn.type = "button";
    setIconBtn(rateBtn, "table", message("rateTable", "Rates"));
    rateBtn.addEventListener("click", () => {
      fx.tableOpen = !fx.tableOpen;
      rateBtn.classList.toggle("ptb-on", fx.tableOpen);
      const p = sidebar.querySelector(".ptb-sb-ratepanel");
      if (p) p.hidden = !fx.tableOpen;
      if (!fx.tableOpen) clearRateFocus();
      if (fx.tableOpen && p) {
        p.classList.toggle("ptb-editing", !!fx.rateEdit);
        const eb = p.querySelector(".ptb-sb-rateedit");
        if (eb) eb.classList.toggle("ptb-on", !!fx.rateEdit);
        renderRateTable();
      }
    });
    fxbar.appendChild(rateBtn);
    const fxstatus = sbEl("span", "ptb-sb-fxstatus");
    fxstatus.hidden = true;
    fxbar.appendChild(fxstatus);
    sidebar.appendChild(fxbar);
    const ratePanel = sbEl("div", "ptb-sb-ratepanel");
    ratePanel.hidden = true;
    const editBtn = sbEl("button", "ptb-sb-rateedit");
    editBtn.type = "button";
    setIconBtn(editBtn, "pencil", message("rateEdit", "Edit"));
    editBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      fx.rateEdit = !fx.rateEdit;
      editBtn.classList.toggle("ptb-on", fx.rateEdit);
      ratePanel.classList.toggle("ptb-editing", fx.rateEdit);
      if (!fx.rateEdit) blurRateFocus();
    });
    ratePanel.appendChild(editBtn);
    const rateSearch = document.createElement("input");
    rateSearch.type = "search";
    rateSearch.className = "ptb-sb-ratesearch";
    rateSearch.placeholder = message("rateSearch", "화폐 검색");
    rateSearch.addEventListener("input", () => {
      fx.tableQuery = rateSearch.value;
      renderRateHits();
    });
    ratePanel.appendChild(sbEl("div", "ptb-sb-ratesets"));
    rateSearch.hidden = true;
    ratePanel.appendChild(rateSearch);
    const rateHits = sbEl("div", "ptb-sb-ratehits");
    rateHits.hidden = true;
    ratePanel.appendChild(rateHits);
    sidebar.appendChild(ratePanel);
    sidebar.appendChild(sbEl("div", "ptb-collection-controls"));
    sidebar.appendChild(sbEl("div", "ptb-sb-list"));
    // 사이드바 휠은 거래소 본문으로 보내지 않음. 언어 메뉴·환율 패널이 스크롤 가능하면 그쪽 우선.
    sidebar.addEventListener(
      "wheel",
      (event) => {
        try {
          const amount = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
          let scroller = null;
          let node = event.target;
          if (node && node.nodeType !== 1) node = node.parentElement;
          while (node && node !== sidebar) {
            const canY = node.scrollHeight > node.clientHeight + 1;
            if (canY) {
              const oy = globalThis.getComputedStyle(node).overflowY;
              if (oy === "auto" || oy === "scroll") {
                scroller = node;
                break;
              }
            }
            node = node.parentElement;
          }
          if (!scroller) scroller = sidebar.querySelector(".ptb-sb-list");
          if (scroller) scroller.scrollTop += amount;
          event.preventDefault();
          event.stopPropagation();
        } catch (_error) {
          // ignore
        }
      },
      { passive: false }
    );
    document.body.appendChild(sidebar);
    state.sidebar = sidebar;
    applyGameTheme();
    if (fx.bundle) fillBaseSelect(fx.bundle, fx.base);
    return sidebar;
  };

  function setSidebarOpen(open) {
    state.sidebarOpen = open;
    const sidebar = ensureSidebar();
    if (sidebar) sidebar.classList.toggle("ptb-open", open);
    try {
      if (document.body) document.body.classList.toggle("ptb-has-sidebar", open);
    } catch (_error) {
      // ignore
    }
    const toggle = document.getElementById(SIDEBAR_TOGGLE_ID);
    if (toggle) toggle.classList.toggle("ptb-active", open);
    if (open) renderSidebarList();
    try {
      chrome.storage.local.set({ [SIDEBAR_OPEN_KEY]: open });
    } catch (_error) {
      // ignore
    }
  }

  const ensureSidebarToggle = () => {
    if (!document.body || document.getElementById(SIDEBAR_TOGGLE_ID)) return;
    const toggle = sbEl("button", "ptb-sidebar-toggle");
    toggle.id = SIDEBAR_TOGGLE_ID;
    toggle.type = "button";
    setIconBtn(toggle, "list", message("sidebarToggle", "List"));
    toggle.addEventListener("click", () => setSidebarOpen(!state.sidebarOpen));
    document.body.appendChild(toggle);
  };

  function renderPreferredSiteLink() {
    const code = state.redirectSettings?.code;
    const destination = code && code !== PTB.hostToRealm(location.hostname)
      ? PTB.tradeRegion.preferredUrl(location.href, state.redirectSettings) : null;
    let link = document.getElementById("ptb-preferred-site");
    if (!destination || !document.body) {
      link?.remove();
      return;
    }
    if (!link) {
      link = document.createElement("a");
      link.id = "ptb-preferred-site";
      link.className = "ptb-sidebar-toggle";
      // The trade app can change the search before the next URL poll.
      for (const event of ["click", "auxclick", "contextmenu"]) link.addEventListener(event, renderPreferredSiteLink);
      document.body.appendChild(link);
    }
    link.href = destination;
    link.textContent = code.toUpperCase();
    link.title = message("openPreferredTradeSite", "Open on preferred trade site") + " · " + link.textContent;
    link.setAttribute("aria-label", link.title);
  }

  const initSidebar = () => {
    try {
      ensureSidebarToggle();
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === "local" && (changes.bookmarkCollections || changes.bookmarkDefaultCollections)) {
          refreshSaveAvailability(parseCurrentUrl()?.game || null);
        }
        if (area === "local" && changes.ptbRedirectSettings) {
          state.redirectSettings = changes.ptbRedirectSettings.newValue || null;
          renderPreferredSiteLink();
        }
        if (area === "local" && state.sidebarOpen &&
            (changes.bookmarks || changes.bookmarkFolders || changes.bookmarkRootOrder || changes.bookmarkRecentGroups ||
             changes.bookmarkCollections || changes.bookmarkActiveCollections || changes.bookmarkDefaultCollections)) {
          renderSidebarList();
        }
      });
      chrome.runtime.sendMessage({ cmd: "ptb-redirect-settings" }).then(({ settings }) => {
        if (state.redirectSettings !== undefined) return;
        state.redirectSettings = settings?.configured ? settings : null;
        renderPreferredSiteLink();
      }).catch(() => {});
      chrome.storage.local
        .get(SIDEBAR_OPEN_KEY)
        .then((result) => {
          if (result && result[SIDEBAR_OPEN_KEY]) setSidebarOpen(true);
        })
        .catch(() => {});
    } catch (_error) {
      // best-effort
    }
  };

  // ── PoE 2 매물 가격 옆에 기축 환산 표시 ────────────────────────────
  const FX_CLASS = "ptb-fx";
  const SETS_KEY = "ptbRateSets";
  const PAIR_KEY = "ptbRatePair";
  const fx = {
    bundle: null,
    base: "divine",
    league: "",
    timer: 0,
    observer: null,
    sets: [],
    focus: null,
    dragId: "",
    tableOpen: false,
    tableQuery: "",
    rateEdit: false,
    game: null,
    bmQuery: "",
    bmSearchOpen: false,
  };

  const uiLang = () => {
    try {
      return (PTB.i18n && PTB.i18n.getLang && PTB.i18n.getLang()) || "en";
    } catch (_e) {
      return "en";
    }
  };

  const currentGame = () => (PTB.gameFromUrl ? PTB.gameFromUrl(globalThis.location?.href || "") : null);

  const currencyMeta = (id) => {
    const game = fx.game || currentGame();
    if (game === "poe1") return (PTB.currencyMetaPoe1 && PTB.currencyMetaPoe1[id]) || null;
    return (PTB.currencyMeta && PTB.currencyMeta[id]) || null;
  };

  const currencyNameMap = (id) => {
    const game = fx.game || currentGame();
    const pack = PTB.currencyNames && PTB.currencyNames[game === "poe1" ? "poe1" : "poe2"];
    return (pack && pack[id]) || null;
  };

  const currencyLabel = (id) => {
    const lang = uiLang();
    const names = currencyNameMap(id);
    if (lang && lang !== "en" && names && names[lang]) return names[lang];
    const meta = currencyMeta(id);
    if (lang === "ko" && meta && meta.ko) return meta.ko;
    return PTB.rates ? PTB.rates.itemName(fx.bundle, id) : id;
  };

  const currencyTier = (id) => {
    const s = String(id || "");
    if (s.indexOf("perfect-") === 0) return 3;
    if (s.indexOf("greater-") === 0) return 2;
    return 0;
  };

  const familyBaseId = (id) => {
    const s = String(id || "");
    if (s.indexOf("perfect-") !== 0 && s.indexOf("greater-") !== 0) return s;
    const rest = s.replace(/^(perfect|greater)-/, "");
    const aliases = {
      "orb-of-transmutation": "transmute",
      "orb-of-augmentation": "aug",
      "chaos-orb": "chaos",
      "exalted-orb": "exalted",
      "regal-orb": "regal",
      "jewellers-orb": "lesser-jewellers-orb",
    };
    const candidates = [];
    if (aliases[rest]) candidates.push(aliases[rest]);
    candidates.push(rest);
    if (rest.slice(-4) === "-orb") candidates.push(rest.slice(0, -4));
    candidates.push("lesser-" + rest);
    for (let i = 0; i < candidates.length; i += 1) {
      const c = candidates[i];
      if (!c || c === s) continue;
      if (currencyMeta(c)) return c;
      if (PTB.rates && PTB.rates.baseIds && PTB.rates.baseIds(currentGame()).indexOf(c) !== -1) return c;
    }
    return s;
  };

  const currencyIcon = (id) => {
    const look = familyBaseId(id);
    const game = fx.game || currentGame() || "poe2";
    try {
      if (look) {
        const folder = game === "poe1" ? "src/assets/currency/poe1/" : "src/assets/currency/";
        return chrome.runtime.getURL(folder + look + ".png");
      }
    } catch (_e) {}
    return (PTB.rates && PTB.rates.itemIcon(fx.bundle, look)) || "";
  };

  const newRateSetId = () => "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  const setsStorageKey = (game) => ((game || fx.game || currentGame()) === "poe1" ? "ptbRateSetsPoe1" : SETS_KEY);

  const persistSets = () => {
    try {
      chrome.storage.local.set({
        [setsStorageKey()]: (fx.sets || []).map((s) => ({ id: s.id, from: s.from || "", to: s.to || "" })),
      });
    } catch (_e) {}
  };

  const clearRateFocus = () => {
    fx.focus = null;
    fx.tableQuery = "";
    const panel = state.sidebar && state.sidebar.querySelector(".ptb-sb-ratepanel");
    const search = panel && panel.querySelector(".ptb-sb-ratesearch");
    if (search) {
      search.value = "";
      search.hidden = true;
    }
  };

  const blurRateFocus = () => {
    if (!fx.focus) return;
    clearRateFocus();
    const panel = state.sidebar && state.sidebar.querySelector(".ptb-sb-ratepanel");
    if (panel) {
      panel.querySelectorAll(".ptb-sb-rateslot.ptb-focus").forEach((el) => el.classList.remove("ptb-focus"));
    }
    renderRateHits();
  };

  const currentLeague = () => {
    try {
      const info = parseCurrentUrl();
      if (info && info.league) return info.league;
      const path = String(globalThis.location?.pathname || "");
      const m2 = path.match(/\/trade2\/(?:search|exchange)\/poe2\/([^/]+)/);
      const m1 = path.match(/\/trade\/(?:search|exchange)\/([^/]+)/);
      const m = m2 || m1;
      if (m) return PTB.decodePathPart ? PTB.decodePathPart(decodeURIComponent(m[1])) : decodeURIComponent(m[1]);
    } catch (_e) {}
    return null;
  };

  const parseListingPrice = (box) => {
    try {
      const clone = box.cloneNode(true);
      clone.querySelectorAll("." + FX_CLASS).forEach((n) => n.remove());
      let raw = "";
      const img = clone.querySelector("img[title], img[alt]");
      if (img) raw = img.getAttribute("title") || img.getAttribute("alt") || "";
      if (!raw) {
        const curEl = clone.querySelector(
          "[title].currency, .currency[title], .currency-text, span[class*='currency']"
        );
        if (curEl) raw = curEl.getAttribute("title") || curEl.getAttribute("alt") || curEl.textContent || "";
      }
      if (!raw) {
        const cls = String(clone.className || "") + " " + clone.innerHTML;
        const cm = cls.match(/currency-([a-z0-9-]+)/i);
        if (cm) raw = cm[1];
      }
      const currency = PTB.rates.resolveId(fx.bundle, raw, fx.game);
      const text = clone.textContent || "";
      const m = text.split("≈", 1)[0].match(/\d+(?:[.,\u00a0\u202f]\d+)*/);
      const amount = m ? Number(m[0].replace(/[\u00a0\u202f]/g, "").split(priceGroup).join("").replace(priceDecimal, ".")) : NaN;
      return { amount, currency };
    } catch (_e) {
      return { amount: NaN, currency: null };
    }
  };

  const tradeRegion = PTB.hostToRealm(location.host);
  const priceLocale = { kr: "ko", br: "pt-BR", jp: "ja", tw: "zh-TW" }[tradeRegion] || tradeRegion;
  const priceParts = new Intl.NumberFormat(priceLocale).formatToParts(1234.5);
  const priceGroup = priceParts.find(part => part.type === "group")?.value || ",";
  const priceDecimal = priceParts.find(part => part.type === "decimal")?.value || ".";

  const listingTargets = () => {
    const rows = document.querySelectorAll(
      ".resultset .row[data-id], .results .row[data-id], .row[data-id]"
    );
    const out = [];
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      if (row.closest && row.closest(".ptb-sidebar")) continue;
      const box =
        row.querySelector("[data-field='price']") ||
        row.querySelector(".price") ||
        row.querySelector(".details");
      if (!box) continue;
      out.push({ row: row, box: box, id: row.getAttribute("data-id") });
    }
    return out;
  };

  // A reused result row can still belong to the previous URL while the trade app loads.
  const observedRows = new WeakMap();
  function readListingPrices() {
    const listings = [];
    for (const target of listingTargets()) {
      const previous = observedRows.get(target.row);
      if (previous?.id === target.id && previous.search !== state.href) continue;
      observedRows.set(target.row, { id: target.id, search: state.href });
      listings.push({ box: target.box, price: parseListingPrice(target.box) });
    }
    return listings;
  }

  function observedMinimum(info, listings) {
    const prices = listings.map(listing => listing.price).filter(price => price.amount > 0 && Number.isFinite(price.amount));
    if (prices.some(price => !price.currency)) return null;
    const bundle = fx.bundle?.game === info.game && fx.bundle.league === info.league ? fx.bundle : null;
    const best = PTB.rates.lowestListing(prices, bundle);
    return best && { ...best, at: Date.now() };
  }

  let lastObservation = "";
  function syncSearchPrice(listings) {
    const info = parseCurrentUrl();
    if (!info || location.href !== state.href) return;
    const price = observedMinimum(info, listings);
    if (!price) return;
    const key = JSON.stringify([state.href, price.amount, price.currency]);
    if (key === lastObservation) return;
    lastObservation = key;
    PTB.storage.recordSearchPrice(info, price).catch(() => {
      if (lastObservation === key) lastObservation = "";
    });
  }
  const buildLowPriceRow = (bookmark) => {
    const wrap = sbEl("div", "ptb-sb-low");
    const lp = bookmark.lowPrice;
    if (lp && lp.amount != null && lp.currency) {
      wrap.title = PTB.observedPriceLabel(lp);
      appendCurrIcon(wrap, lp.currency);
      wrap.appendChild(document.createTextNode(" " + formatListedAmount(lp.amount)));
    }
    return wrap;
  };

  const setFxStatus = (text) => {
    const st = state.sidebar && state.sidebar.querySelector(".ptb-sb-fxstatus");
    if (!st) return;
    st.textContent = text || "";
    st.hidden = !text;
  };

  const fillBaseSelect = (bundle, base) => {
    const wrap = state.sidebar && state.sidebar.querySelector(".ptb-sb-bases");
    if (!wrap || !PTB.rates) return;
    const game = fx.game || currentGame();
    const ids = PTB.rates.baseIds ? PTB.rates.baseIds(game) : ["mirror", "divine", "chaos"];
    const chosen = PTB.rates.clampBase ? PTB.rates.clampBase(base, game) : base || PTB.rates.DEFAULT_BASE;
    fx.base = chosen;
    wrap.textContent = "";
    ids.forEach((id) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ptb-sb-basebtn" + (id === chosen ? " ptb-on" : "");
      btn.dataset.id = id;
      const name = currencyLabel(id);
      btn.title = name;
      const img = document.createElement("img");
      img.src = currencyIcon(id);
      img.alt = name;
      img.draggable = false;
      btn.appendChild(img);
      btn.addEventListener("click", () => {
        fx.base = id;
        wrap.querySelectorAll(".ptb-sb-basebtn").forEach((b) => b.classList.toggle("ptb-on", b.dataset.id === id));
        paintListingFx();
        PTB.rates.setBase(id, fx.game || currentGame()).catch(() => {});
      });
      wrap.appendChild(btn);
    });
    renderRateTable();
  };

  const appendCurrIcon = (parent, id) => {
    const src = currencyIcon(id);
    const name = currencyLabel(id);
    if (!src) return;
    const wrap = document.createElement("span");
    wrap.className = "ptb-curr";
    const img = document.createElement("img");
    img.src = src;
    img.alt = name;
    img.title = name;
    img.draggable = false;
    wrap.appendChild(img);
    const tier = currencyTier(id);
    if (tier === 2 || tier === 3) {
      const mark = document.createElement("span");
      mark.className = "ptb-curr-mark";
      mark.textContent = tier === 3 ? "III" : "II";
      wrap.appendChild(mark);
    }
    parent.appendChild(wrap);
  };

  const renderPairSlot = (slot, id, focused) => {
    slot.textContent = "";
    slot.classList.toggle("ptb-on", !!id);
    slot.classList.toggle("ptb-focus", !!focused);
    if (!id) {
      slot.appendChild(document.createTextNode("?"));
      return;
    }
    appendCurrIcon(slot, id);
  };

  const focusRateSlot = (setId, which) => {
    if (!fx.rateEdit) return;
    if (fx.focus && fx.focus.id === setId && fx.focus.slot === which) {
      clearRateFocus();
      renderRateTable();
      return;
    }
    fx.focus = { id: setId, slot: which };
    fx.tableQuery = "";
    const panel = state.sidebar && state.sidebar.querySelector(".ptb-sb-ratepanel");
    const search = panel && panel.querySelector(".ptb-sb-ratesearch");
    if (search) {
      search.hidden = false;
      search.value = "";
    }
    renderRateTable();
    if (search) {
      try {
        search.focus();
      } catch (_e) {}
    }
  };

  const pickFocusedCurrency = (id) => {
    if (!fx.focus) return;
    const set = (fx.sets || []).find((s) => s.id === fx.focus.id);
    if (!set) return;
    set[fx.focus.slot] = id;
    persistSets();
    clearRateFocus();
    renderRateTable();
  };

  const familyGroupId = (id) => {
    const s = String(id || "");
    if (s.indexOf("lesser-") === 0) {
      const rest = s.slice(7);
      if (currencyMeta(rest)) return rest;
      if (PTB.rates && PTB.rates.baseIds && PTB.rates.baseIds(currentGame()).indexOf(rest) !== -1) return rest;
      return s;
    }
    return familyBaseId(s);
  };

  const familyRank = (id) => {
    const s = String(id || "");
    if (s.indexOf("perfect-") === 0) return 3;
    if (s.indexOf("greater-") === 0) return 2;
    if (s.indexOf("lesser-") === 0) return 0;
    return 1;
  };

  const parkRateAddButton = (list) => {
    if (!list) return;
    const add = list.querySelector(".ptb-sb-rateadd");
    if (!add) return;
    const rows = list.querySelectorAll(".ptb-sb-rateset[data-id]");
    const last = rows[rows.length - 1];
    if (last && add.parentNode !== last) last.appendChild(add);
  };

  const commitRateSetOrder = (list) => {
    if (!list) return;
    const byId = {};
    (fx.sets || []).forEach((s) => {
      if (s && s.id) byId[s.id] = s;
    });
    const next = [];
    list.querySelectorAll(".ptb-sb-rateset[data-id]").forEach((row) => {
      const s = byId[row.dataset.id];
      if (s) next.push(s);
    });
    if (next.length) fx.sets = next;
    persistSets();
    parkRateAddButton(list);
  };

  const placeDraggingSet = (overRow, clientY) => {
    const list = overRow && overRow.parentNode;
    if (!list) return;
    const dragging = list.querySelector(".ptb-sb-rateset.ptb-dragging");
    if (!dragging || dragging === overRow || !overRow.dataset.id) return;
    const rect = overRow.getBoundingClientRect();
    const after = clientY > rect.top + rect.height / 2;
    if (after) {
      if (overRow.nextSibling === dragging) return;
      list.insertBefore(dragging, overRow.nextSibling);
    } else {
      if (dragging.nextSibling === overRow) return;
      list.insertBefore(dragging, overRow);
    }
    parkRateAddButton(list);
  };

  const makeRateHit = (id) => {
    const row = sbEl("button", "ptb-sb-raterow");
    row.type = "button";
    appendCurrIcon(row, id);
    row.appendChild(sbEl("span", "ptb-sb-ratename", currencyLabel(id)));
    row.addEventListener("click", () => pickFocusedCurrency(id));
    return row;
  };

  const makeRateSetRow = (set) => {
    const row = sbEl("div", "ptb-sb-rateset");
    row.dataset.id = set.id;
    const grip = sbEl("span", "ptb-sb-rategrip", "⋮⋮");
    grip.title = "";
    grip.draggable = true;
    grip.addEventListener("dragstart", (e) => {
      fx.dragId = set.id;
      try {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", set.id);
      } catch (_e) {}
      row.classList.add("ptb-dragging");
    });
    grip.addEventListener("dragend", () => {
      fx.dragId = "";
      row.classList.remove("ptb-dragging");
      commitRateSetOrder(row.parentNode);
    });
    row.addEventListener("dragover", (e) => {
      e.preventDefault();
      try {
        e.dataTransfer.dropEffect = "move";
      } catch (_err) {}
      placeDraggingSet(row, e.clientY);
    });
    row.addEventListener("drop", (e) => {
      e.preventDefault();
    });

    const fromBtn = sbEl("button", "ptb-sb-rateslot");
    fromBtn.type = "button";
    fromBtn.title = currencyLabel(set.from) || "";
    renderPairSlot(fromBtn, set.from, fx.focus && fx.focus.id === set.id && fx.focus.slot === "from");
    fromBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!fx.rateEdit) return;
      focusRateSlot(set.id, "from");
    });
    const colon = sbEl("button", "ptb-sb-ratecolon", "→");
    colon.type = "button";
    colon.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!fx.rateEdit) return;
      const from = set.from;
      set.from = set.to;
      set.to = from;
      if (fx.focus && fx.focus.id === set.id) {
        fx.focus.slot = fx.focus.slot === "from" ? "to" : "from";
      }
      persistSets();
      renderRateTable();
    });
    const val = sbEl("span", "ptb-sb-rateval", "—");
    if (set.from && set.to && fx.bundle && PTB.rates) {
      const conv = PTB.rates.convert(fx.bundle, 1, set.from, set.to);
      if (conv != null) val.textContent = PTB.rates.format3(conv);
    }
    const toBtn = sbEl("button", "ptb-sb-rateslot");
    toBtn.type = "button";
    toBtn.title = currencyLabel(set.to) || "";
    renderPairSlot(toBtn, set.to, fx.focus && fx.focus.id === set.id && fx.focus.slot === "to");
    toBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!fx.rateEdit) return;
      focusRateSlot(set.id, "to");
    });
    const del = sbEl("button", "ptb-sb-ratedel", "✕");
    del.type = "button";
    del.title = message("delete", "Delete");
    del.addEventListener("click", (e) => {
      e.stopPropagation();
      fx.sets = (fx.sets || []).filter((s) => s.id !== set.id);
      if (fx.focus && fx.focus.id === set.id) clearRateFocus();
      persistSets();
      renderRateTable();
    });
    row.appendChild(grip);
    row.appendChild(fromBtn);
    row.appendChild(colon);
    row.appendChild(val);
    row.appendChild(toBtn);
    row.appendChild(del);
    return row;
  };

  const renderRateHits = () => {
    const panel = state.sidebar && state.sidebar.querySelector(".ptb-sb-ratepanel");
    const hitsEl = panel && panel.querySelector(".ptb-sb-ratehits");
    const search = panel && panel.querySelector(".ptb-sb-ratesearch");
    if (!hitsEl) return;
    hitsEl.textContent = "";
    const focused = !!fx.focus;
    hitsEl.hidden = !focused;
    if (search) search.hidden = !focused;
    if (!focused) return;
    const q = String(fx.tableQuery || "").trim().toLowerCase();
    const items = ((fx.bundle && fx.bundle.items) || [])
      .slice()
      .sort((a, b) => {
        const ga = familyGroupId(a.id);
        const gb = familyGroupId(b.id);
        const nameCmp = currencyLabel(ga).localeCompare(currencyLabel(gb), undefined, { sensitivity: "base" });
        if (nameCmp) return nameCmp;
        const ra = familyRank(a.id);
        const rb = familyRank(b.id);
        if (ra !== rb) return ra - rb;
        return currencyLabel(a.id).localeCompare(currencyLabel(b.id), undefined, { sensitivity: "base" });
      });
    let n = 0;
    for (let i = 0; i < items.length; i += 1) {
      const it = items[i];
      if (!it || !it.id) continue;
      if (q) {
        const en = String(it.name || "").toLowerCase();
        const id = String(it.id).toLowerCase();
        const lang = uiLang();
        const names = currencyNameMap(it.id) || {};
        const local = String((lang !== "en" && names[lang]) || "").toLowerCase();
        if (en.indexOf(q) === -1 && id.indexOf(q) === -1 && local.indexOf(q) === -1) continue;
      }
      hitsEl.appendChild(makeRateHit(it.id));
      n += 1;
      if (n >= 80) break;
    }
  };

  const renderRateTable = () => {
    const panel = state.sidebar && state.sidebar.querySelector(".ptb-sb-ratepanel");
    if (!panel || panel.hidden || !PTB.rates) return;
    const list = panel.querySelector(".ptb-sb-ratesets");
    if (!list) return;
    list.textContent = "";
    (fx.sets || []).forEach((set) => list.appendChild(makeRateSetRow(set)));
    const addSetBtn = sbEl("button", "ptb-sb-rateadd", "+");
    addSetBtn.type = "button";
    addSetBtn.title = message("rateAdd", "Add");
    addSetBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      fx.sets.push({ id: newRateSetId(), from: "", to: "" });
      clearRateFocus();
      persistSets();
      renderRateTable();
    });
    const last = list.lastChild;
    if (last) last.appendChild(addSetBtn);
    else {
      const row = sbEl("div", "ptb-sb-rateset");
      row.appendChild(addSetBtn);
      list.appendChild(row);
    }
    renderRateHits();
  };

  const paintListingFx = () => {
    if (location.href !== state.href) return;
    const listings = readListingPrices();
    syncSearchPrice(listings);
    const game = PTB.gameFromUrl ? PTB.gameFromUrl(globalThis.location?.href || "") : null;
    if ((game !== "poe1" && game !== "poe2") || !fx.bundle || !PTB.rates) {
      document.querySelectorAll("." + FX_CLASS).forEach((n) => n.remove());
      return;
    }
    const base = PTB.rates.clampBase ? PTB.rates.clampBase(fx.base) : fx.base || PTB.rates.DEFAULT_BASE;
    const baseName = currencyLabel(base);
    const baseIcon = currencyIcon(base);
    for (const { box, price: parsed } of listings) {
      let amountText = "";
      if (
        Number.isFinite(parsed.amount) &&
        parsed.currency &&
        parsed.currency !== base
      ) {
        const conv = PTB.rates.convert(fx.bundle, parsed.amount, parsed.currency, base);
        if (conv != null) amountText = PTB.rates.format3(conv);
      }
      const key = parsed.amount + "|" + parsed.currency + "|" + base + "|" + amountText;
      let tag = box.querySelector("." + FX_CLASS);
      if (!amountText) {
        if (tag) tag.remove();
        continue;
      }
      if (!tag) {
        tag = document.createElement("span");
        tag.className = FX_CLASS;
        box.appendChild(tag);
      }
      if (tag.dataset.ptbFx !== key) {
        tag.dataset.ptbFx = key;
        tag.textContent = "";
        tag.appendChild(document.createTextNode("≈ " + amountText + " "));
        if (baseIcon) {
          const img = document.createElement("img");
          img.src = baseIcon;
          img.alt = baseName;
          img.title = baseName;
          img.draggable = false;
          tag.appendChild(img);
        } else {
          tag.appendChild(document.createTextNode(baseName));
        }
      }
    }
  };

  const schedulePaintFx = () => {
    if (fx.timer) return;
    fx.timer = globalThis.setTimeout(() => {
      fx.timer = 0;
      paintListingFx();
    }, 80);
  };

  const ensureFxObserver = () => {
    if (fx.observer || !document.body) return;
    fx.observer = new MutationObserver((muts) => {
      for (let i = 0; i < muts.length; i += 1) {
        const t = muts[i].target;
        if (t && t.classList && t.classList.contains(FX_CLASS)) continue;
        if (t && t.closest && t.closest("." + FX_CLASS)) continue;
        schedulePaintFx();
        return;
      }
    });
    fx.observer.observe(document.body, { childList: true, characterData: true, subtree: true,
      attributes: true, attributeFilter: ["data-id", "title", "alt"] });
  };

  let ratesRequest = 0;
  const refreshListingFx = async () => {
    if (!PTB.rates) return;
    const request = ++ratesRequest;
    const game = currentGame();
    fx.game = game;
    if (game !== "poe1" && game !== "poe2") {
      fx.bundle = null;
      paintListingFx();
      return;
    }
    const league = currentLeague();
    if (fx.bundle?.game !== game || fx.bundle?.league !== league) fx.bundle = null;
    ensureFxObserver();
    schedulePaintFx();
    try {
      fx.base = await PTB.rates.getBase(game);
    } catch (_e) {
      fx.base = PTB.rates.DEFAULT_BASE;
    }
    try {
      const r = await chrome.storage.local.get(setsStorageKey(game));
      const saved = r && r[setsStorageKey(game)];
      fx.sets = Array.isArray(saved)
        ? saved.map((s) => ({ id: (s && s.id) || newRateSetId(), from: (s && s.from) || "", to: (s && s.to) || "" }))
        : [];
    } catch (_e) {}
    if (league) {
      fx.league = league;
      try {
        const bundle = await PTB.rates.get(league, game);
        if (request !== ratesRequest) return;
        fx.bundle = bundle;
      } catch (_e) {
        if (request !== ratesRequest) return;
        fx.bundle = null;
      }
    }
    fillBaseSelect(fx.bundle, fx.base);
    if (league && !fx.bundle) {
      setFxStatus(message("ratesFailed", "Couldn't load rates. Reload the extension."));
    } else {
      setFxStatus("");
    }
    paintListingFx();
    renderRateTable();
  };

  const initListingFx = () => {
    if (!PTB.rates) return;
    try {
      document.addEventListener(
        "pointerdown",
        (e) => {
          if (!fx.focus) return;
          const t = e.target;
          if (!t || !t.closest) return;
          if (t.closest(".ptb-sb-ratesearch") || t.closest(".ptb-sb-ratehits") || t.closest(".ptb-sb-rateslot")) {
            return;
          }
          blurRateFocus();
        },
        true
      );
    } catch (_e) {}
    try {
      chrome.runtime.sendMessage({ cmd: "ptb-ping" }, () => {
        void chrome.runtime.lastError;
      });
    } catch (_e) {}
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== "local") return;
        if (changes.ptbBaseCurrency || changes.ptbBaseCurrencyPoe1) {
          PTB.rates.getBase(currentGame()).then((b) => {
            fx.base = b;
            fillBaseSelect(fx.bundle, fx.base);
            paintListingFx();
            renderRateTable();
          });
        }
        const sk = setsStorageKey();
        if (changes[sk] && Array.isArray(changes[sk].newValue)) {
          fx.sets = changes[sk].newValue.map((s) => ({
            id: s.id || newRateSetId(),
            from: s.from || "",
            to: s.to || "",
          }));
          renderRateTable();
        }
      });
    } catch (_e) {}
    try {
      chrome.storage.local.get([SETS_KEY, PAIR_KEY]).then((r) => {
        const saved = r && r[SETS_KEY];
        if (Array.isArray(saved) && saved.length) {
          fx.sets = saved.map((s) => ({
            id: (s && s.id) || newRateSetId(),
            from: (s && s.from) || "",
            to: (s && s.to) || "",
          }));
        } else {
          const p = r && r[PAIR_KEY];
          if (p && (p.from || p.to)) {
            fx.sets = [{ id: newRateSetId(), from: p.from || "", to: p.to || "" }];
            persistSets();
          }
        }
        renderRateTable();
      }).catch(() => {});
    } catch (_e) {}
    refreshListingFx().catch(() => {});
    try {
      globalThis.setInterval(() => {
        refreshListingFx().catch(() => {});
      }, 5 * 60 * 1000);
    } catch (_e) {}
  };

  const start = () => {
    const cleanUrl = PTB.tradeRegion.stripOverride(location.href);
    if (cleanUrl) history.replaceState(history.state, "", cleanUrl);
    if (globalThis.PTB && PTB.i18n) {
      // 초기 로드 + 언어 변경(이 탭/팝업/대시보드 어디서든) 시 사이드바 UI 갱신.
      const applyLocale = function () {
        try {
          const toggle = document.getElementById(SIDEBAR_TOGGLE_ID);
          if (toggle) setIconBtn(toggle, "list", message("sidebarToggle", "List"));
          reconcile();
          if (state.sidebar) {
            state.sidebar.querySelector(".ptb-sb-close")?.setAttribute("aria-label", message("close", "Close"));
            const lb = state.sidebar.querySelector(".ptb-sb-langbtn");
            if (lb) lb.title = message("language", "Language");
            const sb = state.sidebar.querySelector(".ptb-sb-searchbtn");
            if (sb) sb.title = message("searchBookmarks", "Search");
            const si = state.sidebar.querySelector(".ptb-sb-searchinput");
            if (si) si.placeholder = message("searchBookmarks", "Search");
            const sc = state.sidebar.querySelector(".ptb-sb-searchclear");
            if (sc) sc.title = message("clearSearch", "Clear");
            const db = state.sidebar.querySelectorAll("a.ptb-sb-extlink");
            if (db[0]) db[0].title = message("openPoedb", "PoEDB");
            if (db[1]) db[1].title = message("openNinja", "poe.ninja");
            if (db[2]) db[2].title = message("openGithub", "GitHub");
            const fl = state.sidebar.querySelector(".ptb-sb-fxlabel");
            if (fl) fl.title = message("baseCurrency", "Base");
            const rb = state.sidebar.querySelector(".ptb-sb-ratebtn");
            if (rb) setIconBtn(rb, "table", message("rateTable", "Rates"));
            const rs = state.sidebar.querySelector(".ptb-sb-ratesearch");
            if (rs) rs.placeholder = message("rateSearch", "화폐 검색");
            const ra = state.sidebar.querySelector(".ptb-sb-rateadd");
            if (ra) ra.title = message("rateAdd", "Add");
            const re = state.sidebar.querySelector(".ptb-sb-rateedit");
            if (re) setIconBtn(re, "pencil", message("rateEdit", "Edit"));
            fillBaseSelect(fx.bundle, fx.base);
            renderRateTable();
            schedulePaintFx();

          }
          if (state.sidebarOpen) renderSidebarList();
        } catch (_e) {}
      };
      try {
        PTB.i18n.init().then(applyLocale);
        PTB.i18n.onChange(applyLocale);
      } catch (_e) {}
    }
    patchHistory();
    initSidebar();
    initListingFx();
    document.addEventListener("click", () => closeLangMenus());
    globalThis.addEventListener?.("popstate", scheduleReconcile);
    globalThis.addEventListener?.("hashchange", scheduleReconcile);

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", reconcile, { once: true });
    } else {
      reconcile();
    }

    globalThis.setInterval(() => {
      try {
        if (state.href !== (globalThis.location?.href || "") || !state.button) {
          reconcile();
        }
      } catch (_error) {
        hideButton();
      }
    }, URL_POLL_MS);
  };

  try {
    start();
  } catch (_error) {
    hideButton();
  }
})();
