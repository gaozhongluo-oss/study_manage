/* ============================================================
 * stats.js —— 统计聚合（纯函数，不碰 DOM，可在 Node 中单元测试）
 *
 * 名词说明：
 *   state  : 全部本地数据（见 store.js 的默认结构）
 *   source : 'records'（学习记录） | 'timeline'（每日时间轴色块）
 *            两种统计来源互不混算，避免重复计数。
 *   day    : { date, total, byProject: { 项目id: 分钟 } }
 * ============================================================ */
(function (root, factory) {
  var U = root.StudyUtil || (typeof require === 'function' ? require('./util.js') : null);
  var api = factory(U);
  root.StudyStats = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (U) {
  'use strict';

  var DAY_START = U.DAY_START;
  var DAY_END = U.DAY_END;

  /* ---------------- 时间段（时间轴色块） ---------------- */

  function blockMinutes(block) {
    if (!block) return 0;
    return Math.max(0, Math.round(block.end - block.start));
  }

  /** 把起止时间裁剪到 6:00–24:00，并保证至少有 5 分钟 */
  function clampBlockRange(start, end) {
    var s = U.clamp(Math.round(start), DAY_START, DAY_END - U.SNAP);
    var e = U.clamp(Math.round(end), DAY_START + U.SNAP, DAY_END);
    if (e <= s) e = Math.min(DAY_END, s + U.SNAP);
    return { start: s, end: e };
  }

  /** 找出与 [start, end) 重叠的其它色块（excludeId 用于编辑自身时排除） */
  function findConflicts(blocks, start, end, excludeId) {
    var out = [];
    (blocks || []).forEach(function (b) {
      if (!b || b.id === excludeId) return;
      if (b.start < end && b.end > start) out.push(b);
    });
    return out;
  }

  /**
   * 日程式分泳道：重叠的色块自动落到不同行，避免互相遮挡
   * @returns {{items: Array, laneCount: number}}
   */
  function assignLanes(blocks) {
    var sorted = (blocks || []).slice().sort(function (a, b) {
      return a.start - b.start || a.end - b.end;
    });
    var laneEnds = [];   // 每条泳道当前的结束时间
    var items = [];
    sorted.forEach(function (b) {
      var lane = -1;
      for (var i = 0; i < laneEnds.length; i++) {
        if (laneEnds[i] <= b.start) { lane = i; break; }
      }
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(0); }
      laneEnds[lane] = b.end;
      items.push({ block: b, lane: lane });
    });
    return { items: items, laneCount: Math.max(1, laneEnds.length) };
  }

  /**
   * 把一个新时间段并入已有列表（番茄计时写入时间轴时用）：
   *   - 同一个项目、且时间上重叠或首尾相接的色块 → 合并成一个（含连锁合并）
   *   - 不同项目的重叠不做合并，交给泳道自动并排显示
   * 这样既保证「实际时长」不重复计算，也保证时间轴不会出现碎片或互相遮挡。
   * @returns {{blocks:Array, merged:boolean, mergedCount:number}}
   */
  function mergeBlockInto(blocks, candidate) {
    var list = (blocks || []).slice();
    var cur = {
      id: candidate.id,
      projectId: candidate.projectId,
      start: candidate.start,
      end: candidate.end,
      note: candidate.note || ''
    };
    var mergedCount = 0;
    var changed = true;
    while (changed) {
      changed = false;
      for (var i = 0; i < list.length; i++) {
        var b = list[i];
        if (b.projectId !== cur.projectId) continue;
        if (b.start > cur.end || b.end < cur.start) continue;   // 相接（b.end === cur.start）也算合并
        cur.start = Math.min(cur.start, b.start);
        cur.end = Math.max(cur.end, b.end);
        if (!cur.note) cur.note = b.note || '';
        list.splice(i, 1);
        mergedCount++;
        changed = true;
        break;
      }
    }
    list.push(cur);
    list.sort(function (a, b) { return a.start - b.start || a.end - b.end; });
    return { blocks: list, merged: mergedCount > 0, mergedCount: mergedCount };
  }

  /* ---------------- 单日 / 区间聚合 ---------------- */

  function emptyDay(date) {
    return { date: date, total: 0, byProject: {} };
  }

  function addToDay(day, projectId, minutes) {
    var key = projectId || '';
    day.byProject[key] = (day.byProject[key] || 0) + minutes;
    day.total += minutes;
    return day;
  }

  /** 学习记录 -> { 日期: day } */
  function recordsDaily(state, mode) {
    var keep = projectFilter(state, mode);
    var map = {};
    (state.records || []).forEach(function (r) {
      if (!r || !U.isValidDateStr(r.date)) return;
      if (!keep(r.projectId)) return;
      var minutes = Math.max(0, Math.round(r.minutes || 0));
      if (!minutes) return;
      if (!map[r.date]) map[r.date] = emptyDay(r.date);
      addToDay(map[r.date], r.projectId, minutes);
    });
    return map;
  }

  /** 时间轴色块 -> { 日期: day } */
  function timelineDaily(state, mode) {
    var keep = projectFilter(state, mode);
    var map = {};
    var tl = state.timeline || {};
    Object.keys(tl).forEach(function (date) {
      if (!U.isValidDateStr(date)) return;
      var blocks = tl[date] || [];
      blocks.forEach(function (b) {
        if (!keep(b.projectId)) return;
        var minutes = blockMinutes(b);
        if (!minutes) return;
        if (!map[date]) map[date] = emptyDay(date);
        addToDay(map[date], b.projectId, minutes);
      });
    });
    return map;
  }

  function dailyMap(state, source, mode) {
    return source === 'timeline' ? timelineDaily(state, mode) : recordsDaily(state, mode);
  }

  function getDay(map, date) {
    return map[date] || emptyDay(date);
  }

  /** 某一天的合计（分钟） */
  function dayTotal(state, source, date, mode) {
    var map = dailyMap(state, source, mode);
    return getDay(map, date).total;
  }

  /** 一组日期的逐日数据（缺失日期补 0） */
  function rangeDays(state, source, dates, mode) {
    var map = dailyMap(state, source, mode);
    return dates.map(function (d) { return getDay(map, d); });
  }

  /* ---------------- 项目维度 ---------------- */

  /**
   * 指定日期范围内的项目合计，按时长倒序
   * @param {'all'|'study'|'nonstudy'} [mode] 项目过滤模式
   * @returns {Array<{projectId:string, minutes:number}>}
   */
  function projectTotals(state, source, dates, mode) {
    var acc = {};
    rangeDays(state, source, dates, mode).forEach(function (day) {
      Object.keys(day.byProject).forEach(function (pid) {
        acc[pid] = (acc[pid] || 0) + day.byProject[pid];
      });
    });
    return Object.keys(acc).map(function (pid) {
      return { projectId: pid, minutes: acc[pid] };
    }).sort(function (a, b) { return b.minutes - a.minutes; });
  }

  /** 全量累计（项目面板用），返回 { total, byProject } */
  function allTimeTotals(state, source, mode) {
    var byProject = {};
    var total = 0;
    var map = dailyMap(state, source, mode);
    Object.keys(map).forEach(function (d) {
      var day = map[d];
      total += day.total;
      Object.keys(day.byProject).forEach(function (pid) {
        byProject[pid] = (byProject[pid] || 0) + day.byProject[pid];
      });
    });
    return { total: total, byProject: byProject };
  }

  /* ---------------- 周统计（柱状图数据） ---------------- */

  /**
   * @param {object} state
   * @param {'records'|'timeline'} source
   * @param {string} anchorDate 本周内任意一天
   * @param {number} goal 每日目标分钟数，默认 6 小时
   * @param {'all'|'study'|'nonstudy'} [mode] 项目过滤模式，图表用 'study'
   */
  function weekStats(state, source, anchorDate, goal, mode) {
    var g = goal || U.DAILY_GOAL;
    var dates = U.weekDates(anchorDate, 1); // 周一为一周起点
    var days = rangeDays(state, source, dates, mode).map(function (d) {
      return {
        date: d.date,
        total: d.total,
        byProject: d.byProject,
        diff: d.total - g,
        hit: d.total >= g && d.total > 0
      };
    });
    var total = days.reduce(function (s, d) { return s + d.total; }, 0);
    var goalDays = days.filter(function (d) { return d.hit; }).length;
    var best = days.reduce(function (a, b) { return b.total > a.total ? b : a; }, days[0]);
    var activeDays = days.filter(function (d) { return d.total > 0; }).length;
    return {
      dates: dates,
      days: days,
      goal: g,
      total: total,
      average: Math.round(total / 7),
      activeAverage: activeDays ? Math.round(total / activeDays) : 0,
      goalDays: goalDays,
      activeDays: activeDays,
      max: days.reduce(function (m, d) { return Math.max(m, d.total); }, 0),
      best: best && best.total > 0 ? best : null,
      start: dates[0],
      end: dates[6],
      projectTotals: projectTotals(state, source, dates, mode)
    };
  }

  /* ---------------- 项目名称 / 颜色查询 ---------------- */

  var FALLBACK_PROJECT = { id: '', name: '未分类', color: '#9aa3b2' };

  function projectById(state, id) {
    var list = (state && state.projects) || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function projectMeta(state, id) {
    return projectById(state, id) || FALLBACK_PROJECT;
  }

  /** 该项目是否计入「学习时长」（默认计入；上课 / 额外睡眠 这类默认不计入） */
  function isStudyProject(state, id) {
    var p = projectById(state, id);
    return p ? p.countsAsStudy !== false : true;
  }

  /**
   * 生成项目过滤器
   * @param {object} state
   * @param {'all'|'study'|'nonstudy'} mode
   * @returns {(projectId:string)=>boolean}
   */
  function projectFilter(state, mode) {
    if (!mode || mode === 'all') return function () { return true; };
    var off = {};
    ((state && state.projects) || []).forEach(function (p) {
      if (p.countsAsStudy === false) off[p.id] = 1;
    });
    /* 说明：未知 / 已删除项目的遗留数据一律算「学习」，避免老数据凭空消失 */
    if (mode === 'study') return function (pid) { return !off[pid]; };
    return function (pid) { return !!off[pid]; };
  }

  /** 按过滤器裁剪一天的数据（供外部按天过滤时复用） */
  function filterDay(day, keep) {
    var byProject = {};
    var total = 0;
    Object.keys(day.byProject).forEach(function (pid) {
      if (!keep(pid)) return;
      byProject[pid] = day.byProject[pid];
      total += day.byProject[pid];
    });
    return { date: day.date, total: total, byProject: byProject };
  }

  /* ---------------- 夜间睡眠（手动输入） ---------------- */

  function sleepEntry(state, date) {
    return (state && state.sleep && state.sleep[date]) || null;
  }

  function sleepMinutes(state, date) {
    var e = sleepEntry(state, date);
    return e ? (e.duration || 0) : 0;
  }

  /** "YYYY-MM" -> 当月每晚 [{ date, minutes, entry }]（没记录的晚上 minutes = 0） */
  function sleepMonth(state, month) {
    var m = /^(\d{4})-(\d{2})$/.exec(String(month || ''));
    var now = new Date();
    var year = m ? +m[1] : now.getFullYear();
    var mo = m ? U.clamp(+m[2], 1, 12) : now.getMonth() + 1;
    var dayCount = new Date(year, mo, 0).getDate();
    var out = [];
    for (var i = 1; i <= dayCount; i++) {
      var date = year + '-' + U.pad2(mo) + '-' + U.pad2(i);
      var e = sleepEntry(state, date);
      out.push({ date: date, minutes: e ? e.duration : 0, entry: e });
    }
    return out;
  }

  /** 当月睡眠小结：记录了几晚、总时长、平均、最长的一晚 */
  function sleepSummary(state, month) {
    var list = sleepMonth(state, month).filter(function (d) { return d.minutes > 0; });
    var total = list.reduce(function (s, d) { return s + d.minutes; }, 0);
    var best = list.reduce(function (a, b) { return b.minutes > a.minutes ? b : a; },
      { date: null, minutes: 0 });
    return {
      nights: list.length,
      total: total,
      average: list.length ? Math.round(total / list.length) : 0,
      best: best.minutes > 0 ? best : null
    };
  }

  /** 当月里有睡眠记录的日期 -> 分钟数（日历打点用） */
  function sleepDates(state, month) {
    var map = {};
    sleepMonth(state, month).forEach(function (d) {
      if (d.minutes > 0) map[d.date] = d.minutes;
    });
    return map;
  }

  return {
    blockMinutes: blockMinutes,
    clampBlockRange: clampBlockRange,
    findConflicts: findConflicts,
    assignLanes: assignLanes,
    mergeBlockInto: mergeBlockInto,
    emptyDay: emptyDay,
    recordsDaily: recordsDaily,
    timelineDaily: timelineDaily,
    dailyMap: dailyMap,
    getDay: getDay,
    dayTotal: dayTotal,
    rangeDays: rangeDays,
    projectTotals: projectTotals,
    allTimeTotals: allTimeTotals,
    weekStats: weekStats,
    projectById: projectById,
    projectMeta: projectMeta,
    isStudyProject: isStudyProject,
    projectFilter: projectFilter,
    filterDay: filterDay,
    sleepEntry: sleepEntry,
    sleepMinutes: sleepMinutes,
    sleepMonth: sleepMonth,
    sleepSummary: sleepSummary,
    sleepDates: sleepDates,
    FALLBACK_PROJECT: FALLBACK_PROJECT
  };
});
