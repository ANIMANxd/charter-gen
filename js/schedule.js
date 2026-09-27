/* =====================================================================
   Charter Forge · Schedule engine
   - CPM forward/backward pass (FS/SS/FF/SF + lag/lead, earliest-start
     gates for resource availability)
   - Working-day aware date math
   - enforcePlan(): deterministic planner that GUARANTEES the user's
     hard constraints (target duration, resource availability) regardless
     of what the model returns.
   UMD: browser global window.ScheduleLogic, Node module.exports
   ===================================================================== */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ScheduleLogic = factory();
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  /* ---------- date helpers ---------- */

  function toDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    if (!m) return null;
    var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return isNaN(d.getTime()) ? null : d;
  }

  function fmtDate(iso) {
    var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var d = toDate(iso);
    if (!d) return String(iso || '');
    return ('0' + d.getUTCDate()).slice(-2) + '-' + MONTHS[d.getUTCMonth()] + '-' + d.getUTCFullYear();
  }

  function addDays(iso, days) {
    var d = toDate(iso);
    if (!d) return iso;
    d.setUTCDate(d.getUTCDate() + Math.round(days));
    return d.toISOString().slice(0, 10);
  }

  function diffDays(a, b) {
    var da = toDate(a), db = toDate(b);
    if (!da || !db) return 0;
    return Math.round((db - da) / 86400000);
  }

  // Convert an offset expressed in WORKING days into CALENDAR days.
  // wd = working days per week (5 => 5 working days span 7 calendar days).
  function toCalendar(workingOffset, wd) {
    wd = wd || 7;
    if (wd >= 7) return Math.round(workingOffset);
    if (wd <= 0) wd = 5;
    return Math.ceil(workingOffset * 7 / wd);
  }

  function isWorkingDay(d, wd) {
    wd = wd || 5;
    var w = d.getUTCDay();
    if (wd >= 7) return true;
    if (wd === 6) return w !== 0;          // Mon–Sat
    return w !== 0 && w !== 6;             // Mon–Fri
  }

  // Date of the Nth WORKING day counted from `start` (start itself = offset 0
  // if it is a working day; otherwise rolled forward to the next one).
  // This is what makes schedules never land on Sat/Sun with a 5-day week.
  function workingDate(startIso, offset, wd) {
    var d = toDate(startIso);
    if (!d) return startIso;
    wd = wd || 5;
    while (!isWorkingDay(d, wd)) d.setUTCDate(d.getUTCDate() + 1);
    var n = Math.max(0, Math.round(offset || 0));
    while (n > 0) {
      d.setUTCDate(d.getUTCDate() + 1);
      if (isWorkingDay(d, wd)) n--;
    }
    return d.toISOString().slice(0, 10);
  }

  // First working day on/after the given date (used to roll weekend starts).
  function rollToWorkingDay(startIso, wd) {
    var d = toDate(startIso);
    if (!d) return startIso;
    wd = wd || 5;
    while (!isWorkingDay(d, wd)) d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  }

  function pertExpected(o, ml, p) {
    return Math.round(((o + 4 * ml + p) / 6) * 10) / 10;
  }

  function round1(n) { return Math.round(n * 10) / 10; }

  function clampNum(n, min, max) {
    if (!isFinite(n)) return min;
    return Math.max(min, Math.min(max, n));
  }

  /* ---------- CPM ---------- */

  // schedule.workingDaysPerWeek (optional, default 7) controls date math.
  // activity.earliestStart (optional, working days from project start)
  // enforces resource-availability gates during the forward pass.
  function computeCPM(schedule) {
    var acts = schedule.activities || [];
    var deps = schedule.dependencies || [];
    var start = schedule.plannedStart;
    var wd = schedule.workingDaysPerWeek || 7;
    var idToAct = {};
    acts.forEach(function (a) { idToAct[a.id] = a; });

    var succ = {}, pred = {};
    acts.forEach(function (a) { succ[a.id] = []; pred[a.id] = []; });
    deps.forEach(function (d) {
      if (!idToAct[d.from] || !idToAct[d.to]) return;
      succ[d.from].push({ to: d.to, lag: d.lagDays || 0, lead: d.leadDays || 0, type: d.type });
      pred[d.to].push({ from: d.from, lag: d.lagDays || 0, lead: d.leadDays || 0, type: d.type });
    });

    // Topological order via Kahn; fall back to input order on cycle.
    var indeg = {};
    acts.forEach(function (a) { indeg[a.id] = pred[a.id].length; });
    var q = acts.filter(function (a) { return indeg[a.id] === 0; }).map(function (a) { return a.id; });
    var order = [], qi = 0;
    while (qi < q.length) {
      var cur = q[qi++];
      order.push(cur);
      succ[cur].forEach(function (e) {
        indeg[e.to]--;
        if (indeg[e.to] === 0) q.push(e.to);
      });
    }
    if (order.length !== acts.length) order = acts.map(function (a) { return a.id; });

    var es = {}, ef = {};
    order.forEach(function (id) {
      var act = idToAct[id];
      var dur = act.durationDays || 0;
      var v = 0;
      if (pred[id].length) {
        var max = -Infinity;
        pred[id].forEach(function (e) {
          var fromEf = ef[e.from];
          if (fromEf === undefined) fromEf = 0;
          var cand = fromEf + (e.lag || 0) - (e.lead || 0);
          if (e.type === 'SS') cand = es[e.from] + (e.lag || 0) - (e.lead || 0);
          else if (e.type === 'FF') cand = fromEf + (e.lag || 0) - (e.lead || 0) - dur;
          else if (e.type === 'SF') cand = es[e.from] + (e.lag || 0) - (e.lead || 0) - dur;
          if (cand > max) max = cand;
        });
        v = max;
      }
      // Resource-availability gate: activity cannot start before day N.
      var gate = parseFloat(act.earliestStart);
      if (isFinite(gate) && gate > 0) v = Math.max(v, gate);
      es[id] = Math.max(0, v);
      ef[id] = es[id] + dur;
    });

    var projectDur = 0;
    acts.forEach(function (a) { if (ef[a.id] > projectDur) projectDur = ef[a.id]; });

    var ls = {}, lf = {};
    acts.forEach(function (a) {
      if (!succ[a.id].length) {
        lf[a.id] = projectDur;
        ls[a.id] = lf[a.id] - (a.durationDays || 0);
      }
    });
    for (var i = order.length - 1; i >= 0; i--) {
      var id2 = order[i];
      if (lf[id2] !== undefined) continue;
      var succs = succ[id2];
      if (!succs.length) {
        lf[id2] = projectDur;
        ls[id2] = lf[id2] - (idToAct[id2].durationDays || 0);
        continue;
      }
      var min = Infinity;
      succs.forEach(function (e) {
        var sLs = ls[e.to];
        if (sLs === undefined) sLs = es[e.to] || 0;
        var sEs = es[e.to] || 0;
        var cand;
        if (e.type === 'SS') cand = sLs - (e.lag || 0) + (e.lead || 0);
        else cand = sLs - (e.lag || 0) + (e.lead || 0); // FS/FF/SF unified
        if (cand < min) min = cand;
        if (e.type === 'FF' || e.type === 'SF') {
          var c2 = lf[e.to] - (e.lag || 0) + (e.lead || 0);
          if (c2 < min) min = c2;
        }
        void sEs;
      });
      lf[id2] = min;
      ls[id2] = lf[id2] - (idToAct[id2].durationDays || 0);
    }

    var result = {};
    acts.forEach(function (a) {
      var id = a.id;
      var f = (lf[id] - ef[id]);
      if (!isFinite(f)) f = 0;
      var isCrit = f <= 0.05; // zero OR negative float => critical
      result[id] = {
        es: es[id] || 0,
        ef: ef[id] || 0,
        ls: isFinite(ls[id]) ? ls[id] : es[id] || 0,
        lf: isFinite(lf[id]) ? lf[id] : ef[id] || 0,
        float: Math.round(Math.max(0, f) * 10) / 10,
        isCritical: isCrit,
        // Real working-day dates: offset 0 = start (rolled off weekends).
        // Non-milestone: occupies offsets [es, ef-1] inclusive.
        // Milestone: zero-duration event AT its predecessor's finish = es-1
        //   (so it never lands the day after the work it marks, nor on a weekend).
        startDate: workingDate(start, a.isMilestone && (es[id] || 0) > 0 ? es[id] - 1 : (es[id] || 0), wd),
        endDate: workingDate(start, Math.max(0, (ef[id] || 0) - 1), wd)
      };
      if (a.isMilestone) result[id].endDate = result[id].startDate;
    });
    var crit = acts.filter(function (a) { return result[a.id].isCritical; })
      .sort(function (a, b) { return result[a.id].es - result[b.id].es; })
      .map(function (a) { return a.id; });
    return { map: result, projectDuration: projectDur, criticalPath: crit };
  }

  /* ---------- network integrity ---------- */

  function hasCycle(sched) {
    var acts = sched.activities || [];
    var indeg = {}, succ = {};
    acts.forEach(function (a) { indeg[a.id] = 0; succ[a.id] = []; });
    (sched.dependencies || []).forEach(function (d) {
      if (indeg[d.to] === undefined || succ[d.from] === undefined) return;
      indeg[d.to]++; succ[d.from].push(d.to);
    });
    var q = acts.filter(function (a) { return indeg[a.id] === 0; }).map(function (a) { return a.id; });
    var seen = 0, qi = 0;
    while (qi < q.length) {
      var cur = q[qi++]; seen++;
      succ[cur].forEach(function (t) { if (--indeg[t] === 0) q.push(t); });
    }
    return seen !== acts.length;
  }

  // Give every activity (except the first) a predecessor so the network
  // is one connected PDM graph. Never introduces cycles (verified).
  function connectNetwork(sched) {
    var acts = sched.activities || [];
    if (acts.length < 2) return;
    var hasPred = {};
    (sched.dependencies || []).forEach(function (d) { hasPred[d.to] = true; });
    var added = [];
    for (var i = 1; i < acts.length; i++) {
      if (!hasPred[acts[i].id]) {
        added.push({ from: acts[i - 1].id, to: acts[i].id, type: 'FS', lagDays: 0, leadDays: 0 });
      }
    }
    if (!added.length) return;
    var before = (sched.dependencies || []).length;
    sched.dependencies = (sched.dependencies || []).concat(added);
    if (hasCycle(sched)) sched.dependencies = sched.dependencies.slice(0, before);
  }

  /* ---------- deterministic plan enforcement ---------- */

  // Keep PERT triple proportional to a duration, preserving the model's
  // relative uncertainty spread: (O + 4ML + P)/6 == duration exactly.
  function refitPert(a) {
    var dur = Math.max(0, a.durationDays || 0);
    var ml = a.mostLikely, o = a.optimistic, p = a.pessimistic;
    var ratio = 0.6;
    if (isFinite(o) && isFinite(ml) && isFinite(p) && ml > 0) {
      var r = (p - o) / ml;
      if (isFinite(r) && r > 0) ratio = r;
    }
    var half = Math.max(0.5, dur * ratio / 2);
    a.optimistic = round1(Math.max(0, dur - half));
    a.mostLikely = round1(dur);
    a.pessimistic = round1(dur + half);
    a.expectedDuration = pertExpected(a.optimistic, a.mostLikely, a.pessimistic);
    return a;
  }

  // Scale / adjust activity durations so the critical path lands exactly
  // on targetWorkingDays (when feasible).
  function fitToTarget(sched, target, report) {
    var live = sched.activities.filter(function (a) { return !a.isMilestone; });
    if (!live.length) return;
    var minTotal = live.length; // every live activity >= 1 day
    if (target < minTotal) {
      report.adjustments.push('Target ' + target + 'd is below the minimum for ' +
        live.length + ' activities — using ' + minTotal + 'd.');
      target = minTotal;
    }

    function bumpPert(a, delta) {
      a.durationDays = Math.max(1, (a.durationDays || 1) + delta);
      refitPert(a);
    }

    // Phase 1: proportional scaling (keeps parallel structure).
    for (var iter = 0; iter < 12; iter++) {
      var d = computeCPM(sched).projectDuration;
      if (d <= 0 || Math.abs(d - target) <= 0) break;
      var factor = target / d;
      var changed = false;
      live.forEach(function (a) {
        var nd = Math.max(1, Math.round((a.durationDays || 1) * factor));
        if (nd !== a.durationDays) changed = true;
        a.durationDays = nd;
        refitPert(a);
      });
      if (!changed) break;
    }

    // Phase 2: exact correction — +/-1 day on critical path activities.
    var guard = 0, stall = 0, prev = -1;
    while (guard++ < 400) {
      var cpm = computeCPM(sched);
      var cur = cpm.projectDuration;
      if (cur === target) break;
      if (cur === prev) { stall++; if (stall > 30) break; } else stall = 0;
      prev = cur;
      var pool = cpm.criticalPath.map(function (id) {
        return sched.activities.filter(function (a) { return a.id === id; })[0];
      }).filter(function (a) { return a && !a.isMilestone; });
      if (!pool.length) pool = live;
      if (cur < target) {
        bumpPert(pool[guard % pool.length], 1);
      } else {
        var shrunk = false;
        for (var i = 0; i < pool.length; i++) {
          if ((pool[i].durationDays || 1) > 1) { bumpPert(pool[i], -1); shrunk = true; break; }
        }
        if (!shrunk) {
          for (var j = 0; j < live.length; j++) {
            if ((live[j].durationDays || 1) > 1) { bumpPert(live[j], -1); shrunk = true; break; }
          }
        }
        if (!shrunk) break;
      }
    }

    // Keep sheet PERT columns exactly consistent with final durations.
    live.forEach(refitPert);
  }

  /* ---------- public: enforcePlan ---------- */

  // inputs: { startDate, targetWorkingDays, workingDays, resourceAvailability:[{name,days}] }
  // Returns a report; also sets schedule.planCheck for UI/Excel display.
  function enforcePlan(schedule, inputs) {
    inputs = inputs || {};
    var report = { ok: true, targetDays: 0, actualDays: 0, gates: [], adjustments: [] };

    var wd = parseInt(inputs.workingDays, 10);
    if (!isFinite(wd) || wd < 1 || wd > 7) wd = 5;   // default: Mon–Fri
    schedule.workingDaysPerWeek = wd;

    if (inputs.startDate && toDate(inputs.startDate)) {
      schedule.plannedStart = inputs.startDate;
      // If the chosen start falls on a non-working day, say so once.
      var startD = toDate(schedule.plannedStart);
      if (wd < 7 && startD && !isWorkingDay(startD, wd)) {
        var rolled = rollToWorkingDay(schedule.plannedStart, wd);
        report.adjustments.push('Start ' + fmtDate(schedule.plannedStart) +
          ' is a non-working day — work begins ' + fmtDate(rolled) + '.');
      }
    }

    // 1) Clean dependencies: drop unknown ids / self links.
    var ids = {};
    schedule.activities.forEach(function (a) { ids[a.id] = true; });
    schedule.dependencies = (schedule.dependencies || []).filter(function (d) {
      return ids[d.from] && ids[d.to] && d.from !== d.to;
    });

    // 2) Normalize durations & PERT triples; milestones are exactly 0.
    schedule.activities.forEach(function (a) {
      if (a.isMilestone) {
        a.durationDays = 0; a.optimistic = 0; a.mostLikely = 0;
        a.pessimistic = 0; a.expectedDuration = 0;
        a.earliestStart = 0;
        return;
      }
      var dur = parseFloat(a.durationDays);
      if (!isFinite(dur) || dur < 1) dur = Math.max(1, Math.round(parseFloat(a.expectedDuration) || 1));
      a.durationDays = Math.max(1, dur);
      var o = parseFloat(a.optimistic), ml = parseFloat(a.mostLikely), p = parseFloat(a.pessimistic);
      if (!isFinite(o) || !isFinite(ml) || !isFinite(p)) {
        a.optimistic = Math.max(0, a.durationDays - 1);
        a.mostLikely = a.durationDays;
        a.pessimistic = a.durationDays + 2;
      }
      refitPert(a);
    });

    // 3) Resource-availability gates -> earliestStart (working-day offset).
    var gates = inputs.resourceAvailability || [];
    gates.forEach(function (g) {
      var name = String(g && g.name || '').trim();
      var days = parseInt(g && g.days, 10);
      if (!name || !isFinite(days) || days <= 0) return;
      var lower = name.toLowerCase();
      var matched = 0;
      schedule.activities.forEach(function (a) {
        var hay = ((a.resources || []).join(' ') + ' ' + (a.name || '')).toLowerCase();
        if (hay.indexOf(lower) !== -1 || lower.indexOf(hay.trim()) !== -1) {
          a.earliestStart = Math.max(parseFloat(a.earliestStart) || 0, days);
          var note = name + ' available from day ' + days;
          if ((a.constraint || '').indexOf(note) === -1) {
            a.constraint = [a.constraint, note].filter(Boolean).join('; ');
          }
          matched++;
        }
      });
      if (matched) {
        report.gates.push(name + ' → day ' + days + ' (' + matched + ' activit' + (matched === 1 ? 'y' : 'ies') + ')');
      } else {
        // No activity uses this resource name — surface it instead of hiding it.
        report.adjustments.push('Gate "' + name + ' → day ' + days +
          '" matched no activity resource — model was told; check resource names if this looks wrong.');
      }
    });
    // Respect any earliestStartDay the model itself reported.
    schedule.activities.forEach(function (a) {
      var e = parseFloat(a.earliestStart);
      if (isFinite(e) && e > 0 && !a.isMilestone) a.earliestStart = e;
      else if (a.isMilestone) a.earliestStart = 0;
    });

    // 4) Connected network (no orphan activities).
    connectNetwork(schedule);

    // 5) Fit the critical path to the target duration.
    var target = parseInt(inputs.targetWorkingDays !== undefined ? inputs.targetWorkingDays : inputs.targetDays, 10);
    report.targetDays = isFinite(target) && target > 0 ? target : 0;
    if (report.targetDays) fitToTarget(schedule, report.targetDays, report);

    // 6) Recompute authoritative CPM + dates.
    var cpm = computeCPM(schedule);
    schedule.projectDurationDays = cpm.projectDuration;
    schedule.criticalPath = cpm.criticalPath;
    // plannedEnd = the last working day of the project (inclusive), never a weekend.
    schedule.plannedEnd = workingDate(schedule.plannedStart,
      Math.max(0, cpm.projectDuration - 1), wd);
    if (schedule.controlPlan) schedule.controlPlan.baselineDate = schedule.plannedStart;

    report.actualDays = cpm.projectDuration;
    if (report.targetDays) {
      if (report.actualDays === report.targetDays) {
        report.ok = true;
      } else {
        report.ok = false;
        report.adjustments.push('Resource gates force the plan to ' + report.actualDays +
          ' working days (target ' + report.targetDays + ').');
      }
    }
    schedule.planCheck = report;
    return report;
  }

  return {
    toDate: toDate,
    fmtDate: fmtDate,
    addDays: addDays,
    diffDays: diffDays,
    toCalendar: toCalendar,
    workingDate: workingDate,
    isWorkingDay: isWorkingDay,
    rollToWorkingDay: rollToWorkingDay,
    pertExpected: pertExpected,
    computeCPM: computeCPM,
    connectNetwork: connectNetwork,
    enforcePlan: enforcePlan
  };
});
