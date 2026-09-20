# Coupon Scheduler

Coupon Scheduler is a local-first calendar workspace for planning coupons, groceries, shopping reminders, red packets, and recurring activities inside Obsidian. A fixed map view can show purchased coupons around a chosen area without providing navigation.

![Coupon Scheduler icon](icon.png)

## Features

- Organize unscheduled cards into outings, groceries, and trash.
- Plan cards in day, week, and month calendar views.
- Track validity dates, usable hours, locations, prices, tags, and notes.
- Show located coupons on a fixed OpenStreetMap view, filter used coupons, and keep unlocated coupons in a correction list.
- Optionally show a private home/center marker from local plugin data; no home address is included in the published source.
- Show the merchant name beside each map pin and summarize the food category with one Chinese character.
- Store merchant name separately from the voucher title. Vouchers for the same merchant and map location share one pin with a superscript count; nearby labels are automatically offset with leader lines to reduce overlap.
- Locate a merchant with an explicit place search, enter coordinates, or select a coupon and click the map.
- Add multiple usable merchant locations to one coupon while keeping the original single-location data compatible.
- Keep recurring activities as reusable templates.
- Move cards to the trash without losing their history.
- Import and export JSON backups compatible with the Coupon Scheduler web version.

## Usage

1. Open **Coupon Scheduler** from the ribbon or the command palette.
2. Select **Add** to create a card.
3. Drag a card onto the calendar, or select it to edit its details.
4. Use the outing, grocery, and trash tabs to switch card groups.
5. Open **Map**, choose an unlocated coupon, then search for its merchant or click the map to place it.

An approximate area coordinate can be stored with `geoPrecision: "area"`. These coupons appear on the map with amber markers and stay in **Needs location / correction** until the merchant position is searched or manually corrected.

The current interface is in Simplified Chinese.

## Data and privacy

Calendar data, merchant coordinates, and settings stay in the vault through Obsidian's plugin data API. The plugin does not collect telemetry or upload the planner database.

Opening **Map** downloads only the visible map tiles from the configured tile service. Selecting **Search this merchant** sends that card's merchant name, location text, and configured search-area hint to the configured geocoder. The defaults use OpenStreetMap tiles and the public Nominatim service; searches are user-triggered, cached during the session, and serialized to respect the service limit. Both service endpoints can be changed from **Map → Map services**. See the [OpenStreetMap tile policy](https://operations.osmfoundation.org/policies/tiles/) and [Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/).

Use **Export** to create a portable JSON backup. Coordinates are stored on their coupon cards, so they remain compatible with import and export.

## Development

```bash
npm install
npm run build
```

For local testing, set `OBSIDIAN_VAULT` to your development vault path, then run `npm run install:local`.

## 中文说明

Coupon Scheduler（券食日历）用于在 Obsidian 中安排团购券、食材、购物提醒、红包和固定活动，并通过固定地图查看已购买的券。一张多店通用券可以保存多个可用门店位置。日历和券数据保存在本地；只有打开地图或主动搜索商家时才会访问所配置的地图服务。插件支持日／周／月／地图视图、待定位清单、回收站以及含坐标的 JSON 导入导出。

## License

[MIT](LICENSE)
