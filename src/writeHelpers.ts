const CROCKFORD = "0123456789abcdefghjkmnpqrstvwxyz";

export type CardEntityKind = "benefit" | "item" | "activity";

function encodeTime(timestamp: number): string {
  let value = Math.max(0, Math.floor(timestamp));
  let output = "";
  for (let index = 0; index < 10; index += 1) {
    output = CROCKFORD[value % 32] + output;
    value = Math.floor(value / 32);
  }
  return output;
}

function randomChars(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => CROCKFORD[value % 32]).join("");
}

export function createStableId(prefix: "ben" | "csi" | "act" | "sch", now = Date.now()): string {
  return `${prefix}_${encodeTime(now)}${randomChars(16)}`;
}

export function cardEntityKind(type: unknown): CardEntityKind {
  if (type === "weeklyActivity") return "activity";
  if (type === "food" || type === "delivery") return "item";
  return "benefit";
}

export function cardIdPrefix(type: unknown): "ben" | "csi" | "act" {
  const kind = cardEntityKind(type);
  return kind === "benefit" ? "ben" : kind === "item" ? "csi" : "act";
}

export function safeFileStem(value: unknown): string {
  const cleaned = String(value ?? "")
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|#\[\]^]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/-+/g, "-")
    .replace(/\s*-\s*/g, "-")
    .replace(/-+/g, "-")
    .trim()
    .replace(/^[.\s-]+|[.\s-]+$/g, "");
  return cleaned.slice(0, 96) || "未命名券食条目";
}

export function localIsoTimestamp(date = new Date()): string {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absolute = Math.abs(offsetMinutes);
  const offset = `${sign}${String(Math.floor(absolute / 60)).padStart(2, "0")}:${String(absolute % 60).padStart(2, "0")}`;
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 19);
  return `${local}${offset}`;
}

export function replaceMarkdownSection(body: string, heading: string, value: string): string {
  const normalizedBody = body.replace(/^\s+/, "");
  const lines = normalizedBody.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  const replacement = value.trim() ? value.trim().split(/\r?\n/) : [];

  if (start < 0) {
    if (!replacement.length) return normalizedBody.trimEnd() + "\n";
    const prefix = normalizedBody.trimEnd();
    return `${prefix}${prefix ? "\n\n" : ""}## ${heading}\n\n${replacement.join("\n")}\n`;
  }

  let end = lines.findIndex((line, index) => index > start && /^##\s+/.test(line.trim()));
  if (end < 0) end = lines.length;
  const next = [
    ...lines.slice(0, start + 1),
    "",
    ...replacement,
    ...(replacement.length ? [""] : []),
    ...lines.slice(end),
  ];
  return next.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

export function replaceTopLevelTitle(body: string, title: string): string {
  const normalized = body.replace(/^\s+/, "");
  const lines = normalized.split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => /^#\s+/.test(line));
  if (headingIndex >= 0) {
    lines[headingIndex] = `# ${title.trim() || "未命名卡片"}`;
    return lines.join("\n").trimEnd() + "\n";
  }
  return `# ${title.trim() || "未命名卡片"}\n\n${normalized.trimEnd()}\n`;
}

function normalizedStatus(status: unknown): string {
  return status === "scheduled" ? "unscheduled" : String(status ?? "");
}

export function cardFingerprint(card: Record<string, unknown>): string {
  return JSON.stringify({
    id: card.id,
    type: card.type,
    title: card.title,
    merchantName: card.merchantName,
    source: card.source,
    location: card.location,
    price: card.price,
    value: card.value,
    validFrom: card.validFrom,
    validTo: card.validTo,
    usableStart: card.usableStart,
    usableEnd: card.usableEnd,
    desire: card.desire,
    repeatWeekday: card.repeatWeekday,
    tags: card.tags,
    notes: card.notes,
    status: normalizedStatus(card.status),
  });
}

export function eventFingerprint(event: Record<string, unknown>): string {
  return JSON.stringify({
    id: event.id,
    cardId: event.cardId,
    date: event.date,
    start: event.start,
    end: event.end,
    status: event.status === "used" ? "used" : "planned",
  });
}

export function contentHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
