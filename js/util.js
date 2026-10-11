/* ============================================================
 * util.js —— 通用工具（纯函数，无副作用，可在 Node 中直接测试）
 * 时间约定：
 *   - 日期统一使用本地时区的 "YYYY-MM-DD" 字符串
 *   - 一天内的时刻统一使用「从 00:00 起的分钟数」（0 ~ 1440）
 * ============================================================ */
(function (root, factory) {
  var api = factory();
  root.StudyUtil = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /** 时间轴范围：6:00 – 24:00 */
  var DAY_START = 6 * 60;
  var DAY_END = 24 * 60;
  /** 拖拽 / 输入的最小粒度（分钟） */
  var SNAP = 5;
  /** 每日参照目标：6 小时 */
  var DAILY_GOAL = 6 * 60;

  var WEEKDAY_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function clamp(v, min, max) { return v < min ? min : (v > max ? max : v); }

  var uidSeed = 0;
  function uid(prefix) {
    uidSeed += 1;
    return (prefix || 'id') + '_' + Date.now().toString(36) + '_' +
      uidSeed.toString(36) + Math.random().toString(36).slice(2, 6);
  }

  /* ---------------- 日期 ---------------- */

  function toDateStr(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function isValidDateStr(s) {
    return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && parseDateStr(s) !== null;
  }

  /** "2025-12-09" -> 本地时区当天 0 点的 Date；非法返回 null（例如 2025-02-31） */
  function parseDateStr(s) {
    if (typeof s !== 'string') return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) return null;
    var y = +m[1], mo = +m[2], d = +m[3];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    var date = new Date(y, mo - 1, d);
    if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
    return date;
  }

  function todayStr() { return toDateStr(new Date()); }

  function addDays(date, n) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + n);
  }

  function addDaysStr(dateStr, n) {
    var d = parseDateStr(dateStr);
    return d ? toDateStr(addDays(d, n)) : dateStr;
  }

  /** 相差天数（b - a），忽略时分秒 */
  function diffDays(a, b) {
    var ms = parseDateStr(b).getTime() - parseDateStr(a).getTime();
    return Math.round(ms / 86400000);
  }

  /**
   * 周一为一周的第一天
   * @param {Date} date
   * @param {number} weekStart 0=周日, 1=周一
   */
  function startOfWeek(date, weekStart) {
    var ws = (weekStart === undefined) ? 1 : weekStart;
    var diff = (date.getDay() - ws + 7) % 7;
    return addDays(date, -diff);
  }

  function weekDates(anchorStr, weekStart) {
    var d = parseDateStr(anchorStr) || new Date();
    var start = startOfWeek(d, weekStart);
    var out = [];
    for (var i = 0; i < 7; i++) out.push(toDateStr(addDays(start, i)));
    return out;
  }

  function weekdayName(dateStr) {
    var d = parseDateStr(dateStr);
    return d ? WEEKDAY_CN[d.getDay()] : '';
  }

  /** "12-09 周一" */
  function formatDateCN(dateStr) {
    var d = parseDateStr(dateStr);
    if (!d) return dateStr;
    return pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + WEEKDAY_CN[d.getDay()];
  }

  /* ---------------- 时长格式化 ---------------- */

  /** 90 -> "1小时30分"；45 -> "45分"；0 -> "0分" */
  function formatMinutes(min) {
    var m = Math.max(0, Math.round(min || 0));
    var h = Math.floor(m / 60), r = m % 60;
    if (h && r) return h + '小时' + r + '分';
    if (h) return h + '小时';
    return r + '分';
  }

  /** 90 -> "1.5h"（图表标签用，去掉多余的 .0） */
  function formatHours(min) {
    var v = Math.round((min || 0) / 6) / 10; // 保留 1 位小数
    return (Math.abs(v - Math.round(v)) < 1e-9 ? String(Math.round(v)) : v.toFixed(1)) + 'h';
  }

  /** 毫秒 -> "05:00"（倒计时用，不足 1 秒向上取整，保证从 05:00 开始倒数） */
  function formatMMSS(ms) {
    var total = Math.max(0, Math.ceil((ms || 0) / 1000));
    var m = Math.floor(total / 60), s = total % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  /** 90 -> "1小时30分钟"（通知与提示文案用："5分" 在系统通知里容易被当成「5 分」） */
  function formatMinutesLong(min) {
    var m = Math.max(0, Math.round(min || 0));
    var h = Math.floor(m / 60), r = m % 60;
    if (h && r) return h + '小时' + r + '分钟';
    if (h) return h + '小时';
    return r + '分钟';
  }

  /** 570 -> "09:30" */
  function minutesToHHMM(min) {
    var m = Math.round(min || 0);
    var h = Math.floor(m / 60), r = m % 60;
    if (h >= 24) { h = 24; r = 0; }
    return pad2(h) + ':' + pad2(r);
  }

  /** "09:30" -> 570；非法返回 null */
  function hhmmToMinutes(s) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim());
    if (!m) return null;
    var h = +m[1], mi = +m[2];
    if (h > 24 || mi > 59) return null;
    if (h === 24 && mi !== 0) return null;
    return h * 60 + mi;
  }

  function snapMinutes(min, step) {
    var s = step || SNAP;
    return Math.round(min / s) * s;
  }

  /* ---------------- 颜色 / 文本 ---------------- */

  var HEX_RE = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;
  function normalizeHex(hex, fallback) {
    if (typeof hex !== 'string') return fallback || '#4f7cff';
    var v = hex.trim();
    var m = HEX_RE.exec(v);
    if (m) {
      var body = m[1];
      if (body.length === 3) body = body[0] + body[0] + body[1] + body[1] + body[2] + body[2];
      return '#' + body.toLowerCase();
    }
    return fallback || '#4f7cff';
  }

  function rgba(hex, alpha) {
    var v = normalizeHex(hex, '#4f7cff').slice(1);
    var r = parseInt(v.slice(0, 2), 16), g = parseInt(v.slice(2, 4), 16), b = parseInt(v.slice(4, 6), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
  }

  /** 根据背景色亮度选择黑或白的文字颜色 */
  function readableTextColor(hex) {
    var v = normalizeHex(hex, '#4f7cff').slice(1);
    var r = parseInt(v.slice(0, 2), 16), g = parseInt(v.slice(2, 4), 16), b = parseInt(v.slice(4, 6), 16);
    var lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return lum > 0.62 ? '#1e2430' : '#ffffff';
  }

  function escapeHtml(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function debounce(fn, wait) {
    var t = null;
    return function () {
      var args = arguments, self = this;
      if (t) clearTimeout(t);
      t = setTimeout(function () { t = null; fn.apply(self, args); }, wait || 200);
    };
  }

  /* ---------------- 倒计时 ---------------- */

  /**
   * 计算距离目标时间的剩余量
   * @returns {{over:boolean, days:number, hours:number, minutes:number, seconds:number, totalMs:number}}
   */
  function splitDuration(ms) {
    var over = ms <= 0;
    var t = Math.floor(Math.abs(ms) / 1000);
    var days = Math.floor(t / 86400); t -= days * 86400;
    var hours = Math.floor(t / 3600); t -= hours * 3600;
    var minutes = Math.floor(t / 60);
    var seconds = t - minutes * 60;
    return { over: over, days: days, hours: hours, minutes: minutes, seconds: seconds, totalMs: ms };
  }

  /** 解析 datetime-local 的值 "2025-12-20T08:30" */
  function parseLocalDateTime(s) {
    if (typeof s !== 'string') return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?$/.exec(s.trim());
    if (!m) return null;
    var date = parseDateStr(m[1] + '-' + m[2] + '-' + m[3]);
    if (!date) return null;
    var h = m[4] === undefined ? 0 : +m[4];
    var mi = m[5] === undefined ? 0 : +m[5];
    if (h > 23 || mi > 59) return null;
    date.setHours(h, mi, 0, 0);
    return date;
  }

  /** Date -> "2025-12-20T08:30"（用于 input[type=datetime-local]） */
  function toLocalDateTimeInput(date) {
    return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate()) +
      'T' + pad2(date.getHours()) + ':' + pad2(date.getMinutes());
  }

  return {
    DAY_START: DAY_START,
    DAY_END: DAY_END,
    SNAP: SNAP,
    DAILY_GOAL: DAILY_GOAL,
    WEEKDAY_CN: WEEKDAY_CN,
    pad2: pad2,
    clamp: clamp,
    uid: uid,
    toDateStr: toDateStr,
    isValidDateStr: isValidDateStr,
    parseDateStr: parseDateStr,
    todayStr: todayStr,
    addDays: addDays,
    addDaysStr: addDaysStr,
    diffDays: diffDays,
    startOfWeek: startOfWeek,
    weekDates: weekDates,
    weekdayName: weekdayName,
    formatDateCN: formatDateCN,
    formatMinutes: formatMinutes,
    formatHours: formatHours,
    formatMMSS: formatMMSS,
    formatMinutesLong: formatMinutesLong,
    minutesToHHMM: minutesToHHMM,
    hhmmToMinutes: hhmmToMinutes,
    snapMinutes: snapMinutes,
    normalizeHex: normalizeHex,
    rgba: rgba,
    readableTextColor: readableTextColor,
    escapeHtml: escapeHtml,
    debounce: debounce,
    splitDuration: splitDuration,
    parseLocalDateTime: parseLocalDateTime,
    toLocalDateTimeInput: toLocalDateTimeInput
  };
});
