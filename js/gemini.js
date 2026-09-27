/* =====================================================================
   Charter Forge · Gemini client
   Calls the Gemini API directly from the browser with the user's key.
   Default model: gemini-3.5-flash (with graceful fallbacks).
   ===================================================================== */

(function (root) {
  'use strict';

  var API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';
  var PRIMARY_MODEL = 'gemini-3.5-flash-lite';
  var FALLBACK_MODELS = ['gemini-3.6-flash', 'gemini-3.7-flash'];
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

  function callModel(model, apiKey, prompt, schema, system, temperature) {
    var url = API_BASE + encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(apiKey);
    var payload = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: temperature !== undefined ? temperature : 0.75,
        maxOutputTokens: 8192,
        responseMimeType: 'application/json',
        responseSchema: schema || SCHEMA
      }
    };
    if (system) {
      payload.systemInstruction = { parts: [{ text: system }] };
    }
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
    var cleaned = String(text || '').replace(/^\uFEFF/, '').trim();
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    // Fast path
    try { return JSON.parse(cleaned); } catch (e) { /* continue to repair */ }
    // Common repair: trailing commas, control chars, outer wrapper extraction
    function tryParse(s) {
      try { return { ok: true, value: JSON.parse(s) }; } catch (err) { return { ok: false, err: err }; }
    }
    // 1) Remove trailing commas before } or ]
    var noTrailing = cleaned.replace(/,\s*([}\]])/g, '$1');
    var r = tryParse(noTrailing);
    if (r.ok) return r.value;
    // 2) Strip JS-style // and /* */ comments if model leaked them
    var noComments = noTrailing.replace(/\/\/[^\n]*\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '');
    r = tryParse(noComments);
    if (r.ok) return r.value;
    // 3) Extract outermost { ... } and retry repairs on that slice
    var start = cleaned.indexOf('{');
    var end = cleaned.lastIndexOf('}');
    if (start !== -1 && end > start) {
      var slice = cleaned.slice(start, end + 1).replace(/,\s*([}\]])/g, '$1');
      r = tryParse(slice);
      if (r.ok) return r.value;
      slice = slice.replace(/\/\/[^\n]*\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '');
      r = tryParse(slice);
      if (r.ok) return r.value;
      // 4) Try to fix truncated JSON: if slice ends mid-array/string, attempt to close it
      // For position 1348 style errors (malformed array element), show diagnostic snippet
      var lastErr = r.err && r.err.message || '';
      var m = lastErr.match(/position\s+(\d+)/);
      if (m) {
        var pos = +m[1];
        console.error('[Charter Forge] JSON parse error at position ' + pos + ':', lastErr);
        console.error('[Charter Forge] snippet:', JSON.stringify(slice.slice(Math.max(0, pos-200), pos+200)));
      }
    }
    // 5) Last resort: attempt single-quote to double-quote if model used them (rare)
    var singleFixed = cleaned.replace(/'/g, '"').replace(/,\s*([}\]])/g, '$1');
    r = tryParse(singleFixed);
    if (r.ok) return r.value;
    throw CharterError('parse', 'Could not parse the AI response as JSON. The model returned malformed JSON — please click Redraft to retry. (Error at ~col ' + (r.err && r.err.message || 'unknown') + ')');
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

  /* ---------- schedule schema ---------- */

  var SCHEDULE_SCHEMA = {
    type: 'OBJECT',
    properties: {
      projectName: { type: 'STRING' },
      methodology: { type: 'STRING', description: 'Waterfall | Agile | Hybrid' },
      plannedStart: { type: 'STRING', description: 'YYYY-MM-DD' },
      plannedEnd: { type: 'STRING', description: 'YYYY-MM-DD' },
      planScheduleManagement: {
        type: 'OBJECT',
        properties: {
          policy: { type: 'STRING' },
          tools: { type: 'ARRAY', items: { type: 'STRING' } },
          roles: { type: 'STRING' }
        },
        required: ['policy', 'tools', 'roles']
      },
      activities: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            id: { type: 'STRING' },
            wbsId: { type: 'STRING' },
            name: { type: 'STRING' },
            description: { type: 'STRING' },
            isMilestone: { type: 'BOOLEAN' },
            estimationMethod: { type: 'STRING' },
            optimistic: { type: 'NUMBER' },
            mostLikely: { type: 'NUMBER' },
            pessimistic: { type: 'NUMBER' },
            expectedDuration: { type: 'NUMBER' },
            durationDays: { type: 'NUMBER' },
            earliestStartDay: { type: 'NUMBER', description: 'Earliest allowed start offset in working days from project start (resource availability gate); 0 if none' },
            storyPoints: { type: 'NUMBER' },
            tShirtSize: { type: 'STRING' },
            resources: { type: 'ARRAY', items: { type: 'STRING' } },
            constraint: { type: 'STRING' }
          },
          required: ['id', 'wbsId', 'name', 'description', 'isMilestone', 'durationDays']
        }
      },
      dependencies: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            from: { type: 'STRING' },
            to: { type: 'STRING' },
            type: { type: 'STRING', description: 'FS | SS | FF | SF' },
            lagDays: { type: 'NUMBER' },
            leadDays: { type: 'NUMBER' }
          },
          required: ['from', 'to', 'type']
        }
      },
      criticalPath: { type: 'ARRAY', items: { type: 'STRING' } },
      projectDurationDays: { type: 'NUMBER' },
      resourcePlan: {
        type: 'OBJECT',
        properties: {
          levelingNotes: { type: 'STRING' },
          smoothingNotes: { type: 'STRING' }
        },
        required: ['levelingNotes', 'smoothingNotes']
      },
      compression: {
        type: 'OBJECT',
        properties: {
          crashOptions: { type: 'ARRAY', items: { type: 'STRING' } },
          fastTrackOptions: { type: 'ARRAY', items: { type: 'STRING' } }
        },
        required: ['crashOptions', 'fastTrackOptions']
      },
      controlPlan: {
        type: 'OBJECT',
        properties: {
          baselineDate: { type: 'STRING' },
          varianceThreshold: { type: 'STRING' },
          velocityTarget: { type: 'STRING' },
          retrospectiveCadence: { type: 'STRING' },
          changeControlProcess: { type: 'STRING' }
        },
        required: ['baselineDate', 'varianceThreshold', 'changeControlProcess']
      },
      agileRelease: {
        type: 'OBJECT',
        properties: {
          sprints: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                sprint: { type: 'STRING' },
                goal: { type: 'STRING' },
                activityIds: { type: 'ARRAY', items: { type: 'STRING' } },
                velocityPoints: { type: 'NUMBER' }
              },
              required: ['sprint', 'goal']
            }
          }
        }
      }
    },
    required: ['projectName', 'methodology', 'plannedStart', 'plannedEnd', 'planScheduleManagement', 'activities', 'dependencies', 'criticalPath', 'projectDurationDays', 'resourcePlan', 'compression', 'controlPlan']
  };

  /* ---------- schedule system prompt (the hard contract) ---------- */

  var SCHEDULE_SYSTEM = [
    'You are a senior PMP-certified project scheduler. You produce ONE JSON object that conforms exactly to the provided schema. You never output prose, markdown or comments.',
    '',
    'NON-NEGOTIABLE CONSTRAINTS (an output violating any of these is invalid):',
    '1. DURATION IS A HARD REQUIREMENT. The request states TARGET WORKING DAYS. The critical path of your schedule (longest chain of dependent activities) must total exactly that many working days. Never plan a shorter or longer project. You decide how to distribute those days across activities — keep the proportions realistic for the work described.',
    '2. START DATE IS FIXED. plannedStart must be exactly the START DATE given in the request, in YYYY-MM-DD. plannedEnd is the calendar date on which the critical path finishes when counting only the given working days per week (skip non-working days).',
    '3. RESOURCE AVAILABILITY IS A HARD REQUIREMENT. If a resource is unavailable until day N, no activity assigned to that resource may start before day N. Encode this with dependencies/lag so the schedule respects it, and repeat it in that activity\'s constraint field.',
    '4. CHARTER FIDELITY. The charter in the request is the single source of truth. Every key deliverable and milestone from the charter must appear in your activities or milestone activities. Use charter team roles as activity resources. Use charter milestone intent when placing milestone activities. Do not invent scope that is absent from the charter, and do not drop charter scope.',
    '5. STRUCTURE. 8-16 activities; every activity except the first must have at least one predecessor; the dependency network must be acyclic and connected. Milestone activities have durationDays = 0 and isMilestone = true; there are 2-4 of them. Use all four relationship types (FS, SS, FF, SF) where they genuinely fit, plus a few realistic leads/lags.',
    '6. ESTIMATES. optimistic <= mostLikely <= pessimistic (all in working days, 0.5 steps allowed), and expectedDuration = (optimistic + 4*mostLikely + pessimistic) / 6 rounded to 1 decimal. durationDays equals expectedDuration for non-milestones. For Agile activities also give storyPoints (1-13) and tShirtSize (XS/S/M/L).',
    '7. HONESTY. Never use TBD, N/A, placeholder or filler text. Every string must be concrete and specific to this project. If a requested field does not apply, give it an empty string or empty array — never a fake value.',
    '',
    'NOTE ON ROUNDING: your per-activity durations are relative effort estimates; the system rescales them proportionally so the critical path lands exactly on TARGET WORKING DAYS. Preserve meaningful proportions and re-check your expectedDuration fields against your durations before answering.'
  ].join('\n');

  function buildSchedulePrompt(charter, idea, details, schedInputs) {
    var s = schedInputs || {};
    var d = details || {};

    function add(lines, label, value) {
      if (value !== undefined && value !== null && String(value).trim() !== '') {
        lines.push(label + ': ' + String(value).trim());
      }
    }

    var constraints = [];
    add(constraints, 'TARGET WORKING DAYS (critical path must equal this)', s.targetDays);
    add(constraints, 'START DATE (plannedStart, YYYY-MM-DD)', s.startDate);
    add(constraints, 'WORKING DAYS PER WEEK', s.workingDays);
    add(constraints, 'HOURS PER DAY', s.hoursPerDay);
    add(constraints, 'METHODOLOGY', s.methodology);
    add(constraints, 'ESTIMATION APPROACH', s.estimationApproach);
    add(constraints, 'SPRINT LENGTH', s.sprintLength);
    add(constraints, 'COMPRESSION ALLOWED', s.compressionPref);
    if (Array.isArray(s.resourceAvailability) && s.resourceAvailability.length) {
      constraints.push('RESOURCE AVAILABILITY (hard gates, working days from start): ' +
        s.resourceAvailability.map(function (g) { return g.name + ' from day ' + g.days; }).join(' | '));
    }
    if (s.resourceAvailabilityText) {
      constraints.push('RESOURCE AVAILABILITY (user\'s own words — obey exactly): "' + s.resourceAvailabilityText + '"');
    }
    add(constraints, 'TEAM / RESOURCES', s.resources);
    add(constraints, 'OTHER CONSTRAINTS', s.constraints);
    add(constraints, 'ADDITIONAL NOTES', s.notes);

    var brief = [];
    add(brief, 'Organization', d.org);
    add(brief, 'Planned start date', d.startDate);
    add(brief, 'Target duration (weeks)', d.durationWeeks);
    add(brief, 'Budget', d.budget);
    add(brief, 'Team size', d.teamSize);
    add(brief, 'Project manager', d.projectManager);
    add(brief, 'Notes / constraints', d.notes);

    var charterSummary = '(no charter — infer everything from the brief)';
    if (charter) {
      try {
        charterSummary = JSON.stringify({
          projectName: charter.projectName,
          objective: charter.objective,
          successCriteria: charter.successCriteria,
          keyDeliverables: charter.keyDeliverables,
          milestones: charter.milestones,
          highLevelRequirements: charter.highLevelRequirements,
          budget: charter.budget,
          teamMembers: charter.teamMembers,
          risks: charter.risks,
          projectManagers: charter.projectManagers,
          stakeholders: charter.stakeholders
        }, null, 2);
      } catch (e) { charterSummary = '(unavailable)'; }
    }

    return [
      '=== A. APPROVED CHARTER (authoritative) ===',
      charterSummary,
      '',
      '=== B. ORIGINAL BRIEF ===',
      (idea || '').trim() || '(none)',
      brief.length ? '\nBrief details:\n' + brief.join('\n') : '',
      '',
      '=== C. SCHEDULING CONSTRAINTS (hard requirements from the user) ===',
      constraints.length ? constraints.join('\n') : '- (none supplied — propose sensible values and state them in the JSON)',
      '',
      '=== D. YOUR TASK ===',
      'Produce the complete project schedule as JSON: planScheduleManagement, activities (with WBS, PERT/Agile estimates, resources, constraints), dependencies (PDM), resourcePlan, compression options, controlPlan, and — for Agile/Hybrid — agileRelease. Follow the system constraints exactly, especially the TARGET WORKING DAYS and RESOURCE AVAILABILITY requirements.',
      '',
      'Return ONLY the JSON object.'
    ].join('\n');
  }

  function normalizeSchedule(raw, charterFallback) {
    function s(v, fb) { if (typeof v === 'string') return v.trim(); if (v === null || v === undefined) return fb || ''; return String(v).trim(); }
    function clean(v) { return s(v).replace(/^\s*\d+\s*[.)]\s*/, '').replace(/\s+/g, ' ').trim(); }
    function iso(v) {
      var str = s(v);
      var m = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (m) { var dt = new Date(Date.UTC(+m[1], +m[2]-1, +m[3])); if (!isNaN(dt.getTime())) return str; }
      var p = new Date(str); if (!isNaN(p.getTime())) return p.toISOString().slice(0,10);
      return '';
    }
    // Defensive: if model returned empty/wrapped object, try to recover
    if (!raw || typeof raw !== 'object') raw = {};
    var acts = Array.isArray(raw.activities) ? raw.activities : [];
    // Fallback synthesize minimal activities from charter if model returned none
    if (!acts.length && charterFallback && Array.isArray(charterFallback.keyDeliverables) && charterFallback.keyDeliverables.length) {
      console.warn('[Charter Forge] schedule returned no activities — synthesizing from charter deliverables');
      acts = charterFallback.keyDeliverables.slice(0,6).map(function(name, idx){
        return { id: 'A' + ('0'+(idx+1)).slice(-2), wbsId: '1.'+(idx+1), name: clean(name).slice(0,60), description: clean(name), isMilestone: false, estimationMethod: 'PERT', optimistic: 3, mostLikely: 5, pessimistic: 8, expectedDuration: 5.2, durationDays: 5, resources: (charterFallback.teamMembers||[]).slice(0,1), constraint: '' };
      });
      // add milestones from charter milestones
      (charterFallback.milestones||[]).slice(0,2).forEach(function(m, mi){
        acts.push({ id: 'A' + ('0'+(acts.length+1)).slice(-2), wbsId: '2.'+(mi+1), name: clean(m.name).slice(0,60), description: 'Milestone: ' + clean(m.name), isMilestone: true, estimationMethod: 'PERT', optimistic: 0, mostLikely: 0, pessimistic: 0, expectedDuration: 0, durationDays: 0, resources: [], constraint: '' });
      });
    }
    var deps = Array.isArray(raw.dependencies) ? raw.dependencies : [];
    // If still no deps but we synthesized activities, create a simple FS chain
    if (!deps.length && acts.length > 1) {
      deps = [];
      for (var di=0; di<acts.length-1; di++) deps.push({ from: acts[di].id, to: acts[di+1].id, type: 'FS', lagDays: 0, leadDays: 0 });
      // add one SS and one lag example if enough nodes
      if (acts.length >= 4) { deps[1].type = 'SS'; deps[2].lagDays = 1; }
    }
    var pM = raw.planScheduleManagement || {};
    var rP = raw.resourcePlan || {};
    var comp = raw.compression || {};
    var ctrl = raw.controlPlan || {};

    var schedule = {
      projectName: clean(raw.projectName) || 'Untitled Project',
      methodology: (function(m){ m=s(m); if(/agile/i.test(m)) return 'Agile'; if(/hybrid/i.test(m)) return 'Hybrid'; return 'Waterfall'; })(raw.methodology),
      plannedStart: iso(raw.plannedStart) || new Date().toISOString().slice(0,10),
      plannedEnd: iso(raw.plannedEnd) || '',
      planScheduleManagement: {
        policy: clean(pM.policy) || 'Schedule managed per PMBOK 6 processes with weekly baseline reviews.',
        tools: Array.isArray(pM.tools) ? pM.tools.map(clean).filter(Boolean).slice(0,4) : ['MS Project','Jira'],
        roles: clean(pM.roles) || 'Project Manager owns the baseline; team leads update progress.'
      },
      activities: acts.slice(0,16).map(function(a, idx){
        a=a||{};
        var id = s(a.id).toUpperCase().replace(/[^A-Z0-9]/g,'') || ('A' + ('0'+(idx+1)).slice(-2));
        if (!/^A\d+$/i.test(id)) id = 'A' + ('0'+(idx+1)).slice(-2);
        var o = typeof a.optimistic === 'number' ? a.optimistic : (typeof a.durationDays === 'number' ? Math.max(1, a.durationDays-1) : 3);
        var ml = typeof a.mostLikely === 'number' ? a.mostLikely : (typeof a.durationDays === 'number' ? a.durationDays : 5);
        var p = typeof a.pessimistic === 'number' ? a.pessimistic : (typeof a.durationDays === 'number' ? a.durationDays+3 : 8);
        var exp = typeof a.expectedDuration === 'number' ? a.expectedDuration : Math.round(((o+4*ml+p)/6)*10)/10;
        var dur = typeof a.durationDays === 'number' ? a.durationDays : exp;
        if (a.isMilestone) dur = 0;
        return {
          id: id,
          wbsId: s(a.wbsId) || ('1.'+(idx+1)),
          name: clean(a.name) || ('Activity '+(idx+1)),
          description: clean(a.description),
          isMilestone: !!a.isMilestone,
          estimationMethod: clean(a.estimationMethod) || 'PERT',
          optimistic: o,
          mostLikely: ml,
          pessimistic: p,
          expectedDuration: exp,
          durationDays: dur,
          earliestStart: typeof a.earliestStartDay === 'number' && a.earliestStartDay > 0 ? a.earliestStartDay : (a.isMilestone ? 0 : undefined),
          storyPoints: typeof a.storyPoints === 'number' ? a.storyPoints : undefined,
          tShirtSize: s(a.tShirtSize) || undefined,
          resources: Array.isArray(a.resources) ? a.resources.map(clean).filter(Boolean).slice(0,3) : [],
          constraint: clean(a.constraint)
        };
      }),
      dependencies: deps.slice(0,20).map(function(d){
        d=d||{};
        var t = s(d.type).toUpperCase();
        if (['FS','SS','FF','SF'].indexOf(t)===-1) t='FS';
        return { from: s(d.from).toUpperCase(), to: s(d.to).toUpperCase(), type: t, lagDays: typeof d.lagDays==='number'?d.lagDays:0, leadDays: typeof d.leadDays==='number'?d.leadDays:0 };
      }).filter(function(d){ return d.from && d.to && d.from!==d.to; }),
      resourcePlan: {
        levelingNotes: clean(rP.levelingNotes) || 'Resource leveling may shift dates and change the critical path if constraints apply.',
        smoothingNotes: clean(rP.smoothingNotes) || 'Resource smoothing uses float; critical path unchanged, completion date not delayed.'
      },
      compression: {
        crashOptions: Array.isArray(comp.crashOptions) ? comp.crashOptions.map(clean).filter(Boolean) : [],
        fastTrackOptions: Array.isArray(comp.fastTrackOptions) ? comp.fastTrackOptions.map(clean).filter(Boolean) : []
      },
      controlPlan: {
        baselineDate: iso(ctrl.baselineDate) || iso(raw.plannedStart) || new Date().toISOString().slice(0,10),
        varianceThreshold: clean(ctrl.varianceThreshold) || '±10% schedule variance',
        velocityTarget: clean(ctrl.velocityTarget),
        retrospectiveCadence: clean(ctrl.retrospectiveCadence) || 'Bi-weekly retrospectives',
        changeControlProcess: clean(ctrl.changeControlProcess) || 'Changes via CCB review against baseline.'
      },
      criticalPath: Array.isArray(raw.criticalPath) ? raw.criticalPath.map(function(x){ return s(x).toUpperCase(); }).filter(Boolean) : [],
      projectDurationDays: typeof raw.projectDurationDays === 'number' ? raw.projectDurationDays : 0
    };
    if (raw.agileRelease && Array.isArray(raw.agileRelease.sprints)) {
      schedule.agileRelease = { sprints: raw.agileRelease.sprints.slice(0,6).map(function(sp){
        return { sprint: clean(sp.sprint), goal: clean(sp.goal), activityIds: Array.isArray(sp.activityIds)? sp.activityIds.map(function(x){return s(x).toUpperCase();}) : [], velocityPoints: typeof sp.velocityPoints==='number'?sp.velocityPoints:undefined };
      })};
    }
    if (!schedule.plannedEnd) {
      var st = new Date(schedule.plannedStart);
      var dur = schedule.projectDurationDays || schedule.activities.reduce(function(a,c){ return a + (c.durationDays||0); },0);
      if (!isNaN(st.getTime())) { var e = new Date(st); e.setDate(e.getDate()+Math.ceil(dur*1.2)); schedule.plannedEnd = e.toISOString().slice(0,10); }
    }
    if (!schedule.activities.length) throw CharterError('parse','The AI returned no activities.');
    return schedule;
  }

  function generateSchedule(opts) {
    var prompt = buildSchedulePrompt(opts.charter, opts.idea, opts.details, opts.schedInputs);
    var models = [PRIMARY_MODEL].concat(FALLBACK_MODELS);
    var lastError = null;
    function attempt(i) {
      if (i >= models.length) throw lastError || CharterError('model','None of the available Gemini models could be reached.');
      // Low temperature: schedule data must be deterministic and constraint-faithful.
      return callModel(models[i], opts.apiKey, prompt, SCHEDULE_SCHEMA, SCHEDULE_SYSTEM, 0.2).catch(function(err){
        if (err && err.kind==='model'){ lastError=err; return attempt(i+1); }
        throw err;
      });
    }
    return attempt(0).then(parseJsonLoose).then(function(raw){
      // Some models return markdown-wrapped or nested { schedule: {...} } — unwrap if needed
      if (raw && !raw.activities && raw.schedule && raw.schedule.activities) raw = raw.schedule;
      return normalizeSchedule(raw, opts.charter);
    }).catch(function(err){
      if (err instanceof TypeError && /fetch|network|failed/i.test(String(err.message))) throw CharterError('network','Network error - could not reach Google\'s API. Check your internet connection.');
      if (err && err.name==='AbortError') throw CharterError('network','The request timed out. Check your connection and try again.');
      // Surface raw JSON for debugging when parse fails but still show friendly message
      if (err && err.kind === 'parse') {
        console.error('[Charter Forge] schedule parse error:', err.message, err);
      }
      throw err;
    });
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
    generateSchedule: generateSchedule,
    PRIMARY_MODEL: PRIMARY_MODEL
  };

})(typeof window !== 'undefined' ? window : this);
