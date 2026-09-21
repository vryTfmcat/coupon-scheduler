import assert from "node:assert/strict";
import test from "node:test";
import {
  cardEntityKind,
  cardFingerprint,
  createStableId,
  eventFingerprint,
  localIsoTimestamp,
  replaceMarkdownSection,
  replaceTopLevelTitle,
  safeFileStem,
} from "./writeHelpers.ts";

test("stable IDs follow the vault contracts", () => {
  assert.match(createStableId("ben", 0), /^ben_[0-9a-hjkmnp-tv-z]{26}$/);
  assert.match(createStableId("sch", 0), /^sch_[0-9a-hjkmnp-tv-z]{26}$/);
});

test("UI types map to durable entity kinds", () => {
  assert.equal(cardEntityKind("voucher"), "benefit");
  assert.equal(cardEntityKind("redPacket"), "benefit");
  assert.equal(cardEntityKind("food"), "item");
  assert.equal(cardEntityKind("delivery"), "item");
  assert.equal(cardEntityKind("weeklyActivity"), "activity");
});

test("file names remove unsafe vault characters", () => {
  assert.equal(safeFileStem('店/名:*?"<>| #1'), "店-名-1");
});

test("notes section updates without replacing other prose", () => {
  const source = "# 标题\n\n## 使用说明\n\n保留。\n\n## 备注\n\n旧内容。\n\n## 其他\n\n继续保留。\n";
  const updated = replaceMarkdownSection(source, "备注", "新内容。\n第二行。");
  assert.match(updated, /## 使用说明\n\n保留。/);
  assert.match(updated, /## 备注\n\n新内容。\n第二行。/);
  assert.match(updated, /## 其他\n\n继续保留。/);
  assert.doesNotMatch(updated, /旧内容/);
});

test("title updates only the first level-one heading", () => {
  const source = "# 旧标题\n\n## 说明\n\n正文保留。\n";
  assert.equal(replaceTopLevelTitle(source, "新标题"), "# 新标题\n\n## 说明\n\n正文保留。\n");
});

test("fingerprints ignore derived schedule status and timestamps", () => {
  const base = { id: "ben_x", type: "voucher", title: "券", status: "unscheduled", updatedAt: "a" };
  assert.equal(cardFingerprint(base), cardFingerprint({ ...base, status: "scheduled", updatedAt: "b" }));
  assert.equal(
    eventFingerprint({ id: "sch_x", cardId: "ben_x", date: "2026-09-21", start: "10:00", end: "11:00" }),
    eventFingerprint({ id: "sch_x", cardId: "ben_x", date: "2026-09-21", start: "10:00", end: "11:00", status: "" }),
  );
});

test("local timestamps carry an explicit timezone", () => {
  assert.match(localIsoTimestamp(new Date()), /[+-]\d{2}:\d{2}$/);
});
