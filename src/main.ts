import { ItemView, Notice, Plugin, requestUrl, TAbstractFile, TFile, WorkspaceLeaf } from "obsidian";
import brandIconUrl from "../icon.png";
import { extractUiState } from "./markdownAdapter";
import { MarkdownPlannerStore, MarkdownWriteConflictError } from "./markdownStore";
import { mountCouponCalendar } from "./planner.js";
import { createAppTemplate } from "./template";

const VIEW_TYPE = "coupon-scheduler-view";

interface StoredPluginData {
  schemaVersion: number;
  ui?: unknown;
  state?: unknown;
}

interface PlaceSearchResult {
  displayName: string;
  latitude: number;
  longitude: number;
}

export default class CouponSchedulerPlugin extends Plugin {
  private saveQueue: Promise<void> = Promise.resolve();
  private pendingPlannerState: unknown | null = null;
  private saveTimer: number | null = null;
  private refreshTimer: number | null = null;
  private changeListeners = new Set<() => void>();
  private activeDiagnosticKeys = new Set<string>();
  private geocodeQueue: Promise<void> = Promise.resolve();
  private geocodeCache = new Map<string, PlaceSearchResult[]>();
  private lastGeocodeAt = 0;
  private markdownStore!: MarkdownPlannerStore;

  async onload(): Promise<void> {
    this.markdownStore = new MarkdownPlannerStore(this.app);
    this.registerView(VIEW_TYPE, (leaf) => new CouponSchedulerView(leaf, this));

    this.addRibbonIcon("calendar-days", "打开券食日历", () => {
      void this.activateView();
    });

    this.addCommand({
      id: "open-calendar",
      name: "打开券食日历",
      callback: () => void this.activateView(),
    });

    this.registerEvent(this.app.vault.on("create", (file) => void this.handleVaultChange(file)));
    this.registerEvent(this.app.vault.on("modify", (file) => void this.handleVaultChange(file)));
    this.registerEvent(this.app.vault.on("delete", (file) => void this.handleVaultChange(file)));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => void this.handleVaultChange(file, oldPath)));
  }

  onunload(): void {
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
    void this.flushPlannerState();
  }

  async activateView(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    const leaf = existing ?? this.app.workspace.getLeaf("tab");

    if (!existing) {
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }

    this.app.workspace.setActiveLeaf(leaf, { focus: true });
  }

  async loadPlannerState(): Promise<unknown | null> {
    const saved = (await this.loadData()) as StoredPluginData | null;
    const uiState = saved?.ui ?? saved?.state ?? null;
    const state = await this.markdownStore.loadPlannerState(uiState);
    this.reportDiagnostics();
    return state;
  }

  async reloadPlannerState(currentState: unknown): Promise<unknown> {
    const state = await this.markdownStore.loadPlannerState(extractUiState(currentState));
    this.reportDiagnostics();
    return state;
  }

  async openMarkdown(path: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      new Notice("券食日历：找不到对应的 Markdown 文件");
      return;
    }
    await this.app.workspace.getLeaf("tab").openFile(file);
  }

  savePlannerState(state: unknown): void {
    this.pendingPlannerState = state;
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      void this.flushPlannerState();
    }, 350);
  }

  async flushPlannerState(): Promise<void> {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    const state = this.pendingPlannerState;
    if (!state) {
      await this.saveQueue;
      return;
    }
    this.pendingPlannerState = null;
    const snapshot = extractUiState(state);
    this.saveQueue = this.saveQueue
      .catch(() => undefined)
      .then(async () => {
        await this.markdownStore.syncPlannerState(state);
        await this.saveData({ schemaVersion: 5, ui: snapshot });
        this.reportDiagnostics();
      })
      .catch((error) => {
        console.error("券食日历 Markdown 写入失败", error);
        if (error instanceof MarkdownWriteConflictError) {
          const detail = error.paths.length ? `：${error.paths.slice(0, 2).join("、")}` : "";
          new Notice(`券食日历：检测到并发修改，未覆盖外部内容${detail}`, 8_000);
        } else {
          new Notice("券食日历写入失败，已尝试恢复原文件；界面将重新加载。", 8_000);
        }
        this.emitPlannerChange();
      })
      .finally(() => {
        if (this.pendingPlannerState) this.savePlannerState(this.pendingPlannerState);
      });
    await this.saveQueue;
  }

  subscribePlannerChanges(listener: () => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  async searchPlace(query: string, endpoint: string): Promise<PlaceSearchResult[]> {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) return [];

    const baseUrl = new URL(endpoint);
    if (baseUrl.protocol !== "https:") {
      throw new Error("地点搜索服务必须使用 HTTPS");
    }

    const cacheKey = `${baseUrl.origin}${baseUrl.pathname}|${normalizedQuery}`;
    const cached = this.geocodeCache.get(cacheKey);
    if (cached) return cached;

    const work = this.geocodeQueue.then(async () => {
      const elapsed = Date.now() - this.lastGeocodeAt;
      if (elapsed < 1100) {
        await new Promise((resolve) => window.setTimeout(resolve, 1100 - elapsed));
      }

      baseUrl.searchParams.set("q", normalizedQuery);
      baseUrl.searchParams.set("format", "jsonv2");
      baseUrl.searchParams.set("limit", "6");
      baseUrl.searchParams.set("countrycodes", "cn");
      baseUrl.searchParams.set("addressdetails", "1");

      try {
        const response = await requestUrl({
          url: baseUrl.toString(),
          method: "GET",
          headers: {
            Accept: "application/json",
            "Accept-Language": "zh-CN,zh;q=0.9",
            "User-Agent": "CouponScheduler/1.1 (+https://github.com/vryTfmcat/coupon-scheduler)",
          },
        });
        const payload = Array.isArray(response.json) ? response.json : [];
        const results = payload
          .map((item: Record<string, unknown>) => ({
            displayName: String(item.display_name || "未命名地点"),
            latitude: Number(item.lat),
            longitude: Number(item.lon),
          }))
          .filter((item: PlaceSearchResult) => Number.isFinite(item.latitude) && Number.isFinite(item.longitude));
        this.geocodeCache.set(cacheKey, results);
        return results;
      } finally {
        this.lastGeocodeAt = Date.now();
      }
    });

    this.geocodeQueue = work.then(() => undefined, () => undefined);
    return work;
  }

  private async handleVaultChange(file: TAbstractFile, oldPath?: string): Promise<void> {
    const paths = [file.path, oldPath].filter((path): path is string => Boolean(path));
    if (!paths.some((path) => this.markdownStore.isManagedPath(path))) return;
    if (file instanceof TFile && await this.markdownStore.isSelfAuthoredChange(file)) return;
    if (!(file instanceof TFile) && await this.markdownStore.isSelfAuthoredChange(file.path)) return;

    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null;
      void this.flushPlannerState().finally(() => this.emitPlannerChange());
    }, 650);
  }

  private emitPlannerChange(): void {
    for (const listener of this.changeListeners) listener();
  }

  private reportDiagnostics(): void {
    const diagnostics = this.markdownStore.getDiagnostics();
    const nextKeys = new Set(diagnostics.map((item) => item.key));
    for (const diagnostic of diagnostics) {
      if (this.activeDiagnosticKeys.has(diagnostic.key)) continue;
      const path = diagnostic.paths[0] ? `（${diagnostic.paths[0]}）` : "";
      new Notice(`券食日历数据冲突：${diagnostic.message}${path}`, 10_000);
      console.warn("券食日历数据冲突", diagnostic);
    }
    this.activeDiagnosticKeys = nextKeys;
  }
}

class CouponSchedulerView extends ItemView {
  private cleanup: (() => void) | null = null;

  constructor(leaf: WorkspaceLeaf, private plugin: CouponSchedulerPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE;
  }

  getDisplayText(): string {
    return "券食日历";
  }

  getIcon(): string {
    return "calendar-days";
  }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("coupon-scheduler-view");
    appendHtml(this.contentEl, createAppTemplate(brandIconUrl));

    this.cleanup = await mountCouponCalendar(this.contentEl, {
      loadState: () => this.plugin.loadPlannerState(),
      saveState: (state: unknown) => this.plugin.savePlannerState(state),
      reloadState: (state: unknown) => this.plugin.reloadPlannerState(state),
      subscribeToChanges: (listener: () => void) => this.plugin.subscribePlannerChanges(listener),
      searchPlace: (query: string, endpoint: string) => this.plugin.searchPlace(query, endpoint),
      openMarkdown: (path: string) => this.plugin.openMarkdown(path),
      layoutElement: this.containerEl,
    });
  }

  async onClose(): Promise<void> {
    await this.plugin.flushPlannerState();
    this.cleanup?.();
    this.cleanup = null;
    this.contentEl.removeClass("coupon-scheduler-view");
    this.contentEl.empty();
  }
}

function appendHtml(container: HTMLElement, html: string): void {
  const Parser = container.ownerDocument.defaultView?.DOMParser ?? DOMParser;
  const parsed = new Parser().parseFromString(html, "text/html");
  const nodes = Array.from(parsed.body.childNodes, (node) =>
    container.ownerDocument.importNode(node, true),
  );
  container.append(...nodes);
}
