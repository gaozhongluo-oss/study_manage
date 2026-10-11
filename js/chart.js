/* ============================================================
 * chart.js —— 每周统计柱状图（纯 SVG 手写，无外部依赖，离线可用）
 *
 * 说明：需求允许使用 ECharts / Chart.js，但二者都需要联网或额外文件。
 *       为了「双击即用、断网可用」，这里用原生 SVG 实现柱状图，
 *       功能等价：堆叠柱 + 6 小时参照线 + 悬停明细 + 点击联动。
 * ============================================================ */
(function (root, factory) {
  var U = root.StudyUtil || (typeof require === 'function' ? require('./util.js') : null);
  var api = factory(root, U);
  root.StudyChart = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root, U) {
  'use strict';

  var PAD = { top: 30, right: 16, bottom: 34, left: 46 };

  function round2(n) { return Math.round(n * 100) / 100; }

  /** 只有上方两个角是圆角的柱子路径（堆叠柱最上面一段用） */
  function topRoundedPath(x, y, w, h, r) {
    var rr = Math.min(r, w / 2, Math.max(1, h));
    return 'M' + round2(x) + ',' + round2(y + h) +
      'L' + round2(x) + ',' + round2(y + rr) +
      'Q' + round2(x) + ',' + round2(y) + ' ' + round2(x + rr) + ',' + round2(y) +
      'L' + round2(x + w - rr) + ',' + round2(y) +
      'Q' + round2(x + w) + ',' + round2(y) + ' ' + round2(x + w) + ',' + round2(y + rr) +
      'L' + round2(x + w) + ',' + round2(y + h) + 'Z';
  }

  /** Y 轴上限：取整到 2 小时，并给 6 小时参照线留出上方空间 */
  function niceMax(maxMinutes, goal) {
    var raw = Math.max(maxMinutes * 1.12, goal * 1.25, 120);
    var step = 120;
    return Math.max(step, Math.ceil(raw / step) * step);
  }

  /** 项目元信息（名称 / 颜色），兼容项目被删除后的历史数据 */
  function metaOf(state, projectId) {
    var api = root.StudyStats;
    if (api && api.projectMeta) return api.projectMeta(state, projectId);
    var list = state.projects || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === projectId) return list[i];
    return { id: '', name: '未分类', color: '#9aa3b2' };
  }

  /** 一天的堆叠段：按 state.projects 的固定顺序，保证每天颜色对齐 */
  function buildSegments(state, day) {
    var order = (state.projects || []).map(function (p) { return p.id; });
    var segs = [];
    order.forEach(function (pid) {
      var m = day.byProject[pid] || 0;
      if (m > 0) segs.push({ projectId: pid, minutes: m });
    });
    Object.keys(day.byProject).forEach(function (pid) {
      if (order.indexOf(pid) === -1 && day.byProject[pid] > 0) {
        segs.push({ projectId: pid, minutes: day.byProject[pid] });
      }
    });
    return segs;
  }

  function renderWeekly(host, model) {
    if (!host) return;
    var state = model.state;
    var week = model.week;
    var goal = week.goal;
    var width = Math.max(300, Math.round(host.clientWidth || 660));
    var height = width < 520 ? 250 : 292;
    var plotX = PAD.left;
    var plotY = PAD.top;
    var plotW = width - PAD.left - PAD.right;
    var plotH = height - PAD.top - PAD.bottom;
    var yMax = niceMax(week.max, goal);
    var scale = function (min) { return plotY + plotH - (min / yMax) * plotH; };
    var bandW = plotW / 7;
    var barW = Math.max(16, Math.min(bandW * 0.52, 54));
    var baseY = scale(0);
    var goalY = scale(goal);
    var today = U.todayStr();
    var s = [];

    s.push('<svg viewBox="0 0 ' + width + ' ' + height + '" width="' + width + '" height="' + height +
      '" role="img" aria-label="每周每日学习时长柱状图">');

    /* --- 纵向网格与刻度 --- */
    for (var m = 0; m <= yMax; m += 120) {
      var gy = scale(m);
      s.push('<line class="grid-line' + (m === 0 ? ' zero' : '') + '" x1="' + plotX + '" y1="' + round2(gy) +
        '" x2="' + (plotX + plotW) + '" y2="' + round2(gy) + '"/>');
      s.push('<text class="axis-text" x="' + (plotX - 8) + '" y="' + round2(gy) +
        '" text-anchor="end" dominant-baseline="middle">' + (m / 60) + '</text>');
    }
    s.push('<text class="axis-text" x="4" y="' + (plotY - 14) + '">小时</text>');

    /* --- 今天所在列的高亮背景 --- */
    week.days.forEach(function (day, i) {
      if (day.date !== today) return;
      s.push('<rect x="' + round2(plotX + bandW * i + 3) + '" y="' + plotY + '" width="' + round2(bandW - 6) +
        '" height="' + plotH + '" rx="8" fill="' + U.rgba('#4f7cff', 0.08) + '"/>');
    });

    /* --- 6 小时参照线 --- */
    s.push('<line class="ref-line" x1="' + plotX + '" y1="' + round2(goalY) + '" x2="' + (plotX + plotW) +
      '" y2="' + round2(goalY) + '"/>');
    s.push('<text class="ref-label" x="' + (plotX + plotW) + '" y="' + round2(goalY - 6) +
      '" text-anchor="end">6 小时目标</text>');

    /* --- 每天的柱子 --- */
    week.days.forEach(function (day, i) {
      var cx = plotX + bandW * (i + 0.5);
      var x = cx - barW / 2;
      var segs = buildSegments(state, day);
      var topY = day.total > 0 ? scale(day.total) : baseY;

      /* 距离目标还差的部分：半透明底 + 虚线框 */
      if (day.total < goal && baseY - goalY > 1) {
        var gh = baseY - goalY;
        s.push('<rect class="goal-ghost" x="' + round2(x) + '" y="' + round2(goalY) + '" width="' + round2(barW) +
          '" height="' + round2(gh) + '" rx="4"/>');
        s.push('<rect class="goal-ghost-outline" x="' + round2(x) + '" y="' + round2(goalY) + '" width="' +
          round2(barW) + '" height="' + round2(gh) + '" rx="4"/>');
      }

      /* 堆叠柱：自下而上绘制，最上面一段做圆角 */
      var acc = 0;
      segs.forEach(function (seg, si) {
        var isTop = si === segs.length - 1;
        var y1 = scale(acc + seg.minutes);
        var h = Math.max(scale(acc) - y1, 1.5);
        acc += seg.minutes;
        var meta = metaOf(state, seg.projectId);
        if (isTop) {
          s.push('<path class="bar-seg" data-seg="' + day.date + '" d="' + topRoundedPath(x, y1, barW, h, 6) +
            '" fill="' + meta.color + '"/>');
        } else {
          s.push('<rect class="bar-seg" data-seg="' + day.date + '" x="' + round2(x) + '" y="' + round2(y1) +
            '" width="' + round2(barW) + '" height="' + round2(h) + '" fill="' + meta.color + '"/>');
        }
      });

      /* 数值 + 与 6 小时的差距：贴在「柱顶 / 目标线」中较高者的上方 */
      var labelBase = day.total > 0 ? Math.min(topY, goalY) : goalY;
      var diff = day.total - goal;
      var diffText = diff === 0 ? '±0h'
        : (diff > 0 ? '+' : '−') + U.formatHours(Math.abs(diff));
      s.push('<text class="axis-text strong" x="' + round2(cx) + '" y="' + round2(labelBase - 17) +
        '" text-anchor="middle">' + U.formatHours(day.total) + '</text>');
      s.push('<text class="diff-text ' + (diff >= 0 ? 'over' : 'under') + '" x="' + round2(cx) + '" y="' +
        round2(labelBase - 5) + '" text-anchor="middle">' + diffText + '</text>');

      /* 底部日期 */
      s.push('<text class="axis-text' + (day.date === today ? ' strong' : '') + '" x="' + round2(cx) + '" y="' +
        (plotY + plotH + 16) + '" text-anchor="middle">' + U.weekdayName(day.date) + '</text>');
      s.push('<text class="axis-text" x="' + round2(cx) + '" y="' + (plotY + plotH + 29) +
        '" text-anchor="middle">' + day.date.slice(5) + '</text>');

      /* 整列热区：悬停查看明细、点击跳到当天时间轴 */
      s.push('<rect class="band-hit" data-date="' + day.date + '" x="' + round2(plotX + bandW * i) + '" y="' +
        plotY + '" width="' + round2(bandW) + '" height="' + plotH + '" fill="transparent"/>');
    });

    /* --- 整周为空的提示 --- */
    if (week.total === 0) {
      s.push('<text class="axis-text" x="' + round2(plotX + plotW / 2) + '" y="' + round2(plotY + plotH / 2) +
        '" text-anchor="middle">' + U.escapeHtml(model.emptyText || '这一周还没有数据') + '</text>');
    }

    s.push('</svg>');
    host.innerHTML = s.join('');

    var svgEl = host.firstElementChild;
    if (!svgEl) return;
    var highlighted = [];

    function clearHighlight() {
      highlighted.forEach(function (el) { el.style.filter = ''; });
      highlighted = [];
    }

    function highlight(date) {
      clearHighlight();
      var nodes = svgEl.querySelectorAll('[data-seg="' + date + '"]');
      for (var i = 0; i < nodes.length; i++) {
        nodes[i].style.filter = 'brightness(1.12) saturate(1.05)';
        highlighted.push(nodes[i]);
      }
    }

    svgEl.addEventListener('mousemove', function (evt) {
      var t = evt.target;
      var date = t && t.getAttribute ? t.getAttribute('data-date') : null;
      if (!date) { clearHighlight(); hideTip(model); return; }
      highlight(date);
      showTip(model, date, evt);
    });
    svgEl.addEventListener('mouseleave', function () { clearHighlight(); hideTip(model); });
    svgEl.addEventListener('click', function (evt) {
      var t = evt.target;
      var date = t && t.getAttribute ? t.getAttribute('data-date') : null;
      if (date && model.onSelectDate) model.onSelectDate(date);
    });
  }

  function showTip(model, date, evt) {
    var tip = model.tipEl;
    if (!tip) return;
    var state = model.state;
    var day = null;
    model.week.days.forEach(function (d) { if (d.date === date) day = d; });
    if (!day) return;

    var rows = buildSegments(state, day).map(function (seg) {
      var meta = metaOf(state, seg.projectId);
      return '<div class="tt-row"><i class="sw" style="background:' + meta.color + '"></i>' +
        U.escapeHtml(meta.name) + '<span class="v">' + U.formatMinutes(seg.minutes) + '</span></div>';
    });
    if (!rows.length) rows.push('<div class="tt-row">暂无学习内容<span class="v">0分</span></div>');

    var diff = day.total - model.week.goal;
    var diffLabel = diff === 0 ? '正好达到目标'
      : (diff > 0 ? '超出目标 ' : '距目标还差 ') + U.formatMinutes(Math.abs(diff));

    tip.innerHTML = '<div class="tt-title">' + U.formatDateCN(date) + ' · 合计 ' + U.formatMinutes(day.total) +
      '</div>' + rows.join('') + '<div class="tt-row" style="margin-top:4px;opacity:.75">' + diffLabel + '</div>';
    tip.hidden = false;

    var tw = tip.offsetWidth, th = tip.offsetHeight;
    var x = evt.clientX + 14, y = evt.clientY + 14;
    if (x + tw > window.innerWidth - 8) x = evt.clientX - tw - 14;
    if (y + th > window.innerHeight - 8) y = evt.clientY - th - 14;
    tip.style.left = Math.max(8, x) + 'px';
    tip.style.top = Math.max(8, y) + 'px';
  }

  function hideTip(model) {
    if (model && model.tipEl) model.tipEl.hidden = true;
  }

  /* ============================================================
   * 每晚睡眠柱状图（按月份，一天一根柱子）
   * model: { state, month:'YYYY-MM', selectedDate, tipEl, onPick(date) }
   * ============================================================ */
  var SLEEP_REF = 8 * 60;   // 8 小时参考线

  function sleepYMax(maxMin) {
    return Math.max(600, Math.ceil(Math.max(maxMin * 1.12, SLEEP_REF * 1.15) / 120) * 120);
  }

  function renderSleep(host, model) {
    if (!host) return;
    var state = model.state;
    var days = root.StudyStats.sleepMonth(state, model.month);
    var selected = model.selectedDate;
    var today = U.todayStr();

    var width = Math.max(300, Math.round(host.clientWidth || 660));
    var height = width < 560 ? 200 : 228;
    var pad = { top: 22, right: 12, bottom: 26, left: 38 };
    var plotX = pad.left, plotY = pad.top;
    var plotW = width - pad.left - pad.right;
    var plotH = height - pad.top - pad.bottom;

    var maxMin = days.reduce(function (m, d) { return Math.max(m, d.minutes); }, 0);
    var yMax = sleepYMax(maxMin);
    var scale = function (min) { return plotY + plotH - (min / yMax) * plotH; };
    var bandW = plotW / days.length;
    var barW = Math.max(4, Math.min(bandW * 0.68, 26));
    var s = [];

    s.push('<svg viewBox="0 0 ' + width + ' ' + height + '" width="' + width + '" height="' + height +
      '" role="img" aria-label="每晚睡眠时长柱状图">');

    /* 横向网格（每 2 小时） */
    for (var m = 0; m <= yMax; m += 120) {
      var gy = scale(m);
      s.push('<line class="grid-line' + (m === 0 ? ' zero' : '') + '" x1="' + plotX + '" y1="' + round2(gy) +
        '" x2="' + (plotX + plotW) + '" y2="' + round2(gy) + '"/>');
      s.push('<text class="axis-text" x="' + (plotX - 7) + '" y="' + round2(gy) +
        '" text-anchor="end" dominant-baseline="middle">' + (m / 60) + '</text>');
    }
    s.push('<text class="axis-text" x="2" y="' + (plotY - 10) + '">小时</text>');

    /* 8 小时参考线 */
    var refY = scale(SLEEP_REF);
    s.push('<line class="ref-line" x1="' + plotX + '" y1="' + round2(refY) + '" x2="' +
      (plotX + plotW) + '" y2="' + round2(refY) + '"/>');
    s.push('<text class="ref-label" x="' + (plotX + plotW) + '" y="' + round2(refY - 5) +
      '" text-anchor="end">8 小时</text>');

    /* 柱子：一天一根 */
    days.forEach(function (d, i) {
      var cx = plotX + bandW * (i + 0.5);
      var x = cx - barW / 2;
      var baseY = scale(0);
      var dayNum = Number(d.date.slice(8));
      var isSel = d.date === selected;
      var isToday = d.date === today;

      if (isToday) {
        s.push('<rect x="' + round2(cx - bandW / 2 + 1) + '" y="' + plotY + '" width="' +
          round2(Math.max(bandW - 2, 1)) + '" height="' + plotH + '" rx="4" fill="' +
          U.rgba('#4f7cff', 0.07) + '"/>');
      }
      if (d.minutes > 0) {
        var y1 = scale(d.minutes);
        s.push('<path class="sleep-bar" data-date="' + d.date + '" d="' +
          topRoundedPath(x, y1, barW, Math.max(baseY - y1, 2), 4) + '" fill="' +
          (d.minutes >= SLEEP_REF ? '#5f6caf' : '#8a93c9') + '"' +
          (isSel ? ' stroke="#1e2430" stroke-width="1.5" stroke-dasharray="3 2"' : '') + '/>');
      }
      /* 日期标签只标首日 / 每 5 天 / 选中日 / 今天，避免拥挤 */
      if (dayNum === 1 || dayNum % 5 === 0 || isSel || isToday) {
        s.push('<text class="axis-text' + (isSel || isToday ? ' strong' : '') + '" x="' + round2(cx) +
          '" y="' + (plotY + plotH + 15) + '" text-anchor="middle">' + dayNum + '</text>');
      }
      s.push('<rect class="sleep-hit" data-date="' + d.date + '" x="' + round2(plotX + bandW * i) + '" y="' +
        plotY + '" width="' + round2(bandW) + '" height="' + plotH + '" fill="transparent"/>');
    });

    if (!days.some(function (d) { return d.minutes > 0; })) {
      s.push('<text class="axis-text" x="' + round2(plotX + plotW / 2) + '" y="' + round2(plotY + plotH / 2) +
        '" text-anchor="middle">这个月还没有睡眠记录，左边填一晚试试</text>');
    }
    s.push('</svg>');
    host.innerHTML = s.join('');

    var svgEl = host.firstElementChild;
    if (!svgEl) return;

    svgEl.addEventListener('mousemove', function (evt) {
      var t = evt.target;
      var date = t && t.getAttribute ? t.getAttribute('data-date') : null;
      var tip = model.tipEl;
      if (!date || !tip) { hideTip(model); return; }
      var hit = days.filter(function (d) { return d.date === date; })[0];
      if (!hit) { hideTip(model); return; }
      var bedTxt = hit.entry ? U.minutesToHHMM(hit.entry.bed) + ' → ' + U.minutesToHHMM(hit.entry.wake) : '';
      tip.innerHTML = '<div class="tt-title">' + U.formatDateCN(date) + '</div>' +
        '<div class="tt-row">睡眠<span class="v">' +
        (hit.minutes > 0 ? U.formatMinutesLong(hit.minutes) : '未记录') + '</span></div>' +
        (bedTxt ? '<div class="tt-row" style="opacity:.75">' + bedTxt + '</div>' : '') +
        (hit.entry && hit.entry.note
          ? '<div class="tt-row" style="opacity:.75">' + U.escapeHtml(hit.entry.note) + '</div>' : '') +
        (hit.minutes > 0
          ? '<div class="tt-row" style="opacity:.75">比 8 小时' + (hit.minutes >= SLEEP_REF ? '多 ' : '少 ') +
            U.formatMinutesLong(Math.abs(hit.minutes - SLEEP_REF)) + '</div>'
          : '');
      tip.hidden = false;
      var tw = tip.offsetWidth, th = tip.offsetHeight;
      var tx = evt.clientX + 14, ty = evt.clientY + 14;
      if (tx + tw > window.innerWidth - 8) tx = evt.clientX - tw - 14;
      if (ty + th > window.innerHeight - 8) ty = evt.clientY - th - 14;
      tip.style.left = Math.max(8, tx) + 'px';
      tip.style.top = Math.max(8, ty) + 'px';
    });
    svgEl.addEventListener('mouseleave', function () { hideTip(model); });
    svgEl.addEventListener('click', function (evt) {
      var t = evt.target;
      var date = t && t.getAttribute ? t.getAttribute('data-date') : null;
      if (date && model.onPick) model.onPick(date);
    });
  }

  return {
    renderWeekly: renderWeekly,
    renderSleep: renderSleep,
    topRoundedPath: topRoundedPath,
    niceMax: niceMax,
    buildSegments: buildSegments,
    sleepYMax: sleepYMax,
    PAD: PAD,
    SLEEP_REF: SLEEP_REF
  };
});
