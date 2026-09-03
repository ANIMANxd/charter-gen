(function () {
  'use strict';

  var LS_KEY = 'cf_gemini_key';
  var XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  var state = {
    apiKey: '',
    idea: '',
    details: {},
    charter: null,
    schedule: null,
    schedInputs: {},
    generating: false,
    excelReady: typeof window.ExcelJS !== 'undefined'
  };

  var $ = function (sel) { return document.querySelector(sel); };

  var views = {
    key: $('#view-key'),
    idea: $('#view-idea'),
    review: $('#view-review'),
    'schedule-inputs': $('#view-schedule-inputs'),
    'schedule-review': $('#view-schedule-review')
  };

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fmtDate(iso) {
    if (!window.ExcelBuilder) return String(iso || '');
    return window.ExcelBuilder.fmtDate(iso);
  }
  function fmtDateSchedule(iso) {
    if (window.ScheduleLogic) return window.ScheduleLogic.fmtDate(iso);
    return String(iso||'');
  }

  function todayIso() {
    var d = new Date();
    var m = ('0' + (d.getMonth() + 1)).slice(-2);
    var day = ('0' + d.getDate()).slice(-2);
    return d.getFullYear() + '-' + m + '-' + day;
  }

  function sanitizeFilename(name, suffix) {
    var base = String(name || 'project').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 60);
    return (base || 'project') + '-' + (suffix || 'project-charter.xlsx');
  }

  function debounce(fn, ms) {
    var t;
    return function () {
      var args = arguments;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(null, args); }, ms);
    };
  }

  function growTextarea(el) {
    if (!el || !el.classList.contains('grow')) return;
    if (el.offsetParent === null || el.closest('[hidden]')) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight + 2, 460) + 'px';
  }
  function growTextareas(scope) {
    (scope || document).querySelectorAll('textarea.grow').forEach(growTextarea);
  }

  function toast(message, kind) {
    var el = document.createElement('div');
    el.className = 'toast' + (kind ? ' ' + kind : '');
    el.textContent = message;
    el.addEventListener('click', function () { dismiss(); });
    $('#toasts').appendChild(el);
    var timer = setTimeout(dismiss, 6000);
    function dismiss() {
      clearTimeout(timer);
      el.classList.add('leaving');
      setTimeout(function () { el.remove(); }, 260);
    }
  }

  /* ---------- step navigation ---------- */
  var ORDER = ['key','idea','review','schedule-inputs','schedule-review'];
  function showView(name) {
    Object.keys(views).forEach(function (k) { if (views[k]) views[k].hidden = k !== name; });
    var idx = ORDER.indexOf(name);
    document.querySelectorAll('.step-chip').forEach(function (chip) {
      var s = chip.getAttribute('data-step');
      var i = ORDER.indexOf(s);
      chip.classList.toggle('is-active', i === idx);
      chip.classList.toggle('is-done', i !== -1 && i < idx);
    });
    if (name === 'idea') growTextareas(views.idea);
    if (name === 'schedule-inputs') prepareScheduleInputsView();
    if (name === 'schedule-review') growTextareas(document.getElementById('schedule-editor-pane'));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ---------- step 1 · api key ---------- */
  function initKeyStep() {
    var input = $('#input-key');
    var saved = '';
    try { saved = localStorage.getItem(LS_KEY) || ''; } catch (e) { saved = ''; }
    if (saved) { input.value = saved; state.apiKey = saved; }
    $('#toggle-key').addEventListener('click', function () {
      input.type = input.type === 'password' ? 'text' : 'password';
      input.focus();
    });
    $('#form-key').addEventListener('submit', function (e) {
      e.preventDefault();
      var key = input.value.trim();
      if (key.length < 20) {
        toast('That does not look like a valid Gemini API key - it should be a long string starting with "AIza".', 'error');
        input.focus(); return;
      }
      state.apiKey = key;
      if ($('#remember-key').checked) { try { localStorage.setItem(LS_KEY, key); } catch (e2) {} }
      else { try { localStorage.removeItem(LS_KEY); } catch (e3) {} }
      showView('idea');
      $('#input-idea').focus();
    });
  }

  /* ---------- step 2 · idea ---------- */
  var EXAMPLE_IDEA = [
    'CampusCart - a mobile app for university students that aggregates food orders from',
    'campus cafeterias and nearby restaurants. Student clubs can place bulk group orders',
    'at a discount, delivered by a network of student couriers who earn meal credits.',
    'It needs live order tracking, meal-plan balance payments, and weekly spending insights.'
  ].join(' ');
  function readDetails() {
    return {
      org: $('#d-org').value.trim(),
      projectName: $('#d-name').value.trim(),
      startDate: $('#d-start').value,
      durationWeeks: $('#d-duration').value,
      budget: $('#d-budget').value.trim(),
      teamSize: $('#d-team').value,
      sponsorName: $('#d-sponsor-name').value.trim(),
      sponsorTitle: $('#d-sponsor-title').value.trim(),
      projectManager: $('#d-pm').value.trim(),
      notes: $('#d-notes').value.trim()
    };
  }
  function initIdeaStep() {
    var ideaEl = $('#input-idea');
    var genBtn = $('#btn-generate');
    ideaEl.classList.add('grow');
    $('#d-start').value = todayIso();
    function refresh() {
      state.idea = ideaEl.value;
      var len = ideaEl.value.trim().length;
      $('#idea-count').textContent = len + ' character' + (len === 1 ? '' : 's');
      genBtn.disabled = len < 20 || state.generating;
      growTextarea(ideaEl);
    }
    ideaEl.addEventListener('input', refresh);
    ideaEl.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !genBtn.disabled) generate();
    });
    $('#btn-example').addEventListener('click', function () {
      ideaEl.value = EXAMPLE_IDEA; refresh(); ideaEl.focus();
    });
    $('#btn-back-key').addEventListener('click', function () { showView('key'); });
    genBtn.addEventListener('click', generate);
    refresh();
  }

  /* ---------- generation charter ---------- */
  var STATUS_LINES = [
    'Analyzing your idea',
    'Drafting objectives and success criteria',
    'Laying out milestones and deadlines',
    'Assigning resources, risks and stakeholders',
    'Formatting your Excel charter'
  ];
  var SCHED_STATUS = [
    'Reading your charter context',
    'Defining activities & WBS',
    'Sequencing with PDM (FS/SS/FF/SF)',
    'Estimating with PERT & story points',
    'Computing CPM & float — forging workbook'
  ];
  var statusTimer = null;
  function startOverlay(lines) {
    var el = $('#overlay');
    var status = $('#overlay-status');
    var title = el.querySelector('.overlay-title');
    var arr = lines || STATUS_LINES;
    var isSchedule = arr === SCHED_STATUS;
    if (title) title.textContent = isSchedule ? 'Forging your schedule' : 'Forging your charter';
    var i = 0;
    status.textContent = arr[0];
    clearInterval(statusTimer);
    statusTimer = setInterval(function () {
      i = (i + 1) % arr.length;
      status.textContent = arr[i];
    }, 1800);
    el.hidden = false;
  }
  function stopOverlay() {
    clearInterval(statusTimer);
    statusTimer = null;
    var el = $('#overlay');
    var title = el.querySelector('.overlay-title');
    if (title) title.textContent = 'Forging your charter';
    el.hidden = true;
  }
  function generate() {
    if (state.generating) return;
    state.idea = $('#input-idea').value.trim();
    if (state.idea.length < 20) { toast('Please describe your idea in at least a sentence or two.', 'error'); return; }
    if (!state.apiKey) { toast('Add your Gemini API key first.', 'error'); showView('key'); return; }
    state.details = readDetails();
    callGemini();
  }
  function callGemini() {
    state.generating = true;
    $('#btn-generate').disabled = true;
    startOverlay(STATUS_LINES);
    window.GeminiService.generateCharter({
      apiKey: state.apiKey,
      idea: state.idea,
      details: state.details
    }).then(function (charter) {
      state.charter = charter;
      buildEditor();
      renderPreview();
      showView('review');
      toast('Charter generated with ' + window.GeminiService.PRIMARY_MODEL + '.', 'success');
    }).catch(function (err) {
      toast((err && err.message) || 'Something went wrong while generating the charter.', 'error');
    }).finally(function () {
      state.generating = false;
      stopOverlay();
      $('#btn-generate').disabled = false;
    });
  }

  /* ---------- helpers for editor ---------- */
  function linesToText(arr) { return (arr || []).join('\n'); }
  function textToLines(text) {
    return String(text || '').split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
  }
  function itemCards(listName, items, fields, twoCol) {
    var html = '';
    items.forEach(function (item, i) {
      var n = ('0' + (i + 1)).slice(-2);
      html += '<div class="item-card">' +
        '<div class="item-head"><span class="item-index">' + n + '</span>' +
        '<button type="button" class="row-remove" data-action="remove" data-list="' + listName +
        '" data-idx="' + i + '" aria-label="Remove item ' + (i + 1) + '">' +
        '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg></button>' +
        '</div><div class="item-fields' + (twoCol ? ' grid-two' : '') + '">';
      fields.forEach(function (f) {
        var id = listName + '-' + i + '-' + f.part;
        var val = item[f.part];
        if (val === undefined || val === null) val = '';
        // for checkbox type we handle separately
        if (f.type === 'checkbox') {
          html += '<div class="item-field"><label for="' + id + '">' + esc(f.label) + '</label>' +
            '<label class="check-row" style="margin:0"><input type="checkbox" id="' + id + '" data-list="' + listName + '" data-idx="' + i + '" data-part="' + f.part + '"' + (val ? ' checked' : '') + ' /> ' + esc(f.placeholder || '') + '</label></div>';
        } else {
          html += '<div class="item-field"><label for="' + id + '">' + esc(f.label) + '</label>' +
            '<input type="' + f.type + '" id="' + id + '" value="' + esc(val) +
            '" placeholder="' + esc(f.placeholder || '') + '" data-list="' + listName +
            '" data-idx="' + i + '" data-part="' + f.part + '" /></div>';
        }
      });
      html += '</div></div>';
    });
    return html;
  }

  function buildEditor() {
    var c = state.charter;
    var pane = $('#editor-pane');
    var h = '';
    h += '<div class="edit-group"><p class="group-label">01 · Overview</p>' +
      '<div class="field"><label for="e-projectName">Project name</label>' +
      '<input type="text" id="e-projectName" data-field="projectName" value="' + esc(c.projectName) + '" /></div>' +
      '<div class="field"><label for="e-objective">Objective</label>' +
      '<textarea id="e-objective" class="grow" rows="4" data-field="objective">' + esc(c.objective) + '</textarea></div>' +
      '<div class="field"><label for="e-budget">Budget</label>' +
      '<input type="text" id="e-budget" data-field="budget" value="' + esc(c.budget) + '" /></div></div>';
    h += lineGroup('02 · Success criteria', 'successCriteria', c.successCriteria);
    h += lineGroup('03 · Key deliverables', 'keyDeliverables', c.keyDeliverables);
    h += '<div class="edit-group"><p class="group-label">04 · Milestones</p>' +
      '<div id="list-milestones">' + milestoneRows(c.milestones) + '</div>' +
      '<button type="button" class="add-row" data-action="add" data-list="milestones">+ Add milestone</button></div>';
    h += lineGroup('05 · High level requirements', 'highLevelRequirements', c.highLevelRequirements);
    h += lineGroup('06 · Team members (roles)', 'teamMembers', c.teamMembers);
    h += '<div class="edit-group"><p class="group-label">07 · Risks</p>' +
      '<div id="list-risks">' + riskRows(c.risks) + '</div>' +
      '<button type="button" class="add-row" data-action="add" data-list="risks">+ Add risk</button></div>';
    h += '<div class="edit-group"><p class="group-label">08 · Stakeholders</p>' +
      '<div id="list-stakeholders">' + stakeholderRows(c.stakeholders) + '</div>' +
      '<button type="button" class="add-row" data-action="add" data-list="stakeholders">+ Add stakeholder</button></div>';
    h += lineGroup('09 · Project managers', 'projectManagers', c.projectManagers);
    h += '<div class="edit-group"><p class="group-label">10 · Approval</p><div class="approval-grid">' +
      '<div class="field"><label for="e-ap-name">Approver name</label>' +
      '<input type="text" id="e-ap-name" data-approval="name" value="' + esc(c.approval.name) + '" /></div>' +
      '<div class="field"><label for="e-ap-title">Approver title</label>' +
      '<input type="text" id="e-ap-title" data-approval="title" value="' + esc(c.approval.title) + '" /></div>' +
      '<div class="field"><label for="e-ap-date">Sign-off date</label>' +
      '<input type="date" id="e-ap-date" data-approval="date" value="' + esc(c.approval.date) + '" /></div>' +
      '<div class="field"><label for="e-ap-sig">Signature note</label>' +
      '<input type="text" id="e-ap-sig" data-approval="signature" value="' + esc(c.approval.signature || '') + '" placeholder="e.g. [Approved]" /></div>' +
      '</div></div>';
    pane.innerHTML = h;
    growTextareas(pane);
  }
  function lineGroup(labelText, field, arr) {
    return '<div class="edit-group"><p class="group-label">' + esc(labelText) + '</p>' +
      '<div class="field"><textarea class="grow" rows="3" data-lines="' + field + '"' +
      ' aria-label="' + esc(labelText) + '">' + esc(linesToText(arr)) + '</textarea>' +
      '<p class="help">One item per line.</p></div></div>';
  }
  function milestoneRows(items) {
    return itemCards('milestones', items, [
      { part: 'name', label: 'Milestone', type: 'text', placeholder: 'What ships' },
      { part: 'deadline', label: 'Deadline', type: 'date' }
    ], true);
  }
  function riskRows(items) {
    return itemCards('risks', items, [
      { part: 'risk', label: 'Risk', type: 'text', placeholder: 'What could go wrong' },
      { part: 'mitigation', label: 'Mitigation', type: 'text', placeholder: 'How it is contained' }
    ], false);
  }
  function stakeholderRows(items) {
    return itemCards('stakeholders', items, [
      { part: 'name', label: 'Stakeholder', type: 'text', placeholder: 'Name or group' },
      { part: 'role', label: 'Role', type: 'text', placeholder: 'Their part in it' }
    ], false);
  }
  function bindEditorEvents() {
    var pane = $('#editor-pane');
    var rerenderList = {
      milestones: function () { $('#list-milestones').innerHTML = milestoneRows(state.charter.milestones); },
      risks: function () { $('#list-risks').innerHTML = riskRows(state.charter.risks); },
      stakeholders: function () { $('#list-stakeholders').innerHTML = stakeholderRows(state.charter.stakeholders); }
    };
    pane.addEventListener('input', function (e) {
      var t = e.target;
      if (t.tagName === 'TEXTAREA') growTextarea(t);
      if (!state.charter) return;
      if (t.matches('[data-field]')) {
        state.charter[t.getAttribute('data-field')] = t.value;
        schedulePreview();
      } else if (t.matches('[data-lines]')) {
        state.charter[t.getAttribute('data-lines')] = textToLines(t.value);
        schedulePreview();
      } else if (t.matches('[data-approval]')) {
        state.charter.approval[t.getAttribute('data-approval')] = t.value;
        schedulePreview();
      } else if (t.matches('[data-list]')) {
        var list = t.getAttribute('data-list');
        var idx = +t.getAttribute('data-idx');
        var part = t.getAttribute('data-part');
        if (state.charter[list] && state.charter[list][idx]) {
          state.charter[list][idx][part] = t.value;
          schedulePreview();
        }
      }
    });
    pane.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-action]');
      if (!btn || !state.charter) return;
      var action = btn.getAttribute('data-action');
      var list = btn.getAttribute('data-list');
      if (action === 'remove') {
        var idx = +btn.getAttribute('data-idx');
        if (state.charter[list].length > 1) {
          state.charter[list].splice(idx, 1);
          rerenderList[list]();
          renderPreview();
        } else {
          toast('Keep at least one row - clear the text instead if you do not need it.', 'error');
        }
      } else if (action === 'add') {
        var blank =
          list === 'milestones' ? { name: '', deadline: '' } :
          list === 'risks' ? { risk: '', mitigation: '' } :
          { name: '', role: '' };
        state.charter[list].push(blank);
        rerenderList[list]();
        renderPreview();
        var inputs = document.querySelectorAll('#list-' + list + ' [data-idx="' + (state.charter[list].length - 1) + '"]');
        if (inputs.length) inputs[0].focus();
      }
    });
  }

  /* ---------- charter preview ---------- */
  var renderPreview = function () { renderPreviewNow(); };
  var schedulePreview = debounce(function () { renderPreviewNow(); }, 250);
  function td(cls, content, attrs) {
    return '<td class="' + cls + '"' + (attrs || '') + '>' + esc(content) + '</td>';
  }
  function renderPreviewNow() {
    var c = state.charter;
    if (!c) return;
    var h = '<table class="charter">';
    h += '<colgroup><col class="c-label" /><col class="c-main" /><col class="c-second" /><col class="c-extra" /></colgroup>';
    h += '<tr><td class="doc-corner"></td><td class="doc-title" colspan="3">Project Charter</td></tr>';
    h += '<tr>' + td('doc-label', 'Project Name') + td('doc-light', c.projectName, ' colspan="3" style="font-weight:700"') + '</tr>';
    h += '<tr>' + td('doc-label', 'Objective') + td('doc-light', c.objective, ' colspan="3"') + '</tr>';
    h += '<tr>' + td('doc-label', 'Success Criteria') + td('doc-light', numJoin(c.successCriteria), ' colspan="3"') + '</tr>';
    h += '<tr>' + td('doc-label', 'Key Deliverables') + td('doc-light', numJoin(c.keyDeliverables), ' colspan="3"') + '</tr>';
    var ms = c.milestones.length ? c.milestones : [{ name: '', deadline: '' }];
    h += '<tr>' + td('doc-label', 'Milestones', ' rowspan="' + (ms.length + 1) + '"') +
      td('doc-sub', 'Milestones') + td('doc-sub', 'Deadlines', ' colspan="2"') + '</tr>';
    ms.forEach(function (m, i) {
      h += '<tr>' + td('doc-light', m.name ? (i + 1) + '. ' + m.name : '') +
        td('doc-light doc-right', m.deadline ? fmtDate(m.deadline) : '', ' colspan="2"') + '</tr>';
    });
    var reqs = c.highLevelRequirements.length ? c.highLevelRequirements : [''];
    reqs.forEach(function (q, i) {
      h += '<tr>' + (i === 0 ? td('doc-label', 'High Level Requirements:', ' rowspan="' + reqs.length + '"') : '') +
        td('doc-pale', q ? (i + 1) + '. ' + q : '', ' colspan="3"') + '</tr>';
    });
    var memberCount = 2 + (c.teamMembers.length || 1);
    h += '<tr>' + td('doc-label', 'Resource', ' rowspan="' + memberCount + '"') +
      td('doc-pale', 'Budget : ' + c.budget, ' colspan="3"') + '</tr>';
    h += '<tr>' + td('doc-pale', 'Team members :', ' colspan="3"') + '</tr>';
    (c.teamMembers.length ? c.teamMembers : ['']).forEach(function (m, i) {
      h += '<tr>' + td('doc-pale', m ? (i + 1) + '. ' + m : '', ' colspan="3"') + '</tr>';
    });
    var risks = c.risks.length ? c.risks : [{ risk: '', mitigation: '' }];
    risks.forEach(function (rk, i) {
      var line = rk.risk ? (i + 1) + '. ' + rk.risk : '';
      if (rk.risk && rk.mitigation) line += ' (Mitigation: ' + rk.mitigation.replace(/\.?\s*$/, '') + ').';
      h += '<tr>' + (i === 0 ? td('doc-label', 'Risks', ' rowspan="' + risks.length + '"') : '') +
        td('doc-pale', line, ' colspan="3"') + '</tr>';
    });
    var stk = c.stakeholders.length ? c.stakeholders : [{ name: '', role: '' }];
    h += '<tr>' + td('doc-label', 'Stakeholders', ' rowspan="' + (stk.length + 1) + '"') +
      td('doc-sub', 'Name') + td('doc-sub', 'Role', ' colspan="2"') + '</tr>';
    stk.forEach(function (s, i) {
      h += '<tr>' + td('doc-pale', s.name ? (i + 1) + '. ' + s.name : '') +
        td('doc-pale', s.role ? (i + 1) + '. ' + s.role : '', ' colspan="2"') + '</tr>';
    });
    var pms = c.projectManagers.length ? c.projectManagers : [''];
    pms.forEach(function (pm, i) {
      h += '<tr>' + (i === 0 ? td('doc-label', 'Project Manager', ' rowspan="' + pms.length + '"') : '') +
        td('doc-pale', pm ? (i + 1) + '. ' + pm : '', ' colspan="3"') + '</tr>';
    });
    var ap = c.approval;
    h += '<tr>' + td('doc-label', 'Approval', ' rowspan="2"') +
      td('doc-pale doc-approval', 'Name: ' + (ap.name || ''), ' colspan="2"') +
      td('doc-pale doc-approval', 'Title: ' + (ap.title || '')) + '</tr>';
    h += '<tr>' + td('doc-pale doc-approval', 'Signature : ' + (ap.signature || ''), ' colspan="2"') +
      td('doc-pale doc-approval', 'Date: ' + (ap.date ? fmtDate(ap.date) : '')) + '</tr>';
    h += '</table>';
    var el = document.getElementById('preview-scroll');
    if (el) el.innerHTML = h;
  }
  function numJoin(arr) {
    return (arr || []).map(function (s, i) { return (i + 1) + '. ' + s; }).join('\n');
  }

  /* ---------- charter download ---------- */
  function download() {
    if (!state.charter) return;
    if (!state.excelReady) { toast('Excel library failed to load. Check your internet connection and reload the page.', 'error'); return; }
    var wb = window.ExcelBuilder.buildWorkbook(state.charter);
    wb.xlsx.writeBuffer().then(function (buf) {
      var blob = new Blob([buf], { type: XLSX_MIME });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = sanitizeFilename(state.charter.projectName, 'project-charter.xlsx');
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
      toast('Excel charter downloaded - opens cleanly in Excel, Sheets and LibreOffice.', 'success');
    }).catch(function (err) {
      toast('Could not build the workbook: ' + (err && err.message ? err.message : 'unknown error'), 'error');
    });
  }

  /* ========== SCHEDULE FLOW ========== */
  function readSchedInputs() {
    return {
      methodology: $('#s-method').value.trim(),
      workingDays: $('#s-workdays').value.trim(),
      hoursPerDay: $('#s-hours').value.trim(),
      estimationApproach: $('#s-est').value.trim(),
      sprintLength: $('#s-sprint').value.trim(),
      resources: $('#s-resources').value.trim(),
      constraints: $('#s-constraints').value.trim(),
      compressionPref: $('#s-compress').value.trim(),
      notes: $('#s-notes').value.trim()
    };
  }

  function prepareScheduleInputsView() {
    var c = state.charter;
    var refEl = document.getElementById('charter-ref');
    if (c && refEl) {
      var msTxt = (c.milestones||[]).map(function(m){ return m.name + (m.deadline?' ('+fmtDate(m.deadline)+')':''); }).join(' · ');
      var deliv = (c.keyDeliverables||[]).join(' · ');
      refEl.innerHTML = '<div class="charter-ref-inner">'
        + '<div class="cr-label">Reusing from charter</div>'
        + '<div class="cr-title">' + esc(c.projectName) + '</div>'
        + '<div class="cr-meta"><strong>Objective:</strong> ' + esc(c.objective) + '</div>'
        + '<div class="cr-meta"><strong>Deliverables:</strong> ' + esc(deliv) + '</div>'
        + '<div class="cr-meta"><strong>Milestones:</strong> ' + esc(msTxt) + '</div>'
        + '<div class="cr-meta"><strong>Team:</strong> ' + esc((c.teamMembers||[]).join(', ')) + ' &nbsp;|&nbsp; <strong>PM:</strong> ' + esc((c.projectManagers||[]).join(', ')) + '</div>'
        + '</div>';
      // prefill resources if empty
      var resInput = document.getElementById('s-resources');
      if (resInput && !resInput.value.trim() && c.teamMembers && c.teamMembers.length) {
        resInput.value = c.teamMembers.join(', ');
      }
      // prefill constraints from risks/notes
      var consInput = document.getElementById('s-constraints');
      if (consInput && !consInput.value.trim() && c.highLevelRequirements && c.highLevelRequirements.length) {
        consInput.placeholder = 'e.g. ' + c.highLevelRequirements.slice(0,2).join('; ');
      }
    } else if (refEl) {
      refEl.innerHTML = '<div class="charter-ref-inner"><div class="cr-label">No charter yet</div><div class="cr-title">Generate a charter first, or the schedule will be built from your brief alone.</div></div>';
    }
  }

  function callScheduleGemini() {
    if (state.generating) return;
    if (!state.apiKey) { toast('Add your Gemini API key first.', 'error'); showView('key'); return; }
    if (!state.charter && !state.idea) { toast('Describe a project first.', 'error'); showView('idea'); return; }
    state.schedInputs = readSchedInputs();
    state.generating = true;
    var btn = document.getElementById('btn-generate-schedule');
    if (btn) btn.disabled = true;
    startOverlay(SCHED_STATUS);
    window.GeminiService.generateSchedule({
      apiKey: state.apiKey,
      charter: state.charter,
      idea: state.idea,
      details: state.details,
      schedInputs: state.schedInputs
    }).then(function (schedule) {
      state.schedule = schedule;
      // compute CPM immediately to ensure dates consistent
      buildScheduleEditor();
      renderSchedulePreview();
      showView('schedule-review');
      toast('Schedule forged with ' + window.GeminiService.PRIMARY_MODEL + ' — ' + schedule.activities.length + ' activities, ' + schedule.dependencies.length + ' links.', 'success');
    }).catch(function (err) {
      toast((err && err.message) || 'Could not generate schedule.', 'error');
    }).finally(function () {
      state.generating = false;
      stopOverlay();
      if (btn) btn.disabled = false;
    });
  }

  /* ---------- schedule editor ---------- */
  function buildScheduleEditor() {
    var s = state.schedule;
    if (!s) return;
    var pane = document.getElementById('schedule-editor-pane');
    var h = '';

    h += '<div class="edit-group"><p class="group-label">01 · Overview</p>'
      + '<div class="field"><label for="se-projectName">Project name</label><input type="text" id="se-projectName" data-sfield="projectName" value="' + esc(s.projectName) + '" /></div>'
      + '<div class="field"><label for="se-method">Methodology</label><select id="se-method" data-sfield="methodology"><option value="Waterfall"' + (s.methodology==='Waterfall'?' selected':'') + '>Waterfall</option><option value="Agile"' + (s.methodology==='Agile'?' selected':'') + '>Agile</option><option value="Hybrid"' + (s.methodology==='Hybrid'?' selected':'') + '>Hybrid</option></select></div>'
      + '<div class="field"><label for="se-start">Planned start</label><input type="date" id="se-start" data-sfield="plannedStart" value="' + esc(s.plannedStart) + '" /></div>'
      + '<div class="field"><label for="se-end">Planned end</label><input type="date" id="se-end" data-sfield="plannedEnd" value="' + esc(s.plannedEnd) + '" /></div>'
      + '</div>';

    h += '<div class="edit-group"><p class="group-label">02 · Plan & Control</p>'
      + '<div class="field"><label for="se-policy">Schedule policy</label><textarea class="grow" rows="2" id="se-policy" data-splan="policy">' + esc(s.planScheduleManagement.policy) + '</textarea></div>'
      + '<div class="field"><label for="se-tools">Tools (one per line)</label><textarea class="grow" rows="2" id="se-tools" data-splan="tools">' + esc((s.planScheduleManagement.tools||[]).join('\n')) + '</textarea></div>'
      + '<div class="field"><label for="se-roles">Roles</label><input type="text" id="se-roles" data-splan="roles" value="' + esc(s.planScheduleManagement.roles) + '" /></div>'
      + '<div class="field"><label for="se-baseline">Baseline date</label><input type="date" id="se-baseline" data-sctrl="baselineDate" value="' + esc(s.controlPlan.baselineDate) + '" /></div>'
      + '<div class="field"><label for="se-variance">Variance threshold</label><input type="text" id="se-variance" data-sctrl="varianceThreshold" value="' + esc(s.controlPlan.varianceThreshold) + '" /></div>'
      + '<div class="field"><label for="se-change">Change control process</label><textarea class="grow" rows="2" id="se-change" data-sctrl="changeControlProcess">' + esc(s.controlPlan.changeControlProcess) + '</textarea></div>'
      + '</div>';

    h += '<div class="edit-group"><p class="group-label">03 · Activities (with PERT & Agile)</p>'
      + '<div id="list-sched-activities">' + schedActivityRows(s.activities) + '</div>'
      + '<button type="button" class="add-row" data-action="add" data-list="sched-activities">+ Add activity</button>'
      + '<p class="help">PERT Expected = (O + 4ML + P)/6 auto-recomputed. Milestone = 0 days.</p></div>';

    h += '<div class="edit-group"><p class="group-label">04 · Dependencies (PDM: FS/SS/FF/SF + Lead/Lag)</p>'
      + '<div id="list-sched-deps">' + schedDepRows(s.dependencies) + '</div>'
      + '<button type="button" class="add-row" data-action="add" data-list="sched-deps">+ Add link</button>'
      + '<p class="help">Lead = overlap before predecessor finishes (e.g. FS-2d). Lag = waiting time (e.g. FS+2d).</p></div>';

    h += '<div class="edit-group"><p class="group-label">05 · Resources & Compression</p>'
      + '<div class="field"><label for="se-level">Resource leveling</label><textarea class="grow" rows="2" id="se-level" data-sres="levelingNotes">' + esc(s.resourcePlan.levelingNotes) + '</textarea><p class="help">May change critical path & end date</p></div>'
      + '<div class="field"><label for="se-smooth">Resource smoothing</label><textarea class="grow" rows="2" id="se-smooth" data-sres="smoothingNotes">' + esc(s.resourcePlan.smoothingNotes) + '</textarea><p class="help">Uses float — path & date unchanged</p></div>'
      + '<div class="field"><label for="se-crash">Crashing options (one per line)</label><textarea class="grow" rows="2" id="se-crash" data-scomp="crashOptions">' + esc((s.compression.crashOptions||[]).join('\n')) + '</textarea></div>'
      + '<div class="field"><label for="se-fast">Fast-tracking options (one per line)</label><textarea class="grow" rows="2" id="se-fast" data-scomp="fastTrackOptions">' + esc((s.compression.fastTrackOptions||[]).join('\n')) + '</textarea></div>'
      + '</div>';

    pane.innerHTML = h;
    growTextareas(pane);
  }

  function schedActivityRows(items) {
    var html='';
    items.forEach(function(a,i){
      html += '<div class="item-card">'
        + '<div class="item-head"><span class="item-index">' + esc(a.id) + ' · ' + esc(a.wbsId) + '</span>'
        + '<label class="check-row" style="margin:0;font-size:12px"><input type="checkbox" data-sched="activities" data-idx="' + i + '" data-part="isMilestone"' + (a.isMilestone?' checked':'') + ' /> Milestone (0d)</label>'
        + '<button type="button" class="row-remove" data-action="remove" data-list="sched-activities" data-idx="' + i + '"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg></button>'
        + '</div>'
        + '<div class="item-fields">'
        + '<div class="item-field"><label>ID</label><input type="text" data-sched="activities" data-idx="' + i + '" data-part="id" value="' + esc(a.id) + '" /></div>'
        + '<div class="item-field"><label>WBS</label><input type="text" data-sched="activities" data-idx="' + i + '" data-part="wbsId" value="' + esc(a.wbsId) + '" /></div>'
        + '<div class="item-field"><label>Activity name</label><input type="text" data-sched="activities" data-idx="' + i + '" data-part="name" value="' + esc(a.name) + '" /></div>'
        + '<div class="item-field"><label>Description</label><input type="text" data-sched="activities" data-idx="' + i + '" data-part="description" value="' + esc(a.description) + '" /></div>'
        + '<div class="item-fields grid-two">'
        + '<div class="item-field"><label>Est. method</label><input type="text" data-sched="activities" data-idx="' + i + '" data-part="estimationMethod" value="' + esc(a.estimationMethod||'') + '" placeholder="PERT / Story Points…" /></div>'
        + '<div class="item-field"><label>Duration (days)</label><input type="number" step="0.5" min="0" data-sched="activities" data-idx="' + i + '" data-part="durationDays" value="' + esc(a.durationDays) + '" /></div>'
        + '</div>'
        + '<div class="item-fields grid-two">'
        + '<div class="item-field"><label>O (optimistic)</label><input type="number" step="0.5" data-sched="activities" data-idx="' + i + '" data-part="optimistic" value="' + esc(a.optimistic) + '" /></div>'
        + '<div class="item-field"><label>ML</label><input type="number" step="0.5" data-sched="activities" data-idx="' + i + '" data-part="mostLikely" value="' + esc(a.mostLikely) + '" /></div>'
        + '</div>'
        + '<div class="item-fields grid-two">'
        + '<div class="item-field"><label>P (pessimistic)</label><input type="number" step="0.5" data-sched="activities" data-idx="' + i + '" data-part="pessimistic" value="' + esc(a.pessimistic) + '" /></div>'
        + '<div class="item-field"><label>Expected (auto)</label><input type="text" disabled value="' + esc(a.expectedDuration) + '" /></div>'
        + '</div>'
        + '<div class="item-fields grid-two">'
        + '<div class="item-field"><label>Story points</label><input type="number" data-sched="activities" data-idx="' + i + '" data-part="storyPoints" value="' + esc(a.storyPoints!=null?a.storyPoints:'') + '" placeholder="e.g. 8" /></div>'
        + '<div class="item-field"><label>T-Shirt</label><input type="text" data-sched="activities" data-idx="' + i + '" data-part="tShirtSize" value="' + esc(a.tShirtSize||'') + '" placeholder="XS/S/M/L" /></div>'
        + '</div>'
        + '<div class="item-field"><label>Resources (comma-separated)</label><input type="text" data-sched="activities" data-idx="' + i + '" data-part="resources" value="' + esc((a.resources||[]).join(', ')) + '" /></div>'
        + '<div class="item-field"><label>Constraint</label><input type="text" data-sched="activities" data-idx="' + i + '" data-part="constraint" value="' + esc(a.constraint||'') + '" /></div>'
        + '</div></div>';
    });
    return html;
  }

  function schedDepRows(items) {
    var html='';
    items.forEach(function(d,i){
      html += '<div class="item-card"><div class="item-head"><span class="item-index">Link ' + ('0'+(i+1)).slice(-2) + '</span>'
        + '<button type="button" class="row-remove" data-action="remove" data-list="sched-deps" data-idx="' + i + '"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg></button></div>'
        + '<div class="item-fields grid-two">'
        + '<div class="item-field"><label>From (id)</label><input type="text" data-sched="deps" data-idx="' + i + '" data-part="from" value="' + esc(d.from) + '" /></div>'
        + '<div class="item-field"><label>To (id)</label><input type="text" data-sched="deps" data-idx="' + i + '" data-part="to" value="' + esc(d.to) + '" /></div>'
        + '</div>'
        + '<div class="item-fields grid-two">'
        + '<div class="item-field"><label>Type</label><select data-sched="deps" data-idx="' + i + '" data-part="type"><option value="FS"' + (d.type==='FS'?' selected':'') + '>FS — Finish→Start</option><option value="SS"' + (d.type==='SS'?' selected':'') + '>SS — Start→Start</option><option value="FF"' + (d.type==='FF'?' selected':'') + '>FF — Finish→Finish</option><option value="SF"' + (d.type==='SF'?' selected':'') + '>SF — Start→Finish</option></select></div>'
        + '<div class="item-field"><label>Lag / Lead (days)</label><div style="display:flex;gap:6px"><input type="number" style="flex:1" data-sched="deps" data-idx="' + i + '" data-part="lagDays" value="' + esc(d.lagDays) + '" placeholder="Lag" /><input type="number" style="flex:1" data-sched="deps" data-idx="' + i + '" data-part="leadDays" value="' + esc(d.leadDays) + '" placeholder="Lead" /></div></div>'
        + '</div></div>';
    });
    return html;
  }

  function bindScheduleEditorEvents() {
    var pane = document.getElementById('schedule-editor-pane');
    if (!pane) return;
    pane.addEventListener('input', function(e){
      var t=e.target;
      if (t.tagName==='TEXTAREA') growTextarea(t);
      if (!state.schedule) return;
      if (t.matches('[data-sfield]')) {
        state.schedule[t.getAttribute('data-sfield')] = t.value;
        schedulePreviewDebounced();
      } else if (t.matches('[data-splan]')) {
        var k=t.getAttribute('data-splan');
        if (k==='tools') state.schedule.planScheduleManagement.tools = textToLines(t.value);
        else state.schedule.planScheduleManagement[k]=t.value;
        schedulePreviewDebounced();
      } else if (t.matches('[data-sctrl]')) {
        state.schedule.controlPlan[t.getAttribute('data-sctrl')] = t.value;
        schedulePreviewDebounced();
      } else if (t.matches('[data-sres]')) {
        state.schedule.resourcePlan[t.getAttribute('data-sres')] = t.value;
        schedulePreviewDebounced();
      } else if (t.matches('[data-scomp]')) {
        state.schedule.compression[t.getAttribute('data-scomp')] = textToLines(t.value);
        schedulePreviewDebounced();
      } else if (t.matches('[data-sched]')) {
        var idx=+t.getAttribute('data-idx');
        var part=t.getAttribute('data-part');
        var list=t.getAttribute('data-sched');
        if (list==='activities') {
          var act=state.schedule.activities[idx];
          if (!act) return;
          if (part==='isMilestone') {
            act.isMilestone = t.checked;
            if (act.isMilestone) act.durationDays=0;
            else if (!act.durationDays) act.durationDays = act.expectedDuration||1;
            buildScheduleEditor();
            renderSchedulePreview();
            return;
          }
          if (['durationDays','optimistic','mostLikely','pessimistic','storyPoints'].indexOf(part)!==-1) {
            var num = t.value===''? undefined : parseFloat(t.value);
            act[part]= isNaN(num)? t.value : num;
            // recompute expected if PERT fields changed
            if (['optimistic','mostLikely','pessimistic'].indexOf(part)!==-1) {
              var o=parseFloat(act.optimistic), ml=parseFloat(act.mostLikely), p=parseFloat(act.pessimistic);
              if (isFinite(o)&&isFinite(ml)&&isFinite(p)) {
                act.expectedDuration = Math.round(((o+4*ml+p)/6)*10)/10;
                if (!act.isMilestone) act.durationDays = act.expectedDuration;
              }
            }
            if (part==='durationDays' && act.isMilestone) act.durationDays=0;
          } else if (part==='resources') {
            act.resources = t.value.split(',').map(function(s){return s.trim();}).filter(Boolean);
          } else {
            act[part]=t.value;
          }
        } else if (list==='deps') {
          var dep=state.schedule.dependencies[idx];
          if (!dep) return;
          if (part==='lagDays' || part==='leadDays') dep[part]= t.value===''?0:parseFloat(t.value)||0;
          else dep[part]= t.value.toUpperCase().trim();
        }
        recomputeAndRenderSchedule();
      }
    });
    pane.addEventListener('change', function(e){
      var t=e.target;
      if (t.matches('[data-sched][data-part="type"]') || t.matches('[data-sched][data-part="isMilestone"]')) {
        recomputeAndRenderSchedule();
      }
      if (t.matches('[data-sfield="methodology"]')) {
        state.schedule.methodology = t.value;
        renderSchedulePreview();
      }
    });
    pane.addEventListener('click', function(e){
      var btn=e.target.closest('[data-action]');
      if (!btn || !state.schedule) return;
      var action=btn.getAttribute('data-action');
      var list=btn.getAttribute('data-list');
      if (action==='remove') {
        var idx=+btn.getAttribute('data-idx');
        if (list==='sched-activities') {
          if (state.schedule.activities.length>2) { state.schedule.activities.splice(idx,1); buildScheduleEditor(); recomputeAndRenderSchedule(); }
          else toast('Keep at least two activities.', 'error');
        } else if (list==='sched-deps') {
          if (state.schedule.dependencies.length>1) { state.schedule.dependencies.splice(idx,1); buildScheduleEditor(); recomputeAndRenderSchedule(); }
          else toast('Keep at least one dependency.', 'error');
        }
      } else if (action==='add') {
        if (list==='sched-activities') {
          var n=state.schedule.activities.length+1;
          state.schedule.activities.push({ id:'A'+('0'+n).slice(-2), wbsId:'1.'+n, name:'New activity', description:'', isMilestone:false, estimationMethod:'PERT', optimistic:2, mostLikely:4, pessimistic:6, expectedDuration:4, durationDays:4, resources:[], constraint:'' });
          buildScheduleEditor(); recomputeAndRenderSchedule();
        } else if (list==='sched-deps') {
          var ids=state.schedule.activities.map(function(a){return a.id;});
          state.schedule.dependencies.push({ from: ids[0]||'A01', to: ids[ids.length-1]||'A02', type:'FS', lagDays:0, leadDays:0 });
          buildScheduleEditor(); recomputeAndRenderSchedule();
        }
      }
    });
  }

  function recomputeAndRenderSchedule() {
    if (!state.schedule || !window.ScheduleLogic) return;
    var res = window.ScheduleLogic.computeCPM(state.schedule);
    // update criticalPath & duration for consistency
    state.schedule.criticalPath = res.criticalPath;
    state.schedule.projectDurationDays = res.projectDuration;
    // refresh editor expected fields? rebuild would lose focus, so just preview
    renderSchedulePreview();
  }

  var schedulePreviewDebounced = debounce(function(){ recomputeAndRenderSchedule(); }, 300);

  function renderSchedulePreview() {
    var s = state.schedule;
    if (!s || !window.ScheduleLogic) return;
    var cpm = window.ScheduleLogic.computeCPM(s);
    var el = document.getElementById('schedule-preview-scroll');
    if (!el) return;

    function schedTd(cls, content, attrs){ return '<td class="'+cls+'"' + (attrs||'') + '>' + esc(content) + '</td>'; }

    var h='';
    // Mini charter-style header
    h += '<table class="charter" style="margin-bottom:18px"><colgroup><col class="c-label" /><col class="c-main" /><col class="c-second" /><col class="c-extra" /></colgroup>';
    h += '<tr><td class="doc-corner"></td><td class="doc-title" colspan="3">Project Schedule — ' + esc(s.projectName) + '</td></tr>';
    h += '<tr>' + schedTd('doc-label','Method') + schedTd('doc-light', s.methodology + '  ·  ' + s.plannedStart + ' → ' + s.plannedEnd + '  ·  ' + cpm.projectDuration + ' days', ' colspan="3"') + '</tr>';
    var policy = s.planScheduleManagement.policy || '';
    h += '<tr>' + schedTd('doc-label','Plan: Policy') + schedTd('doc-pale', policy, ' colspan="3"') + '</tr>';
    h += '<tr>' + schedTd('doc-label','Tools') + schedTd('doc-pale', (s.planScheduleManagement.tools||[]).join('  ·  '), ' colspan="3"') + '</tr>';
    h += '<tr>' + schedTd('doc-label','Control') + schedTd('doc-pale', 'Baseline ' + fmtDateSchedule(s.controlPlan.baselineDate) + '  ·  Variance ' + s.controlPlan.varianceThreshold + '  ·  ' + s.controlPlan.changeControlProcess, ' colspan="3"') + '</tr>';
    h += '</table>';

    // Activities table
    h += '<table class="charter" style="margin-bottom:18px"><colgroup><col style="width:9%" /><col style="width:9%" /><col style="width:24%" /><col style="width:28%" /><col style="width:14%" /><col style="width:16%" /></colgroup>';
    h += '<tr>' + schedTd('doc-sub','ID') + schedTd('doc-sub','WBS') + schedTd('doc-sub','Activity') + schedTd('doc-sub','Resources / Constraint') + schedTd('doc-sub','Method') + schedTd('doc-sub','Dur') + '</tr>';
    (s.activities||[]).forEach(function(a){
      var isCrit = cpm.map[a.id] && cpm.map[a.id].isCritical;
      var cls = a.isMilestone ? 'doc-light' : (isCrit ? 'doc-crit' : 'doc-pale');
      // custom crit styling inline via class
      h += '<tr>'
        + schedTd(cls + (isCrit?' doc-bold':''), a.id)
        + schedTd(cls, a.wbsId)
        + schedTd(cls, a.name + (a.isMilestone?'  ◆':'' ) + (isCrit?' ★':''))
        + schedTd(cls, (a.resources||[]).join(', ') + (a.constraint?' — '+a.constraint:''))
        + schedTd(cls, a.estimationMethod + (a.storyPoints!=null?' ('+a.storyPoints+'pts)':'') + (a.tShirtSize?' ['+a.tShirtSize+']':''))
        + schedTd(cls + ' doc-right', (a.isMilestone?'0 (milestone)': a.durationDays + 'd'))
        + '</tr>';
    });
    h += '</table>';

    // Duration estimates / PERT
    h += '<table class="charter" style="margin-bottom:18px"><colgroup><col style="width:10%" /><col style="width:30%" /><col style="width:12%" /><col style="width:12%" /><col style="width:12%" /><col style="width:12%" /><col style="width:12%" /></colgroup>';
    h += '<tr>' + schedTd('doc-sub','ID') + schedTd('doc-sub','Activity') + schedTd('doc-sub','O') + schedTd('doc-sub','ML') + schedTd('doc-sub','P') + schedTd('doc-sub','Expected') + schedTd('doc-sub','(O+4ML+P)/6') + '</tr>';
    (s.activities||[]).forEach(function(a){
      var exp = a.expectedDuration;
      var cls = a.isMilestone ? 'doc-light' : 'doc-pale';
      h += '<tr>' + schedTd(cls, a.id) + schedTd(cls, a.name) + schedTd(cls + ' doc-right', a.isMilestone? '—' : String(a.optimistic)) + schedTd(cls + ' doc-right', a.isMilestone? '—' : String(a.mostLikely)) + schedTd(cls + ' doc-right', a.isMilestone? '—' : String(a.pessimistic)) + schedTd('doc-light doc-right doc-bold', a.isMilestone? '0' : String(exp)) + schedTd('doc-light doc-right', a.isMilestone? 'milestone' : exp + 'd') + '</tr>';
    });
    h += '<tr><td class="doc-pale" colspan="7" style="text-align:center;font-size:11px;color:#46506e">PERT Expected = (O + 4×ML + P) / 6  ·  Story Points via Planning Poker (Fibonacci)  ·  T-Shirt: XS=1 sprint, S=2–4, M=4–12, L=12+ sprints</td></tr>';
    h += '</table>';

    // PDM dependencies
    h += '<table class="charter" style="margin-bottom:18px"><colgroup><col style="width:14%" /><col style="width:6%" /><col style="width:14%" /><col style="width:12%" /><col style="width:12%" /><col style="width:12%" /><col style="width:30%" /></colgroup>';
    h += '<tr>' + schedTd('doc-sub','From') + schedTd('doc-sub','→') + schedTd('doc-sub','To') + schedTd('doc-sub','Type') + schedTd('doc-sub','Lag') + schedTd('doc-sub','Lead') + schedTd('doc-sub','Meaning') + '</tr>';
    var meanings={ FS:'B starts after A finishes', SS:'B starts after A starts', FF:'B finishes after A finishes', SF:'B finishes after A starts' };
    (s.dependencies||[]).forEach(function(d){
      var isCrit = cpm.map[d.from]&&cpm.map[d.from].isCritical && cpm.map[d.to]&&cpm.map[d.to].isCritical;
      var cls = isCrit ? 'doc-crit' : 'doc-pale';
      h += '<tr>' + schedTd(cls+' doc-bold', d.from) + schedTd(cls, '→') + schedTd(cls+' doc-bold', d.to) + schedTd(cls+' doc-bold', d.type) + schedTd(cls+' doc-right', d.lagDays? d.lagDays+'d':'—') + schedTd(cls+' doc-right', d.leadDays? d.leadDays+'d':'—') + schedTd(cls, meanings[d.type]||'') + '</tr>';
    });
    h += '<tr><td class="doc-pale" colspan="7" style="text-align:center;font-size:11px;color:#46506e">PDM: nodes = activities (boxes), arrows = dependencies  ·  Lead = acceleration (overlap), Lag = intentional waiting time</td></tr>';
    h += '</table>';

    // Schedule / CPM
    h += '<table class="charter" style="margin-bottom:18px"><colgroup><col style="width:10%" /><col style="width:24%" /><col style="width:12%" /><col style="width:12%" /><col style="width:8%" /><col style="width:8%" /><col style="width:8%" /><col style="width:8%" /><col style="width:10%" /></colgroup>';
    h += '<tr>' + schedTd('doc-sub','ID') + schedTd('doc-sub','Activity') + schedTd('doc-sub','Start') + schedTd('doc-sub','End') + schedTd('doc-sub','ES') + schedTd('doc-sub','EF') + schedTd('doc-sub','Float') + schedTd('doc-sub','Dur') + schedTd('doc-sub','Critical?') + '</tr>';
    var sorted=[].concat(s.activities||[]).sort(function(a,b){ return (cpm.map[a.id]?cpm.map[a.id].es:0) - (cpm.map[b.id]?cpm.map[b.id].es:0); });
    sorted.forEach(function(a){
      var cp=cpm.map[a.id]||{ startDate:'', endDate:'', es:0, ef:0, float:0, isCritical:false };
      var cls = a.isMilestone ? 'doc-light' : (cp.isCritical ? 'doc-crit' : 'doc-pale');
      h += '<tr>' + schedTd(cls+' doc-bold', a.id) + schedTd(cls, a.name + (a.isMilestone?' ◆':'')) + schedTd(cls+' doc-right', fmtDateSchedule(cp.startDate)) + schedTd(cls+' doc-right', fmtDateSchedule(cp.endDate)) + schedTd(cls+' doc-right', String(cp.es)) + schedTd(cls+' doc-right', String(cp.ef)) + schedTd(cls+' doc-right doc-bold', cp.float + 'd') + schedTd(cls+' doc-right', a.durationDays + 'd') + schedTd(cls+' doc-bold', cp.isCritical?'★ YES — 0 float':'') + '</tr>';
    });
    h += '<tr><td class="doc-dark" colspan="9" style="text-align:center;color:#fff;font-weight:700">Critical Path: ' + esc(cpm.criticalPath.join(' → ') || '—') + '  ·  Project Duration: ' + cpm.projectDuration + ' days  ·  Float = 0 on critical path</td></tr>';
    h += '</table>';

    // Resources & Compression & Agile
    h += '<table class="charter" style="margin-bottom:10px"><colgroup><col class="c-label" /><col class="c-main" /><col class="c-second" /><col class="c-extra" /></colgroup>';
    h += '<tr>' + schedTd('doc-label','Resources') + schedTd('doc-sub','Technique') + schedTd('doc-sub','Notes',' colspan="2"') + '</tr>';
    h += '<tr>' + schedTd('doc-label','Leveling',' rowspan="2"') + schedTd('doc-pale','Leveling') + schedTd('doc-pale', s.resourcePlan.levelingNotes, ' colspan="2"') + '</tr>';
    h += '<tr>' + schedTd('doc-pale','Smoothing') + schedTd('doc-pale', s.resourcePlan.smoothingNotes, ' colspan="2"') + '</tr>';
    h += '<tr>' + schedTd('doc-label','Compression',' rowspan="2"') + schedTd('doc-pale','Crashing') + schedTd('doc-pale', (s.compression.crashOptions||[]).join(' · ')||'—', ' colspan="2"') + '</tr>';
    h += '<tr>' + schedTd('doc-pale','Fast-Tracking') + schedTd('doc-pale', (s.compression.fastTrackOptions||[]).join(' · ')||'—', ' colspan="2"') + '</tr>';
    if (s.agileRelease && s.agileRelease.sprints) {
      h += '<tr>' + schedTd('doc-label','Agile Release') + schedTd('doc-sub','Sprint') + schedTd('doc-sub','Goal') + schedTd('doc-sub','Velocity') + '</tr>';
      s.agileRelease.sprints.forEach(function(sp){
        h += '<tr>' + schedTd('doc-pale','') + schedTd('doc-pale doc-bold', sp.sprint) + schedTd('doc-pale', sp.goal + (sp.activityIds? ' — ' + sp.activityIds.join(', '):'')) + schedTd('doc-light doc-right doc-bold', sp.velocityPoints? sp.velocityPoints+' pts':'') + '</tr>';
      });
    }
    h += '<tr>' + schedTd('doc-label','Control') + schedTd('doc-pale', 'Variance: ' + s.controlPlan.varianceThreshold, ' colspan="1"') + schedTd('doc-pale', s.controlPlan.retrospectiveCadence || '', ' colspan="1"') + schedTd('doc-pale', s.controlPlan.velocityTarget || '', ' colspan="1"') + '</tr>';
    h += '</table>';

    el.innerHTML = h;
  }

  function downloadSchedule() {
    if (!state.schedule) return;
    if (!state.excelReady || !window.ScheduleExcel) { toast('Excel engine not ready.', 'error'); return; }
    var wb = window.ScheduleExcel.buildScheduleWorkbook(state.schedule);
    wb.xlsx.writeBuffer().then(function(buf){
      var blob=new Blob([buf],{type:XLSX_MIME});
      var url=URL.createObjectURL(blob);
      var a=document.createElement('a');
      a.href=url; a.download=sanitizeFilename(state.schedule.projectName, 'project-schedule.xlsx');
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function(){ URL.revokeObjectURL(url); },5000);
      toast('Schedule workbook downloaded — 6 sheets, formatted like your charter.', 'success');
    }).catch(function(err){ toast('Could not build schedule workbook: ' + (err&&err.message||'unknown'), 'error'); });
  }

  /* ---------- wiring ---------- */
  function initReviewStep() {
    bindEditorEvents();
    $('#btn-download').addEventListener('click', download);
    $('#btn-regenerate').addEventListener('click', function () { if (state.generating) return; callGemini(); });
    $('#btn-edit-inputs').addEventListener('click', function () { showView('idea'); });
    $('#btn-startover').addEventListener('click', function () {
      state.charter = null; state.schedule=null; state.idea = '';
      $('#input-idea').value = '';
      $('#input-idea').dispatchEvent(new Event('input'));
      showView('idea');
      toast('Cleared. Describe a new project whenever you are ready.');
    });
    var toSched = document.getElementById('btn-to-schedule');
    if (toSched) toSched.addEventListener('click', function(){
      if (!state.charter) { toast('Generate a charter first.', 'error'); return; }
      showView('schedule-inputs');
    });
  }

  function initScheduleSteps() {
    var genBtn = document.getElementById('btn-generate-schedule');
    if (genBtn) genBtn.addEventListener('click', callScheduleGemini);
    var backCharter = document.getElementById('btn-back-charter');
    if (backCharter) backCharter.addEventListener('click', function(){ showView('review'); });
    var backCharter2 = document.getElementById('btn-back-to-charter2');
    if (backCharter2) backCharter2.addEventListener('click', function(){ showView('review'); });
    var downloadSched = document.getElementById('btn-download-schedule');
    if (downloadSched) downloadSched.addEventListener('click', downloadSchedule);
    var regenSched = document.getElementById('btn-regenerate-schedule');
    if (regenSched) regenSched.addEventListener('click', function(){ if(state.generating) return; callScheduleGemini(); });
    var editInputs = document.getElementById('btn-edit-schedule-inputs');
    if (editInputs) editInputs.addEventListener('click', function(){ showView('schedule-inputs'); });
    bindScheduleEditorEvents();
  }

  function initBrand() {
    $('#brand-home').addEventListener('click', function (e) {
      e.preventDefault();
      if (state.schedule) showView('schedule-review');
      else if (state.charter) showView('review');
      else if (state.apiKey) showView('idea');
      else showView('key');
    });
  }

  function init() {
    initKeyStep();
    initIdeaStep();
    initReviewStep();
    initScheduleSteps();
    initBrand();
    if (!state.excelReady) {
      toast('Could not load the local Excel engine - downloads will be disabled until you reconnect.', 'error');
    }
    showView(state.apiKey ? 'idea' : 'key');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
