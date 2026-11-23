// Canonical international hosts published in GGG's hreflang links. Taiwan has its own realm.
(() => {
  const regions = {
    kr: ["poe.kakaogames.com", "한국어 · KR"],
    en: ["www.pathofexile.com", "English · EN"],
    jp: ["jp.pathofexile.com", "日本語 · JP"],
    de: ["de.pathofexile.com", "Deutsch · DE"],
    fr: ["fr.pathofexile.com", "Français · FR"],
    es: ["es.pathofexile.com", "Español · ES"],
    br: ["br.pathofexile.com", "Português · BR"],
    ru: ["ru.pathofexile.com", "Русский · RU"],
    th: ["th.pathofexile.com", "ไทย · TH"],
  };
  const hosts = new Set(["pathofexile.com", ...Object.values(regions).map(([host]) => host)]);
  const override = "ptb_region_once";
  const redirectId = 9101;
  const overrideId = 9102;
  const sourceId = 9103;
  const queryId = 9104;
  const profileIds = { poe1: 9105, poe2: 9106 };
  const profilePaths = {
    poe1: "/trade(?:/search(?:/[^?#]*)?)?/?",
    poe2: "/trade2(?:/search(?:/poe2(?:/[^?#]*)?)?)?/?",
  };
  const statuses = ["available", "securable", "onlineleague", "online", "any"];
  const queryTransferPage = () => chrome.runtime.getURL("src/region/query.html");
  const queryPath = "/(?:trade/search|trade2/search/poe2)/[^/?#]+/?";
  const queryRoute = new RegExp("^" + queryPath + "$");
  const isQuerySearch = (url) => allowed(url) && queryRoute.test(url.pathname) && url.searchParams.has("q");
  const tradePath = "/trade2?(?:[/?#].*)?";
  // Factor the common suffix to keep both compiled RE2 rules under Chrome's 2 KB limit.
  function hostRegex(values) {
    const set = new Set(values);
    const prefixes = [...set].filter((host) => host.endsWith(".pathofexile.com")).map((host) => host.split(".")[0]);
    const subdomain = "(?:(?:" + prefixes.join("|") + ")\\.)" + (set.has("pathofexile.com") ? "?" : "");
    const kakao = set.has("poe.kakaogames.com") ? "|poe\\.kakaogames\\.com" : "";
    return "(?:" + subdomain + "pathofexile\\.com" + kakao + ")";
  }
  const allowed = (url) => url.protocol === "https:" && !url.username && !url.password &&
    hosts.has(url.host) && /^\/trade2?(?:\/|$)/.test(url.pathname);

  function tradeUrl(href, code, explicit = false) {
    if (!Object.hasOwn(regions, code)) return null;
    let url;
    try { url = new URL(href); } catch { return null; }
    if (!allowed(url)) return null;
    if (explicit && url.hostname !== regions[code][0] && isQuerySearch(url)) {
      return queryTransferPage() + "?to=" + code + "&" + url.href;
    }
    if (explicit && url.hostname !== regions[code][0] && /\/H4sI[^/]+(?:\/live)?\/?$/.test(url.pathname)) {
      url.search += (url.search ? "&" : "?") + "ptb_from=" + url.hostname;
    }
    url.hostname = regions[code][0];
    if (explicit) url.search += (url.search ? "&" : "?") + override + "=1";
    return url.href;
  }

  function rules(code, profiles = {}) {
    if (code !== "" && !Object.hasOwn(regions, code)) return [];
    const games = Object.entries(profileIds).filter(([game]) => profiles[game]?.league || profiles[game]?.status);
    if (!code && !games.length) return [];
    const target = regions[code]?.[0];
    const sources = [...hosts].filter((host) => host !== target && !(code === "en" && host === "pathofexile.com"));
    // The explicit region selected in a bookmark's menu wins for that navigation,
    // including native new-tab opens. The landing page removes the private marker.
    return [
      ...(target ? [{
        id: redirectId, priority: 1,
        action: { type: "redirect", redirect: { regexSubstitution: "https://" + target + "\\1" } },
        condition: {
          regexFilter: "^https://" + hostRegex(sources) + "(" + tradePath + ")$",
          resourceTypes: ["main_frame"], isUrlFilterCaseSensitive: true,
        },
      }] : []),
      {
        id: overrideId, priority: 4,
        action: { type: "allow" },
        condition: {
          regexFilter: "^https://" + hostRegex(hosts) + "/trade2?(?:/[^?]*)?\\?(?:[^#]*&)?" + override + "=1(?:[&#]|$)",
          resourceTypes: ["main_frame"], isUrlFilterCaseSensitive: true,
        },
      },
      ...(target ? [{
        id: sourceId, priority: 2,
        action: { type: "redirect", redirect: { regexSubstitution: "https://" + target + "\\2?ptb_from=\\1&\\3" } },
        condition: {
          regexFilter: "^https://(" + hostRegex(sources) + ")(/trade2?/search/[^?]+/H4sI[^?]*)(?:\\?(.*))?$",
          resourceTypes: ["main_frame"], isUrlFilterCaseSensitive: true,
        },
      },
      {
        id: queryId, priority: 2,
        action: { type: "redirect", redirect: { regexSubstitution: queryTransferPage() + "?to=" + code + "&\\0" } },
        condition: {
          regexFilter: "^https://" + hostRegex(sources) + queryPath + "\\?(?:[^&]*&)*q=.*$",
          resourceTypes: ["main_frame"], isUrlFilterCaseSensitive: true,
        },
      }] : []),
      ...games.map(([game, id]) => ({
        id, priority: 3,
        action: { type: "redirect", redirect: { regexSubstitution: queryTransferPage() + "?auto=" + (code || "source") + "&\\0" } },
        condition: {
          regexFilter: "^https://" + hostRegex(hosts) + profilePaths[game] + "(?:[?#].*)?$",
          resourceTypes: ["main_frame"], isUrlFilterCaseSensitive: true,
        },
      })),
    ];
  }

  function manualRule(tabId, href) {
    const url = new URL(href);
    if (!Number.isInteger(tabId) || tabId < 0 || !allowed(url)) throw Error("Invalid manual destination");
    const root = PTB.gameFromUrl(href) === "poe2" ? "trade2" : "trade";
    return {
      id: tabId + 1, priority: 5, action: { type: "allow" },
      condition: { tabIds: [tabId], resourceTypes: ["main_frame"],
        regexFilter: "^https://" + url.host.replace(/\./g, "\\.") + "/" + root + "(?:[/?#]|$)" },
    };
  }

  async function getPreference() {
    const all = await chrome.declarativeNetRequest.getDynamicRules();
    const active = all.find((rule) => rule.id === redirectId);
    const replacement = active?.action.redirect?.regexSubstitution;
    return Object.keys(regions).find((code) => replacement === "https://" + regions[code][0] + "\\1") || "";
  }

  function stripOverride(href) {
    const url = new URL(href);
    if (!allowed(url) || (!url.searchParams.has(override, "1") && !hosts.has(url.searchParams.get("ptb_from")))) return null;
    // Keep the site's encoded query (including ?q=) byte-for-byte.
    url.search = url.search.slice(1).split("&").filter((part) => part !== override + "=1" && !part.startsWith("ptb_from=")).join("&");
    return url.href;
  }

  function label(ko, en) {
    return PTB.i18n.getLang() === "ko" ? ko : en;
  }

  function splitButton(jump, bookmark, navigate) {
    const href = PTB.buildTradeUrl(bookmark);
    if (!tradeUrl(href, "en")) return jump;
    const wrap = document.createElement("div");
    wrap.className = "ptb-region-split";
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "ptb-region-trigger " + jump.className;
    trigger.title = label("다른 국가 거래소에서 열기", "Open on another trade site");
    trigger.setAttribute("aria-label", trigger.title);
    trigger.setAttribute("aria-expanded", "false");
    trigger.textContent = "▾";
    const menu = document.createElement("div");
    menu.className = "ptb-region-menu";
    menu.setAttribute("popover", "auto");
    trigger.addEventListener("click", () => {
      if (menu.matches(":popover-open")) return menu.hidePopover();
      menu.replaceChildren();
      for (const [code, [, name]] of Object.entries(regions)) {
        const link = document.createElement("a");
        // Resolve the destination before the tab encounters a login or challenge page.
        link.href = queryTransferPage() + "?manual=" + code + "&" + href;
        link.textContent = name;
        link.addEventListener("click", (event) => {
          menu.hidePopover();
          if (navigate) {
            event.preventDefault();
            navigate(link.href, event);
          }
        });
        menu.appendChild(link);
      }
      menu.showPopover();
      const rect = trigger.getBoundingClientRect();
      const { width, height } = menu.getBoundingClientRect();
      menu.style.left = Math.max(4, Math.min(rect.right - width, innerWidth - width - 4)) + "px";
      menu.style.top = Math.max(4, Math.min(rect.bottom + 3, innerHeight - height - 4)) + "px";
      menu.firstChild.focus({ preventScroll: true });
    });
    menu.addEventListener("toggle", () => trigger.setAttribute("aria-expanded", String(menu.matches(":popover-open"))));
    wrap.append(jump, trigger, menu);
    return wrap;
  }
  PTB.tradeRegion = { regions, statuses, tradeUrl, rules, stripOverride, splitButton, getPreference, isQuerySearch, manualRule,
    setPreference(code, profiles) {
      return chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [redirectId, overrideId, sourceId, queryId, ...Object.values(profileIds)], addRules: rules(code, profiles) });
    },
  };
})();
