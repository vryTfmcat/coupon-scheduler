const typeMeta = {
  redPacket: { label: "红包", color: "#b94a3d" },
  voucher: { label: "团购券", color: "#336a9c" },
  weeklyActivity: { label: "固定活动", color: "#7b5aa6" },
  food: { label: "食物", color: "#3f7b54" },
  delivery: { label: "购物", color: "#b8792e" },
};

const statusMeta = {
  unscheduled: "未安排",
  scheduled: "已安排",
  used: "已使用",
  discarded: "回收站",
};

const dayNames = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const weekHeaderNames = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
const inboxPageTypes = {
  outing: ["weeklyActivity", "voucher", "redPacket", "delivery"],
  food: ["food"],
};

const defaultMapSettings = {
  centerLatitude: 22.6539,
  centerLongitude: 114.0237,
  zoom: 13,
  areaHint: "深圳市龙华区",
  showUsed: false,
  tileUrl: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  geocoderUrl: "https://nominatim.openstreetmap.org/search",
};

export async function mountCouponCalendar(container, bridge) {
  const root = container;
  const persistState = bridge.saveState;
  const layoutElement = bridge.layoutElement || root;
  const el = {
    todaySummary: root.querySelector("#todaySummary"),
    prevRange: root.querySelector("#prevRange"),
    todayButton: root.querySelector("#todayButton"),
    nextRange: root.querySelector("#nextRange"),
    weekViewButton: root.querySelector("#weekViewButton"),
    dayViewButton: root.querySelector("#dayViewButton"),
    monthViewButton: root.querySelector("#monthViewButton"),
    mapViewButton: root.querySelector("#mapViewButton"),
    addCardButton: root.querySelector("#addCardButton"),
    importButton: root.querySelector("#importButton"),
    exportButton: root.querySelector("#exportButton"),
    importFile: root.querySelector("#importFile"),
    typeFilter: root.querySelector("#typeFilter"),
    tagFilter: root.querySelector("#tagFilter"),
    searchInput: root.querySelector("#searchInput"),
    inboxTitle: root.querySelector("#inboxTitle"),
    unscheduledCards: root.querySelector("#unscheduledCards"),
    inboxPageButtons: Array.from(root.querySelectorAll("[data-inbox-page]")),
    inboxCount: root.querySelector("#inboxCount"),
    calendarTitle: root.querySelector("#calendarTitle"),
    rangeLabel: root.querySelector("#rangeLabel"),
    calendarGrid: root.querySelector("#calendarGrid"),
    detailBody: root.querySelector("#detailBody"),
    selectedState: root.querySelector("#selectedState"),
    emptyDetailTemplate: root.querySelector("#emptyDetailTemplate"),
  };

  let disposed = false;
  let resizeObserver = null;
  let mapRenderToken = 0;
  let placeSearch = { cardId: null, loading: false, error: "", results: [] };
  const saved = await bridge.loadState();
  let state = normalizeState(saved || createDefaultState());
  syncResponsiveLayout();
  resizeObserver = new ResizeObserver(syncResponsiveLayout);
  resizeObserver.observe(layoutElement);
  bindEvents();
  render();

  return () => {
    if (disposed) return;
    disposed = true;
    resizeObserver?.disconnect();
    resizeObserver = null;
    root.classList.remove("is-compact-layout", "is-narrow-layout");
  };

function syncResponsiveLayout() {
  if (disposed) return;
  const leafWidth = layoutElement?.getBoundingClientRect().width || root.clientWidth;
  root.classList.toggle("is-compact-layout", leafWidth <= 900);
  root.classList.toggle("is-narrow-layout", leafWidth <= 620);
}

function createDefaultState() {
  return {
    cards: [],
    events: [],
    selectedCardId: null,
    selectedEventId: null,
    view: "week",
    inboxPage: "outing",
    cursorDate: toDateInputValue(new Date()),
    filters: {
      type: "all",
      tag: "all",
      search: "",
    },
    map: { ...defaultMapSettings },
  };
}

function normalizeState(nextState) {
  return {
    cards: Array.isArray(nextState.cards) ? nextState.cards.map((card) => ({
      ...card,
      merchantName: typeof card?.merchantName === "string" ? card.merchantName : "",
    })) : [],
    events: Array.isArray(nextState.events) ? nextState.events : [],
    selectedCardId: nextState.selectedCardId ?? null,
    selectedEventId: nextState.selectedEventId ?? null,
    view: ["day", "week", "month", "map"].includes(nextState.view) ? nextState.view : "week",
    inboxPage: ["outing", "food", "trash"].includes(nextState.inboxPage) ? nextState.inboxPage : "outing",
    cursorDate: nextState.cursorDate || toDateInputValue(new Date()),
    filters: {
      type: nextState.filters?.type || "all",
      tag: nextState.filters?.tag || "all",
      search: nextState.filters?.search || "",
    },
    map: {
      ...defaultMapSettings,
      ...(nextState.map || {}),
      centerLatitude: finiteNumber(nextState.map?.centerLatitude, defaultMapSettings.centerLatitude),
      centerLongitude: finiteNumber(nextState.map?.centerLongitude, defaultMapSettings.centerLongitude),
      zoom: clamp(Math.round(finiteNumber(nextState.map?.zoom, defaultMapSettings.zoom)), 3, 18),
      showUsed: Boolean(nextState.map?.showUsed),
    },
  };
}

function saveState() {
  if (disposed) return;
  persistState(state);
}

function render() {
  syncControls();
  renderFilters();
  renderUnscheduledCards();
  renderCalendar();
  renderDetailPanel();
  updateSummary();
}

function syncControls() {
  el.weekViewButton.classList.toggle("is-active", state.view === "week");
  el.dayViewButton.classList.toggle("is-active", state.view === "day");
  el.monthViewButton.classList.toggle("is-active", state.view === "month");
  el.mapViewButton.classList.toggle("is-active", state.view === "map");
  el.prevRange.disabled = state.view === "map";
  el.todayButton.disabled = state.view === "map";
  el.nextRange.disabled = state.view === "map";
  el.inboxPageButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.inboxPage === state.inboxPage);
  });
  el.typeFilter.value = state.filters.type;
  el.tagFilter.value = state.filters.tag;
  el.searchInput.value = state.filters.search;
}

function replaceOptions(select, options) {
  const nodes = options.map(([value, label]) => {
    const option = root.ownerDocument.createElement("option");
    option.value = value;
    option.textContent = label;
    return option;
  });
  select.replaceChildren(...nodes);
}

// Rendered values are escaped before reaching this parser; using a detached
// document also prevents scripts from executing while the fragment is built.
function replaceWithHtml(container, html) {
  const Parser = root.ownerDocument.defaultView?.DOMParser ?? DOMParser;
  const parsed = new Parser().parseFromString(html, "text/html");
  const nodes = Array.from(parsed.body.childNodes, (node) =>
    root.ownerDocument.importNode(node, true),
  );
  container.replaceChildren(...nodes);
}

function renderFilters() {
  const currentType = state.filters.type;
  const currentTag = state.filters.tag;
  replaceOptions(el.typeFilter, [
    ["all", "全部类型"],
    ...Object.entries(typeMeta).map(([value, meta]) => [value, meta.label]),
  ]);
  el.typeFilter.value = currentType;

  const tags = Array.from(new Set(state.cards.flatMap((card) => card.tags || []))).sort();
  replaceOptions(el.tagFilter, [
    ["all", "全部标签"],
    ...tags.map((tag) => [tag, tag]),
  ]);
  el.tagFilter.value = tags.includes(currentTag) ? currentTag : "all";
  if (el.tagFilter.value !== state.filters.tag) {
    state.filters.tag = el.tagFilter.value;
  }
}

function renderUnscheduledCards() {
  const scheduledIds = new Set(state.events.map((event) => event.cardId));
  const baseCards = getFilteredCards().filter(
    (card) => {
      if (state.inboxPage === "trash") return card.status === "discarded";
      return (isRecurringCard(card) || !scheduledIds.has(card.id)) && !["used", "discarded"].includes(card.status);
    },
  );
  const cards = baseCards.filter(cardMatchesInboxPage);

  el.inboxTitle.textContent = state.inboxPage === "trash" ? "回收站" : "未安排卡片";
  el.inboxCount.textContent = `${cards.length}/${baseCards.length}`;

  if (!cards.length) {
    const emptyRail = root.ownerDocument.createElement("div");
    emptyRail.className = "empty-rail";
    emptyRail.textContent = state.inboxPage === "trash" ? "回收站是空的" : "这一页没有未安排卡片";
    el.unscheduledCards.replaceChildren(emptyRail);
    return;
  }

  replaceWithHtml(el.unscheduledCards, cards.map((card) => renderMiniCard(card)).join(""));

  el.unscheduledCards.querySelectorAll(".mini-card").forEach((node) => {
    node.addEventListener("dragstart", handleCardDragStart);
    node.addEventListener("click", () => selectCard(node.dataset.cardId));
    node.addEventListener("keydown", (event) => {
      if (!["Enter", " "].includes(event.key)) return;
      event.preventDefault();
      selectCard(node.dataset.cardId);
    });
  });
}

function cardMatchesInboxPage(card) {
  if (state.inboxPage === "trash") return true;
  return (inboxPageTypes[state.inboxPage] || inboxPageTypes.outing).includes(card.type);
}

function renderMiniCard(card) {
  const issues = getCardPassiveIssues(card);
  const tagHtml = (card.tags || []).slice(0, 4).map((tag) => `<span class="tag-pill">${escapeHtml(tag)}</span>`).join("");
  const locationHtml = renderLocationBadge(card);
  const repeatHtml = getRepeatLabel(card);
  const primaryIssue = issues[0];
  const availabilityHtml = isAlwaysUsableCard(card)
    ? `<span>全天可用</span>`
    : `<span>${escapeHtml(card.usableStart || "00:00")}-${escapeHtml(card.usableEnd || "24:00")}</span>`;

  return `
    <article class="mini-card ${card.id === state.selectedCardId ? "is-selected" : ""}"
      data-card-id="${escapeAttribute(card.id)}"
      data-type="${escapeAttribute(card.type)}"
      data-status="${escapeAttribute(card.status || "unscheduled")}"
      role="button"
      tabindex="0"
      aria-label="${escapeAttribute(`${typeMeta[card.type]?.label || "卡片"}：${card.title || "未命名卡片"}`)}"
      draggable="${card.status === "discarded" ? "false" : "true"}">
      <div class="card-title-row">
        <div class="card-title">${escapeHtml(card.title || "未命名卡片")}</div>
        <span class="type-pill">${escapeHtml(typeMeta[card.type]?.label || "卡片")}</span>
      </div>
      ${locationHtml}
      <div class="meta-line">
        <span>${escapeHtml(card.source || "无来源")}</span>
        ${isRecurringCard(card) ? `<span>${escapeHtml(repeatHtml || "不固定")}</span>` : `<span>${formatDateRange(card.validFrom, card.validTo)}</span>`}
        ${availabilityHtml}
      </div>
      <div class="meta-line">
        ${isRecurringCard(card) ? `<span>活动模板</span>` : `<span>想用 ${Number(card.desire || 1)}/5</span>`}
        ${card.status === "discarded" ? `<span class="status-pill discarded">回收站</span>` : ""}
        ${primaryIssue ? `<span class="status-pill ${escapeAttribute(primaryIssue.severity)}">${escapeHtml(primaryIssue.message)}</span>` : ""}
      </div>
      <div class="tag-row">${tagHtml}</div>
    </article>
  `;
}

function renderCalendar() {
  if (state.view === "map") {
    renderMap();
    return;
  }

  mapRenderToken += 1;
  el.calendarGrid.classList.remove("is-map-view");
  if (state.view === "month") {
    renderMonthCalendar();
    return;
  }

  const days = getVisibleDays();
  el.calendarGrid.style.setProperty("--days", String(days.length));
  el.calendarGrid.classList.remove("is-month-view");
  el.calendarGrid.classList.toggle("is-day-view", state.view === "day");
  el.calendarTitle.textContent = state.view === "week" ? "周日历" : "日日历";
  el.rangeLabel.textContent = getRangeLabel(days);

  const headerHtml = [
    `<div class="calendar-corner">00-24</div>`,
    ...days.map((day) => `
      <div class="day-header ${isSameDate(day, new Date()) ? "is-today" : ""}">
        <span class="day-name">${dayNames[day.getDay()]}</span>
        <span class="day-date">${formatMonthDay(day)}</span>
      </div>
    `),
  ].join("");

  const bodyParts = [];
  for (let hour = 0; hour < 24; hour += 1) {
    bodyParts.push(`<div class="hour-label">${String(hour).padStart(2, "0")}:00</div>`);
    for (const day of days) {
      const date = toDateInputValue(day);
      bodyParts.push(`
        <div class="calendar-cell" data-date="${date}" data-hour="${hour}">
          ${renderEventsForCell(date, hour)}
        </div>
      `);
    }
  }

  replaceWithHtml(el.calendarGrid, headerHtml + bodyParts.join(""));

  el.calendarGrid.querySelectorAll(".calendar-cell").forEach((cell) => {
    cell.addEventListener("dragover", handleCalendarDragOver);
    cell.addEventListener("dragleave", handleCalendarDragLeave);
    cell.addEventListener("drop", handleCalendarDrop);
    cell.addEventListener("click", handleCalendarCellClick);
  });

  el.calendarGrid.querySelectorAll(".event-chip").forEach((node) => {
    node.addEventListener("dragstart", handleEventDragStart);
    node.addEventListener("click", (event) => {
      event.stopPropagation();
      selectEvent(node.dataset.eventId);
    });
  });
}

function renderMap() {
  const vouchers = getFilteredCards().filter((card) =>
    card.type === "voucher" &&
    card.status !== "discarded" &&
    (state.map.showUsed || card.status !== "used")
  );
  const locatedCards = vouchers.filter(hasCoordinates);
  const reviewCards = vouchers.filter(needsLocationReview);
  const approximateCount = vouchers.filter(hasApproximateCoordinates).length;
  const selectedCard = state.selectedCardId ? getCard(state.selectedCardId) : null;

  el.calendarGrid.style.removeProperty("--days");
  el.calendarGrid.classList.remove("is-month-view", "is-day-view");
  el.calendarGrid.classList.add("is-map-view");
  el.calendarTitle.textContent = "券地图";
  el.rangeLabel.textContent = `${locatedCards.length}/${vouchers.length} 张券已定位${approximateCount ? ` · ${approximateCount} 张待校正` : ""}`;

  const pendingHtml = reviewCards.length
    ? reviewCards.map((card) => `
        <button class="map-pending-card ${card.id === state.selectedCardId ? "is-selected" : ""}" type="button" data-map-card-id="${escapeAttribute(card.id)}">
          <span>${escapeHtml(card.title || "未命名团购券")}</span>
          <small>${hasApproximateCoordinates(card) ? `商圈候选 · ${escapeHtml(card.location || "未填写地点")}` : escapeHtml(card.location || "尚未填写地点")}</small>
        </button>
      `).join("")
    : `<div class="map-empty">当前筛选中的券都已经精确定位。</div>`;

  replaceWithHtml(el.calendarGrid, `
    <div class="map-workspace">
      <div class="map-tools">
        <label class="map-area-field">
          <span>搜索区域</span>
          <input id="mapAreaHint" value="${escapeAttribute(state.map.areaHint)}" placeholder="例如：深圳市龙华区" />
        </label>
        <button class="icon-button map-zoom-button" id="mapZoomOut" type="button" aria-label="缩小地图" title="缩小地图">−</button>
        <span class="map-zoom-label">${state.map.zoom} 级</span>
        <button class="icon-button map-zoom-button" id="mapZoomIn" type="button" aria-label="放大地图" title="放大地图">＋</button>
        <button class="text-button" id="centerSelectedPlace" type="button" ${selectedCard && hasCoordinates(selectedCard) ? "" : "disabled"}>以选中商家为中心</button>
        <label class="map-used-toggle"><input id="mapShowUsed" type="checkbox" ${state.map.showUsed ? "checked" : ""} />显示已使用</label>
        <details class="map-service-settings">
          <summary>地图服务</summary>
          <label><span>瓦片地址</span><input id="mapTileUrl" value="${escapeAttribute(state.map.tileUrl)}" /></label>
          <label><span>地点搜索</span><input id="mapGeocoderUrl" value="${escapeAttribute(state.map.geocoderUrl)}" /></label>
        </details>
      </div>
      <div class="fixed-map-canvas" id="fixedMapCanvas" tabindex="0" aria-label="固定券地图；选中未定位的券后可点击地图设置位置">
        <div class="map-tile-layer" aria-hidden="true"></div>
        <div class="map-marker-layer"></div>
        ${selectedCard?.type === "voucher" && needsLocationReview(selectedCard) ? `<div class="map-click-hint">点击地图，为“${escapeHtml(selectedCard.title || "未命名团购券")}”${hasCoordinates(selectedCard) ? "校正" : "设置"}位置</div>` : ""}
        <a class="map-attribution" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a>
      </div>
      <section class="map-pending-panel" aria-labelledby="mapPendingTitle">
        <div class="map-pending-heading">
          <h3 id="mapPendingTitle">待定位 / 校正</h3>
          <span>${reviewCards.length} 张</span>
        </div>
        <div class="map-pending-list">${pendingHtml}</div>
      </section>
    </div>
  `);

  const canvas = el.calendarGrid.querySelector("#fixedMapCanvas");
  const token = ++mapRenderToken;
  root.ownerDocument.defaultView?.requestAnimationFrame(() => {
    if (disposed || token !== mapRenderToken || !canvas?.isConnected) return;
    paintFixedMap(canvas, locatedCards);
  });

  el.calendarGrid.querySelector("#mapZoomOut").addEventListener("click", () => {
    state.map.zoom = clamp(state.map.zoom - 1, 3, 18);
    commit();
  });
  el.calendarGrid.querySelector("#mapZoomIn").addEventListener("click", () => {
    state.map.zoom = clamp(state.map.zoom + 1, 3, 18);
    commit();
  });
  el.calendarGrid.querySelector("#mapShowUsed").addEventListener("change", (event) => {
    state.map.showUsed = event.currentTarget.checked;
    commit();
  });
  el.calendarGrid.querySelector("#mapAreaHint").addEventListener("change", (event) => {
    state.map.areaHint = event.currentTarget.value.trim();
    commit();
  });
  el.calendarGrid.querySelector("#mapTileUrl").addEventListener("change", (event) => {
    state.map.tileUrl = event.currentTarget.value.trim() || defaultMapSettings.tileUrl;
    commit();
  });
  el.calendarGrid.querySelector("#mapGeocoderUrl").addEventListener("change", (event) => {
    state.map.geocoderUrl = event.currentTarget.value.trim() || defaultMapSettings.geocoderUrl;
    commit();
  });
  el.calendarGrid.querySelector("#centerSelectedPlace").addEventListener("click", () => {
    const card = state.selectedCardId ? getCard(state.selectedCardId) : null;
    if (!card || !hasCoordinates(card)) return;
    const point = getMapPoints(card)[0];
    if (!point) return;
    state.map.centerLatitude = point.latitude;
    state.map.centerLongitude = point.longitude;
    commit();
  });
  el.calendarGrid.querySelectorAll("[data-map-card-id]").forEach((button) => {
    button.addEventListener("click", () => selectCard(button.dataset.mapCardId));
  });

  canvas.addEventListener("click", (event) => {
    if (event.target.closest(".map-marker, .map-attribution")) return;
    const card = state.selectedCardId ? getCard(state.selectedCardId) : null;
    if (!card || card.type !== "voucher" || card.status === "discarded") {
      window.alert("请先选择一张团购券，再点击地图设置商家位置。");
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const point = mapCanvasPointToCoordinates(
      event.clientX - rect.left,
      event.clientY - rect.top,
      rect.width,
      rect.height,
      state.map,
    );
    updateCard(card.id, { latitude: roundCoordinate(point.latitude), longitude: roundCoordinate(point.longitude), geoPrecision: "manual", geoLabel: "地图手动标注" }, false);
    commit();
  });
}

function paintFixedMap(canvas, cards) {
  const tileLayer = canvas.querySelector(".map-tile-layer");
  const markerLayer = canvas.querySelector(".map-marker-layer");
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const zoom = state.map.zoom;
  const worldSize = 256 * (2 ** zoom);
  const center = projectCoordinates(state.map.centerLatitude, state.map.centerLongitude, zoom);
  const left = center.x - width / 2;
  const top = center.y - height / 2;
  const firstTileX = Math.floor(left / 256);
  const lastTileX = Math.floor((left + width) / 256);
  const firstTileY = Math.max(0, Math.floor(top / 256));
  const lastTileY = Math.min((2 ** zoom) - 1, Math.floor((top + height) / 256));
  const tileCount = 2 ** zoom;
  const tileNodes = [];

  for (let tileY = firstTileY; tileY <= lastTileY; tileY += 1) {
    for (let tileX = firstTileX; tileX <= lastTileX; tileX += 1) {
      const wrappedX = ((tileX % tileCount) + tileCount) % tileCount;
      const image = root.ownerDocument.createElement("img");
      image.alt = "";
      image.draggable = false;
      image.decoding = "async";
      image.src = buildTileUrl(state.map.tileUrl, zoom, wrappedX, tileY);
      image.style.left = `${Math.round(tileX * 256 - left)}px`;
      image.style.top = `${Math.round(tileY * 256 - top)}px`;
      tileNodes.push(image);
    }
  }
  tileLayer.replaceChildren(...tileNodes);

  const groups = new Map();
  cards.flatMap((card) => getMapPoints(card).map((point) => ({ card, point }))).forEach((entry) => {
    const coordinateKey = `${roundCoordinate(entry.point.latitude, 5)},${roundCoordinate(entry.point.longitude, 5)}`;
    const merchantKey = normalizeMerchantName(getMerchantName(entry.card));
    const key = `${coordinateKey}|${merchantKey}`;
    if (!groups.has(key)) groups.set(key, { coordinateKey, entries: [] });
    groups.get(key).entries.push(entry);
  });

  const projectedGroups = [...groups.values()].map((group) => {
    const point = projectCoordinates(group.entries[0].point.latitude, group.entries[0].point.longitude, zoom);
    let anchorX = point.x - left;
    if (anchorX < -worldSize / 2) anchorX += worldSize;
    if (anchorX > width + worldSize / 2) anchorX -= worldSize;
    return { ...group, anchorX, anchorY: point.y - top };
  }).filter((group) => group.anchorX >= -140 && group.anchorX <= width + 140 && group.anchorY >= -140 && group.anchorY <= height + 140);

  const homeLayoutPoint = getHomeLayoutPoint(width, height, zoom, left, top, worldSize);
  const placedRects = homeLayoutPoint ? [{ left: homeLayoutPoint.x - 46, right: homeLayoutPoint.x + 46, top: homeLayoutPoint.y - 94, bottom: homeLayoutPoint.y + 12 }] : [];
  const markerNodes = [];
  projectedGroups.forEach((projectedGroup) => {
    const group = projectedGroup.entries;
    const merchantName = getMerchantName(group[0].card);
    const cardIds = [...new Set(group.map(({ card }) => card.id))];
    const layout = chooseMapMarkerLayout(projectedGroup.anchorX, projectedGroup.anchorY, merchantName, cardIds.length, placedRects, width, height);
    placedRects.push(layout.rect);

    if (layout.distance > 3) {
      const leader = root.ownerDocument.createElement("span");
      leader.className = "map-marker-leader";
      leader.style.left = `${projectedGroup.anchorX}px`;
      leader.style.top = `${projectedGroup.anchorY}px`;
      leader.style.width = `${layout.distance}px`;
      leader.style.rotate = `${layout.angle}rad`;
      markerNodes.push(leader);
    }

    const marker = root.ownerDocument.createElement("button");
    marker.type = "button";
    marker.className = `map-marker is-caption-${layout.captionPlacement}${group.some(({ card }) => card.id === state.selectedCardId) ? " is-selected" : ""}${group.every(({ point: mapPoint }) => mapPoint.geoPrecision === "area") ? " is-approximate" : ""}`;
    marker.style.left = `${layout.x}px`;
    marker.style.top = `${layout.y}px`;
    marker.dataset.cardId = group.some(({ card }) => card.id === state.selectedCardId) ? state.selectedCardId : cardIds[0];
    marker.title = `${merchantName}\n${group.map(({ card, point: mapPoint }) => `${card.title || "未命名团购券"}${mapPoint.label ? ` · ${mapPoint.label}` : card.location ? ` · ${card.location}` : ""}${mapPoint.geoPrecision === "area" ? "（商圈候选）" : ""}`).join("\n")}`;
    const caption = root.ownerDocument.createElement("span");
    caption.className = "map-marker-caption";
    const captionName = root.ownerDocument.createElement("span");
    captionName.className = "map-marker-caption-name";
    captionName.textContent = merchantName;
    caption.append(captionName);
    if (cardIds.length > 1) {
      const count = root.ownerDocument.createElement("sup");
      count.className = "map-marker-count";
      count.textContent = String(cardIds.length);
      caption.append(count);
    }
    const pin = root.ownerDocument.createElement("span");
    pin.className = "map-marker-pin";
    const symbol = root.ownerDocument.createElement("span");
    symbol.className = "map-marker-symbol";
    symbol.textContent = getFoodMarkerLabel(group[0].card);
    pin.append(symbol);
    marker.append(caption, pin);
    marker.addEventListener("click", (event) => {
      event.stopPropagation();
      const selectedIndex = cardIds.indexOf(state.selectedCardId);
      selectCard(selectedIndex >= 0 ? cardIds[(selectedIndex + 1) % cardIds.length] : cardIds[0]);
    });
    markerNodes.push(marker);
  });

  const homeMarker = state.map.homeMarker;
  if (homeMarker?.visible !== false && isCoordinatePair(homeMarker?.latitude, homeMarker?.longitude)) {
    const homePoint = projectCoordinates(Number(homeMarker.latitude), Number(homeMarker.longitude), zoom);
    let homeX = homePoint.x - left;
    if (homeX < -worldSize / 2) homeX += worldSize;
    if (homeX > width + worldSize / 2) homeX -= worldSize;
    const homeY = homePoint.y - top;
    if (homeX >= -50 && homeX <= width + 50 && homeY >= -50 && homeY <= height + 50) {
      const home = root.ownerDocument.createElement("div");
      home.className = "map-home-marker";
      home.style.left = `${homeX}px`;
      home.style.top = `${homeY}px`;
      home.title = homeMarker.label || "家";
      const icon = root.ownerDocument.createElement("span");
      icon.className = "map-home-marker-icon";
      icon.textContent = "⌂";
      const label = root.ownerDocument.createElement("span");
      label.className = "map-home-marker-label";
      label.textContent = homeMarker.label || "家";
      home.append(label, icon);
      markerNodes.push(home);
    }
  }
  markerLayer.replaceChildren(...markerNodes);
}

function renderEventsForCell(date, hour) {
  const events = state.events
    .filter((event) => event.date === date && Math.floor(toMinutes(event.start) / 60) === hour)
    .sort((a, b) => toMinutes(a.start) - toMinutes(b.start));

  return events
    .map((event, index) => {
      const card = getCard(event.cardId);
      if (!card || !cardMatchesFilters(card)) return "";
      const issues = [...getEventIssues(event), ...getCardPassiveIssues(card)];
      const issueSeverity = getIssueSeverity(issues);
      const startMinutes = toMinutes(event.start);
      const endMinutes = toMinutes(event.end);
      const offset = ((startMinutes % 60) / 60) * 100;
      const duration = Math.max(28, ((endMinutes - startMinutes) / 60) * 58);
      const stackOffset = index * 26;
      const top = `calc(${offset}% + ${stackOffset}px)`;

      return `
        <article class="event-chip ${issueSeverity ? `is-${issueSeverity}` : ""} ${event.status === "used" || card.status === "used" ? "is-used" : ""} ${event.id === state.selectedEventId ? "is-selected" : ""}"
          data-event-id="${escapeAttribute(event.id)}"
          data-card-id="${escapeAttribute(card.id)}"
          data-type="${escapeAttribute(card.type)}"
          data-status="${escapeAttribute(event.status || "")}"
          draggable="${event.status === "used" ? "false" : "true"}"
          title="${escapeAttribute(formatIssues(issues) || card.title)}"
          style="top:${top}; height:${duration}px;">
          ${renderLocationBadge(card)}
          <div class="event-title">${escapeHtml(card.title || "未命名卡片")}</div>
          <div class="event-time">${escapeHtml(event.start)}-${escapeHtml(event.end)}</div>
        </article>
      `;
    })
    .join("");
}

function renderMonthCalendar() {
  const cursor = parseDate(state.cursorDate);
  const days = getVisibleMonthDays(cursor);
  const month = cursor.getMonth();

  el.calendarGrid.style.removeProperty("--days");
  el.calendarTitle.textContent = "月日历";
  el.rangeLabel.textContent = `${cursor.getFullYear()} 年 ${cursor.getMonth() + 1} 月`;

  const headerHtml = weekHeaderNames
    .map((name) => `<div class="month-weekday">${escapeHtml(name)}</div>`)
    .join("");

  const bodyHtml = days
    .map((day) => {
      const date = toDateInputValue(day);
      const isOutside = day.getMonth() !== month;
      const events = state.events
        .filter((event) => event.date === date)
        .sort((a, b) => toMinutes(a.start) - toMinutes(b.start));

      return `
        <div class="month-cell ${isOutside ? "is-outside-month" : ""} ${isSameDate(day, new Date()) ? "is-today" : ""}"
          data-date="${date}">
          <div class="month-date-row">
            <span class="month-date">${day.getDate()}</span>
            <span class="month-count">${events.length ? `${events.length} 项` : ""}</span>
          </div>
          <div class="month-events">
            ${renderMonthEvents(events)}
          </div>
        </div>
      `;
    })
    .join("");

  el.calendarGrid.classList.add("is-month-view");
  el.calendarGrid.classList.remove("is-day-view");
  replaceWithHtml(el.calendarGrid, headerHtml + bodyHtml);

  el.calendarGrid.querySelectorAll(".month-cell").forEach((cell) => {
    cell.addEventListener("dragover", handleCalendarDragOver);
    cell.addEventListener("dragleave", handleCalendarDragLeave);
    cell.addEventListener("drop", handleMonthDrop);
    cell.addEventListener("click", handleMonthCellClick);
  });

  el.calendarGrid.querySelectorAll(".month-event").forEach((node) => {
    node.addEventListener("dragstart", handleEventDragStart);
    node.addEventListener("click", (event) => {
      event.stopPropagation();
      selectEvent(node.dataset.eventId);
    });
  });
}

function renderMonthEvents(events) {
  return events
    .map((event) => {
      const card = getCard(event.cardId);
      if (!card || !cardMatchesFilters(card)) return "";
      const issues = [...getEventIssues(event), ...getCardPassiveIssues(card)];
      const issueSeverity = getIssueSeverity(issues);
      return `
        <article class="month-event ${issueSeverity ? `is-${issueSeverity}` : ""} ${event.status === "used" || card.status === "used" ? "is-used" : ""} ${event.id === state.selectedEventId ? "is-selected" : ""}"
          data-event-id="${escapeAttribute(event.id)}"
          data-card-id="${escapeAttribute(card.id)}"
          data-type="${escapeAttribute(card.type)}"
          data-status="${escapeAttribute(event.status || "")}"
          draggable="${event.status === "used" ? "false" : "true"}"
          title="${escapeAttribute(formatIssues(issues) || card.title)}">
          <span class="month-event-time">${escapeHtml(event.start)}</span>
          <span class="month-event-title">${escapeHtml(getCardDisplayTitle(card))}</span>
        </article>
      `;
    })
    .join("");
}

function renderDetailPanel() {
  const card = state.selectedCardId ? getCard(state.selectedCardId) : null;
  if (!card) {
    el.selectedState.textContent = "未选择";
    el.detailBody.replaceChildren(el.emptyDetailTemplate.content.cloneNode(true));
    return;
  }

  const event = state.selectedEventId ? getEvent(state.selectedEventId) : isRecurringCard(card) ? null : getEventByCardId(card.id);
  const eventIssues = event ? getEventIssues(event) : [];
  const passiveIssues = getCardPassiveIssues(card);
  const issues = [...eventIssues, ...passiveIssues];

  el.selectedState.textContent = statusMeta[card.status] || "卡片";
  replaceWithHtml(el.detailBody, `
    <form class="detail-form" id="detailForm">
      <div class="field-grid">
        <div class="field full">
          <label for="fieldTitle">名称</label>
          <input id="fieldTitle" name="title" value="${escapeAttribute(card.title || "")}" />
        </div>
        ${card.type === "voucher" ? `
          <div class="field full">
            <label for="fieldMerchantName">商家名称</label>
            <input id="fieldMerchantName" name="merchantName" value="${escapeAttribute(card.merchantName || "")}" placeholder="例如：肯德基；同店多张券请填写相同名称" />
          </div>
        ` : ""}
        <div class="field">
          <label for="fieldType">类型</label>
          <select id="fieldType" name="type">
            ${Object.entries(typeMeta)
              .map(([value, meta]) => `<option value="${value}" ${card.type === value ? "selected" : ""}>${escapeHtml(meta.label)}</option>`)
              .join("")}
          </select>
        </div>
        <div class="field">
          <label for="fieldSource">来源</label>
          <input id="fieldSource" name="source" value="${escapeAttribute(card.source || "")}" />
        </div>
        ${["voucher", "weeklyActivity"].includes(card.type) ? `
          <div class="field">
            <label for="fieldLocation">地点</label>
            <input id="fieldLocation" name="location" value="${escapeAttribute(card.location || "")}" placeholder="门店 / 商圈 / 地址" />
          </div>
        ` : ""}
        ${card.type === "voucher" ? `
          <div class="field full map-location-field">
            <div class="map-location-heading">
              <span class="field-title">地图位置</span>
              <span class="field-hint">${hasCoordinates(card) ? hasApproximateCoordinates(card) ? `已有 ${getMapPoints(card).length} 个位置，含待校正的商圈候选` : `已定位 ${getMapPoints(card).length} 个位置` : "尚未定位"}</span>
            </div>
            <div class="coordinate-row">
              <label><span>纬度</span><input id="fieldLatitude" name="latitude" type="number" step="0.000001" value="${escapeAttribute(coordinateInputValue(card.latitude))}" placeholder="22.000000" /></label>
              <label><span>经度</span><input id="fieldLongitude" name="longitude" type="number" step="0.000001" value="${escapeAttribute(coordinateInputValue(card.longitude))}" placeholder="114.000000" /></label>
            </div>
            <div class="map-location-actions">
              <button class="text-button" id="searchCardLocationButton" type="button" ${placeSearch.loading && placeSearch.cardId === card.id ? "disabled" : ""}>${placeSearch.loading && placeSearch.cardId === card.id ? "正在搜索…" : "搜索这个商家"}</button>
              ${isCoordinatePair(card.latitude, card.longitude) ? `<button class="text-button" id="clearCardLocationButton" type="button">清除主位置</button>` : ""}
              <span class="field-hint">搜索只在点击按钮时联网；也可切到地图后点击底图。</span>
            </div>
            ${renderPlaceSearchResults(card)}
            ${renderAdditionalMapLocations(card)}
          </div>
        ` : ""}
        ${card.type === "weeklyActivity" ? `
          <div class="field">
            <label for="fieldRepeatWeekday">每周重复</label>
            <select id="fieldRepeatWeekday" name="repeatWeekday">
              <option value="" ${card.repeatWeekday === undefined || card.repeatWeekday === "" ? "selected" : ""}>不选择</option>
              ${dayNames.map((name, index) => `
                <option value="${index}" ${String(card.repeatWeekday) === String(index) ? "selected" : ""}>${escapeHtml(name)}</option>
              `).join("")}
            </select>
          </div>
        ` : ""}
        ${card.type !== "weeklyActivity" ? `
          <div class="field">
            <label for="fieldPrice">价格</label>
            <input id="fieldPrice" name="price" value="${escapeAttribute(card.price || "")}" />
          </div>
        ` : ""}
        ${card.type !== "weeklyActivity" ? `
          <div class="field">
            <label for="fieldValidFrom">开始日期</label>
            <input id="fieldValidFrom" name="validFrom" type="date" value="${escapeAttribute(card.validFrom || "")}" />
          </div>
          <div class="field">
            <label for="fieldValidTo">截止日期</label>
            <input id="fieldValidTo" name="validTo" type="date" value="${escapeAttribute(card.validTo || "")}" />
          </div>
        ` : ""}
        ${!isAlwaysUsableCard(card) ? `
          <div class="field">
            <label for="fieldUsableStart">可用开始</label>
            <input id="fieldUsableStart" name="usableStart" type="time" value="${escapeAttribute(card.usableStart || getDefaultUsableWindow(card.type).usableStart)}" />
          </div>
          <div class="field">
            <label for="fieldUsableEnd">可用结束</label>
            <input id="fieldUsableEnd" name="usableEnd" type="time" value="${escapeAttribute(card.usableEnd || getDefaultUsableWindow(card.type).usableEnd)}" />
          </div>
        ` : ""}
        ${card.type !== "weeklyActivity" ? `
          <div class="field full">
            <label id="fieldDesireLabel" for="fieldDesire">想使用程度：${Number(card.desire || 1)}/5</label>
            <input id="fieldDesire" name="desire" type="range" min="1" max="5" step="1" value="${Number(card.desire || 1)}" />
          </div>
        ` : ""}
        <div class="field full">
          <label for="fieldTags">标签</label>
          <input id="fieldTags" name="tags" value="${escapeAttribute((card.tags || []).join("，"))}" />
        </div>
        <div class="field full">
          <label for="fieldNotes">备注</label>
          <textarea id="fieldNotes" name="notes">${escapeHtml(card.notes || "")}</textarea>
        </div>
      </div>

      ${event ? renderEventEditor(event) : ""}

      ${issues.length ? `<div class="issue-list">${issues.map((issue) => `<span class="issue-pill ${escapeAttribute(issue.severity)}">${escapeHtml(issue.message)}</span>`).join("")}</div>` : ""}

      <div class="detail-actions">
        ${event ? `<button class="text-button" id="unscheduleButton" type="button">取消安排</button>` : ""}
        <button class="text-button" id="duplicateCardButton" type="button">复制</button>
        ${card.status !== "discarded" && (!isRecurringCard(card) || event) ? `<button class="text-button" id="markUsedButton" type="button">已使用</button>` : ""}
        ${card.status !== "discarded" ? `<button class="text-button" id="trashCardButton" type="button">移到回收站</button>` : ""}
        ${card.status === "discarded" || card.status === "used" || event?.status === "used" ? `<button class="text-button" id="restoreButton" type="button">恢复</button>` : ""}
        <button class="text-button danger-button" id="deleteCardButton" type="button">删除</button>
      </div>
    </form>
  `);

  bindDetailForm(card, event);
}

function renderEventEditor(event) {
  return `
    <div class="field-grid">
      <div class="field full">
        <div class="field-title">日历安排</div>
      </div>
      <div class="field">
        <label for="fieldEventDate">日期</label>
        <input id="fieldEventDate" name="eventDate" type="date" value="${escapeAttribute(event.date)}" />
      </div>
      <div class="range-row field full">
        <div class="field">
          <label for="fieldEventStart">开始时间</label>
          <input id="fieldEventStart" name="eventStart" type="time" value="${escapeAttribute(event.start)}" />
        </div>
        <div class="field">
          <label for="fieldEventEnd">结束时间</label>
          <input id="fieldEventEnd" name="eventEnd" type="time" value="${escapeAttribute(event.end)}" />
        </div>
      </div>
    </div>
  `;
}

function renderPlaceSearchResults(card) {
  if (placeSearch.cardId !== card.id) return "";
  if (placeSearch.error) {
    return `<div class="place-search-message is-error">${escapeHtml(placeSearch.error)}</div>`;
  }
  if (!placeSearch.results.length && !placeSearch.loading) {
    return `<div class="place-search-message">没有找到合适地点。可以补充门店或商圈后重试，也可以在地图上手动点选。</div>`;
  }
  if (!placeSearch.results.length) return "";
  return `
    <div class="place-search-results" aria-label="地点搜索结果">
      ${placeSearch.results.map((result, index) => `
        <button type="button" data-place-result="${index}">
          <span>${escapeHtml(result.displayName)}</span>
          <small>${result.latitude.toFixed(6)}, ${result.longitude.toFixed(6)}</small>
        </button>
      `).join("")}
    </div>
  `;
}

function renderAdditionalMapLocations(card) {
  const locations = Array.isArray(card.mapLocations) ? card.mapLocations : [];
  const rows = locations.length
    ? locations.map((location, index) => `
        <div class="additional-map-location" data-extra-location-index="${index}">
          <div class="additional-map-location-heading">
            <input data-extra-location-field="label" value="${escapeAttribute(location.label || "")}" placeholder="门店 / 商圈名称" aria-label="其他门店名称" />
            <button class="text-button" type="button" data-remove-map-location="${index}">移除</button>
          </div>
          <div class="coordinate-row">
            <label><span>纬度</span><input data-extra-location-field="latitude" type="number" step="0.000001" value="${escapeAttribute(coordinateInputValue(location.latitude))}" placeholder="22.000000" /></label>
            <label><span>经度</span><input data-extra-location-field="longitude" type="number" step="0.000001" value="${escapeAttribute(coordinateInputValue(location.longitude))}" placeholder="114.000000" /></label>
          </div>
          <span class="field-hint">${isCoordinatePair(location.latitude, location.longitude) ? location.geoPrecision === "area" ? "商圈候选位置" : "已定位" : "请补全经纬度"}</span>
        </div>
      `).join("")
    : `<span class="field-hint">如果一张券可在多家门店使用，可继续添加位置。</span>`;
  return `
    <div class="additional-map-locations">
      <div class="additional-map-locations-title">
        <span class="field-title">其他可用门店</span>
        <button class="text-button" id="addMapLocationButton" type="button">新增门店位置</button>
      </div>
      ${rows}
    </div>
  `;
}

function bindDetailForm(card, event) {
  const form = root.querySelector("#detailForm");
  form.addEventListener("input", (domEvent) => {
    const target = domEvent.target;
    if (!target.name) return;

    if (target.name.startsWith("event") && event) {
      updateEventFromInput(event.id, target.name, target.value);
      return;
    }

    updateCardFromInput(card.id, target.name, target.value);
  });

  root.querySelector("#deleteCardButton").addEventListener("click", () => {
    deleteCard(card.id);
  });

  root.querySelector("#duplicateCardButton").addEventListener("click", () => {
    duplicateCard(card.id);
  });

  root.querySelector("#searchCardLocationButton")?.addEventListener("click", () => {
    void searchCardLocation(card);
  });

  root.querySelector("#clearCardLocationButton")?.addEventListener("click", () => {
    updateCard(card.id, { latitude: null, longitude: null, geoLabel: "", geoPrecision: "" }, false);
    placeSearch = { cardId: null, loading: false, error: "", results: [] };
    commit();
  });

  root.querySelector("#addMapLocationButton")?.addEventListener("click", () => {
    const locations = Array.isArray(card.mapLocations) ? card.mapLocations.map((location) => ({ ...location })) : [];
    locations.push({ id: createId(), label: "", latitude: null, longitude: null, geoLabel: "", geoPrecision: "" });
    updateCard(card.id, { mapLocations: locations });
  });

  root.querySelectorAll("[data-extra-location-field]").forEach((input) => {
    input.addEventListener("change", () => {
      const row = input.closest("[data-extra-location-index]");
      const index = Number(row?.dataset.extraLocationIndex);
      if (!Number.isInteger(index)) return;
      const locations = Array.isArray(card.mapLocations) ? card.mapLocations.map((location) => ({ ...location })) : [];
      if (!locations[index]) return;
      const field = input.dataset.extraLocationField;
      if (["latitude", "longitude"].includes(field)) {
        locations[index][field] = input.value === "" ? null : Number(input.value);
        locations[index].geoPrecision = input.value === "" ? "" : "manual";
      } else {
        locations[index][field] = input.value.trim();
      }
      updateCard(card.id, { mapLocations: locations });
    });
  });

  root.querySelectorAll("[data-remove-map-location]").forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.removeMapLocation);
      const locations = Array.isArray(card.mapLocations) ? card.mapLocations.filter((_, locationIndex) => locationIndex !== index) : [];
      updateCard(card.id, { mapLocations: locations });
    });
  });

  root.querySelectorAll("[data-place-result]").forEach((button) => {
    button.addEventListener("click", () => {
      const result = placeSearch.results[Number(button.dataset.placeResult)];
      if (!result) return;
      updateCard(card.id, {
        latitude: roundCoordinate(result.latitude),
        longitude: roundCoordinate(result.longitude),
        geoLabel: result.displayName,
        geoPrecision: "search",
      }, false);
      state.map.centerLatitude = result.latitude;
      state.map.centerLongitude = result.longitude;
      placeSearch = { cardId: null, loading: false, error: "", results: [] };
      commit();
    });
  });

  root.querySelector("#markUsedButton")?.addEventListener("click", () => {
    if (event) {
      event.status = "used";
      if (!isRecurringCard(card)) {
        updateCard(card.id, { status: "used" }, false);
      }
    } else {
      updateCard(card.id, { status: "used" }, false);
    }
    state.selectedEventId = null;
    commit();
  });

  root.querySelector("#trashCardButton")?.addEventListener("click", () => {
    moveCardToTrash(card.id);
  });

  root.querySelector("#restoreButton")?.addEventListener("click", () => {
    if (event) {
      event.status = "";
    }
    updateCard(card.id, { status: isRecurringCard(card) ? "unscheduled" : getEventByCardId(card.id) ? "scheduled" : "unscheduled" });
    commit();
  });

  const unscheduleButton = root.querySelector("#unscheduleButton");
  if (unscheduleButton && event) {
    unscheduleButton.addEventListener("click", () => {
      state.events = state.events.filter((item) => item.id !== event.id);
      state.selectedEventId = null;
      updateCard(card.id, { status: "unscheduled" }, false);
      commit();
    });
  }
}

function updateCardFromInput(cardId, name, value) {
  const patch = {};
  if (name === "desire") {
    patch[name] = Number(value);
    updateDesireLabel(patch[name]);
  } else if (name === "repeatWeekday") {
    patch[name] = value === "" ? "" : Number(value);
  } else if (name === "tags") {
    patch[name] = splitTags(value);
  } else if (["latitude", "longitude"].includes(name)) {
    const parsed = Number(value);
    patch[name] = value.trim() === "" || !Number.isFinite(parsed) ? null : roundCoordinate(parsed);
    patch.geoPrecision = patch[name] === null ? "" : "manual";
  } else if (name === "type" && value === "weeklyActivity") {
    patch[name] = value;
    patch.repeatWeekday = getCard(cardId)?.repeatWeekday ?? "";
    Object.assign(patch, getDefaultUsableWindow(value));
    patch.status = "unscheduled";
    patch.price = "";
  } else if (name === "type") {
    patch[name] = value;
    Object.assign(patch, getDefaultUsableWindow(value));
    if (value !== "weeklyActivity") patch.repeatWeekday = "";
  } else {
    patch[name] = value;
  }
  updateCard(cardId, patch, false);
  saveState();
  if (name === "type") {
    render();
    return;
  }
  renderWithoutDetail();
}

async function searchCardLocation(card) {
  if (!bridge.searchPlace) {
    placeSearch = { cardId: card.id, loading: false, error: "当前版本不支持地点搜索。", results: [] };
    renderDetailPanel();
    return;
  }

  const location = String(card.location || "").trim();
  const usefulLocation = ["", "(?)", "?", "待确认地点"].includes(location) ? "" : location;
  const query = [state.map.areaHint, usefulLocation, card.merchantName || card.title].filter(Boolean).join(" ");
  if (!query) {
    placeSearch = { cardId: card.id, loading: false, error: "请先填写商家名称或地点。", results: [] };
    renderDetailPanel();
    return;
  }

  placeSearch = { cardId: card.id, loading: true, error: "", results: [] };
  renderDetailPanel();
  try {
    const results = await bridge.searchPlace(query, state.map.geocoderUrl);
    placeSearch = { cardId: card.id, loading: false, error: "", results };
  } catch (error) {
    console.error("券食日历地点搜索失败", error);
    placeSearch = {
      cardId: card.id,
      loading: false,
      error: "地点搜索失败。请检查网络或在地图服务中更换搜索地址。",
      results: [],
    };
  }
  if (state.selectedCardId === card.id) renderDetailPanel();
}

function updateDesireLabel(value) {
  const label = root.querySelector("#fieldDesireLabel");
  if (!label) return;
  label.textContent = `想使用程度：${Number(value || 1)}/5`;
}

function updateEventFromInput(eventId, name, value) {
  const event = getEvent(eventId);
  if (!event) return;

  if (name === "eventDate") event.date = value;
  if (name === "eventStart") event.start = value;
  if (name === "eventEnd") event.end = value;

  if (toMinutes(event.end) <= toMinutes(event.start)) {
    event.end = minutesToTime(Math.min(23 * 60 + 59, toMinutes(event.start) + 60));
  }

  saveState();
  renderWithoutDetail();
}

function updateCard(cardId, patch, shouldCommit = true) {
  const card = getCard(cardId);
  if (!card) return;
  Object.assign(card, patch, { updatedAt: nowIso() });
  if (shouldCommit) commit();
}

function deleteCard(cardId) {
  const confirmed = window.confirm("删除这张卡片和它的日历安排？");
  if (!confirmed) return;
  state.cards = state.cards.filter((card) => card.id !== cardId);
  state.events = state.events.filter((event) => event.cardId !== cardId);
  if (state.selectedCardId === cardId) {
    state.selectedCardId = null;
    state.selectedEventId = null;
  }
  commit();
}

function moveCardToTrash(cardId) {
  const card = getCard(cardId);
  if (!card) return;
  state.events = state.events.filter((event) => event.cardId !== cardId);
  state.selectedEventId = null;
  state.inboxPage = "trash";
  updateCard(cardId, { status: "discarded" }, false);
  commit();
}

function duplicateCard(cardId) {
  const sourceCard = getCard(cardId);
  if (!sourceCard) return;

  const duplicate = {
    ...sourceCard,
    id: createId(),
    title: `${sourceCard.title || "未命名卡片"} 副本`,
    tags: [...(sourceCard.tags || [])],
    status: "unscheduled",
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };

  const sourceIndex = state.cards.findIndex((card) => card.id === cardId);
  const insertIndex = sourceIndex >= 0 ? sourceIndex + 1 : 0;
  state.cards.splice(insertIndex, 0, duplicate);
  state.selectedCardId = duplicate.id;
  state.selectedEventId = null;
  commit();
}

function handleCardDragStart(event) {
  if (["used", "discarded"].includes(event.currentTarget.dataset.status)) {
    event.preventDefault();
    return;
  }
  event.dataTransfer.setData("text/plain", JSON.stringify({ kind: "card", id: event.currentTarget.dataset.cardId }));
  event.dataTransfer.effectAllowed = "move";
}

function handleEventDragStart(event) {
  if (event.currentTarget.dataset.status === "used") {
    event.preventDefault();
    return;
  }
  event.dataTransfer.setData("text/plain", JSON.stringify({ kind: "event", id: event.currentTarget.dataset.eventId }));
  event.dataTransfer.effectAllowed = "move";
}

function handleCalendarDragOver(event) {
  event.preventDefault();
  event.currentTarget.classList.add("is-drop-target");
}

function handleCalendarDragLeave(event) {
  event.currentTarget.classList.remove("is-drop-target");
}

function handleCalendarDrop(event) {
  event.preventDefault();
  const cell = event.currentTarget;
  cell.classList.remove("is-drop-target");

  let payload;
  try {
    payload = JSON.parse(event.dataTransfer.getData("text/plain"));
  } catch {
    return;
  }

  const date = cell.dataset.date;
  const hour = Number(cell.dataset.hour);
  const start = `${String(hour).padStart(2, "0")}:00`;
  const end = minutesToTime(Math.min(23 * 60 + 59, hour * 60 + 60));

  if (payload.kind === "card") {
    scheduleCard(payload.id, date, start, end);
  }

  if (payload.kind === "event") {
    moveEvent(payload.id, date, start, end);
  }
}

function handleMonthDrop(event) {
  event.preventDefault();
  const cell = event.currentTarget;
  cell.classList.remove("is-drop-target");

  let payload;
  try {
    payload = JSON.parse(event.dataTransfer.getData("text/plain"));
  } catch {
    return;
  }

  const date = cell.dataset.date;
  if (payload.kind === "card") {
    const card = getCard(payload.id);
    const start = getDefaultScheduleStart(card);
    scheduleCard(payload.id, date, start, getDefaultEndTime(start));
  }

  if (payload.kind === "event") {
    const existing = getEvent(payload.id);
    if (!existing) return;
    moveEvent(payload.id, date, existing.start, existing.end);
  }
}

function handleCalendarCellClick(event) {
  if (event.target.closest(".event-chip")) return;

  const cell = event.currentTarget;
  const date = cell.dataset.date;
  const hour = Number(cell.dataset.hour);
  const start = `${String(hour).padStart(2, "0")}:00`;
  const end = minutesToTime(Math.min(23 * 60 + 59, hour * 60 + 60));

  if (state.selectedEventId) {
    moveEvent(state.selectedEventId, date, start, end);
    return;
  }

  if (state.selectedCardId) {
    const card = getCard(state.selectedCardId);
    if (card && !["used", "discarded"].includes(card.status)) {
      scheduleCard(card.id, date, start, end);
    }
  }
}

function handleMonthCellClick(event) {
  if (event.target.closest(".month-event")) return;

  const date = event.currentTarget.dataset.date;
  if (state.selectedEventId) {
    const existing = getEvent(state.selectedEventId);
    if (existing) moveEvent(existing.id, date, existing.start, existing.end);
    return;
  }

  if (state.selectedCardId) {
    const card = getCard(state.selectedCardId);
    if (card && !["used", "discarded"].includes(card.status)) {
      const start = getDefaultScheduleStart(card);
      scheduleCard(card.id, date, start, getDefaultEndTime(start));
    }
  }
}

function scheduleCard(cardId, date, start, end) {
  const card = getCard(cardId);
  if (!card || ["used", "discarded"].includes(card.status)) return;

  const existing = isRecurringCard(card) ? null : getEventByCardId(cardId);
  if (existing) {
    Object.assign(existing, { date, start, end });
    state.selectedEventId = existing.id;
  } else {
    const event = {
      id: createId(),
      cardId,
      date,
      start,
      end,
      createdAt: nowIso(),
    };
    state.events.push(event);
    state.selectedEventId = isRecurringCard(card) ? null : event.id;
  }

  state.selectedCardId = cardId;
  card.status = isRecurringCard(card) ? "unscheduled" : "scheduled";
  card.updatedAt = nowIso();
  commit();
}

function moveEvent(eventId, date, start, end) {
  const event = getEvent(eventId);
  if (!event || event.status === "used") return;
  Object.assign(event, { date, start, end });
  state.selectedEventId = eventId;
  state.selectedCardId = event.cardId;
  commit();
}

function selectCard(cardId) {
  state.selectedCardId = cardId;
  const card = getCard(cardId);
  const selectedEvent = isRecurringCard(card) ? null : getEventByCardId(cardId);
  state.selectedEventId = selectedEvent?.id || null;
  commit(false);
}

function selectEvent(eventId) {
  const event = getEvent(eventId);
  if (!event) return;
  state.selectedEventId = eventId;
  state.selectedCardId = event.cardId;
  commit(false);
}

function addCard() {
  const today = new Date();
  const card = {
    id: createId(),
    type: "voucher",
    title: "新卡片",
    merchantName: "",
    source: getDefaultSource(),
    location: "",
    price: "",
    value: "",
    validFrom: toDateInputValue(today),
    validTo: toDateInputValue(addDays(today, 7)),
    usableStart: "09:00",
    usableEnd: "21:00",
    desire: 3,
    tags: [],
    notes: "",
    status: "unscheduled",
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  state.cards.unshift(card);
  state.selectedCardId = card.id;
  state.selectedEventId = null;
  commit();
}

function getDefaultSource() {
  const selectedCard = state.selectedCardId ? getCard(state.selectedCardId) : null;
  if (selectedCard?.source) return selectedCard.source;

  const recentCard = [...state.cards]
    .filter((card) => card.source)
    .sort((a, b) => Date.parse(b.updatedAt || b.createdAt || 0) - Date.parse(a.updatedAt || a.createdAt || 0))[0];
  return recentCard?.source || "";
}

function exportData() {
  const payload = {
    exportedAt: nowIso(),
    version: 0,
    cards: state.cards,
    events: state.events,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = root.ownerDocument.createElement("a");
  link.href = url;
  link.download = `coupon-order-manager-${toDateInputValue(new Date())}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

async function importData(file) {
  const text = await file.text();
  const payload = JSON.parse(text);
  const cards = Array.isArray(payload.cards) ? payload.cards : [];
  const events = Array.isArray(payload.events) ? payload.events : [];
  const importedCards = cards.map((card) => ({
    ...card,
    id: card.id || createId(),
    merchantName: typeof card.merchantName === "string" ? card.merchantName : "",
    tags: Array.isArray(card.tags) ? card.tags : splitTags(card.tags || ""),
    updatedAt: nowIso(),
  }));
  const validCardIds = new Set(importedCards.map((card) => card.id));
  const importedEvents = events
    .filter((event) => validCardIds.has(event.cardId))
    .map((event) => ({ ...event, id: event.id || createId() }));

  state.cards = importedCards;
  state.events = importedEvents;
  state.selectedCardId = state.cards[0]?.id || null;
  state.selectedEventId = state.selectedCardId ? getEventByCardId(state.selectedCardId)?.id || null : null;
  commit();
}

function commit(shouldSave = true) {
  if (shouldSave) saveState();
  render();
}

function renderWithoutDetail() {
  syncControls();
  renderFilters();
  renderUnscheduledCards();
  renderCalendar();
  updateSummary();
  const card = state.selectedCardId ? getCard(state.selectedCardId) : null;
  el.selectedState.textContent = card ? statusMeta[card.status] || "卡片" : "未选择";
}

function getFilteredCards() {
  return state.cards.filter(cardMatchesFilters);
}

function cardMatchesFilters(card) {
  const search = state.filters.search.trim().toLowerCase();
  const matchesType = state.filters.type === "all" || card.type === state.filters.type;
  const matchesTag = state.filters.tag === "all" || (card.tags || []).includes(state.filters.tag);
  const haystack = [card.title, card.merchantName, card.source, card.location, card.value, getRepeatLabel(card), card.notes, ...(card.tags || [])]
    .join(" ")
    .toLowerCase();
  return matchesType && matchesTag && (!search || haystack.includes(search));
}

function getCardDisplayTitle(card) {
  if (["voucher", "weeklyActivity"].includes(card.type) && card.location) {
    return `${card.location} · ${card.title || "未命名卡片"}`;
  }
  return card.title || "未命名卡片";
}

function renderLocationBadge(card) {
  if (!["voucher", "weeklyActivity"].includes(card.type) || !card.location) return "";
  return `<div class="location-badge">地点：${escapeHtml(card.location)}</div>`;
}

function getRepeatLabel(card) {
  if (!isRecurringCard(card)) return "";
  if (card.repeatWeekday === undefined || card.repeatWeekday === "") return "不固定";
  return `每${dayNames[Number(card.repeatWeekday)] || ""}`;
}

function isRecurringCard(card) {
  return card?.type === "weeklyActivity";
}

function isAlwaysUsableCard(card) {
  return ["weeklyActivity", "delivery"].includes(card?.type);
}

function getDefaultUsableWindow(type) {
  if (type === "voucher") return { usableStart: "09:00", usableEnd: "21:00" };
  if (["redPacket", "weeklyActivity", "delivery"].includes(type)) {
    return { usableStart: "00:00", usableEnd: "23:59" };
  }
  return { usableStart: "09:00", usableEnd: "21:00" };
}

function getDefaultScheduleStart(card) {
  if (!card) return "09:00";
  if (isAlwaysUsableCard(card)) return "09:00";
  return card.usableStart || getDefaultUsableWindow(card.type).usableStart;
}

function getVisibleDays() {
  const cursor = parseDate(state.cursorDate);
  if (state.view === "day") return [cursor];
  const start = startOfWeek(cursor);
  return Array.from({ length: 7 }, (_, index) => addDays(start, index));
}

function getVisibleMonthDays(date) {
  const firstOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);
  const start = startOfWeek(firstOfMonth);
  return Array.from({ length: 42 }, (_, index) => addDays(start, index));
}

function getRangeLabel(days) {
  if (days.length === 1) {
    return `${formatMonthDay(days[0])} 00:00-24:00`;
  }
  return `${formatMonthDay(days[0])} - ${formatMonthDay(days[days.length - 1])} 00:00-24:00`;
}

function getCard(cardId) {
  return state.cards.find((card) => card.id === cardId);
}

function getEvent(eventId) {
  return state.events.find((event) => event.id === eventId);
}

function getEventByCardId(cardId) {
  return state.events.find((event) => event.cardId === cardId);
}

function getCardPassiveIssues(card) {
  const issues = [];
  if (card.type === "weeklyActivity") return issues;
  const today = toDateInputValue(new Date());
  if (card.validTo && card.validTo < today && !["used", "discarded"].includes(card.status)) {
    issues.push(createIssue(card.type === "food" ? "已过保质期" : "已过期", "error"));
  }
  if (card.validTo && card.validTo >= today) {
    const daysLeft = dayDiff(parseDate(today), parseDate(card.validTo));
    if (daysLeft <= 2 && !["used", "discarded"].includes(card.status)) {
      issues.push(createIssue(daysLeft === 0 ? "今天截止" : `${daysLeft} 天后截止`, "warning"));
    }
  }
  return issues;
}

function getEventIssues(event) {
  const card = getCard(event.cardId);
  if (!card) return [createIssue("找不到卡片", "error")];
  if (isAlwaysUsableCard(card)) {
    return toMinutes(event.end) <= toMinutes(event.start) ? [createIssue("结束时间异常", "error")] : [];
  }

  const issues = [];
  const start = toMinutes(event.start);
  const end = toMinutes(event.end);
  const usableStart = toMinutes(card.usableStart || "00:00");
  const usableEnd = toMinutes(card.usableEnd || "23:59");

  if (event.date < card.validFrom) issues.push(createIssue("早于有效期", "error"));
  if (event.date > card.validTo) {
    issues.push(createIssue(card.type === "food" ? "晚于保质期" : "晚于有效期", "error"));
  }
  if (start < usableStart || end > usableEnd) issues.push(createIssue("不在可用时段", "error"));
  if (end <= start) issues.push(createIssue("结束时间异常", "error"));

  return issues;
}

function createIssue(message, severity) {
  return { message, severity };
}

function getIssueSeverity(issues) {
  if (issues.some((issue) => issue.severity === "error")) return "error";
  if (issues.some((issue) => issue.severity === "warning")) return "warning";
  return "";
}

function formatIssues(issues) {
  return issues.map((issue) => issue.message).join("；");
}

function updateSummary() {
  const today = toDateInputValue(new Date());
  const todayEvents = state.events.filter((event) => event.date === today).length;
  const urgentCards = state.cards.filter((card) => getCardPassiveIssues(card).length).length;
  el.todaySummary.textContent = `今天 ${todayEvents} 项安排，${urgentCards} 项临近截止`;
}

function bindEvents() {
  el.prevRange.addEventListener("click", () => {
    state.cursorDate = shiftCursorDate(-1);
    commit();
  });

  el.nextRange.addEventListener("click", () => {
    state.cursorDate = shiftCursorDate(1);
    commit();
  });

  el.todayButton.addEventListener("click", () => {
    state.cursorDate = toDateInputValue(new Date());
    commit();
  });

  el.weekViewButton.addEventListener("click", () => {
    state.view = "week";
    commit();
  });

  el.dayViewButton.addEventListener("click", () => {
    state.view = "day";
    commit();
  });

  el.monthViewButton.addEventListener("click", () => {
    state.view = "month";
    commit();
  });

  el.mapViewButton.addEventListener("click", () => {
    state.view = "map";
    commit();
  });

  el.addCardButton.addEventListener("click", addCard);
  el.exportButton.addEventListener("click", exportData);
  el.importButton.addEventListener("click", () => el.importFile.click());
  el.inboxPageButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.inboxPage = button.dataset.inboxPage;
      commit();
    });
  });
  el.importFile.addEventListener("change", async () => {
    const file = el.importFile.files?.[0];
    if (!file) return;
    try {
      await importData(file);
    } catch (error) {
      window.alert("导入失败：请确认 JSON 文件格式正确。");
      console.error(error);
    } finally {
      el.importFile.value = "";
    }
  });

  el.typeFilter.addEventListener("change", () => {
    state.filters.type = el.typeFilter.value;
    commit();
  });

  el.tagFilter.addEventListener("change", () => {
    state.filters.tag = el.tagFilter.value;
    commit();
  });

  el.searchInput.addEventListener("input", () => {
    state.filters.search = el.searchInput.value;
    commit();
  });
}

function shiftCursorDate(direction) {
  const cursor = parseDate(state.cursorDate);
  if (state.view === "month") {
    return toDateInputValue(new Date(cursor.getFullYear(), cursor.getMonth() + direction, 1));
  }
  return toDateInputValue(addDays(cursor, state.view === "week" ? direction * 7 : direction));
}

function splitTags(value) {
  if (Array.isArray(value)) return value;
  return String(value)
    .split(/[,，、\n]/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function createId() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function parseDate(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function toDateInputValue(date) {
  const local = new Date(date);
  local.setMinutes(local.getMinutes() - local.getTimezoneOffset());
  return local.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function startOfWeek(date) {
  const start = new Date(date);
  const day = start.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  start.setDate(start.getDate() + diff);
  return start;
}

function dayDiff(start, end) {
  const oneDay = 24 * 60 * 60 * 1000;
  return Math.round((startOfDay(end) - startOfDay(start)) / oneDay);
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function isSameDate(a, b) {
  return toDateInputValue(a) === toDateInputValue(b);
}

function formatMonthDay(date) {
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function formatDateRange(start, end) {
  if (!start && !end) return "无日期";
  if (start === end) return start;
  return `${start || "?"} 至 ${end || "?"}`;
}

function toMinutes(timeValue) {
  const [hours = 0, minutes = 0] = String(timeValue || "00:00").split(":").map(Number);
  return hours * 60 + minutes;
}

function minutesToTime(totalMinutes) {
  const safe = Math.max(0, Math.min(23 * 60 + 59, totalMinutes));
  const hours = Math.floor(safe / 60);
  const minutes = safe % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function getDefaultEndTime(start) {
  return minutesToTime(Math.min(23 * 60 + 59, toMinutes(start) + 60));
}

function isCoordinatePair(latitudeValue, longitudeValue) {
  if (latitudeValue === null || latitudeValue === undefined || latitudeValue === "" ||
      longitudeValue === null || longitudeValue === undefined || longitudeValue === "") return false;
  const latitude = Number(latitudeValue);
  const longitude = Number(longitudeValue);
  return Number.isFinite(latitude) && Number.isFinite(longitude) &&
    latitude >= -85.051129 && latitude <= 85.051129 &&
    longitude >= -180 && longitude <= 180;
}

function getMapPoints(card) {
  const points = [];
  if (isCoordinatePair(card?.latitude, card?.longitude)) {
    points.push({
      id: "primary",
      label: card.geoLabel || card.location || "主位置",
      latitude: Number(card.latitude),
      longitude: Number(card.longitude),
      geoPrecision: card.geoPrecision || "",
    });
  }
  if (Array.isArray(card?.mapLocations)) {
    card.mapLocations.forEach((location, index) => {
      if (!isCoordinatePair(location?.latitude, location?.longitude)) return;
      points.push({
        id: location.id || `extra-${index}`,
        label: location.label || location.geoLabel || `其他门店 ${index + 1}`,
        latitude: Number(location.latitude),
        longitude: Number(location.longitude),
        geoPrecision: location.geoPrecision || "",
      });
    });
  }
  return points;
}

function getMerchantName(card) {
  return String(card?.merchantName || card?.title || "未命名商家").trim() || "未命名商家";
}

function normalizeMerchantName(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/[\s·•・()（）【】\[\]_-]+/g, "");
}

function getHomeLayoutPoint(width, height, zoom, left, top, worldSize) {
  const homeMarker = state.map.homeMarker;
  if (homeMarker?.visible === false || !isCoordinatePair(homeMarker?.latitude, homeMarker?.longitude)) return null;
  const homePoint = projectCoordinates(Number(homeMarker.latitude), Number(homeMarker.longitude), zoom);
  let x = homePoint.x - left;
  if (x < -worldSize / 2) x += worldSize;
  if (x > width + worldSize / 2) x -= worldSize;
  const y = homePoint.y - top;
  return x >= -50 && x <= width + 50 && y >= -50 && y <= height + 50 ? { x, y } : null;
}

function chooseMapMarkerLayout(anchorX, anchorY, merchantName, count, occupiedRects, width, height) {
  const candidates = [
    { dx: 0, dy: 0, captionPlacement: "top" },
    { dx: 0, dy: -68, captionPlacement: "top" },
    { dx: 68, dy: 0, captionPlacement: "right" },
    { dx: -68, dy: 0, captionPlacement: "left" },
    { dx: 0, dy: 68, captionPlacement: "bottom" },
    { dx: 66, dy: -66, captionPlacement: "right" },
    { dx: -66, dy: -66, captionPlacement: "left" },
    { dx: 66, dy: 66, captionPlacement: "right" },
    { dx: -66, dy: 66, captionPlacement: "left" },
    { dx: 0, dy: -118, captionPlacement: "top" },
    { dx: 118, dy: 0, captionPlacement: "right" },
    { dx: -118, dy: 0, captionPlacement: "left" },
    { dx: 0, dy: 118, captionPlacement: "bottom" },
    { dx: 108, dy: -92, captionPlacement: "right" },
    { dx: -108, dy: -92, captionPlacement: "left" },
    { dx: 108, dy: 92, captionPlacement: "right" },
    { dx: -108, dy: 92, captionPlacement: "left" },
  ];
  const labelWidth = clamp(24 + Array.from(merchantName).length * 11 + (count > 1 ? String(count).length * 7 : 0), 50, 124);
  let best = null;
  candidates.forEach((candidate, index) => {
    const x = anchorX + candidate.dx;
    const y = anchorY + candidate.dy;
    const rect = getMapMarkerRect(x, y, candidate.captionPlacement, labelWidth);
    const overlap = occupiedRects.reduce((total, occupied) => total + rectangleOverlapArea(rect, occupied), 0);
    const overflow = Math.max(0, -rect.left) + Math.max(0, rect.right - width) + Math.max(0, -rect.top) + Math.max(0, rect.bottom - height);
    const distance = Math.hypot(candidate.dx, candidate.dy);
    const score = overlap * 1000 + overflow * 10000 + distance + index / 100;
    if (!best || score < best.score) best = { ...candidate, x, y, rect, distance, angle: Math.atan2(candidate.dy, candidate.dx), score };
  });
  return best;
}

function getMapMarkerRect(x, y, captionPlacement, labelWidth) {
  if (captionPlacement === "right") return { left: x - 22, right: x + 28 + labelWidth, top: y - 43, bottom: y + 5 };
  if (captionPlacement === "left") return { left: x - 28 - labelWidth, right: x + 22, top: y - 43, bottom: y + 5 };
  if (captionPlacement === "bottom") return { left: x - Math.max(22, labelWidth / 2), right: x + Math.max(22, labelWidth / 2), top: y - 43, bottom: y + 34 };
  return { left: x - Math.max(22, labelWidth / 2), right: x + Math.max(22, labelWidth / 2), top: y - 72, bottom: y + 5 };
}

function rectangleOverlapArea(a, b) {
  const overlapWidth = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const overlapHeight = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  return overlapWidth * overlapHeight;
}

function getFoodMarkerLabel(card) {
  const text = [card?.merchantName, card?.title, card?.tags?.join?.(" "), card?.notes].filter(Boolean).join(" ");
  const categories = [
    [/螺蛳粉|老友粉|河粉|米粉|肠粉|凉粉|酸辣粉|粉店|粉馆/, "粉"],
    [/拉面|小面|拌面|炒面|汤面|面馆|面条|沙茶面|刀削面|烩面|面食|麻辣烫/, "面"],
    [/烤鸭|鸭脖|鸭掌|鸭翅|鸭/, "鸭"],
    [/炸鸡|烤鸡|手撕鸡|鸡排|鸡翅|鸡腿|黄焖鸡|鸡/, "鸡"],
    [/龙虾|虾滑|虾/, "虾"],
    [/烤鱼|酸菜鱼|水煮鱼|鱼/, "鱼"],
    [/牛排|牛肉|牛腩|牛杂|牛/, "牛"],
    [/羊排|羊肉|羊蝎子|羊/, "羊"],
    [/烤肉|炒肉|猪肉|排骨|肉夹馍|肉/, "肉"],
    [/火锅|锅圈|干锅|焖锅|香锅/, "锅"],
    [/汉堡|堡王|麦当劳|肯德基/, "堡"],
    [/披萨|比萨/, "披"],
    [/咖啡|拿铁|美式|库迪|瑞幸/, "咖"],
    [/奶茶|果茶|柠檬茶|冻柠茶|泡茶|茶饮|茶/, "茶"],
    [/豆花|甜品|蛋糕|糖水|冰淇淋|雪糕|布丁|抹茶/, "甜"],
    [/寿司|刺身/, "寿"],
    [/饺子|水饺|锅贴|馄饨|云吞/, "饺"],
    [/包子|生煎|小笼包|馒头/, "包"],
    [/粥|稀饭/, "粥"],
    [/烧烤|烤串|串串|串烧/, "烤"],
    [/零食|薯片|饼干|坚果/, "零"],
    [/啤酒|白酒|红酒|酒馆|酒/, "酒"],
    [/炒饭|盖饭|煲仔饭|饭堂|食堂|米饭|套餐|饭/, "饭"],
    [/果汁|汽水|可乐|维他奶|饮料|饮品/, "饮"],
  ];
  return categories.find(([pattern]) => pattern.test(text))?.[1] || "餐";
}

function hasCoordinates(card) {
  return getMapPoints(card).length > 0;
}

function hasApproximateCoordinates(card) {
  return getMapPoints(card).some((point) => point.geoPrecision === "area");
}

function needsLocationReview(card) {
  return !hasCoordinates(card) || hasApproximateCoordinates(card);
}

function coordinateInputValue(value) {
  if (value === null || value === undefined || value === "") return "";
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toFixed(6).replace(/0+$/, "").replace(/\.$/, "") : "";
}

function finiteNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function roundCoordinate(value, digits = 6) {
  const scale = 10 ** digits;
  return Math.round(Number(value) * scale) / scale;
}

function projectCoordinates(latitude, longitude, zoom) {
  const worldSize = 256 * (2 ** zoom);
  const safeLatitude = clamp(Number(latitude), -85.051129, 85.051129);
  const sine = Math.sin(safeLatitude * Math.PI / 180);
  return {
    x: ((Number(longitude) + 180) / 360) * worldSize,
    y: (0.5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI)) * worldSize,
  };
}

function unprojectCoordinates(x, y, zoom) {
  const worldSize = 256 * (2 ** zoom);
  const longitude = (x / worldSize) * 360 - 180;
  const mercator = Math.PI - (2 * Math.PI * y) / worldSize;
  const latitude = (180 / Math.PI) * Math.atan(Math.sinh(mercator));
  return { latitude, longitude };
}

function mapCanvasPointToCoordinates(x, y, width, height, mapSettings) {
  const center = projectCoordinates(mapSettings.centerLatitude, mapSettings.centerLongitude, mapSettings.zoom);
  return unprojectCoordinates(
    center.x - width / 2 + x,
    center.y - height / 2 + y,
    mapSettings.zoom,
  );
}

function buildTileUrl(template, zoom, x, y) {
  const safeTemplate = String(template || "").startsWith("https://") ? template : defaultMapSettings.tileUrl;
  return safeTemplate
    .replaceAll("{z}", String(zoom))
    .replaceAll("{x}", String(x))
    .replaceAll("{y}", String(y));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}
}
