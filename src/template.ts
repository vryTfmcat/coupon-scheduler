export function createAppTemplate(brandIconUrl: string): string {
  return `
  <div class="app-shell">
    <header class="topbar">
      <div class="brand-block">
        <img class="brand-mark" src="${brandIconUrl}" alt="" />
        <div>
          <h1>券食日历</h1>
          <p id="todaySummary">今天</p>
        </div>
      </div>

      <div class="toolbar" aria-label="操作栏">
        <button class="icon-button" id="prevRange" type="button" aria-label="上一段" title="上一段">‹</button>
        <button class="text-button" id="todayButton" type="button">今天</button>
        <button class="icon-button" id="nextRange" type="button" aria-label="下一段" title="下一段">›</button>
        <div class="segmented" aria-label="视图切换">
          <button class="segment-button is-active" id="weekViewButton" type="button">周</button>
          <button class="segment-button" id="dayViewButton" type="button">日</button>
          <button class="segment-button" id="monthViewButton" type="button">月</button>
        </div>
        <button class="text-button primary" id="addCardButton" type="button">新增</button>
        <button class="text-button" id="importButton" type="button">导入</button>
        <button class="text-button" id="exportButton" type="button">导出</button>
        <input id="importFile" class="visually-hidden" type="file" accept="application/json" />
      </div>
    </header>

    <section class="filterbar" aria-label="筛选">
      <label><span>类型</span><select id="typeFilter"></select></label>
      <label><span>标签</span><select id="tagFilter"></select></label>
      <label class="search-field"><span>搜索</span><input id="searchInput" type="search" placeholder="名称 / 来源 / 备注" /></label>
    </section>

    <main class="planner-workspace">
      <section class="planner">
        <section class="inbox-strip" aria-labelledby="inboxTitle">
          <div class="section-heading">
            <h2 id="inboxTitle">未安排卡片</h2>
            <div class="inbox-heading-tools">
              <div class="inbox-tabs" aria-label="未安排卡片分类">
                <button class="inbox-tab is-active" type="button" data-inbox-page="outing">出门</button>
                <button class="inbox-tab" type="button" data-inbox-page="food">食材</button>
                <button class="inbox-tab" type="button" data-inbox-page="trash">回收站</button>
              </div>
              <span id="inboxCount">0</span>
            </div>
          </div>
          <div class="card-rail" id="unscheduledCards"></div>
        </section>

        <section class="calendar-section" aria-labelledby="calendarTitle">
          <div class="section-heading">
            <h2 id="calendarTitle">周日历</h2>
            <span id="rangeLabel">00:00-24:00</span>
          </div>
          <div class="calendar-scroll"><div class="calendar-grid" id="calendarGrid"></div></div>
        </section>
      </section>

      <aside class="detail-panel" aria-labelledby="detailTitle">
        <div class="section-heading"><h2 id="detailTitle">卡片详情</h2><span id="selectedState">未选择</span></div>
        <div id="detailBody" class="detail-body"></div>
      </aside>
    </main>
  </div>

  <template id="emptyDetailTemplate">
    <div class="planner-empty-state"><p>选择一张卡片，或点新增开始录入。</p></div>
  </template>
`;
}
