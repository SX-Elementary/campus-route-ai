/* route/runtime.js —— 动态重排运行时
 * 关键点：
 *   1) 所有规划都以"现在"为起点（planner 的 now/atPoi），不是从 06:00 静态展开
 *   2) 步行时间做缓存（POI→POI 只算一次），重排从 ~100ms 降到 ~10ms 量级
 *   3) 触发条件：时间推进到当前事项结束 / 任务变化 / 地点变化 / 手动
 *   4) 预留 API 适配层：外部模型只能"给约束和建议"，排程仍由本地引擎算（可复现、不会编时间）
 */
(function (root) {
  "use strict";
  var C, PL, SCH, D, graph = null;
  var cache = Object.create(null);
  var listeners = [];
  var api = null;
  var timer = null, lastPlan = null, lastReplanAt = 0, lastDate = null;

  /* ---------- 模型建议的边界（审计 F05） ----------
     · 只有"用户发起的变更"才去问模型；api-apply / 定时 tick 一律不问，避免回路
     · 同一时刻只允许一个请求在飞，过期响应直接丢弃
     · 约束没变化就不重排（幂等）
     · 应用次数与频率都有上限 */
  var ADVISE_REASONS = ["init", "manual", "tasks", "dorm", "week", "day", "location",
                        "team-mode", "study-poi", "chores", "hygiene"];
  var MAX_APPLIES = 5;             // 单次会话最多应用 5 次模型约束
  var MIN_ADVISE_GAP = 5000;       // 两次问模型至少间隔 5 秒
  var adviseSeq = 0, adviseInFlight = false, adviseApplies = 0, lastAdviseAt = 0, adviseCalls = 0;

  function normObj(o) {
    if (!o || typeof o !== "object") return "{}";
    return JSON.stringify(Object.keys(o).sort().reduce(function (a, k) { a[k] = o[k]; return a; }, {}));
  }
  function sameConstraints(w, b) {
    return normObj(w) === normObj(state.weights) &&
           JSON.stringify(b || []) === JSON.stringify(state.blocks || []);
  }
  function canAdvise() {
    return ADVISE_REASONS.indexOf(state.lastReason) >= 0 &&
           !adviseInFlight &&
           (Date.now() - lastAdviseAt) >= MIN_ADVISE_GAP;
  }
  var state = {
    day: null, week: null, dorm: "D12", now: null, atPoi: null, teamMode: "observe", studyPoi: null, chores: [], hygiene: null, assumeArrived: false,
    tasks: [], auto: true, lastReason: "init",
    weights: null, blocks: null
  };

  function nowMin() { var d = new Date(); return d.getHours() * 60 + d.getMinutes(); }
  function todayDow() { return new Date().getDay() || 7; }
  function todayStr() {
    var d = new Date();
    return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
  }
  /* 只有"看今天"时才从当前时刻起排；看别的日子一律从 06:00 排整天 */
  /* 学期第几周（用于判断"选的是不是真的今天"） */
  function semesterWeek() {
    var start = (root.SCHEDULE && root.SCHEDULE.semesterStart) || "2026-09-07";
    var t0 = new Date(start + "T00:00:00");
    var now = new Date(); now.setHours(0, 0, 0, 0);
    return Math.floor((now - t0) / 604800000) + 1;
  }
  /* 只有"星期几 + 周次"都对上，才算今天；否则一律按"未来/过去的某天"从头排 */
  function isToday() {
    return state.day === todayDow() && (Number(state.week) || 0) === semesterWeek();
  }
  function ms() { return (root.performance && root.performance.now) ? root.performance.now() : Date.now(); }

  function travel(a, b) {
    if (!a || !b || a === b) return 0;
    var k = a + ">" + b;
    if (cache[k] != null) return cache[k];
    var r = C.routeBetween(graph, a, b, SCH.prefs.walkSpeed);
    var sec = r ? r.walk_s : 3600;
    cache[k] = sec; cache[b + ">" + a] = sec;
    return sec;
  }

  function init(opt) {
    C = root.CampusCore; PL = root.CampusPlanner; SCH = root.SCHEDULE; D = root.CAMPUS;
    if (!C || !PL || !SCH || !D) return false;
    graph = (opt && opt.graph) || C.buildGraph(D.roads, D.pois);
    state.dorm = (opt && opt.dorm) || state.dorm;
    state.day = (opt && opt.day) || todayDow();
    state.week = (opt && opt.week) || state.week || 7;
    state.atPoi = (opt && opt.atPoi) || state.dorm;
    state.now = nowMin();
    lastDate = todayStr();
    if (timer) clearInterval(timer);
    timer = setInterval(tick, 15000);
    return true;
  }

  function context() {
    return {
      now: state.now, nowText: PL.hhmm(state.now), weekday: state.day, week: state.week,
      dorm: state.dorm, atPoi: state.atPoi, tasks: state.tasks,
      plan: lastPlan ? {
        researchMin: lastPlan.stats.researchMin,
        segments: lastPlan.segs.map(function (s) {
          return { title: s.title, poi: s.poi, start: PL.hhmm(s.start), end: PL.hhmm(s.end), kind: s.kind };
        }),
        warnings: lastPlan.warnings
      } : null
    };
  }

  function replan(reason) {
    if (!PL) return null;
    var nowTs = Date.now();
    var auto = (reason === "segment-end" || reason === "next-slot" || reason === "date-roll");
    if (auto && nowTs - lastReplanAt < 45000) return lastPlan;   // 自动触发的节流
    lastReplanAt = nowTs;
    var t0 = ms();
    state.now = nowMin();
    state.lastReason = reason || "manual";
    var today = isToday();
    var p = PL.planDay({
      S: SCH, weekday: state.day, week: state.week, dormPoi: state.dorm,
      travel: travel, pois: map(1), poiList: D.pois, tasks: state.tasks,
      now: today ? state.now : null,
      atPoi: today ? state.atPoi : state.dorm,
      teamMode: state.teamMode,
      assumeArrived: state.assumeArrived,
      chores: state.chores,
      hygiene: state.hygiene,
      prefs: Object.assign({}, SCH.prefs, state.studyPoi ? { researchPoi: state.studyPoi } : {}),
      weights: state.weights || undefined, blocks: state.blocks || undefined
    });
    p.week = state.week;
    p.meta = {
      engine: "local", reason: state.lastReason,
      ms: +(ms() - t0).toFixed(1), at: new Date().toISOString(),
      now: today ? state.now : null, atPoi: today ? state.atPoi : state.dorm,
      today: today, date: todayStr()
    };
    p.geo = geoOf(p);
    lastPlan = p;
    emit(p);
    if (api && typeof api.advise === "function" && canAdvise()) {
      var mySeq = ++adviseSeq;
      adviseCalls++;
      adviseInFlight = true;
      lastAdviseAt = Date.now();
      p.meta.adviceCalls = adviseCalls;
      api.advise(context()).then(function (adv) {
        adviseInFlight = false;
        if (mySeq !== adviseSeq) return;                 // 过期响应：丢弃，不污染新计划
        if (adv && adv.advice) { p.advice = adv.advice; p.meta.advice = true; emit(p); }
        if (!adv || (!adv.weights && !adv.blocks)) return;
        if (sameConstraints(adv.weights, adv.blocks)) {   // 幂等：没变化就什么都不做
          p.meta.adviceNoChange = true;
          emit(p);
          return;
        }
        if (adviseApplies >= MAX_APPLIES) {
          p.meta.adviceSkipped = "已达本次会话上限（" + MAX_APPLIES + "）";
          emit(p);
          return;
        }
        adviseApplies++;
        state.weights = adv.weights || state.weights;
        state.blocks = adv.blocks || state.blocks;
        var p2 = replan("api-apply");                    // 只重算一次；api-apply 不再触发建议
        if (p2 && p2.meta) {
          p2.meta.engine = "local+api";
          p2.meta.apiApplied = true;
          p2.meta.adviceApplies = adviseApplies;
        }
      }).catch(function (e) {
        adviseInFlight = false;
        if (mySeq !== adviceSeq) return;
        p.meta.apiError = String(e && e.message || e).slice(0, 120);
        emit(p);
      });
    }
    return p;
  }

  function gasOf() { return null; }
  function map(unused) {
    var m = {};
    D.pois.forEach(function (p) { m[p.id] = p; });
    return m;
  }
  function geoOf(p) {
    var out = [], seq = [];
    p.segs.forEach(function (s) {
      if (!s.poi) return;
      if (seq[seq.length - 1] !== s.poi) seq.push(s.poi);
    });
    for (var i = 1; i < seq.length; i++) {
      var r = C.routeBetween(graph, seq[i - 1], seq[i], SCH.prefs.walkSpeed);
      if (r && r.pts && r.pts.length > 1) out.push(r.pts);
    }
    return out;
  }

  function currentSeg() {
    if (!lastPlan) return null;
    var n = nowMin();
    for (var i = 0; i < lastPlan.segs.length; i++) {
      var s = lastPlan.segs[i];
      if (s.start <= n && n < s.end) return s;
    }
    return null;
  }
  function tick() {
    if (lastDate && lastDate !== todayStr()) {          // 跨天：日期变了
      lastDate = todayStr();
      state.day = todayDow();
      state.atPoi = state.dorm;
      replan("date-roll");
      return;
    }
    lastDate = todayStr();
    var before = state.now;
    state.now = nowMin();
    var cur = currentSeg();
    if (state.auto && lastPlan) {
      if (before != null && state.now < before) { replan("date-roll"); return; }      // 跨天/跨零点
      if (!cur) { replan("next-slot"); return; }                                       // 当前段已结束
      if (cur.end - state.now <= 1) { replan("segment-end"); return; }
    }
    emit(lastPlan, true);                                                              // 只更新"现在"线
  }
  function emit(p, soft) {
    listeners.forEach(function (fn) { try { fn(p, !!soft); } catch (e) { console.error(e); } });
  }

  var apiMethods = {
    init: init,
    replan: replan,
    tick: tick,
    onPlan: function (fn) { listeners.push(fn); return function () { listeners = listeners.filter(function (f) { return f !== fn; }); }; },
    setTasks: function (tasks) { state.tasks = tasks || []; return replan("tasks"); },
    setDay: function (d) { state.day = d; return replan("day"); },
    setWeek: function (w) { state.week = w; return replan("week"); },
    setDorm: function (d) { state.dorm = d; state.atPoi = d; return replan("dorm"); },
    setTeamMode: function (m) { state.teamMode = m || "observe"; return replan("team-mode"); },
    setStudyPoi: function (id) { state.studyPoi = id || null; return replan("study-poi"); },
    adviceStats: function () {
    return { calls: adviseCalls, applies: adviseApplies, inFlight: adviseInFlight, max: MAX_APPLIES };
  },
  resetAdvice: function () { adviseApplies = 0; adviseCalls = 0; adviseSeq++; adviseInFlight = false; lastAdviseAt = 0; },
  setChores: function (list) { state.chores = Array.isArray(list) ? list : []; return replan("chores"); },
    setHygiene: function (h) { state.hygiene = h || null; return replan("hygiene"); },
    getStudyPoi: function () { return state.studyPoi; },
    getTeamMode: function () { return state.teamMode; },
    setLocation: function (poi) { state.atPoi = poi; return replan("location"); },
    setAuto: function (v) { state.auto = !!v; },
    useAPI: function (adapter) { api = adapter; },
    getPlan: function () { return lastPlan; },
    getState: function () { return state; },
    context: context,
    currentSeg: currentSeg,
    travel: travel,
    _cacheSize: function () { return Object.keys(cache).length; }
  };
  root.PlanRuntime = apiMethods;
})(typeof window !== "undefined" ? window : globalThis);
