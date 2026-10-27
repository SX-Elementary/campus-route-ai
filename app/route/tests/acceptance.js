/* acceptance.js —— 审计验收用例（无需任何依赖）
 * 运行：node app/route/tests/acceptance.js
 * 覆盖：F01 硬约束不推后 / 门禁 / F08 今天判定 / 晚饭窗口 / 一周无危险提示
 */
const fs = require("fs"), path = require("path");
global.window = global;
global.performance = { now: () => Date.now() };
global.localStorage = { _d: {}, getItem(k) { return this._d[k] || null; }, setItem(k, v) { this._d[k] = v; }, removeItem(k) { delete this._d[k]; } };
global.location = { port: "" };
const R = path.join(__dirname, "..");
["data.js", "core.js", "schedule.js", "planner.js", "chores.js", "llm.js", "runtime.js"].forEach(f =>
  eval(fs.readFileSync(path.join(R, f), "utf8")));

const C = require(path.join(R, "core.js")), P = global.CampusPlanner, RT = global.PlanRuntime;
const D = global.CAMPUS, S = global.SCHEDULE;
const g = C.buildGraph(D.roads, D.pois);
const poi = {}; D.pois.forEach(p => (poi[p.id] = p));
const travel = (a, b) => (a === b ? 0 : (C.routeBetween(g, a, b, S.prefs.walkSpeed) || { walk_s: 3600 }).walk_s);

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (extra ? "  → " + extra : "")); }
}
function plan(cfg) {
  return P.planDay(Object.assign({ S, dormPoi: "D12", travel, pois: poi, poiList: D.pois, tasks: [], week: 7 }, cfg));
}

console.log("F01 · 集合不被推后（周一 13:00 在文化广场 + 30 分钟任务）");
const r1 = plan({ weekday: 1, now: 13 * 60, atPoi: "U34", tasks: [{ name: "审计临时任务", poi: "U34", dur: 30, soft: true }] });
const asm1 = r1.segs.filter(s => /点名报班/.test(s.title))[0];
ok(asm1 && P.hhmm(asm1.start) === "13:25", "下午课前集合仍在 13:25", asm1 ? P.hhmm(asm1.start) : "无");
ok(r1.warnings.some(w => w.level === "danger" && /赶不上/.test(w.text)), "给出'赶不上'危险提示");

console.log("F01 · 宿舍门禁覆盖所有到宿舍的段（周一 09:00 在未来警务学院）");
const r2 = plan({ weekday: 1, now: 9 * 60, atPoi: "U26", tasks: [{ name: "回宿舍拿材料", poi: "D12", dur: 10, soft: true }] });
ok(r2.warnings.some(w => /门禁/.test(w.text)), "门禁时段访问宿舍会被点名");

console.log("晚饭窗口（第 7 周：要么 17:30–18:15，要么不吃）");
let dinnerOk = true;
for (let d = 1; d <= 7; d++) {
  const r = plan({ weekday: d });
  const din = r.segs.filter(s => /^晚饭/.test(s.title))[0];
  if (din && !(din.start >= P.m("17:30") - 2 && din.end <= P.m("18:15") + 3)) dinnerOk = false;
}
ok(dinnerOk, "一周晚饭全部落在窗口内或不排");

console.log("一周无硬冲突（集合/课程准点）");
let danger = 0;
for (let d = 1; d <= 7; d++) danger += plan({ weekday: d }).warnings.filter(w => w.level === "danger").length;
ok(danger === 0, "危险提示 0 条", danger + " 条");

console.log("F02 · 精确预约贯通（'今晚八点…三十分钟'）");
const L = global.PlanLLM;
const pp = L.postProcess(L.parseLocal("今晚八点去综训馆训练三十分钟"), "今晚八点去综训馆训练三十分钟");
const parsed = pp.tasks[0] || {};
ok(parsed.win && parsed.win[0] === 1200, "解析出 20:00 起点", JSON.stringify(parsed.win));
ok(parsed.dur === 30, "解析出 30 分钟（不是默认为 60）", String(parsed.dur));
const rAppt = plan({ weekday: 7, now: 19 * 60, atPoi: "D12",
  tasks: [{ id: 1, name: parsed.name, poi: parsed.poi, dur: parsed.dur, win: [1200, 1230], soft: false }] });
const segAppt = rAppt.segs.filter(s => /综训馆训练/.test(s.title))[0];
ok(segAppt && segAppt.start === 1200 && segAppt.end === 1230, "排程落在 20:00–20:30",
   segAppt ? P.hhmm(segAppt.start) + "–" + P.hhmm(segAppt.end) : "未排");
const rClash = plan({ weekday: 4, now: 8 * 60, atPoi: "D12",
  tasks: [{ id: 2, name: "预约理发", poi: "U11", dur: 30, win: [19 * 60, 19 * 60 + 30], soft: false }] });
ok(rClash.warnings.some(w => w.level === "danger" && /预约/.test(w.text)), "预约撞课程时明确报错");

console.log("F08 · 未来的周不该被当成'今天'");
RT.init({ day: new Date().getDay() || 7, week: 7, dorm: "D12", atPoi: "D12" });
RT.setTasks([]);
const nowPlan = RT.getPlan();
RT.setWeek(12);
const futurePlan = RT.getPlan();
ok(nowPlan.meta.today !== undefined, "有 meta.today 字段");
ok(futurePlan.meta.today === false, "第 12 周 today=false", String(futurePlan.meta.today));
ok(futurePlan.now === null, "第 12 周从 06:00 排（now=null）", String(futurePlan.now));

console.log("F03 · 取快递不再被'并入日常'吞掉");
const pParcel = L.postProcess(L.parseLocal("今晚八点取快递十分钟"), "今晚八点取快递十分钟");
ok(pParcel.tasks.length === 1, "保留成 1 条任务（原实现会删除）", JSON.stringify(pParcel.tasks.map(t => t.name)));
ok(pParcel.tasks[0] && pParcel.tasks[0].poi === "U4", "地点命中快递柜 U4", pParcel.tasks[0] && pParcel.tasks[0].poi);
ok(pParcel.tasks[0] && pParcel.tasks[0].win && pParcel.tasks[0].win[0] === 1200, "保留 20:00 时间要求");
const rParcel = plan({ weekday: 7, now: 19 * 60, atPoi: "D12",
  tasks: [{ id: 9, name: "取快递", poi: "U4", dur: 10, win: [1200, 1210], soft: false }] });
const segParcel = rParcel.segs.filter(s => /取快递/.test(s.title))[0];
ok(segParcel && segParcel.poi === "U4" && segParcel.walkMin > 0, "排成真实一段（有步行）",
   segParcel ? segParcel.poi + "/" + segParcel.walkMin + "分" : "未排");
const showerParcel = rParcel.segs.filter(s => s.kind === "shower")[0];
ok(!showerParcel || !/顺路取快递/.test(showerParcel.title), "洗澡不再重复叠加取件",
   showerParcel ? showerParcel.title : "无洗澡");
const pBoth = L.postProcess(L.parseLocal("洗澡顺便取快递"), "洗澡顺便取快递");
ok(pBoth.parcelWithShower === true && pBoth.tasks.length === 0, "说'顺便'时改为并入洗澡",
   JSON.stringify({ tasks: pBoth.tasks.length, parcel: pBoth.parcelWithShower }));

console.log("F04 · '进行中'不默认到场（周二 08:20 人在宿舍，民法学在中楼）");
const rAway = plan({ weekday: 2, now: 8 * 60 + 20, atPoi: "D12" });
const segAway = rAway.segs.filter(s => /民法学/.test(s.title))[0];
ok(segAway && segAway.start === 8 * 60 + 30, "按赶路计算起点 08:30（不是 08:20）",
   segAway ? P.hhmm(segAway.start) : "未排");
ok(segAway && segAway.walkMin === 10, "记入 10 分钟步行", segAway ? String(segAway.walkMin) : "-");
ok(rAway.warnings.some(w => /课表上在|赶/.test(w.text)), "提示位置与课表不一致");
const rHere = plan({ weekday: 2, now: 8 * 60 + 20, atPoi: "U8" });
const segHere = rHere.segs.filter(s => /民法学/.test(s.title))[0];
ok(segHere && segHere.start === 8 * 60 + 20, "人已在中楼时原地接续 08:20",
   segHere ? P.hhmm(segHere.start) : "未排");
const rConf = plan({ weekday: 2, now: 8 * 60 + 20, atPoi: "D12", assumeArrived: true });
const segConf = rConf.segs.filter(s => /民法学/.test(s.title))[0];
ok(segConf && segConf.start === 8 * 60 + 20, "用户确认到场后不再加步行",
   segConf ? P.hhmm(segConf.start) : "未排");

console.log("F05 · 模型建议有界（同权重只问一次）");
(async () => {
  let calls = 0;
  RT.resetAdvice();
  RT.useAPI({ advise: () => { calls++; return Promise.resolve({ weights: { research: 9, meal: 1, walk: 1, shower: 1 } }); } });
  RT.setTasks([]);
  await new Promise(r => setTimeout(r, 120));
  ok(calls === 1, "同一事件只问一次模型", "实际 " + calls + " 次");
  ok(RT.adviceStats().applies <= 1, "最多应用一次", JSON.stringify(RT.adviceStats()));

  console.log("\n" + (fail ? "失败 " + fail + " 项" : "全部通过") + "（" + pass + " 项）");
  process.exit(fail ? 1 : 0);
})();
