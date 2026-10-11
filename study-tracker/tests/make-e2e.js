/* ============================================================
 * tests/make-e2e.js —— 生成 tests/e2e.html（浏览器端交互自测页）
 *
 * 做法：读取 ../index.html，在应用脚本之前注入一段脚本：
 *   1) 把 localStorage 换成内存实现（不会污染真实数据）
 *   2) 页面加载完成后，用合成 PointerEvent 模拟拖拽、点击、表单提交，
 *      逐项断言，最后把结果写进页面里的 <pre id="e2eResults">
 *
 * 运行： node tests/make-e2e.js
 * 查看： 浏览器打开 tests/e2e.html（可看到 PASS/FAIL 列表）
 *        或者用无头浏览器 dump-dom 后搜 "E2E_DONE"
 * ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const srcPath = path.join(root, 'index.html');
const outPath = path.join(__dirname, 'e2e.html');

/* 注意：下面的注入脚本里不要出现反引号和 ${}，避免和外层模板字符串冲突 */
const injected = `
<script>
/* —— 交互自测专用：内存版 localStorage（不写入真实本地数据） —— */
(function () {
  var box = {};
  var mem = {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(box, k) ? box[k] : null; },
    setItem: function (k, v) { box[k] = String(v); },
    removeItem: function (k) { delete box[k]; },
    clear: function () { box = {}; },
    key: function () { return null; },
    length: 0
  };
  try {
    Object.defineProperty(window, 'localStorage', { value: mem, configurable: true });
  } catch (e) { window.localStorage = mem; }
})();

/* —— 用假的 Notification 记录系统通知调用（无头浏览器里没法真的弹系统通知） —— */
(function () {
  window.__notifications = [];
  function FakeNotification(title, opts) {
    opts = opts || {};
    this.title = title;
    this.body = opts.body || '';
    this.tag = opts.tag;
    this.requireInteraction = !!opts.requireInteraction;
    this.silent = !!opts.silent;
    this.closed = false;
    this.onclick = null;
    window.__notifications.push(this);
  }
  FakeNotification.prototype.close = function () { this.closed = true; };
  FakeNotification.permission = 'granted';
  FakeNotification.requestPermission = function (cb) {
    if (cb) cb('granted');
    return Promise.resolve('granted');
  };
  try { window.Notification = FakeNotification; } catch (e) { /* 忽略 */ }
})();

/* —— 假的 window.open：无头浏览器里不真的开窗口，只记录调用（全局浮窗用） —— */
(function () {
  window.__popups = [];
  window.open = function (url, name, features) {
    var w = {
      url: url, name: name, features: features, closed: false, focused: 0,
      focus: function () { this.focused++; },
      close: function () { this.closed = true; }
    };
    window.__popups.push(w);
    return w;
  };
})();

window.addEventListener('load', function () { setTimeout(runE2E, 30); });

function runE2E() {
  var results = [];
  var pass = 0, fail = 0;

  function check(label, cond, extra) {
    if (cond) { pass++; results.push('PASS | ' + label); }
    else { fail++; results.push('FAIL | ' + label + (extra ? '  →  ' + extra : '')); }
  }
  function q(sel) { return document.querySelector(sel); }
  function qa(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }

  var U = window.StudyUtil;
  var Store = window.StudyStore;

  function pe(type, target, x, y) {
    target.dispatchEvent(new PointerEvent(type, {
      clientX: x, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1,
      bubbles: true, cancelable: true, pointerId: 1, isPrimary: true, pointerType: 'mouse'
    }));
  }
  function dragCreate(x1, x2) {
    var track = q('.tl-track');
    var r = track.getBoundingClientRect();
    var y = r.top + r.height / 2;
    pe('pointerdown', track, x1(r), y);
    pe('pointermove', window, x2(r), y);
    pe('pointerup', window, x2(r), y);
  }
  var X = function (min) { return function (r) { return r.left + (min - 360) / 1080 * r.width; }; };
  function today() { return Store.get().ui.tlDate; }
  function blocks() { return Store.get().timeline[today()] || []; }

  /* ---------- 1. 时间轴：拖拽新建 ---------- */
  dragCreate(X(540), X(660));
  var b = blocks();
  check('拖拽新建 9:00–11:00', b.length === 1 && b[0].start === 540 && b[0].end === 660, JSON.stringify(b));

  var blockEl = q('.tl-block[data-id]');
  check('色块渲染到轨道上', !!blockEl && q('.tl-empty-note') === null);

  /* ---------- 2. 时间轴：整体拖动 ---------- */
  var r1 = q('.tl-track').getBoundingClientRect();
  pe('pointerdown', blockEl, X(600)(r1), r1.top + 10);
  pe('pointermove', window, X(720)(r1), r1.top + 10);
  pe('pointerup', window, X(720)(r1), r1.top + 10);
  b = blocks();
  check('拖动色块整体平移 2 小时', b[0].start === 660 && b[0].end === 780, JSON.stringify(b));

  /* ---------- 3. 时间轴：拖右边缘改结束时间 ---------- */
  var handle = q('.tl-block[data-id] .tl-handle.r');
  var r2 = q('.tl-track').getBoundingClientRect();
  pe('pointerdown', handle, X(780)(r2), r2.top + 10);
  pe('pointermove', window, X(840)(r2), r2.top + 10);
  pe('pointerup', window, X(840)(r2), r2.top + 10);
  b = blocks();
  check('拖右边缘延长到 14:00', b[0].start === 660 && b[0].end === 840, JSON.stringify(b));

  /* ---------- 4. 时间轴：单击打开编辑器并保存 ---------- */
  var el2 = q('.tl-block[data-id]');
  var r3 = q('.tl-track').getBoundingClientRect();
  pe('pointerdown', el2, X(700)(r3), r3.top + 10);
  pe('pointerup', window, X(700)(r3), r3.top + 10);
  check('单击色块弹出编辑器', q('#blockModal').hidden === false);
  check('编辑器带出当前起止时间', q('#blockStart').value === '11:00' && q('#blockEnd').value === '14:00',
    q('#blockStart').value + '-' + q('#blockEnd').value);

  var chips = qa('#blockProjectChips .chip');
  chips[1].click();
  q('#blockNote').value = '自测备注';
  q('#blockStart').value = '10:30';
  q('#blockEnd').value = '12:00';
  q('#blockSave').click();
  b = blocks();
  var expectPid = Store.get().projects[1].id;
  check('编辑器保存项目/时间/备注',
    q('#blockModal').hidden === true && b[0].start === 630 && b[0].end === 720 &&
    b[0].projectId === expectPid && b[0].note === '自测备注', JSON.stringify(b));

  /* ---------- 5. 时间轴：越界时间被拒绝 ---------- */
  var el3 = q('.tl-block[data-id]');
  pe('pointerdown', el3, X(700)(r3), r3.top + 10);
  pe('pointerup', window, X(700)(r3), r3.top + 10);
  q('#blockStart').value = '05:00';
  q('#blockSave').click();
  check('早于 6:00 的时间被拦截', q('#blockErr').hidden === false && blocks()[0].start === 630,
    q('#blockErr').textContent);
  q('#blockStart').value = '10:30';
  q('#blockSave').click();

  /* ---------- 6. 时间轴：删除 ---------- */
  var el4 = q('.tl-block[data-id]');
  pe('pointerdown', el4, X(700)(r3), r3.top + 10);
  pe('pointerup', window, X(700)(r3), r3.top + 10);
  q('#blockDelete').click();
  check('编辑器可删除时间段', blocks().length === 0 && q('#blockModal').hidden === true);

  /* ---------- 6.5 弹窗的四种关闭方式（用计算样式判断，而不是只看 .hidden 属性） ---------- */
  function modalDisplay() { return getComputedStyle(q('#blockModal')).display; }
  function modalVisible() { return modalDisplay() !== 'none'; }
  function openModal() {
    var el = q('.tl-block[data-id]');
    var r = q('.tl-track').getBoundingClientRect();
    pe('pointerdown', el, X(560)(r), r.top + 10);
    pe('pointerup', window, X(560)(r), r.top + 10);
  }

  check('弹窗默认不可见（刷新不会自动弹出）', !modalVisible(), 'display=' + modalDisplay());

  dragCreate(X(540), X(600));
  openModal();
  check('打开弹窗后确实可见', modalVisible() && q('#blockModal').hidden === false, 'display=' + modalDisplay());

  q('#blockCancel').click();
  check('点「取消」能关闭', !modalVisible() && q('#blockModal').hidden === true, 'display=' + modalDisplay());

  openModal();
  var closeBtn = q('#blockClose');
  check('弹窗右上角有「✕」关闭按钮', !!closeBtn);
  if (closeBtn) closeBtn.click();
  check('点右上角「✕」能关闭', !modalVisible() && q('#blockModal').hidden === true, 'display=' + modalDisplay());

  openModal();
  var mask = q('#blockModal');
  pe('pointerdown', mask, 4, 4);
  mask.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 4, clientY: 4 }));
  check('点灰色遮罩能关闭', !modalVisible() && q('#blockModal').hidden === true, 'display=' + modalDisplay());

  openModal();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  check('按 Esc 能关闭', !modalVisible() && q('#blockModal').hidden === true, 'display=' + modalDisplay());

  /* 关闭后状态要清理干净：再次打开应显示这根色块真实的时间，且没有残留报错 */
  openModal();
  check('关闭后再次打开状态干净',
    q('#blockModal').hidden === false && q('#blockStart').value === '09:00' &&
    q('#blockEnd').value === '10:00' && q('#blockErr').hidden === true,
    q('#blockStart').value + '-' + q('#blockEnd').value + ' errHidden=' + q('#blockErr').hidden);
  q('#blockDelete').click();
  check('清掉测试用的色块', blocks().length === 0 && !modalVisible(), JSON.stringify(blocks()));

  /* 弹窗内的 Cancel 之后，数据不应该被改动 */
  dragCreate(X(540), X(600));
  openModal();
  q('#blockStart').value = '08:00';
  q('#blockCancel').click();
  check('取消不会改动数据', blocks()[0].start === 540, JSON.stringify(blocks()));
  openModal();
  q('#blockDelete').click();

  /* ---------- 7. 整周视图 ---------- */
  q('#tlMode .seg-btn[data-mode="week"]').click();
  check('整周视图渲染 7 条轨道', qa('.tl-track').length === 7, String(qa('.tl-track').length));
  check('整周视图为浏览态（不可拖拽）', qa('.tl-track.is-editable').length === 0);
  q('#tlMode .seg-btn[data-mode="day"]').click();
  check('切回单日视图', qa('.tl-track').length === 1 && qa('.tl-track.is-editable').length === 1);

  /* ---------- 8. 学习记录：表单提交 ---------- */
  var date = today();
  var pick = Store.get().projects[2].id;
  qa('#recProjectChips .chip').forEach(function (c) { if (c.getAttribute('data-id') === pick) c.click(); });
  q('#recDate').value = date;
  q('#recHours').value = '2';
  q('#recMinutes').value = '30';
  q('#recNote').value = '自测记录';
  q('#recForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  var rec = Store.get().records[0];
  check('提交学习记录 2 小时 30 分',
    Store.get().records.length === 1 && rec.minutes === 150 && rec.projectId === pick &&
    rec.date === date && rec.note === '自测记录', JSON.stringify(rec));
  check('记录列表显示新记录', qa('.rec-item').length === 1 && /2小时30分/.test(q('.rec-item').textContent),
    q('.rec-item') ? q('.rec-item').textContent : '无');

  /* 提交后表单会重置为 1 小时，再点 +30 分应为 1:30 */
  q('#recForm [data-add-min="30"]').click();
  check('提交后时长重置，快捷按钮 +30 分 → 1:30', q('#recHours').value === '1' && q('#recMinutes').value === '30',
    q('#recHours').value + ':' + q('#recMinutes').value);

  /* 全局 [hidden] 规则不能把其它浮层带坏 */
  check('轻提示（toast）能正常显示', getComputedStyle(q('#toast')).display !== 'none' &&
    q('#toast').hidden === false, getComputedStyle(q('#toast')).display);

  /* 删除记录 */
  q('.rec-item button[data-act="del"]').click();
  check('可删除学习记录', Store.get().records.length === 0);

  /* ---------- 9. 柱状图：点击柱子切换日期 ---------- */
  var bands = qa('.band-hit');
  check('柱状图渲染 7 根热区', bands.length === 7, String(bands.length));
  var targetDate = bands[0].getAttribute('data-date');
  bands[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
  check('点击柱子跳到对应日期', Store.get().ui.tlDate === targetDate && q('#tlDate').value === targetDate,
    Store.get().ui.tlDate + ' vs ' + targetDate);

  /* ---------- 10. 统计来源切换 ---------- */
  q('#statsSource .seg-btn[data-source="timeline"]').click();
  check('统计来源切到时间轴', Store.get().settings.statsSource === 'timeline');
  q('#statsSource .seg-btn[data-source="records"]').click();
  check('统计来源切回学习记录', Store.get().settings.statsSource === 'records');

  /* ---------- 11. 项目：改名与上限 ---------- */
  var nameInput = q('.proj-row .proj-name');
  nameInput.value = '自测项目';
  nameInput.dispatchEvent(new Event('input', { bubbles: true }));
  nameInput.dispatchEvent(new FocusEvent('blur', { bubbles: false }));
  check('项目改名立即生效', Store.get().projects[0].name === '自测项目', Store.get().projects[0].name);

  q('#projAdd').click();
  check('项目上限 7：默认已满，按钮禁用且点不动',
    Store.get().projects.length === 7 && q('#projAdd').disabled === true,
    String(Store.get().projects.length));
  check('项目面板渲染 7 行', qa('.proj-row').length === 7, String(qa('.proj-row').length));

  /* ---------- 12. 激励语 / 字号 ---------- */
  var quoteEl = q('#quoteText');
  quoteEl.focus();                                  /* 模拟真实输入：先获得焦点 */
  quoteEl.textContent = '自测激励语';
  quoteEl.dispatchEvent(new Event('input', { bubbles: true }));
  check('输入中的激励语不会被重绘覆盖', quoteEl.textContent === '自测激励语', quoteEl.textContent);
  q('#quoteFontRange').value = '34';
  q('#quoteFontRange').dispatchEvent(new Event('input', { bubbles: true }));
  q('#quoteFontRange').dispatchEvent(new Event('change', { bubbles: true }));
  check('字号修改立即生效', Store.get().quote.fontSize === 34, String(Store.get().quote.fontSize));
  quoteEl.dispatchEvent(new FocusEvent('blur'));     /* 失焦立即提交 */
  check('激励语失焦后立刻入库', Store.get().quote.text === '自测激励语', Store.get().quote.text);

  /* ---------- 13. 倒计时编辑 ---------- */
  q('#countdownEdit').click();
  check('倒计时编辑表单能显示', getComputedStyle(q('#countdownForm')).display !== 'none');
  q('#cdTitleInput').value = '自测目标';
  q('#cdTargetInput').value = '2030-01-01T08:00';
  q('#countdownForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  check('倒计时保存后表单收起',
    getComputedStyle(q('#countdownForm')).display === 'none' &&
    Store.get().countdown.title === '自测目标' && Store.get().countdown.target === '2030-01-01T08:00',
    JSON.stringify(Store.get().countdown));

  /* ---------- 14. 番茄计时器（靠虚拟时间快进） ---------- */
  function rgbOf(hex) {
    var v = hex.replace('#', '');
    return 'rgb(' + parseInt(v.slice(0, 2), 16) + ', ' + parseInt(v.slice(2, 4), 16) + ', ' +
      parseInt(v.slice(4, 6), 16) + ')';
  }
  function timerModalVisible() { return getComputedStyle(q('#timerModal')).display !== 'none'; }
  function blockModalVisible() { return getComputedStyle(q('#blockModal')).display !== 'none'; }
  var yesterday = U.addDaysStr(U.todayStr(), -1);
  function yTs(h, m) {
    var d = U.parseDateStr(yesterday);
    d.setHours(h, m, 0, 0);
    return d.getTime();
  }
  function mmssToSec(txt) {
    var p = /^(\\d+):(\\d\\d)$/.exec(txt || '');
    return p ? (+p[1]) * 60 + (+p[2]) : -1;
  }
  function yBlocks() { return Store.get().timeline[yesterday] || []; }

  var offset = 0;
  function step(delay, label, fn) {
    offset += delay;
    setTimeout(function () {
      try { fn(); } catch (e) { check(label, false, '执行异常 ' + (e && e.message)); }
    }, offset);
  }

  /* A. 选项目 → 开始 → 时钟倒数 → 停止（提前停止不写时间轴） */
  var baseIconHref = q('link[rel="icon"]').getAttribute('href');
  q('#timerProjects .chip:nth-child(2)').click();
  var timerPid = Store.get().projects[1].id;
  q('#timerDuration').value = '5';
  q('#timerDuration').dispatchEvent(new Event('change', { bubbles: true }));
  check('计时器：选择项目与每轮时长',
    Store.get().timer.projectId === timerPid && Store.get().timer.durationMin === 5,
    JSON.stringify(Store.get().timer));

  q('#timerStart').click();
  check('计时器：点「开始计时」进入 5 分钟倒计时',
    Store.get().timer.status === 'running' && q('#timerStop').hidden === false && q('#timerStart').hidden === true);
  var clock0 = q('#timerClock').textContent;
  check('计时器：醒目显示 5 分钟倒计时', /^0[45]:\\d\\d$/.test(clock0), clock0);
  /* 时钟颜色有 .2s 过渡，这里直接看内联样式（立即生效的那个值；浏览器会把它规范成 rgb()） */
  check('计时器：倒计时用所选项目的颜色',
    q('#timerClock').style.color === rgbOf(Store.get().projects[1].color),
    q('#timerClock').style.color + ' vs ' + Store.get().projects[1].color);

  step(2500, '计时器：时钟在实时倒数', function () {
    var sec = mmssToSec(q('#timerClock').textContent);
    check('计时器：时钟在实时倒数', sec > 0 && sec <= 300 && sec < mmssToSec(clock0),
      clock0 + ' → ' + q('#timerClock').textContent);
    check('计时器：进度条随进度增长', parseFloat(q('#timerBar').style.width) > 0, q('#timerBar').style.width);
  });

  /* B. 提前停止：不足 5 分钟不写时间轴 */
  step(300, '计时器：提前停止不写入时间轴', function () {
    check('提醒：计时中保持音频保活（避免后台被节流）', window.StudyNotify.isKeepingAlive() === true,
      String(window.StudyNotify.isKeepingAlive()));
    q('#timerStop').click();
    check('计时器：提前停止回到待机且不写时间轴',
      Store.get().timer.status === 'idle' && Store.get().timerLog.length === 0 && yBlocks().length === 0,
      Store.get().timer.status + ' / log=' + Store.get().timerLog.length);
    check('提醒：停止后关闭音频保活', window.StudyNotify.isKeepingAlive() === false);
  });

  /* C. 把本轮开始时间钉在「昨天 09:00」，验证写时间轴 + 询问弹窗 */
  step(200, '计时器：到点写入时间轴并弹出询问', function () {
    q('#timerStart').click();
    Store.startTimer(yTs(9, 0));        // 固定开始时间，让写入结果可预期
  });

  step(2500, '计时器：到点写入时间轴并弹出询问', function () {
    check('计时器：本轮结束进入询问状态', Store.get().timer.status === 'prompt', Store.get().timer.status);
    check('计时器：弹出「是否还在学习？」', timerModalVisible() && q('#timerModal').hidden === false);
    check('计时器：10 秒倒计时已开始', /\\d+ 秒/.test(q('#timerPromptLeft').textContent),
      q('#timerPromptLeft').textContent);
    var blk = yBlocks();
    check('计时器：时长按项目颜色写入当天时间轴',
      blk.length === 1 && blk[0].start === 540 && blk[0].end === 545 && blk[0].projectId === timerPid,
      JSON.stringify(blk));
    check('计时器：番茄记录已持久化', Store.get().timerLog.length === 1 &&
      Store.get().timerLog[0].minutes === 5 && Store.get().timerLog[0].date === yesterday,
      JSON.stringify(Store.get().timerLog[0] || null));
    /* 这一轮锚定在「昨天」，所以按日期归类后应记在昨天，今天仍为 0 */
    var yStat = Store.todayTimerStats(yesterday);
    var tStat = Store.todayTimerStats(U.todayStr());
    check('计时器：番茄统计按日期归类',
      yStat.rounds === 1 && yStat.minutes === 5 && tStat.rounds === 0,
      JSON.stringify({ 昨天: yStat, 今天: tStat }));

    /* ---- 到点提醒：多通道广播 ---- */
    var notes = window.__notifications;
    check('提醒：弹出了系统通知', notes.length === 1, String(notes.length));
    if (notes.length) {
      check('提醒：通知标题在问「是否还在学习」', /是否还在学习/.test(notes[0].title), notes[0].title);
      check('提醒：通知内容含项目与时长', /5分钟/.test(notes[0].body) && /第 1 轮/.test(notes[0].body),
        notes[0].body.replace(/\\n/g, ' / '));
      check('提醒：通知设置为常驻（requireInteraction）', notes[0].requireInteraction === true);
      check('提醒：通知已静音避免与提示音重复', notes[0].silent === true);
    }
    check('提醒：标签页标题在闪烁求关注', document.title.indexOf('⏰') === 0, document.title);
    check('提醒：标签页图标换成红色告警图标',
      q('link[rel="icon"]').getAttribute('href') !== baseIconHref,
      q('link[rel="icon"]').getAttribute('href').slice(0, 40) + '…');
  });

  /* D. 点「继续」→ 下一轮；再停止 */
  step(300, '计时器：点继续开始下一轮', function () {
    q('#timerContinue').click();
    check('计时器：点「继续」开始第 2 轮且弹窗收起',
      Store.get().timer.status === 'running' && Store.get().timer.round === 2 && !timerModalVisible(),
      Store.get().timer.status + ' round=' + Store.get().timer.round);
    check('提醒：点继续后系统通知自动收起', window.__notifications[0].closed === true);
    check('提醒：点继续后标题/图标恢复原样',
      document.title.indexOf('⏰') !== 0 && q('link[rel="icon"]').getAttribute('href') === baseIconHref,
      document.title);
    q('#timerStop').click();
    check('计时器：停止第 2 轮不会重复写入',
      Store.get().timer.status === 'idle' && Store.get().timerLog.length === 1,
      'log=' + Store.get().timerLog.length);
  });

  /* E. 不点「继续」→ 10 秒后自动结束 */
  step(200, '计时器：10 秒不响应自动结束', function () {
    q('#timerStart').click();
    Store.startTimer(yTs(10, 0));
  });
  step(2500, '计时器：等待询问弹窗', function () {
    check('计时器：第二轮到点后询问弹窗再次弹出', timerModalVisible() && Store.get().timer.status === 'prompt',
      Store.get().timer.status);
  });
  step(11000, '计时器：10 秒后自动结束', function () {
    check('计时器：10 秒未点继续 → 自动结束计时',
      Store.get().timer.status === 'idle' && !timerModalVisible(),
      Store.get().timer.status + ' modal=' + timerModalVisible());
    check('计时器：自动结束后不重复写入', Store.get().timerLog.length === 2,
      'log=' + Store.get().timerLog.length);
    check('提醒：超时结束后自动收起系统通知与标题闪烁',
      window.__notifications.length === 2 && window.__notifications[1].closed === true &&
      document.title.indexOf('⏰') !== 0 &&
      q('link[rel="icon"]').getAttribute('href') === baseIconHref,
      'notes=' + window.__notifications.length + ' title=' + document.title);
  });

  /* F. 提醒开关与「试一下」 */
  step(200, '提醒：开关与测试按钮', function () {
    var okChime = true;
    try { window.StudyNotify.chime(2); } catch (e) { okChime = false; }
    check('提醒：提示音播放不报错', okChime);

    q('#timerTest').click();
    check('提醒：「试一下」能立刻发一条通知',
      window.__notifications.length === 3 && /提醒测试/.test(window.__notifications[2].title),
      String(window.__notifications.length));

    q('#timerSound').checked = false;
    q('#timerSound').dispatchEvent(new Event('change', { bubbles: true }));
    check('提醒：关闭提示音会持久化', Store.get().settings.sound === false);
    q('#timerSound').checked = true;
    q('#timerSound').dispatchEvent(new Event('change', { bubbles: true }));
    check('提醒：重新打开提示音', Store.get().settings.sound === true);

    q('#timerNotify').checked = false;
    q('#timerNotify').dispatchEvent(new Event('change', { bubbles: true }));
    check('提醒：关闭系统通知会持久化', Store.get().settings.notify === false);
    q('#timerNotify').checked = true;
    q('#timerNotify').dispatchEvent(new Event('change', { bubbles: true }));
    check('提醒：重新开启系统通知（已授权时立即生效）',
      Store.get().settings.notify === true && q('#timerNotify').checked === true,
      q('#timerNotifyState').textContent);
  });

  /* ---------- 15. 日历调取每日时间轴 ---------- */
  step(200, '日历：打开并显示有记录的日期', function () {
    q('#calToggle').click();
    check('日历：点击后展开', getComputedStyle(q('#calendar')).display !== 'none' &&
      q('#calToggle').getAttribute('aria-expanded') === 'true');
    check('日历：当月日期网格已渲染', qa('#calendar .cal-day').length === 42,
      String(qa('#calendar .cal-day').length));
    var cell = q('#calendar .cal-day[data-date="' + yesterday + '"]');
    check('日历：有记录的日期显示项目颜色圆点',
      !!cell && cell.querySelectorAll('.cal-dots i').length === 1,
      cell ? cell.innerHTML.replace(/</g, '') : '未找到昨天的格子');
    check('日历：今天被高亮', !!q('#calendar .cal-day.is-today'));
  });

  step(200, '日历：选择某一天切换时间轴', function () {
    q('#calendar .cal-day[data-date="' + yesterday + '"]').click();
    check('日历：选择后时间轴切到该日',
      Store.get().ui.tlDate === yesterday && q('#tlDate').value === yesterday,
      Store.get().ui.tlDate);
    check('日历：日期标题同步显示所选日期',
      q('#tlDateLabel').textContent.indexOf(U.formatDateCN(yesterday)) === 0,
      q('#tlDateLabel').textContent);
    check('日历：正确渲染当天已记录的时间轴',
      qa('.tl-block[data-id]').length === 2 &&
      (Store.get().timeline[yesterday] || []).map(function (b) { return b.start + '-' + b.end; })
        .join(',') === '540-545,600-605',
      String(qa('.tl-block[data-id]').length) + ' | ' +
      JSON.stringify((Store.get().timeline[yesterday] || []).map(function (b) { return [b.start, b.end]; })));
    check('日历：选择后自动收起', getComputedStyle(q('#calendar')).display === 'none');
    check('日历：计时写入的色块颜色与项目一致',
      getComputedStyle(q('.tl-block[data-id]')).backgroundColor === rgbOf(Store.get().projects[1].color),
      getComputedStyle(q('.tl-block[data-id]')).backgroundColor);
  });

  /* ---------- 16. 状态同步：切换日期时不留残影 ---------- */
  step(200, '同步：切换日期会关掉时间段弹窗', function () {
    var el0 = q('.tl-block[data-id]');
    var r = el0.getBoundingClientRect();
    pe('pointerdown', el0, r.left + r.width / 2, r.top + r.height / 2);
    pe('pointerup', window, r.left + r.width / 2, r.top + r.height / 2);
    check('同步：色块编辑器已打开', blockModalVisible(), 'display=' + getComputedStyle(q('#blockModal')).display);
    q('#tlDate').value = U.todayStr();
    q('#tlDate').dispatchEvent(new Event('change', { bubbles: true }));
    check('同步：切换日期后弹窗自动关闭', !blockModalVisible() && q('#blockModal').hidden === true,
      'display=' + getComputedStyle(q('#blockModal')).display);
    check('同步：切换日期后时间轴渲染的是新日期',
      Store.get().ui.tlDate === U.todayStr() && qa('.tl-block[data-id]').length === 0,
      'blocks=' + qa('.tl-block[data-id]').length);
  });

  /* ---------- 17. 不计入学习时长的项目（上课 / 额外睡眠） ---------- */
  step(200, '不计入学习时长的项目', function () {
    var off = Store.get().projects.filter(function (p) { return p.countsAsStudy === false; });
    check('项目：默认带「上课」「额外睡眠」两个不计入项',
      off.length === 2 && off.map(function (p) { return p.name; }).join(',') === '上课,额外睡眠',
      off.map(function (p) { return p.name; }).join(','));
    check('项目：不计入的项目在面板上有虚线标记',
      qa('.proj-row.is-nostudy').length === 2, String(qa('.proj-row.is-nostudy').length));
    check('项目：每行都有「计入」开关', qa('.proj-row .proj-count').length === 7,
      String(qa('.proj-row .proj-count').length));

    /* 把「上课」记 2 小时，它不应该进学习时长 */
    var classP = off[0];
    qa('#recProjectChips .chip').forEach(function (c) {
      if (c.getAttribute('data-id') === classP.id) c.click();
    });
    q('#recDate').value = U.todayStr();
    q('#recHours').value = '2';
    q('#recMinutes').value = '0';
    q('#recForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    check('记录：不计入的项目带「不计入」标签', !!q('.rec-item .proj-nostudy-tag'));
    check('记录：合计区分学习与非学习', /不计入/.test(q('#recListSum').textContent),
      q('#recListSum').textContent);

    var wk = window.StudyStats.weekStats(Store.get(), Store.get().settings.statsSource,
      U.todayStr(), 360, 'study');
    check('周统计：上课 2 小时不计入学习时长',
      wk.projectTotals.every(function (t) { return t.projectId !== classP.id; }),
      JSON.stringify(wk.projectTotals));
    check('周统计：图例下方标注了未计入的项目',
      /未计入学习时长/.test(q('#wkLegend').textContent), q('#wkLegend').textContent.slice(-46));
    check('周统计：柱子颜色里没有上课的颜色',
      qa('#weekChart .bar-seg').every(function (b) {
        return (b.getAttribute('fill') || '').toLowerCase() !== classP.color.toLowerCase();
      }));

    /* 开关切回「计入」后应立刻进入统计 */
    var box = q('.proj-row[data-id="' + classP.id + '"] .proj-count');
    box.checked = true;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    var wk2 = window.StudyStats.weekStats(Store.get(), Store.get().settings.statsSource,
      U.todayStr(), 360, 'study');
    check('项目：打开「计入」后立刻计入学习时长',
      wk2.projectTotals.some(function (t) { return t.projectId === classP.id && t.minutes === 120; }),
      JSON.stringify(wk2.projectTotals));
    box.checked = false;
    box.dispatchEvent(new Event('change', { bubbles: true }));
  });

  /* ---------- 18. 睡眠：手动录入 + 每晚柱状图 + 日历入口 ---------- */
  step(200, '睡眠：手动录入一晚', function () {
    var d = U.addDaysStr(U.todayStr(), -1);
    q('#slDate').value = d;
    q('#slDate').dispatchEvent(new Event('change', { bubbles: true }));
    q('#slBed').value = '23:30';
    q('#slBed').dispatchEvent(new Event('input', { bubbles: true }));
    q('#slWake').value = '07:00';
    q('#slWake').dispatchEvent(new Event('input', { bubbles: true }));
    check('睡眠：表单实时算出「7小时30分钟」', /7小时30分钟/.test(q('#slDuration').textContent),
      q('#slDuration').textContent);

    q('#slNote').value = '自测睡眠';
    q('#sleepForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    var e = Store.getSleep(d);
    check('睡眠：跨午夜保存正确（23:30→07:00 = 450 分钟）',
      !!e && e.duration === 450 && e.bed === 1410 && e.wake === 420 && e.note === '自测睡眠',
      JSON.stringify(e));
    check('睡眠：柱状图画出这一晚', qa('#sleepChart .sleep-bar').length === 1,
      String(qa('#sleepChart .sleep-bar').length));
    check('睡眠：8 小时参考线在图里',
      !!q('#sleepChart .ref-line') && /8 小时/.test(q('#sleepChart .ref-label').textContent));
    check('睡眠：本月小结已更新', /1 晚/.test(q('#slSummary').textContent), q('#slSummary').textContent);
    check('睡眠：删除按钮已出现', q('#slDelete').hidden === false);
  });

  step(200, '睡眠：日历切到睡眠模式并定位到那一晚', function () {
    q('#calToggle').click();
    var sleepTab = q('#calendar .cal-mode .seg-btn[data-calmode="sleep"]');
    check('日历：有「🌙 睡眠」切换', !!sleepTab);
    if (!sleepTab) return;
    sleepTab.click();
    var d = U.addDaysStr(U.todayStr(), -1);
    var cell = q('#calendar .cal-day[data-date="' + d + '"]');
    check('日历：睡眠模式给有记录的晚上打点',
      qa('#calendar .cal-day.has-sleep').length === 1 &&
      !!cell && !!cell.querySelector('.cal-sleep-dot'),
      qa('#calendar .cal-day.has-sleep').length + ' 晚');
    cell.click();
    check('日历：点某晚后跳到睡眠面板并选中该晚',
      Store.get().ui.sleepDate === d && getComputedStyle(q('#calendar')).display === 'none',
      Store.get().ui.sleepDate);
    check('睡眠：表单跟着切到那一晚', q('#slDate').value === d && q('#slBed').value === '23:30',
      q('#slDate').value + ' ' + q('#slBed').value);
    check('睡眠：主时间轴日期没有被改动', Store.get().ui.tlDate === U.todayStr(), Store.get().ui.tlDate);
  });

  step(200, '睡眠：删除某一晚', function () {
    q('#slDelete').click();
    check('睡眠：删除后记录与柱子一起消失',
      Store.getSleep(Store.get().ui.sleepDate) === null &&
      qa('#sleepChart .sleep-bar').length === 0,
      String(qa('#sleepChart .sleep-bar').length));
  });

  /* ---------- 19. 全局浮窗（番茄计时的小窗口） ---------- */
  step(200, '全局浮窗：到点会提到最前、结束会关掉', function () {
    var pops = window.__popups;
    var last = pops[pops.length - 1];
    check('全局浮窗：开始计时时自动打开', pops.length >= 1 && /timer-popup\.html/.test(pops[0].url),
      String(pops.length) + ' 个 / ' + (pops[0] ? pops[0].url : ''));
    check('全局浮窗：打开参数是独立小窗',
      !!pops[0] && /width=/.test(pops[0].features) && /popup=yes/.test(pops[0].features),
      pops[0] ? pops[0].features : '');
    check('全局浮窗：每开一轮都会确保浮窗在', pops.length >= 2, String(pops.length) + ' 个浮窗');
    check('全局浮窗：到点被提到最前（focus）', !!last && last.focused > 0,
      last ? String(last.focused) : '0');
    check('全局浮窗：计时结束自动关闭', !!last && last.closed === true);

    /* 开关能持久化 */
    q('#timerPopup').checked = false;
    q('#timerPopup').dispatchEvent(new Event('change', { bubbles: true }));
    check('全局浮窗：可以关闭并持久化', Store.get().settings.popup === false);
    q('#timerPopup').checked = true;
    q('#timerPopup').dispatchEvent(new Event('change', { bubbles: true }));
    check('全局浮窗：可以重新打开', Store.get().settings.popup === true);
  });

  /* ---------- 20. 持久化（等防抖写入后检查 localStorage） ---------- */
  step(900, '持久化', writeReport);

  /* 兜底：万一上面的链条被中断，也要把结果吐出来 */
  setTimeout(function () { writeReport(); }, 80000);

  function writeReport() {
    if (writeReport.done) return;
    writeReport.done = true;

    var raw = window.localStorage.getItem(Store.STORAGE_KEY);
    var saved = raw ? JSON.parse(raw) : null;
    check('激励语写入 localStorage', !!saved && saved.quote.text === '自测激励语',
      saved ? saved.quote.text : 'null');
    check('项目改名写入 localStorage', !!saved && saved.projects[0].name === '自测项目');
    check('番茄计时与时间轴写入 localStorage',
      !!saved && saved.timerLog.length === 2 && !!saved.timeline[yesterday],
      saved ? ('log=' + saved.timerLog.length) : 'null');
    check('整份数据可被校验复活', !!saved && window.StudyStore.normalizeState(saved).projects.length === 7);

    var pre = document.createElement('pre');
    pre.id = 'e2eResults';
    pre.textContent = results.join('\\n') + '\\n' +
      '------------------------------------------\\n' +
      'E2E_DONE  通过 ' + pass + ' / 共 ' + (pass + fail) + ' 项' + (fail ? '（失败 ' + fail + ' 项）' : '');
    document.body.appendChild(pre);
    document.title = 'E2E ' + pass + '/' + (pass + fail);
  }
}
</script>
`;

const html = fs.readFileSync(srcPath, 'utf8');
const marker = '<script src="js/util.js"></script>';
if (html.indexOf(marker) === -1) {
  console.error('未在 index.html 中找到脚本入口，生成失败');
  process.exit(1);
}

const out = html
  .replace('<link rel="stylesheet" href="css/styles.css">', '<link rel="stylesheet" href="../css/styles.css">')
  .replace(/(<script src=")(js\/[a-z]+\.js)(")/g, '$1../$2$3')
  .replace(marker.replace('js/util.js', '../js/util.js'),
    injected + '\n' + marker.replace('js/util.js', '../js/util.js'))
  .replace('<title>学习时长记录 · 个人版</title>', '<title>交互自测 · 学习时长记录</title>');

fs.writeFileSync(outPath, out, 'utf8');
console.log('已生成 ' + outPath);
