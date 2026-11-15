import assert from "node:assert/strict";
import test from "node:test";
import { isCurrentTab, primaryTabs } from "../src/lib/navigation.ts";

test("primary tabs are distinct in-app destinations in a stable order", () => {
  const hrefs = primaryTabs.map((tab) => tab.href);
  assert.deepEqual(hrefs, ["/machines", "/pair", "/help"]);
  assert.equal(new Set(hrefs).size, hrefs.length);
  for (const tab of primaryTabs) {
    assert.match(tab.href, /^\/(?!\/)/, `${tab.href} must stay in-app`);
    assert.ok(tab.label.trim().length > 0);
  }
});

test("a tab is current on its own section and nested pages only", () => {
  assert.equal(isCurrentTab("/machines", "/machines"), true);
  assert.equal(isCurrentTab("/machines/machine-1", "/machines"), true);
  assert.equal(isCurrentTab("/machines-old", "/machines"), false);
  assert.equal(isCurrentTab("/pair", "/machines"), false);
  assert.equal(isCurrentTab("/help", "/pair"), false);
  assert.equal(isCurrentTab("/", "/help"), false);
});
