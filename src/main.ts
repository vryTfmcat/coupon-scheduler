import { ItemView, Notice, Plugin, WorkspaceLeaf } from "obsidian";
import brandIconUrl from "../icon.png";
import { mountCouponCalendar } from "./planner.js";
import { createAppTemplate } from "./template";

const VIEW_TYPE = "coupon-scheduler-view";

interface StoredPluginData {
  schemaVersion: number;
  state: unknown;
}

export default class CouponSchedulerPlugin extends Plugin {
  private saveQueue: Promise<void> = Promise.resolve();

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
      .then(() => this.saveData({ schemaVersion: 1, state: snapshot }))
      .catch((error) => {
        console.error("券食日历保存失败", error);
        new Notice("券食日历保存失败，请查看开发者控制台");
      });
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
