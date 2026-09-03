/* =====================================================================
   Charter Forge · Schedule Excel workbook builder
   Multi-sheet workbook mirroring charter visual language.
   UMD: browser global window.ScheduleExcel, Node module.exports
   ===================================================================== */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('exceljs'), require('./schedule'));
  else root.ScheduleExcel = factory(root.ExcelJS, root.ScheduleLogic);
})(typeof self !== 'undefined' ? self : this, function (ExcelJS, Logic) {
  'use strict';

  var COLORS = {
    dark: 'FF2F5597',
    dark2: 'FF24437C',
    lightBlue: 'FFBDD7EE',
    paleBlue: 'FFEEF3FB',
    pale2: 'FFF2F7FF',
    white: 'FFFFFFFF',
    ink: 'FF1A1A1A',
    gold: 'FFFFF3D6',
    critBg: 'FFFFE0E0',
    critInk: 'FF8B1A1A'
  };

  function toDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso||''));
    if (!m) return null;
    var d = new Date(Date.UTC(+m[1],+m[2]-1,+m[3]));
    return isNaN(d.getTime())?null:d;
  }

  function styleCell(cell, o) {
    o=o||{};
    if (o.fill) cell.fill={ type:'pattern', pattern:'solid', fgColor:{ argb:o.fill }};
    cell.font={ name:'Calibri', size:o.size||10, bold:!!o.bold, color:{ argb:o.color||COLORS.ink }};
    cell.alignment={ vertical:o.valign||'middle', horizontal:o.halign||'left', wrapText:true, indent: o.indent||0 };
    var b={ style:'thin', color:{ argb:COLORS.white }};
    if (o.borderless) cell.border={};
    else cell.border={ top:b, bottom:b, left:b, right:b };
    if (o.numFmt) cell.numFmt=o.numFmt;
  }

  function buildScheduleWorkbook(schedule) {
    var wb = new ExcelJS.Workbook();
    wb.creator='Charter Forge';
    wb.created=new Date(); wb.modified=new Date();
    var cpm = Logic.computeCPM(schedule);

    function addSheet(name, tabColor) {
      var ws = wb.addWorksheet(name, { properties:{ tabColor:{ argb:tabColor }}, pageSetup:{ orientation:'landscape', fitToPage:true, fitToWidth:1, fitToHeight:0 }});
      ws.properties.defaultRowHeight=16;
      return ws;
    }

    // ---------- SHARED HELPERS ----------
    function header(ws, title, subtitle) {
      ws.mergeCells('A1:H1');
      var c=ws.getCell('A1'); c.value=title;
      styleCell(c,{ fill:COLORS.dark, color:COLORS.white, bold:true, size:16, halign:'center' });
      ws.getRow(1).height=30;
      if (subtitle) {
        ws.mergeCells('A2:H2');
        var s=ws.getCell('A2'); s.value=subtitle;
        styleCell(s,{ fill:COLORS.dark2, color:COLORS.white, size:9, halign:'center' });
        ws.getRow(2).height=18;
      }
      // project meta row
      var r = subtitle?3:2;
      ws.mergeCells('A'+r+':H'+r);
      var meta = ws.getCell('A'+r);
      meta.value = (schedule.projectName||'') + '  ·  ' + (schedule.methodology||'') + '  ·  ' + (schedule.plannedStart||'') + ' → ' + (schedule.plannedEnd||'');
      styleCell(meta,{ fill:COLORS.gold, size:9, halign:'center', bold:true });
      ws.getRow(r).height=16;
      return subtitle?4:3;
    }

    function tableHead(ws, row, cols, widths) {
      cols.forEach(function(col,i){
        var cell=ws.getCell(row,i+1);
        cell.value=col;
        styleCell(cell,{ fill:COLORS.dark, color:COLORS.white, bold:true, size:9, halign:'center' });
      });
      ws.getRow(row).height=20;
      if (widths) widths.forEach(function(w,i){ ws.getColumn(i+1).width=w; });
    }

    function thinBorder(ws, ref) {
      var m=ref.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
      if(!m) return;
      var colToNum=function(s){ var n=0; for(var i=0;i<s.length;i++) n=n*26+(s.charCodeAt(i)-64); return n; };
      var c1=colToNum(m[1]), r1=+m[2], c2=colToNum(m[3]), r2=+m[4];
      var dark={ style:'thin', color:{ argb:'FF262626' }};
      var white={ style:'thin', color:{ argb:COLORS.white }};
      for(var r=r1;r<=r2;r++) for(var c=c1;c<=c2;c++) {
        var cell=ws.getRow(r).getCell(c);
        // keep existing fill/font/alignment, only adjust border thickness on outer edge
        var isTop=r===r1, isBottom=r===r2, isLeft=c===c1, isRight=c===c2;
        cell.border={
          top: isTop?dark:white, bottom: isBottom?dark:white,
          left: isLeft?dark:white, right: isRight?dark:white
        };
      }
    }

    // ================================================================
    // SHEET 1 — Plan & Control (covers Plan Schedule Mgt + Control)
    // ================================================================
    (function(){
      var ws=addSheet('1-Plan & Control', COLORS.dark);
      var r=header(ws,'Project Schedule — Plan & Control', 'Processes 1 & 6  ·  Policies, tools, baseline & change control');
      ws.getColumn(1).width=28; ws.getColumn(2).width=72;
      var rows=[
        ['Project', schedule.projectName||''],
        ['Methodology', schedule.methodology||''],
        ['Planned Start', schedule.plannedStart||''],
        ['Planned End', schedule.plannedEnd||''],
        ['Duration (CPM)', (cpm.projectDuration||schedule.projectDurationDays||'') + ' days  ·  Critical: ' + (cpm.criticalPath.join(' → ')||'—')],
        ['Policy', (schedule.planScheduleManagement&&schedule.planScheduleManagement.policy)||''],
        ['Tools', ((schedule.planScheduleManagement&&schedule.planScheduleManagement.tools)||[]).join('  ·  ')],
        ['Roles', (schedule.planScheduleManagement&&schedule.planScheduleManagement.roles)||''],
        ['Baseline Date', (schedule.controlPlan&&schedule.controlPlan.baselineDate)||schedule.plannedStart||''],
        ['Variance Threshold', (schedule.controlPlan&&schedule.controlPlan.varianceThreshold)||''],
        ['Velocity Target', (schedule.controlPlan&&schedule.controlPlan.velocityTarget)||'— (Waterfall)'],
        ['Retrospectives', (schedule.controlPlan&&schedule.controlPlan.retrospectiveCadence)||''],
        ['Change Control', (schedule.controlPlan&&schedule.controlPlan.changeControlProcess)||''],
        ['Backlog Reprioritization', 'Backlog re-ordered each iteration / gate review as priorities shift.']
      ];
      r++;
      rows.forEach(function(row,i){
        var label=row[0], val=row[1];
        var c1=ws.getCell(r,1);
        c1.value=label;
        var isAlt=i%2===0;
        styleCell(c1,{ fill:COLORS.dark, color:COLORS.white, bold:true, size:10, halign:'center' });
        ws.mergeCells(r,2,r,8);
        var c2=ws.getCell(r,2);
        // Set value once on master cell only — do not touch other cells in the merged range
        if (label==='Planned Start' || label==='Planned End' || label==='Baseline Date') {
          var d=toDate(val);
          if (d){ c2.value=d; c2.numFmt='dd-mmm-yyyy'; }
          else c2.value=val;
        } else {
          c2.value=val;
        }
        // Style entire merged range without overwriting values
        for(var col=2;col<=8;col++){
          var cc=ws.getCell(r,col);
          styleCell(cc,{ fill: isAlt?COLORS.lightBlue:COLORS.paleBlue, size:10, valign:'top', halign: (label==='Planned Start'||label==='Planned End'||label==='Baseline Date') ? 'left' : 'left' });
        }
        // auto height
        var h=Math.max(22, Math.ceil(String(val).length/85)*15+10);
        ws.getRow(r).height=h;
        r++;
      });
      // r is now one past last data row; header started at 4
      thinBorder(ws,'A5:H'+(r-1));
      // footer note
      ws.mergeCells('A'+r+':H'+r);
      var foot=ws.getCell('A'+r);
      foot.value='Processes: 1 Plan Schedule Mgt  ·  6 Control Schedule (variance, velocity, retrospectives, CCB)';
      styleCell(foot,{ fill:COLORS.dark2, color:COLORS.white, size:8, halign:'center' });
    })();

    // ================================================================
    // SHEET 2 — Activities (Activity List + Attributes)
    // ================================================================
    (function(){
      var ws=addSheet('2-Activities', COLORS.dark);
      var r0=header(ws,'Activity List & Attributes', 'Process 2  ·  WBS, description, resources, constraints — milestones = 0 days');
      var head=['ID','WBS','Activity / Milestone','Description','Est. Method','Resources','Constraint','Dur (d)'];
      var widths=[8,10,28,38,16,22,20,10];
      tableHead(ws,r0,head,widths);
      var r=r0+1;
      (schedule.activities||[]).forEach(function(a,i){
        var isMilestone=!!a.isMilestone;
        var isCrit = cpm.map[a.id] && cpm.map[a.id].isCritical;
        var fill = isMilestone ? COLORS.gold : (isCrit?COLORS.critBg : (i%2===0?COLORS.paleBlue:COLORS.white));
        var vals=[a.id, a.wbsId, a.name + (isMilestone?'  ◆':''), a.description, a.estimationMethod||'', (a.resources||[]).join(', '), a.constraint||'', a.durationDays];
        vals.forEach(function(v,ci){
          var c=ws.getCell(r,ci+1);
          c.value=v;
          var halign = (ci===7?'center':(ci===0||ci===1?'center':'left'));
          styleCell(c,{ fill:fill, size:9, halign:halign, valign:'top', color: isCrit&&ci===2?COLORS.critInk:COLORS.ink, bold: isCrit&&ci===2 });
          if (isMilestone && ci===7) { c.font={ name:'Calibri', size:9, bold:true, color:{ argb:COLORS.ink }}; }
        });
        var h=Math.max(22, Math.ceil(String(a.description||a.name).length/45)*14+8);
        ws.getRow(r).height=h;
        r++;
      });
      thinBorder(ws,'A'+r0+':H'+(r-1));
      // legend
      ws.mergeCells('A'+r+':H'+r);
      var leg=ws.getCell('A'+r);
      leg.value='◆ = Milestone (0 days)   ·   Red-tinted row = Critical Path   ·   Float shown on Schedule sheet';
      styleCell(leg,{ size:8, halign:'center', color:'FF7C85A0' });
    })();

    // ================================================================
    // SHEET 3 — Network (PDM + dependencies, lead/lag)
    // ================================================================
    (function(){
      var ws=addSheet('3-Network (PDM)', COLORS.dark);
      var r0=header(ws,'Precedence Diagram (PDM) — Logical Relationships', 'Process 3  ·  FS / SS / FF / SF  ·  Lead & Lag  ·  Nodes = activities, Arrows = dependencies');
      var head=['From','→','To','Type','Meaning','Lag (d)','Lead (d)','Effective'];
      var widths=[10,6,10,10,42,12,12,18];
      tableHead(ws,r0,head,widths);
      var r=r0+1;
      var typeMeaning={ FS:'B cannot start until A finishes', SS:'B cannot start until A starts', FF:'B cannot finish until A finishes', SF:'B cannot finish until A starts' };
      (schedule.dependencies||[]).forEach(function(d,i){
        var vals=[d.from,'→',d.to,d.type,typeMeaning[d.type]||'',d.lagDays||0,d.leadDays||0, (d.lagDays?('+'+d.lagDays+' lag'):'') + (d.leadDays? (d.lagDays?' / ':'')+'-'+d.leadDays+' lead':'') || '—'];
        var isCrit = cpm.map[d.from]&&cpm.map[d.from].isCritical && cpm.map[d.to]&&cpm.map[d.to].isCritical;
        vals.forEach(function(v,ci){
          var c=ws.getCell(r,ci+1);
          c.value=v;
          var fill = isCrit?COLORS.critBg : (i%2===0?COLORS.paleBlue:COLORS.white);
          var halign = (ci===4?'left': 'center');
          styleCell(c,{ fill:fill, size:9, halign:halign, valign:'middle', bold: ci===3 });
        });
        ws.getRow(r).height=20;
        r++;
      });
      if (!(schedule.dependencies||[]).length) {
        ws.mergeCells('A'+r+':H'+r);
        ws.getCell('A'+r).value='No dependencies defined';
        styleCell(ws.getCell('A'+r),{ fill:COLORS.paleBlue, halign:'center' });
        r++;
      }
      thinBorder(ws,'A'+r0+':H'+(r-1));
      // small PDM legend row
      ws.mergeCells('A'+r+':H'+r);
      var n=ws.getCell('A'+r);
      n.value='PDM: rectangular nodes = activities  ·  arrows = dependencies  ·  Lead = acceleration (overlap), Lag = waiting time';
      styleCell(n,{ size:8, halign:'center', color:'FF7C85A0' });
    })();

    // ================================================================
    // SHEET 4 — Duration Estimates (PERT + Analogous/Parametric etc)
    // ================================================================
    (function(){
      var ws=addSheet('4-Duration Estimates', COLORS.dark);
      var r0=header(ws,'Duration Estimates', 'Process 4  ·  Analogous · Parametric · PERT ( O + 4ML + P )/6  ·  Bottom-Up  ·  Story Points / T-Shirt');
      var head=['ID','Activity','O (opt)','ML','P (pess)','Expected  (O+4ML+P)/6','Dur (d)','Method','Story Pts','T-Shirt'];
      var widths=[8,32,10,10,10,18,10,16,12,12];
      tableHead(ws,r0,head,widths);
      var r=r0+1;
      (schedule.activities||[]).forEach(function(a,i){
        var exp = (a.expectedDuration!==undefined? a.expectedDuration : Logic.pertExpected(a.optimistic||0,a.mostLikely||0,a.pessimistic||0));
        var vals=[a.id, a.name, a.optimistic, a.mostLikely, a.pessimistic, exp, a.durationDays, a.estimationMethod||'', (a.storyPoints!==undefined?a.storyPoints:''), a.tShirtSize||''];
        var isMilestone=!!a.isMilestone;
        vals.forEach(function(v,ci){
          var c=ws.getCell(r,ci+1);
          c.value=v;
          var fill = isMilestone?COLORS.gold : (i%2===0?COLORS.paleBlue:COLORS.white);
          styleCell(c,{ fill:fill, size:9, halign: (ci>=2 && ci<=6?'center':'left'), valign:'middle' });
          if (ci===5) { c.font={ name:'Calibri', size:9, bold:true, color:{ argb:COLORS.ink }}; c.fill={ type:'pattern', pattern:'solid', fgColor:{ argb: isMilestone?COLORS.gold:COLORS.lightBlue }}; }
        });
        ws.getRow(r).height=20;
        r++;
      });
      thinBorder(ws,'A'+r0+':J'+(r-1));
      // formula note
      ws.mergeCells('A'+r+':J'+r);
      var f=ws.getCell('A'+r);
      f.value='PERT Expected = ( Optimistic + 4 × Most Likely + Pessimistic ) / 6  ·  Bottom-Up = aggregate of WBS leaves  ·  Parametric = units × unit-rate  ·  Story Points = relative complexity';
      styleCell(f,{ size:8, halign:'center', color:'FF7C85A0', fill:COLORS.pale2 });
      ws.getRow(r).height=22;
      // if agile, show planning poker note
      if (schedule.methodology==='Agile' || schedule.methodology==='Hybrid') {
        r++;
        ws.mergeCells('A'+r+':J'+r);
        var ap=ws.getCell('A'+r);
        ap.value='Agile: Story Points via Planning Poker (Fibonacci 0,1,2,3,5,8,13,21…)  ·  T-Shirt: XS=1 sprint, S=2-4, M=4-12, L=12+ sprints';
        styleCell(ap,{ size:8, halign:'center', fill:COLORS.gold });
      }
    })();

    // ================================================================
    // SHEET 5 — Schedule (CPM, float, Gantt dates, critical path)
    // ================================================================
    (function(){
      var ws=addSheet('5-Schedule (CPM)', COLORS.dark);
      var sub='Process 5  ·  CPM  ·  Critical Path = longest path (0 float)  ·  Float/Slack = delay without affecting completion';
      var r0=header(ws,'Schedule — Critical Path, Float & Dates', sub);
      var head=['ID','Activity','Start','End','Dur','ES','EF','LS','LF','Float','Critical?'];
      var widths=[8,30,14,14,8,8,8,8,8,10,14];
      tableHead(ws,r0,head,widths);
      var r=r0+1;
      // sort by ES
      var sorted=[].concat(schedule.activities||[]).sort(function(a,b){ return (cpm.map[a.id]?cpm.map[a.id].es:0) - (cpm.map[b.id]?cpm.map[b.id].es:0); });
      sorted.forEach(function(a,i){
        var cp=cpm.map[a.id]||{ es:0, ef:a.durationDays||0, ls:0, lf:0, float:0, isCritical:false, startDate:schedule.plannedStart, endDate:schedule.plannedStart };
        var vals=[a.id, a.name + (a.isMilestone?' ◆':''), cp.startDate, cp.endDate, a.durationDays, cp.es, cp.ef, cp.ls, cp.lf, cp.float, cp.isCritical?'★ YES':''];
        vals.forEach(function(v,ci){
          var c=ws.getCell(r,ci+1);
          if ((ci===2||ci===3) && v) {
            var d=toDate(v);
            c.value=d||v;
            if(d) c.numFmt='dd-mmm-yyyy';
          } else c.value=v;
          var fill = a.isMilestone?COLORS.gold : (cp.isCritical?COLORS.critBg : (i%2===0?COLORS.paleBlue:COLORS.white));
          var halign= (ci===1?'left':'center');
          styleCell(c,{ fill:fill, size:9, halign:halign, valign:'middle', bold: cp.isCritical && ci===1, color: cp.isCritical&&ci===1?COLORS.critInk:COLORS.ink });
          if (ci===10 && cp.isCritical) { c.font={ name:'Calibri', size:10, bold:true, color:{ argb:COLORS.critInk }}; }
        });
        ws.getRow(r).height=20;
        r++;
      });
      thinBorder(ws,'A'+r0+':K'+(r-1));
      // summary
      ws.mergeCells('A'+r+':K'+r);
      var sum=ws.getCell('A'+r);
      sum.value='Project Duration: ' + (cpm.projectDuration||schedule.projectDurationDays||'') + ' working days  ·  Critical Path: ' + (cpm.criticalPath.join(' → ')||'—') + '  ·  Float = 0 on critical path';
      styleCell(sum,{ fill:COLORS.dark, color:COLORS.white, bold:true, size:10, halign:'center' });
      ws.getRow(r).height=20;
      r++;
      // Gantt mini bar using conditional fill simulation: add note
      ws.mergeCells('A'+r+':K'+r);
      var note=ws.getCell('A'+r);
      note.value='Gantt: dates auto-computed from ES/EF + plannedStart. Use Excel filters to sort by ES or Float. Milestones have 0 duration.';
      styleCell(note,{ size:8, halign:'center', color:'FF7C85A0' });
    })();

    // ================================================================
    // SHEET 6 — Resources, Compression & Agile Release
    // ================================================================
    (function(){
      var ws=addSheet('6-Resources & Control', COLORS.dark);
      var r0=header(ws,'Resources, Compression & Agile Release', 'Resource Leveling vs Smoothing  ·  Crashing vs Fast-Tracking  ·  Release Plan & Velocity');
      var r=r0+1;
      // Resource block
      ws.mergeCells('A'+r+':H'+r);
      var t=ws.getCell('A'+r); t.value='Resource Optimization';
      styleCell(t,{ fill:COLORS.dark, color:COLORS.white, bold:true, halign:'center' });
      ws.getRow(r).height=20; r++;
      var resRows=[
        ['Leveling', (schedule.resourcePlan&&schedule.resourcePlan.levelingNotes)||'', 'May change critical path & end date'],
        ['Smoothing', (schedule.resourcePlan&&schedule.resourcePlan.smoothingNotes)||'', 'Uses float only — path & date unchanged']
      ];
      resRows.forEach(function(row,i){
        ws.getCell(r,1).value=row[0]; styleCell(ws.getCell(r,1),{ fill:COLORS.dark, color:COLORS.white, bold:true, halign:'center', size:9 });
        ws.mergeCells(r,2,r,5); ws.getCell(r,2).value=row[1]; styleCell(ws.getCell(r,2),{ fill:COLORS.paleBlue, size:9, valign:'top' });
        ws.mergeCells(r,6,r,8); ws.getCell(r,6).value=row[2]; styleCell(ws.getCell(r,6),{ fill:COLORS.lightBlue, size:8, halign:'center' });
        ws.getRow(r).height=28; r++;
      });
      r++;
      // Compression
      ws.mergeCells('A'+r+':H'+r);
      var ct=ws.getCell('A'+r); ct.value='Schedule Compression';
      styleCell(ct,{ fill:COLORS.dark, color:COLORS.white, bold:true, halign:'center' });
      ws.getRow(r).height=20; r++;
      var crash = (schedule.compression&&schedule.compression.crashOptions)||[];
      var fast = (schedule.compression&&schedule.compression.fastTrackOptions)||[];
      var compRows=[
        ['Crashing', (crash.join('  ·  ')||'No crash options identified'), 'Adds resources — least incremental cost — needs budget'],
        ['Fast-Tracking', (fast.join('  ·  ')||'No fast-track options'), 'Overlap sequential tasks — parallel — higher risk, no direct cost']
      ];
      compRows.forEach(function(row){
        ws.getCell(r,1).value=row[0]; styleCell(ws.getCell(r,1),{ fill:COLORS.dark, color:COLORS.white, bold:true, halign:'center', size:9 });
        ws.mergeCells(r,2,r,5); ws.getCell(r,2).value=row[1]; styleCell(ws.getCell(r,2),{ fill:COLORS.paleBlue, size:9, valign:'top' });
        ws.mergeCells(r,6,r,8); ws.getCell(r,6).value=row[2]; styleCell(ws.getCell(r,6),{ fill:COLORS.lightBlue, size:8, halign:'center' });
        var h=Math.max(26, Math.ceil(row[1].length/80)*14+10);
        ws.getRow(r).height=h; r++;
      });
      r++;
      // Agile release if present
      if (schedule.agileRelease && schedule.agileRelease.sprints && schedule.agileRelease.sprints.length) {
        ws.mergeCells('A'+r+':H'+r);
        var at=ws.getCell('A'+r); at.value='Agile Release Plan — Sprints & Velocity';
        styleCell(at,{ fill:COLORS.dark, color:COLORS.white, bold:true, halign:'center' });
        ws.getRow(r).height=20; r++;
        var ahead=['Sprint','Goal','Activities','Velocity (pts)'];
        ahead.forEach(function(h,i){ var c=ws.getCell(r,i+1); if(i===2) ws.mergeCells(r,3,r,6);
          c.value=h; styleCell(c,{ fill:COLORS.dark2, color:COLORS.white, bold:true, size:9, halign:'center' });
        });
        ws.mergeCells(r,7,r,8); // velocity spans? keep simple
        ws.getRow(r).height=18; r++;
        schedule.agileRelease.sprints.forEach(function(sp,i){
          ws.getCell(r,1).value=sp.sprint; styleCell(ws.getCell(r,1),{ fill:COLORS.lightBlue, size:9, halign:'center', bold:true });
          ws.mergeCells(r,2,r,2); // goal in B? Use wider
          ws.getCell(r,2).value=sp.goal; styleCell(ws.getCell(r,2),{ fill:(i%2?COLORS.white:COLORS.paleBlue), size:9 });
          ws.mergeCells(r,3,r,6); ws.getCell(r,3).value=(sp.activityIds||[]).join(', '); styleCell(ws.getCell(r,3),{ fill:(i%2?COLORS.white:COLORS.paleBlue), size:8, halign:'center' });
          ws.mergeCells(r,7,r,8); ws.getCell(r,7).value=sp.velocityPoints||''; styleCell(ws.getCell(r,7),{ fill:COLORS.gold, size:9, halign:'center', bold:true });
          ws.getRow(r).height=22; r++;
        });
        r++;
      } else if (schedule.methodology==='Agile') {
        ws.mergeCells('A'+r+':H'+r);
        var noag=ws.getCell('A'+r); noag.value='Agile Release: velocity & sprint plan to be refined sprint-by-sprint; estimate via Planning Poker (Fibonacci) and T-Shirt sizing.';
        styleCell(noag,{ fill:COLORS.gold, size:9, halign:'center' }); r++;
      }
      // Control metrics row
      ws.mergeCells('A'+r+':H'+r);
      var ctl=ws.getCell('A'+r);
      ctl.value='Control: Variance threshold ' + ((schedule.controlPlan&&schedule.controlPlan.varianceThreshold)||'±10%') + '  ·  ' + ((schedule.controlPlan&&schedule.controlPlan.velocityTarget)||'') + '  ·  ' + ((schedule.controlPlan&&schedule.controlPlan.retrospectiveCadence)||'');
      styleCell(ctl,{ fill:COLORS.pale2, size:8, halign:'center', color:'FF46506E' });
    })();

    // Print titles
    wb.eachSheet(function(ws){
      ws.views=[{ state:'frozen', ySplit:3 }];
      ws.pageSetup.printTitlesRow='1:3';
    });

    return wb;
  }

  return { buildScheduleWorkbook: buildScheduleWorkbook };
});
