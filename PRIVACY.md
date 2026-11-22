# Privacy policy — PoE TradeMark

PoE TradeMark is a Chrome extension for bookmarking official Path of Exile and Path of Exile 2 trade searches.

**Last updated:** 2026-11-22

## What data is stored

Bookmarks you save (title, trade URL parts, filter descriptions, icons, optional lowest price), their groups and display order, and your language, preferred trade site, and rate-table preferences are stored in Chrome’s local extension storage on your computer (`chrome.storage.local`). Chrome stores your preferred trade site locally as a redirect rule when you enable automatic redirection.

Exporting saves a collection or the selected games’ bookmark lists to a JSON file on your device. Someone you share it with can read the search links, saved filters, and names you gave your bookmarks, groups, and collections. Importing reads the file you choose into your local extension storage.

Saving current trade settings records the country, league and trade mode locally. Each game has its own league and trade mode preferences.

Nothing is uploaded to us. There is no account, no analytics, and no advertising.

## Network requests

When you save a bookmark, the extension can infer its title color from listings the trade page has already loaded. It keeps rarities and matching search and result IDs temporarily in tab memory. Saving uses this local data and sends no additional trade search or listing request.

The extension requests the league list for the selected game from the official Korean trade site. It caches the response locally for one hour and can reuse the last list if a refresh fails.

The extension reads the official trade site in your browser (Korea, global Path of Exile, and Taiwan). It fetches currency exchange rates from [poe.ninja](https://poe.ninja/) so listings can be converted. Those requests do not include your bookmarks.

## Permissions

- **storage / unlimitedStorage** — save bookmarks and settings on this device.
- **tabs** — open a saved search in the current tab or a new tab when you click jump.
- **declarativeNetRequestWithHostAccess** — Chrome redirects supported trade pages to your chosen site and applies your league and trade mode preferences to item searches.
- **Host access** to Path of Exile trade sites and poe.ninja — inject the sidebar on trade pages and load rates.

## Contact

https://github.com/danij91/PoeTradeMark
