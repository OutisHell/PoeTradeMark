importScripts("../common/url.js", "../common/trade-region.js", "redirect-settings.js", "trade-search.js", "trade-leagues.js", "../common/storage.js", "../common/backup.js");

// Refresh saved redirect rules from versions which only switched the hostname.
chrome.runtime.onInstalled?.addListener(() => PTB.redirectSettings(null, true).catch(console.error));

let pendingBookmarkWrite = Promise.resolve();

// 콘텐츠 스크립트는 CORS 때문에 poe.ninja를 직접 못 친다. 여기(확장 origin)에서만 fetch.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg) return;
  if (msg.cmd === "ptb-named-selection") {
    PTB.namedTradeSelection(_sender.url, msg.title).then(sendResponse, () => sendResponse(false));
    return true;
  }
  if (msg.cmd === "ptb-trade-leagues" || msg.cmd === "ptb-save-trade-snapshot") {
    const task = msg.cmd === "ptb-trade-leagues" ? Promise.resolve().then(() => PTB.tradeLeagues(msg.game, msg.force === true)) :
      PTB.tradeSnapshot(msg.href).then((patch) => PTB.redirectSettings(patch));
    task.then((value) => sendResponse({ value }), (error) => sendResponse({ error: error.message }));
    return true;
  }
  if (msg.cmd === "ptb-redirect-settings") {
    PTB.redirectSettings(msg.patch).then(
      (settings) => sendResponse({ settings }),
      (error) => sendResponse({ error: error.message })
    );
    return true;
  }
  if (msg.cmd === "ptb-localize-search" && new URL(msg.href).origin === _sender.origin) {
    PTB.localizeTradeSearch(msg.href).then((url) => sendResponse({ url }), () => sendResponse({ unavailable: true }));
    return true;
  }
  if (msg.cmd === "ptb-bookmark-write" && Object.hasOwn(PTB.bookmarkChanges, msg.action)) {
    const write = pendingBookmarkWrite.then(() => PTB.bookmarkChanges[msg.action](...msg.args));
    pendingBookmarkWrite = write.catch(() => {});
    write.then(
      (result) => sendResponse({ ok: true, result }),
      (error) => sendResponse({ ok: false, error: error.message })
    );
    return true;
  }
  if (msg.cmd === "ptb-ping") {
    sendResponse({ ok: true });
    return;
  }
  if (msg.cmd !== "ptb-rates-fetch") return;
  const url = String(msg.url || "");
  if (
    url.indexOf("https://poe.ninja/poe2/api/economy/") !== 0 &&
    url.indexOf("https://poe.ninja/poe1/api/economy/") !== 0
  ) {
    sendResponse({ ok: false, error: "bad-url" });
    return;
  }
  fetch(url, { credentials: "omit" })
    .then((res) => {
      if (!res.ok) throw new Error("http " + res.status);
      return res.json();
    })
    .then((json) => sendResponse({ ok: true, json: json }))
    .catch((err) => sendResponse({ ok: false, error: String((err && err.message) || err) }));
  return true;
});
