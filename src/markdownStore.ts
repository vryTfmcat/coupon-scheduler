import { App, normalizePath, TFile } from "obsidian";
import {
  cardFromMarkdown,
  eventFromMarkdown,
  mergeMarkdownWithUi,
  type MarkdownSourceFile,
  type PlannerMarkdownState,
} from "./markdownAdapter";

const CONFIG_PATH = "30_项目/券食日历/配置/券食日历配置.md";

interface MarkdownFolders {
  benefitsFolder: string;
  itemsFolder: string;
  activitiesFolder: string;
  schedulesFolder: string;
}

const DEFAULT_FOLDERS: MarkdownFolders = {
  benefitsFolder: "50_实体/权益/券食权益",
  itemsFolder: "50_实体/记录/券食条目",
  activitiesFolder: "50_实体/活动/固定活动",
  schedulesFolder: "50_实体/记录/券食安排",
};

function frontmatterString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function isInside(file: TFile, folder: string): boolean {
  return file.path.startsWith(`${normalizePath(folder)}/`);
}

export class MarkdownPlannerStore {
  constructor(private readonly app: App) {}

  async loadPlannerState(uiState: unknown): Promise<unknown> {
    const markdown = await this.loadMarkdownState();
    return mergeMarkdownWithUi(markdown, uiState);
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
    return {
      path: file.path,
      basename: file.basename,
      frontmatter: this.app.metadataCache.getFileCache(file)?.frontmatter ?? {},
      content: await this.app.vault.cachedRead(file),
    };
  }

  private async loadMarkdownState(): Promise<PlannerMarkdownState> {
    const folders = this.loadFolders();
    const files = this.app.vault.getMarkdownFiles();
    const itemFiles = files.filter((file) =>
      isInside(file, folders.benefitsFolder)
      || isInside(file, folders.itemsFolder)
      || isInside(file, folders.activitiesFolder),
    );
    const scheduleFiles = files.filter((file) => isInside(file, folders.schedulesFolder));

    const cards = (await Promise.all(itemFiles.map((file) => this.sourceFile(file))))
      .map(cardFromMarkdown)
      .filter((card) => card !== null);
    const events = (await Promise.all(scheduleFiles.map((file) => this.sourceFile(file))))
      .map(eventFromMarkdown)
      .filter((event) => event !== null);

    this.warnDuplicateIds(cards.map((card) => ({ id: card.id, path: card.markdownPath })), "卡片");
    this.warnDuplicateIds(events.map((event) => ({ id: event.id, path: event.markdownPath })), "安排");

    const uniqueCards = this.firstById(cards);
    const cardIds = new Set(uniqueCards.map((card) => card.id));
    const validEvents = this.firstById(events).filter((event) => {
      if (cardIds.has(event.cardId)) return true;
      console.warn(`券食日历：安排 ${event.markdownPath} 的 subjectId 无对应对象：${event.cardId}`);
      return false;
    });
    return { cards: uniqueCards, events: validEvents };
  }

  private firstById<T extends { id: string }>(entries: T[]): T[] {
    const seen = new Set<string>();
    return entries.filter((entry) => {
      if (seen.has(entry.id)) return false;
      seen.add(entry.id);
      return true;
    });
  }

  private warnDuplicateIds(entries: Array<{ id: string; path: string }>, label: string): void {
    const paths = new Map<string, string[]>();
    for (const entry of entries) paths.set(entry.id, [...(paths.get(entry.id) ?? []), entry.path]);
    for (const [id, duplicates] of paths) {
      if (duplicates.length > 1) console.warn(`券食日历：重复${label} ID ${id}`, duplicates);
    }
  }
}
