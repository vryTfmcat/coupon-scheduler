# Coupon Scheduler

Coupon Scheduler is an offline calendar workspace for planning coupons, groceries, shopping reminders, red packets, and recurring activities inside Obsidian.

![Coupon Scheduler icon](icon.png)

## Features

- Organize unscheduled cards into outings, groceries, and trash.
- Plan cards in day, week, and month calendar views.
- Track validity dates, usable hours, locations, prices, tags, and notes.
- Keep recurring activities as reusable templates.
- Move cards to the trash without losing their history.
- Import and export JSON backups compatible with the Coupon Scheduler web version.

## Usage

1. Open **Coupon Scheduler** from the ribbon or the command palette.
2. Select **Add** to create a card.
3. Drag a card onto the calendar, or select it to edit its details.
4. Use the outing, grocery, and trash tabs to switch card groups.

The current interface is in Simplified Chinese.

## Data and privacy

Coupon Scheduler works entirely offline. It does not make network requests, collect telemetry, or access files outside the vault. Planner data is stored through Obsidian's plugin data API. Use **Export** to create a portable JSON backup.

## Development

```bash
npm install
npm run build
```

For local testing, set `OBSIDIAN_VAULT` to your development vault path, then run `npm run install:local`.

## 中文说明

Coupon Scheduler（券食日历）用于在 Obsidian 中安排团购券、食材、购物提醒、红包和固定活动。插件完全离线运行，支持日／周／月日历、未安排卡片分类、回收站以及 JSON 导入导出。

## License

[MIT](LICENSE)
