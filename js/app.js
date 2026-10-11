/* ============================================================
 * app.js —— 界面逻辑：把数据层(store)与渲染模块(chart / timeline)串起来
 *
 * 约定：
 *   - 所有数据修改都通过 StudyStore 的方法完成，改完自动持久化并通知重绘
 *   - 全局只有一个 renderAll()，按 reason 决定需要重绘哪些面板
 * ============================================================ */
(function () {
  'use strict';

  var U = window.StudyUtil;
  var S = window.StudyStats;
  var Store = window.StudyStore;
  var Chart = window.StudyChart;
  var TL = window.StudyTimeline;

  var el = {};
  var editingRecordId = null;      // 正在编辑的学习记录 id
  var blockModal = null;           // { date, id } 当前打开的时间段编辑器
  var quotePending = false;        // 激励语是否有尚未提交的输入
  var lastPromptKey = null;        // 已经提醒过的「轮次:截止时间」，保证一轮只广播一次
  var popupWin = null;             // 全局浮窗（独立小窗口）
  var toastTimer = null;

  /* ============================================================
   * 启动
   * ============================================================ */
  function init() {
    cacheEls();
    bindQuote();
    bindCountdown();
    bindRecordForm();
    bindProjects();
    bindTimelinePanel();
    bindWeekPanel();
    bindBlockModal();
    bindTimer();
    bindCalendar();
    bindSleep();
    bindDataTools();

    Store.init();
    Store.subscribe(onStateChange);
    renderAll();
    /* 刷新时如果正处在询问状态，别再重复弹一次提醒 */
    var t0 = Store.get().timer;
    if (t0.status === 'prompt') lastPromptKey = t0.round + ':' + t0.promptUntil;
    syncRemindSettings();    // 浏览器不允许通知时，把开关对齐到关闭
    restoreTimer();          // 刷新/重开后把未结束的计时接上
    startClocks();
  }

  function cacheEls() {
    [
      'quoteText', 'quoteFontRange', 'quoteFontValue', 'quoteReset',
      'countdownBody', 'cdTitle', 'cdClock', 'cdSub', 'countdownEdit', 'countdownForm',
      'cdTitleInput', 'cdTargetInput', 'cdCancel',
      'tlMode', 'tlPrev', 'tlNext', 'tlToday', 'tlDate', 'tlTotal', 'tlLegend', 'timeline', 'tlHint',
      'panelTimeline',
      'statsSource', 'wkPrev', 'wkNext', 'wkThis', 'wkLabel', 'wkSummary', 'weekChart', 'wkLegend', 'panelWeek',
      'recForm', 'recFormTitle', 'recCancelEdit', 'recProjectChips', 'recDate', 'recHours', 'recMinutes',
      'recNote', 'recSubmit', 'recFilter', 'recList', 'recListTitle', 'recListSum', 'panelRecord',
      'projList', 'projAdd', 'projCount', 'projTotals',
      'dataExport', 'dataImport', 'dataReset', 'importFile',
      'blockModal', 'blockClose', 'blockProjectChips', 'blockStart', 'blockEnd', 'blockNote',
      'blockSave', 'blockDelete', 'blockCancel', 'blockErr',
      'toast', 'chartTip',
      'panelTimer', 'timerRoundHint', 'timerDuration', 'timerProjects', 'timerToday',
      'timerClock', 'timerBar', 'timerStatus', 'timerStart', 'timerStop',
      'timerSound', 'timerNotify', 'timerTest', 'timerNotifyState', 'timerPopup',
      'timerModal', 'timerModalDone', 'timerPromptLeft', 'timerContinue', 'timerEnd', 'timerClose',
      'calToggle', 'calendar', 'tlDateLabel',
      'panelSleep', 'slPrevMonth', 'slMonthLabel', 'slNextMonth', 'slThisMonth', 'sleepForm',
      'slDate', 'slBed', 'slWake', 'slNote', 'slDuration', 'slSave', 'slDelete', 'sleepChart', 'slSummary'
    ].forEach(function (id) { el[id] = document.getElementById(id); });
  }

  function onStateChange(state, reason) {
    if (reason === 'ui') {
      renderToolbars(state);
      renderTimeline(state);
      renderWeek(state);
      renderSleep(state);
      renderCalendar(state);
      return;
    }
    renderAll(state);
  }

  function renderAll(state) {
    state = state || Store.get();
    renderToolbars(state);
    renderQuote(state);
    renderCountdown(state);
    renderProjects(state);
    renderRecordForm(state);
    renderRecords(state);
    renderTimeline(state);
    renderSleep(state);
    renderWeek(state);
    renderTimer(state);
    renderCalendar(state);
  }

  /* ============================================================
   * 顶部：激励语
   * ============================================================ */
  function bindQuote() {
    var commit = U.debounce(function () {
      Store.setQuoteText(el.quoteText.textContent);
      quotePending = false;
    }, 300);

    el.quoteText.addEventListener('input', function () {
      if (el.quoteText.textContent.length > 200) {
        el.quoteText.textContent = el.quoteText.textContent.slice(0, 200);
      }
      quotePending = true;
      commit();
    });
    el.quoteText.addEventListener('blur', function () {
      quotePending = false;
      Store.setQuoteText(el.quoteText.textContent);
    });
    el.quoteText.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); el.quoteText.blur(); }
    });
    /* 粘贴时去掉外部样式，只保留纯文本 */
    el.quoteText.addEventListener('paste', function (e) {
      e.preventDefault();
      var text = (e.clipboardData || window.clipboardData).getData('text') || '';
      if (document.execCommand) document.execCommand('insertText', false, text);
      else el.quoteText.textContent += text;
      commit();
    });

    el.quoteFontRange.addEventListener('input', function () {
      el.quoteFontValue.textContent = el.quoteFontRange.value;
      document.documentElement.style.setProperty('--quote-font', el.quoteFontRange.value + 'px');
    });
    el.quoteFontRange.addEventListener('change', function () {
      Store.setQuoteFontSize(el.quoteFontRange.value);
    });
    el.quoteReset.addEventListener('click', function () {
      Store.resetQuote();
      showToast('已恢复默认激励语');
    });
  }

  function renderQuote(state) {
    document.documentElement.style.setProperty('--quote-font', state.quote.fontSize + 'px');
    el.quoteFontRange.value = state.quote.fontSize;
    el.quoteFontValue.textContent = state.quote.fontSize;
    /* 还有没提交的输入时不要回写，否则会把用户刚敲的字覆盖掉 */
    if (!quotePending && document.activeElement !== el.quoteText) {
      el.quoteText.textContent = state.quote.text;
    }
  }

  /* ============================================================
   * 顶部：倒计时
   * ============================================================ */
  function bindCountdown() {
    el.countdownEdit.addEventListener('click', function () {
      var cd = Store.get().countdown;
      el.cdTitleInput.value = cd.title;
      el.cdTargetInput.value = cd.target;
      el.countdownForm.hidden = false;
      el.cdTitleInput.focus();
    });
    el.cdCancel.addEventListener('click', function () { el.countdownForm.hidden = true; });
    el.countdownForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var target = el.cdTargetInput.value;
      if (!U.parseLocalDateTime(target)) { showToast('请选择合法的目标日期时间'); return; }
      Store.setCountdown({ title: el.cdTitleInput.value, target: target });
      el.countdownForm.hidden = true;
      showToast('倒计时已更新');
    });
    el.countdownForm.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') el.countdownForm.hidden = true;
    });
  }

  function renderCountdown(state) {
    var cd = state.countdown;
    el.cdTitle.textContent = cd.title || '倒计时';
    var target = U.parseLocalDateTime(cd.target);
    if (!target) {
      el.cdClock.textContent = '未设置';
      el.cdClock.classList.add('is-over');
      el.cdSub.textContent = '点击「编辑」设置目标日期';
      return;
    }
    var now = new Date();
    var diff = target.getTime() - now.getTime();
    var parts = U.splitDuration(diff);
    var clock = (parts.hours < 10 ? '0' : '') + parts.hours + ':' +
                (parts.minutes < 10 ? '0' : '') + parts.minutes + ':' +
                (parts.seconds < 10 ? '0' : '') + parts.seconds;
    var targetText = target.getFullYear() + '-' + U.pad2(target.getMonth() + 1) + '-' + U.pad2(target.getDate()) +
      ' ' + U.minutesToHHMM(target.getHours() * 60 + target.getMinutes());

    if (parts.over) {
      el.cdClock.classList.add('is-over');
      el.cdClock.textContent = '已过去 ' + parts.days + ' 天 ' + clock;
      el.cdSub.textContent = '目标时间 ' + targetText + ' 已到，继续加油！';
    } else {
      el.cdClock.classList.remove('is-over');
      el.cdClock.textContent = parts.days + ' 天 ' + clock;
      var weeks = Math.floor(parts.days / 7);
      el.cdSub.textContent = '目标时间 ' + targetText + ' · 约 ' + weeks + ' 周 ' + (parts.days % 7) + ' 天';
    }
  }

  /* ============================================================
   * 学习项目
   * ============================================================ */
  function bindProjects() {
    el.projAdd.addEventListener('click', function () {
      if (!Store.canAddProject()) { showToast('最多只能有 ' + Store.MAX_PROJECTS + ' 个项目'); return; }
      var id = Store.addProject();
      if (id) showToast('已新增项目，可修改名称与颜色');
    });

    /* 事件委托：名称输入、颜色选择、计入开关、删除 */
    el.projList.addEventListener('input', function (e) {
      var row = e.target.closest('.proj-row');
      if (!row) return;
      var id = row.getAttribute('data-id');
      if (e.target.classList.contains('proj-name')) commitProjectName(id, e.target.value);
    });
    el.projList.addEventListener('change', function (e) {
      var row = e.target.closest('.proj-row');
      if (!row) return;
      var id = row.getAttribute('data-id');
      if (e.target.type === 'color') {
        Store.updateProject(id, { color: e.target.value });
        showToast('颜色已更新');
      } else if (e.target.classList.contains('proj-count')) {
        Store.updateProject(id, { countsAsStudy: e.target.checked });
        showToast(e.target.checked ? '该项目已改为计入学习时长' : '该项目已改为不计入学习时长');
      }
    });
    el.projList.addEventListener('click', function (e) {
      var btn = e.target.closest('.proj-del');
      if (!btn) return;
      var row = btn.closest('.proj-row');
      var id = row.getAttribute('data-id');
      var proj = S.projectById(Store.get(), id);
      if (!proj) return;
      if (Store.get().projects.length <= 1) { showToast('至少要保留 1 个学习项目'); return; }
      if (!window.confirm('确定删除项目「' + proj.name + '」吗？\n它下面的学习记录和时间段会并入第一个项目，时长不会丢失。')) return;
      var res = Store.removeProject(id);
      if (res.ok) showToast('已删除，' + res.moved + ' 条数据已并入「' + res.targetName + '」');
    });

    var nameCommit = U.debounce(function (id, value) { Store.updateProject(id, { name: value }); }, 300);
    el.projList.addEventListener('blur', function (e) {
      if (!e.target.classList || !e.target.classList.contains('proj-name')) return;
      var row = e.target.closest('.proj-row');
      if (!row) return;
      var name = e.target.value.trim();
      if (!name) {
        var proj = S.projectById(Store.get(), row.getAttribute('data-id'));
        e.target.value = proj ? proj.name : '未命名项目';
        Store.updateProject(row.getAttribute('data-id'), { name: e.target.value });
      } else {
        Store.updateProject(row.getAttribute('data-id'), { name: name });
      }
    }, true);

    function commitProjectName(id, value) { nameCommit(id, value); }
  }

  function renderProjects(state) {
    var total = state.projects.length;
    el.projCount.textContent = '（' + total + '/' + Store.MAX_PROJECTS + '）';
    el.projAdd.disabled = total >= Store.MAX_PROJECTS;

    var all = S.allTimeTotals(state, state.settings.statsSource, 'all');
    var study = S.allTimeTotals(state, state.settings.statsSource, 'study');
    var nonStudy = S.allTimeTotals(state, state.settings.statsSource, 'nonstudy');

    /* 行结构不变时只更新数值，避免打断正在输入的名称 */
    var sig = state.projects.map(function (p) {
      return p.id + (p.countsAsStudy === false ? '0' : '1');
    }).join(',');
    if (el.projList.getAttribute('data-sig') !== sig) {
      el.projList.innerHTML = state.projects.map(function (p) {
        var isStudy = p.countsAsStudy !== false;
        return '<div class="proj-row' + (isStudy ? '' : ' is-nostudy') + '" data-id="' +
          U.escapeHtml(p.id) + '">' +
          '<input type="color" value="' + p.color + '" title="修改颜色" aria-label="项目颜色">' +
          '<input type="text" class="proj-name" maxlength="12" value="' + U.escapeHtml(p.name) +
            '" aria-label="项目名称">' +
          '<label class="proj-study" title="勾选＝计入学习时长；上课 / 额外睡眠这类可以不勾">' +
            '<input type="checkbox" class="proj-count"' + (isStudy ? ' checked' : '') + '><span>计入</span>' +
          '</label>' +
          '<span class="proj-total" data-total></span>' +
          '<button class="icon-btn danger proj-del" type="button" title="删除项目">✕</button>' +
        '</div>';
      }).join('');
      el.projList.setAttribute('data-sig', sig);
    }

    state.projects.forEach(function (p) {
      var row = el.projList.querySelector('.proj-row[data-id="' + p.id + '"]');
      if (!row) return;
      var nameInput = row.querySelector('.proj-name');
      if (document.activeElement !== nameInput) nameInput.value = p.name;
      var colorInput = row.querySelector('input[type="color"]');
      if (colorInput.value.toLowerCase() !== p.color.toLowerCase()) colorInput.value = p.color;
      var countBox = row.querySelector('.proj-count');
      if (countBox && countBox.checked !== (p.countsAsStudy !== false)) {
        countBox.checked = p.countsAsStudy !== false;
      }
      row.querySelector('[data-total]').textContent = U.formatMinutes(all.byProject[p.id] || 0);
    });

    /* 累计占比条：只画计入学习时长的项目 */
    var studyProjects = state.projects.filter(function (p) { return p.countsAsStudy !== false; });
    var maxMin = studyProjects.reduce(function (m, p) {
      return Math.max(m, study.byProject[p.id] || 0);
    }, 0);
    el.projTotals.innerHTML = studyProjects.map(function (p) {
      var mins = study.byProject[p.id] || 0;
      var w = maxMin > 0 ? (mins / maxMin) * 100 : 0;
      return '<div class="pbar">' +
        '<span class="nm" title="' + U.escapeHtml(p.name) + '">' + U.escapeHtml(p.name) + '</span>' +
        '<span class="track"><span class="fill" style="width:' + w.toFixed(1) + '%;background:' +
          p.color + '"></span></span>' +
        '<span class="vl">' + U.formatMinutes(mins) + '</span>' +
      '</div>';
    }).join('') +
      '<p class="hint">累计学习时长 <b>' + U.formatMinutes(study.total) + '</b>（统计来源：' +
      (state.settings.statsSource === 'timeline' ? '每日时间轴' : '学习记录') + '）</p>' +
      (nonStudy.total > 0
        ? '<p class="hint">未计入学习时长：' + state.projects.filter(function (p) {
            return p.countsAsStudy === false && (nonStudy.byProject[p.id] || 0) > 0;
          }).map(function (p) {
            return U.escapeHtml(p.name) + ' ' + U.formatMinutes(nonStudy.byProject[p.id]);
          }).join(' · ') + '（共 ' + U.formatMinutes(nonStudy.total) + '）</p>'
        : '');
  }

  /* ============================================================
   * 学习记录
   * ============================================================ */
  function bindRecordForm() {
    el.recProjectChips.addEventListener('click', function (e) {
      var chip = e.target.closest('.chip');
      if (!chip) return;
      Store.setUI({ recProjectId: chip.getAttribute('data-id') }, 'chips');
      renderRecordForm(Store.get());
    });

    /* 快捷时长按钮：累加到当前时长输入框 */
    el.recForm.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-add-min]');
      if (!btn) return;
      var add = Number(btn.getAttribute('data-add-min'));
      var total = currentFormMinutes() + add;
      setFormMinutes(Math.min(total, 24 * 60 - 1));
    });

    el.recHours.addEventListener('input', normalizeFormMinutes);
    el.recMinutes.addEventListener('input', normalizeFormMinutes);

    el.recForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var minutes = currentFormMinutes();
      if (minutes <= 0) { showToast('请填写大于 0 的学习时长'); el.recHours.focus(); return; }
      var projectId = activeRecProjectId();
      var date = U.isValidDateStr(el.recDate.value) ? el.recDate.value : U.todayStr();
      var note = el.recNote.value.trim();

      if (editingRecordId) {
        Store.updateRecord(editingRecordId, { projectId: projectId, date: date, minutes: minutes, note: note });
        editingRecordId = null;
        el.recFormTitle.textContent = '添加学习记录';
        el.recSubmit.textContent = '保存记录';
        el.recCancelEdit.hidden = true;
        showToast('已更新记录');
      } else {
        Store.addRecord({ projectId: projectId, date: date, minutes: minutes, note: note });
        showToast('已记录 ' + U.formatMinutes(minutes));
      }
      /* 保留项目与日期，清空时长和备注，方便连续记录 */
      el.recNote.value = '';
      setFormMinutes(60);
      el.recNote.focus();
    });

    el.recCancelEdit.addEventListener('click', function () { cancelRecordEdit(); });

    el.recFilter.addEventListener('click', function (e) {
      var btn = e.target.closest('.seg-btn');
      if (!btn) return;
      Store.setUI({ recFilter: btn.getAttribute('data-filter') }, 'filter');
      renderToolbars(Store.get());
      renderRecords(Store.get());
    });

    el.recList.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-act]');
      if (!btn) return;
      var id = btn.closest('.rec-item').getAttribute('data-id');
      if (btn.getAttribute('data-act') === 'del') {
        Store.removeRecord(id);
        if (editingRecordId === id) cancelRecordEdit();
        showToast('已删除记录');
      } else {
        startRecordEdit(id);
      }
    });
  }

  function activeRecProjectId() {
    var state = Store.get();
    var id = state.ui.recProjectId;
    return S.projectById(state, id) ? id : state.projects[0].id;
  }

  function currentFormMinutes() {
    return (Number(el.recHours.value) || 0) * 60 + (Number(el.recMinutes.value) || 0);
  }

  function setFormMinutes(total) {
    var m = U.clamp(Math.round(total), 0, 24 * 60 - 1);
    el.recHours.value = Math.floor(m / 60);
    el.recMinutes.value = m % 60;
  }

  function normalizeFormMinutes() {
    var h = U.clamp(Number(el.recHours.value) || 0, 0, 23);
    var m = U.clamp(Number(el.recMinutes.value) || 0, 0, 59);
    el.recHours.value = h;
    el.recMinutes.value = m;
  }

  function renderRecordForm(state) {
    el.recDate.value = el.recDate.value && U.isValidDateStr(el.recDate.value) ? el.recDate.value : state.ui.tlDate || U.todayStr();
    var active = activeRecProjectId();
    var sig = state.projects.map(function (p) { return p.id; }).join(',') + '|' + active;
    if (el.recProjectChips.getAttribute('data-sig') !== sig) {
      el.recProjectChips.innerHTML = state.projects.map(function (p) {
        return '<button type="button" class="chip' + (p.id === active ? ' is-active' : '') + '" data-id="' +
          U.escapeHtml(p.id) + '" style="color:' + p.color + '">' +
          '<i class="dot" style="background:' + p.color + '"></i>' + U.escapeHtml(p.name) + '</button>';
      }).join('');
      el.recProjectChips.setAttribute('data-sig', sig);
    }
    if (!el.recHours.value) setFormMinutes(60);
  }

  function startRecordEdit(id) {
    var state = Store.get();
    var rec = state.records.filter(function (r) { return r.id === id; })[0];
    if (!rec) return;
    editingRecordId = id;
    Store.setUI({ recProjectId: rec.projectId }, 'chips');
    el.recProjectChips.innerHTML = '';
    el.recProjectChips.removeAttribute('data-sig');
    renderRecordForm(Store.get());
    el.recDate.value = rec.date;
    setFormMinutes(rec.minutes);
    el.recNote.value = rec.note || '';
    el.recFormTitle.textContent = '编辑学习记录';
    el.recSubmit.textContent = '保存修改';
    el.recCancelEdit.hidden = false;
    el.panelRecord.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function cancelRecordEdit() {
    editingRecordId = null;
    el.recFormTitle.textContent = '添加学习记录';
    el.recSubmit.textContent = '保存记录';
    el.recCancelEdit.hidden = true;
    el.recNote.value = '';
    setFormMinutes(60);
  }

  function renderRecords(state) {
    var filter = state.ui.recFilter;
    var dates = filter === 'week' ? U.weekDates(U.todayStr(), 1) : null;
    var list = state.records.filter(function (r) {
      return !dates || dates.indexOf(r.date) !== -1;
    });

    el.recListTitle.textContent = filter === 'week' ? '本周记录' : '全部记录';

    if (!list.length) {
      el.recList.innerHTML = '<li class="empty-line">' +
        (filter === 'week' ? '本周还没有记录，在上面添加一条吧' : '还没有任何学习记录') + '</li>';
      el.recListSum.textContent = '';
      return;
    }

    el.recList.innerHTML = list.map(function (r) {
      var meta = S.projectMeta(state, r.projectId);
      var isStudy = S.isStudyProject(state, r.projectId);
      return '<li class="rec-item" data-id="' + U.escapeHtml(r.id) + '">' +
        '<i class="rec-bar" style="background:' + meta.color + '"></i>' +
        '<div class="rec-main">' +
          '<div class="rec-top">' +
            '<span class="rec-proj" style="color:' + meta.color + '">' + U.escapeHtml(meta.name) + '</span>' +
            (isStudy ? '' : '<span class="proj-nostudy-tag">不计入</span>') +
            '<span class="rec-dur">' + U.formatMinutes(r.minutes) + '</span>' +
          '</div>' +
          '<div class="rec-sub">' + U.formatDateCN(r.date) + (r.note ? ' · ' + U.escapeHtml(r.note) : '') + '</div>' +
        '</div>' +
        '<div class="rec-acts">' +
          '<button class="icon-btn" type="button" data-act="edit" title="编辑">✎</button>' +
          '<button class="icon-btn danger" type="button" data-act="del" title="删除">✕</button>' +
        '</div>' +
      '</li>';
    }).join('');

    var sum = 0, nonSum = 0;
    list.forEach(function (r) {
      if (S.isStudyProject(state, r.projectId)) sum += r.minutes;
      else nonSum += r.minutes;
    });
    el.recListSum.textContent = (filter === 'week' ? '本周' : '全部') + '共 ' + list.length + ' 条 · 学习 ' +
      U.formatMinutes(sum) + (nonSum > 0 ? '（另有 ' + U.formatMinutes(nonSum) + ' 不计入）' : '');
  }

  /* ============================================================
   * 每日时间轴
   * ============================================================ */
  function bindTimelinePanel() {
    el.tlMode.addEventListener('click', function (e) {
      var btn = e.target.closest('.seg-btn');
      if (!btn) return;
      Store.setUI({ tlMode: btn.getAttribute('data-mode') }, 'ui');
    });
    el.tlPrev.addEventListener('click', function () { stepTimeline(-1); });
    el.tlNext.addEventListener('click', function () { stepTimeline(1); });
    el.tlToday.addEventListener('click', function () { setTimelineDate(U.todayStr()); });
    el.tlDate.addEventListener('change', function () {
      if (!U.isValidDateStr(el.tlDate.value)) return;
      setTimelineDate(el.tlDate.value);
    });

    el.tlLegend.addEventListener('click', function (e) {
      var chip = e.target.closest('.chip');
      if (!chip) return;
      Store.setUI({ tlProjectId: chip.getAttribute('data-id') }, 'ui');
    });
  }

  function stepTimeline(dir) {
    var state = Store.get();
    var step = state.ui.tlMode === 'week' ? 7 * dir : dir;
    setTimelineDate(U.addDaysStr(state.ui.tlDate, step), state.ui.tlMode);
  }

  /**
   * 切换时间轴日期（统一入口）。
   * 日期一变，正在编辑的那根色块就失效了，所以这里会顺手关掉时间段弹窗，
   * 避免出现「换了日期弹窗还留着 / 弹窗里改的是另一天数据」的状态不同步。
   */
  function setTimelineDate(date, mode) {
    if (!U.isValidDateStr(date)) return;
    if (!el.blockModal.hidden) closeBlockModal();
    el.recDate.value = date;                 // 记录表单跟着切到同一天，方便补记
    Store.setUI({ tlMode: mode || 'day', tlDate: date }, 'ui');
  }

  function activeTlProjectId() {
    var state = Store.get();
    var id = state.ui.tlProjectId;
    return S.projectById(state, id) ? id : state.projects[0].id;
  }

  function renderTimeline(state) {
    var ui = state.ui;
    var mode = ui.tlMode;
    var date = U.isValidDateStr(ui.tlDate) ? ui.tlDate : U.todayStr();

    setSegActive(el.tlMode, 'data-mode', mode);
    el.tlDate.value = date;
    var isToday = date === U.todayStr();
    el.tlDateLabel.textContent = U.formatDateCN(date) + (isToday ? '（今天）' : '') +
      (mode === 'week' ? ' · 整周视图' : '');
    el.tlDateLabel.classList.toggle('is-today', isToday);
    el.tlTotal.innerHTML = mode === 'week'
      ? '本周合计 <b>' + U.formatMinutes(weekRangeTotal(state, U.weekDates(date, 1))) + '</b>'
      : U.formatDateCN(date) + ' 合计 <b>' + U.formatMinutes(dayTimelineTotal(state, date)) + '</b>';
    el.tlHint.textContent = mode === 'week'
      ? '整周视图用于整体浏览：点击任意色块即可切换到那天的单日视图并打开编辑器。'
      : '在轨道上按住拖动即可写入时间段；拖动色块可整体移动，拖动左右边缘可调整起止；单击色块可修改或删除。';

    /* 画笔图例 */
    var active = activeTlProjectId();
    el.tlLegend.innerHTML = state.projects.map(function (p) {
      return '<button type="button" class="chip' + (p.id === active ? ' is-active' : '') + '" data-id="' +
        U.escapeHtml(p.id) + '" style="color:' + p.color + '" title="设为当前画笔颜色">' +
        '<i class="dot" style="background:' + p.color + '"></i>' + U.escapeHtml(p.name) + '</button>';
    }).join('') + '<span class="hint" style="margin:0">选择颜色后，在时间轴上拖动即可写入对应项目</span>';

    TL.render(el.timeline, {
      state: state,
      mode: mode,
      date: date,
      activeProjectId: active,
      onCreate: function (d, block) {
        Store.addBlock(d, block);
        showToast('已添加 ' + U.minutesToHHMM(block.start) + '–' + U.minutesToHHMM(block.end) + ' 的时间段');
      },
      onChange: function (d, id, patch) {
        Store.updateBlock(d, id, patch);
      },
      onOpenEditor: function (d, id) { openBlockModal(d, id); }
    });
  }

  function dayTimelineTotal(state, date) {
    return (state.timeline[date] || []).reduce(function (s, b) { return s + Math.max(0, b.end - b.start); }, 0);
  }

  function weekRangeTotal(state, dates) {
    return dates.reduce(function (s, d) { return s + dayTimelineTotal(state, d); }, 0);
  }

  /* ============================================================
   * 时间段编辑器（浮层）
   * ============================================================ */
  function bindBlockModal() {
    /* 关闭方式一：底部「取消」按钮 */
    el.blockCancel.addEventListener('click', function () { closeBlockModal(); });
    /* 关闭方式二：右上角「✕」按钮 */
    if (el.blockClose) el.blockClose.addEventListener('click', function () { closeBlockModal(); });

    /* 关闭方式三：点弹窗外的灰色遮罩。
       要求「按下」和「抬起」都发生在遮罩上才关闭，避免在弹窗里选中文字拖到外面时被误关。 */
    var maskPressed = false;
    el.blockModal.addEventListener('pointerdown', function (e) {
      maskPressed = (e.target === el.blockModal);
    });
    el.blockModal.addEventListener('click', function (e) {
      var onMask = (e.target === el.blockModal);
      if (maskPressed && onMask) closeBlockModal();
      maskPressed = false;
    });

    /* 关闭方式四：Esc 键（弹窗打开时才生效，不影响其它面板） */
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape' && e.key !== 'Esc') return;
      if (el.blockModal.hidden) return;
      e.preventDefault();
      closeBlockModal();
    });

    el.blockProjectChips.addEventListener('click', function (e) {
      var chip = e.target.closest('.chip');
      if (!chip) return;
      setChipsActive(el.blockProjectChips, chip.getAttribute('data-id'));
    });

    el.blockSave.addEventListener('click', function () {
      if (!blockModal) return;
      var start = U.hhmmToMinutes(el.blockStart.value);
      var end = U.hhmmToMinutes(el.blockEnd.value);
      if (start === null || end === null) { showErr('请填写完整的开始与结束时间'); return; }
      if (start < U.DAY_START) { showErr('时间轴范围是 6:00 – 24:00，开始时间不能早于 6:00'); return; }
      if (end > U.DAY_END) { showErr('时间轴范围是 6:00 – 24:00，结束时间不能晚于 24:00'); return; }
      if (end - start < U.SNAP) { showErr('结束时间需要晚于开始时间（至少 5 分钟）'); return; }

      var projectId = activeChipId(el.blockProjectChips);
      var conflicts = S.findConflicts(Store.getBlocks(blockModal.date), start, end, blockModal.id);
      Store.updateBlock(blockModal.date, blockModal.id, {
        start: start, end: end, projectId: projectId, note: el.blockNote.value.trim()
      });
      closeBlockModal();
      showToast(conflicts.length
        ? '已保存，与另外 ' + conflicts.length + ' 个时间段重叠（已并排显示）'
        : '时间段已更新');
    });

    el.blockDelete.addEventListener('click', function () {
      if (!blockModal) return;
      Store.removeBlock(blockModal.date, blockModal.id);
      closeBlockModal();
      showToast('已删除该时间段');
    });

    function showErr(msg) {
      el.blockErr.textContent = msg;
      el.blockErr.hidden = false;
    }
  }

  function openBlockModal(date, id) {
    var state = Store.get();
    if (state.ui.tlMode !== 'day' || state.ui.tlDate !== date) {
      Store.setUI({ tlMode: 'day', tlDate: date }, 'ui');
      state = Store.get();
    }
    var block = (state.timeline[date] || []).filter(function (b) { return b.id === id; })[0];
    if (!block) return;
    blockModal = { date: date, id: id };
    el.blockErr.hidden = true;
    el.blockStart.value = U.minutesToHHMM(block.start);
    el.blockEnd.value = U.minutesToHHMM(block.end);
    el.blockNote.value = block.note || '';
    el.blockProjectChips.innerHTML = state.projects.map(function (p) {
      return '<button type="button" class="chip' + (p.id === block.projectId ? ' is-active' : '') +
        '" data-id="' + U.escapeHtml(p.id) + '" style="color:' + p.color + '">' +
        '<i class="dot" style="background:' + p.color + '"></i>' + U.escapeHtml(p.name) + '</button>';
    }).join('');
    el.blockModal.hidden = false;
    el.blockStart.focus();
  }

  function closeBlockModal() {
    blockModal = null;                 // 清掉「当前正在编辑哪一根色块」的内存状态
    el.blockModal.hidden = true;       // hidden 属性配合 CSS 的 [hidden]{display:none!important} 真正隐藏
    el.blockErr.hidden = true;
    el.blockErr.textContent = '';
    el.blockProjectChips.innerHTML = '';
    el.blockNote.value = '';
    el.blockStart.value = '';
    el.blockEnd.value = '';
    Array.prototype.forEach.call(document.querySelectorAll('.tl-block.is-selected'), function (b) {
      b.classList.remove('is-selected');
    });
  }

  function activeChipId(container) {
    var chip = container.querySelector('.chip.is-active');
    if (chip) return chip.getAttribute('data-id');
    var first = container.querySelector('.chip');
    return first ? first.getAttribute('data-id') : Store.get().projects[0].id;
  }

  function setChipsActive(container, id) {
    Array.prototype.forEach.call(container.querySelectorAll('.chip'), function (c) {
      c.classList.toggle('is-active', c.getAttribute('data-id') === id);
    });
  }

  /* ============================================================
   * 每周统计
   * ============================================================ */
  function bindWeekPanel() {
    el.statsSource.addEventListener('click', function (e) {
      var btn = e.target.closest('.seg-btn');
      if (!btn) return;
      Store.setStatsSource(btn.getAttribute('data-source'));
      showToast('统计来源已切换为「' + btn.textContent + '」');
    });
    el.wkPrev.addEventListener('click', function () { stepWeek(-7); });
    el.wkNext.addEventListener('click', function () { stepWeek(7); });
    el.wkThis.addEventListener('click', function () { Store.setUI({ weekAnchor: U.todayStr() }, 'ui'); });

    window.addEventListener('resize', U.debounce(function () { renderWeek(Store.get()); }, 150));
    if (window.ResizeObserver) {
      var ro = new ResizeObserver(U.debounce(function () { renderWeek(Store.get()); }, 120));
      ro.observe(el.weekChart);
    }
  }

  function stepWeek(days) {
    Store.setUI({ weekAnchor: U.addDaysStr(Store.get().ui.weekAnchor, days) }, 'ui');
  }

  function renderWeek(state) {
    var source = state.settings.statsSource;
    var anchor = U.isValidDateStr(state.ui.weekAnchor) ? state.ui.weekAnchor : U.todayStr();
    /* 只统计「计入学习时长」的项目：上课 / 额外睡眠 不参与 6 小时目标 */
    var week = S.weekStats(state, source, anchor, U.DAILY_GOAL, 'study');
    var nonStudy = S.projectTotals(state, source, week.dates, 'nonstudy');
    var thisWeek = U.weekDates(U.todayStr(), 1);

    setSegActive(el.statsSource, 'data-source', source);
    el.wkLabel.textContent = week.start.slice(0, 4) + ' 年 ' + week.start.slice(5) + ' ~ ' + week.end.slice(5) +
      (week.start === thisWeek[0] ? '（本周）' : '');

    el.wkSummary.innerHTML = [
      statCard('周合计', U.formatMinutes(week.total)),
      statCard('日均（7 天）', U.formatMinutes(week.average)),
      statCard('达标天数', week.goalDays + ' / 7', week.goalDays > 0),
      statCard('最长一天', week.best ? U.formatDateCN(week.best.date) + ' ' + U.formatMinutes(week.best.total) : '—')
    ].join('');

    Chart.renderWeekly(el.weekChart, {
      state: state,
      week: week,
      tipEl: el.chartTip,
      emptyText: source === 'timeline' ? '这一周的时间轴还是空的' : '这一周还没有学习记录',
      onSelectDate: function (date) {
        setTimelineDate(date);
        el.panelTimeline.scrollIntoView({ behavior: 'smooth', block: 'start' });
        showToast('已切换到 ' + U.formatDateCN(date) + ' 的时间轴');
      }
    });

    /* 图例：本周各项目时长（只含计入学习时长的项目） */
    var legendHtml = '';
    if (!week.projectTotals.length) {
      legendHtml = '<span class="hint" style="margin:0">本周暂无学习数据，先在右侧添加学习记录，或在时间轴上写入时间段。</span>';
    } else {
      legendHtml = week.projectTotals.map(function (t) {
        var meta = S.projectMeta(state, t.projectId);
        var share = week.total > 0 ? Math.round((t.minutes / week.total) * 100) : 0;
        return '<span class="lg"><i class="sw" style="background:' + meta.color + '"></i>' +
          U.escapeHtml(meta.name) + '<span class="mn">' + U.formatMinutes(t.minutes) + ' · ' + share + '%</span></span>';
      }).join('');
    }
    if (nonStudy.length) {
      legendHtml += '<span class="hint" style="margin:0;flex-basis:100%">未计入学习时长：' +
        nonStudy.map(function (t) {
          var meta = S.projectMeta(state, t.projectId);
          return U.escapeHtml(meta.name) + ' ' + U.formatMinutes(t.minutes);
        }).join(' · ') + '</span>';
    }
    el.wkLegend.innerHTML = legendHtml;
  }

  function statCard(label, value, highlight) {
    return '<div class="stat' + (highlight ? ' is-goal' : '') + '">' +
      '<div class="k">' + label + '</div><div class="v">' + U.escapeHtml(value) + '</div></div>';
  }

  /* ============================================================
   * 顶栏按钮状态 / 数据导入导出
   * ============================================================ */
  function renderToolbars(state) {
    setSegActive(el.tlMode, 'data-mode', state.ui.tlMode);
    setSegActive(el.statsSource, 'data-source', state.settings.statsSource);
    setSegActive(el.recFilter, 'data-filter', state.ui.recFilter);
  }

  function setSegActive(container, attr, value) {
    if (!container) return;
    Array.prototype.forEach.call(container.querySelectorAll('.seg-btn'), function (b) {
      b.classList.toggle('is-active', b.getAttribute(attr) === value);
    });
  }

  function bindDataTools() {
    el.dataExport.addEventListener('click', function () {
      var blob = new Blob([Store.exportJSON()], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = '学习时长记录-' + U.todayStr() + '.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      showToast('已导出 JSON 备份');
    });

    el.dataImport.addEventListener('click', function () { el.importFile.click(); });
    el.importFile.addEventListener('change', function () {
      var file = el.importFile.files && el.importFile.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        var mode = window.confirm('点「确定」= 与现有数据合并；点「取消」= 覆盖现有数据。\n（覆盖会替换当前全部数据）')
          ? 'merge' : 'replace';
        var res = Store.importJSON(String(reader.result), mode);
        if (!res.ok) { showToast('导入失败：' + res.error); return; }
        showToast(mode === 'merge' ? '已合并导入的数据' : '已用导入数据覆盖');
        renderAll();
      };
      reader.onerror = function () { showToast('读取文件失败'); };
      reader.readAsText(file);
      el.importFile.value = '';
    });

    el.dataReset.addEventListener('click', function () {
      if (!window.confirm('确定清空全部数据吗？\n激励语、倒计时、项目、学习记录、时间轴都会恢复到初始状态（此操作不可撤销）。')) return;
      Store.reset();
      cancelRecordEdit();
      showToast('已清空并恢复初始数据');
    });
  }

  /* ============================================================
   * 时钟：倒计时逐秒刷新，时间轴「现在」线定期更新
   * ============================================================ */
  function startClocks() {
    setInterval(function () {
      renderCountdown(Store.get());
      tickTimer();                       // 番茄计时秒针 + 到时兜底
    }, 1000);

    var lastToday = U.todayStr();
    setInterval(function () {
      var now = U.todayStr();
      if (now !== lastToday) { lastToday = now; renderAll(); return; }   // 跨天：整体刷新
      TL.updateNowLine(el.timeline, { mode: Store.get().ui.tlMode, date: Store.get().ui.tlDate });
    }, 30000);

    /* 从别的标签页切回来时，重新同步一次数据与计时状态 */
    window.addEventListener('storage', function (e) {
      if (e.key === Store.STORAGE_KEY) {
        Store.init();
        renderAll();
        restoreTimer();
      }
    });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState !== 'visible') return;
      renderCountdown(Store.get());
      tickTimer();
      /* 人已经回到页面了：系统通知和标题闪烁就没必要继续了 */
      var t = Store.get().timer;
      if (t.status === 'prompt') {
        clearRemind();
        if (el.timerContinue) el.timerContinue.focus();
      } else if (Remind.isAttentionOn()) {
        clearRemind();
      }
    });
  }

  /* ============================================================
   * 番茄计时器
   * 状态机由 store 保存（idle / running / prompt），界面只按状态渲染；
   * 每秒只更新文字与进度条，不写 store，避免每秒落盘。
   * ============================================================ */
  var roundTimer = null;    // 「本轮结束」的定时器
  var promptTimer = null;   // 「询问弹窗 10 秒」的定时器
  var Remind = window.StudyNotify;   // 到点提醒：系统通知 / 提示音 / 标题图标 / 任务栏角标

  function bindTimer() {
    el.timerProjects.addEventListener('click', function (e) {
      var chip = e.target.closest('.chip');
      if (!chip) return;
      Store.setTimerConfig({ projectId: chip.getAttribute('data-id') });
    });

    el.timerDuration.addEventListener('change', function () {
      Store.setTimerConfig({ durationMin: Number(el.timerDuration.value) });
      showToast('每轮时长已设为 ' + el.timerDuration.value + ' 分钟');
    });

    el.timerSound.addEventListener('change', function () {
      Store.setRemindSettings({ sound: el.timerSound.checked });
      if (el.timerSound.checked) { Remind.ensureAudio(); Remind.chime(1); }
    });
    el.timerNotify.addEventListener('change', function () {
      if (el.timerNotify.checked) {
        Store.setRemindSettings({ notify: true });   // 先记住用户意图，再确认/申请权限
        requestNotifyPermission(true);
      } else {
        Store.setRemindSettings({ notify: false });
      }
    });
    el.timerTest.addEventListener('click', function () { testRemind(); });

    /* 全局浮窗开关 */
    el.timerPopup.addEventListener('change', function () {
      var on = el.timerPopup.checked;
      Store.setRemindSettings({ popup: on });
      if (on) {
        var st = Store.get().timer;
        if (st.status === 'running' || st.status === 'prompt') openPopup();
        else showToast('已开启全局浮窗：开始计时时会自动打开');
      } else {
        closePopup();
      }
    });

    el.timerStart.addEventListener('click', function () {
      if (Store.get().timer.status !== 'idle') return;
      /* 音视频解锁、通知授权都必须发生在用户手势里 */
      Remind.ensureAudio();
      if (Store.get().settings.notify) requestNotifyPermission(false);
      Store.startTimer();
      var st = Store.get();
      if (!S.projectById(st, st.timer.projectId)) {
        showToast('请先选择一个学习项目');
        Store.stopTimer();
        return;
      }
      if (Store.get().settings.sound) Remind.startKeepAlive();
      scheduleRound(st);
      if (Store.get().settings.popup) openPopup();   // 必须在用户手势里开，否则会被弹窗拦截
      showToast('开始专注：' + U.formatMinutes(st.timer.durationMin));
    });

    el.timerStop.addEventListener('click', function () { stopTimerRound('manual'); });
    el.timerContinue.addEventListener('click', function () { continueTimerRound(); });
    el.timerEnd.addEventListener('click', function () { stopTimerRound('prompt-end'); });
    el.timerClose.addEventListener('click', function () { stopTimerRound('prompt-close'); });

    /* 点遮罩 = 结束计时（同样要求按下与抬起都在遮罩上） */
    var maskPressed = false;
    el.timerModal.addEventListener('pointerdown', function (e) {
      maskPressed = (e.target === el.timerModal);
    });
    el.timerModal.addEventListener('click', function (e) {
      if (maskPressed && e.target === el.timerModal) stopTimerRound('prompt-mask');
      maskPressed = false;
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape' && e.key !== 'Esc') return;
      if (el.timerModal.hidden) return;
      e.preventDefault();
      stopTimerRound('prompt-esc');
    });
  }

  function clearRoundTimers() {
    if (roundTimer) { clearTimeout(roundTimer); roundTimer = null; }
    if (promptTimer) { clearTimeout(promptTimer); promptTimer = null; }
  }

  /** 按 roundStart 排好「本轮结束」的定时器（刷新恢复后也走这里） */
  function scheduleRound(state) {
    clearRoundTimers();
    var t = state.timer;
    if (t.status !== 'running' || !t.roundStart) { tickTimer(); return; }
    var remain = t.roundStart + t.durationMin * 60000 - Date.now();
    roundTimer = setTimeout(function () {
      roundTimer = null;
      completeRound();
    }, Math.max(0, remain));
    tickTimer();
  }

  /** 按 promptUntil 排好「10 秒自动结束」的定时器 */
  function schedulePrompt(state) {
    if (promptTimer) { clearTimeout(promptTimer); promptTimer = null; }
    var t = state.timer;
    if (t.status !== 'prompt' || !t.promptUntil) { tickTimer(); return; }
    promptTimer = setTimeout(function () {
      promptTimer = null;
      stopTimerRound('timeout');
    }, Math.max(0, t.promptUntil - Date.now()));
    tickTimer();
  }

  /** 一轮自然到时：写时间轴 + 弹询问（提醒广播由 renderTimer 在状态切换时统一触发） */
  function completeRound() {
    if (Store.get().timer.status !== 'running') return;
    var res = Store.finishRound({ prompt: true });
    handleRoundResult(res);
    if (res.prompt) schedulePrompt(Store.get());
  }

  /* ---------------- 到点提醒：让「别的软件里」也能收到 ---------------- */

  /* ---- 全局浮窗：一个独立的小窗口，切到别的软件也能看到 ---- */

  var POPUP_NAME = 'study-timer-popup';
  var POPUP_FEATURES = 'width=372,height=316,resizable=yes,scrollbars=no,status=no,location=no,popup=yes';

  function openPopup() {
    if (popupWin && !popupWin.closed) { focusPopup(); return popupWin; }
    try {
      popupWin = window.open('timer-popup.html', POPUP_NAME, POPUP_FEATURES);
    } catch (e) {
      popupWin = null;
    }
    if (!popupWin || popupWin.closed) {
      popupWin = null;
      showToast('全局浮窗被浏览器拦截了：请在地址栏右侧允许本页弹出窗口');
      return null;
    }
    return popupWin;
  }

  function focusPopup() {
    if (popupWin && !popupWin.closed) {
      try { popupWin.focus(); } catch (e) { /* 跨窗口 focus 失败就忽略 */ }
      return true;
    }
    return false;
  }

  function closePopup() {
    if (popupWin && !popupWin.closed) {
      try { popupWin.close(); } catch (e) { /* 忽略 */ }
    }
    popupWin = null;
  }

  function requestNotifyPermission(explicit) {
    if (typeof window.Notification === 'undefined') {
      Store.setRemindSettings({ notify: false });
      if (explicit) showToast('当前浏览器不支持系统通知，已用提示音 + 标题闪烁提醒');
      renderTimer(Store.get());
      return;
    }
    if (window.Notification.permission === 'granted') {
      Store.setRemindSettings({ notify: true });
      if (explicit) showToast('系统通知已开启');
      renderTimer(Store.get());
      return;
    }
    if (window.Notification.permission === 'denied') {
      Store.setRemindSettings({ notify: false });
      if (explicit) showToast('浏览器已拒绝通知权限，请在地址栏左侧的站点设置里允许通知');
      renderTimer(Store.get());
      return;
    }
    Remind.requestPermission(function (res) {
      var ok = res === 'granted';
      Store.setRemindSettings({ notify: ok });
      if (ok) showToast('已开启系统通知，切到别的软件也能收到提醒');
      else if (explicit) showToast('未获得通知权限，将改用提示音 + 标题闪烁提醒');
      renderTimer(Store.get());
    });
  }

  /** 启动时对齐一次：浏览器根本不允许通知时，就别让开关僵在「开」 */
  function syncRemindSettings() {
    var perm = Remind.permission();
    if ((perm === 'denied' || perm === 'unsupported') && Store.get().settings.notify) {
      Store.setRemindSettings({ notify: false });
    }
  }

  /** 到点时把所有能用的通道都广播一遍（一轮只调用一次） */
  function remindRoundEnd(minutes) {
    var state = Store.get();
    var meta = S.projectMeta(state, state.timer.projectId);
    var mins = minutes || state.timer.durationMin;
    var title = '⏰ 本轮结束，是否还在学习？';
    var body = '【' + meta.name + '】已完成 ' + U.formatMinutesLong(mins) +
      '（第 ' + state.timer.round + ' 轮）\n回到页面点「继续」开始下一轮，10 秒后自动结束。';

    focusPopup();                                       // 通道 0：把全局浮窗提到最前
    if (state.settings.sound) Remind.chime(2);          // 通道 2：提示音
    if (state.settings.notify) {                        // 通道 1：系统通知
      Remind.show({
        title: title,
        body: body,
        silent: state.settings.sound,                   // 自己已经响了，就别让系统再响一次
        onClick: function () { focusTimerPrompt(); }
      });
    }
    Remind.setAttention(true, '⏰ 该确认了！');           // 通道 3/4：标题闪烁 + 图标变红 + 任务栏角标
  }

  /** 兼容直接调用：提醒弹窗出现后，点系统通知回到页面 */
  function focusTimerPrompt() {
    try { window.focus(); } catch (e) { /* 忽略 */ }
  }

  /** 收起所有「求关注」提醒（点继续 / 结束 / 超时 / 回到页面时调用） */
  function clearRemind() {
    Remind.closeNotification();
    Remind.setAttention(false);
  }

  /** 「试一下」：立刻走一遍完整提醒通道 */
  function testRemind() {
    var state = Store.get();
    var meta = S.projectMeta(state, state.timer.projectId || (state.projects[0] && state.projects[0].id));
    Remind.ensureAudio();
    if (state.settings.sound) Remind.chime(2);
    if (state.settings.notify && window.Notification && window.Notification.permission === 'default') {
      requestNotifyPermission(true);
    }
    if (state.settings.notify) {
      Remind.show({
        title: '⏰ 提醒测试',
        body: '如果你看到了这条系统通知，说明到点提醒已经能穿透到其它软件。\n项目：' + meta.name,
        silent: state.settings.sound
      });
    }
    Remind.setAttention(true, '⏰ 提醒测试');
    setTimeout(function () { if (!Store.get().timer || Store.get().timer.status !== 'prompt') clearRemind(); }, 4000);
    showToast(state.settings.notify ? '已发出测试提醒' : '系统通知未开启，仅播放提示音');
  }

  /** 把「这一轮写到哪了」统一反馈给用户 */
  function handleRoundResult(res) {
    if (!res) return;
    if (res.ok) {
      var where = res.date === U.todayStr() ? '今天' : (U.formatDateCN(res.date) + ' ');
      showToast('本轮 ' + U.formatMinutesLong(res.minutes) + ' 已记入' + where + '的时间轴' +
        (res.mergedCount ? '（与已有色块合并）' : ''));
      return;
    }
    if (res.reason === 'too-short') showToast('本轮不足 5 分钟，未写入时间轴');
    else if (res.reason === 'out-of-range') showToast('当前时间不在 6:00–24:00 内，本轮未写入时间轴');
  }

  /** 点「继续」→ 立刻开始下一轮 */
  function continueTimerRound() {
    clearRemind();
    Store.continueTimer();
    var st = Store.get();
    if (st.timer.status === 'running') {
      if (st.settings.sound) Remind.startKeepAlive();
      scheduleRound(st);
      showToast('继续加油，第 ' + st.timer.round + ' 轮开始');
    }
  }

  /**
   * 停止 / 结束 / 超时 / 关弹窗
   * running：先结算本轮实际时长（不足 5 分钟则丢弃），再回到 idle
   * prompt ：直接收尾，不重复写入
   */
  function stopTimerRound(why) {
    var t = Store.get().timer;
    clearRoundTimers();
    clearRemind();
    Remind.stopKeepAlive();
    closePopup();                       // 计时彻底结束，浮窗也一起收掉
    if (t.status === 'running') {
      handleRoundResult(Store.finishRound({ prompt: false }));
    } else if (t.status === 'prompt') {
      Store.stopTimer();
      if (why === 'timeout') showToast('10 秒未响应，本轮计时已结束');
    }
    tickTimer();
  }

  /** 每秒刷新显示（只改 DOM） */
  function tickTimer() {
    if (!el.timerClock) return;
    var t = Store.get().timer;

    if (t.status === 'running') {
      var totalMs = t.durationMin * 60000;
      var remain = Math.max(0, t.roundStart + totalMs - Date.now());
      el.timerClock.textContent = U.formatMMSS(remain);
      el.timerClock.classList.add('is-running');
      el.timerBar.style.width = (U.clamp(1 - remain / totalMs, 0, 1) * 100).toFixed(2) + '%';
      el.timerStatus.textContent = '第 ' + t.round + ' 轮进行中 · 剩余 ' + U.formatMMSS(remain);
      if (remain <= 0) completeRound();   // 兜底：后台标签页被节流时，靠这里收尾
      return;
    }

    if (t.status === 'prompt') {
      var left = Math.max(0, t.promptUntil - Date.now());
      el.timerPromptLeft.textContent = Math.ceil(left / 1000) + ' 秒';
      if (left <= 0) { stopTimerRound('timeout'); return; }
      return;
    }

    el.timerClock.classList.remove('is-running');
    el.timerClock.textContent = U.formatMMSS(t.durationMin * 60000);
    el.timerBar.style.width = '0%';
  }

  /** 渲染计时面板（结构随状态变化；询问弹窗的显隐也由状态决定，保证不会残留） */
  function renderTimer(state) {
    var t = state.timer;
    var active = S.projectById(state, t.projectId) ? t.projectId : state.projects[0].id;
    var meta = S.projectMeta(state, active);

    var sig = state.projects.map(function (p) { return p.id; }).join(',') + '|' + active;
    if (el.timerProjects.getAttribute('data-sig') !== sig) {
      el.timerProjects.innerHTML = state.projects.map(function (p) {
        return '<button type="button" class="chip' + (p.id === active ? ' is-active' : '') + '" data-id="' +
          U.escapeHtml(p.id) + '" style="color:' + p.color + '">' +
          '<i class="dot" style="background:' + p.color + '"></i>' + U.escapeHtml(p.name) + '</button>';
      }).join('');
      el.timerProjects.setAttribute('data-sig', sig);
    }

    /* 时长下拉：允许自定义值（例如导入的数据），没有对应选项时临时补一个 */
    var durVal = String(t.durationMin);
    if (!el.timerDuration.querySelector('option[value="' + durVal + '"]')) {
      var opt = document.createElement('option');
      opt.value = durVal;
      opt.textContent = durVal + ' 分钟';
      el.timerDuration.appendChild(opt);
    }
    el.timerDuration.value = durVal;
    el.timerRoundHint.textContent = '专注 ' + t.durationMin + ' 分钟一轮';

    var stats = Store.todayTimerStats();
    el.timerToday.textContent = stats.rounds
      ? '今天已完成 ' + stats.rounds + ' 轮 · 共 ' + U.formatMinutesLong(stats.minutes)
      : '今天还没有完成计时';

    /* 提醒方式开关 + 权限状态 */
    el.timerPopup.checked = !!state.settings.popup;
    el.timerSound.checked = !!state.settings.sound;
    el.timerNotify.checked = !!state.settings.notify;
    var perm = Remind.permission();
    /* Chrome/Edge 对 file:// 页面的通知权限处理很不可靠，这里提前讲清楚怎么办 */
    var fileNote = (window.location.protocol === 'file:' && perm !== 'granted')
      ? '｜当前用 file:// 打开：浏览器多半不给通知权限，改用 python -m http.server 后访问 ' +
        'http://localhost:8000 即可正常授权（提示音与标题闪烁不受影响）'
      : '';
    if (perm === 'unsupported') {
      el.timerNotifyState.textContent = '当前浏览器不支持系统通知，将用提示音 + 标题闪烁提醒';
      el.timerNotifyState.classList.add('is-warn');
      el.timerNotify.disabled = true;
    } else if (perm === 'denied') {
      el.timerNotifyState.textContent = '通知权限被拒绝：在地址栏左侧的站点设置里允许通知' + fileNote;
      el.timerNotifyState.classList.add('is-warn');
      el.timerNotify.disabled = false;
    } else if (perm === 'granted') {
      el.timerNotifyState.textContent = '系统通知已授权：切到别的软件也会在右下角弹提醒';
      el.timerNotifyState.classList.remove('is-warn');
      el.timerNotify.disabled = false;
    } else {
      el.timerNotifyState.textContent = '首次开始计时时会请求通知权限（也可点「试一下」立刻授权）' + fileNote;
      el.timerNotifyState.classList.remove('is-warn');
      el.timerNotify.disabled = false;
    }

    var running = t.status === 'running';
    var prompting = t.status === 'prompt';
    el.timerStart.hidden = running || prompting;
    el.timerStop.hidden = !running;
    el.timerClock.style.color = meta.color;
    el.timerBar.style.background = meta.color;

    if (prompting) {
      el.timerClock.classList.remove('is-running');
      el.timerClock.textContent = U.formatMMSS(t.durationMin * 60000);
      el.timerBar.style.width = '100%';
      el.timerStatus.textContent = '等待确认：是否继续下一轮';
    } else if (!running) {
      el.timerStatus.textContent = stats.rounds ? '休息一下，随时可以开始新一轮' : '选择项目后点「开始计时」';
    }

    /* 询问弹窗：开着的唯一依据就是状态 === 'prompt' */
    if (prompting) {
      el.timerModalDone.textContent = meta.name + ' · 第 ' + t.round + ' 轮已完成 ' +
        U.formatMinutes(t.durationMin);
      el.timerModal.hidden = false;
      /* 进入询问状态的那一下，把所有提醒通道广播一遍（只播一次） */
      var pkey = t.round + ':' + t.promptUntil;
      if (lastPromptKey !== pkey) {
        lastPromptKey = pkey;
        remindRoundEnd(t.durationMin);
      }
    } else {
      el.timerModal.hidden = true;
      lastPromptKey = null;
      if (Remind.isAttentionOn()) clearRemind();   // 状态离开 prompt，提醒也要一起收掉
    }

    /* 计时进行中保持「无声音频保活」，减少浏览器在后台节流定时器导致的提醒迟到。
       与提示音开关无关：它是为了计时准确，不是为了出声。 */
    if (running) {
      if (!Remind.isKeepingAlive()) Remind.startKeepAlive();
    } else if (Remind.isKeepingAlive()) {
      Remind.stopKeepAlive();
    }

    tickTimer();
  }

  /** 刷新 / 重开后恢复计时：没跑完就接着跑，已经跑完就补写时间轴 */
  function restoreTimer() {
    var t = Store.get().timer;
    if (t.status === 'running' && t.roundStart) {
      var endMs = t.roundStart + t.durationMin * 60000;
      if (Date.now() - t.roundStart > Store.TIMER_STALE_MS) {
        Store.stopTimer();                       // 很久以前残留的状态，直接丢弃
        return;
      }
      if (Date.now() >= endMs) {
        handleRoundResult(Store.finishRound({ prompt: false, endAt: endMs }));  // 关页面期间跑完的那一轮
      } else {
        scheduleRound(Store.get());
        if (Store.get().settings.sound) Remind.startKeepAlive();
        showToast('已接着上一轮继续计时');
      }
      return;
    }
    if (t.status === 'prompt' && t.promptUntil) {
      if (Date.now() >= t.promptUntil) Store.stopTimer();
      else schedulePrompt(Store.get());          // 10 秒没走完，继续询问
    }
  }

  /* ============================================================
   * 迷你日历（调取任意一天的时间轴）
   * ============================================================ */
  var calMonth = null;   // 日历当前浏览的月份，仅内存态
  var calMode = 'timeline';   // 日历显示「时间轴」还是「睡眠」

  function bindCalendar() {
    el.calToggle.addEventListener('click', function () {
      if (el.calendar.hidden) openCalendar(); else closeCalendar();
    });
    /* 点日历外面收起 */
    document.addEventListener('pointerdown', function (e) {
      if (el.calendar.hidden || !e.target.closest) return;
      if (e.target.closest('#calendar') || e.target.closest('#calToggle')) return;
      closeCalendar();
    });
    document.addEventListener('keydown', function (e) {
      if ((e.key === 'Escape' || e.key === 'Esc') && !el.calendar.hidden) closeCalendar();
    });
    window.addEventListener('resize', U.debounce(function () {
      if (!el.calendar.hidden) renderCalendar(Store.get());
    }, 150));
  }

  function openCalendar() {
    var state = Store.get();
    var base = calMode === 'sleep'
      ? (U.isValidDateStr(state.ui.sleepDate) ? state.ui.sleepDate : U.todayStr())
      : state.ui.tlDate;
    calMonth = window.StudyCalendar.monthOf(base);
    el.calendar.hidden = false;
    el.calToggle.setAttribute('aria-expanded', 'true');
    renderCalendar(state);
  }

  function closeCalendar() {
    el.calendar.hidden = true;
    el.calToggle.setAttribute('aria-expanded', 'false');
  }

  function renderCalendar(state) {
    if (!el.calendar || el.calendar.hidden) return;
    var sleepMode = calMode === 'sleep';
    var selDate = sleepMode
      ? (U.isValidDateStr(state.ui.sleepDate) ? state.ui.sleepDate : U.todayStr())
      : state.ui.tlDate;
    window.StudyCalendar.render(el.calendar, {
      state: state,
      mode: calMode,
      selectedDate: selDate,
      viewMonth: calMonth || window.StudyCalendar.monthOf(selDate),
      onModeChange: function (mode) {
        calMode = mode === 'sleep' ? 'sleep' : 'timeline';
        openCalendar();          // 换模式后月份/选中日期跟着换
      },
      onPick: function (date) {
        if (sleepMode) {
          /* 点日历里的某一晚 → 定位到那一晚的柱状图 */
          slMonth = date.slice(0, 7);
          Store.setUI({ sleepDate: date }, 'ui');
          closeCalendar();
          el.panelSleep.scrollIntoView({ behavior: 'smooth', block: 'start' });
          showToast('已跳到 ' + U.formatDateCN(date) + ' 的睡眠记录');
          return;
        }
        setTimelineDate(date);
        closeCalendar();
        showToast('已切换到 ' + U.formatDateCN(date) + ' 的时间轴');
      },
      onMonth: function (delta) {
        calMonth = window.StudyCalendar.shiftMonth(
          calMonth || window.StudyCalendar.monthOf(selDate), delta);
        renderCalendar(Store.get());
      },
      onToday: function () {
        if (sleepMode) {
          slMonth = U.todayStr().slice(0, 7);
          Store.setUI({ sleepDate: U.todayStr() }, 'ui');
          closeCalendar();
          return;
        }
        setTimelineDate(U.todayStr());
        closeCalendar();
      }
    });
  }

  /* ============================================================
   * 夜间睡眠：手动输入 + 每晚柱状图
   * ============================================================ */
  var slMonth = null;    // 柱状图当前月份（内存态，默认跟随所选那一晚）

  function bindSleep() {
    el.sleepForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var date = U.isValidDateStr(el.slDate.value) ? el.slDate.value : U.todayStr();
      var bed = U.hhmmToMinutes(el.slBed.value);
      var wake = U.hhmmToMinutes(el.slWake.value);
      if (bed === null || wake === null) { showToast('请填写入睡与起床时间'); return; }
      var res = Store.setSleep(date, { bed: bed, wake: wake, note: el.slNote.value.trim() });
      if (!res.ok) {
        showToast(res.reason === 'same-time' ? '入睡与起床时间不能完全相同' : '时间格式不正确');
        return;
      }
      slMonth = date.slice(0, 7);
      Store.setUI({ sleepDate: date }, 'ui');
      showToast('已记录 ' + U.formatDateCN(date) + ' 睡了 ' + U.formatMinutesLong(res.duration));
    });

    el.slDate.addEventListener('change', function () {
      if (!U.isValidDateStr(el.slDate.value)) return;
      slMonth = el.slDate.value.slice(0, 7);
      Store.setUI({ sleepDate: el.slDate.value }, 'ui');
    });
    el.slBed.addEventListener('input', updateSleepPreview);
    el.slWake.addEventListener('input', updateSleepPreview);

    el.slDelete.addEventListener('click', function () {
      var date = U.isValidDateStr(el.slDate.value) ? el.slDate.value : U.todayStr();
      if (!S.sleepEntry(Store.get(), date)) { showToast('这一晚还没有记录'); return; }
      Store.removeSleep(date);
      showToast('已删除 ' + U.formatDateCN(date) + ' 的睡眠记录');
    });

    el.slPrevMonth.addEventListener('click', function () { stepSleepMonth(-1); });
    el.slNextMonth.addEventListener('click', function () { stepSleepMonth(1); });
    el.slThisMonth.addEventListener('click', function () {
      slMonth = U.todayStr().slice(0, 7);
      renderSleep(Store.get());
    });

    window.addEventListener('resize', U.debounce(function () { renderSleep(Store.get()); }, 150));
    if (window.ResizeObserver) {
      var ro = new ResizeObserver(U.debounce(function () { renderSleep(Store.get()); }, 120));
      ro.observe(el.sleepChart);
    }
  }

  function stepSleepMonth(delta) {
    var base = slMonth || (U.isValidDateStr(Store.get().ui.sleepDate)
      ? Store.get().ui.sleepDate.slice(0, 7) : U.todayStr().slice(0, 7));
    slMonth = window.StudyCalendar.shiftMonth(base, delta);
    renderSleep(Store.get());
  }

  /** 表单里实时显示「本晚睡眠 X 小时 Y 分」 */
  function updateSleepPreview() {
    var bed = U.hhmmToMinutes(el.slBed.value);
    var wake = U.hhmmToMinutes(el.slWake.value);
    if (bed === null || wake === null) { el.slDuration.textContent = '—'; return; }
    var d = (wake - bed + 1440) % 1440;
    el.slDuration.textContent = d > 0 ? U.formatMinutesLong(d) : '起止时间相同，无法计算';
  }

  function renderSleep(state) {
    var uiDate = U.isValidDateStr(state.ui.sleepDate) ? state.ui.sleepDate : U.todayStr();
    if (!slMonth) slMonth = uiDate.slice(0, 7);

    var p = window.StudyCalendar.parseMonth(slMonth);
    el.slMonthLabel.textContent = p.year + ' 年 ' + p.month + ' 月';

    /* 表单跟随「当前选中的那一晚」 */
    var entry = S.sleepEntry(state, uiDate);
    if (document.activeElement !== el.slDate) el.slDate.value = uiDate;
    if (document.activeElement !== el.slBed) el.slBed.value = entry ? U.minutesToHHMM(entry.bed) : '23:00';
    if (document.activeElement !== el.slWake) el.slWake.value = entry ? U.minutesToHHMM(entry.wake) : '07:00';
    if (document.activeElement !== el.slNote) el.slNote.value = entry ? entry.note : '';
    el.slDelete.hidden = !entry;
    updateSleepPreview();

    var sum = S.sleepSummary(state, slMonth);
    el.slSummary.textContent = sum.nights
      ? '本月 ' + sum.nights + ' 晚 · 平均 ' + U.formatMinutesLong(sum.average) +
        ' · 最长 ' + U.formatMinutesLong(sum.best.minutes)
      : '本月还没有睡眠记录';

    Chart.renderSleep(el.sleepChart, {
      state: state,
      month: slMonth,
      selectedDate: uiDate,
      tipEl: el.chartTip,
      onPick: function (date) {
        var e2 = S.sleepEntry(Store.get(), date);
        Store.setUI({ sleepDate: date }, 'ui');
        showToast(e2
          ? U.formatDateCN(date) + ' 睡了 ' + U.formatMinutesLong(e2.duration) + '，可直接修改'
          : U.formatDateCN(date) + ' 还没有记录，填好时间点保存即可');
      }
    });
  }

  /* ============================================================
   * 轻提示
   * ============================================================ */
  function showToast(msg) {
    el.toast.textContent = msg;
    el.toast.hidden = false;
    requestAnimationFrame(function () { el.toast.classList.add('is-show'); });
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.toast.classList.remove('is-show');
      toastTimer = setTimeout(function () { el.toast.hidden = true; }, 220);
    }, 2200);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
