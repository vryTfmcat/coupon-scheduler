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
  };
}

function normalizeState(nextState) {
  return {
    cards: Array.isArray(nextState.cards) ? nextState.cards : [],
    events: Array.isArray(nextState.events) ? nextState.events : [],
    selectedCardId: nextState.selectedCardId ?? null,
    selectedEventId: nextState.selectedEventId ?? null,
    view: ["day", "week", "month"].includes(nextState.view) ? nextState.view : "week",
    inboxPage: ["outing", "food", "trash"].includes(nextState.inboxPage) ? nextState.inboxPage : "outing",
    cursorDate: nextState.cursorDate || toDateInputValue(new Date()),
    filters: {
      type: nextState.filters?.type || "all",
      tag: nextState.filters?.tag || "all",
      search: nextState.filters?.search || "",
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
  const haystack = [card.title, card.source, card.location, card.value, getRepeatLabel(card), card.notes, ...(card.tags || [])]
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
