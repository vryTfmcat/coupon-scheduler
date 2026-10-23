export interface FilterableCard {
  title?: string; location?: string; merchantName?: string;
  validTo?: string; updatedAt?: string; createdAt?: string;
}
export const sortOptions = [["expiryAsc", "到期时间：近到远"], ["expiryDesc", "到期时间：远到近"], ["place", "地点名称（拼音）"], ["updated", "最近更新"]];
export const expiryOptions = [["all", "全部有效期"], ["7", "7天内到期"], ["30", "30天内到期"], ["expired", "已过期"], ["unknown", "未填到期日"]];
export function normalizeSort(value: unknown): string { return sortOptions.some(([key]) => key === value) ? String(value) : "expiryAsc"; }
export function normalizeExpiry(value: unknown): string { return expiryOptions.some(([key]) => key === value) ? String(value) : "all"; }
export function cardPlace(card: FilterableCard): string { return card.location?.trim() || card.merchantName?.trim() || ""; }
function dayNumber(value?: string): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const day = Date.parse(value + "T00:00:00Z");
  return Number.isFinite(day) && new Date(day).toISOString().slice(0, 10) === value ? day / 86400000 : null;
}
export function matchesExpiry(card: FilterableCard, range: string, today: string): boolean {
  if (range === "all") return true;
  const end = dayNumber(card.validTo), start = dayNumber(today);
  if (range === "unknown") return end === null;
  if (end === null || start === null) return false;
  if (range === "expired") return end < start;
  return end >= start && end <= start + Number(range);
}
export function compareCards(a: FilterableCard, b: FilterableCard, mode: string): number {
  const title = () => (a.title || "").localeCompare(b.title || "", "zh-Hans-CN");
  const expiry = (descending = false) => {
    const x = dayNumber(a.validTo), y = dayNumber(b.validTo);
    if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
    return descending ? y - x : x - y;
  };
  if (mode === "place") {
    const x = cardPlace(a), y = cardPlace(b);
    return (x && y ? x.localeCompare(y, "zh-Hans-CN") : x ? -1 : y ? 1 : 0) || expiry() || title();
  }
  if (mode === "updated") {
    const stamp = (c: FilterableCard) => Date.parse(c.updatedAt || c.createdAt || "") || 0;
    return stamp(b) - stamp(a) || expiry() || title();
  }
  return expiry(mode === "expiryDesc") || title();
}
