/* =====================================================================
   Charter Forge · Schedule helpers
   CPM forward/backward pass, PERT recompute, date helpers.
   UMD: browser global window.ScheduleLogic, Node module.exports
   ===================================================================== */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ScheduleLogic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function toDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    if (!m) return null;
    var d = new Date(Date.UTC(+m[1], +m[2]-1, +m[3]));
    return isNaN(d.getTime()) ? null : d;
  }

  function fmtDate(iso) {
    var MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    var d = toDate(iso);
    if (!d) return String(iso||'');
    return ('0'+d.getUTCDate()).slice(-2)+'-'+MONTHS[d.getUTCMonth()]+'-'+d.getUTCFullYear();
  }

  function addDays(iso, days) {
    var d = toDate(iso);
    if (!d) return iso;
    d.setUTCDate(d.getUTCDate() + Math.round(days));
    return d.toISOString().slice(0,10);
  }

  function diffDays(a,b) {
    var da = toDate(a), db = toDate(b);
    if (!da || !db) return 0;
    return Math.round((db - da)/86400000);
  }

  function pertExpected(o, ml, p) {
    return Math.round(((o + 4*ml + p)/6)*10)/10;
  }

  // Compute CPM forward/backward pass using only FS links for dates.
  // Returns map id -> { es, ef, ls, lf, float, isCritical, startDate, endDate }
  function computeCPM(schedule) {
    var acts = schedule.activities || [];
    var deps = schedule.dependencies || [];
    var start = schedule.plannedStart;
    var idToAct = {};
    acts.forEach(function(a){ idToAct[a.id]=a; });

    // Build adjacency for FS only
    var succ = {}; // id -> [toIds]
    var pred = {}; // id -> [fromIds]
    acts.forEach(function(a){ succ[a.id]=[]; pred[a.id]=[]; });
    deps.forEach(function(d){
      if (!idToAct[d.from] || !idToAct[d.to]) return;
      // treat all as FS for float calc but keep type for display
      succ[d.from].push({ to: d.to, lag: d.lagDays||0, lead: d.leadDays||0, type: d.type });
      pred[d.to].push({ from: d.from, lag: d.lagDays||0, lead: d.leadDays||0, type: d.type });
    });

    // Topological order via Kahn (assume DAG; if cycle, fallback to input order)
    var indeg = {};
    acts.forEach(function(a){ indeg[a.id]=pred[a.id].length; });
    var q = acts.filter(function(a){ return indeg[a.id]===0; }).map(function(a){ return a.id; });
    var order = [];
    var qi=0;
    while (qi<q.length){
      var cur=q[qi++]; order.push(cur);
      succ[cur].forEach(function(e){
        indeg[e.to]--;
        if (indeg[e.to]===0) q.push(e.to);
      });
    }
    if (order.length !== acts.length) {
      // cycle or disconnected — fallback to given order
      order = acts.map(function(a){ return a.id; });
    }

    var es = {}, ef = {};
    order.forEach(function(id){
      var dur = (idToAct[id].durationDays||0);
      if (!pred[id].length) {
        es[id]=0;
      } else {
        var max = -Infinity;
        pred[id].forEach(function(e){
          var fromEf = ef[e.from];
          if (fromEf===undefined) fromEf=0;
          // FS lag: successor ES = predecessor EF + lag - lead
          var cand = fromEf + (e.lag||0) - (e.lead||0);
          if (e.type==='SS') cand = es[e.from] + (e.lag||0) - (e.lead||0);
          else if (e.type==='FF') cand = fromEf + (e.lag||0) - (e.lead||0) - dur;
          else if (e.type==='SF') cand = es[e.from] + (e.lag||0) - (e.lead||0) - dur;
          if (cand>max) max=cand;
        });
        es[id]= Math.max(0, max);
      }
      ef[id]= es[id]+dur;
    });

    var projectDur = 0;
    acts.forEach(function(a){ if (ef[a.id]>projectDur) projectDur=ef[a.id]; });

    // Backward pass
    var ls={}, lf={};
    // initialize sinks
    acts.forEach(function(a){
      if (!succ[a.id].length) {
        lf[a.id]=projectDur;
        ls[a.id]=lf[a.id]- (a.durationDays||0);
      }
    });
    for (var i=order.length-1;i>=0;i--) {
      var id=order[i];
      if (lf[id]!==undefined) continue; // already sink
      var succs = succ[id];
      if (!succs.length) {
        lf[id]=projectDur;
        ls[id]=lf[id]- (idToAct[id].durationDays||0);
        continue;
      }
      var min = Infinity;
      succs.forEach(function(e){
        var sLs = ls[e.to];
        var sEs = es[e.to];
        if (sLs===undefined) sLs = es[e.to] || 0;
        // FS: predecessor LF = successor LS - lag + lead
        var cand = sLs - (e.lag||0) + (e.lead||0);
        if (e.type==='SS') cand = sEs - (e.lag||0) + (e.lead||0) + (idToAct[id].durationDays||0);
        else if (e.type==='FF') cand = lf[e.to] - (e.lag||0) + (e.lead||0);
        else if (e.type==='SF') cand = lf[e.to] - (e.lag||0) + (e.lead||0);
        // For FS/SS/FF/SF mapping to LF, we unify:
        if (e.type==='FS') cand = sLs - (e.lag||0) + (e.lead||0);
        else if (e.type==='SS') cand = sLs - (e.lag||0) + (e.lead||0); // approx
        if (cand<min) min=cand;
      });
      lf[id]=min;
      ls[id]=lf[id]- (idToAct[id].durationDays||0);
    }

    var result={};
    acts.forEach(function(a){
      var id=a.id;
      var f = (lf[id]-ef[id]);
      if (!isFinite(f)) f=0;
      f = Math.round(f*10)/10;
      result[id]={
        es: es[id]||0,
        ef: ef[id]||0,
        ls: ls[id]||0,
        lf: lf[id]||0,
        float: f,
        isCritical: Math.abs(f) < 0.05,
        startDate: addDays(start, es[id]||0),
        endDate: addDays(start, (ef[id]||0) - (a.isMilestone?0:1)) // inclusive end
      };
      if (a.isMilestone) result[id].endDate = result[id].startDate;
    });
    // also return ordered critical path by ES
    var crit = acts.filter(function(a){ return result[a.id].isCritical; }).sort(function(a,b){ return result[a.id].es - result[b.id].es; }).map(function(a){ return a.id; });
    return { map: result, projectDuration: projectDur, criticalPath: crit };
  }

  return { toDate: toDate, fmtDate: fmtDate, addDays: addDays, diffDays: diffDays, pertExpected: pertExpected, computeCPM: computeCPM };
});
