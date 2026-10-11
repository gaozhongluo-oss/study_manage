/* ============================================================
 * store.js —— 数据层：默认值、校验、localStorage 持久化、业务操作
 *
 * 用法：
 *   StudyStore.init();                 // 读取本地数据并开启自动保存
 *   StudyStore.subscribe(fn);          // 数据变化后统一重绘
 *   StudyStore.addRecord({...});       // 业务操作，内部自动保存 + 通知
 *
 * 数据结构（localStorage 键：study-tracker.state.v1）：
 * {
 *   version: 1,
 *   quote:     { text, fontSize },
 *   countdown: { title, target },               // target: "YYYY-MM-DDTHH:mm"
 *   projects:  [{ id, name, color }],           // 最多 5 个
 *   records:   [{ id, projectId, date, minutes, note, createdAt }],
 *   timeline:  { "YYYY-MM-DD": [{ id, projectId, start, end, note }] },
 *   timer:     { projectId, durationMin, status, round, roundStart, promptUntil },
 *              // status: 'idle' | 'running' | 'prompt'；roundStart / promptUntil 为 epoch 毫秒
 *   timerLog:  [{ id, projectId, date, minutes, startAt, endAt, createdAt }],  // 已完成的番茄轮次
 *   settings:  { statsSource },
 *   ui:        { tlMode, tlDate, weekAnchor, recFilter, recProjectId, tlProjectId }
 * }
 * ============================================================ */
(function (root, factory) {
  var U = root.StudyUtil || (typeof require === 'function' ? require('./util.js') : null);
  var S = root.StudyStats || (typeof require === 'function' ? require('./stats.js') : null);
  var api = factory(root, U, S);
  root.StudyStore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root, U, S) {
  'use strict';

  var STORAGE_KEY = 'study-tracker.state.v1';
  var VERSION = 1;
  var MAX_PROJECTS = 7;   // 5 个学习项目 + 上课 / 额外睡眠 这类不计入学习时长的项目

  /* 番茄计时器常量 */
  var TIMER_MIN_MINUTES = 5;        // 单轮最短 5 分钟（与时间轴 5 分钟粒度一致）
  var TIMER_MAX_MINUTES = 180;
  var TIMER_DEFAULT_MINUTES = 5;
  var TIMER_PROMPT_MS = 10 * 1000;  // 「是否还在学习？」停留 10 秒
  var TIMER_STALE_MS = 12 * 3600 * 1000;  // 超过 12 小时的 running 状态视为陈旧，恢复时直接丢弃
  var TIMER_LOG_MAX = 500;

  var DEFAULT_QUOTE = '今天多做一点点，明天就会轻松一点点。';
  var COLOR_PALETTE = ['#4f7cff', '#12b886', '#f59f00', '#9c36b5', '#e8590c', '#0ca678', '#e5484d', '#3b5bdb'];

  /* 初始项目：前 5 个计入学习时长；上课 / 额外睡眠 只做时间记录，不计入学习时长 */
  var DEFAULT_PROJECTS = [
    { name: '专业课程', color: '#4f7cff', countsAsStudy: true },
    { name: '编程实践', color: '#12b886', countsAsStudy: true },
    { name: '英语提升', color: '#f59f00', countsAsStudy: true },
    { name: '阅读输入', color: '#9c36b5', countsAsStudy: true },
    { name: '复盘整理', color: '#e8590c', countsAsStudy: true },
    { name: '上课', color: '#1098ad', countsAsStudy: false },
    { name: '额外睡眠', color: '#868e96', countsAsStudy: false }
  ];

  /* ---------------- 默认状态 ---------------- */

  function defaultCountdown() {
    var d = U.addDays(new Date(), 100);
    d.setHours(8, 30, 0, 0);
    return { title: '我的目标日', target: U.toLocalDateTimeInput(d) };
  }

  function defaultState() {
    return {
      version: VERSION,
      quote: { text: DEFAULT_QUOTE, fontSize: 28 },
      countdown: defaultCountdown(),
      projects: DEFAULT_PROJECTS.map(function (p, i) {
        return { id: 'p' + (i + 1), name: p.name, color: p.color, countsAsStudy: p.countsAsStudy !== false };
      }),
      records: [],
      timeline: {},
      timer: {
        projectId: null,
        durationMin: TIMER_DEFAULT_MINUTES,
        status: 'idle',
        round: 1,
        roundStart: null,
        promptUntil: null
      },
      timerLog: [],
      /* 夜间睡眠：key 为「入睡当晚」的日期，bed/wake 为当天分钟数（跨午夜自动算），duration 由两者推出 */
      sleep: {},
      settings: { statsSource: 'records', notify: true, sound: true, popup: true },
      ui: {
        tlMode: 'day',
        tlDate: U.todayStr(),
        weekAnchor: U.todayStr(),
        recFilter: 'week',
        recProjectId: null,
        tlProjectId: null,
        sleepDate: U.todayStr()
      }
    };
  }

  /* ---------------- 校验 / 归一化 ---------------- */

  function asString(v, fallback, maxLen) {
    if (typeof v !== 'string') return fallback;
    var s = v.replace(/\s+$/, '');
    if (maxLen && s.length > maxLen) s = s.slice(0, maxLen);
    return s;
  }

  function uniqueId(existing, prefix) {
    var id;
    do { id = U.uid(prefix); } while (existing.indexOf(id) !== -1);
    return id;
  }

  /** 合法的毫秒时间戳（用于计时器的 roundStart / promptUntil） */
  function isFiniteTs(v) {
    var n = Number(v);
    return isFinite(n) && n > 0;
  }

  /**
   * 把任意来源的数据（本地存档 / 导入的 JSON）整理成合法状态
   * 说明：所有非法字段都会被安全地替换为默认值，保证页面不会因为坏数据崩溃。
   */
  function normalizeState(raw) {
    var def = defaultState();
    var out = defaultState();
    if (!raw || typeof raw !== 'object') return out;

    /* 激励语 */
    if (raw.quote && typeof raw.quote === 'object') {
      out.quote.text = asString(raw.quote.text, def.quote.text, 200);
      var fs = Number(raw.quote.fontSize);
      out.quote.fontSize = isFinite(fs) ? U.clamp(Math.round(fs), 16, 56) : def.quote.fontSize;
    }

    /* 倒计时 */
    if (raw.countdown && typeof raw.countdown === 'object') {
      out.countdown.title = asString(raw.countdown.title, def.countdown.title, 30) || def.countdown.title;
      var dt = U.parseLocalDateTime(raw.countdown.target);
      out.countdown.target = dt ? U.toLocalDateTimeInput(dt) : def.countdown.target;
    }

    /* 项目 */
    var usedIds = [];
    var projects = [];
    var rawProjects = Array.isArray(raw.projects) ? raw.projects : [];
    rawProjects.forEach(function (p) {
      if (projects.length >= MAX_PROJECTS) return;
      if (!p || typeof p !== 'object') return;
      var name = asString(p.name, '', 12).trim();
      var id = asString(p.id, '', 60);
      if (!id || usedIds.indexOf(id) !== -1) id = uniqueId(usedIds, 'p');
      usedIds.push(id);
      projects.push({
        id: id,
        name: name || ('项目 ' + (projects.length + 1)),
        color: U.normalizeHex(p.color, COLOR_PALETTE[projects.length % COLOR_PALETTE.length]),
        countsAsStudy: p.countsAsStudy !== false
      });
    });
    out.projects = projects.length ? projects : def.projects;

    var fallbackPid = out.projects[0].id;
    function fixPid(pid) {
      var s = asString(pid, '', 60);
      for (var i = 0; i < out.projects.length; i++) if (out.projects[i].id === s) return s;
      return fallbackPid;
    }

    /* 学习记录 */
    var recIds = [];
    (Array.isArray(raw.records) ? raw.records : []).forEach(function (r) {
      if (!r || typeof r !== 'object') return;
      if (!U.isValidDateStr(r.date)) return;
      var minutes = Math.round(Number(r.minutes));
      if (!isFinite(minutes) || minutes <= 0) return;
      minutes = U.clamp(minutes, 1, 24 * 60);
      var id = asString(r.id, '', 60);
      if (!id || recIds.indexOf(id) !== -1) id = uniqueId(recIds, 'r');
      recIds.push(id);
      out.records.push({
        id: id,
        projectId: fixPid(r.projectId),
        date: r.date,
        minutes: minutes,
        note: asString(r.note, '', 60),
        createdAt: asString(r.createdAt, '', 40) || new Date().toISOString()
      });
    });
    out.records.sort(function (a, b) {
      return a.date === b.date ? String(b.createdAt).localeCompare(String(a.createdAt))
                               : (a.date < b.date ? 1 : -1);
    });

    /* 时间轴 */
    var tl = (raw.timeline && typeof raw.timeline === 'object') ? raw.timeline : {};
    var blockIds = [];
    Object.keys(tl).forEach(function (date) {
      if (!U.isValidDateStr(date)) return;
      var list = Array.isArray(tl[date]) ? tl[date] : [];
      var blocks = [];
      list.forEach(function (b) {
        if (!b || typeof b !== 'object') return;
        var start = Number(b.start), end = Number(b.end);
        if (!isFinite(start) || !isFinite(end)) return;
        var range = S.clampBlockRange(start, end);
        var id = asString(b.id, '', 60);
        if (!id || blockIds.indexOf(id) !== -1) id = uniqueId(blockIds, 'b');
        blockIds.push(id);
        blocks.push({
          id: id,
          projectId: fixPid(b.projectId),
          start: range.start,
          end: range.end,
          note: asString(b.note, '', 60)
        });
      });
      blocks.sort(function (a, b) { return a.start - b.start || a.end - b.end; });
      if (blocks.length) out.timeline[date] = blocks;
    });

    /* 统计来源 */
    if (raw.settings && typeof raw.settings === 'object') {
      out.settings.statsSource = raw.settings.statsSource === 'timeline' ? 'timeline' : 'records';
      /* 提醒方式：缺省视为开启 */
      out.settings.notify = raw.settings.notify !== false;
      out.settings.sound = raw.settings.sound !== false;
      out.settings.popup = raw.settings.popup !== false;
    }

    /* 番茄计时器状态 */
    var t = (raw.timer && typeof raw.timer === 'object') ? raw.timer : {};
    var dur = Math.round(Number(t.durationMin));
    out.timer.durationMin = isFinite(dur)
      ? U.clamp(dur, TIMER_MIN_MINUTES, TIMER_MAX_MINUTES) : TIMER_DEFAULT_MINUTES;
    out.timer.projectId = (typeof t.projectId === 'string' && t.projectId) ? fixPid(t.projectId) : null;
    out.timer.status = (t.status === 'running' || t.status === 'prompt') ? t.status : 'idle';
    var round = Math.round(Number(t.round));
    out.timer.round = (isFinite(round) && round > 0) ? Math.min(round, 9999) : 1;
    out.timer.roundStart = isFiniteTs(t.roundStart) ? Number(t.roundStart) : null;
    out.timer.promptUntil = isFiniteTs(t.promptUntil) ? Number(t.promptUntil) : null;
    if (out.timer.status === 'running' && out.timer.roundStart === null) out.timer.status = 'idle';
    if (out.timer.status === 'prompt' && out.timer.promptUntil === null) out.timer.status = 'idle';
    if (out.timer.status === 'idle') { out.timer.roundStart = null; out.timer.promptUntil = null; }

    /* 番茄轮次记录（完成的计时） */
    var logIds = [];
    (Array.isArray(raw.timerLog) ? raw.timerLog : []).forEach(function (r) {
      if (!r || typeof r !== 'object') return;
      if (!U.isValidDateStr(r.date)) return;
      var minutes = Math.round(Number(r.minutes));
      if (!isFinite(minutes) || minutes <= 0) return;
      var id = asString(r.id, '', 60);
      if (!id || logIds.indexOf(id) !== -1) id = uniqueId(logIds, 't');
      logIds.push(id);
      out.timerLog.push({
        id: id,
        projectId: fixPid(r.projectId),
        date: r.date,
        minutes: U.clamp(minutes, 1, TIMER_MAX_MINUTES),
        startAt: isFiniteTs(r.startAt) ? Number(r.startAt) : null,
        endAt: isFiniteTs(r.endAt) ? Number(r.endAt) : null,
        createdAt: asString(r.createdAt, '', 40) || new Date().toISOString()
      });
    });
    out.timerLog.sort(function (a, b) {
      return String(b.createdAt).localeCompare(String(a.createdAt));
    });
    if (out.timerLog.length > TIMER_LOG_MAX) out.timerLog.length = TIMER_LOG_MAX;

    /* 夜间睡眠记录：每晚一条，手动输入入睡/起床时间 */
    var sl = (raw.sleep && typeof raw.sleep === 'object') ? raw.sleep : {};
    Object.keys(sl).forEach(function (date) {
      if (!U.isValidDateStr(date)) return;
      var e = sl[date];
      if (!e || typeof e !== 'object') return;
      var bed = Math.round(Number(e.bed));
      var wake = Math.round(Number(e.wake));
      if (!isFinite(bed) || !isFinite(wake)) return;
      bed = ((bed % 1440) + 1440) % 1440;                   // 入睡时刻：0:00–23:59
      wake = ((wake % 1440) + 1440) % 1440;                 // 起床时刻：0:00–23:59
      var duration = (wake - bed + 1440) % 1440;            // 跨午夜自动绕回
      if (duration <= 0) return;                            // 起止相同 → 视为无效记录
      out.sleep[date] = {
        bed: bed,
        wake: wake,
        duration: duration,
        note: asString(e.note, '', 40)
      };
    });

    /* 界面状态 */
    if (raw.ui && typeof raw.ui === 'object') {
      out.ui.tlMode = raw.ui.tlMode === 'week' ? 'week' : 'day';
      out.ui.tlDate = U.isValidDateStr(raw.ui.tlDate) ? raw.ui.tlDate : U.todayStr();
      out.ui.weekAnchor = U.isValidDateStr(raw.ui.weekAnchor) ? raw.ui.weekAnchor : U.todayStr();
      out.ui.recFilter = raw.ui.recFilter === 'all' ? 'all' : 'week';
      out.ui.recProjectId = (typeof raw.ui.recProjectId === 'string' && raw.ui.recProjectId) ? fixPid(raw.ui.recProjectId) : null;
      out.ui.tlProjectId = (typeof raw.ui.tlProjectId === 'string' && raw.ui.tlProjectId) ? fixPid(raw.ui.tlProjectId) : null;
      out.ui.sleepDate = U.isValidDateStr(raw.ui.sleepDate) ? raw.ui.sleepDate : U.todayStr();
    }

    return out;
  }

  /* ---------------- 存储适配 ---------------- */

  function memoryStorage() {
    var box = {};
    return {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(box, k) ? box[k] : null; },
      setItem: function (k, v) { box[k] = String(v); },
      removeItem: function (k) { delete box[k]; },
      __memory: true
    };
  }

  function pickStorage(explicit) {
    if (explicit) return explicit;
    try {
      var ls = root.localStorage;
      var probe = '__study_probe__';
      ls.setItem(probe, '1');
      ls.removeItem(probe);
      return ls;
    } catch (e) {
      return memoryStorage();
    }
  }

  /* ---------------- Store 实例 ---------------- */

  var listeners = [];
  var storage = null;
  var state = defaultState();
  var saveTimer = null;
  var dirty = false;

  function notify(reason) {
    listeners.slice().forEach(function (fn) {
      try { fn(state, reason); } catch (e) {
        if (root.console) root.console.error('[store] 订阅者执行出错:', e);
      }
    });
  }

  function persistNow() {
    if (!storage) return true;
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    dirty = false;
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(state));
      return true;
    } catch (e) {
      if (root.console) root.console.warn('[store] 保存失败:', e);
      return false;
    }
  }

  var persistSoon = U.debounce(function () {
    if (dirty) persistNow();
  }, 150);

  function requestPersist() {
    dirty = true;
    persistSoon();
  }

  /**
   * 统一入口：修改状态 -> 保存 -> 通知界面重绘
   *
   * 落盘时机按 reason 区分：
   *   - 真实数据变更（记录 / 时间段 / 项目 / 倒计时…）→ 立刻同步落盘，避免关页面丢数据
   *   - 高频输入（激励语文字、字号、界面导航）→ 防抖落盘，避免每敲一个字都写一次 localStorage
   * @param {(s:object)=>void} mutator
   * @param {string} reason 重绘原因，界面可据此做局部优化
   */
  var PERSIST_NOW_REASONS = {
    records: 1, timeline: 1, projects: 1, countdown: 1, timer: 1, 'timer-config': 1,
    sleep: 1, settings: 1, 'quote-reset': 1, import: 1, reset: 1
  };

  function update(mutator, reason) {
    var result = mutator(state);
    state = normalizeState(state);
    if (PERSIST_NOW_REASONS[reason]) persistNow();
    else requestPersist();
    notify(reason || 'update');
    return result;
  }

  var Store = {
    STORAGE_KEY: STORAGE_KEY,
    MAX_PROJECTS: MAX_PROJECTS,
    DEFAULT_QUOTE: DEFAULT_QUOTE,
    COLOR_PALETTE: COLOR_PALETTE,
    defaultState: defaultState,
    normalizeState: normalizeState,

    /** 读取本地数据；storage 参数仅用于测试 */
    init: function (options) {
      var opts = options || {};
      storage = pickStorage(opts.storage);
      var raw = null;
      try {
        var text = storage.getItem(STORAGE_KEY);
        if (text) raw = JSON.parse(text);
      } catch (e) {
        if (root.console) root.console.warn('[store] 本地数据解析失败，已使用默认数据:', e);
      }
      state = normalizeState(raw);
      notify('init');
      // 关闭/切后台前立即落盘，避免防抖窗口内丢数据
      if (root.addEventListener) {
        root.addEventListener('beforeunload', persistNow);
        root.addEventListener('pagehide', persistNow);
        root.document && root.document.addEventListener('visibilitychange', function () {
          if (root.document.visibilityState === 'hidden') persistNow();
        });
      }
      return state;
    },

    get: function () { return state; },
    get isMemoryOnly() { return !!(storage && storage.__memory); },
    get maxProjects() { return MAX_PROJECTS; },

    subscribe: function (fn) {
      listeners.push(fn);
      return function () {
        var i = listeners.indexOf(fn);
        if (i !== -1) listeners.splice(i, 1);
      };
    },

    update: update,
    saveNow: persistNow,

    /* ---- 激励语 ---- */
    setQuoteText: function (text) {
      return update(function (s) { s.quote.text = asString(text, '', 200); }, 'quote');
    },
    setQuoteFontSize: function (size) {
      return update(function (s) {
        var n = Number(size);
        s.quote.fontSize = isFinite(n) ? U.clamp(Math.round(n), 16, 56) : s.quote.fontSize;
      }, 'quote-font');
    },
    resetQuote: function () {
      return update(function (s) { s.quote.text = DEFAULT_QUOTE; s.quote.fontSize = 28; }, 'quote-reset');
    },

    /* ---- 倒计时 ---- */
    setCountdown: function (patch) {
      return update(function (s) {
        if (patch && typeof patch.title === 'string') {
          s.countdown.title = asString(patch.title, '', 30) || '我的目标日';
        }
        if (patch && typeof patch.target === 'string') {
          var d = U.parseLocalDateTime(patch.target);
          if (d) s.countdown.target = U.toLocalDateTimeInput(d);
        }
      }, 'countdown');
    },

    /* ---- 项目 ---- */
    canAddProject: function () { return state.projects.length < MAX_PROJECTS; },

    addProject: function (name, color, countsAsStudy) {
      if (state.projects.length >= MAX_PROJECTS) return null;
      var used = state.projects.map(function (p) { return p.color; });
      var free = COLOR_PALETTE.filter(function (c) { return used.indexOf(c) === -1; });
      var newId = uniqueId(state.projects.map(function (p) { return p.id; }), 'p');
      update(function (s) {
        s.projects.push({
          id: newId,
          name: asString(name, '', 12).trim() || ('项目 ' + (s.projects.length + 1)),
          color: U.normalizeHex(color, free[0] || COLOR_PALETTE[s.projects.length % COLOR_PALETTE.length]),
          countsAsStudy: countsAsStudy !== false
        });
      }, 'projects');
      return newId;
    },

    updateProject: function (id, patch) {
      return update(function (s) {
        s.projects.forEach(function (p) {
          if (p.id !== id) return;
          if (patch && typeof patch.name === 'string') p.name = asString(patch.name, p.name, 12);
          if (patch && typeof patch.color === 'string') p.color = U.normalizeHex(patch.color, p.color);
          if (patch && patch.countsAsStudy !== undefined) p.countsAsStudy = patch.countsAsStudy !== false;
        });
      }, 'projects');
    },

    /**
     * 删除项目（至少保留 1 个）。该项目下的记录与时间轴色块会并入第一个剩余项目，
     * 以免时长统计凭空消失。
     */
    removeProject: function (id) {
      if (state.projects.length <= 1) return { ok: false, reason: 'last', moved: 0 };
      var target = state.projects.filter(function (p) { return p.id !== id; })[0];
      if (!target) return { ok: false, reason: 'missing', moved: 0 };
      var moved = 0;
      update(function (s) {
        s.projects = s.projects.filter(function (p) { return p.id !== id; });
        s.records.forEach(function (r) { if (r.projectId === id) { r.projectId = target.id; moved++; } });
        Object.keys(s.timeline).forEach(function (date) {
          s.timeline[date].forEach(function (b) { if (b.projectId === id) { b.projectId = target.id; moved++; } });
        });
        s.timerLog.forEach(function (r) { if (r.projectId === id) { r.projectId = target.id; moved++; } });
        if (s.timer.projectId === id) s.timer.projectId = target.id;
        if (s.ui.recProjectId === id) s.ui.recProjectId = target.id;
        if (s.ui.tlProjectId === id) s.ui.tlProjectId = target.id;
      }, 'projects');
      return { ok: true, moved: moved, targetName: target.name };
    },

    /* ---- 学习记录 ---- */
    addRecord: function (rec) {
      var date = U.isValidDateStr(rec.date) ? rec.date : U.todayStr();
      var minutes = U.clamp(Math.round(Number(rec.minutes) || 0), 1, 24 * 60);
      var newId = uniqueId(state.records.map(function (r) { return r.id; }), 'r');
      update(function (s) {
        s.records.unshift({
          id: newId,
          projectId: rec.projectId || s.projects[0].id,
          date: date,
          minutes: minutes,
          note: asString(rec.note, '', 60),
          createdAt: new Date().toISOString()
        });
      }, 'records');
      return newId;
    },

    updateRecord: function (id, patch) {
      return update(function (s) {
        s.records.forEach(function (r) {
          if (r.id !== id) return;
          if (patch && U.isValidDateStr(patch.date)) r.date = patch.date;
          if (patch && patch.minutes !== undefined) {
            var m = Math.round(Number(patch.minutes));
            if (isFinite(m) && m > 0) r.minutes = U.clamp(m, 1, 24 * 60);
          }
          if (patch && typeof patch.note === 'string') r.note = asString(patch.note, '', 60);
          if (patch && typeof patch.projectId === 'string') r.projectId = patch.projectId;
        });
        s.records.sort(function (a, b) {
          return a.date === b.date ? String(b.createdAt).localeCompare(String(a.createdAt))
                                   : (a.date < b.date ? 1 : -1);
        });
      }, 'records');
    },

    removeRecord: function (id) {
      return update(function (s) {
        s.records = s.records.filter(function (r) { return r.id !== id; });
      }, 'records');
    },

    /* ---- 时间轴 ---- */
    getBlocks: function (date) { return (state.timeline[date] || []).slice(); },

    addBlock: function (date, block) {
      if (!U.isValidDateStr(date)) return null;
      var range = S.clampBlockRange(block.start, block.end);
      var existing = [];
      Object.keys(state.timeline).forEach(function (d) {
        (state.timeline[d] || []).forEach(function (b) { existing.push(b.id); });
      });
      var newId = uniqueId(existing, 'b');
      update(function (s) {
        if (!s.timeline[date]) s.timeline[date] = [];
        s.timeline[date].push({
          id: newId,
          projectId: block.projectId || s.projects[0].id,
          start: range.start,
          end: range.end,
          note: asString(block.note, '', 60)
        });
        s.timeline[date].sort(function (a, b) { return a.start - b.start || a.end - b.end; });
      }, 'timeline');
      return newId;
    },

    updateBlock: function (date, id, patch) {
      return update(function (s) {
        var list = s.timeline[date];
        if (!list) return;
        list.forEach(function (b) {
          if (b.id !== id) return;
          if (patch && (patch.start !== undefined || patch.end !== undefined)) {
            var range = S.clampBlockRange(
              patch.start === undefined ? b.start : patch.start,
              patch.end === undefined ? b.end : patch.end
            );
            b.start = range.start; b.end = range.end;
          }
          if (patch && typeof patch.projectId === 'string') b.projectId = patch.projectId;
          if (patch && typeof patch.note === 'string') b.note = asString(patch.note, '', 60);
        });
        list.sort(function (a, b) { return a.start - b.start || a.end - b.end; });
      }, 'timeline');
    },

    removeBlock: function (date, id) {
      return update(function (s) {
        if (!s.timeline[date]) return;
        s.timeline[date] = s.timeline[date].filter(function (b) { return b.id !== id; });
        if (!s.timeline[date].length) delete s.timeline[date];
      }, 'timeline');
    },

    clearDay: function (date) {
      return update(function (s) { delete s.timeline[date]; }, 'timeline');
    },

    /* ---- 设置 / 界面状态 ---- */
    setStatsSource: function (source) {
      return update(function (s) { s.settings.statsSource = source === 'timeline' ? 'timeline' : 'records'; }, 'settings');
    },
    /** 到点提醒方式（提示音 / 系统通知 / 全局弹窗） */
    setRemindSettings: function (patch) {
      return update(function (s) {
        if (patch && patch.notify !== undefined) s.settings.notify = patch.notify !== false;
        if (patch && patch.sound !== undefined) s.settings.sound = patch.sound !== false;
        if (patch && patch.popup !== undefined) s.settings.popup = patch.popup !== false;
      }, 'settings');
    },
    setUI: function (patch, reason) {
      return update(function (s) {
        Object.keys(patch || {}).forEach(function (k) { s.ui[k] = patch[k]; });
      }, reason || 'ui');
    },

    /* ---- 番茄计时器 ---- */

    TIMER_MIN_MINUTES: TIMER_MIN_MINUTES,
    TIMER_MAX_MINUTES: TIMER_MAX_MINUTES,
    TIMER_DEFAULT_MINUTES: TIMER_DEFAULT_MINUTES,
    TIMER_PROMPT_MS: TIMER_PROMPT_MS,
    TIMER_STALE_MS: TIMER_STALE_MS,

    /** 选择项目 / 每轮时长 */
    setTimerConfig: function (patch) {
      return update(function (s) {
        if (patch && typeof patch.projectId === 'string') {
          if (S.projectById(s, patch.projectId)) s.timer.projectId = patch.projectId;
        }
        if (patch && patch.durationMin !== undefined) {
          var d = Math.round(Number(patch.durationMin));
          if (isFinite(d)) s.timer.durationMin = U.clamp(d, TIMER_MIN_MINUTES, TIMER_MAX_MINUTES);
        }
      }, 'timer-config');
    },

    /**
     * 开始新一轮（第 1 轮）
     * @param {number} [atMs] 指定本轮开始时间戳，默认取当前时间（便于测试/补录）
     */
    startTimer: function (atMs) {
      return update(function (s) {
        if (!S.projectById(s, s.timer.projectId)) s.timer.projectId = s.projects[0].id;
        s.timer.status = 'running';
        s.timer.round = 1;
        s.timer.roundStart = isFiniteTs(atMs) ? Number(atMs) : Date.now();
        s.timer.promptUntil = null;
      }, 'timer');
    },

    /** 停止 / 结束计时（不写入数据，仅清空计时状态） */
    stopTimer: function () {
      return update(function (s) {
        s.timer.status = 'idle';
        s.timer.roundStart = null;
        s.timer.promptUntil = null;
      }, 'timer');
    },

    /**
     * 点「继续」：开始下一轮
     * @param {number} [atMs] 指定本轮开始时间戳，默认取当前时间
     */
    continueTimer: function (atMs) {
      return update(function (s) {
        if (s.timer.status !== 'prompt') return;
        s.timer.status = 'running';
        s.timer.round = Math.min(s.timer.round + 1, 9999);
        s.timer.roundStart = isFiniteTs(atMs) ? Number(atMs) : Date.now();
        s.timer.promptUntil = null;
      }, 'timer');
    },

    /**
     * 结束一轮计时：把这一轮的实际时长写入当天时间轴，并记一条番茄记录。
     *   - 同项目、重叠或相接的色块会自动合并（保证时长不重复计算）
     *   - 不同项目的重叠交给时间轴泳道并排显示
     * @param {{prompt?:boolean, endAt?:number}} opts
     *        prompt: true = 自然到时（结束后弹出「是否还在学习？」）；
     *                false = 提前停止（直接回到 idle）
     *        endAt : 指定结束时间戳（补写离线期间完成的那一轮时用）
     * @returns {{ok:boolean, reason:string, date?:string, start?:number, end?:number,
     *            minutes?:number, merged?:boolean, mergedCount?:number, prompt?:boolean}}
     */
    finishRound: function (opts) {
      var o = opts || {};
      var res = { ok: false, reason: 'not-running' };
      update(function (s) {
        var t = s.timer;
        if (t.status !== 'running' || !t.roundStart) { res.reason = 'not-running'; return; }

        var startMs = t.roundStart;
        var plannedEnd = startMs + t.durationMin * 60000;
        var endMs = o.endAt ? Number(o.endAt) : Math.min(Date.now(), plannedEnd);
        var elapsedMin = Math.max(0, (endMs - startMs) / 60000);

        /* 先把计时状态收尾，任何分支都不会卡在 running */
        t.roundStart = null;
        if (o.prompt) {
          t.status = 'prompt';
          t.promptUntil = Date.now() + TIMER_PROMPT_MS;
        } else {
          t.status = 'idle';
          t.promptUntil = null;
        }

        /* 不足 5 分钟不写（时间轴最小粒度就是 5 分钟，避免虚增时长） */
        if (elapsedMin < U.SNAP - 0.001) {
          res.reason = 'too-short';
          res.minutes = Math.round(elapsedMin);
          return;
        }

        var startDate = new Date(startMs);
        var date = U.toDateStr(startDate);
        var start = U.snapMinutes(startDate.getHours() * 60 + startDate.getMinutes(), U.SNAP);
        if (start < U.DAY_START || start >= U.DAY_END) { res.reason = 'out-of-range'; return; }
        var end = Math.min(start + Math.round(elapsedMin), U.DAY_END);
        if (end - start < U.SNAP) { res.reason = 'too-short'; return; }

        var projectId = S.projectById(s, t.projectId) ? t.projectId : s.projects[0].id;
        var candidate = { id: U.uid('b'), projectId: projectId, start: start, end: end, note: '' };
        var merged = S.mergeBlockInto(s.timeline[date] || [], candidate);
        s.timeline[date] = merged.blocks;

        s.timerLog.unshift({
          id: U.uid('t'),
          projectId: projectId,
          date: date,
          minutes: end - start,
          startAt: startMs,
          endAt: endMs,
          createdAt: new Date().toISOString()
        });
        if (s.timerLog.length > TIMER_LOG_MAX) s.timerLog.length = TIMER_LOG_MAX;

        res.ok = true;
        res.reason = 'ok';
        res.date = date;
        res.start = start;
        res.end = end;
        res.minutes = end - start;
        res.merged = merged.merged;
        res.mergedCount = merged.mergedCount;
        res.prompt = !!o.prompt;
        res.promptMs = TIMER_PROMPT_MS;
      }, 'timer');
      return res;
    },

    /** 今日番茄统计（给计时面板显示） */
    todayTimerStats: function (date) {
      var d = date || U.todayStr();
      var rounds = 0, minutes = 0;
      state.timerLog.forEach(function (r) {
        if (r.date !== d) return;
        rounds++;
        minutes += r.minutes;
      });
      return { rounds: rounds, minutes: minutes };
    },

    /* ---- 夜间睡眠（手动输入） ---- */

    /**
     * 写入/更新一晚的睡眠
     * @param {string} date 入睡当晚的日期
     * @param {{bed:number, wake:number, note?:string}} patch bed/wake 为「从 00:00 起的分钟数」
     * @returns {{ok:boolean, reason?:string, duration?:number}}
     */
    setSleep: function (date, patch) {
      var res = { ok: false, reason: 'invalid-date' };
      if (!U.isValidDateStr(date)) return res;
      var bed = Math.round(Number(patch && patch.bed));
      var wake = Math.round(Number(patch && patch.wake));
      if (!isFinite(bed) || !isFinite(wake)) { res.reason = 'invalid-time'; return res; }
      bed = ((bed % 1440) + 1440) % 1440;
      wake = ((wake % 1440) + 1440) % 1440;
      var duration = (wake - bed + 1440) % 1440;
      if (duration <= 0) { res.reason = 'same-time'; return res; }

      update(function (s) {
        s.sleep[date] = {
          bed: bed,
          wake: wake,
          duration: duration,
          note: asString(patch && patch.note, '', 40)
        };
      }, 'sleep');
      res.ok = true;
      res.duration = duration;
      return res;
    },

    removeSleep: function (date) {
      return update(function (s) { delete s.sleep[date]; }, 'sleep');
    },

    getSleep: function (date) {
      return state.sleep[date] || null;
    },

    /* ---- 导入 / 导出 / 重置 ---- */
    exportJSON: function () {
      return JSON.stringify({
        app: 'study-tracker',
        version: VERSION,
        exportedAt: new Date().toISOString(),
        data: state
      }, null, 2);
    },

    /** @returns {{ok:boolean, error?:string, state?:object}} */
    importJSON: function (text, mode) {
      var parsed;
      try { parsed = JSON.parse(text); } catch (e) { return { ok: false, error: '不是合法的 JSON 文件' }; }
      var payload = (parsed && parsed.data) ? parsed.data : parsed;
      if (!payload || typeof payload !== 'object') return { ok: false, error: '文件内容不是有效的学习数据' };
      if (!Array.isArray(payload.projects) && !Array.isArray(payload.records)) {
        return { ok: false, error: '文件里没有 projects / records 字段，可能不是本工具导出的数据' };
      }
      var incoming = normalizeState(payload);
      if (mode === 'merge') {
        incoming = mergeStates(state, incoming);
      }
      state = incoming;
      persistNow();
      notify('import');
      return { ok: true, state: state };
    },

    reset: function () {
      state = defaultState();
      persistNow();
      notify('reset');
      return state;
    },

    /** 立即写入一次（测试用） */
    _flush: persistNow,
    _storageKey: STORAGE_KEY
  };

  /** 合并导入：同名项目复用，记录与色块按 id 去重后追加 */
  function mergeStates(current, incoming) {
    var merged = normalizeState(current);
    var pidMap = {};
    incoming.projects.forEach(function (p) {
      var hit = merged.projects.filter(function (q) { return q.name === p.name; })[0];
      if (hit) { pidMap[p.id] = hit.id; return; }
      if (merged.projects.length < MAX_PROJECTS) {
        var nid = uniqueId(merged.projects.map(function (q) { return q.id; }), 'p');
        merged.projects.push({ id: nid, name: p.name, color: p.color });
        pidMap[p.id] = nid;
      } else {
        pidMap[p.id] = merged.projects[0].id;
      }
    });
    var fb = merged.projects[0].id;
    var seenRec = merged.records.map(function (r) { return r.id; });
    incoming.records.forEach(function (r) {
      if (seenRec.indexOf(r.id) !== -1) return;
      seenRec.push(r.id);
      merged.records.push({
        id: r.id, projectId: pidMap[r.projectId] || fb, date: r.date,
        minutes: r.minutes, note: r.note, createdAt: r.createdAt
      });
    });
    var seenBlock = [];
    Object.keys(merged.timeline).forEach(function (d) {
      merged.timeline[d].forEach(function (b) { seenBlock.push(b.id); });
    });
    Object.keys(incoming.timeline).forEach(function (date) {
      incoming.timeline[date].forEach(function (b) {
        if (seenBlock.indexOf(b.id) !== -1) return;
        seenBlock.push(b.id);
        if (!merged.timeline[date]) merged.timeline[date] = [];
        merged.timeline[date].push({
          id: b.id, projectId: pidMap[b.projectId] || fb,
          start: b.start, end: b.end, note: b.note
        });
      });
      if (merged.timeline[date]) {
        merged.timeline[date].sort(function (a, b) { return a.start - b.start; });
      }
    });

    /* 番茄轮次记录也按 id 去重合并 */
    var seenTimer = merged.timerLog.map(function (r) { return r.id; });
    incoming.timerLog.forEach(function (r) {
      if (seenTimer.indexOf(r.id) !== -1) return;
      seenTimer.push(r.id);
      merged.timerLog.push({
        id: r.id, projectId: pidMap[r.projectId] || fb, date: r.date, minutes: r.minutes,
        startAt: r.startAt, endAt: r.endAt, createdAt: r.createdAt
      });
    });
    if (merged.timerLog.length > TIMER_LOG_MAX) merged.timerLog.length = TIMER_LOG_MAX;

    /* 睡眠记录：一晚一条，已有日期以本地数据为准 */
    Object.keys(incoming.sleep || {}).forEach(function (date) {
      if (!merged.sleep[date]) merged.sleep[date] = incoming.sleep[date];
    });
    return normalizeState(merged);
  }

  Store.mergeStates = mergeStates;
  return Store;
});
