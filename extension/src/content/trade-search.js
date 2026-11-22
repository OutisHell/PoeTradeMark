// Capture the incoming payload before the trade app or the sidebar updates the URL.
(() => {
  const initial = new URL(location.href);
  if (!initial.searchParams.has("ptb_from") || !/\/H4sI[^/]+(?:\/live)?\/?$/.test(initial.pathname)) return;
  chrome.runtime.sendMessage({ cmd: "ptb-localize-search", href: initial.href }).then(async (result) => {
    if (!result) return;
    const clean = new URL(initial.href);
    clean.search = clean.search.slice(1).split("&").filter((part) => part !== "ptb_region_once=1" && !part.startsWith("ptb_from=")).join("&");
    const stillHere = () => location.href === initial.href || location.href === clean.href;
    if (!stillHere()) return;
    if (result.url) return location.replace(result.url);
    if (!result.unavailable) return;
    if (document.readyState === "loading") await new Promise((resolve) => document.addEventListener("DOMContentLoaded", resolve, { once: true }));
    const { ptbLang } = await chrome.storage.local.get("ptbLang");
    if (!stillHere()) return;
    const ko = (ptbLang || navigator.language).startsWith("ko");
    const banner = document.createElement("aside");
    banner.style.cssText = "position:fixed;bottom:12px;left:12px;z-index:2147483647;padding:10px;background:#25231f;color:white";
    banner.setAttribute("role", "status");
    banner.textContent = ko ? "이 검색의 아이템명을 대상 언어로 확인할 수 없습니다. " : "Item translation unavailable for this search. ";
    const link = document.createElement("a");
    // The worker accepts only known source and destination trade hosts.
    clean.hostname = initial.searchParams.get("ptb_from");
    clean.search += (clean.search ? "&" : "?") + "ptb_region_once=1";
    link.href = clean.href;
    link.textContent = ko ? "원래 거래소에서 열기" : "Open on the original trade site";
    banner.append(link);
    document.body.append(banner);
  }).catch(() => {});
})();
