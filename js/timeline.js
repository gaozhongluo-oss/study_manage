/* ============================================================
 * timeline.js —— 每日时间轴（6:00 – 24:00）
 *
 * 渲染：每天一条轨道；同一天内重叠的时间段自动分为多条泳道，互不遮挡。
 * 交互（单日模式）：
 *   在空白处按住拖动  -> 新建时间段
 *   拖动色块本身      -> 整体平移
 *   拖动色块左右边缘  -> 调整起止
 *   单击色块          -> 打开编辑器（改项目 / 时间 / 备注 / 删除）
 * 整周模式为浏览视图：点击色块会切到那一天的「单日」视图并打开编辑器。
 *
 * 回调（由 app.js 注入，本模块不直接改数据）：
 *   onCreate(date, {start, end, projectId})
 *   onChange(date, blockId, {start, end})
 *   onOpenEditor(date, blockId)
 * ============================================================ */
(function (root, factory) {
  var U = root.StudyUtil || (typeof require === 'function' ? require('./util.js') : null);
  var api = factory(root, U);
  root.StudyTimeline = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root, U) {
  'use strict';

  var DAY_START = U.DAY_START;
  var DAY_END = U.DAY_END;
  var SPAN = DAY_END - DAY_START;
  var LANE_H = 24;          // 与 CSS 变量 --lane-h 保持一致
  var TRACK_PAD = 5;        // 轨道上下内边距
  var CLICK_TOLERANCE = 4;  // 判定「点击」而非「拖动」的像素阈值

  function pctOf(minutes) { return ((minutes - DAY_START) / SPAN) * 100; }
  function pctStr(minutes) { return pctOf(minutes).toFixed(4) + '%'; }

  function metaOf(state, projectId) {
    var S = root.StudyStats;
    if (S && S.projectMeta) return S.projectMeta(state, projectId);
    var list = state.projects || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === projectId) return list[i];
    return { id: '', name: '未分类', color: '#9aa3b2' };
  }

  function currentMinutes() {
    var now = new Date();
    return now.getHours() * 60 + now.getMinutes();
  }

  /* ---------------- HTML 片段 ---------------- */

  function hourTicksHtml() {
    var out = [];
    for (var h = 6; h <= 24; h++) {
      var major = h % 2 === 0;
      out.push('<span class="tl-tick' + (major ? ' major' : '') + '" style="left:' + pctStr(h * 60) +
        '"></span>');
    }
    return out.join('');
  }

  function axisHtml() {
    var out = [];
    for (var h = 6; h <= 24; h += 2) {
      var style;
      if (h === 6) style = 'left:0;transform:none';
      else if (h === 24) style = 'left:100%;transform:translateX(-100%)';
      else style = 'left:' + pctStr(h * 60) + ';transform:translateX(-50%)';
      out.push('<span style="' + style + '">' + h + ':00</span>');
    }
    return '<div class="tl-row tl-axis-row"><div class="tl-rowlabel"></div>' +
      '<div class="tl-axis">' + out.join('') + '</div></div>';
  }

  function blockLabel(state, block, widthPct) {
    var meta = metaOf(state, block.projectId);
    var range = U.minutesToHHMM(block.start) + '–' + U.minutesToHHMM(block.end);
    if (widthPct > 13) return meta.name + ' ' + range;
    if (widthPct > 7) return range;
    if (widthPct > 4) return U.formatMinutes(block.end - block.start);
    return '';
  }

  function blockHtml(state, block, lane) {
    var meta = metaOf(state, block.projectId);
    var left = pctOf(block.start);
    var width = Math.max(pctOf(block.end) - left, 0.4);
    var title = meta.name + ' ' + U.minutesToHHMM(block.start) + '–' + U.minutesToHHMM(block.end) +
      (block.note ? ' · ' + block.note : '');
    return '<div class="tl-block' + (block.note ? ' has-note' : '') + (width < 5 ? ' is-tiny' : '') +
      '" data-id="' + U.escapeHtml(block.id) + '" title="' + U.escapeHtml(title) + '"' +
      ' style="left:' + left.toFixed(4) + '%;width:' + width.toFixed(4) + '%;top:' +
      (TRACK_PAD + lane * LANE_H) + 'px;background:' + meta.color + ';color:' +
      U.readableTextColor(meta.color) + '">' +
      '<span class="tl-handle l"></span>' +
      '<span class="tl-label">' + U.escapeHtml(blockLabel(state, block, width)) + '</span>' +
      '<span class="tl-handle r"></span></div>';
  }

  function rowHtml(state, date, editable) {
    var blocks = (state.timeline[date] || []).slice();
    var layout = root.StudyStats.assignLanes(blocks);
    var height = TRACK_PAD * 2 + layout.laneCount * LANE_H;
    var isToday = date === U.todayStr();
    var total = blocks.reduce(function (sum, b) { return sum + Math.max(0, b.end - b.start); }, 0);

    var blocksHtml = layout.items.map(function (it) {
      return blockHtml(state, it.block, it.lane);
    }).join('');

    return '<div class="tl-row">' +
      '<div class="tl-rowlabel' + (isToday ? ' is-today' : '') + '" data-label-date="' + date + '">' +
        '<span class="d">' + U.formatDateCN(date) + '</span>' +
        '<span class="s">' + (total > 0 ? '合计 ' + U.formatMinutes(total) : '暂无安排') + '</span>' +
      '</div>' +
      '<div class="tl-track' + (editable ? ' is-editable' : '') + '" data-date="' + date +
        '" style="height:' + height + 'px">' +
        '<div class="tl-grid">' + hourTicksHtml() + '</div>' +
        '<div class="tl-blocks">' + blocksHtml + '</div>' +
        (editable ? '<span class="tl-now" hidden></span>' : '') +
        (editable && !blocks.length
          ? '<div class="tl-empty-note">按住鼠标左右拖动，即可写入一个时间段</div>' : '') +
      '</div>' +
    '</div>';
  }

  /* ---------------- 主渲染 ---------------- */

  function render(host, model) {
    if (!host) return;
    if (host.__tlAbort) { host.__tlAbort(); host.__tlAbort = null; }   // 中断上一次未完成的拖拽
    var dates = model.mode === 'week' ? U.weekDates(model.date, 1) : [model.date];
    var editable = model.mode === 'day';
    host.innerHTML = dates.map(function (d) { return rowHtml(model.state, d, editable); }).join('') + axisHtml();
    updateNowLine(host, model);
    bindPointer(host, model, editable);
  }

  /** 「现在」竖线：只有今天显示；可单独刷新，避免整条时间轴重绘 */
  function updateNowLine(host, model) {
    var line = host.querySelector('.tl-now');
    if (!line) return;
    var date = (model && model.date) || U.todayStr();
    var mins = currentMinutes();
    if (date !== U.todayStr() || mins < DAY_START || mins > DAY_END) { line.hidden = true; return; }
    line.hidden = false;
    line.style.left = pctStr(mins);
  }

  /* ---------------- 拖拽交互 ---------------- */

  function bindPointer(host, model, editable) {
    var drag = null;

    function minutesAt(clientX, rect) {
      var ratio = (clientX - rect.left) / (rect.width || 1);
      return U.snapMinutes(U.clamp(DAY_START + ratio * SPAN, DAY_START, DAY_END));
    }

    function onPointerDown(evt) {
      if (evt.button !== 0) return;
      var target = evt.target;
      if (!target || !target.closest) return;
      var track = target.closest('.tl-track');
      if (!track) return;
      var date = track.getAttribute('data-date');
      var blockEl = target.closest('.tl-block');

      /* 整周视图：只允许点击色块（切到单日视图并打开编辑器） */
      if (model.mode === 'week') {
        if (blockEl) model.onOpenEditor(date, blockEl.getAttribute('data-id'));
        return;
      }

      var rect = track.getBoundingClientRect();

      if (blockEl) {
        var id = blockEl.getAttribute('data-id');
        var source = (model.state.timeline[date] || []).filter(function (b) { return b.id === id; })[0];
        if (!source) return;
        drag = {
          kind: target.closest('.tl-handle.l') ? 'resize-l'
              : (target.closest('.tl-handle.r') ? 'resize-r' : 'move'),
          date: date,
          id: id,
          track: track,
          rect: rect,
          el: blockEl,
          label: blockEl.querySelector('.tl-label'),
          origin: { start: source.start, end: source.end },
          grabOffset: minutesAt(evt.clientX, rect) - source.start,
          startX: evt.clientX,
          startY: evt.clientY,
          moved: false,
          preview: null
        };
      } else if (editable) {
        var anchor = minutesAt(evt.clientX, rect);
        var color = metaOf(model.state, model.activeProjectId).color;
        var ghost = document.createElement('div');
        ghost.className = 'tl-ghost';
        ghost.style.color = color;
        ghost.style.background = U.rgba(color, 0.3);
        ghost.style.top = TRACK_PAD + 'px';
        drag = {
          kind: 'create',
          date: date,
          track: track,
          rect: rect,
          el: ghost,
          label: null,
          anchor: anchor,
          cursor: anchor,
          startX: evt.clientX,
          startY: evt.clientY,
          moved: false,
          preview: null
        };
        paintGhost(drag);
        track.querySelector('.tl-blocks').appendChild(ghost);
      } else {
        return;
      }

      evt.preventDefault();
      try { track.setPointerCapture(evt.pointerId); } catch (e) { /* 部分浏览器不支持，忽略 */ }
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    }

    function paintGhost(d) {
      var s = Math.min(d.anchor, d.cursor);
      var e = Math.max(d.anchor, d.cursor);
      if (e - s < U.SNAP) e = Math.min(DAY_END, s + U.SNAP);
      d.el.style.left = pctStr(s);
      d.el.style.width = Math.max(pctOf(e) - pctOf(s), 0.4).toFixed(4) + '%';
    }

    function onMove(evt) {
      if (!drag) return;
      if (Math.abs(evt.clientX - drag.startX) > CLICK_TOLERANCE ||
          Math.abs(evt.clientY - drag.startY) > CLICK_TOLERANCE) {
        drag.moved = true;
      }
      var cur = minutesAt(evt.clientX, drag.rect);

      if (drag.kind === 'create') {
        drag.cursor = cur;
        paintGhost(drag);
        return;
      }

      var start = drag.origin.start, end = drag.origin.end;
      if (drag.kind === 'move') {
        var duration = end - start;
        start = U.clamp(U.snapMinutes(cur - drag.grabOffset), DAY_START, DAY_END - duration);
        end = start + duration;
      } else if (drag.kind === 'resize-l') {
        start = U.clamp(cur, DAY_START, end - U.SNAP);
      } else {
        end = U.clamp(cur, start + U.SNAP, DAY_END);
      }

      drag.preview = { start: start, end: end };
      drag.el.classList.add('is-dragging');
      drag.el.style.left = pctStr(start);
      drag.el.style.width = Math.max(pctOf(end) - pctOf(start), 0.4).toFixed(4) + '%';
      if (drag.label) drag.label.textContent = U.minutesToHHMM(start) + '–' + U.minutesToHHMM(end);
    }

    function detach() {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    }

    function onUp(evt) {
      detach();
      if (!drag) return;
      var d = drag;
      drag = null;
      try { d.track.releasePointerCapture(evt.pointerId); } catch (e) { /* 忽略 */ }

      if (d.kind === 'create') {
        if (d.el.parentNode) d.el.parentNode.removeChild(d.el);
        var s = Math.min(d.anchor, d.cursor);
        var e = Math.max(d.anchor, d.cursor);
        if (e - s >= U.SNAP) model.onCreate(d.date, { start: s, end: e, projectId: model.activeProjectId });
        return;
      }

      d.el.classList.remove('is-dragging');
      if (!d.moved) { model.onOpenEditor(d.date, d.id); return; }   // 原地点击 = 打开编辑器
      if (d.preview && (d.preview.start !== d.origin.start || d.preview.end !== d.origin.end)) {
        model.onChange(d.date, d.id, { start: d.preview.start, end: d.preview.end });
      } else {
        render(host, model);   // 位置没变：重绘一次，把临时预览恢复成原样
      }
    }

    host.addEventListener('pointerdown', onPointerDown);
    host.__tlAbort = function () { detach(); drag = null; host.removeEventListener('pointerdown', onPointerDown); };
  }

  return {
    render: render,
    updateNowLine: updateNowLine,
    axisHtml: axisHtml,
    currentMinutes: currentMinutes,
    pctOf: pctOf,
    LANE_H: LANE_H,
    TRACK_PAD: TRACK_PAD
  };
});
