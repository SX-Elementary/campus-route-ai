/* route/view.js —— 「今日路线」动态视图
 * 依赖：route/{data,core,schedule,planner,runtime,llm}.js
 * 交互：重排 / 我在这里 / 一句话加事项 / API 设置；每 15 秒刷新"现在"线，事项结束自动重排
 */
(function () {
  "use strict";
  var WB_KEY = "personal-research-workbench-v2";
  var DAY = ["", "周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  var SLOT_WIN = { morning: [480, 720], noon: [700, 840], afternoon: [840, 1080], night: [1110, 1350] };
  var C, PL, SCH, D, RT, LLM;
  var plan = null, imgMap = null, imgSat = null, layer = "map";
  var canvas, ctx, W = 0, H = 0, dpr = 1;
  var view = { cx: 1200, cy: 560, scale: 0.6 };
  var booted = false, autoFollow = true, userMoved = false, lastPlanKey = "";

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]; }); }
  function hhmm(x) { x = Math.round(x); return ("0" + Math.floor(x / 60)).slice(-2) + ":" + ("0" + (x % 60)).slice(-2); }
  function todayKey() { var d = new Date(); return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2); }
  function nowMin() { var d = new Date(); return d.getHours() * 60 + d.getMinutes(); }
  function fmt(min) { var h = Math.floor(min / 60), m = min % 60; return h ? h + " 小时" + (m ? " " + m + " 分" : "") : m + " 分钟"; }

  function loadWB() { try { return JSON.parse(localStorage.getItem(WB_KEY) || "[]") || []; } catch (e) { return []; } }
  function guessPoi(t) {
    var s = (t.title || "") + " " + (t.project || "");
    if (/乒乓|球馆|网球|排球|训练|运动|跑|力量|健身/.test(s)) return "U24";
    if (/快递|取件|寄件/.test(s)) return "U4";
    if (/超市|购物|买/.test(s)) return "U11";
    if (/医院|医务|看病/.test(s)) return "U13";
    if (/洗澡|澡堂/.test(s)) return "U3";
    if (/吃饭|食堂|午饭|晚饭|早饭|餐/.test(s)) return "U16";
    if (/图书馆|文献|阅读|论文|综述/.test(s)) return "B1";
    if (/课|上课/.test(s)) return "B2";
    if (/宿舍|休息|午休/.test(s)) return "D12";
    return "U26";
  }
  function plannerTasks() {
    var tk = todayKey(), out = [];
    loadWB().forEach(function (t) {
      if (!t || t.status === "done") return;
      if (t.dueDate && t.dueDate > tk) return;
      var incDelayed = document.getElementById("route-include-delayed");
      if (incDelayed && !incDelayed.checked && t.dueDate && t.dueDate < tk) return;   // 不含延期任务
      var appt = t.appointment && t.appointment.start != null ? t.appointment : null;
      out.push({
        id: t.id, name: t.title, poi: t.place || guessPoi(t),
        dur: Math.max(10, Math.min(120, t.estimate || 45)),
        win: appt ? [appt.start, appt.end != null ? appt.end : appt.start + 30] : (SLOT_WIN[t.slot] || null),
        soft: !appt,                              // 有确切预约 → 硬窗口，不做软偏好
        note: t.project || (appt ? "预约" : "")
      });
    });
    return out;
  }

  /* ---------- 渲染 ---------- */
  var KIND_COLOR = { class: "#2f6fed", assembly: "#8b5cf6", meal: "#f59e0b", shower: "#06b6d4", research: "#16a34a", task: "#d97706", routine: "#94a3b8", rest: "#94a3b8" };
  function render(p, soft) {
    if (!p) return;
    plan = p;
    var meta = p.meta || {};
    var REASON = { init: "启动", tasks: "任务变化", day: "换天", week: "换周", dorm: "换宿舍",
                   location: "位置变化", manual: "手动重排", "segment-end": "上一段结束",
                   "next-slot": "空档提醒", "date-roll": "跨天" };
    $("route-badge").textContent = (meta.today === false ? "非今天 · " : "") +
      (meta.engine === "local+api" ? "模型参与" : "本地引擎") +
      " · " + (meta.ms != null ? meta.ms + "ms" : "—") +
      " · " + hhmm(meta.now != null ? meta.now : nowMin()) +
      " 重排" + (meta.reason ? " · " + (REASON[meta.reason] || meta.reason) : "");

    $("route-stats").innerHTML =
      ((p.meta && p.meta.today === false) ? "全天 · " : "现在 <b>" + hhmm(p.now != null ? p.now : nowMin()) + "</b> · ") + "科研 <b>" + fmt(p.stats.researchMin) +
      "</b>（最长 " + fmt(p.stats.longestResearch) + "）· 步行 " + p.stats.walkMin + " 分钟 · 午饭 " +
      p.stats.lunchTime + " @" + esc(p.stats.lunchPlace) + " · 洗澡 " + p.stats.showerAt;

    /* 到场确认：当前这段是课/集合，但位置对不上 → 让用户一句话说清 */
    (function () {
      var box = $("route-arrive");
      if (!box) return;
      var nowm = (p.now != null) ? p.now : nowMin();
      var segsAll = p.segs || [];
      /* 正在进行的这段，或者 20 分钟内要开始的这段 */
      var cur = segsAll.filter(function (s) { return s.start <= nowm && s.end > nowm; })[0] ||
                segsAll.filter(function (s) { return s.start > nowm && s.start <= nowm + 20; })[0];
      var need = cur && (cur.kind === "class" || cur.kind === "assembly") && p.atPoi && cur.poi && cur.poi !== p.atPoi;
      if (!need) { box.hidden = true; box.innerHTML = ""; return; }
      box.hidden = false;
      var when = (cur.start <= nowm) ? "正在进行" : hhmm(cur.start) + " 开始";
      box.innerHTML = '<span>「' + esc(cur.title.replace("（进行中）", "")) + "」" + when + "，地点 " +
        esc(poiLabelOf(cur.poi)) + "；你现在标的还是 " + esc(poiLabelOf(p.atPoi)) + "</span>" +
        '<button type="button" class="ghost small" id="route-arrive-yes">我已在教室</button>' +
        '<button type="button" class="primary small" id="route-arrive-no">还在路上</button>';
      $("route-arrive-yes").onclick = function () {
        RT.setLocation(cur.poi);
        RT.setAssumeArrived(true);
        try { document.getElementById("route-loc").value = cur.poi; } catch (e) {}
      };
      $("route-arrive-no").onclick = function () { RT.setAssumeArrived(false); };
    })();

    var delayed = (loadWB() || []).filter(function (t) {
      return t && t.status !== "done" && t.delayCount > 0 && (!t.dueDate || t.dueDate <= todayKey());
    });
    $("route-warn").innerHTML = (delayed.length
      ? '<div style="color:#d97706">· 含 ' + delayed.length + " 件延期任务（来自之前日期，已顺延到今天：" +
        delayed.slice(0, 3).map(function (t) { return esc(t.title) + "×" + t.delayCount; }).join("、") + "）</div>"
      : "") + (p.warnings.length
      ? p.warnings.map(function (w) {
          var c = w.level === "danger" ? "#dc2626" : (w.level === "warn" ? "#d97706" : "#94a3b8");
          return '<div style="color:' + c + '">' + (w.level === "danger" ? "⛔ " : w.level === "warn" ? "⚠ " : "· ") + esc(w.text) + "</div>";
        }).join("")
      : '<div style="color:#16a34a">✓ 从此刻出发没有硬冲突</div>') +
      ((p.suggestions && p.suggestions.length)
        ? p.suggestions.map(function (t) {
            return '<div style="color:#0369a1;margin-top:2px">💡 ' + hhmm(t.at) + "–" + hhmm(t.end) + " " + esc(t.text) + "</div>";
          }).join("")
        : "");

    /* 排不进去的任务：算一下未来 7 天哪一天最合适（只在手动重排时算，避免拖慢 tick） */
    var st = RT.getState();
    var unplaced = (st.tasks || []).filter(function (t) {
      return !p.segs.some(function (sg) { return sg.kind === "task" && sg.title === t.name; });
    });
    if (unplaced.length && (meta.reason === "manual" || meta.reason === "tasks" || meta.reason === "api-apply")) {
      var hints = [];
      unplaced.slice(0, 2).forEach(function (t) {
        var best = (PL.bestDayForTask({
          S: SCH, weekday: st.day, week: st.week, dormPoi: st.dorm,
          travel: RT.travel, pois: (function () { var m = {}; D.pois.forEach(function (x) { m[x.id] = x; }); return m; })(),
          poiList: D.pois, tasks: []
        }, { name: t.name, poi: t.poi, dur: t.dur, win: t.win }, { days: 7 }) || [])
          .filter(function (x) { return x.feasible; })
          .sort(function (a, b) { return b.researchMin - a.researchMin; })[0];
        if (best) hints.push("「" + t.name + "」→ 建议放 " + best.name + "（第 " + best.week + " 周）" +
          (best.at != null ? " " + hhmm(best.at) : "") + "，那天还有 " + Math.round(best.researchMin) + " 分钟科研");
      });
      if (hints.length) p._hints = hints;
    }
    $("route-advice").innerHTML =
      (p._hints || []).map(function (h) { return '<div class="route-hint">↪ ' + esc(h) + "</div>"; }).join("") +
      (p.advice ? '<div class="route-advice-box">💡 ' + esc(p.advice) + "</div>" : "") +
      (meta.apiError ? '<div class="route-advice-err">模型未生效：' + esc(meta.apiError) + "</div>" : "");

    var nowLine = hhmm(p.now != null ? p.now : nowMin());
    $("route-timeline").innerHTML = (p.segs || []).map(function (s) {
      var c = KIND_COLOR[s.kind] || "#94a3b8";
      var past = s.end <= (p.now != null ? p.now : nowMin());
      var active = s.start <= (p.now != null ? p.now : nowMin()) && s.end > (p.now != null ? p.now : nowMin());
      var poiName = (D.pois.filter(function (x) { return x.id === s.poi; })[0] || {}).name || "";
      return '<div class="rt-item' + (past ? " rt-past" : "") + (active ? " rt-active" : "") + '" style="border-left-color:' + c + '">' +
        '<span class="rt-time">' + hhmm(s.start) + "–" + hhmm(s.end) + "</span>" +
        '<span class="rt-title">' +
          (s.choreId ? '<input type="checkbox" class="rt-chore-box" data-chore="' + esc(s.choreId) + '" title="做完就勾掉" />' : "") +
          esc(s.title) + (s.place ? " <em>（" + esc(s.place) + "）</em>" : "") + "</span>" +
        '<span class="rt-poi">' + esc(poiName) + (s.walkMin ? " · 走" + s.walkMin + " 分" : "") + "</span>" +
        (s.note ? '<span class="rt-note">' + esc(s.note) + "</span>" : "") + "</div>";
    }).join("");

    /* 时间轴上的家务勾选框 */
    $("route-timeline").querySelectorAll("input.rt-chore-box").forEach(function (box) {
      box.onchange = function () {
        if (!window.PlanChores) return;
        PlanChores.toggle(box.dataset.chore);
        renderChores();
        pushChoresToRuntime();
      };
    });

    /* 今日任务 → 地点 */
    var tasks = loadWB().filter(function (t) { return t && t.status !== "done" && (!t.dueDate || t.dueDate <= todayKey()); });
    var opts = D.pois.map(function (x) { return '<option value="' + x.id + '">' + esc(x.name) + "</option>"; }).join("");
    $("route-tasks").innerHTML = tasks.length ? tasks.map(function (t) {
      return '<div class="rt-task"><div class="rt-task-t">' + esc(t.title) + "<small>" + esc(t.project || "") +
        (t.slot ? " · " + ({ morning: "上午", noon: "中午", afternoon: "下午", night: "晚上" }[t.slot] || "") : "") +
        " · " + (t.estimate || 45) + " 分钟</small></div>" +
        '<select data-task-place="' + t.id + '">' + opts + "</select></div>";
    }).join("") : '<div class="rt-empty">看板里今天没有待办任务</div>';
    $("route-tasks").querySelectorAll("select[data-task-place]").forEach(function (sel) {
      var t = tasks.filter(function (x) { return String(x.id) === sel.dataset.taskPlace; })[0];
      sel.value = (t && t.place) || guessPoi(t || {});
      sel.onchange = function () {
        window.dispatchEvent(new CustomEvent("workbench-set-task-place", { detail: { id: sel.dataset.taskPlace, place: sel.value } }));
        RT.setTasks(plannerTasks());
      };
    });

    var isToday = !(meta && meta.today === false);
    $("route-day-label").textContent = DAY[+$("route-day").value] + " · 第 " + p.week + " 周 · " +
      (isToday ? hhmm(p.now != null ? p.now : nowMin()) + " 起" : "全天（从 06:00 排）");
    var key = (p.meta && p.meta.at) + "|" + (p.geo ? p.geo.length : 0);
    if (!soft) {
      if (key !== lastPlanKey) {
        lastPlanKey = key;
        if (autoFollow && !userMoved) { resize(); fitToPlan(); }
      }
      draw();
    }
  }

  /* ---------- 画布 ---------- */
  function resize() {
    if (!canvas) return;
    dpr = window.devicePixelRatio || 1;
    W = canvas.clientWidth || 800; H = canvas.clientHeight || 620;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function sx(x) { return (x - view.cx) * view.scale + W / 2; }
  function sy(y) { return (y - view.cy) * view.scale + H / 2; }
  function ix(x) { return (x - W / 2) / view.scale + view.cx; }
  function iy(y) { return (y - H / 2) / view.scale + view.cy; }
  function fit() {
    var b = D.boundary, xs = b.map(function (p) { return p[0]; }), ys = b.map(function (p) { return p[1]; });
    var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs), y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
    view.cx = (x0 + x1) / 2; view.cy = (y0 + y1) / 2;
    view.scale = Math.max(0.1, Math.min(W / (x1 - x0 + 160), H / (y1 - y0 + 160)));
    draw();
  }
  function draw() {
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#f4f7fb"; ctx.fillRect(0, 0, W, H);
    var im = (layer === "sat" && imgSat && imgSat.complete && imgSat.naturalWidth) ? imgSat : imgMap;
    if (im && im.complete && im.naturalWidth) {
      if (layer === "sat") {
        var g = D.geo, s0 = D.sat;
        ctx.drawImage(im, 0, 0, s0.w, s0.h, sx((s0.lon_tl - g.lon_tl) / g.dlo), sy((g.lat_tl - s0.lat_tl) / g.dla),
          s0.w * (s0.dlo / g.dlo) * view.scale, s0.h * (s0.dla / g.dla) * view.scale);
      } else {
        ctx.drawImage(im, 0, 0, im.naturalWidth, im.naturalHeight, sx(0), sy(0), im.naturalWidth * view.scale, im.naturalHeight * view.scale);
      }
    }
    ctx.save(); ctx.setLineDash([8, 6]); ctx.strokeStyle = "rgba(47,111,237,.75)"; ctx.lineWidth = 2;
    ctx.beginPath();
    D.boundary.forEach(function (p, i) { i ? ctx.lineTo(sx(p[0]), sy(p[1])) : ctx.moveTo(sx(p[0]), sy(p[1])); });
    ctx.closePath(); ctx.stroke(); ctx.restore();

    ctx.save(); ctx.strokeStyle = "rgba(250,190,40,.45)"; ctx.lineWidth = Math.max(2, view.scale * 2.4);
    D.roads.forEach(function (r) {
      ctx.beginPath();
      r.polyline.forEach(function (p, i) { i ? ctx.lineTo(sx(p[0]), sy(p[1])) : ctx.moveTo(sx(p[0]), sy(p[1])); });
      ctx.stroke();
    });
    ctx.restore();

    if (plan && plan.geo) {
      ctx.save(); ctx.strokeStyle = "rgba(22,163,74,.95)"; ctx.lineWidth = 3.5;
      plan.geo.forEach(function (pts) {
        ctx.beginPath();
        pts.forEach(function (q, i) { i ? ctx.lineTo(sx(q[0]), sy(q[1])) : ctx.moveTo(sx(q[0]), sy(q[1])); });
        ctx.stroke();
      });
      ctx.restore();
    }

    /* 站点序号：按"第几个不同的地点"编号，保证 1,2,3… 连续 */
    var stops = [], indexOf = {};
    if (plan) plan.segs.slice().sort(function (a, b) { return a.start - b.start; }).forEach(function (s) {
      if (!s.poi || indexOf[s.poi] != null) return;
      indexOf[s.poi] = stops.length + 1;
      stops.push(s.poi);
    });
    /* 路线箭头：每段中间画一个方向三角 */
    if (plan && plan.geo) {
      ctx.save(); ctx.fillStyle = "rgba(22,163,74,.95)";
      plan.geo.forEach(function (pts) {
        for (var i = 1; i < pts.length; i++) {
          var ax = sx(pts[i - 1][0]), ay = sy(pts[i - 1][1]), bx = sx(pts[i][0]), by = sy(pts[i][1]);
          var len = Math.hypot(bx - ax, by - ay);
          if (len < 40) continue;
          var ux = (bx - ax) / len, uy = (by - ay) / len;
          var mx = ax + ux * len * 0.55, my = ay + uy * len * 0.55;
          ctx.beginPath();
          ctx.moveTo(mx + ux * 7, my + uy * 7);
          ctx.lineTo(mx - ux * 4 - uy * 5, my - uy * 4 + ux * 5);
          ctx.lineTo(mx - ux * 4 + uy * 5, my - uy * 4 - ux * 5);
          ctx.closePath(); ctx.fill();
        }
      });
      ctx.restore();
    }
    /* 站点徽标 */
    ctx.font = "600 12px 'Microsoft YaHei',sans-serif";
    ctx.textAlign = "center";
    stops.forEach(function (id) {
      var p = D.pois.filter(function (x) { return x.id === id; })[0];
      if (!p) return;
      var x = sx(p.px[0]), y = sy(p.px[1]);
      var n = indexOf[id];
      ctx.beginPath(); ctx.arc(x, y, 11, 0, Math.PI * 2);
      ctx.fillStyle = "#16a34a"; ctx.fill();
      ctx.strokeStyle = "#fff"; ctx.lineWidth = 2.5; ctx.stroke();
      ctx.fillStyle = "#fff"; ctx.textBaseline = "middle";
      ctx.fillText(String(n), x, y + 1);
      ctx.lineWidth = 3.5; ctx.strokeStyle = "rgba(255,255,255,.95)";
      ctx.textAlign = "left";
      ctx.strokeText(p.name, x + 15, y);
      ctx.fillStyle = "#0f172a";
      ctx.fillText(p.name, x + 15, y);
    });
    /* 其它点位：小灰点 */
    ctx.textAlign = "left";
    D.pois.forEach(function (p) {
      if (indexOf[p.id]) return;
      var x = sx(p.px[0]), y = sy(p.px[1]);
      if (x < 0 || x > W || y < 0 || y > H) return;
      ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(148,163,184,.75)"; ctx.fill();
    });

    var barM = 200, barPx = barM / C.M_PER_PX * view.scale;
    ctx.save(); ctx.fillStyle = "rgba(255,255,255,.92)"; ctx.fillRect(12, H - 34, barPx + 62, 26);
    ctx.strokeStyle = "#0f172a"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(18, H - 20); ctx.lineTo(18 + barPx, H - 20); ctx.stroke();
    ctx.fillStyle = "#0f172a"; ctx.font = "12px 'Microsoft YaHei',sans-serif";
    ctx.fillText(barM + " m", 18 + barPx + 8, H - 16); ctx.restore();
  }

  /* ---------- 跨天视图 ---------- */
  function showRange() {
    var st = RT.getState();
    var map = {}; D.pois.forEach(function (x) { map[x.id] = x; });
    var range = PL.planRange({
      S: SCH, weekday: st.day, week: st.week, dormPoi: st.dorm,
      travel: RT.travel, pois: map, poiList: D.pois, tasks: st.tasks || []
    }, { days: 7 });
    var max = Math.max.apply(null, range.map(function (x) { return x.researchMin; })) || 1;
    $("route-timeline").innerHTML = '<div class="rt-range-title">未来 7 天 · 每天可用的整块科研时间（点击切换）</div>' +
      range.map(function (x) {
        var w = Math.round(x.researchMin / max * 100);
        return '<div class="rt-range" data-day="' + x.day + '" data-week="' + x.week + '">' +
          '<div class="rt-range-top"><b>' + x.name + '</b><span>第 ' + x.week + ' 周 · 科研 ' + fmt(x.researchMin) +
          '（最长 ' + fmt(x.longest) + '）· 课 ' + x.classes + '</span></div>' +
          '<div class="rt-range-bar"><i style="width:' + w + '%"></i></div>' +
          (x.dangers ? '<div class="rt-range-warn">⚠ ' + x.dangers + ' 处冲突</div>' : "") + '</div>';
      }).join("");
    $("route-timeline").querySelectorAll(".rt-range").forEach(function (el) {
      el.onclick = function () {
        $("route-day").value = el.dataset.day;
        $("route-week").value = el.dataset.week;
        RT.setDay(+el.dataset.day);
        RT.setWeek(+el.dataset.week);
      };
    });
  }

  function pushChoresToRuntime() {
    var list = (window.PlanChores ? PlanChores.list() : []).filter(function (c) { return !c.done; });
    RT.setChores(list.map(function (c) {
      return { id: c.id, name: c.name, dur: c.dur, poi: c.poi };
    }));
  }

  function renderChores() {
    var host = $("route-chore-list");
    if (!host || !window.PlanChores) return;
    var list = PlanChores.list();
    host.innerHTML = list.length
      ? list.map(function (c) {
          return '<label class="rc-item' + (c.done ? " rc-done" : "") + '">' +
            '<input type="checkbox" data-chore="' + esc(c.id) + '"' + (c.done ? " checked" : "") + " />" +
            '<span class="rc-name">' + esc(c.name) + "</span>" +
            '<span class="rc-meta">' + c.dur + " 分</span>" +
            '<button type="button" class="rc-del" data-del="' + esc(c.id) + '" title="删掉这条">×</button></label>';
        }).join("")
      : '<div class="rc-empty">今天还没有家务。空档会自动留出"机动"时间。</div>';

    host.querySelectorAll('input[data-chore]').forEach(function (box) {
      box.onchange = function () {
        PlanChores.toggle(box.dataset.chore);
        renderChores();
        pushChoresToRuntime();
      };
    });
    host.querySelectorAll("button[data-del]").forEach(function (btn) {
      btn.onclick = function () {
        PlanChores.remove(btn.dataset.del);
        renderChores();
        pushChoresToRuntime();
      };
    });
  }

  function bindHygiene() {
    var s1 = $("route-hyg-shower"), s2 = $("route-hyg-washup");
    if (!s1 || !s2 || !window.PlanChores) return;
    var cur = PlanChores.hygiene();
    s1.checked = cur.shower; s2.checked = cur.washup;
    function push() {
      var v = PlanChores.setHygiene("shower", s1.checked);
      PlanChores.setHygiene("washup", s2.checked);
      RT.setHygiene({ shower: !!s1.checked, washup: !!s2.checked });
    }
    s1.onchange = push;
    s2.onchange = push;
  }

  function bindChorePresets() {
    var sel = $("route-chore-preset"), btn = $("route-chore-add");
    if (!sel || !btn) return;
    var presets = (SCH.prefs && SCH.prefs.chorePresets) || [];
    sel.innerHTML = presets.map(function (p, i) {
      return '<option value="' + i + '">' + esc(p.name) + " · " + p.dur + " 分</option>";
    }).join("");
    btn.onclick = function () {
      var p = presets[+sel.value || 0];
      if (!p) return;
      PlanChores.add(p.name, { dur: p.dur, poi: p.poi });
      renderChores();
      pushChoresToRuntime();
    };
  }

  function poiLabelOf(id) {
    var hit = (D.pois || []).filter(function (x) { return x.id === id; })[0];
    return hit ? hit.name : (id || "");
  }

  function fitToPlan() {
    if (!plan || !plan.geo || !plan.geo.length) { fit(); return; }
    var minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    plan.geo.forEach(function (pts) {
      pts.forEach(function (q) {
        minX = Math.min(minX, q[0]); maxX = Math.max(maxX, q[0]);
        minY = Math.min(minY, q[1]); maxY = Math.max(maxY, q[1]);
      });
    });
    if (maxX - minX < 40) { minX -= 60; maxX += 60; }
    if (maxY - minY < 40) { minY -= 60; maxY += 60; }
    view.cx = (minX + maxX) / 2; view.cy = (minY + maxY) / 2;
    view.scale = Math.max(0.25, Math.min(3.2, Math.min(W / (maxX - minX + 120), H / (maxY - minY + 120))));
    draw();
  }

  function bindCanvas() {
    var drag = null;
    canvas.addEventListener("pointerdown", function (e) { userMoved = true; drag = { x: e.clientX, y: e.clientY, cx: view.cx, cy: view.cy }; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener("pointermove", function (e) {
      if (!drag) return;
      view.cx = drag.cx - (e.clientX - drag.x) / view.scale;
      view.cy = drag.cy - (e.clientY - drag.y) / view.scale;
      draw();
    });
    canvas.addEventListener("pointerup", function () { drag = null; });
    canvas.addEventListener("wheel", function (e) {
      e.preventDefault();
      var r = canvas.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
      var before = [ix(px), iy(py)];
      view.scale = Math.max(0.1, Math.min(8, view.scale * Math.exp(-e.deltaY * 0.0016)));
      view.cx += before[0] - ix(px); view.cy += before[1] - iy(py);
      draw();
    }, { passive: false });
    window.addEventListener("resize", function () { if (!$("route-view").hidden) { resize(); draw(); } });
  }

  /* ---------- 启动 ---------- */
  function boot() {
    canvas = $("route-map");
    if (!canvas || booted) return;
    C = window.CampusCore; PL = window.CampusPlanner; SCH = window.SCHEDULE; D = window.CAMPUS;
    RT = window.PlanRuntime; LLM = window.PlanLLM;
    if (!C || !PL || !SCH || !D || !RT) return;
    ctx = canvas.getContext("2d");
    booted = true;

    var daySel = $("route-day");
    for (var d = 1; d <= 7; d++) { var o = document.createElement("option"); o.value = d; o.textContent = DAY[d]; daySel.appendChild(o); }
    daySel.value = new Date().getDay() || 7;

    var dormSel = $("route-dorm"), locSel = $("route-loc");
    D.pois.filter(function (p) { return p.cat === "dorm"; }).forEach(function (p) {
      var o2 = document.createElement("option"); o2.value = p.id;
      o2.textContent = "宿舍·" + p.name.replace("学生公寓", "") + "号楼";
      o2.title = p.name;
      dormSel.appendChild(o2);
    });
    D.pois.forEach(function (p) {
      var o3 = document.createElement("option"); o3.value = p.id; o3.textContent = p.name; locSel.appendChild(o3);
    });
    var savedDorm = null;
    try { savedDorm = localStorage.getItem("xingzhi-route-dorm"); } catch (e) {}
    dormSel.value = savedDorm || "D12";
    window.PLAN_DORM = dormSel.value;

    /* 今日家务（独立轨道，不进项目看板） */
    bindChorePresets();
    renderChores();
    bindHygiene();
    (function () {
      var h = window.PlanChores ? PlanChores.hygiene() : null;
      if (h) RT.setHygiene(h);
      pushChoresToRuntime();
    })();

    /* 自习点：决定"带回哪儿吃"和科研段的目的地 */
    var studySel = $("route-study");
    if (studySel) {
      var savedStudy = null;
      try { savedStudy = localStorage.getItem("xingzhi-route-study"); } catch (e) {}
      studySel.value = savedStudy || "U26";   // 默认在未来警务学院自习
      RT.setStudyPoi(studySel.value);
      studySel.onchange = function () {
        try { localStorage.setItem("xingzhi-route-study", studySel.value); } catch (e) {}
        RT.setStudyPoi(studySel.value);
      };
    }

    /* 周三下午：文广见习 / 跟队跑操 */
    var teamSel = $("route-team");
    if (teamSel) {
      var savedTeam = null;
      try { savedTeam = localStorage.getItem("xingzhi-route-team"); } catch (e) {}
      teamSel.value = savedTeam || "observe";
      RT.setTeamMode(teamSel.value);
      teamSel.onchange = function () {
        try { localStorage.setItem("xingzhi-route-team", teamSel.value); } catch (e) {}
        RT.setTeamMode(teamSel.value);
      };
    }
    locSel.value = dormSel.value;

    imgMap = new Image(); imgMap.onload = draw; imgMap.src = "route/map.png";
    imgSat = new Image(); imgSat.src = "route/sat.jpg";

    RT.useAPI(LLM);
    RT.init({ dorm: dormSel.value, day: +daySel.value, week: +$("route-week").value || 7, atPoi: locSel.value });
    RT.setTasks(plannerTasks());
    RT.onPlan(render);

    $("route-plan").onclick = function () { RT.setTasks(plannerTasks()); };
    var incBox = $("route-include-delayed");
    if (incBox) incBox.onchange = function () { RT.setTasks(plannerTasks()); };
    $("route-fit").onclick = function () { userMoved = false; fitToPlan(); };
    $("route-center").onclick = function () {
      var p = D.pois.filter(function (x) { return x.id === locSel.value; })[0];
      if (p) { view.cx = p.px[0]; view.cy = p.px[1]; view.scale = Math.max(1.1, view.scale); draw(); }
    };
    $("route-range").onclick = function () { showRange(); };
    $("route-today").onclick = function () { RT.setDay(+daySel.value); };
    $("route-sat").onclick = function () { layer = (layer === "sat") ? "map" : "sat"; this.classList.toggle("on", layer === "sat"); draw(); };
    daySel.onchange = function () { RT.setDay(+daySel.value); };
    $("route-week").onchange = function () { RT.setWeek(+$("route-week").value || 7); };
    dormSel.onchange = function () {
      try { localStorage.setItem("xingzhi-route-dorm", dormSel.value); } catch (e) {}
      window.PLAN_DORM = dormSel.value;
      locSel.value = dormSel.value;
      RT.setDorm(dormSel.value);
    };
    locSel.onchange = function () { RT.setLocation(locSel.value); };
    bindCanvas();

    /* 一句话加事项 */
    $("route-parse").onclick = function () {
      var text = ($("route-text").value || "").trim();
      if (!text) return;
      $("route-parse").disabled = true;
      Promise.resolve(LLM.parseTasks(text)).then(function (res) {
        var pp = LLM.postProcess ? LLM.postProcess(res.tasks || [], text) : { tasks: res.tasks || [], merged: [] };
        var engine = res.engine === "api" ? "模型解析" : "本地规则解析";
        if (RT.setForceParcel && !pp.parcelWithShower) RT.setForceParcel(false);
        showParsePreview(pp, engine);
        $("route-parse").disabled = false;
      }).catch(function (e) {
        $("route-parse").disabled = false;
        $("route-parse-hint").textContent = "解析失败：" + (e && e.message || e);
        $("route-parse-hint").className = "route-parse-hint err";
      });
    };

    /* 解析结果先预览、再确认——避免"手一抖就多出一条日程" */
    function showParsePreview(pp, engine) {
      var box = $("route-parse-preview");
      var hint = $("route-parse-hint");
      var list = pp.tasks || [];
      var mergedNote = (pp.merged && pp.merged.length) ? "，已并入日常：" + pp.merged.join("、") : "";
      hint.className = "route-parse-hint ok";

      if (!list.length) {
        hint.textContent = engine + "：没有识别到可添加的事项" + mergedNote;
        box.hidden = true;
        box.innerHTML = "";
        return;
      }
      hint.textContent = engine + "：识别到 " + list.length + " 条，请确认后添加" + mergedNote;
      box.hidden = false;
      box.innerHTML =
        list.map(function (t, i) {
          var dur = Math.max(5, Math.min(180, Number(t.dur) || 30));
          var pn = (PL && t.poi) ? (poiLabelOf(t.poi) || t.poi) : (t.poi || "未指定地点");
          return '<label class="rp-item"><input type="checkbox" checked data-i="' + i + '">' +
                 '<span class="rp-name">' + esc(t.name) + "</span>" +
                 '<span class="rp-meta">' + esc(pn) + " · " +
                 (t.win && t.win[0] != null ? hhmm(t.win[0]) + "–" + hhmm(t.win[0] + dur) + " · " : "") +
                 dur + " 分钟</span></label>";
        }).join("") +
        (pp.merged && pp.merged.length ? '<div class="rp-merged">自动并入日常安排：' + esc(pp.merged.join("、")) + "（不新增任务）</div>" : "") +
        '<div class="rp-actions"><button type="button" class="primary small" id="rp-ok"></button>' +
        '<button type="button" class="ghost small" id="rp-cancel">取消</button></div>';

      var boxes = Array.prototype.slice.call(box.querySelectorAll('input[type="checkbox"]'));
      function syncOk() {
        var n = boxes.filter(function (b) { return b.checked; }).length;
        var ok = box.querySelector("#rp-ok");
        ok.textContent = n ? "添加 " + n + " 条" : "请至少选 1 条";
        ok.disabled = n === 0;
      }
      boxes.forEach(function (b) { b.onchange = syncOk; });
      syncOk();

      box.querySelector("#rp-cancel").onclick = function () {
        box.hidden = true; box.innerHTML = "";
        $("route-parse-hint").textContent = "已取消，输入框内容保留";
        $("route-parse-hint").className = "route-parse-hint";
      };

      box.querySelector("#rp-ok").onclick = function () {
        var chosen = [];
        boxes.forEach(function (b, i) { if (b.checked) chosen.push(list[i]); });
        chosen.forEach(function (t) {
          var dur = Math.max(5, Math.min(180, Number(t.dur) || 30));
          var slot = (t.win && t.win[0] != null)
            ? (t.win[0] < 660 ? "morning" : t.win[0] < 840 ? "noon" : t.win[0] < 1080 ? "afternoon" : "night")
            : "night";
          window.dispatchEvent(new CustomEvent("workbench-add-task", {
            detail: { title: t.name, place: t.poi, dur: dur, estimate: dur,
                      project: "临时事项", slot: slot, silent: true,
                      appointment: (t.win && t.win[0] != null)
                        ? { start: t.win[0], end: t.win[1] != null ? t.win[1] : t.win[0] + dur }
                        : null }
          }));
        });
        box.hidden = true; box.innerHTML = "";
        $("route-text").value = "";
        $("route-parse-hint").textContent = "已添加 " + chosen.length + " 条（可在下方时间轴撤销）";
        $("route-parse-hint").className = "route-parse-hint ok";
        try {
          if (window.WorkbenchUndo) window.WorkbenchUndo.toast("已添加 " + chosen.length + " 条日程", true);
        } catch (e) {}
        /* "洗澡顺便取快递" → 让洗澡那一段带取件，不再单独加任务 */
        if (pp.parcelWithShower && RT.setForceParcel) RT.setForceParcel(true);
        setTimeout(function () { RT.setTasks(plannerTasks()); }, 60);
      };
    }

    window.__showParsePreview = showParsePreview;   // 调试/自动化验证用

    /* API 设置 */
    var cfg = LLM.load();
    $("route-api-base").value = cfg.base || "";
    $("route-api-model").value = cfg.model || "";
    $("route-api-state").textContent = cfg.enabled ? "已启用" : "未启用（本地引擎）";
    $("route-api-save").onclick = function () {
      LLM.save({
        enabled: !!$("route-api-base").value,
        base: $("route-api-base").value.trim(),
        model: $("route-api-model").value.trim(),
        key: $("route-api-key").value.trim()
      });
      LLM.load();
      $("route-api-state").textContent = LLM.cfg.enabled ? "已启用" : "未启用（本地引擎）";
      RT.setTasks(plannerTasks());
    };

    /* 看板任务变化 → 重排 */
    window.addEventListener("workbench-tasks-updated", function () { RT.setTasks(plannerTasks()); });
    var navBtn = document.querySelector('.nav[data-view="route"]');
    if (navBtn) navBtn.addEventListener("click", function () {
      setTimeout(function () { resize(); fit(); RT.setTasks(plannerTasks()); }, 30);
    });

    resize(); fit();
    RT.setTasks(plannerTasks());
    window.RouteView = { show: function () { resize(); fit(); RT.setTasks(plannerTasks()); }, getPlan: function () { return RT.getPlan(); } };
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
