export const UI_CARD_TYPES = ["redPacket", "voucher", "weeklyActivity", "food", "delivery"] as const;

export type UiCardType = (typeof UI_CARD_TYPES)[number];

export interface MarkdownSourceFile {
  path: string;
  basename: string;
  frontmatter: Record<string, unknown>;
  content: string;
}

export interface PlannerCard {
  id: string;
  entityKind: "benefit" | "item" | "activity";
  type: UiCardType;
  title: string;
  merchantName: string;
  source: string;
  location: string;
  price: string;
  value: string;
  validFrom: string;
  validTo: string;
  usableStart: string;
  usableEnd: string;
  desire: number;
  repeatWeekday?: number | "";
  tags: string[];
  notes: string;
  status: "unscheduled" | "scheduled" | "used" | "discarded";
  createdAt: string;
  updatedAt: string;
  markdownPath: string;
}

export interface PlannerEvent {
  id: string;
  cardId: string;
  subjectKind: "benefit" | "item" | "activity";
  subjectRef: string;
  date: string;
  start: string;
  end: string;
  status?: "used";
  createdAt: string;
  updatedAt: string;
  markdownPath: string;
}

export interface PlannerMarkdownState {
  cards: PlannerCard[];
  events: PlannerEvent[];
}

export interface PlannerUiState {
  selectedCardId: string | null;
  selectedEventId: string | null;
  view: "day" | "week" | "month" | "map";
  inboxPage: "outing" | "food" | "trash";
  cursorDate: string;
  filters: {
    type: string;
    tag: string;
    search: string;
  };
  map?: Record<string, unknown>;
}

function stringValue(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function numberValue(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizedTags(value: unknown): string[] {
  const values = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  return [...new Set(values.map((tag) => String(tag).trim().replace(/^#/, "")).filter(Boolean))];
}

function firstLink(value: unknown): string {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return stringValue(values[0]);
}

export function wikilinkLabel(value: unknown): string {
  const link = firstLink(value);
  if (!link) return "";
  const match = link.match(/^\[\[([^\]]+)\]\]$/);
  if (!match) return link;
  const [target, alias] = match[1].split("|");
  if (alias?.trim()) return alias.trim();
  const leaf = target.trim().split("/").pop() ?? target;
  return leaf.replace(/\.md$/i, "");
}

function bodyWithoutFrontmatter(content: string): string {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
}

export function extractSection(content: string, heading: string): string {
  const lines = bodyWithoutFrontmatter(content).split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start < 0) return "";
  const end = lines.findIndex((line, index) => index > start && /^##\s+/.test(line.trim()));
  return lines.slice(start + 1, end < 0 ? undefined : end).join("\n").trim();
}

function uiCardType(value: unknown): UiCardType {
  const type = stringValue(value);
  if (UI_CARD_TYPES.includes(type as UiCardType)) return type as UiCardType;
  if (["shopping", "other"].includes(type)) return "delivery";
  return "voucher";
}

function factStatus(frontmatter: Record<string, unknown>): PlannerCard["status"] {
  const status = stringValue(
    frontmatter.benefitStatus ?? frontmatter.itemStatus ?? frontmatter.activityStatus,
  );
  if (["used", "done"].includes(status)) return "used";
  if (["void", "refunded", "discarded", "archived"].includes(status)) return "discarded";
  return "unscheduled";
}

function stableCardId(frontmatter: Record<string, unknown>): string {
  return stringValue(frontmatter.benefitId ?? frontmatter.itemId ?? frontmatter.activityId);
}

function entityKind(frontmatter: Record<string, unknown>): PlannerCard["entityKind"] {
  if (frontmatter.entityType === "activity" || frontmatter.activityId) return "activity";
  if (frontmatter.recordType === "coupon-calendar-item" || frontmatter.itemId) return "item";
  return "benefit";
}

export function cardFromMarkdown(file: MarkdownSourceFile): PlannerCard | null {
  const { frontmatter } = file;
  if (frontmatter.couponSchedulerItem !== true) return null;
  const id = stableCardId(frontmatter);
  if (!id) return null;

  const type = uiCardType(frontmatter.calendarType);
  const location = wikilinkLabel(
    frontmatter.usableAt ?? frontmatter.placeRefs ?? frontmatter.placeRef,
  ) || stringValue(frontmatter.locationHint);
  const repeatWeekday = stringValue(frontmatter.repeatWeekday);

  return {
    id,
    entityKind: entityKind(frontmatter),
    type,
    title: stringValue(frontmatter.title) || file.basename,
    merchantName: stringValue(frontmatter.merchantName),
    source: stringValue(frontmatter.sourcePlatform),
    location,
    price: stringValue(frontmatter.purchasePrice),
    value: stringValue(frontmatter.faceValue),
    validFrom: stringValue(frontmatter.validFrom),
    validTo: stringValue(frontmatter.validTo),
    usableStart: stringValue(frontmatter.usableStart ?? frontmatter.defaultStart),
    usableEnd: stringValue(frontmatter.usableEnd ?? frontmatter.defaultEnd),
    desire: Math.max(1, Math.min(5, Math.round(numberValue(frontmatter.desire, 3)))),
    repeatWeekday: repeatWeekday === "" ? "" : numberValue(repeatWeekday, 0),
    tags: normalizedTags(frontmatter.tags),
    notes: extractSection(file.content, "备注") || extractSection(file.content, "说明"),
    status: factStatus(frontmatter),
    createdAt: stringValue(frontmatter.created),
    updatedAt: stringValue(frontmatter.updated),
    markdownPath: file.path,
  };
}

export function eventFromMarkdown(file: MarkdownSourceFile): PlannerEvent | null {
  const { frontmatter } = file;
  if (frontmatter.couponSchedulerEvent !== true) return null;
  const id = stringValue(frontmatter.scheduleId);
  const cardId = stringValue(frontmatter.subjectId);
  const status = stringValue(frontmatter.eventStatus);
  if (!id || !cardId || status === "cancelled") return null;

  return {
    id,
    cardId,
    subjectKind: ["benefit", "item", "activity"].includes(stringValue(frontmatter.subjectKind))
      ? stringValue(frontmatter.subjectKind) as PlannerEvent["subjectKind"]
      : "benefit",
    subjectRef: stringValue(frontmatter.subjectRef),
    date: stringValue(frontmatter.date),
    start: stringValue(frontmatter.start),
    end: stringValue(frontmatter.end),
    status: status === "done" ? "used" : undefined,
    createdAt: stringValue(frontmatter.created),
    updatedAt: stringValue(frontmatter.updated),
    markdownPath: file.path,
  };
}

export function deriveCardStatuses(cards: PlannerCard[], events: PlannerEvent[]): PlannerCard[] {
  const scheduledIds = new Set(
    events.filter((event) => event.status !== "used").map((event) => event.cardId),
  );
  return cards.map((card) => {
    if (card.status !== "unscheduled" || card.type === "weeklyActivity") return card;
    return scheduledIds.has(card.id) ? { ...card, status: "scheduled" } : card;
  });
}

export function extractUiState(state: unknown): PlannerUiState {
  const candidate = state && typeof state === "object" ? state as Record<string, unknown> : {};
  const filters = candidate.filters && typeof candidate.filters === "object"
    ? candidate.filters as Record<string, unknown>
    : {};
  const view = stringValue(candidate.view);
  const inboxPage = stringValue(candidate.inboxPage);
  const map = candidate.map && typeof candidate.map === "object"
    ? structuredClone(candidate.map as Record<string, unknown>)
    : undefined;
  return {
    selectedCardId: stringValue(candidate.selectedCardId) || null,
    selectedEventId: stringValue(candidate.selectedEventId) || null,
    view: ["day", "week", "month", "map"].includes(view)
      ? view as PlannerUiState["view"]
      : "week",
    inboxPage: ["outing", "food", "trash"].includes(inboxPage)
      ? inboxPage as PlannerUiState["inboxPage"]
      : "outing",
    cursorDate: stringValue(candidate.cursorDate),
    filters: {
      type: stringValue(filters.type) || "all",
      tag: stringValue(filters.tag) || "all",
      search: stringValue(filters.search),
    },
    ...(map ? { map } : {}),
  };
}

export function mergeMarkdownWithUi(
  markdown: PlannerMarkdownState,
  uiState: unknown,
): PlannerMarkdownState & PlannerUiState {
  const ui = extractUiState(uiState);
  const cardIds = new Set(markdown.cards.map((card) => card.id));
  const eventIds = new Set(markdown.events.map((event) => event.id));
  return {
    ...ui,
    selectedCardId: ui.selectedCardId && cardIds.has(ui.selectedCardId) ? ui.selectedCardId : null,
    selectedEventId: ui.selectedEventId && eventIds.has(ui.selectedEventId) ? ui.selectedEventId : null,
    cards: deriveCardStatuses(markdown.cards, markdown.events),
    events: markdown.events,
  };
}
