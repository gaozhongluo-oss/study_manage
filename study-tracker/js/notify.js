/* ============================================================
 * notify.js —— 到点提醒的多通道广播
 *
 * 目标：人在别的软件里（浏览器不在前台、窗口被挡住、标签页在后台）也能收到提醒。
 * 通道（能用几个用几个，互不依赖）：
 *   1) 系统通知 Notification API —— Windows 上出现在屏幕右下角 + 通知中心
 *   2) 提示音 Web Audio      —— 不依赖通知权限，浏览器在后台也能出声
 *   3) 标签页标题闪烁 + 图标变红 —— 浏览器窗口可见但没聚焦时一眼就能看到
 *   4) 任务栏角标 setAppBadge —— 任务栏图标上出现红点（Windows 支持）
 *   5) 页面内弹窗（由 app.js 负责渲染）
 *
 * 顺带解决一个坑：浏览器会节流后台标签页的定时器（可能晚几十秒），
 * 所以计时进行中会播放一段约 -60dB 的「无声音频」保活，让页面被视为正在播放音频，
 * 避免被 Chrome 的 intensive throttling 拖慢到点提醒。
 * ============================================================ */
(function (root, factory) {
  var api = factory(root);
  root.StudyNotify = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var ICON_ALERT = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E" +
    "%3Crect width='32' height='32' rx='8' fill='%23e5484d'/%3E" +
    "%3Cpath d='M16 6a6.5 6.5 0 0 0-6.5 6.5V17l-2 3h17l-2-3v-4.5A6.5 6.5 0 0 0 16 6z' fill='white'/%3E" +
    "%3Ccircle cx='16' cy='24.5' r='2.6' fill='white'/%3E%3C/svg%3E";

  var doc = root.document || null;

  /* ---------------- 系统通知 ---------------- */

  var currentNotification = null;

  function permission() {
    if (typeof root.Notification === 'undefined') return 'unsupported';
    return root.Notification.permission || 'default';
  }

  /** 必须在用户手势里调用（浏览器要求） */
  function requestPermission(cb) {
    var done = false;
    function finish(res) {
      if (done) return;
      done = true;
      if (cb) cb(res);
    }
    if (typeof root.Notification === 'undefined') { finish('unsupported'); return; }
    if (root.Notification.permission !== 'default') { finish(root.Notification.permission); return; }
    try {
      var ret = root.Notification.requestPermission(function (res) { finish(res); });
      if (ret && typeof ret.then === 'function') ret.then(finish, function () { finish('denied'); });
    } catch (e) {
      finish('denied');
    }
  }

  /**
   * 弹一条系统通知
   * @param {{title:string, body:string, onClick?:Function, silent?:boolean}} opts
   * @returns {object|null} 通知对象（未授权/不支持时返回 null）
   */
  function show(opts) {
    closeNotification();
    var o = opts || {};
    if (permission() !== 'granted') return null;
    try {
      var n = new root.Notification(o.title || '提醒', {
        body: o.body || '',
        tag: o.tag || 'study-timer',
        requireInteraction: true,      // 停留在屏幕上，直到用户处理或我们主动关闭
        silent: !!o.silent,            // 自己放提示音，避免重复响两声
        icon: o.icon || ICON_ALERT
      });
      n.onclick = function () {
        try { if (root.focus) root.focus(); } catch (e) { /* 忽略 */ }
        try { if (n.close) n.close(); } catch (e) { /* 忽略 */ }
        if (o.onClick) o.onClick();
      };
      currentNotification = n;
      return n;
    } catch (e) {
      return null;
    }
  }

  function closeNotification() {
    if (currentNotification && currentNotification.close) {
      try { currentNotification.close(); } catch (e) { /* 忽略 */ }
    }
    currentNotification = null;
  }

  /* ---------------- 提示音（Web Audio） ---------------- */

  var audioCtx = null;
  var keepAliveNode = null;

  /** 在用户手势里调用一次，解锁音频（Chrome 的自动播放策略） */
  function ensureAudio() {
    if (audioCtx) {
      if (audioCtx.state === 'suspended' && audioCtx.resume) {
        try { audioCtx.resume(); } catch (e) { /* 忽略 */ }
      }
      return audioCtx;
    }
    var Ctx = root.AudioContext || root.webkitAudioContext;
    if (!Ctx) return null;
    try { audioCtx = new Ctx(); } catch (e) { audioCtx = null; }
    return audioCtx;
  }

  function tone(ctx, at, freq, dur, volume) {
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(volume, at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(at);
    osc.stop(at + dur + 0.02);
  }

  /**
   * 响几声「叮咚」
   * @param {number} times 0 表示不响
   * @returns {boolean} 是否成功安排播放
   */
  function chime(times) {
    var n = (times === undefined) ? 2 : times;
    if (n <= 0) return false;
    var ctx = ensureAudio();
    if (!ctx) return false;
    if (ctx.state === 'suspended' && ctx.resume) {
      try { ctx.resume(); } catch (e) { /* 忽略 */ }
    }
    var now = ctx.currentTime + 0.02;
    for (var i = 0; i < n; i++) {
      var at = now + i * 0.5;
      tone(ctx, at, 880, 0.18, 0.35);
      tone(ctx, at + 0.17, 1174.66, 0.22, 0.32);
    }
    return true;
  }

  /** 计时进行中：播放约 -60dB 的无声音频，避免后台定时器被过度节流 */
  function startKeepAlive() {
    var ctx = ensureAudio();
    if (!ctx || keepAliveNode) return false;
    try {
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 60;
      gain.gain.value = 0.001;          // 约 -60dB，实际听不到
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      keepAliveNode = { osc: osc, gain: gain };
      return true;
    } catch (e) {
      keepAliveNode = null;
      return false;
    }
  }

  function stopKeepAlive() {
    if (!keepAliveNode) return false;
    try {
      keepAliveNode.osc.stop();
      keepAliveNode.osc.disconnect();
      keepAliveNode.gain.disconnect();
    } catch (e) { /* 忽略 */ }
    keepAliveNode = null;
    return true;
  }

  function isKeepingAlive() { return !!keepAliveNode; }

  /* ---------------- 标题 / 图标 / 任务栏角标 ---------------- */

  var baseTitle = null;
  var baseIcon = null;
  var flashTimer = null;

  function iconLink() {
    return doc ? doc.querySelector('link[rel="icon"]') : null;
  }

  function setFavicon(alertOn) {
    var link = iconLink();
    if (!link) return;
    if (baseIcon === null) baseIcon = link.getAttribute('href');
    link.setAttribute('href', alertOn ? ICON_ALERT : baseIcon);
  }

  function setBadge(on) {
    try {
      if (on && root.navigator && root.navigator.setAppBadge) {
        var p = root.navigator.setAppBadge(1);
        if (p && p.catch) p.catch(function () { /* 不支持就算了 */ });
      } else if (!on && root.navigator && root.navigator.clearAppBadge) {
        var q = root.navigator.clearAppBadge();
        if (q && q.catch) q.catch(function () { /* 忽略 */ });
      }
    } catch (e) { /* 忽略 */ }
  }

  /**
   * 打开/关闭「求关注」状态：标题闪烁 + 图标变红 + 任务栏角标
   * @param {boolean} on
   * @param {string} text 闪烁时显示的标题
   */
  function setAttention(on, text) {
    if (!doc) return;
    if (baseTitle === null) baseTitle = doc.title;
    if (on) {
      var alt = text || '⏰ 该确认了！';
      doc.title = alt;
      if (!flashTimer) {
        var flip = false;
        flashTimer = setInterval(function () {
          flip = !flip;
          doc.title = flip ? baseTitle : alt;
        }, 1200);
      }
      setFavicon(true);
      setBadge(true);
    } else {
      if (flashTimer) { clearInterval(flashTimer); flashTimer = null; }
      doc.title = baseTitle || doc.title;
      setFavicon(false);
      setBadge(false);
    }
  }

  /** 页面重新可见 / 用户已处理提醒时，把标题图标恢复原样 */
  function isAttentionOn() { return !!flashTimer; }

  return {
    ICON_ALERT: ICON_ALERT,
    permission: permission,
    requestPermission: requestPermission,
    show: show,
    closeNotification: closeNotification,
    ensureAudio: ensureAudio,
    chime: chime,
    startKeepAlive: startKeepAlive,
    stopKeepAlive: stopKeepAlive,
    isKeepingAlive: isKeepingAlive,
    setAttention: setAttention,
    isAttentionOn: isAttentionOn,
    setBadge: setBadge
  };
});
