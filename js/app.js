(function () {
  'use strict';

  var LS_KEY = 'cf_gemini_key';
  var XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  var state = {
    apiKey: '',
    idea: '',
    details: {},
    charter: null,
    generating: false,
    excelReady: typeof window.ExcelJS !== 'undefined'
  };

  var $ = function (sel) { return document.querySelector(sel); };

  var views = {
    key: $('#view-key'),
    idea: $('#view-idea'),
    review: $('#view-review')
  };

  /* ---------- utils ---------- */

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fmtDate(iso) {
    if (!state.excelReady) return String(iso || '');
    return window.ExcelBuilder.fmtDate(iso);
  }

  function todayIso() {
    var d = new Date();
    var m = ('0' + (d.getMonth() + 1)).slice(-2);
    var day = ('0' + d.getDate()).slice(-2);
    return d.getFullYear() + '-' + m + '-' + day;
  }

  function sanitizeFilename(name) {
    var base = String(name || 'project').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 60);
    return (base || 'project') + '-project-charter.xlsx';
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

  /* ---------- toasts ---------- */

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

  function showView(name) {
    Object.keys(views).forEach(function (k) {
      views[k].hidden = k !== name;
    });
    var order = ['key', 'idea', 'review'];
    var idx = order.indexOf(name);
    document.querySelectorAll('.step-chip').forEach(function (chip) {
      var s = chip.getAttribute('data-step');
      var i = order.indexOf(s);
      chip.classList.toggle('is-active', i === idx);
      chip.classList.toggle('is-done', i < idx);
    });
    if (name === 'idea') growTextareas(views.idea);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ---------- step 1 · api key ---------- */

  function initKeyStep() {
    var input = $('#input-key');
    var saved = '';
    try { saved = localStorage.getItem(LS_KEY) || ''; } catch (e) { saved = ''; }
    if (saved) {
      input.value = saved;
      state.apiKey = saved;
    }

    $('#toggle-key').addEventListener('click', function () {
      input.type = input.type === 'password' ? 'text' : 'password';
      input.focus();
    });

    $('#form-key').addEventListener('submit', function (e) {
      e.preventDefault();
      var key = input.value.trim();
      if (key.length < 20) {
        toast('That does not look like a valid Gemini API key - it should be a long string starting with "AIza".', 'error');
        input.focus();
        return;
      }
      state.apiKey = key;
      if ($('#remember-key').checked) {
        try { localStorage.setItem(LS_KEY, key); } catch (e2) { /* private mode */ }
      } else {
        try { localStorage.removeItem(LS_KEY); } catch (e3) { /* private mode */ }
      }
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
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !genBtn.disabled) {
        generate();
      }
    });

    $('#btn-example').addEventListener('click', function () {
      ideaEl.value = EXAMPLE_IDEA;
      refresh();
      ideaEl.focus();
    });

    $('#btn-back-key').addEventListener('click', function () {
      showView('key');
    });

    genBtn.addEventListener('click', generate);
    refresh();
  }

  /* ---------- generation ---------- */

  var STATUS_LINES = [
    'Analyzing your idea',
    'Drafting objectives and success criteria',
    'Laying out milestones and deadlines',
    'Assigning resources, risks and stakeholders',
    'Formatting your Excel charter'
  ];
  var statusTimer = null;

  function startOverlay() {
    var el = $('#overlay');
    var status = $('#overlay-status');
    var i = 0;
    status.textContent = STATUS_LINES[0];
    clearInterval(statusTimer);
    statusTimer = setInterval(function () {
      i = (i + 1) % STATUS_LINES.length;
      status.textContent = STATUS_LINES[i];
    }, 2200);
    el.hidden = false;
  }

  function stopOverlay() {
    clearInterval(statusTimer);
    statusTimer = null;
    $('#overlay').hidden = true;
  }

  function generate() {
    if (state.generating) return;
    state.idea = $('#input-idea').value.trim();
    if (state.idea.length < 20) {
      toast('Please describe your idea in at least a sentence or two.', 'error');
      return;
    }
    if (!state.apiKey) {
      toast('Add your Gemini API key first.', 'error');
      showView('key');
      return;
    }
    state.details = readDetails();
    callGemini();
  }

  function callGemini() {
    state.generating = true;
    $('#btn-generate').disabled = true;
    startOverlay();

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
      var msg = (err && err.message) || 'Something went wrong while generating the charter.';
      toast(msg, 'error');
    }).finally(function () {
      state.generating = false;
      stopOverlay();
      $('#btn-generate').disabled = false;
    });
  }

  /* ---------- step 3 · editor ---------- */

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
        html += '<div class="item-field"><label for="' + id + '">' + esc(f.label) + '</label>' +
          '<input type="' + f.type + '" id="' + id + '" value="' + esc(item[f.part] || '') +
          '" placeholder="' + esc(f.placeholder || '') + '" data-list="' + listName +
          '" data-idx="' + i + '" data-part="' + f.part + '" /></div>';
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

  /* ---------- preview ---------- */

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
    $('#preview-scroll').innerHTML = h;
  }

  function numJoin(arr) {
    return (arr || []).map(function (s, i) { return (i + 1) + '. ' + s; }).join('\n');
  }

  /* ---------- download ---------- */

  function download() {
    if (!state.charter) return;
    if (!state.excelReady) {
      toast('Excel library failed to load. Check your internet connection and reload the page.', 'error');
      return;
    }
    var wb = window.ExcelBuilder.buildWorkbook(state.charter);
    wb.xlsx.writeBuffer().then(function (buf) {
      var blob = new Blob([buf], { type: XLSX_MIME });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = sanitizeFilename(state.charter.projectName);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
      toast('Excel charter downloaded - opens cleanly in Excel, Sheets and LibreOffice.', 'success');
    }).catch(function (err) {
      toast('Could not build the workbook: ' + (err && err.message ? err.message : 'unknown error'), 'error');
    });
  }

  /* ---------- wiring ---------- */

  function initReviewStep() {
    bindEditorEvents();
    $('#btn-download').addEventListener('click', download);
    $('#btn-regenerate').addEventListener('click', function () {
      if (state.generating) return;
      callGemini();
    });
    $('#btn-edit-inputs').addEventListener('click', function () {
      showView('idea');
    });
    $('#btn-startover').addEventListener('click', function () {
      state.charter = null;
      state.idea = '';
      $('#input-idea').value = '';
      $('#input-idea').dispatchEvent(new Event('input'));
      showView('idea');
      toast('Cleared. Describe a new project whenever you are ready.');
    });
  }

  function initBrand() {
    $('#brand-home').addEventListener('click', function (e) {
      e.preventDefault();
      if (state.charter) showView('review');
      else if (state.apiKey) showView('idea');
      else showView('key');
    });
  }

  function init() {
    initKeyStep();
    initIdeaStep();
    initReviewStep();
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
