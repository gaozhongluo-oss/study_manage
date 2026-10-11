/* ============================================================
 * tests/stats.test.js —— 纯逻辑单元测试（不依赖浏览器）
 * 运行： node tests/stats.test.js
 * ============================================================ */
'use strict';

const U = require('../js/util.js');
const S = require('../js/stats.js');
const Store = require('../js/store.js');

let passed = 0;
const failures = [];

function ok(cond, label) {
  if (cond) { passed++; } else { failures.push(label); }
}
function eq(actual, expected, label) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a === b) { passed++; } else { failures.push(label + ' → 期望 ' + b + '，实际 ' + a); }
}
function group(name, fn) {
  console.log('\n—— ' + name + ' ——');
  fn();
}

/* ---------------- util ---------------- */
group('时长与时间格式化', () => {
  eq(U.formatMinutes(90), '1小时30分', 'formatMinutes(90)');
  eq(U.formatMinutes(60), '1小时', 'formatMinutes(60)');
  eq(U.formatMinutes(45), '45分', 'formatMinutes(45)');
  eq(U.formatMinutes(0), '0分', 'formatMinutes(0)');
  eq(U.formatHours(90), '1.5h', 'formatHours(90)');
  eq(U.formatHours(120), '2h', 'formatHours(120)');
  eq(U.formatHours(0), '0h', 'formatHours(0)');
  eq(U.minutesToHHMM(570), '09:30', 'minutesToHHMM(570)');
  eq(U.minutesToHHMM(1440), '24:00', 'minutesToHHMM(1440)');
  eq(U.hhmmToMinutes('09:30'), 570, 'hhmmToMinutes("09:30")');
  eq(U.hhmmToMinutes('24:00'), 1440, 'hhmmToMinutes("24:00")');
  eq(U.hhmmToMinutes('25:00'), null, 'hhmmToMinutes("25:00") 非法');
  eq(U.hhmmToMinutes('09:60'), null, 'hhmmToMinutes("09:60") 非法');
  eq(U.hhmmToMinutes('abc'), null, 'hhmmToMinutes("abc") 非法');
  eq(U.snapMinutes(547), 545, 'snapMinutes 吸附到 5 分钟');
  eq(U.clamp(999, 0, 10), 10, 'clamp 上限');
});

group('日期计算', () => {
  eq(U.toDateStr(U.parseDateStr('2025-12-09')), '2025-12-09', '日期字符串往返');
  eq(U.parseDateStr('2025-02-31'), null, '拒绝非法日期 2025-02-31');
  eq(U.isValidDateStr('2025-12-09'), true, 'isValidDateStr 正确日期');
  eq(U.isValidDateStr('2025-13-01'), false, 'isValidDateStr 非法月份');
  eq(U.weekDates('2025-12-10'), ['2025-12-08', '2025-12-09', '2025-12-10', '2025-12-11',
    '2025-12-12', '2025-12-13', '2025-12-14'], '周一为一周起点');
  eq(U.addDaysStr('2025-12-31', 1), '2026-01-01', '跨年加一天');
  eq(U.addDaysStr('2025-03-01', -1), '2025-02-28', '跨月减一天');
  eq(U.diffDays('2025-12-01', '2025-12-10'), 9, '相差天数');
  eq(U.weekdayName('2025-12-10'), '周三', '星期名称');
  eq(U.formatDateCN('2025-12-10'), '12-10 周三', 'formatDateCN');
});

group('倒计时与颜色', () => {
  const d = U.splitDuration(90061000); // 1 天 1 小时 1 分 1 秒
  eq([d.over, d.days, d.hours, d.minutes, d.seconds], [false, 1, 1, 1, 1], 'splitDuration 拆分');
  eq(U.splitDuration(-5000).over, true, 'splitDuration 过期标记');
  const t = U.parseLocalDateTime('2025-12-20T08:30');
  eq([t.getFullYear(), t.getMonth() + 1, t.getDate(), t.getHours(), t.getMinutes()],
    [2025, 12, 20, 8, 30], 'parseLocalDateTime');
  eq(U.parseLocalDateTime('2025-12-20T25:00'), null, 'parseLocalDateTime 非法小时');
  eq(U.toLocalDateTimeInput(t), '2025-12-20T08:30', 'toLocalDateTimeInput');
  eq(U.normalizeHex('abc'), '#aabbcc', 'normalizeHex 短格式');
  eq(U.normalizeHex('not-a-color', '#ffffff'), '#ffffff', 'normalizeHex 回退值');
  eq(U.readableTextColor('#ffffff'), '#1e2430', '浅色背景用深色文字');
  eq(U.readableTextColor('#123456'), '#ffffff', '深色背景用浅色文字');
  eq(U.rgba('#4f7cff', 0.5), 'rgba(79,124,255,0.5)', 'rgba 转换');
});

/* ---------------- stats ---------------- */
group('时间段（时间轴）逻辑', () => {
  eq(S.blockMinutes({ start: 540, end: 660 }), 120, 'blockMinutes');
  eq(S.blockMinutes({ start: 660, end: 540 }), 0, 'blockMinutes 负数保护');
  eq(S.clampBlockRange(300, 1500), { start: 360, end: 1440 }, 'clampBlockRange 裁剪到 6:00–24:00');
  eq(S.clampBlockRange(600, 600), { start: 600, end: 605 }, 'clampBlockRange 最短 5 分钟');

  const blocks = [
    { id: 'a', start: 540, end: 600 },
    { id: 'b', start: 570, end: 630 },
    { id: 'c', start: 700, end: 780 }
  ];
  eq(S.findConflicts(blocks, 590, 610, null).map(b => b.id), ['a', 'b'], 'findConflicts 找出重叠');
  eq(S.findConflicts(blocks, 590, 610, 'a').map(b => b.id), ['b'], 'findConflicts 排除自身');
  const layout = S.assignLanes(blocks);
  eq(layout.laneCount, 2, 'assignLanes 重叠分两条泳道');
  eq(layout.items.map(i => i.lane), [0, 1, 0], 'assignLanes 泳道分配');
});

group('每日 / 每周聚合', () => {
  const state = {
    projects: [{ id: 'p1', name: 'A', color: '#111111' }, { id: 'p2', name: 'B', color: '#222222' }],
    records: [
      { id: 'r1', projectId: 'p1', date: '2025-12-08', minutes: 200, note: '' },
      { id: 'r2', projectId: 'p2', date: '2025-12-08', minutes: 160, note: '' },
      { id: 'r3', projectId: 'p1', date: '2025-12-09', minutes: 120, note: '' },
      { id: 'r4', projectId: 'p1', date: '2025-12-13', minutes: 30, note: '' }
    ],
    timeline: {
      '2025-12-08': [{ id: 'b1', projectId: 'p1', start: 540, end: 660, note: '' }],
      '2025-12-10': [
        { id: 'b2', projectId: 'p1', start: 540, end: 600, note: '' },
        { id: 'b3', projectId: 'p2', start: 600, end: 720, note: '' }
      ]
    }
  };

  const recDaily = S.recordsDaily(state);
  eq(recDaily['2025-12-08'].total, 360, 'recordsDaily 同日累加');
  eq(recDaily['2025-12-08'].byProject, { p1: 200, p2: 160 }, 'recordsDaily 分项目');
  eq(Object.keys(recDaily).length, 3, 'recordsDaily 只统计有数据的日期');

  const tlDaily = S.timelineDaily(state);
  eq(tlDaily['2025-12-10'].total, 180, 'timelineDaily 合计');
  eq(tlDaily['2025-12-08'].byProject, { p1: 120 }, 'timelineDaily 分项目');

  const week = S.weekStats(state, 'records', '2025-12-10');
  eq(week.dates.length, 7, 'weekStats 七天');
  eq([week.start, week.end], ['2025-12-08', '2025-12-14'], 'weekStats 周范围');
  eq(week.total, 510, 'weekStats 合计');
  eq(week.average, 73, 'weekStats 日均（四舍五入 510/7）');
  eq(week.goalDays, 1, 'weekStats 达标天数（12-08 满 6 小时）');
  eq(week.best.date, '2025-12-08', 'weekStats 最长一天');
  eq(week.days[5].diff, 30 - 360, 'weekStats 与 6 小时的差距');
  eq(week.days[6].diff, -360, 'weekStats 空白日的差距');
  eq(week.projectTotals, [{ projectId: 'p1', minutes: 350 }, { projectId: 'p2', minutes: 160 }],
    'weekStats 项目合计按时长倒序');

  const tlWeek = S.weekStats(state, 'timeline', '2025-12-10');
  eq(tlWeek.total, 300, '时间轴来源的周合计');
  eq(S.dayTotal(state, 'timeline', '2025-12-10'), 180, 'dayTotal');

  const all = S.allTimeTotals(state, 'records');
  eq([all.total, all.byProject.p1], [510, 350], 'allTimeTotals');
  eq(S.projectMeta(state, 'nope').name, '未分类', '缺失项目回退为「未分类」');
});

/* ---------------- store ---------------- */
function fakeStorage() {
  const box = {};
  return {
    getItem: k => (Object.prototype.hasOwnProperty.call(box, k) ? box[k] : null),
    setItem: (k, v) => { box[k] = String(v); },
    removeItem: k => { delete box[k]; },
    _dump: () => box
  };
}

group('数据校验与归一化', () => {
  const def = Store.defaultState();
  eq(def.projects.length, 7, '默认 7 个项目（5 个学习 + 上课 / 额外睡眠）');
  eq(def.projects.filter(p => p.countsAsStudy !== false).length, 5, '其中 5 个计入学习时长');
  eq(def.projects.filter(p => p.countsAsStudy === false).map(p => p.name), ['上课', '额外睡眠'],
    '默认含「上课」「额外睡眠」两个不计入学习时长的项目');
  ok(def.quote.text.length > 0, '默认激励语非空');
  ok(!!U.parseLocalDateTime(def.countdown.target), '默认倒计时时间合法');
  eq(def.settings.statsSource, 'records', '默认统计来源为学习记录');

  const many = Store.normalizeState({ projects: new Array(9).fill({ name: 'X', color: '#123456' }) });
  eq(many.projects.length, 7, '项目数量上限 7');
  eq(new Set(many.projects.map(p => p.id)).size, 7, '补全重复 id');

  const dirty = Store.normalizeState({
    projects: [],
    quote: { text: ' 加油 ', fontSize: 999 },
    countdown: { title: '', target: '不是时间' },
    records: [
      { date: 'bad-date', minutes: 60 },
      { date: '2025-12-09', minutes: 0 },
      { date: '2025-12-09', minutes: 90, projectId: 'ghost' },
      { date: '2025-12-09', minutes: -5 }
    ],
    timeline: {
      '2025-12-09': [{ start: 300, end: 1500, projectId: 'ghost' }, { start: 'x', end: 'y' }],
      'bad': [{ start: 600, end: 700 }]
    },
    settings: { statsSource: '乱码' },
    ui: { tlMode: 'week', tlDate: '2025-13-01', tlProjectId: 'ghost' }
  });
  eq(dirty.quote.fontSize, 56, '字号上限 56');
  eq(dirty.quote.text, ' 加油', '文本保留原样');
  ok(!!U.parseLocalDateTime(dirty.countdown.target), '非法倒计时回退默认');
  eq(dirty.projects.length, 7, '项目为空时回填默认项目');
  eq(dirty.records.length, 1, '丢弃非法记录，只留 1 条');
  eq(dirty.records[0].projectId, dirty.projects[0].id, '未知项目并入第一个项目');
  eq(dirty.timeline['2025-12-09'].length, 1, '丢弃非法时间段');
  eq([dirty.timeline['2025-12-09'][0].start, dirty.timeline['2025-12-09'][0].end], [360, 1440],
    '时间段被裁剪进 6:00–24:00');
  eq(dirty.timeline.bad, undefined, '丢弃非法日期的轨道');
  eq(dirty.settings.statsSource, 'records', '非法统计来源回退');
  eq([dirty.ui.tlMode, dirty.ui.tlDate], ['week', U.todayStr()], '界面状态校验');

  const nullish = Store.normalizeState(null);
  eq(nullish.projects.length, 7, '空数据也能得到完整默认结构');
  eq(Store.normalizeState({ projects: [{ name: 'A', color: 'zzz' }] }).projects[0].color, '#4f7cff',
    '非法颜色回退');
});

group('业务操作与持久化', () => {
  const storage = fakeStorage();
  Store.init({ storage });
  Store.reset();

  const p1 = Store.get().projects[0].id;
  const p2 = Store.get().projects[1].id;

  Store.addRecord({ projectId: p1, date: '2025-12-08', minutes: 90, note: '第一章' });
  Store.addRecord({ projectId: p2, date: '2025-12-09', minutes: 30, note: '' });
  eq(Store.get().records.length, 2, 'addRecord 写入两条');
  eq(Store.get().records[0].date, '2025-12-09', '记录按日期倒序');

  const rid = Store.get().records[1].id;
  Store.updateRecord(rid, { minutes: 120, note: '改过了' });
  const rec = Store.get().records.filter(r => r.id === rid)[0];
  eq([rec.minutes, rec.note], [120, '改过了'], 'updateRecord 生效');

  const bid = Store.addBlock('2025-12-08', { start: 540, end: 660, projectId: p1 });
  eq(Store.get().timeline['2025-12-08'].length, 1, 'addBlock 写入');
  Store.updateBlock('2025-12-08', bid, { start: 600, end: 700 });
  eq([Store.get().timeline['2025-12-08'][0].start, Store.get().timeline['2025-12-08'][0].end],
    [600, 700], 'updateBlock 生效');
  Store.addBlock('2025-12-08', { start: 500, end: 520, projectId: p2 });
  eq(Store.get().timeline['2025-12-08'].map(b => b.start), [500, 600], '时间段按开始时间排序');
  Store.removeBlock('2025-12-08', bid);
  eq(Store.get().timeline['2025-12-08'].length, 1, 'removeBlock 生效');

  Store.setUI({ tlProjectId: p2 }, 'ui');
  eq(Store.get().ui.tlProjectId, p2, '当前画笔项目可保存');

  Store.setQuoteText('测试激励语');
  Store.setQuoteFontSize(40);
  Store.setCountdown({ title: '期末考', target: '2026-01-10T09:00' });
  Store.setStatsSource('timeline');
  eq([Store.get().quote.text, Store.get().quote.fontSize], ['测试激励语', 40], '激励语与字号保存');
  eq(Store.get().countdown.title, '期末考', '倒计时名称保存');
  eq(Store.get().settings.statsSource, 'timeline', '统计来源保存');

  // 模拟重新打开页面
  Store._flush();
  const snapshot = storage.getItem(Store.STORAGE_KEY);
  ok(!!snapshot, '数据已写入存储');
  const reopened = Store.normalizeState(JSON.parse(snapshot));
  eq(reopened.records.length, 2, '重新打开后记录仍在');
  eq(reopened.timeline['2025-12-08'].length, 1, '重新打开后时间轴仍在');
  eq(reopened.quote.text, '测试激励语', '重新打开后激励语仍在');
  eq(reopened.ui.tlProjectId, p2, '重新打开后界面选择仍在');

  // 项目删除后数据不丢
  const before = Store.get().records.length;
  const res = Store.removeProject(p1);
  ok(res.ok && res.moved >= 1, 'removeProject 迁移数据');
  eq(Store.get().records.length, before, '删除项目不丢记录');
  eq(Store.get().records.filter(r => r.projectId === p1).length, 0, '旧项目 id 已迁移');

  // 项目数量上限
  while (Store.canAddProject()) Store.addProject();
  eq(Store.get().projects.length, 7, '最多 7 个项目');
  eq(Store.addProject(), null, '超出上限时不再新增');

  // 导入导出
  const json = Store.exportJSON();
  Store.reset();
  Store.addRecord({ projectId: Store.get().projects[0].id, date: '2025-01-01', minutes: 60 });
  const imp = Store.importJSON(json, 'replace');
  ok(imp.ok, 'importJSON 覆盖导入成功');
  eq(Store.get().records.length, 2, '覆盖导入后为导出时的数据');
  eq(Store.importJSON('{不是 json', 'replace').ok, false, '非法 JSON 被拒绝');
  eq(Store.importJSON('{"foo":1}', 'replace').ok, false, '无关 JSON 被拒绝');

  const merged = Store.importJSON(json, 'merge');
  ok(merged.ok, 'importJSON 合并导入成功');
  eq(Store.get().records.length, 2, '合并导入按 id 去重');

  Store._flush();
  eq(!!storage.getItem(Store.STORAGE_KEY), true, 'flush 后确有落盘');
});

group('番茄计时写入时间轴的合并逻辑', () => {
  const mk = (id, pid, start, end) => ({ id, projectId: pid, start, end, note: '' });

  // 完全不重叠 → 只是追加
  let r = S.mergeBlockInto([mk('a', 'p1', 540, 600)], mk('n', 'p1', 660, 720));
  eq(r.blocks.map(b => [b.start, b.end]), [[540, 600], [660, 720]], '不重叠时直接追加');
  eq(r.merged, false, '不重叠不算合并');

  // 首尾相接 → 合并成一段
  r = S.mergeBlockInto([mk('a', 'p1', 540, 600)], mk('n', 'p1', 600, 660));
  eq(r.blocks.map(b => [b.start, b.end]), [[540, 660]], '首尾相接合并成一段');
  eq(r.mergedCount, 1, '合并计数');

  // 部分重叠 → 合并成并集，时长不重复计算
  r = S.mergeBlockInto([mk('a', 'p1', 540, 600)], mk('n', 'p1', 570, 630));
  eq(r.blocks.map(b => [b.start, b.end]), [[540, 630]], '重叠合并为并集');

  // 完全不同项目 → 不合并，交给泳道并排
  r = S.mergeBlockInto([mk('a', 'p1', 540, 600)], mk('n', 'p2', 570, 630));
  eq(r.blocks.length, 2, '不同项目不合并');
  eq(S.assignLanes(r.blocks).laneCount, 2, '不同项目重叠时自动分泳道');

  // 连锁合并：新块把中间两段都串起来
  r = S.mergeBlockInto([mk('a', 'p1', 540, 600), mk('b', 'p1', 610, 660)], mk('n', 'p1', 590, 620));
  eq(r.blocks.map(b => [b.start, b.end]), [[540, 660]], '连锁合并');
  eq(r.mergedCount, 2, '连锁合并计数');

  // 恰好包含已有色块
  r = S.mergeBlockInto([mk('a', 'p1', 600, 620)], mk('n', 'p1', 540, 660));
  eq(r.blocks.map(b => [b.start, b.end]), [[540, 660]], '完全包含时合并为外层');
});

group('番茄计时器状态机与持久化', () => {
  const storage = fakeStorage();
  Store.init({ storage });
  Store.reset();

  const p1 = Store.get().projects[0].id;
  const p2 = Store.get().projects[1].id;

  // 默认配置
  eq(Store.get().timer.status, 'idle', '初始为 idle');
  eq(Store.get().timer.durationMin, 5, '默认每轮 5 分钟');
  eq(U.formatMMSS(Store.get().timer.durationMin * 60000), '05:00', '默认倒计时显示 05:00');

  // 选择项目 / 时长（含非法值兜底）
  Store.setTimerConfig({ projectId: p2, durationMin: 15 });
  eq([Store.get().timer.projectId, Store.get().timer.durationMin], [p2, 15], '选择项目与时长');
  Store.setTimerConfig({ durationMin: 1000 });
  eq(Store.get().timer.durationMin, Store.TIMER_MAX_MINUTES, '时长上限');
  Store.setTimerConfig({ durationMin: 1 });
  eq(Store.get().timer.durationMin, 5, '时长不足 5 分钟时按下限处理');
  Store.setTimerConfig({ projectId: '不存在的项目' });
  eq(Store.get().timer.projectId, p2, '非法项目被忽略');

  // 开始计时
  Store.startTimer();
  eq([Store.get().timer.status, Store.get().timer.round], ['running', 1], '开始后进入 running');
  ok(typeof Store.get().timer.roundStart === 'number', '记录本轮开始时间戳');

  // 提前停止：不足 5 分钟不写时间轴
  let res = Store.finishRound({ prompt: false });
  eq(res.reason, 'too-short', '不足 5 分钟不写入');
  eq(Store.get().timer.status, 'idle', '提前停止后回到 idle');
  eq(Object.keys(Store.get().timeline).length, 0, '没写任何色块');
  eq(Store.get().timerLog.length, 0, '没记番茄日志');

  // 正常完成一轮：写时间轴 + 进入询问（用固定的 09:00 起算，避免受运行时刻影响）
  Store.setTimerConfig({ durationMin: 25 });
  const day0 = U.parseDateStr(U.todayStr());
  day0.setHours(9, 0, 0, 0);
  const t9 = day0.getTime();
  Store.startTimer(t9);
  res = Store.finishRound({ prompt: true, endAt: t9 + 25 * 60000 });
  ok(res.ok, '完成一轮写入成功');
  eq([res.start, res.end], [540, 565], '写入 09:00–09:25');
  eq(res.minutes, 25, '写入 25 分钟');
  eq(Store.get().timer.status, 'prompt', '自然到时后进入询问状态');
  ok(Store.get().timer.promptUntil > Date.now(), '记录询问截止时间');
  eq(Store.get().timerLog.length, 1, '番茄日志记录一条');
  eq(Store.get().timerLog[0].minutes, 25, '日志时长正确');
  eq(Store.get().timeline[res.date].length, 1, '时间轴写入一根色块');
  const day9 = res.date;   // 第一轮的日期（后面 res 会被复用）

  // 点「继续」→ 第 2 轮；与上一轮相接 → 合并成一根色块
  Store.continueTimer(t9 + 25 * 60000);
  eq([Store.get().timer.status, Store.get().timer.round], ['running', 2], '继续后开始第 2 轮');
  res = Store.finishRound({ prompt: true, endAt: t9 + 50 * 60000 });
  eq(Store.get().timerLog.length, 2, '第 2 轮也记入日志');
  eq(Store.get().timeline[day9].length, 1, '相接的两轮合并成一根色块（不重复计时长）');
  eq(Store.get().timeline[day9][0].end - Store.get().timeline[day9][0].start, 50,
    '合并后总时长 = 50 分钟');
  eq([Store.get().timeline[day9][0].start, Store.get().timeline[day9][0].end], [540, 590],
    '合并后为 09:00–09:50');

  // 跨 24:00：按时间轴范围截断
  const day23 = U.parseDateStr(U.todayStr());
  day23.setHours(23, 50, 0, 0);
  const t2350 = day23.getTime();
  Store.stopTimer();
  Store.startTimer(t2350);
  res = Store.finishRound({ prompt: false, endAt: t2350 + 25 * 60000 });
  eq([res.start, res.end], [1430, 1440], '跨 24:00 时截断到 24:00');
  eq(res.minutes, 10, '只记入 10 分钟而不是 25 分钟');

  // 完全落在 6:00 之前：不写入
  const day5 = U.parseDateStr(U.todayStr());
  day5.setHours(5, 0, 0, 0);
  Store.startTimer(day5.getTime());
  res = Store.finishRound({ prompt: false, endAt: day5.getTime() + 25 * 60000 });
  eq([res.ok, res.reason], [false, 'out-of-range'], '凌晨的计时不写入时间轴');

  // 10 秒内不点继续 → 视为停止
  Store.stopTimer();
  eq([Store.get().timer.status, Store.get().timer.roundStart, Store.get().timer.promptUntil],
    ['idle', null, null], '停止后清空计时状态');

  // 今日统计（两次 25 分钟；23:50 那轮只记 10 分钟，日期同为今天）
  const todayStats = Store.todayTimerStats(day9);
  eq(todayStats.rounds, 3, '今日番茄轮数');
  eq(todayStats.minutes, 60, '今日番茄总分钟（25 + 25 + 10）');

  // 刷新后恢复：running 状态能续上
  Store.startTimer();
  const runningStart = Store.get().timer.roundStart;
  Store._flush();
  const reloaded = Store.normalizeState(JSON.parse(storage.getItem(Store.STORAGE_KEY)));
  eq(reloaded.timer.status, 'running', '刷新后仍是 running');
  eq(reloaded.timer.roundStart, runningStart, '开始时间戳不丢');
  eq(reloaded.timeline[day9][0].end - reloaded.timeline[day9][0].start, 50, '时间轴数据不丢');
  eq(reloaded.timerLog.length, 3, '番茄日志不丢');

  // 损坏的计时状态会被归一化成 idle
  const broken = Store.normalizeState({
    timer: { status: 'running', roundStart: 'abc', promptUntil: null, durationMin: 'x' },
    timerLog: [{ date: 'bad', minutes: 5 }, { date: '2025-12-09', minutes: 25, projectId: 'ghost' }]
  });
  eq(broken.timer.status, 'idle', 'running 缺少时间戳 → idle');
  eq(broken.timer.durationMin, 5, '非法时长回退默认');
  eq(broken.timerLog.length, 1, '丢弃非法番茄日志');
  eq(broken.timerLog[0].projectId, broken.projects[0].id, '未知项目并入第一个项目');

  // 删除项目时番茄数据也要迁移，不能丢
  Store.stopTimer();
  Store.importJSON(Store.exportJSON(), 'replace');
  const before = Store.get().timerLog.length;
  const target = Store.get().projects[1].id;
  Store.setTimerConfig({ projectId: target });
  Store.removeProject(target);
  eq(Store.get().timerLog.length, before, '删除项目后番茄日志数量不变');
  eq(Store.get().timerLog.filter(r => r.projectId === target).length, 0, '日志中的项目 id 已迁移');
  eq(Store.get().timer.projectId, Store.get().projects[0].id, '计时器选中的项目已迁移');
});

group('到点提醒设置', () => {
  const storage = fakeStorage();
  Store.init({ storage });
  Store.reset();

  eq(U.formatMinutesLong(5), '5分钟', 'formatMinutesLong(5)');
  eq(U.formatMinutesLong(90), '1小时30分钟', 'formatMinutesLong(90)');
  eq(U.formatMinutesLong(60), '1小时', 'formatMinutesLong(60)');
  eq(U.formatMinutesLong(0), '0分钟', 'formatMinutesLong(0)');

  eq([Store.get().settings.notify, Store.get().settings.sound], [true, true], '提醒默认开启');

  Store.setRemindSettings({ notify: false });
  eq(Store.get().settings.notify, false, '可以关闭系统通知');
  eq(Store.get().settings.sound, true, '关闭通知不影响提示音');

  Store._flush();
  const reloaded = Store.normalizeState(JSON.parse(storage.getItem(Store.STORAGE_KEY)));
  eq([reloaded.settings.notify, reloaded.settings.sound], [false, true], '刷新后提醒设置保留');

  Store.setRemindSettings({ sound: false });
  eq(Store.get().settings.sound, false, '可以关闭提示音');
  Store.setRemindSettings({ notify: true, sound: true });
  eq([Store.get().settings.notify, Store.get().settings.sound], [true, true], '可以重新打开');

  const legacy = Store.normalizeState({ settings: { statsSource: 'records' } });
  eq([legacy.settings.notify, legacy.settings.sound], [true, true], '旧数据没有这两个字段时默认开启');
  const dirty = Store.normalizeState({ settings: { notify: false, sound: 0 } });
  eq([dirty.settings.notify, dirty.settings.sound], [false, true], '非法值按「开启」处理，不会误关提醒');
});

group('不计入学习时长的项目（上课 / 额外睡眠）', () => {
  const state = {
    projects: [
      { id: 'p1', name: '专业课程', color: '#111111', countsAsStudy: true },
      { id: 'p6', name: '上课', color: '#1098ad', countsAsStudy: false },
      { id: 'p7', name: '额外睡眠', color: '#868e96', countsAsStudy: false }
    ],
    records: [
      { id: 'r1', projectId: 'p1', date: '2025-12-08', minutes: 300 },
      { id: 'r2', projectId: 'p6', date: '2025-12-08', minutes: 180 },
      { id: 'r3', projectId: 'p7', date: '2025-12-08', minutes: 60 },
      { id: 'r4', projectId: 'p1', date: '2025-12-09', minutes: 400 }
    ],
    timeline: {}
  };

  eq(S.isStudyProject(state, 'p1'), true, '普通项目计入学习时长');
  eq(S.isStudyProject(state, 'p6'), false, '「上课」不计入学习时长');
  eq(S.isStudyProject(state, '不存在的id'), true, '未知项目（遗留数据）默认计入');

  eq(S.dayTotal(state, 'records', '2025-12-08'), 540, '全部合计 540 分钟');
  eq(S.dayTotal(state, 'records', '2025-12-08', 'study'), 300, '学习合计只算 300 分钟');
  eq(S.dayTotal(state, 'records', '2025-12-08', 'nonstudy'), 240, '非学习合计 240 分钟');

  const week = S.weekStats(state, 'records', '2025-12-08', 360, 'study');
  eq(week.total, 700, '周学习合计 = 300 + 400（不含上课 / 额外睡眠）');
  eq(week.goalDays, 1, '达标天数只按学习时长算（12-08 的 5 小时达标）');
  eq(week.best.date, '2025-12-09', '最长一天按学习时长算');
  eq(week.days[0].total, 300, '12-08 那天只算 300 分钟学习');
  eq(week.projectTotals.map(t => t.projectId), ['p1'], '周图例只含计入学习时长的项目');

  const nonStudy = S.projectTotals(state, 'records', week.dates, 'nonstudy');
  eq(nonStudy, [{ projectId: 'p6', minutes: 180 }, { projectId: 'p7', minutes: 60 }],
    '非学习项目单独统计');

  const all = S.allTimeTotals(state, 'records', 'all');
  const study = S.allTimeTotals(state, 'records', 'study');
  const off = S.allTimeTotals(state, 'records', 'nonstudy');
  eq([all.total, study.total, off.total], [940, 700, 240], '全部 / 学习 / 非学习三种口径');
  eq(study.byProject.p6, undefined, '学习口径里没有上课');
  eq(off.byProject.p6, 180, '非学习口径里有上课');
});

group('夜间睡眠记录', () => {
  const storage = fakeStorage();
  Store.init({ storage });
  Store.reset();

  const today = U.todayStr();
  const yday = U.addDaysStr(today, -1);

  eq(Object.keys(Store.get().sleep).length, 0, '初始没有睡眠记录');
  eq(Store.getSleep(today), null, 'getSleep 空值返回 null');

  // 跨午夜：23:30 → 07:00 = 7.5 小时
  let res = Store.setSleep(today, { bed: 23 * 60 + 30, wake: 7 * 60, note: '睡得不错' });
  ok(res.ok, '写入一晚成功');
  eq(res.duration, 450, '跨午夜算出 7 小时 30 分');
  eq(S.sleepMinutes(Store.get(), today), 450, 'sleepMinutes 取到 450');
  eq(Store.getSleep(today).note, '睡得不错', '备注保存');

  // 同日入睡与起床相同 → 拒绝
  eq(Store.setSleep(yday, { bed: 600, wake: 600 }).reason, 'same-time', '起止相同被拒绝');
  eq(Store.getSleep(yday), null, '被拒绝时不会写入');

  // 不跨午夜：01:00 → 08:30 = 7.5 小时
  res = Store.setSleep(yday, { bed: 60, wake: 8 * 60 + 30 });
  eq(res.duration, 450, '不跨午夜也能算对');

  // 非法输入
  eq(Store.setSleep(today, { bed: 'abc', wake: 480 }).reason, 'invalid-time', '非法时间被拒绝');
  eq(Store.setSleep('2025-13-40', { bed: 60, wake: 480 }).reason, 'invalid-date', '非法日期被拒绝');

  // 月度统计
  const month = today.slice(0, 7);
  const days = S.sleepMonth(Store.get(), month);
  ok(days.length >= 28, '返回整月每一天');
  const sum = S.sleepSummary(Store.get(), month);
  eq(sum.nights, 2, '本月记录了两晚');
  eq(sum.total, 900, '两晚合计 900 分钟');
  eq(sum.average, 450, '平均每晚 7 小时 30 分');
  eq(S.sleepDates(Store.get(), month)[today], 450, 'sleepDates 供日历打点');

  // 持久化
  Store._flush();
  const reloaded = Store.normalizeState(JSON.parse(storage.getItem(Store.STORAGE_KEY)));
  eq(reloaded.sleep[today].duration, 450, '刷新后睡眠记录仍在');
  eq(reloaded.sleep[yday].bed, 60, '第二晚也在');

  // 脏数据
  const dirty = Store.normalizeState({
    sleep: {
      '2025-12-09': { bed: 1500, wake: -60 },      // 越界 → 绕回
      '2025-12-10': { bed: 600, wake: 600 },       // 起止相同 → 丢弃
      '2025-12-11': { bed: 'x', wake: 600 },       // 非法 → 丢弃
      'bad-date': { bed: 60, wake: 480 },
      '2025-12-12': 'not-an-object'
    }
  });
  eq(Object.keys(dirty.sleep), ['2025-12-09'], '只保留合法记录');
  eq(dirty.sleep['2025-12-09'].bed, 60, '入睡 1500 分钟绕回 60（01:00）');
  eq(dirty.sleep['2025-12-09'].wake, 1380, '起床 -60 分钟绕回 1380（23:00）');
  eq(dirty.sleep['2025-12-09'].duration, 1320, '换算后 22 小时');

  // 删除
  Store.removeSleep(today);
  eq(Store.getSleep(today), null, '删除某一晚');
  eq(S.sleepSummary(Store.get(), month).nights, 1, '删除后统计跟着变');

  // 导入导出带上睡眠
  const json = Store.exportJSON();
  Store.reset();
  eq(Object.keys(Store.get().sleep).length, 0, '重置后清空');
  ok(Store.importJSON(json, 'replace').ok, '导入成功');
  eq(S.sleepMinutes(Store.get(), yday), 450, '导入后睡眠记录回来了');
});

group('全局浮窗设置', () => {
  const storage = fakeStorage();
  Store.init({ storage });
  Store.reset();

  eq(Store.get().settings.popup, true, '全局浮窗默认开启');
  Store.setRemindSettings({ popup: false });
  eq(Store.get().settings.popup, false, '可以关闭全局浮窗');
  eq([Store.get().settings.sound, Store.get().settings.notify], [true, true], '不影响其它提醒通道');
  Store._flush();
  const back = Store.normalizeState(JSON.parse(storage.getItem(Store.STORAGE_KEY)));
  eq(back.settings.popup, false, '刷新后设置保留');
  eq(Store.normalizeState({ settings: {} }).settings.popup, true, '旧数据默认开启浮窗');
});

/* ---------------- 汇总 ---------------- */
console.log('\n' + '='.repeat(46));
if (failures.length) {
  console.log('✗ 失败 ' + failures.length + ' 项，通过 ' + passed + ' 项\n');
  failures.forEach(f => console.log('  · ' + f));
  process.exit(1);
} else {
  console.log('✓ 全部通过：' + passed + ' 项断言');
}
