# Coupon Scheduler / 券食日历

Coupon Scheduler is a local-first Obsidian calendar for viewing and arranging coupons, groceries, shopping reminders, red packets, and recurring activities. Version `1.4.0` reads and writes business data through ordinary Markdown notes while keeping only device UI preferences in the plugin's `data.json`.

券食日历是一个以日历为中心的 Obsidian 插件，用于查看和安排团购券、食材、购物提醒、红包与固定活动。当前版本为 `1.4.0`：业务数据直接读写普通 Markdown，插件 `data.json` 只保存当前设备的界面状态。

## Current capabilities / 当前能力

- Keep the existing day, week, month, card, drag-and-drop, and recycle-bin interface.
- Read benefits, ordinary items, recurring activities, and schedules from configured Markdown folders.
- Derive scheduled and completed UI states from Markdown facts and schedule records.
- Open the exact source Markdown note from a card title or detail action.
- Keep long card titles and metadata inside their card boundaries.
- Store only view preferences and other device-local UI state in `data.json`.
- Write create, edit, schedule, complete, void, restore, and cancel actions back to frontmatter.
- Reload after external Markdown or Base edits, with debouncing, mtime conflict checks, self-write suppression, rollback, and relationship diagnostics.

- 保留原有日、周、月、卡片、拖拽和回收站界面。
- 从配置目录读取权益、普通条目、固定活动和安排记录。
- 根据 Markdown 事实与安排记录派生“未安排、已安排、已使用”等界面状态。
- 点击卡片标题或详情按钮可打开对应 Markdown。
- 长标题和元数据不会横向溢出卡片。
- `data.json` 只保存界面偏好，不保存券、日期、价格或地点坐标等业务事实。
- 新建、编辑、拖拽安排、完成、作废、恢复和取消安排会直接写回 Markdown。
- 外部修改或 Base 编辑后自动刷新，并提供防循环、防抖、mtime 并发检查、失败恢复和关系冲突提示。

## Markdown folders / Markdown 目录

Default folders:

```text
50_实体/权益/券食权益/
50_实体/记录/券食条目/
50_实体/活动/固定活动/
50_实体/记录/券食安排/
```

Only notes carrying the explicit `couponSchedulerItem: true` or `couponSchedulerEvent: true` marker are parsed. Stable IDs are the machine identity; Obsidian wikilinks provide readable navigation.

插件只识别带有 `couponSchedulerItem: true` 或 `couponSchedulerEvent: true` 的笔记。稳定 ID 用于程序校验，Obsidian 双链用于阅读、跳转和反链。

## Place integration / 地点联通

Coupon Scheduler does not maintain a map database or duplicate coordinates. A benefit may reference one or more place entities with:

```yaml
usablePlaceIds:
  - plc_01...
usableAt:
  - "[[50_实体/地点/外部地点/某门店-短ID|某门店]]"
```

The independent [Personal Map](https://github.com/vryTfmcat/personal-map) plugin can search AMap, create or reuse a place note, and write this relationship back to the benefit Markdown. The two plugins do not share source code, settings, private JSON, or a map implementation.

券食日历不维护地图数据库，也不复制经纬度。独立的 [个人地图](https://github.com/vryTfmcat/personal-map) 插件负责高德搜索、创建或复用地点，并把 `usablePlaceIds + usableAt` 回写到券笔记。两个插件不共享源码、设置、私有 JSON 或地图实现。

## Write safety / 写入安全

Version `1.4.0` uses Markdown as the authoritative business store. Writes are debounced and serialized. Before changing an existing note, the plugin compares its current mtime with the version last loaded; a mismatch cancels the write and reloads external content. Plugin-authored changes carry a short-lived content token so the file watcher does not refresh in a loop. Multi-file operations keep backups and restore modified files if a later step fails.

`1.4.0` 以 Markdown 作为唯一业务数据源。写入经过 350 ms 防抖并串行执行；修改已有笔记前检查 mtime，不一致时取消写入并重新加载外部内容。插件写入带短期内容令牌，避免文件监听循环刷新；多文件操作会保留原文，后续步骤失败时恢复已经修改的文件。删除卡片采用可恢复的软删除标记，不直接永久删除笔记。

## Data history / 历史数据

- Old JSON backups are archival references and are not restored automatically.
- The archived map edition remains available at [`archive/map-edition-2026-09-19`](https://github.com/vryTfmcat/coupon-scheduler/tree/archive/map-edition-2026-09-19).
- The current plugin does not read the archived map data or its coordinates.

## Development

```bash
npm install
npm test
npm run build
```

Current verification: 13 storage and adapter tests pass, the production build succeeds, and a real vault test covers creation, editing, scheduling, moving, completion, voiding, external refresh, mtime conflict protection, and relationship diagnostics.

## License

[MIT](LICENSE)
