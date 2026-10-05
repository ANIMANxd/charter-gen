/* =====================================================================
   Charter Forge · Cost Management — Gemini AI layer
   Connects traditional EVM with modern AI-driven practice (assignment
   §4+§5, final bullets): sends the live EVM snapshot to Gemini and gets
   back predictive + risk insights in narrative form.
   Uses the SAME key as the charter app (localStorage 'cf_gemini_key').
   The local regression / anomaly tables remain as the offline baseline.
   ===================================================================== */

(function () {
  'use strict';

  var LS_KEY = 'cf_gemini_key';
  var API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';
  var PRIMARY_MODEL = 'gemini-3.5-flash-lite';
  var FALLBACK_MODELS = ['gemini-3.6-flash', 'gemini-3.7-flash'];
  var TIMEOUT_MS = 60000;

  function r2(v) {
    if (v === null || v === undefined || !isFinite(v)) return 'n/a';
    return String(Math.round(v * 100) / 100);
  }
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function getSavedKey() {
    try { return localStorage.getItem(LS_KEY) || ''; } catch (e) { return ''; }
  }

  /* Snapshot (from window.CostEVM.getSnapshot()) -> prompt text. Pure. */
  function buildInsightPrompt(snap) {
    var c = snap.computed, s = c.summary, f = c.forecast, ai = c.ai;
    var lines = c.rows.map(function (r, i) {
      var a = c.anomalies[i] || {};
      return '- ' + r.name + ': PV=' + r2(r.pv) + ' EV=' + r2(r.ev) + ' AC=' + r2(r.ac) +
        ' CV=' + r2(r.cv) + ' SV=' + r2(r.sv) + ' CPI=' + r2(r.cpi) + ' SPI=' + r2(r.spi) +
        ' EAC=' + r2(r.eac) + ' flag=' + (a.level || 'n/a');
    });
    return [
      'You are a senior project controls analyst. Below is Earned Value data for a software project ("' + snap.projectName + '", BAC=' + r2(snap.bac) + ', EAC method: ' + f.methodLabel + '). Sprint rows are cumulative to-date snapshots.',
      '',
      'SPRINTS:',
      lines.join('\n'),
      '',
      'CUMULATIVE: CV=' + r2(s.cv) + ' SV=' + r2(s.sv) + ' CPI=' + r2(s.cpi) + ' SPI=' + r2(s.spi),
      'CLASSICAL FORECAST: EAC=' + r2(f.eac) + ' ETC=' + r2(f.etc) + ' VAC=' + r2(f.vac) + ' TCPI(BAC)=' + r2(f.tcpiBac),
      'LOCAL REGRESSION BASELINE: next CPI~' + r2(ai.nextCpi) + ', next SPI~' + r2(ai.nextSpi) + '; AI-implied EAC~' + r2(ai.aiEac),
      '',
      'Write a concise markdown report with exactly these sections:',
      '1. **Predictive outlook** — your own next-3-sprint CPI/SPI expectation and whether you agree with the classical EAC or the regression baseline, and why.',
      '2. **Risk flags** — which sprints look anomalous (cost/schedule variance) and the most plausible cause for each.',
      '3. **Recommended actions** — 3 to 5 concrete control actions (re-estimate, de-scope, staffing, reserves).',
      '4. **Traditional + AI** — one short paragraph on how this AI review complements (not replaces) classical EVM.',
      'Keep it under 350 words. No tables.'
    ].join('\n');
  }

  function fetchTimeout(url, options) {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, TIMEOUT_MS);
    options.signal = controller.signal;
    return fetch(url, options).finally(function () { clearTimeout(timer); });
  }

  function callModel(model, apiKey, prompt, schema, system, temperature) {
    var url = API_BASE + encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(apiKey);
    var payload = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: temperature !== undefined ? temperature : 0.4, maxOutputTokens: 2048 }
    };
    if (schema) {
      payload.generationConfig.responseMimeType = 'application/json';
      payload.generationConfig.responseSchema = schema;
    }
    if (system) payload.systemInstruction = { parts: [{ text: system }] };
    return fetchTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (body) {
        if (!res.ok) {
          var msg = (body && body.error && body.error.message) || ('HTTP ' + res.status);
          if (res.status === 400 || res.status === 403) throw new Error('Key rejected by Google (' + msg + '). Check it at aistudio.google.com/apikey.');
          if (res.status === 404) throw new Error('MODEL_NOT_FOUND');
          if (res.status === 429) throw new Error('Quota/rate limit reached (429). Wait a minute and retry.');
          throw new Error(msg);
        }
        var parts = (((body.candidates || [])[0] || {}).content || {}).parts || [];
        var text = parts.map(function (p) { return p.text || ''; }).join('').trim();
        if (!text) throw new Error('Empty response from the model.');
        return text;
      });
    });
  }

  /* ---------- sprint dataset generation: brief in, PV/EV/AC out ---------- */

  var SPRINT_SCHEMA = {
    type: 'OBJECT',
    properties: {
      sprints: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            name: { type: 'STRING' },
            pv: { type: 'NUMBER' },
            ev: { type: 'NUMBER' },
            ac: { type: 'NUMBER' }
          },
          required: ['name', 'pv', 'ev', 'ac']
        }
      }
    },
    required: ['sprints']
  };

  var SPRINT_SYSTEM = [
    'You are a project-controls data generator. Output ONE JSON object conforming exactly to the schema. No prose.',
    'Rows are cumulative to-date EVM snapshots per sprint: PV is non-decreasing and lands near BAC in the final sprint.',
    'EV and AC follow the requested project shape. All values are non-negative, rounded to whole numbers.',
    'Names are "Sprint 1", "Sprint 2", and so on. Never use TBD or placeholder text.'
  ].join('\n');

  var SCENARIOS = {
    mixed: 'Realistic mixed performance: CPI and SPI cross 1.0 at least once across the sprints.',
    healthy: 'Steady healthy project: CPI and SPI at or above 1.0 in most sprints.',
    struggling: 'Struggling project: CPI and SPI below 1.0 and generally worsening.',
    recovery: 'Recovery story: over budget and behind early, improving past CPI/SPI 1.0 by the final sprints.'
  };

  function buildSprintPrompt(brief, n, bac, scenario) {
    return [
      'Project brief: ' + (brief || '(none — invent a small software project)'),
      'Sprints to generate: ' + n,
      'Budget at Completion (BAC): ' + bac + ' (same currency units throughout)',
      'Project shape: ' + (SCENARIOS[scenario] || SCENARIOS.mixed),
      'Return ONLY the JSON object.'
    ].join('\n');
  }

  function parseJsonLoose(text) {
    var s = String(text || '').replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    try { return JSON.parse(s); } catch (e) {}
    var a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a !== -1 && b > a) {
      try { return JSON.parse(s.slice(a, b + 1)); } catch (e2) {}
    }
    throw new Error('The model returned malformed JSON — please retry.');
  }

  /* Pure: model output -> clean sprint rows. Clamps, rounds, fills names. */
  function normalizeSprints(raw, n) {
    var arr = (raw && raw.sprints) || (Array.isArray(raw) ? raw : []);
    function cleanNum(v) {
      var x = parseFloat(v);
      if (!isFinite(x) || x < 0) return 0;
      return Math.round(x * 10) / 10;
    }
    var rows = arr.slice(0, Math.max(1, Math.min(12, n || 6))).map(function (r, i) {
      r = r || {};
      var name = String(r.name || '').trim() || ('Sprint ' + (i + 1));
      return { name: name, pv: cleanNum(r.pv), ev: cleanNum(r.ev), ac: cleanNum(r.ac) };
    });
    if (!rows.length) throw new Error('The model returned no sprint rows — please retry.');
    return rows;
  }

  function generateSprints(apiKey, opts) {
    var n = Math.max(3, Math.min(12, parseInt(opts.count, 10) || 6));
    var bac = parseFloat(opts.bac) > 0 ? parseFloat(opts.bac) : 600;
    var prompt = buildSprintPrompt(opts.brief, n, bac, opts.scenario);
    var models = [PRIMARY_MODEL].concat(FALLBACK_MODELS);
    function attempt(i) {
      if (i >= models.length) throw new Error('No reachable Gemini model.');
      return callModel(models[i], apiKey, prompt, SPRINT_SCHEMA, SPRINT_SYSTEM, 0.5).then(function (text) {
        return { rows: normalizeSprints(parseJsonLoose(text), n), bac: bac };
      }).catch(function (err) {
        if (err && err.message === 'MODEL_NOT_FOUND') return attempt(i + 1);
        throw err;
      });
    }
    return attempt(0);
  }

  function generateInsights(apiKey, snapshot) {
    var prompt = buildInsightPrompt(snapshot);
    var models = [PRIMARY_MODEL].concat(FALLBACK_MODELS);
    function attempt(i) {
      if (i >= models.length) throw new Error('No reachable Gemini model.');
      return callModel(models[i], apiKey, prompt).catch(function (err) {
        if (err && err.message === 'MODEL_NOT_FOUND') return attempt(i + 1);
        throw err;
      });
    }
    return attempt(0);
  }

  /* Tiny markdown -> HTML (headers, bold, bullets, ordered lists). */
  function md(html) {
    var out = [];
    var inList = false;
    esc(html).split('\n').forEach(function (line) {
      var t = line.trim();
      var m4 = t.match(/^####\s+(.*)/), m3 = t.match(/^###\s+(.*)/), m2 = t.match(/^##\s+(.*)/);
      var head = m4 || m3 || m2;
      if (head) {
        if (inList) { out.push('</ul>'); inList = false; }
        out.push('<h4>' + inline(head[1]) + '</h4>');
        return;
      }
      var b = t.match(/^[-*]\s+(.*)/);
      var o = t.match(/^\d+[.)]\s+(.*)/);
      if (b || o) {
        if (!inList) { out.push('<ul>'); inList = true; }
        out.push('<li>' + inline((b || o)[1]) + '</li>');
        return;
      }
      if (inList) { out.push('</ul>'); inList = false; }
      if (t) out.push('<p>' + inline(t) + '</p>');
    });
    if (inList) out.push('</ul>');
    return out.join('');
    function inline(s) {
      return s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    }
  }

  /* ---------------- page wiring (guarded: no-ops outside cost.html) ---------------- */

  function toast(msg, kind) {
    var box = document.querySelector('#toasts');
    if (!box) { alert(msg); return; }
    var el = document.createElement('div');
    el.className = 'toast' + (kind ? ' ' + kind : '');
    el.textContent = msg;
    box.appendChild(el);
    setTimeout(function () { el.classList.add('leaving'); setTimeout(function () { el.remove(); }, 300); }, 5000);
  }

  function init() {
    var genBtn = document.querySelector('#ai-gen');
    if (!genBtn || !window.CostEVM) return; // not on cost page
    var keyInput = document.querySelector('#ai-key');
    var status = document.querySelector('#ai-key-status');
    var out = document.querySelector('#ai-out');

    function refreshStatus() {
      var k = (keyInput.value || '').trim() || getSavedKey();
      status.textContent = k
        ? 'Using saved Gemini key (same as Charter Forge — never leaves your browser except to Google\u2019s API).'
        : 'No key found. Paste the same Gemini key you use in Charter Forge — it is stored under the same browser entry.';
      genBtn.disabled = !k;
    }

    var saved = getSavedKey();
    if (saved && keyInput) keyInput.value = saved;
    if (keyInput) keyInput.addEventListener('input', refreshStatus);

    var saveBtn = document.querySelector('#ai-save-key');
    if (saveBtn) saveBtn.addEventListener('click', function () {
      var k = (keyInput.value || '').trim();
      if (k.length < 20) { toast('That does not look like a valid Gemini key (should start with "AIza").', 'error'); return; }
      try { localStorage.setItem(LS_KEY, k); } catch (e) {}
      refreshStatus();
      toast('Key saved — shared with the Charter Forge app.', 'success');
    });

    genBtn.addEventListener('click', function () {
      var k = (keyInput.value || '').trim() || getSavedKey();
      if (!k) { toast('Add your Gemini API key first.', 'error'); return; }
      genBtn.disabled = true;
      out.innerHTML = '<p class="help">Consulting Gemini on your live EVM snapshot…</p>';
      generateInsights(k, window.CostEVM.getSnapshot()).then(function (text) {
        out.innerHTML = md(text);
        toast('AI insight report ready.', 'success');
      }).catch(function (err) {
        out.innerHTML = '<p class="help">Could not reach Gemini: ' + esc((err && err.message) || 'unknown error') + ' Your offline regression (§4) and anomaly flags (§5) above remain valid.</p>';
        toast((err && err.message) || 'AI insight failed.', 'error');
      }).finally(function () { refreshStatus(); });
    });

    refreshStatus();
    initSprintGen();
  }

  /* Brief -> sprint table, mirroring the Charter/Schedule flow. */
  function initSprintGen() {
    var btn = document.querySelector('#g-gen');
    if (!btn || !window.CostEVM || !window.CostEVM.setSprints) return;
    var briefEl = document.querySelector('#g-brief');
    var countEl = document.querySelector('#g-count');
    var bacEl = document.querySelector('#g-bac');
    var scEl = document.querySelector('#g-scenario');
    var status = document.querySelector('#g-status');
    try {
      var snap = window.CostEVM.getSnapshot();
      if (bacEl && !bacEl.value) bacEl.value = snap.bac;
    } catch (e) {}
    btn.addEventListener('click', function () {
      var keyInput = document.querySelector('#ai-key');
      var k = (keyInput && keyInput.value || '').trim() || getSavedKey();
      if (!k) { toast('Add your Gemini API key first (AI panel below).', 'error'); return; }
      var brief = (briefEl.value || '').trim();
      if (brief.length < 10) { toast('Describe the project in a sentence or two first.', 'error'); briefEl.focus(); return; }
      btn.disabled = true;
      status.textContent = 'Asking Gemini to draft the sprint history…';
      generateSprints(k, { brief: brief, count: countEl.value, bac: bacEl.value, scenario: scEl.value }).then(function (res) {
        window.CostEVM.setSprints(res.rows, res.bac);
        if (bacEl) bacEl.value = res.bac;
        status.textContent = 'Drafted ' + res.rows.length + ' sprints — review and edit any value in the table above.';
        toast('Sprint dataset generated (' + res.rows.length + ' sprints).', 'success');
      }).catch(function (err) {
        status.textContent = 'Generation failed: ' + ((err && err.message) || 'unknown error');
        toast((err && err.message) || 'Sprint generation failed.', 'error');
      }).finally(function () { btn.disabled = false; });
    });
  }

  if (typeof window !== 'undefined') {
    window.CostAI = { buildInsightPrompt: buildInsightPrompt, generateInsights: generateInsights, getSavedKey: getSavedKey, buildSprintPrompt: buildSprintPrompt, normalizeSprints: normalizeSprints, generateSprints: generateSprints };
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  }
})();
