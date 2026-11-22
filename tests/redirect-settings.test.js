const { test } = require("node:test");
const assert = require("node:assert/strict");
require("../extension/src/common/url.js");
require("../extension/src/common/trade-region.js");
require("../extension/src/background/redirect-settings.js");

test("both surfaces share a remembered destination independent of the redirect switch", async () => {
  let rules = [];
  let saved = {};
  let fail = false;
  global.chrome = {
    runtime: { getURL: (path) => "chrome-extension://test/" + path },
    declarativeNetRequest: {
      getDynamicRules: async () => rules,
      updateDynamicRules: async ({ addRules }) => { rules = addRules; },
    },
    storage: { local: {
      get: async () => saved,
      set: async (next) => { if (fail) throw Error("write failed"); saved = next; },
    } },
  };
  assert.deepEqual(await PTB.redirectSettings(), { code: "", enabled: false, configured: false });
  rules = PTB.tradeRegion.rules("fr"); // Existing settings from a previous version.
  assert.deepEqual(await PTB.redirectSettings(), { code: "fr", enabled: true, configured: true });
  await PTB.redirectSettings({ enabled: false });
  assert.equal(await PTB.tradeRegion.getPreference(), "");
  assert.deepEqual(await PTB.redirectSettings(), { code: "fr", enabled: false, configured: true });
  await Promise.all([PTB.redirectSettings({ code: "jp" }), PTB.redirectSettings({ enabled: true })]);
  assert.equal(await PTB.tradeRegion.getPreference(), "jp");
  fail = true;
  await assert.rejects(PTB.redirectSettings({ code: "de" }));
  assert.deepEqual(await PTB.redirectSettings(), { code: "jp", enabled: true, configured: true });
  fail = false;
  await PTB.redirectSettings({ code: "", profile: { game: "poe2", status: "any" } });
  assert.deepEqual((await PTB.redirectSettings()).code, "");
  assert.equal((await PTB.redirectSettings()).enabled, true);
  assert.deepEqual(rules.map((r) => r.id).sort(), [9102, 9106]);
  await PTB.redirectSettings({ enabled: false });
  assert.deepEqual(rules, []);
});
