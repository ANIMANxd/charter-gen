/* =====================================================================
   Charter Forge · Gemini client
   Calls the Gemini API directly from the browser with the user's key.
   Default model: gemini-3.5-flash (with graceful fallbacks).
   ===================================================================== */

(function (root) {
  'use strict';

  var API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';
  var PRIMARY_MODEL = 'gemini-3.5-flash';
  var FALLBACK_MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash'];
  var REQUEST_TIMEOUT_MS = 90000;

  /* ---------- structured output schema ---------- */

  var SCHEMA = {
    type: 'OBJECT',
    properties: {
      projectName: { type: 'STRING' },
      objective: { type: 'STRING' },
      successCriteria: { type: 'ARRAY', items: { type: 'STRING' } },
      keyDeliverables: { type: 'ARRAY', items: { type: 'STRING' } },
      milestones: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: { name: { type: 'STRING' }, deadline: { type: 'STRING' } },
          required: ['name', 'deadline']
        }
      },
      highLevelRequirements: { type: 'ARRAY', items: { type: 'STRING' } },
      budget: { type: 'STRING' },
      teamMembers: { type: 'ARRAY', items: { type: 'STRING' } },
      risks: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: { risk: { type: 'STRING' }, mitigation: { type: 'STRING' } },
          required: ['risk', 'mitigation']
        }
      },
      stakeholders: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: { name: { type: 'STRING' }, role: { type: 'STRING' } },
          required: ['name', 'role']
        }
      },
      projectManagers: { type: 'ARRAY', items: { type: 'STRING' } },
      approval: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          title: { type: 'STRING' },
          date: { type: 'STRING' }
        },
        required: ['title']
      }
    },
    required: [
      'projectName', 'objective', 'successCriteria', 'keyDeliverables',
      'milestones', 'highLevelRequirements', 'budget', 'teamMembers',
      'risks', 'stakeholders', 'projectManagers', 'approval'
    ]
  };

  /* ---------- prompt ---------- */

  function buildPrompt(idea, details) {
    var d = details || {};
    var lines = [];
    function add(label, value) {
      if (value !== undefined && value !== null && String(value).trim() !== '') {
        lines.push('- ' + label + ': ' + String(value).trim());
      }
    }
    add('Organization / team', d.org);
    add('Preferred project name', d.projectName);
    add('Planned start date (YYYY-MM-DD)', d.startDate);
    add('Target duration in weeks', d.durationWeeks);
    add('Budget guidance', d.budget);
    add('Team size (number of people)', d.teamSize);
    add('Sponsor / approver name', d.sponsorName);
    add('Sponsor title', d.sponsorTitle);
    add('Project manager', d.projectManager);
    add('Additional notes or constraints', d.notes);

    return [
      'You are a senior project management consultant and PMO specialist. Create a complete, professional Project Charter for the project described below.',

      '=== PROJECT IDEA ===',
      idea.trim(),

      '=== KNOWN DETAILS (supplied by the user) ===',
      lines.length ? lines.join('\n') : '- (none supplied - infer everything from the idea)',

      '=== RULES ===',
      '1. Use every supplied detail verbatim where applicable. Where a detail is missing, infer a sensible, realistic value from the idea itself. NEVER write "TBD", "N/A", "lorem" or any placeholder text.',
      '2. projectName: a crisp, memorable product-style name with its acronym if natural, e.g. "Universal Context Switch Engine (UCSE)". If a preferred name was supplied, use it.',
      '3. objective: 1-3 sentences describing what the project will deliver and why it matters.',
      '4. successCriteria: exactly 3 measurable criteria.',
      '5. keyDeliverables: exactly 3 concrete deliverables.',
      '6. milestones: 3 to 5 chronological milestones. Each deadline must be a real date in YYYY-MM-DD format, starting after the planned start date (or about 2 weeks from today if none) and spaced sensibly across the target duration.',
      '7. highLevelRequirements: 3 to 5 high-level requirements.',
      '8. budget: a currency figure followed by a short parenthetical breakdown, e.g. "$12,000 (API testing credits, development tooling, browser developer accounts)". If budget guidance was supplied, base the figure on it.',
      '9. teamMembers: 2 to 4 entries describing roles (not personal names unless names were supplied), e.g. "Full-Stack Browser Extension Engineer". Respect the supplied team size when counting.',
      '10. risks: 2 to 3 project risks; each mitigation must be a concrete action.',
      '11. stakeholders: exactly 3 entries with name and role.',
      '12. projectManagers: 1 or 2 entries. Use the supplied project manager text first.',
      '13. approval: the person who signs off. Use the supplied sponsor name and title when given; otherwise infer an appropriate approver title such as "Project Sponsor". approval.date is the sign-off date in YYYY-MM-DD (use today). approval.name may be empty string if unknown.',
      '14. Do NOT include numbering prefixes like "1." inside any string - the document adds numbering automatically.',
      '15. Be specific to the project domain: mention real technologies, audiences and outcomes found in the idea. Professional tone. Keep every string under 240 characters.',
      '',
      'Return ONLY the JSON object conforming to the provided schema.'
    ].join('\n');
  }

  /* ---------- helpers ---------- */

  function CharterError(kind, message) {
    var err = new Error(message);
    err.kind = kind;
    err.name = 'CharterError';
    return err;
  }

  function classifyHttpError(status, body) {
    var msg = (body && body.error && body.error.message) || ('HTTP ' + status);
    var lower = String(msg).toLowerCase();
    if (status === 400 && (lower.indexOf('api key') !== -1 || lower.indexOf('api_key') !== -1)) {
      return CharterError('auth', 'Your API key was rejected by Google. Double-check it at aistudio.google.com/apikey and try again.');
    }
    if (status === 403) {
      return CharterError('auth', 'Access denied for this API key (HTTP 403). Make sure the Generative Language API is enabled for the key.');
    }
    if (status === 404 || status === 401 || lower.indexOf('not found') !== -1 || lower.indexOf('not supported') !== -1) {
      return CharterError('model', msg);
    }
    if (status === 429) {
      return CharterError('quota', 'Rate limit or quota reached on this API key (HTTP 429). Wait a minute and try again, or use a different key.');
    }
    if (status >= 500) {
      return CharterError('server', 'Google\'s servers had a hiccup (HTTP ' + status + '). Please try again.');
    }
    return CharterError('http', msg);
  }

  function fetchWithTimeout(url, options) {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, REQUEST_TIMEOUT_MS);
    options.signal = controller.signal;
    return fetch(url, options).finally(function () { clearTimeout(timer); });
  }

  function callModel(model, apiKey, prompt) {
    var url = API_BASE + encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(apiKey);
    var payload = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.75,
        maxOutputTokens: 8192,
        responseMimeType: 'application/json',
        responseSchema: SCHEMA
      }
    };
    return fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (body) {
        if (!res.ok) throw classifyHttpError(res.status, body);
        return extractText(body);
      });
    });
  }

  function extractText(body) {
    if (!body) throw CharterError('parse', 'Empty response from the API.');
    if (body.promptFeedback && body.promptFeedback.blockReason) {
      throw CharterError('safety', 'Google blocked this request (' + body.promptFeedback.blockReason + '). Try rephrasing your idea.');
    }
    var cand = body.candidates && body.candidates[0];
    if (!cand) throw CharterError('parse', 'The API returned no candidates.');
    if (cand.finishReason === 'SAFETY' || cand.finishReason === 'PROHIBITED_CONTENT') {
      throw CharterError('safety', 'The response was blocked by safety filters. Try rephrasing your idea.');
    }
    var parts = (cand.content && cand.content.parts) || [];
    var text = parts.map(function (p) { return p.text || ''; }).join('');
    if (!text.trim()) throw CharterError('parse', 'The API returned an empty response.');
    return text;
  }

  function parseJsonLoose(text) {
    var cleaned = text.replace(/^\uFEFF/, '').trim();
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    try { return JSON.parse(cleaned); } catch (e) { /* fall through */ }
    var start = cleaned.indexOf('{');
    var end = cleaned.lastIndexOf('}');
    if (start !== -1 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    throw CharterError('parse', 'Could not parse the AI response as JSON.');
  }

  /* ---------- normalization ---------- */

  function str(v, fallback) {
    if (typeof v === 'string') return v.trim();
    if (v === null || v === undefined) return fallback || '';
    return String(v).trim();
  }

  function cleanItem(s) {
    return str(s).replace(/^\s*\d+\s*[.)]\s*/, '').replace(/\s+/g, ' ').trim();
  }

  function strList(arr, cap) {
    if (!Array.isArray(arr)) return [];
    return arr.map(cleanItem).filter(Boolean).slice(0, cap);
  }

  function isoDate(v) {
    var s = str(v);
    var m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) {
      var dt = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
      if (!isNaN(dt.getTime())) return s;
    }
    var parsed = new Date(s);
    if (!isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
    return '';
  }

  function normalize(raw) {
    var ms = Array.isArray(raw.milestones) ? raw.milestones : [];
    var risks = Array.isArray(raw.risks) ? raw.risks : [];
    var stk = Array.isArray(raw.stakeholders) ? raw.stakeholders : [];
    var ap = raw.approval || {};

    var charter = {
      projectName: cleanItem(raw.projectName) || 'Untitled Project',
      objective: str(raw.objective),
      successCriteria: strList(raw.successCriteria, 6),
      keyDeliverables: strList(raw.keyDeliverables, 6),
      milestones: ms.slice(0, 6).map(function (m) {
        m = m || {};
        return { name: cleanItem(m.name), deadline: isoDate(m.deadline) };
      }).filter(function (m) { return m.name; }),
      highLevelRequirements: strList(raw.highLevelRequirements, 6),
      budget: str(raw.budget),
      teamMembers: strList(raw.teamMembers, 6),
      risks: risks.slice(0, 5).map(function (r) {
        r = r || {};
        return { risk: cleanItem(r.risk), mitigation: cleanItem(r.mitigation) };
      }).filter(function (r) { return r.risk; }),
      stakeholders: stk.slice(0, 5).map(function (s) {
        s = s || {};
        return { name: cleanItem(s.name), role: cleanItem(s.role) };
      }).filter(function (s) { return s.name || s.role; }),
      projectManagers: strList(raw.projectManagers, 3),
      approval: {
        name: str(ap.name),
        title: str(ap.title) || 'Project Sponsor',
        date: isoDate(ap.date)
      }
    };

    if (!charter.objective) throw CharterError('parse', 'The AI response was missing the objective.');
    if (!charter.milestones.length) throw CharterError('parse', 'The AI response contained no usable milestones.');
    return charter;
  }

  /* ---------- public API ---------- */

  function generateCharter(opts) {
    var apiKey = opts.apiKey;
    var prompt = buildPrompt(opts.idea, opts.details);
    var models = [PRIMARY_MODEL].concat(FALLBACK_MODELS);
    var lastError = null;

    function attempt(i) {
      if (i >= models.length) throw lastError ||
        CharterError('model', 'None of the available Gemini models could be reached.');
      return callModel(models[i], apiKey, prompt).catch(function (err) {
        if (err && err.kind === 'model') {
          lastError = err;
          return attempt(i + 1);
        }
        throw err;
      });
    }

    return attempt(0)
      .then(parseJsonLoose)
      .then(normalize)
      .catch(function (err) {
        if (err instanceof TypeError && /fetch|network|failed/i.test(String(err.message))) {
          throw CharterError('network', 'Network error - could not reach Google\'s API. Check your internet connection.');
        }
        if (err && err.name === 'AbortError') {
          throw CharterError('network', 'The request timed out. Check your connection and try again.');
        }
        throw err;
      });
  }

  root.GeminiService = {
    generateCharter: generateCharter,
    PRIMARY_MODEL: PRIMARY_MODEL
  };

})(typeof window !== 'undefined' ? window : this);
