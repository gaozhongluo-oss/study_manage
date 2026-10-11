/* ============================================================
 * tests/make-preview.js —— 生成 tests/preview.html（带示例数据的预览页）
 *
 * 用途：用浏览器打开预览页，可以看到填满示例数据后的界面效果，
 *       方便检查样式 / 图表 / 时间轴，而不会污染 index.html 里的真实数据。
 * 做法：读取 ../index.html，在应用脚本之前插入一段脚本，把 localStorage
 *       替换成内存实现并写入示例数据（仅在这个页面内生效）。
 *
 * 运行： node tests/make-preview.js
 * ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const srcPath = path.join(root, 'index.html');
const outPath = path.join(__dirname, 'preview.html');

const U = require('../js/util.js');
const Store = require('../js/store.js');

/* ---------- 构造示例数据 ---------- */
function buildDemoState() {
  const state = Store.defaultState();
  const today = new Date();
  const monday = U.startOfWeek(today, 1);

  // 本周：周一~周日，用当前星期几决定生成到哪一天
  const weekdayIndex = (today.getDay() + 6) % 7; // 0=周一
  const plan = [
    { h: 7.5, p: 0 }, { h: 5, p: 1 }, { h: 8.5, p: 0 },
    { h: 4, p: 2 }, { h: 6, p: 1 }, { h: 3, p: 3 }, { h: 9, p: 0 }
  ];

  state.records = [];
  state.timeline = {};

  for (let i = 0; i <= weekdayIndex; i++) {
    const date = U.toDateStr(U.addDays(monday, i));
    const total = plan[i].h;
    // 拆成 2~3 段记录，落在不同项目上
    const primary = plan[i].p;
    const secondary = (primary + 2) % state.projects.length;
    const a = Math.round(total * 60 * 0.6);
    const b = Math.round(total * 60) - a;
    state.records.push({
      id: 'demo_r' + i + 'a', projectId: state.projects[primary].id, date: date,
      minutes: a, note: i % 2 === 0 ? '真题训练' : '章节精读', createdAt: new Date().toISOString()
    });
    state.records.push({
      id: 'demo_r' + i + 'b', projectId: state.projects[secondary].id, date: date,
      minutes: b, note: '', createdAt: new Date().toISOString()
    });

    // 时间轴：上午 + 下午 + 晚上三块
    const morning = 6 * 60 + 90 + i * 5;
    const blocks = [
      { id: 'demo_b' + i + '1', projectId: state.projects[primary].id, start: morning, end: morning + 150, note: '上午专注' },
      { id: 'demo_b' + i + '2', projectId: state.projects[secondary].id, start: morning + 200, end: morning + 310, note: '' }
    ];
    if (i % 2 === 0) {
      blocks.push({
        id: 'demo_b' + i + '3', projectId: state.projects[3].id,
        start: 19 * 60 + 30, end: 21 * 60 + 30, note: '晚间复盘'
      });
    }
    state.timeline[date] = blocks;
  }

  /* 示例睡眠：本周已经过去的每一晚都填上（跨午夜） */
  state.sleep = {};
  const sleepPlan = [[23, 30, 7, 0], [0, 20, 7, 30], [23, 0, 6, 45], [1, 0, 8, 0],
    [23, 45, 7, 15], [22, 50, 6, 30], [23, 15, 7, 0]];
  for (let i = 0; i <= weekdayIndex; i++) {
    const date = U.toDateStr(U.addDays(monday, i));
    const sp = sleepPlan[i % sleepPlan.length];
    const bed = sp[0] * 60 + sp[1];
    const wake = sp[2] * 60 + sp[3];
    state.sleep[date] = {
      bed: bed, wake: wake,
      duration: (wake - bed + 1440) % 1440,
      note: i % 3 === 0 ? '睡得还行' : ''
    };
  }
  state.ui.sleepDate = U.todayStr();

  state.quote.text = '把今天该做的做完，明天才有资格谈焦虑。';
  state.quote.fontSize = 30;
  const target = U.addDays(today, 87);
  target.setHours(8, 30, 0, 0);
  state.countdown.title = '考研初试';
  state.countdown.target = U.toLocalDateTimeInput(target);
  state.ui.tlDate = U.todayStr();
  state.ui.weekAnchor = U.todayStr();

  return Store.normalizeState(state);
}

const demoState = buildDemoState();

const seedScript = `
<script>
/* —— 预览页专用：内存版 localStorage + 示例数据（不会写入真实本地数据） —— */
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
  mem.setItem('study-tracker.state.v1', ${JSON.stringify(JSON.stringify(demoState))});
})();
</script>
`;

/* —— 生成预览页时顺带注入一段「布局自检」，用无头浏览器 dump-dom 就能读结果 —— */
const layoutCheck = `
<script>
window.addEventListener('load', function () { setTimeout(runLayoutCheck, 60); });

function runLayoutCheck() {
  var out = [], pass = 0, fail = 0;
  function check(label, cond, extra) {
    if (cond) { pass++; out.push('PASS | ' + label + (extra ? '  [' + extra + ']' : '')); }
    else { fail++; out.push('FAIL | ' + label + (extra ? '  →  ' + extra : '')); }
  }
  function q(s) { return document.querySelector(s); }
  function qa(s) { return Array.prototype.slice.call(document.querySelectorAll(s)); }
  function toHex(c) {
    var m = /rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/.exec(c || '');
    if (!m) return (c || '').toLowerCase();
    return '#' + [1, 2, 3].map(function (i) {
      var v = parseInt(m[i], 10).toString(16);
      return v.length < 2 ? '0' + v : v;
    }).join('');
  }
  function rect(e) { return e.getBoundingClientRect(); }

  var state = window.StudyStore.get();
  var colors = state.projects.map(function (p) { return p.color.toLowerCase(); });
  var vw = window.innerWidth;

  /* 1. 页面不应出现横向滚动条 */
  var de = document.documentElement;
  check('页面无横向溢出', de.scrollWidth <= vw + 1, 'scrollWidth=' + de.scrollWidth + ' viewport=' + vw);

  /* 1b. 浮层默认必须是隐藏的（hidden 属性要真的生效） */
  check('加载后弹窗不显示（不会自动弹出）',
    q('#blockModal').hidden === true && getComputedStyle(q('#blockModal')).display === 'none',
    'display=' + getComputedStyle(q('#blockModal')).display);
  check('加载后倒计时表单/轻提示不显示',
    getComputedStyle(q('#countdownForm')).display === 'none' &&
    getComputedStyle(q('#toast')).display === 'none');

  /* 2. 柱状图 */
  var svg = q('#weekChart svg');
  var svgRect = svg ? rect(svg) : null;
  var hostW = q('#weekChart').clientWidth;
  check('柱状图已渲染且适配容器宽度',
    !!svg && svgRect.width >= Math.min(280, hostW) - 1 && svgRect.width <= hostW + 1 &&
    svgRect.height > 180,
    svgRect ? Math.round(svgRect.width) + 'x' + Math.round(svgRect.height) + ' host=' + hostW : 'no svg');

  var segs = qa('#weekChart .bar-seg');
  var segColors = segs.map(function (s) { return (s.getAttribute('fill') || '').toLowerCase(); });
  check('柱子颜色全部来自项目配色',
    segs.length > 0 && segColors.every(function (c) { return colors.indexOf(c) !== -1; }),
    '段数=' + segs.length + ' 颜色=' + Array.from(new Set(segColors)).join(','));
  check('柱状图用到多种项目颜色', new Set(segColors).size >= 2, String(new Set(segColors).size));

  var refLine = q('#weekChart .ref-line');
  var refY = refLine ? parseFloat(refLine.getAttribute('y1')) : NaN;
  var plotTop = 30, plotBottom = svg ? parseFloat(svg.getAttribute('height')) - 34 : 0;
  check('6 小时参照线落在绘图区内', !!refLine && refY > plotTop && refY < plotBottom,
    'y=' + refY + ' 区间=(' + plotTop + ',' + plotBottom + ')');
  check('参照线标注文字正确', q('#weekChart .ref-label') && q('#weekChart .ref-label').textContent === '6 小时目标');
  check('未达标的日子画出差距虚框', qa('#weekChart .goal-ghost').length >= 1,
    '虚框数=' + qa('#weekChart .goal-ghost').length);
  check('柱状图 7 天热区齐全', qa('#weekChart .band-hit').length === 7);
  check('柱顶差距数值已显示', qa('#weekChart .diff-text').length === 7, String(qa('#weekChart .diff-text').length));

  /* 3. 时间轴 */
  var tracks = qa('.tl-track');
  check('时间轴轨道数正确（单日=1）', tracks.length === 1, String(tracks.length));
  var track = tracks[0];
  var tr = rect(track);
  check('时间轴每根色块都在轨道内', qa('.tl-block').every(function (b) {
    var br = rect(b);
    return br.left >= tr.left - 1 && br.right <= tr.right + 1;
  }), '轨道宽=' + Math.round(tr.width));

  var blkColors = qa('.tl-block').map(function (b) { return toHex(getComputedStyle(b).backgroundColor); });
  check('色块颜色全部来自项目配色',
    blkColors.length > 0 && blkColors.every(function (c) { return colors.indexOf(c) !== -1; }),
    Array.from(new Set(blkColors)).join(','));

  /* 同一条泳道内不应重叠（重叠的时间段已自动分泳道） */
  var lanes = {};
  qa('.tl-block').forEach(function (b) {
    var key = b.style.top;
    (lanes[key] = lanes[key] || []).push(rect(b));
  });
  var overlap = false;
  Object.keys(lanes).forEach(function (k) {
    var list = lanes[k].sort(function (a, b) { return a.left - b.left; });
    for (var i = 1; i < list.length; i++) if (list[i].left < list[i - 1].right - 0.5) overlap = true;
  });
  check('同一泳道内色块互不重叠', !overlap);

  check('小时刻度 19 条（6:00–24:00）', qa('.tl-grid').length && qa('.tl-row .tl-tick').length === 19,
    String(qa('.tl-row .tl-tick').length));

  var label12 = qa('.tl-axis span').filter(function (s) { return s.textContent === '12:00'; })[0];
  if (label12) {
    var lr = rect(label12), axisR = rect(q('.tl-axis'));
    var want = axisR.left + axisR.width / 3;
    check('12:00 刻度与轨道 1/3 处对齐', Math.abs(lr.left + lr.width / 2 - want) <= 2,
      '偏差 ' + (lr.left + lr.width / 2 - want).toFixed(2) + 'px');
  } else {
    check('12:00 刻度与轨道 1/3 处对齐', false, '未找到 12:00 刻度');
  }

  /* 4. 配色一致性 */
  var dots = qa('.tl-legend .chip .dot').map(function (d) { return toHex(getComputedStyle(d).backgroundColor); });
  check('时间轴图例颜色与项目一致',
    dots.length === colors.length && dots.every(function (c) { return colors.indexOf(c) !== -1; }), dots.join(','));
  var bars = qa('.pbar .fill').map(function (f) { return toHex(getComputedStyle(f).backgroundColor); });
  var studyProjects = state.projects.filter(function (p) { return p.countsAsStudy !== false; });
  check('项目累计条只画「计入学习时长」的项目',
    bars.length === studyProjects.length && bars.every(function (c) { return colors.indexOf(c) !== -1; }),
    bars.length + ' 条 / ' + studyProjects.length + ' 个学习项目');
  var recBars = qa('.rec-bar').map(function (f) { return toHex(getComputedStyle(f).backgroundColor); });
  check('学习记录条目都带项目颜色',
    recBars.length > 0 && recBars.every(function (c) { return colors.indexOf(c) !== -1; }),
    '条数=' + recBars.length);
  var swatches = qa('#wkLegend .sw').map(function (f) { return toHex(getComputedStyle(f).backgroundColor); });
  check('周统计图例颜色与项目一致',
    swatches.length > 0 && swatches.every(function (c) { return colors.indexOf(c) !== -1; }), swatches.join(','));

  /* 5. 文字与信息 */
  check('激励语字号规则生效（>16px）',
    parseFloat(getComputedStyle(q('#quoteText')).fontSize) > 16,
    getComputedStyle(q('#quoteText')).fontSize);
  check('倒计时显示剩余天数', /天|已过去/.test(q('#cdClock').textContent), q('#cdClock').textContent);
  check('周统计显示 4 项指标', qa('#wkSummary .stat').length === 4);
  check('时间轴合计已显示', /合计/.test(q('#tlTotal').textContent), q('#tlTotal').textContent.trim());
  check('学习记录列表非空', qa('.rec-item').length > 0, String(qa('.rec-item').length));

  /* 6. 番茄计时器与日历（新功能） */
  var clock = q('#timerClock');
  check('计时器默认显示每轮 5 分钟', clock.textContent === '05:00', clock.textContent);
  check('计时器时钟足够醒目（≥32px）', parseFloat(getComputedStyle(clock).fontSize) >= 32,
    getComputedStyle(clock).fontSize);
  check('计时器选项使用项目配色',
    qa('#timerProjects .chip .dot').map(function (d) { return toHex(getComputedStyle(d).backgroundColor); })
      .every(function (c) { return colors.indexOf(c) !== -1; }),
    qa('#timerProjects .chip').length + ' 个项目');
  check('计时器弹窗默认不显示',
    q('#timerModal').hidden === true && getComputedStyle(q('#timerModal')).display === 'none');
  check('计时器面板可见且有高度', rect(q('#panelTimer')).height > 120,
    Math.round(rect(q('#panelTimer')).height) + 'px');
  check('到点提醒：开关与测试按钮已渲染',
    !!q('#timerSound') && !!q('#timerNotify') && !!q('#timerTest') &&
    rect(q('#timerSound')).width > 10 && rect(q('#timerTest')).width > 10);
  check('到点提醒：开关状态与设置一致',
    q('#timerSound').checked === state.settings.sound &&
    q('#timerNotify').checked === state.settings.notify,
    'sound=' + q('#timerSound').checked + ' notify=' + q('#timerNotify').checked +
    ' store=' + JSON.stringify(state.settings));
  check('到点提醒：有权限状态说明文字', q('#timerNotifyState').textContent.length > 4,
    q('#timerNotifyState').textContent.slice(0, 40) + '…');
  check('到点提醒：设置行不溢出面板',
    rect(q('.timer-remind')).right <= rect(q('#panelTimer')).right + 1);

  q('#calToggle').click();
  var calVisible = getComputedStyle(q('#calendar')).display !== 'none';
  check('日历可以展开', calVisible);
  if (calVisible) {
    var calRect = rect(q('#calendar'));
    check('日历不超出视口右边缘', calRect.right <= vw + 1, Math.round(calRect.right) + ' / ' + vw);
    check('日历渲染 6 周日期格', qa('#calendar .cal-day').length === 42);
    check('日历有选中日期高亮', !!q('#calendar .cal-day.is-selected'));
    var withDots = qa('#calendar .cal-day .cal-dots').length;
    check('日历给有记录的日期画了圆点', withDots >= 1, withDots + ' 天有点');
    q('#calToggle').click();
    check('日历可以收起', getComputedStyle(q('#calendar')).display === 'none');
  }
  check('时间轴上方显示当前所选日期', !!q('#tlDateLabel').textContent &&
    q('#tlDateLabel').textContent.indexOf('-') > 0, q('#tlDateLabel').textContent);

  /* 6b. 睡眠面板 */
  check('睡眠：表单与柱状图已渲染', !!q('#sleepForm') && !!q('#sleepChart svg') &&
    rect(q('#panelSleep')).height > 150, Math.round(rect(q('#panelSleep')).height) + 'px');
  check('睡眠：柱状图有 8 小时参考线',
    !!q('#sleepChart .ref-line') && /8 小时/.test(q('#sleepChart .ref-label').textContent));
  check('睡眠：柱子颜色是睡眠专用色',
    qa('#sleepChart .sleep-bar').every(function (b) {
      var f = (b.getAttribute('fill') || '').toLowerCase();
      return f === '#5f6caf' || f === '#8a93c9';
    }), qa('#sleepChart .sleep-bar').length + ' 根柱子');
  check('睡眠：面板不溢出', rect(q('#panelSleep')).right <= vw + 1);
  check('睡眠：柱状图高度合理', rect(q('#sleepChart svg')).height > 120,
    Math.round(rect(q('#sleepChart svg')).height) + 'px');

  /* 6c. 日历的「时间轴 / 睡眠」切换 */
  q('#calToggle').click();
  var modeBtns = qa('#calendar .cal-mode .seg-btn');
  check('日历：有「时间轴 / 睡眠」切换', modeBtns.length === 2, String(modeBtns.length));
  var sleepBtn = q('#calendar .cal-mode .seg-btn[data-calmode="sleep"]');
  if (sleepBtn) {
    sleepBtn.click();
    check('日历：切到睡眠模式后给有记录的晚上打点',
      qa('#calendar .cal-day.has-sleep').length >= 1,
      qa('#calendar .cal-day.has-sleep').length + ' 晚有记录');
    check('日历：睡眠模式不再显示项目色圆点',
      qa('#calendar .cal-day .cal-dots:not(.cal-sleep-dot)').length === 0);
    q('#calendar .cal-mode .seg-btn[data-calmode="timeline"]').click();
  }
  q('#calToggle').click();

  /* 7. 窄屏下应该纵向堆叠而不是被挤扁 */
  if (vw < 700) {
    var wk = rect(q('#panelWeek')), rec = rect(q('#panelRecord'));
    check('窄屏下面板纵向堆叠', Math.abs(wk.left - rec.left) < 2 && rec.top > wk.top,
      'panelWeek.left=' + Math.round(wk.left) + ' panelRecord.left=' + Math.round(rec.left));
    check('窄屏下卡片占满宽度', wk.width >= vw - 40, Math.round(wk.width) + ' / ' + vw);
  }

  var pre = document.createElement('pre');
  pre.id = 'layoutResults';
  pre.textContent = out.join('\\n') + '\\n' +
    '------------------------------------------\\n' +
    'LAYOUT_DONE  通过 ' + pass + ' / 共 ' + (pass + fail) + ' 项' +
    (fail ? '（失败 ' + fail + ' 项）' : '') + '   视口宽 ' + vw + 'px';
  document.body.appendChild(pre);
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
    seedScript + '\n' + marker.replace('js/util.js', '../js/util.js'))
  .replace('</body>', layoutCheck + '</body>')
  .replace('<title>学习时长记录 · 个人版</title>', '<title>预览（示例数据）· 学习时长记录</title>');

fs.writeFileSync(outPath, out, 'utf8');
console.log('已生成 ' + outPath);
