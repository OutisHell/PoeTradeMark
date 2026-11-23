// A shared ?q= link is consumed on page load. Translate before any trade site receives it.
(async () => {
  const prefix = /^\?(to|auto|preferred|manual)=([a-z]+)&/.exec(location.search);
  let source;
  async function allowManualVisit(tabId, href) {
    const guard = PTB.tradeRegion.manualRule(tabId, href);
    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [guard.id], addRules: [guard] });
  }
  try {
    const bookmarkId = location.search.startsWith("?bookmark=") && new URLSearchParams(location.search).get("bookmark");
    if (bookmarkId) {
      const { bookmarks } = await chrome.storage.local.get("bookmarks");
      const bookmark = bookmarks?.find(item => item.id === bookmarkId);
      if (!bookmark) throw Error("Bookmark unavailable");
      const href = PTB.buildTradeUrl(bookmark);
      const url = new URL(href);
      if (!PTB.parseTradeUrl(href) || url.host !== bookmark.host || url.username || url.password) throw Error("Invalid bookmark URL");
      const tab = await chrome.tabs.getCurrent();
      let destination = href;
      if (PTB.tradeRegion.tradeUrl(href, "en")) {
        source = url;
        if (!new URLSearchParams(location.search).has("original")) {
          const { settings } = await chrome.runtime.sendMessage({ cmd: "ptb-redirect-settings" });
          if (settings?.code) destination = await PTB.manualTradeDestination(href, settings.code);
        }
        await allowManualVisit(tab.id, destination);
      }
      const token = crypto.randomUUID();
      await chrome.storage.session.set({ ["ptbVisit:" + tab.id]: { id: bookmarkId, href, destination, token } });
      return location.replace(destination + "#ptb-visit=" + token);
    }
    if (!prefix) throw new Error("Missing destination");
    source = new URL(location.search.slice(prefix[0].length) + location.hash);
    if (prefix[1] === "manual") {
      const code = prefix[2];
      const href = await PTB.manualTradeDestination(source.href, code);
      const tab = await chrome.tabs.getCurrent();
      await allowManualVisit(tab.id, href);
      location.replace(href);
    } else if (prefix[1] !== "to") {
      const { settings } = await chrome.runtime.sendMessage({ cmd: "ptb-redirect-settings" });
      if (!settings) throw Error("Redirect settings unavailable");
      if (prefix[1] === "auto" && !settings.enabled && PTB.tradeRegion.tradeUrl(source.href, "en")) {
        source.search += (source.search ? "&" : "?") + "ptb_region_once=1";
        return location.replace(source.href);
      }
      const profile = settings.profiles?.[PTB.gameFromUrl(source.href)] || {};
      const catalogFor = async (game) => {
        const response = await chrome.runtime.sendMessage({ cmd: "ptb-trade-leagues", game });
        if (!response.value) throw Error("League catalog unavailable");
        return response.value;
      };
      location.replace(await PTB.profileTradeUrl(source.href, settings.code, profile, undefined, catalogFor));
    } else {
      location.replace(await PTB.transferQuerySearch(source.href, prefix[2]));
    }
  } catch (error) {
    const { ptbLang } = await chrome.storage.local.get("ptbLang");
    const ko = (ptbLang || navigator.language).startsWith("ko");
    if (location.search.startsWith("?bookmark=")) {
      document.getElementById("status").textContent = ko ? "이 즐겨찾기를 열 수 없습니다." : "Could not open this bookmark.";
      if (source && !new URLSearchParams(location.search).has("original")) {
        const link = document.getElementById("original");
        link.href = location.search + "&original=1";
        link.textContent = ko ? "원래 거래소에서 열기" : "Open on the original trade site";
        link.hidden = false;
      }
      return;
    }
    document.getElementById("status").textContent = ko ? "이 검색을 선호 거래소로 옮길 수 없습니다." : "Could not transfer this trade search.";
    if (error.code === "opaque-search") {
      document.getElementById("status").textContent = ko ? "이 링크에는 검색 ID만 있어 거래 방식을 변경할 수 없습니다. 원래 거래소에서 검색을 다시 실행하세요." :
        "This link contains only a search ID. Run the search again on the original site to apply a different trade mode.";
    }
    if (source && PTB.tradeRegion.tradeUrl(source.href, "en")) {
      source.search += (source.search ? "&" : "?") + "ptb_region_once=1";
      const link = document.getElementById("original");
      link.href = source.href;
      link.textContent = ko ? "원래 거래소에서 열기" : "Open on the original trade site";
      link.hidden = false;
    }
  }
})();
