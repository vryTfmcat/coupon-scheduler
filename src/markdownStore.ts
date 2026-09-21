import {
  App,
  normalizePath,
  parseYaml,
  stringifyYaml,
  TFile,
  TFolder,
} from "obsidian";
import {
  cardFromMarkdown,
  eventFromMarkdown,
  mergeMarkdownWithUi,
  type MarkdownSourceFile,
  type PlannerCard,
  type PlannerEvent,
  type PlannerMarkdownState,
} from "./markdownAdapter";
import {
  cardEntityKind,
  cardFingerprint,
  contentHash,
  eventFingerprint,
  localIsoTimestamp,
  replaceMarkdownSection,
  safeFileStem,
  type CardEntityKind,
} from "./writeHelpers";

const CONFIG_PATH = "30_项目/券食日历/配置/券食日历配置.md";
const SELF_WRITE_TTL_MS = 4_000;

interface MarkdownFolders {
  benefitsFolder: string;
  itemsFolder: string;
  activitiesFolder: string;
  schedulesFolder: string;
}

interface BaselineEntry {
  path: string;
  fingerprint: string;
}

interface SelfWriteToken {
  hash: string | null;
  until: number;
}

export interface StoreDiagnostic {
  key: string;
  message: string;
  paths: string[];
}

const DEFAULT_FOLDERS: MarkdownFolders = {
  benefitsFolder: "50_实体/权益/券食权益",
  itemsFolder: "50_实体/记录/券食条目",
  activitiesFolder: "50_实体/活动/固定活动",
  schedulesFolder: "50_实体/记录/券食安排",
};

export class MarkdownWriteConflictError extends Error {
  constructor(message: string, readonly paths: string[] = []) {
    super(message);
    this.name = "MarkdownWriteConflictError";
  }
}

function frontmatterString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function stringValue(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function stringList(value: unknown): string[] {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return values.map((item) => String(item).trim()).filter(Boolean);
}

function isInsidePath(path: string, folder: string): boolean {
  return normalizePath(path).startsWith(`${normalizePath(folder)}/`);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function asCards(value: unknown): Array<Record<string, unknown>> {
  const cards = asRecord(value).cards;
  return Array.isArray(cards) ? cards.filter((card) => card && typeof card === "object") as Array<Record<string, unknown>> : [];
}

function asEvents(value: unknown): Array<Record<string, unknown>> {
  const events = asRecord(value).events;
  return Array.isArray(events) ? events.filter((event) => event && typeof event === "object") as Array<Record<string, unknown>> : [];
}

function splitMarkdown(content: string): { frontmatter: Record<string, unknown>; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return { frontmatter: {}, body: content };
  const parsed = parseYaml(match[1]);
  return {
    frontmatter: parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {},
    body: content.slice(match[0].length),
  };
}

function buildMarkdown(frontmatter: Record<string, unknown>, body: string): string {
  const yaml = stringifyYaml(frontmatter).trimEnd();
  return `---\n${yaml}\n---\n\n${body.replace(/^\s+/, "").trimEnd()}\n`;
}

function nullableString(value: unknown): string | null {
  const normalized = stringValue(value);
  return normalized || null;
}

function nullableNumber(value: unknown): number | null {
  if (value === "" || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function cardKindFromFrontmatter(frontmatter: Record<string, unknown>, card: Record<string, unknown>): CardEntityKind {
  if (frontmatter.entityType === "activity" || frontmatter.activityId) return "activity";
  if (frontmatter.recordType === "coupon-calendar-item" || frontmatter.itemId) return "item";
  if (frontmatter.entityType === "benefit" || frontmatter.benefitId) return "benefit";
  return cardEntityKind(card.type);
}

function factStatus(kind: CardEntityKind, status: unknown): string {
  if (kind === "benefit") {
    if (status === "used") return "used";
    if (status === "discarded") return "void";
    return "active";
  }
  if (kind === "item") {
    if (status === "used") return "done";
    if (status === "discarded") return "discarded";
    return "active";
  }
  return status === "discarded" ? "archived" : "active";
}

function tagsForNewCard(kind: CardEntityKind, tags: unknown): string[] {
  const incoming = stringList(tags).map((tag) => tag.replace(/^#/, ""));
  const required = kind === "benefit"
    ? ["实体/权益", "券食日历/权益"]
    : kind === "item"
      ? ["记录/券食条目"]
      : ["实体/活动", "券食日历/固定活动"];
  return [...new Set([...required, ...incoming])];
}

function wikilink(path: string, label: string): string {
  return `[[${path.replace(/\.md$/i, "")}|${label}]]`;
}

function linkTarget(value: unknown): string {
  const match = stringValue(value).match(/^\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]$/);
  return match?.[1]?.trim() ?? "";
}

function stableId(frontmatter: Record<string, unknown>): string {
  return stringValue(frontmatter.benefitId ?? frontmatter.itemId ?? frontmatter.activityId ?? frontmatter.placeId);
}

function assertUniqueIds(entries: Array<Record<string, unknown>>, label: string): void {
  const seen = new Set<string>();
  for (const entry of entries) {
    const id = stringValue(entry.id);
    if (!id) throw new MarkdownWriteConflictError(`${label}缺少稳定 ID，已停止写入。`);
    if (seen.has(id)) throw new MarkdownWriteConflictError(`${label} ID 重复：${id}，已停止写入。`);
    seen.add(id);
  }
}

export class MarkdownPlannerStore {
  private knownMtimes = new Map<string, number>();
  private cardBaseline = new Map<string, BaselineEntry>();
  private eventBaseline = new Map<string, BaselineEntry>();
  private diagnostics: StoreDiagnostic[] = [];
  private selfWrites = new Map<string, SelfWriteToken>();

  constructor(private readonly app: App) {}

  async loadPlannerState(uiState: unknown): Promise<unknown> {
    const markdown = await this.loadMarkdownState();
    return mergeMarkdownWithUi(markdown, uiState);
  }

  getDiagnostics(): StoreDiagnostic[] {
    return this.diagnostics.map((item) => ({ ...item, paths: [...item.paths] }));
  }

  isManagedPath(path: string): boolean {
    if (normalizePath(path) === normalizePath(CONFIG_PATH)) return true;
    const folders = this.loadFolders();
    return Object.values(folders).some((folder) => isInsidePath(path, folder));
  }

  async isSelfAuthoredChange(fileOrPath: TFile | string): Promise<boolean> {
    const path = typeof fileOrPath === "string" ? fileOrPath : fileOrPath.path;
    const token = this.selfWrites.get(path);
    if (!token) return false;
    if (Date.now() > token.until) {
      this.selfWrites.delete(path);
      return false;
    }
    if (typeof fileOrPath === "string" || token.hash === null) return true;
    try {
      const content = await this.app.vault.cachedRead(fileOrPath);
      return contentHash(content) === token.hash;
    } catch {
      return false;
    }
  }

  async syncPlannerState(state: unknown): Promise<void> {
    const cards = asCards(state);
    const events = asEvents(state);
    assertUniqueIds(cards, "卡片");
    assertUniqueIds(events, "安排");
    const duplicate = this.diagnostics.find((diagnostic) => diagnostic.key.startsWith("duplicate:"));
    if (duplicate) {
      throw new MarkdownWriteConflictError(`存在重复稳定 ID，修复前禁止写入：${duplicate.message}`, duplicate.paths);
    }

    const cardsById = new Map(cards.map((card) => [stringValue(card.id), card]));
    const eventsById = new Map(events.map((event) => [stringValue(event.id), event]));
    const changedCards = cards.filter((card) => {
      const baseline = this.cardBaseline.get(stringValue(card.id));
      return !baseline || baseline.fingerprint !== cardFingerprint(card);
    });
    const changedEvents = events.filter((event) => {
      const baseline = this.eventBaseline.get(stringValue(event.id));
      return !baseline || baseline.fingerprint !== eventFingerprint(event);
    });
    const removedCardIds = [...this.cardBaseline.keys()].filter((id) => !cardsById.has(id));
    const removedEventIds = [...this.eventBaseline.keys()].filter((id) => !eventsById.has(id));

    const touchedPaths = new Set<string>();
    for (const card of changedCards) {
      const baseline = this.cardBaseline.get(stringValue(card.id));
      if (baseline) touchedPaths.add(baseline.path);
    }
    for (const event of changedEvents) {
      const baseline = this.eventBaseline.get(stringValue(event.id));
      if (baseline) touchedPaths.add(baseline.path);
    }
    for (const id of removedCardIds) touchedPaths.add(this.cardBaseline.get(id)!.path);
    for (const id of removedEventIds) touchedPaths.add(this.eventBaseline.get(id)!.path);
    await this.assertFresh([...touchedPaths]);

    const backups = new Map<string, string>();
    const createdPaths: string[] = [];
    try {
      for (const card of changedCards) {
        const id = stringValue(card.id);
        const baseline = this.cardBaseline.get(id);
        if (baseline) {
          await this.updateCardFile(baseline.path, card, backups);
        } else {
          const created = await this.createCardFile(card);
          createdPaths.push(created.path);
          card.markdownPath = created.path;
          card.entityKind = created.kind;
        }
      }

      for (const event of changedEvents) {
        const id = stringValue(event.id);
        const baseline = this.eventBaseline.get(id);
        if (baseline) {
          await this.updateEventFile(baseline.path, event, backups);
        } else {
          const card = cardsById.get(stringValue(event.cardId));
          if (!card) throw new MarkdownWriteConflictError(`安排 ${id} 找不到对应卡片，已停止写入。`);
          const created = await this.createEventFile(event, card);
          createdPaths.push(created.path);
          event.markdownPath = created.path;
          event.subjectKind = cardEntityKind(card.type);
          event.subjectRef = wikilink(stringValue(card.markdownPath), stringValue(card.title) || "未命名卡片");
        }
      }

      for (const id of removedEventIds) {
        await this.cancelEventFile(this.eventBaseline.get(id)!.path, backups);
      }

      for (const id of removedCardIds) {
        await this.softDeleteCardFile(this.cardBaseline.get(id)!.path, backups);
      }

      await this.loadMarkdownState();
    } catch (error) {
      await this.rollback(backups, createdPaths);
      await this.loadMarkdownState().catch(() => undefined);
      throw error;
    }
  }

  private loadFolders(): MarkdownFolders {
    const config = this.app.vault.getAbstractFileByPath(CONFIG_PATH);
    if (!(config instanceof TFile)) return { ...DEFAULT_FOLDERS };
    const frontmatter = this.app.metadataCache.getFileCache(config)?.frontmatter ?? {};
    return {
      benefitsFolder: frontmatterString(frontmatter.benefitsFolder, DEFAULT_FOLDERS.benefitsFolder),
      itemsFolder: frontmatterString(frontmatter.itemsFolder, DEFAULT_FOLDERS.itemsFolder),
      activitiesFolder: frontmatterString(frontmatter.activitiesFolder, DEFAULT_FOLDERS.activitiesFolder),
      schedulesFolder: frontmatterString(frontmatter.schedulesFolder, DEFAULT_FOLDERS.schedulesFolder),
    };
  }

  private async sourceFile(file: TFile): Promise<MarkdownSourceFile> {
    const content = await this.app.vault.cachedRead(file);
    const parsed = splitMarkdown(content);
    this.knownMtimes.set(file.path, file.stat.mtime);
    return {
      path: file.path,
      basename: file.basename,
      frontmatter: parsed.frontmatter,
      content,
    };
  }

  private async loadMarkdownState(): Promise<PlannerMarkdownState> {
    const folders = this.loadFolders();
    const files = this.app.vault.getMarkdownFiles();
    const itemFiles = files.filter((file) =>
      isInsidePath(file.path, folders.benefitsFolder)
      || isInsidePath(file.path, folders.itemsFolder)
      || isInsidePath(file.path, folders.activitiesFolder),
    );
    const scheduleFiles = files.filter((file) => isInsidePath(file.path, folders.schedulesFolder));
    const itemSources = await Promise.all(itemFiles.map((file) => this.sourceFile(file)));
    const scheduleSources = await Promise.all(scheduleFiles.map((file) => this.sourceFile(file)));
    const parsedCards = itemSources.map(cardFromMarkdown).filter((card): card is PlannerCard => card !== null);
    const parsedEvents = scheduleSources.map(eventFromMarkdown).filter((event): event is PlannerEvent => event !== null);

    this.diagnostics = this.collectDiagnostics(itemSources, scheduleSources, parsedCards, parsedEvents);
    const uniqueCards = this.firstById(parsedCards);
    const cardIds = new Set(uniqueCards.map((card) => card.id));
    const validEvents = this.firstById(parsedEvents).filter((event) => cardIds.has(event.cardId));

    this.cardBaseline = new Map(uniqueCards.map((card) => [
      card.id,
      { path: card.markdownPath, fingerprint: cardFingerprint(card as unknown as Record<string, unknown>) },
    ]));
    this.eventBaseline = new Map(validEvents.map((event) => [
      event.id,
      { path: event.markdownPath, fingerprint: eventFingerprint(event as unknown as Record<string, unknown>) },
    ]));
    return { cards: uniqueCards, events: validEvents };
  }

  private collectDiagnostics(
    itemSources: MarkdownSourceFile[],
    scheduleSources: MarkdownSourceFile[],
    cards: PlannerCard[],
    events: PlannerEvent[],
  ): StoreDiagnostic[] {
    const diagnostics: StoreDiagnostic[] = [];
    for (const source of itemSources) {
      if (source.frontmatter.couponSchedulerItem === true && !stableId(source.frontmatter)) {
        diagnostics.push({ key: `missing-card-id:${source.path}`, message: "券食对象缺少稳定 ID", paths: [source.path] });
      }
    }
    for (const source of scheduleSources) {
      if (source.frontmatter.couponSchedulerEvent === true && !stringValue(source.frontmatter.scheduleId)) {
        diagnostics.push({ key: `missing-schedule-id:${source.path}`, message: "券食安排缺少 scheduleId", paths: [source.path] });
      }
    }
    const duplicateDiagnostics = (entries: Array<{ id: string; markdownPath: string }>, label: string) => {
      const pathsById = new Map<string, string[]>();
      for (const entry of entries) pathsById.set(entry.id, [...(pathsById.get(entry.id) ?? []), entry.markdownPath]);
      for (const [id, paths] of pathsById) {
        if (paths.length > 1) diagnostics.push({ key: `duplicate:${label}:${id}`, message: `${label} ID 重复：${id}`, paths });
      }
    };
    duplicateDiagnostics(cards, "卡片");
    duplicateDiagnostics(events, "安排");

    const cardsById = new Map(this.firstById(cards).map((card) => [card.id, card]));
    const plannedByCard = new Map<string, PlannerEvent[]>();
    for (const event of events) {
      if (!cardsById.has(event.cardId)) {
        diagnostics.push({ key: `missing-subject:${event.id}`, message: `安排 ${event.id} 的 subjectId 找不到对象`, paths: [event.markdownPath] });
        continue;
      }
      if (event.status !== "used") plannedByCard.set(event.cardId, [...(plannedByCard.get(event.cardId) ?? []), event]);
    }
    for (const [cardId, planned] of plannedByCard) {
      if (planned.length > 1 && cardsById.get(cardId)?.entityKind !== "activity") {
        diagnostics.push({ key: `multiple-planned:${cardId}`, message: `对象 ${cardId} 存在多条有效安排`, paths: planned.map((event) => event.markdownPath) });
      }
    }

    for (const source of itemSources) {
      const frontmatter = source.frontmatter;
      const ids = stringList(frontmatter.usablePlaceIds ?? frontmatter.placeIds);
      const refs = stringList(frontmatter.usableAt ?? frontmatter.placeRefs);
      if (ids.length !== refs.length) {
        diagnostics.push({ key: `place-count:${source.path}`, message: `地点 ID 与双链数量不一致`, paths: [source.path] });
      }
      refs.forEach((ref, index) => {
        const target = linkTarget(ref);
        if (!target) return;
        const destination = this.app.metadataCache.getFirstLinkpathDest(target, source.path);
        if (!destination) {
          diagnostics.push({ key: `missing-place:${source.path}:${index}`, message: `地点双链失效：${ref}`, paths: [source.path] });
          return;
        }
        const targetFrontmatter = this.app.metadataCache.getFileCache(destination)?.frontmatter ?? {};
        const targetId = stableId(targetFrontmatter);
        if (ids[index] && targetId && ids[index] !== targetId) {
          diagnostics.push({ key: `place-mismatch:${source.path}:${index}`, message: `地点 ID 与双链目标不一致`, paths: [source.path, destination.path] });
        }
      });
    }

    for (const source of scheduleSources) {
      const subjectId = stringValue(source.frontmatter.subjectId);
      const target = linkTarget(source.frontmatter.subjectRef);
      if (!target) continue;
      const destination = this.app.metadataCache.getFirstLinkpathDest(target, source.path);
      if (!destination) {
        diagnostics.push({ key: `missing-subject-ref:${source.path}`, message: `安排对象双链失效`, paths: [source.path] });
        continue;
      }
      const targetId = stableId(this.app.metadataCache.getFileCache(destination)?.frontmatter ?? {});
      if (subjectId && targetId && subjectId !== targetId) {
        diagnostics.push({ key: `subject-mismatch:${source.path}`, message: `安排的 subjectId 与 subjectRef 不一致`, paths: [source.path, destination.path] });
      }
    }
    return diagnostics;
  }

  private firstById<T extends { id: string }>(entries: T[]): T[] {
    const seen = new Set<string>();
    return entries.filter((entry) => {
      if (seen.has(entry.id)) return false;
      seen.add(entry.id);
      return true;
    });
  }

  private async assertFresh(paths: string[]): Promise<void> {
    const conflicts: string[] = [];
    for (const path of paths) {
      const file = this.app.vault.getAbstractFileByPath(path);
      const known = this.knownMtimes.get(path);
      if (!(file instanceof TFile) || known === undefined || file.stat.mtime !== known) conflicts.push(path);
    }
    if (conflicts.length) {
      throw new MarkdownWriteConflictError("Markdown 在编辑期间已被其他操作修改，本次写入已取消并重新加载。", conflicts);
    }
  }

  private async updateCardFile(path: string, card: Record<string, unknown>, backups: Map<string, string>): Promise<void> {
    await this.modifyMarkdown(path, backups, (frontmatter, body) => {
      const kind = cardKindFromFrontmatter(frontmatter, card);
      const currentId = stableId(frontmatter);
      if (currentId && currentId !== stringValue(card.id)) {
        throw new MarkdownWriteConflictError(`卡片稳定 ID 已变化：${path}`, [path]);
      }
      this.applyCardFrontmatter(frontmatter, card, kind, false);
      return { frontmatter, body: replaceMarkdownSection(body, "备注", stringValue(card.notes)) };
    });
  }

  private async createCardFile(card: Record<string, unknown>): Promise<{ path: string; kind: CardEntityKind }> {
    const folders = this.loadFolders();
    const kind = cardEntityKind(card.type);
    const folder = kind === "benefit" ? folders.benefitsFolder : kind === "item" ? folders.itemsFolder : folders.activitiesFolder;
    await this.ensureFolder(folder);
    const title = stringValue(card.title) || "新卡片";
    const id = stringValue(card.id);
    const path = await this.uniquePath(folder, `${safeFileStem(title)}-${id.slice(-6)}.md`);
    const frontmatter: Record<string, unknown> = {};
    this.applyCardFrontmatter(frontmatter, card, kind, true);
    const body = `# ${title}\n\n## 备注\n\n${stringValue(card.notes)}`.trimEnd() + "\n";
    const content = buildMarkdown(frontmatter, body);
    const file = await this.app.vault.create(path, content);
    this.recordSelfWrite(file.path, content);
    this.knownMtimes.set(file.path, file.stat.mtime);
    return { path: file.path, kind };
  }

  private applyCardFrontmatter(
    frontmatter: Record<string, unknown>,
    card: Record<string, unknown>,
    kind: CardEntityKind,
    isNew: boolean,
  ): void {
    const id = stringValue(card.id);
    const now = localIsoTimestamp();
    frontmatter.couponSchedulerItem = true;
    frontmatter.schemaVersion = Number(frontmatter.schemaVersion) || 1;
    frontmatter.title = stringValue(card.title) || "新卡片";
    frontmatter.calendarType = stringValue(card.type) || "voucher";
    frontmatter.sourcePlatform = stringValue(card.source);
    frontmatter.purchasePrice = nullableNumber(card.price);
    frontmatter.faceValue = nullableNumber(card.value);
    frontmatter.validFrom = nullableString(card.validFrom);
    frontmatter.validTo = nullableString(card.validTo);
    frontmatter.desire = Math.max(1, Math.min(5, Math.round(Number(card.desire) || 3)));
    const hasPlaceRelation = stringList(frontmatter.usableAt ?? frontmatter.placeRefs ?? frontmatter.placeRef).length > 0;
    if (!hasPlaceRelation) frontmatter.locationHint = stringValue(card.location);
    frontmatter.tags = isNew ? tagsForNewCard(kind, card.tags) : stringList(card.tags).map((tag) => tag.replace(/^#/, ""));
    frontmatter.created = frontmatter.created || stringValue(card.createdAt) || now;
    frontmatter.updated = now;

    if (kind === "benefit") {
      frontmatter.entityType = "benefit";
      frontmatter.benefitId = id;
      frontmatter.merchantName = stringValue(card.merchantName);
      frontmatter.usableStart = nullableString(card.usableStart);
      frontmatter.usableEnd = nullableString(card.usableEnd);
      frontmatter.benefitStatus = factStatus(kind, card.status);
      if (isNew) {
        frontmatter.aliases = [];
        frontmatter.merchantId = "";
        frontmatter.merchantRef = "";
        frontmatter.usablePlaceIds = [];
        frontmatter.usableAt = [];
      }
    } else if (kind === "item") {
      frontmatter.recordType = "coupon-calendar-item";
      frontmatter.itemId = id;
      frontmatter.merchantName = stringValue(card.merchantName);
      frontmatter.usableStart = nullableString(card.usableStart);
      frontmatter.usableEnd = nullableString(card.usableEnd);
      frontmatter.itemStatus = factStatus(kind, card.status);
      if (isNew) {
        frontmatter.aliases = [];
        frontmatter.placeIds = [];
        frontmatter.placeRefs = [];
      }
    } else {
      frontmatter.entityType = "activity";
      frontmatter.activityId = id;
      frontmatter.repeatRule = "weekly";
      frontmatter.repeatWeekday = card.repeatWeekday === "" || card.repeatWeekday === undefined ? null : Number(card.repeatWeekday);
      frontmatter.defaultStart = nullableString(card.usableStart);
      frontmatter.defaultEnd = nullableString(card.usableEnd);
      frontmatter.activityStatus = factStatus(kind, card.status);
      if (isNew) {
        frontmatter.aliases = [];
        frontmatter.placeId = "";
        frontmatter.placeRef = "";
      }
    }
  }

  private async updateEventFile(path: string, event: Record<string, unknown>, backups: Map<string, string>): Promise<void> {
    await this.modifyMarkdown(path, backups, (frontmatter, body) => {
      if (stringValue(frontmatter.scheduleId) !== stringValue(event.id)) {
        throw new MarkdownWriteConflictError(`安排稳定 ID 已变化：${path}`, [path]);
      }
      frontmatter.date = stringValue(event.date);
      frontmatter.start = stringValue(event.start);
      frontmatter.end = stringValue(event.end);
      frontmatter.eventStatus = event.status === "used" ? "done" : "planned";
      frontmatter.updated = localIsoTimestamp();
      return { frontmatter, body };
    });
  }

  private async createEventFile(event: Record<string, unknown>, card: Record<string, unknown>): Promise<TFile> {
    const folder = this.loadFolders().schedulesFolder;
    await this.ensureFolder(folder);
    const title = stringValue(card.title) || "未命名卡片";
    const id = stringValue(event.id);
    const date = stringValue(event.date);
    const path = await this.uniquePath(folder, `${safeFileStem(`${date}-${title}`)}-${id.slice(-6)}.md`);
    const cardPath = stringValue(card.markdownPath);
    if (!cardPath) throw new MarkdownWriteConflictError(`无法为安排 ${id} 建立对象双链。`);
    const kind = cardEntityKind(card.type);
    const now = localIsoTimestamp();
    const frontmatter: Record<string, unknown> = {
      couponSchedulerEvent: true,
      recordType: "coupon-calendar-schedule",
      schemaVersion: 1,
      scheduleId: id,
      subjectKind: kind,
      subjectId: stringValue(card.id),
      subjectRef: wikilink(cardPath, title),
      date,
      start: stringValue(event.start),
      end: stringValue(event.end),
      eventStatus: event.status === "used" ? "done" : "planned",
      placeId: "",
      placeRef: "",
      taskId: "",
      taskRef: "",
      created: stringValue(event.createdAt) || now,
      updated: now,
      tags: ["记录/券食安排"],
    };
    const content = buildMarkdown(frontmatter, `# ${date} 使用${title}\n\n## 安排备注\n`);
    const file = await this.app.vault.create(path, content);
    this.recordSelfWrite(file.path, content);
    this.knownMtimes.set(file.path, file.stat.mtime);
    return file;
  }

  private async cancelEventFile(path: string, backups: Map<string, string>): Promise<void> {
    await this.modifyMarkdown(path, backups, (frontmatter, body) => {
      frontmatter.eventStatus = "cancelled";
      frontmatter.updated = localIsoTimestamp();
      return { frontmatter, body };
    });
  }

  private async softDeleteCardFile(path: string, backups: Map<string, string>): Promise<void> {
    await this.modifyMarkdown(path, backups, (frontmatter, body) => {
      frontmatter.couponSchedulerItem = false;
      frontmatter.archivedByCouponScheduler = true;
      frontmatter.deletedAt = localIsoTimestamp();
      frontmatter.updated = localIsoTimestamp();
      return { frontmatter, body };
    });
  }

  private async modifyMarkdown(
    path: string,
    backups: Map<string, string>,
    updater: (frontmatter: Record<string, unknown>, body: string) => { frontmatter: Record<string, unknown>; body: string },
  ): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) throw new MarkdownWriteConflictError(`找不到 Markdown：${path}`, [path]);
    const original = await this.app.vault.cachedRead(file);
    if (!backups.has(path)) backups.set(path, original);
    const parsed = splitMarkdown(original);
    const next = updater({ ...parsed.frontmatter }, parsed.body);
    const content = buildMarkdown(next.frontmatter, next.body);
    if (content === original) return;
    await this.app.vault.modify(file, content);
    this.recordSelfWrite(path, content);
    this.knownMtimes.set(path, file.stat.mtime);
  }

  private async rollback(backups: Map<string, string>, createdPaths: string[]): Promise<void> {
    for (const [path, content] of [...backups.entries()].reverse()) {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) continue;
      await this.app.vault.modify(file, content).catch(() => undefined);
      this.recordSelfWrite(path, content);
      this.knownMtimes.set(path, file.stat.mtime);
    }
    for (const path of [...createdPaths].reverse()) {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) continue;
      this.selfWrites.set(path, { hash: null, until: Date.now() + SELF_WRITE_TTL_MS });
      await this.app.vault.trash(file, true).catch(() => undefined);
    }
  }

  private async ensureFolder(path: string): Promise<void> {
    const normalized = normalizePath(path);
    const segments = normalized.split("/");
    let current = "";
    for (const segment of segments) {
      current = current ? `${current}/${segment}` : segment;
      const existing = this.app.vault.getAbstractFileByPath(current);
      if (existing instanceof TFolder) continue;
      if (existing) throw new Error(`无法创建目录，路径已被文件占用：${current}`);
      await this.app.vault.createFolder(current);
    }
  }

  private async uniquePath(folder: string, fileName: string): Promise<string> {
    const stem = fileName.replace(/\.md$/i, "");
    let candidate = normalizePath(`${folder}/${fileName}`);
    let suffix = 2;
    while (this.app.vault.getAbstractFileByPath(candidate)) {
      candidate = normalizePath(`${folder}/${stem}-${suffix}.md`);
      suffix += 1;
    }
    return candidate;
  }

  private recordSelfWrite(path: string, content: string): void {
    this.selfWrites.set(path, { hash: contentHash(content), until: Date.now() + SELF_WRITE_TTL_MS });
  }
}
