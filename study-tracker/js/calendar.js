/* ============================================================
 * calendar.js —— 迷你月历（用于调取任意一天的时间轴）
 *
 * 只负责渲染与点击分发；「当前查看哪个月」「选中哪一天」由 app.js 管理。
 * 有数据的日期会按项目颜色显示小圆点，方便回看哪天练过。
 *
 * 回调：
 *   onPick(dateStr)        选择某一天
 *   onMonth(delta)         切换月份（-1 / +1）
 *   onToday()              回到今天
 * ============================================================ */
(function (root, factory) {
  var U = root.StudyUtil || (typeof require === 'function' ? require('./util.js') : null);
  var api = factory(U);
  root.StudyCalendar = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (U) {
  'use strict';

  var WEEK_LABELS = ['一', '二', '三', '四', '五', '六', '日'];

  /** "2025-10" -> {year, month(1-12)} */
  function parseMonth(monthStr) {
    var m = /^(\d{4})-(\d{2})$/.exec(String(monthStr || ''));
    if (!m) {
      var now = new Date();
      return { year: now.getFullYear(), month: now.getMonth() + 1 };
    }
    return { year: +m[1], month: U.clamp(+m[2], 1, 12) };
  }

  function monthOf(dateStr) {
    return U.isValidDateStr(dateStr) ? dateStr.slice(0, 7) : U.todayStr().slice(0, 7);
  }

  function shiftMonth(monthStr, delta) {
    var p = parseMonth(monthStr);
    var d = new Date(p.year, p.month - 1 + delta, 1);
    return d.getFullYear() + '-' + U.pad2(d.getMonth() + 1);
  }

  /** 当天时间轴上出现过的项目 id（按 state.projects 顺序，最多 3 个） */
  function projectDots(state, date) {
    var blocks = state.timeline[date] || [];
    if (!blocks.length) return [];
    var seen = [];
    blocks.forEach(function (b) {
      if (b.projectId && seen.indexOf(b.projectId) === -1) seen.push(b.projectId);
    });
    var ordered = state.projects.map(function (p) { return p.id; })
      .filter(function (id) { return seen.indexOf(id) !== -1; });
    seen.forEach(function (id) { if (ordered.indexOf(id) === -1) ordered.push(id); });
    return ordered.slice(0, 3).map(function (id) {
      var p = state.projects.filter(function (q) { return q.id === id; })[0];
      return p ? p.color : '#9aa3b2';
    });
  }

  /** 当晚睡眠（分钟） */
  function sleepMinutesOf(state, date) {
    var e = state.sleep && state.sleep[date];
    return e && e.duration ? e.duration : 0;
  }

  function render(host, model) {
    if (!host) return;
    var state = model.state;
    var mode = model.mode === 'sleep' ? 'sleep' : 'timeline';
    var selected = model.selectedDate;
    var month = monthOf(model.viewMonth || selected);
    var p = parseMonth(month);
    var today = U.todayStr();

    var first = new Date(p.year, p.month - 1, 1);
    var offset = (first.getDay() + 6) % 7;          // 周一为一周起点
    var gridStart = U.addDays(first, -offset);
    var cellCount = 42;                              // 6 行 × 7 列，高度稳定不跳动

    var cells = [];
    for (var i = 0; i < cellCount; i++) {
      var d = U.addDays(gridStart, i);
      var dateStr = U.toDateStr(d);
      var isOut = d.getMonth() !== p.month - 1;
      var sleepMin = sleepMinutesOf(state, dateStr);
      var dots = mode === 'sleep' ? [] : projectDots(state, dateStr);
      var cls = 'cal-day';
      if (isOut) cls += ' is-out';
      if (dateStr === today) cls += ' is-today';
      if (dateStr === selected) cls += ' is-selected';
      if (mode === 'sleep' && sleepMin > 0) cls += ' has-sleep';
      var tipText = mode === 'sleep'
        ? U.formatDateCN(dateStr) + (sleepMin > 0 ? ' · 睡眠 ' + U.formatMinutesLong(sleepMin) : ' · 未记录睡眠')
        : U.formatDateCN(dateStr) + (dots.length ? ' · 有记录' : '');
      cells.push('<button type="button" class="' + cls + '" data-date="' + dateStr + '" title="' +
        U.escapeHtml(tipText) + '">' +
        d.getDate() +
        (mode === 'sleep'
          ? (sleepMin > 0 ? '<span class="cal-dots cal-sleep-dot"><i></i></span>' : '')
          : (dots.length
              ? '<span class="cal-dots">' + dots.map(function (c) {
                  return '<i style="background:' + c + '"></i>';
                }).join('') + '</span>'
              : '')) +
        '</button>');
    }

    host.innerHTML =
      '<div class="cal-mode seg seg-sm" role="group" aria-label="日历显示内容">' +
        '<button type="button" class="seg-btn' + (mode === 'timeline' ? ' is-active' : '') +
          '" data-calmode="timeline">时间轴</button>' +
        '<button type="button" class="seg-btn' + (mode === 'sleep' ? ' is-active' : '') +
          '" data-calmode="sleep">🌙 睡眠</button>' +
      '</div>' +
      '<div class="cal-head">' +
        '<button type="button" class="icon-btn cal-nav" data-nav="-1" title="上个月">‹</button>' +
        '<span class="cal-title">' + p.year + ' 年 ' + p.month + ' 月</span>' +
        '<button type="button" class="icon-btn cal-nav" data-nav="1" title="下个月">›</button>' +
      '</div>' +
      '<div class="cal-grid">' +
        WEEK_LABELS.map(function (w) { return '<span class="cal-wd">' + w + '</span>'; }).join('') +
        cells.join('') +
      '</div>' +
      '<div class="cal-foot">' +
        '<span class="hint" style="margin:0">' +
          (mode === 'sleep' ? '🌙＝当晚有睡眠记录，点一下看柱状图' : '圆点＝当天有记录') +
        '</span>' +
        '<button type="button" class="btn btn-soft btn-sm cal-today">回到今天</button>' +
      '</div>';

    /* 事件只绑定一次（host 元素在整个页面生命周期内复用） */
    if (!host.__calBound) {
      host.__calBound = true;
      host.addEventListener('click', function (e) {
        var m = host.__calModel;
        if (!m) return;
        var modeBtn = e.target.closest('.cal-mode .seg-btn');
        if (modeBtn) {
          if (m.onModeChange) m.onModeChange(modeBtn.getAttribute('data-calmode'));
          return;
        }
        var nav = e.target.closest('.cal-nav');
        if (nav) { m.onMonth(Number(nav.getAttribute('data-nav'))); return; }
        if (e.target.closest('.cal-today')) { m.onToday(); return; }
        var day = e.target.closest('.cal-day');
        if (day) m.onPick(day.getAttribute('data-date'));
      });
    }
    host.__calModel = model;
  }

  return {
    render: render,
    monthOf: monthOf,
    shiftMonth: shiftMonth,
    parseMonth: parseMonth,
    projectDots: projectDots,
    sleepMinutesOf: sleepMinutesOf,
    WEEK_LABELS: WEEK_LABELS
  };
});
