/* ============================================================
 * popup.js —— 番茄计时「全局浮窗」的逻辑
 *
 * 这个浮窗由主页面用 window.open() 打开，是一个独立的浏览器窗口，
 * 所以你在别的软件里也能直接看到它（到点会被主页面 focus 提到最前）。
 *
 * 两个窗口之间不直接互相调用（file:// 下跨窗口访问会被同源策略挡住），
 * 而是共用同一份 localStorage：
 *   - 谁改了数据就立刻落盘（store 已经是即时保存）
 *   - 另一个窗口收到 storage 事件后重新读取并刷新界面
 *
 * 额外职责（看门狗）：主页面在后台时定时器可能被浏览器节流，
 * 而"可见的窗口不会被节流"，所以浮窗在发现「已经过了结束时间但状态还是 running」
 * 时会兜底把这一轮结算掉，保证提醒不会迟到。
 * ============================================================ */
(function () {
  'use strict';

  var U = window.StudyUtil;
  var S = window.StudyStats;
  var Store = window.StudyStore;
  var Remind = window.StudyNotify;

  var el = {};
  var idleSince = 0;

  function cache() {
    ['pp', 'ppDot', 'ppProj', 'ppRound', 'ppClock', 'ppBar', 'ppAsk', 'ppStatus',
      'ppContinue', 'ppStop', 'ppEnd', 'ppClose', 'ppTip'].forEach(function (id) {
      el[id] = document.getElementById(id);
    });
  }

  function currentMeta() {
    var s = Store.get();
    var t = s.timer;
    var pid = S.projectById(s, t.projectId) ? t.projectId : (s.projects[0] && s.projects[0].id);
    return S.projectMeta(s, pid);
  }

  /** 整体刷新（状态切换时调用） */
  function render() {
    var t = Store.get().timer;
    var meta = currentMeta();
    var running = t.status === 'running';
    var prompting = t.status === 'prompt';

    el.ppProj.textContent = meta.name;
    el.ppRound.textContent = '第 ' + t.round + ' 轮';
    el.ppDot.style.background = meta.color;
    document.documentElement.style.setProperty('--pc', meta.color);
    document.title = (prompting ? '⏰ 该确认了！ · ' : '') + meta.name + ' · 番茄计时';

    el.ppAsk.hidden = !prompting;
    el.ppContinue.hidden = !prompting;
    el.ppEnd.hidden = !prompting;
    el.ppStop.hidden = prompting || !running;
    el.ppTip.hidden = running || prompting;

    if (prompting) {
      el.pp.classList.add('is-prompt');
      el.ppStatus.textContent = '本轮已完成，10 秒内确认';
    } else if (running) {
      el.pp.classList.remove('is-prompt');
      el.ppStatus.textContent = '专注中，别走神';
    } else {
      el.pp.classList.remove('is-prompt');
      el.ppClock.textContent = U.formatMMSS(t.durationMin * 60000);
      el.ppBar.style.width = '0%';
      el.ppStatus.textContent = '计时未开始，回主页面点「开始计时」';
      el.ppTip.hidden = false;
      if (!idleSince) idleSince = Date.now();
    }
    if (running || prompting) idleSince = 0;

    tick();
  }

  /** 每秒刷新倒计时数字 */
  function tick() {
    var t = Store.get().timer;
    if (t.status === 'running') {
      var total = t.durationMin * 60000;
      var remain = Math.max(0, t.roundStart + total - Date.now());
      el.ppClock.textContent = U.formatMMSS(remain);
      el.ppBar.style.width = (U.clamp(1 - remain / total, 0, 1) * 100).toFixed(1) + '%';
    } else if (t.status === 'prompt') {
      var left = Math.max(0, t.promptUntil - Date.now());
      el.ppClock.textContent = U.formatMMSS(left);
      el.ppBar.style.width = '100%';
      el.ppStatus.textContent = '还剩 ' + Math.ceil(left / 1000) + ' 秒自动结束';
      /* 询问期结束后自己收起 */
      if (left <= 0) {
        Store.stopTimer();
        render();
      }
    } else if (idleSince && Date.now() - idleSince > 4000) {
      autoClose();   // 计时已经结束，浮窗没必要继续留着
    }
  }

  /**
   * 看门狗：主页面可能被后台节流，这里兜底结算
   * 结算前会重新读一次 localStorage，避免和主页面同时写。
   */
  function watchdog() {
    var t = Store.get().timer;
    if (t.status !== 'running' || !t.roundStart) return;
    var deadline = t.roundStart + t.durationMin * 60000;
    if (Date.now() < deadline + 3000) return;

    Store.init();                                  // 拉一次最新状态
    if (Store.get().timer.status !== 'running') { render(); return; }
    Store.finishRound({ prompt: true });           // 写入时间轴 + 进入询问
    render();
  }

  function autoClose() {
    try { window.close(); } catch (e) { /* 忽略 */ }
  }

  function init() {
    cache();
    Store.init();
    render();

    setInterval(tick, 500);
    setInterval(watchdog, 1500);

    /* 另一个窗口改了数据 → storage 事件 → 重新读并刷新 */
    window.addEventListener('storage', function (e) {
      if (e.key && e.key !== Store.STORAGE_KEY) return;
      Store.init();
      render();
    });

    el.ppContinue.addEventListener('click', function () {
      Remind.ensureAudio();
      Store.continueTimer();
      render();
    });
    el.ppStop.addEventListener('click', function () {
      Store.finishRound({ prompt: false });        // 结算实际时长（不足 5 分钟不写）
      render();
    });
    el.ppEnd.addEventListener('click', function () {
      Store.stopTimer();
      render();
    });
    el.ppClose.addEventListener('click', autoClose);

    /* 首次点击解锁音频，方便后续在浮窗里继续时也能出声 */
    document.addEventListener('pointerdown', function () { Remind.ensureAudio(); }, { once: true });

    /* 浮窗被打开时尽量提到最前 */
    try { window.focus(); } catch (e) { /* 忽略 */ }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
