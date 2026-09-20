import assert from "node:assert/strict";
import test from "node:test";
import {
  cardFromMarkdown,
  deriveCardStatuses,
  eventFromMarkdown,
  extractSection,
  extractUiState,
  mergeMarkdownWithUi,
  type PlannerCard,
  wikilinkLabel,
} from "./markdownAdapter.ts";

test("reads an entitlement note into the existing card contract", () => {
  const card = cardFromMarkdown({
    path: "50_实体/权益/券食权益/测试券-abc.md",
    basename: "测试券-abc",
    frontmatter: {
      couponSchedulerItem: true,
      benefitId: "ben_01kexample",
      title: "测试券",
      calendarType: "voucher",
      merchantName: "测试商户",
      usableAt: ["[[50_实体/地点/外部地点/测试门店-abc|测试门店]]"],
      purchasePrice: 18.5,
      faceValue: 25,
      desire: 8,
      benefitStatus: "active",
      tags: ["#餐饮", "餐饮"],
    },
    content: "---\ncouponSchedulerItem: true\n---\n# 测试券\n\n## 备注\n\n周末可用。\n",
  });
  assert.ok(card);
  assert.equal(card.id, "ben_01kexample");
  assert.equal(card.location, "测试门店");
  assert.equal(card.price, "18.5");
  assert.equal(card.value, "25");
  assert.equal(card.desire, 5);
  assert.deepEqual(card.tags, ["餐饮"]);
  assert.equal(card.notes, "周末可用。");
});

test("reads schedule notes and ignores cancelled events", () => {
  const base = {
    path: "50_实体/记录/券食安排/安排.md",
    basename: "安排",
    content: "",
  };
  const event = eventFromMarkdown({
    ...base,
    frontmatter: {
      couponSchedulerEvent: true,
      scheduleId: "sch_01kexample",
      subjectId: "ben_01kexample",
      date: "2026-09-22",
      start: "18:00",
      end: "19:00",
      eventStatus: "planned",
    },
  });
  assert.equal(event?.cardId, "ben_01kexample");
  assert.equal(event?.status, undefined);
  assert.equal(eventFromMarkdown({ ...base, frontmatter: { ...base, couponSchedulerEvent: true, scheduleId: "x", subjectId: "y", eventStatus: "cancelled" } }), null);
});

test("derives scheduled state without changing recurring activities", () => {
  const cards = [
    { id: "benefit", type: "voucher", status: "unscheduled" },
    { id: "activity", type: "weeklyActivity", status: "unscheduled" },
  ] as Parameters<typeof deriveCardStatuses>[0];
  const events = [
    { id: "event-1", cardId: "benefit" },
    { id: "event-2", cardId: "activity" },
  ] as Parameters<typeof deriveCardStatuses>[1];
  const derived = deriveCardStatuses(cards, events);
  assert.equal(derived[0].status, "scheduled");
  assert.equal(derived[1].status, "unscheduled");
});

test("merges Markdown business data with UI-only state", () => {
  const card: PlannerCard = {
    id: "benefit",
    type: "voucher",
    title: "券",
    merchantName: "",
    source: "",
    location: "",
    price: "",
    value: "",
    validFrom: "",
    validTo: "",
    usableStart: "",
    usableEnd: "",
    desire: 3,
    tags: [],
    notes: "",
    status: "unscheduled",
    createdAt: "",
    updatedAt: "",
    markdownPath: "券.md",
  };
  const merged = mergeMarkdownWithUi(
    { cards: [card], events: [] },
    { cards: [{ id: "legacy" }], selectedCardId: "legacy", view: "day", filters: { search: "店" } },
  );
  assert.deepEqual(merged.cards.map((item) => item.id), ["benefit"]);
  assert.equal(merged.selectedCardId, null);
  assert.equal(merged.view, "day");
  assert.equal(merged.filters.search, "店");
});

test("extracts only UI preferences before data.json is saved", () => {
  const state = extractUiState({
    cards: [{ id: "must-not-persist" }],
    events: [{ id: "must-not-persist" }],
    view: "month",
    cursorDate: "2026-09-20",
    filters: { type: "voucher", tag: "餐饮", search: "券" },
  });
  assert.equal("cards" in state, false);
  assert.equal("events" in state, false);
  assert.equal(state.view, "month");
});

test("link and section helpers support Obsidian Markdown", () => {
  assert.equal(wikilinkLabel("[[50_实体/地点/外部地点/公园-abc|公园]]"), "公园");
  assert.equal(wikilinkLabel("[[50_实体/地点/外部地点/公园-abc]]"), "公园-abc");
  assert.equal(extractSection("# 标题\n\n## 备注\n第一行\n\n## 其他\n第二行", "备注"), "第一行");
});
