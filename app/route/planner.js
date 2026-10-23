/* planner.js —— 一日行程规划引擎（纯函数，Node 可单测）
 *
 * 能力：
 *   1) 从"现在"开始排：cfg.now / cfg.atPoi（进行中的事项接续剩余时长）
 *   2) 任务：有窗口且未标 soft → 当预约锚点；soft → 偏好时段，排不下顺延
 *   3) API 约束：cfg.blocks（硬占用块）、cfg.weights（科研/吃饭/步行/洗澡权重）
 *   4) 跨天：planRange（未来 N 天摘要）、bestDayForTask（这件事排哪天最合适）
 *
 * 结构：锚点 + 全程填空隙；对「洗澡时段 × 午饭地点 × 晚饭前后」小规模枚举打分。
 */
(function (root) {
  "use strict";
  var DAY = ["", "周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  function m(t) { var p = String(t).split(":"); return (+p[0]) * 60 + (+p[1]); }
  function hhmm(x) { x = Math.round(x); return ("0" + Math.floor(x / 60)).slice(-2) + ":" + ("0" + (x % 60)).slice(-2); }
  function inWeeks(w, ws) { return (ws || []).some(function (r) { return w >= r[0] && w <= r[1]; }); }

  function slot(S, poi, p) {
    var ov = (S.periodOverride || {})[poi] || {};
    var t = ov[p] || S.periods[p];
    return [m(t[0]), m(t[1])];
  }
  function coursesOf(S, day, week) {
    return S.courses.filter(function (c) { return c.day === day && inWeeks(week, c.weeks); })
      .map(function (c) {
        var a = slot(S, c.poi, c.periods[0]), b = slot(S, c.poi, c.periods[1]);
        return { title: c.name, poi: c.poi, place: c.place, teacher: c.teacher,
                 start: a[0], end: Math.max(a[1], b[1]), online: !!c.online, note: c.note || "" };
      }).sort(function (x, y) { return x.start - y.start; });
  }
  function dormOpen(S, day, t) {
    var R = S.dormRules;
    if (day === 6) return true;
    if (day === 7) return t < m(R.sundayDormUntil) && !R.sundayNoDorm.some(function (w) { return t >= m(w[0]) && t < m(w[1]); });
    return !R.weekdayNoDorm.some(function (w) { return t >= m(w[0]) && t < m(w[1]); });
  }
  function showerOk(S, day, t) {
    if (!dormOpen(S, day, t)) return false;
    if (day === 7) return t < m(S.dormRules.sundayDeepCleanFrom);
    return true;
  }

  function poiLabel(id) {
    var M = { "B2": "铸剑楼", "U7": "西配楼", "U8": "中楼", "U9": "东配楼", "U15": "团阶", "U20": "西苑平房",
              "U34": "文化广场", "U24": "综训馆", "U3": "澡堂", "U26": "未来警务学院" };
    return M[id] || id;
  }

  /* ---------------- 单日 ---------------- */
  function buildDay(cfg, choice) {
    var S = cfg.S, P = cfg.prefs || S.prefs, day = cfg.weekday, week = cfg.week || 1;
    var travel = cfg.travel, dorm = cfg.dormPoi, R = S.routine;
    var segs = [], warn = [], pos = dorm, cursor = -1;
    var cs = coursesOf(S, day, week);
    var amC = cs.filter(function (c) { return c.start < m("12:00"); });
    var pmC = cs.filter(function (c) { return c.start >= m("13:00") && c.start < m("18:00"); });
    var evC = cs.filter(function (c) { return c.start >= m("18:00"); });

    function walk(poi, noWalk) { return (noWalk || !poi || poi === pos) ? 0 : Math.round(travel(pos, poi) / 60); }
    function put(o) {
      var w = o.poi ? walk(o.poi, o.noWalk) : 0;
      var at = o.at != null ? Math.max(o.at, cursor) : cursor;
      var start = Math.max(at, cursor + w);
      var lateTol = (o.kind === "meal") ? 15 : 3;      // 吃饭是时间窗，15 分钟内不算问题
      if (o.at != null && start > o.at + lateTol && !o.softAt && o.hard !== "dinner") {
        var soft = (o.kind === "assembly" || o.kind === "routine" || o.kind === "shower" || o.kind === "meal");
        var hard = (o.kind === "class" || o.kind === "task");
        warn.push({ level: soft ? "info" : (hard ? "danger" : "warn"),
                    text: "「" + o.title + "」比预定晚 " + (start - o.at) + " 分钟（步行来不及）" });
      }
      if (o.endAt != null) {                            // 固定结束时刻（如早操 07:00 结束）
        o.dur = Math.max(5, o.endAt - start);
      }
      var seg = { kind: o.kind, title: o.title, poi: o.poi, place: o.place || "",
                  start: start, end: start + (o.dur || 0), note: o.note || "",
                  walkMin: w, fromPoi: w ? o._prevPos || "" : "" };
      segs.push(seg);
      if (o.poi) pos = o.poi;
      cursor = seg.end;
      if (o.kind === "task" && o.dl && seg.end > o.dl + 3) {
        warn.push({ level: "warn", text: "「" + o.title + "」做完已 " + hhmm(seg.end) + "，超过你设的最晚时间" });
      }
      return seg;
    }
    function classPoi(c) {
      if (!c.online) return c.poi;
      var next = cs.filter(function (x) { return x.start >= c.end; }).sort(function (a, b) { return a.start - b.start; })[0];
      return (next && next.start - c.end <= 30) ? next.poi : P.researchPoi;
    }

    /* --- 锚点 --- */
    var anchors = [];
    function A(o) { anchors.push(o); }

    if (day >= 1 && day <= 5) {
      A({ kind: "routine", title: "起床 · 洗漱 · 整理内务", poi: dorm, at: m(R.wake), dur: 25 });
      var ma = R.morningAssembly[day];
      if (ma) A({ kind: "assembly", title: "早集合 · " + ma.type + "（文化广场）", poi: R.assemblyPoi,
                  at: m(ma.time), endAt: m("07:00"), dur: 30,
                  note: "在文化广场解散" });
      A({ kind: "meal", title: "早饭（" + choice.bfName + "）", poi: choice.bfPoi, at: m(R.breakfastWindow[0]), dur: 20 });
      A({ kind: "routine", title: "回宿舍取书 · 下楼", poi: dorm, at: m(R.goDownstairs), dur: 3 });
      A({ kind: "assembly", title: "课前集合 · 点名报班（文化广场）", poi: R.assemblyPoi,
          at: m(R.preClassAssembly), dur: 5 });
      var md = R.preClassAssemblyDest[day];
      if (!md) {                                        // 周二/周四：带到当日一二节课的教室
        var firstC = amC[0] || cs[0];
        md = firstC ? firstC.poi : "B2";
      }
      A({ kind: "assembly", title: "带队行进（" + R.marchVia + "）→ " + poiLabel(md),
          poi: md, at: m(R.preClassAssembly) + 5, dur: 12, noWalk: true });
    } else {
      A({ kind: "routine", title: "起床 · 洗漱", poi: dorm, at: m("07:30"), dur: 20 });
      A({ kind: "meal", title: "早饭（" + choice.bfName + "）", poi: choice.bfPoi, at: m("07:55"), dur: 30 });
    }

    var amEnd = amC.length ? Math.max.apply(null, amC.map(function (c) { return c.end; })) : m(R.noonDismiss);
    var lunchAt = Math.max(m(R.noonDismiss), amEnd);
    var lunchEnd;
    if (choice.lunchKind === "takeout") {
      var pickM = P.takeoutPickMin || 6, eatM = P.takeoutEatMin || 22;
      A({ kind: "meal", title: "取外卖（图书馆前）", poi: P.takeoutPoi, at: lunchAt, dur: pickM });
      A({ kind: "meal", title: "午饭（外卖 · 带回自习点吃）", poi: P.researchPoi, at: lunchAt + pickM, dur: eatM });
      lunchEnd = lunchAt + pickM + eatM;
    } else {
      A({ kind: "meal", title: "午饭（" + choice.lunchName + "）", poi: choice.lunchPoi, at: lunchAt, dur: P.eatingMin });
      lunchEnd = lunchAt + P.eatingMin;
    }
    A({ kind: "rest", title: "午休（就地）", poi: choice.lunchKind === "takeout" ? P.researchPoi : choice.lunchPoi,
        at: Math.max(m(R.napWindow[0]), lunchEnd), dur: P.napMin });

    if (pmC.length) {
      A({ kind: "assembly", title: "下午课前集合 · 点名报班（文化广场）", poi: R.assemblyPoi,
          at: m(R.afternoonAssembly), dur: 5 });
      A({ kind: "assembly", title: "带队行进（" + R.marchVia + "）→ 铸剑楼", poi: "B2",
          at: m(R.afternoonAssembly) + 5, dur: 12, noWalk: true });
    }
    cs.forEach(function (c) {
      A({ kind: "class", title: c.title + (c.online ? "（线上）" : ""), poi: classPoi(c), place: c.place,
          at: c.start, dur: c.end - c.start, note: c.note });
    });
    /* 17:10 下课即自由，不再插"讲评/带回" */

    var TB = R.teamBlock;
    var tips = [];
    if (TB && TB.day === day) {
      /* 先到文化广场点名，再按模式分成"见习"或"跟队跑操"两条分支 */
      A({ kind: "assembly", title: "中队点名（文化广场）", poi: TB.gatherPoi,
          at: m(TB.gather), dur: TB.gatherMin || 5 });
      var mode = cfg.teamMode || TB.defaultMode || "observe";
      var md = (TB.modes || {})[mode] || (TB.modes || {}).observe || {};
      var tStart = m(TB.gather) + (TB.gatherMin || 5);
      A({ kind: "team", title: md.label || "中队活动", poi: md.stay ? TB.gatherPoi : null,
          at: tStart, dur: Math.max(30, m(TB.end) - tStart), noWalk: true, note: md.note || "" });
      if (md.tip) tips.push({ at: tStart, end: m(TB.end), text: md.tip });
    }
    if (choice.dinnerKind === "takeout") {
      var dpM = P.takeoutPickMin || 6, deM = P.takeoutEatMin || 22;
      A({ kind: "meal", title: "取外卖（图书馆前）", poi: P.takeoutPoi,
          at: m(R.dinnerWindow[0]), dur: dpM, hard: "dinner" });
      A({ kind: "meal", title: "晚饭（外卖 · 带回自习点）", poi: P.researchPoi,
          at: m(R.dinnerWindow[0]) + dpM, dur: deM, hard: "dinner" });
    } else {
      A({ kind: "meal", title: "晚饭（" + choice.dinnerName + "）", poi: choice.dinnerPoi,
          at: m(R.dinnerWindow[0]), dur: P.eatingMin, hard: "dinner" });
    }
    if (choice.shower) {
      /* 洗澡前要先回宿舍拿洗漱用品。要点：
         · 如果"拿洗漱用品"是序列里的第一件事 → 排到洗澡前
         · 如果它前面还有别的事（比如先去9号宿舍）→ 洗澡整体后移，保证顺序不乱 */
      var lead = (cfg.tasks || []).filter(function (t) { return !t.done; });
      var prepIdx = -1;
      lead.forEach(function (t, i) { if (prepIdx < 0 && t.poi === dorm && /洗漱|盆|毛巾/.test(t.name)) prepIdx = i; });
      var showerAt = choice.shower.start;
      if (prepIdx > 0) {
        var extra = 0;
        lead.slice(0, prepIdx).forEach(function (t) { extra += (t.dur || 20) + 8; });
        showerAt = choice.shower.start + extra;
      }
      if (prepIdx === 0) {
        var prep = lead[0];
        A({ kind: "task", title: prep.name, poi: dorm, noWalk: true,
            at: Math.max(0, showerAt - 12), dur: Math.min(prep.dur || 10, 12),
            note: "洗澡前回宿舍取", softAt: true });
        prep.done = true;
      }
      A({ kind: "shower", title: "洗澡" + (choice.parcel ? " + 顺路取快递" : ""), poi: P.showerPoi,
          at: showerAt, dur: P.showerMin + (choice.parcel ? P.parcelMin : 0),
          note: "先回宿舍取洗漱用品（盆）" });
    }
    (cfg.tasks || []).forEach(function (tk) {
      if (tk.done || !tk.win || tk.soft) return;
      A({ kind: "task", title: tk.name, poi: tk.poi, at: tk.win[0], dur: tk.dur,
          note: tk.note || "", softAt: true, dl: tk.win[1] });
      tk.done = true;
    });
    /* API 给的占用块：只放在空档里；与课程/集合冲突就直接忽略并说明（绝不悄悄挪动课程） */
    (cfg.blocks || []).forEach(function (b) {
      var len = Math.max(5, b.end - b.start), a = b.start, clash = null;
      for (var pass = 0; pass < 3 && !clash; pass++) {
        anchors.forEach(function (x) {
          if (clash || x.at == null) return;
          if (x.kind !== "class" && x.kind !== "assembly" && x.kind !== "meal") return;
          var xs = x.at, xe = x.at + (x.dur || 0);
          if (a < xe && a + len > xs) clash = x;
        });
        if (clash) break;
      }
      if (clash) {
        warn.push({ level: "warn",
          text: "占用「" + (b.label || "临时安排") + "」" + hhmm(b.start) + "-" + hhmm(b.end) +
                " 与「" + clash.title + "」冲突，已忽略；要保留请改到空档时间" });
        return;
      }
      A({ kind: "block", title: "占用 · " + (b.label || "临时安排"), poi: null,
          at: a, dur: len, noWalk: true });
    });

    A({ kind: "routine", title: "洗漱", poi: dorm, at: m(R.washUp), dur: 20 });
    A({ kind: "routine", title: "熄灯", poi: dorm, at: m(R.lightsOut), dur: 0 });

    /* 熄灯后：可选去宿舍楼里的警苑自习空间（有排不完的事才默认安排） */
    var LS = R.lateStudy || {};
    var leftTasks = (cfg.tasks || []).filter(function (t) { return !t.done; }).length;
    var wantLate = (cfg.lateStudy === true) ? true
                 : (cfg.lateStudy === false ? false
                 : ((LS.enabled === "auto" || LS.enabled === true) && leftTasks > 0));
    var lateSeg = null;
    if (wantLate) {
      var lsStart = m(R.lightsOut) + (LS.startAfter != null ? LS.startAfter : 5);
      var lsEnd = m(LS.until || "24:00");
      if (lsEnd > lsStart + (LS.minMin || 30)) {
        lateSeg = { kind: "research", title: "警苑自习室（熄灯后·可选）", poi: (LS.poi || dorm),
                    place: "宿舍楼内", start: lsStart, end: lsEnd,
                    note: "有工作/紧急学习才来，没有就别硬熬", walkMin: 0, fromPoi: "" };
        segs.push(lateSeg);
        warn.push({ level: "info", text: "今天还有 " + leftTasks + " 件事没排进去，已留出熄灯后的自习时段（" +
          hhmm(lsStart) + "–" + hhmm(lsEnd) + "），不需要就忽略" });
      }
    }

    anchors.sort(function (a, b) { return (a.at || 0) - (b.at || 0); });

    /* 动态：从"现在"开始 */
    var nowMin = (cfg.now != null) ? cfg.now : null;
    if (nowMin != null) {
      var kept = [];
      anchors.forEach(function (a) {
        var at = a.at || 0, end = at + (a.dur || 0);
        if (end <= nowMin + 1) return;
        if (at < nowMin && end > nowMin) {
          a.at = nowMin; a.dur = end - nowMin; a.noWalk = true;
          a.title = a.title + "（进行中）"; a.inProgress = true;
        }
        kept.push(a);
      });
      anchors = kept;
      pos = cfg.atPoi || dorm;
      cursor = nowMin;
    }

    /* 空隙填充 */
    var pending = (cfg.tasks || []).filter(function (t) { return !t.done; });
    function fillUntil(limitAt, nextPoi, nextNoWalk) {
      for (var guard = 0; guard < 12; guard++) {
        if (cursor < 0) return;
        var placed = false;
        for (var i = 0; i < pending.length; i++) {
          var tk = pending[i], w = walk(tk.poi);
          var back = (nextPoi && nextPoi !== tk.poi) ? Math.round(travel(tk.poi, nextPoi) / 60) : 0;
          var a = Math.max(cursor, tk.win ? tk.win[0] : cursor);
          var cap = limitAt - back + 10;
          var b = Math.min(cap, tk.win ? tk.win[1] : cap);
          if (a + tk.dur + w <= b || a + tk.dur + w <= cap) {
            var note = (tk.note || "") + (a + tk.dur + w <= b ? "" : "（不在偏好时段，已顺延）");
            put({ kind: "task", title: tk.name, poi: tk.poi, at: a, dur: tk.dur, note: note });
            tk.done = true; pending.splice(i, 1); placed = true; break;
          }
        }
        if (placed) continue;
        /* 选一个"划算的"自习点：主据点优先，但如果刚吃完饭、来回折腾时间太长，
           改用就近的备用自习点（图书馆/铸剑楼），不为了科研再跑回西北角 */
        var rp = P.researchPoi;
        var wMain = walk(rp);
        var bMain = (nextPoi && nextPoi !== rp) ? Math.round(travel(rp, nextPoi) / 60) : 0;
        var mainCost = wMain + bMain - 6;              // 主据点有 6 分钟偏好补贴
        /* 只有"刚吃完午饭/晚饭"这种情况才考虑换就近自习点；
           早上出门、课间这些场景仍然回主据点（未来警务学院） */
        /* 往回找最近一段：如果是午/晚饭（允许中间夹一段午休），就算"刚吃完饭"；
           一旦碰上科研/任务/上课，说明已经不是"刚吃完"的语境了 */
        var afterMainMeal = false;
        for (var bk = segs.length - 1; bk >= 0 && bk >= segs.length - 3; bk--) {
          var sg2 = segs[bk];
          if (sg2.kind === "research" || sg2.kind === "task" || sg2.kind === "class") break;
          if (sg2.kind === "meal" && /^(午饭|晚饭)/.test(sg2.title)) { afterMainMeal = true; break; }
        }
        if (afterMainMeal && mainCost > 12) {
          var bestAlt = null;
          (P.altStudyPois || []).forEach(function (id) {
            if (!(cfg.pois || {})[id] || id === rp) return;
            var c = walk(id) + ((nextPoi && nextPoi !== id) ? Math.round(travel(id, nextPoi) / 60) : 0);
            if (!bestAlt || c < bestAlt.c) bestAlt = { id: id, c: c };
          });
          if (bestAlt && bestAlt.c < mainCost) rp = bestAlt.id;
        }
        var wR = walk(rp);
        var backR = (nextPoi && nextPoi !== rp) ? Math.round(travel(rp, nextPoi) / 60) : 0;
        var room = limitAt - backR - (cursor + wR);
        if (room >= 30) {
          put({ kind: "research", title: "科研 / 计算机学习" + (rp !== P.researchPoi ? "（就近）" : ""),
                poi: rp, at: cursor + wR, dur: Math.min(room, 180), note: "整块时间，建议断网 + 番茄钟" });
          continue;
        }
        break;
      }
    }

    anchors.forEach(function (a) {
      fillUntil(a.at || cursor, a.poi, a.noWalk);
      put(a);
    });
    (cfg.tasks || []).forEach(function (tk) {
      if (!tk.done) {
        var free = 0, prev = null;
        segs.forEach(function (sg) { if (prev !== null && sg.start - prev > free) free = sg.start - prev; prev = sg.end; });
        warn.push({ level: "danger",
          text: "「" + tk.name + "」需要 " + tk.dur + " 分钟整块，今天最长空档只有 " + free +
                " 分钟（还要减去步行）：建议缩短到 " + Math.max(20, free - 25) + " 分钟，或挪到别的日子" });
      }
    });

    /* 晚饭硬窗口校验：17:30-18:15 内吃不到，就不吃（按你的规则），并说明原因 */
    var d0 = m(R.dinnerWindow[0]), d1 = m(R.dinnerWindow[1]);
    var dIdx = -1;
    segs.forEach(function (sg, i) { if (dIdx < 0 && sg.title.indexOf("晚饭") === 0) dIdx = i; });
    var dinnerInfo = { ok: false, at: null, reason: "" };
    if (dIdx >= 0) {
      var dseg = segs[dIdx];
      if (dseg.start >= d0 - 2 && dseg.end <= d1 + 3) {
        dinnerInfo.ok = true; dinnerInfo.at = dseg.start;
      } else {
        dinnerInfo.reason = "晚饭窗口被占（" + hhmm(dseg.start) + " 才能吃上）";
        segs.splice(dIdx, 1);
        warn.push({ level: "warn",
          text: "今天没排晚饭：17:30-18:15 被课程/洗澡占住了。按你的规则就不吃，建议下午备点坚果/酸奶垫一下" });
      }
    }

    /* 汇总 */
    segs.sort(function (x, y) { return x.start - y.start; });
    for (var i2 = segs.length - 1; i2 > 0; i2--) {
      var b1 = segs[i2], b0 = segs[i2 - 1];
      if (b0.kind === "research" && b1.kind === "research" && b0.poi === b1.poi && b1.start - b0.end <= 2) {
        b0.end = b1.end; segs.splice(i2, 1);
      }
    }
    var shSeg = segs.filter(function (x) { return x.kind === "shower"; })[0];
    if (shSeg && shSeg.end > m("21:40")) {
      segs.forEach(function (x) { if (x.kind === "routine" && x.title === "洗漱") { x.title = "简单洗漱"; x.end = x.start + 5; } });
    }
    var rMin = 0, longest = 0, cur2 = 0, prevEnd = null, blocks = [];
    segs.forEach(function (s) {
      if (s.kind === "research") {
        rMin += s.end - s.start;
        cur2 = (prevEnd != null && s.start - prevEnd <= 6) ? cur2 + (s.end - s.start) : (s.end - s.start);
        longest = Math.max(longest, cur2);
        blocks.push([s.start, s.end]);
      } else cur2 = 0;
      prevEnd = s.end;
    });
    var walkMin = segs.reduce(function (x, s) { return x + (s.walkMin || 0); }, 0);
    var lunch = segs.filter(function (s) { return s.title.indexOf("午饭") === 0; })[0];
    if (lunch && lunch.start >= m("12:30")) warn.push({ level: "danger", text: "午饭 " + hhmm(lunch.start) + " 才开始，下午第一节会赶不上" });
    else if (lunch && lunch.start >= m("12:15")) warn.push({ level: "warn", text: "午饭偏晚（" + hhmm(lunch.start) + "），午休被压缩" });
    var lights = segs.filter(function (s) { return s.title === "熄灯"; })[0];
    if (lights && lights.start > m(S.routine.lightsOut) + 10) warn.push({ level: "danger", text: "已经排到熄灯之后（" + hhmm(lights.start) + "），这天太满了" });
    var sh = shSeg;
    if (choice.shower && !sh) warn.push({ level: "warn", text: "今天没能安排洗澡" });
    if (sh && !showerOk(S, day, sh.start)) warn.push({ level: "warn", text: "洗澡时段可能撞内务检查，注意别把盆留在外面" });

    return {
      segs: segs, warnings: warn, suggestions: tips,
      now: nowMin, atPoi: (nowMin != null) ? (cfg.atPoi || dorm) : null, dynamic: nowMin != null,
      stats: {
        researchMin: rMin, longestResearch: longest, walkMin: walkMin, researchBlocks: blocks.length,
        lunchPlace: choice.lunchName, lunchTime: lunch ? hhmm(lunch.start) : "-",
        showerAt: sh ? hhmm(sh.start) : "未安排", classes: cs.length, dinnerPlace: choice.dinnerName,
        dinnerAt: dinnerInfo.ok ? hhmm(dinnerInfo.at) : "无",
        lateStudy: lateSeg ? hhmm(lateSeg.start) + "–" + hhmm(lateSeg.end) : "无"
      }
    };
  }

  /* ---------------- 候选枚举 ---------------- */
  function planDay(cfg) {
    var S = cfg.S, P = cfg.prefs || S.prefs, day = cfg.weekday;
    var pois = cfg.pois || {}, travel = cfg.travel, list = cfg.poiList || [];
    function q(id) { return (pois[id] || {}).name || id; }
    function nearest(ids, from) {
      var best = null;
      ids.forEach(function (id) {
        if (!pois[id]) return;
        var s = travel(from, id) / 60;
        if (!best || s < best.s) best = { id: id, s: s, name: q(id) };
      });
      return best;
    }
    var avoid = P.avoidMealPois || [];
    var canteens = list.filter(function (p) { return p.cat === "food" && avoid.indexOf(p.id) < 0; })
                       .map(function (p) { return p.id; });
    var bf = nearest(canteens, cfg.dormPoi) || { id: "U16", name: "一食堂" };

    var lunchCands = [];
    (P.lunchPreferPois || []).forEach(function (id) {
      if (pois[id] && avoid.indexOf(id) < 0) lunchCands.push({ poi: id, name: q(id), kind: "canteen" });
    });
    /* 超市只作为"实在来不及"的兜底，默认不进正餐候选（你几乎只在食堂/外卖里选） */
    /* 外卖：去图书馆前取餐、带回自习点吃；自习点离得远时步行代价会让它自然落选 */
    if (P.takeoutPoi && pois[P.takeoutPoi]) {
      var tkAccess = travel(P.researchPoi, P.takeoutPoi) / 60;
      if (tkAccess <= (P.takeoutMaxAccess || 6)) {
        lunchCands.push({ poi: P.takeoutPoi, name: "外卖（图书馆前）", kind: "takeout" });
      }
    }
    if (!lunchCands.length) lunchCands.push({ poi: "U16", name: "一食堂", kind: "canteen" });

    var slots = [];
    if (day >= 1 && day <= 5) [m("17:10"), m("17:40"), m("20:30"), m("21:00")].forEach(function (s) { slots.push({ start: s }); });
    else if (day === 7) [m("08:30"), m("11:00"), m("14:00"), m("20:30")].forEach(function (s) { slots.push({ start: s }); });
    else [m("09:00"), m("11:00"), m("15:00"), m("21:00")].forEach(function (s) { slots.push({ start: s }); });
    /* 从"现在"起排时，已经过去的洗澡时段直接不要（否则会选一个早已错过的点，然后没洗澡） */
    if (cfg.now != null) {
      var alive = slots.filter(function (x) { return x.start >= cfg.now; });
      if (alive.length) slots = alive;
      else slots = [{ start: cfg.now + 10 }];
    }

    var W = Object.assign({ research: 1, meal: 1, walk: 1, shower: 1 }, cfg.weights || {});
    var best = null, scored = [];
    lunchCands.forEach(function (lc) {
      slots.forEach(function (sh) {
        [false, true].forEach(function (parcel) {
          [false, true].forEach(function (dinnerAfter) {
            var choice = { lunchPoi: lc.poi, lunchName: lc.name, lunchKind: lc.kind,
                           dinnerPoi: lc.poi, dinnerName: lc.name, dinnerKind: lc.kind,
                           bfPoi: bf.id, bfName: bf.name, shower: sh, parcel: parcel, dinnerAfter: dinnerAfter };
            var localCfg = Object.assign({}, cfg, {
              tasks: (cfg.tasks || []).map(function (t) { return Object.assign({}, t); })
            });
            var r = buildDay(localCfg, choice);
            var placed = (localCfg.tasks || []).filter(function (t) { return t.done; }).length;
            var all = (localCfg.tasks || []).length;
            var sc = placed * 35 - (all - placed) * 70
                   + W.research * (r.stats.longestResearch * 2.2 + r.stats.researchMin * 0.8)
                   - W.walk * r.stats.walkMin * 1.2
                   - (lc.kind === "store" ? 25 * W.meal : 0)
                   + ((P.mealBias || {})[lc.poi] || 0) * W.meal
                   - r.warnings.filter(function (w) { return w.level === "danger"; }).length * 400
                   - r.warnings.filter(function (w) { return w.level === "warn"; }).length * 25
                   - r.warnings.filter(function (w) { return w.level === "info"; }).length * 3;
            if (r.stats.showerAt === "未安排") sc -= 40 * W.shower;
            if (r.stats.dinnerAt === "无") sc -= 45 * W.meal;
            if (cfg.debugScores) scored.push({ kind: lc.kind, poi: lc.poi, lunch: P ? 0 : 0,
              shower: hhmm(sh.start), parcel: parcel, score: Math.round(sc),
              research: r.stats.researchMin, longest: r.stats.longestResearch, walk: r.stats.walkMin });
            if (!best || sc > best.sc) best = { sc: sc, choice: choice, res: r };
          });
        });
      });
    });
    var out = best.res;
    out.day = day; out.week = cfg.week || 1; out.weekdayName = DAY[day];
    out.choice = best.choice; out.score = Math.round(best.sc);
    if (cfg.debugScores) { scored.sort(function (a, b) { return b.score - a.score; }); out.debugScores = scored; }
    return out;
  }

  /* ---------------- 跨天 ---------------- */
  function planRange(cfg, opts) {
    opts = opts || {};
    var n = opts.days || 7, start = cfg.weekday || 1, week0 = cfg.week || 1, out = [];
    for (var i = 0; i < n; i++) {
      var abs = (start - 1) + i;
      var d = (abs % 7) + 1, w = week0 + Math.floor(abs / 7), r;
      try { r = planDay(Object.assign({}, cfg, { weekday: d, week: w, now: null, atPoi: cfg.dormPoi })); }
      catch (e) { continue; }
      out.push({
        day: d, week: w, name: DAY[d],
        researchMin: r.stats.researchMin, longest: r.stats.longestResearch,
        walkMin: r.stats.walkMin, classes: r.stats.classes, showerAt: r.stats.showerAt,
        dangers: r.warnings.filter(function (x) { return x.level === "danger"; }).length,
        plan: r
      });
    }
    return out;
  }

  function bestDayForTask(cfg, task, opts) {
    opts = opts || {};
    var start = cfg.weekday || 1, week0 = cfg.week || 1, out = [];
    for (var i = 0; i < (opts.days || 7); i++) {
      var abs = (start - 1) + i;
      var d = (abs % 7) + 1, w = week0 + Math.floor(abs / 7), r;
      try {
        r = planDay(Object.assign({}, cfg, {
          weekday: d, week: w, now: null, atPoi: cfg.dormPoi,
          tasks: [{ name: task.name, poi: task.poi, dur: task.dur, win: task.win || null, soft: true }]
        }));
      } catch (e) { continue; }
      var seg = r.segs.filter(function (s) { return s.kind === "task" && s.title === task.name; })[0];
      out.push({ day: d, name: DAY[d], week: w, feasible: !!seg, at: seg ? seg.start : null,
                 researchMin: r.stats.researchMin });
    }
    return out;
  }

  var api = { planDay: planDay, buildDay: buildDay, coursesOf: coursesOf, dormOpen: dormOpen,
              planRange: planRange, bestDayForTask: bestDayForTask,
              m: m, hhmm: hhmm, DAY: DAY };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.CampusPlanner = api;
})(typeof window !== "undefined" ? window : globalThis);
