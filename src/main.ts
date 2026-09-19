import { ItemView, Notice, Plugin, requestUrl, WorkspaceLeaf } from "obsidian";
import brandIconUrl from "../icon.png";
import { mountCouponCalendar } from "./planner.js";
import { createAppTemplate } from "./template";

const VIEW_TYPE = "coupon-scheduler-view";

interface StoredPluginData {
  schemaVersion: number;
  state: unknown;
}

interface PlaceSearchResult {
  displayName: string;
  latitude: number;
  longitude: number;
}

export default class CouponSchedulerPlugin extends Plugin {
  private saveQueue: Promise<void> = Promise.resolve();
  private geocodeQueue: Promise<void> = Promise.resolve();
  private geocodeCache = new Map<string, PlaceSearchResult[]>();
  private lastGeocodeAt = 0;

  async onload(): Promise<void> {
    this.registerView(VIEW_TYPE, (leaf) => new CouponSchedulerView(leaf, this));

    this.addRibbonIcon("calendar-days", "打开券食日历", () => {
      void this.activateView();
    });

    this.addCommand({
      id: "open-calendar",
      name: "打开券食日历",
      callback: () => void this.activateView(),
    });
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
    return saved?.state ?? null;
  }

  savePlannerState(state: unknown): void {
    const snapshot = structuredClone(state);
    this.saveQueue = this.saveQueue
      .catch(() => undefined)
      .then(() => this.saveData({ schemaVersion: 3, state: snapshot }))
      .catch((error) => {
        console.error("券食日历保存失败", error);
        new Notice("券食日历保存失败，请查看开发者控制台");
      });
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
      searchPlace: (query: string, endpoint: string) => this.plugin.searchPlace(query, endpoint),
      layoutElement: this.containerEl,
    });
  }

  async onClose(): Promise<void> {
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
