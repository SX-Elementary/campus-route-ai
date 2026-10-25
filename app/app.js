const KEY = "personal-research-workbench-v2";
const $ = (id) => document.getElementById(id);
const names = { inbox: "Inbox", week: "本周计划", doing: "进行中", verify: "待验证", report: "待汇报", done: "已完成" };
const slots = { morning: ["上午", "08:00–12:00", "深度思考"], noon: ["中午", "13:20–14:00", "低认知输入"], afternoon: ["下午", "14:00–18:00", "整理 / 运动"], night: ["晚上", "18:30–22:30", "深度专注"] };
const sample = [
  { id: 1, title: "完成 PubMed 真实检索闭环", flow: "research", project: "循质医献", slot: "morning", status: "week", isLarge: true, output: "返回至少 10 篇带 PMID 的真实文献", subtasks: [{ text: "确定检索式与纳排标准", done: true }, { text: "检索并去重真实文献", done: false }, { text: "抽取 PMID、DOI 与文献类型", done: false }] },
  { id: 2, title: "阅读 1 篇医学 AI 综述", flow: "research", project: "技术学习", slot: "noon", status: "inbox", output: "Zotero 标注并写 3 条笔记", subtasks: [] },
  { id: 3, title: "力量训练", flow: "life", project: "运动与乒乓球", slot: "afternoon", status: "doing", output: "45–60 分钟", subtasks: [] },
  { id: 4, title: "练习一首吉他曲", flow: "life", project: "吉他与音乐", slot: "night", status: "week", output: "完整弹奏一遍", subtasks: [] },
  { id: 5, title: "实现文献年份趋势图", flow: "research", project: "循质医献", slot: "night", status: "doing", isLarge: true, output: "保存一张真实数据图表", subtasks: [{ text: "确定图表字段", done: true }, { text: "生成图表并检查数据", done: false }] }
];
const freshSample = () => JSON.parse(JSON.stringify(sample));
let storedTasks = null;
try { storedTasks = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (error) { localStorage.removeItem(KEY); }
let tasks = storedTasks || freshSample();
let planningTaskId = null;
let editingId = null;
let activeFlow = "research";

function dayKey(date = new Date()) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
function weekStartKey() { const date = new Date(); const offset = (date.getDay() + 6) % 7; date.setDate(date.getDate() - offset); return dayKey(date); }
function dayDistance(from, to) { return Math.round((new Date(`${to}T00:00:00`) - new Date(`${from}T00:00:00`)) / 86400000); }
function autoMeta(task) { const text = `${task.title} ${task.project}`; if (/力量|跑步|乒乓|运动|吉他|音乐|摄影|剪辑/.test(text)) return { estimate: 60, energy: "动态恢复" }; if (/阅读|综述|Zotero|浏览|打字/.test(text)) return { estimate: 30, energy: "低认知" }; if (/实现|开发|检索|分析|写作|报告|论文|图表|代码/.test(text)) return { estimate: 90, energy: "高认知" }; return { estimate: 60, energy: "中等专注" }; }
function normalize(task) { if (!task.subtasks) task.subtasks = []; if (task.isLarge === undefined) task.isLarge = task.subtasks.length > 0; task.flow ||= task.project === "兴趣与运动" ? "life" : "research"; task.dueDate ||= dayKey(); task.delayCount ||= 0; if (!task.estimate || !task.energy) Object.assign(task, autoMeta(task)); if (task.status === "done" && !task.completedDate) task.completedDate = dayKey(); return task; }
tasks.forEach(normalize);
function rollForwardDelayedTasks() { const today = dayKey(); let changed = false; tasks.forEach(task => { if (task.status !== "done" && task.dueDate < today) { task.delayCount += Math.max(1, dayDistance(task.dueDate, today)); task.dueDate = today; changed = true; } }); if (changed) localStorage.setItem(KEY, JSON.stringify(tasks)); }
rollForwardDelayedTasks();
function progress(task) { const list = task.subtasks || []; return list.length ? Math.round(list.filter((item) => item.done).length / list.length * 100) : null; }
/* ---------- 撤销：每次 save() 前把"上一版"压栈，可回退 30 步 ---------- */
let undoStack = [];
let lastSaved = JSON.stringify(tasks);
const UNDO_MAX = 30;
try {                                   // 刷新页面后仍可回退（栈存在本地）
  const stored = JSON.parse(localStorage.getItem("xingzhi-undo-stack") || "[]");
  if (Array.isArray(stored)) undoStack = stored.slice(-UNDO_MAX);
} catch (e) {}

function notifyTasks() { window.dispatchEvent(new CustomEvent("workbench-tasks-updated", { detail: tasks })); }

function save() {
  const now = JSON.stringify(tasks);
  if (lastSaved !== now) {
    undoStack.push(lastSaved);
    if (undoStack.length > UNDO_MAX) undoStack.shift();
    localStorage.setItem("xingzhi-undo-stack", JSON.stringify(undoStack.slice(-UNDO_MAX)));
  }
  localStorage.setItem(KEY, now);
  lastSaved = now;
  render();
  notifyTasks();
  refreshUndoUI();
}
(window.__undoStack = undoStack);

function undo(reason) {
  if (!undoStack.length) { toast("没有可撤销的操作"); return false; }
  const prev = undoStack.pop();
  tasks = JSON.parse(prev);
  lastSaved = JSON.stringify(tasks);
  localStorage.setItem(KEY, lastSaved);
  try { localStorage.setItem("xingzhi-undo-stack", JSON.stringify(undoStack)); } catch (e) {}
  render();
  notifyTasks();
  refreshUndoUI();
  toast((reason || "已撤销") + " · 还剩 " + undoStack.length + " 步可退");
  return true;
}

function toast(msg, withUndo) {
  let bar = document.getElementById("undo-toast");
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "undo-toast";
    bar.className = "undo-toast";
    document.body.appendChild(bar);
  }
  bar.innerHTML = "<span></span>";
  bar.firstChild.textContent = msg;
  if (withUndo) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "撤销";
    btn.onclick = () => { undo("已撤销刚添加的操作"); hideToast(); };
    bar.appendChild(btn);
  }
  bar.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(hideToast, withUndo ? 9000 : 3200);
}
function hideToast() { const bar = document.getElementById("undo-toast"); if (bar) bar.classList.remove("show"); }

function refreshUndoUI() {
  const btn = document.getElementById("undo-btn");
  if (btn) {
    btn.disabled = undoStack.length === 0;
    btn.textContent = undoStack.length ? "撤销 (" + undoStack.length + ")" : "撤销";
    btn.title = undoStack.length ? "回退上一步改动（Ctrl+Z）" : "暂无可撤销的操作";
  }
}
window.WorkbenchUndo = { undo: undo, count: () => undoStack.length, toast: toast };
window.addEventListener("workbench-delete-project", (event) => {
  const { name, flow } = event.detail || {};
  if (!name || !["research", "life"].includes(flow)) return;
  tasks = tasks.filter((task) => {
    const taskName = typeof task.project === "string" ? task.project.trim() : "";
    const taskFlow = task.flow || (taskName === "兴趣与运动" ? "life" : "research");
    return !(taskName === name.trim() && taskFlow === flow);
  });
  save();
});
window.addEventListener("workbench-move-task-project", (event) => {
  const { id, project, flow } = event.detail || {};
  const name = typeof project === "string" ? project.trim() : "";
  if (!name || !["research", "life"].includes(flow)) return;
  const task = tasks.find((item) => item.id === Number(id));
  if (!task) return;
  task.project = name;
  task.flow = flow;
  save();
});
function progressHTML(task) { const value = progress(task); if (value === null) return ""; const items = task.subtasks.map((item, index) => `<li class="${item.done ? "subtask-done" : ""}"><button type="button" data-action="toggle-subtask" data-index="${index}" aria-label="切换子任务完成状态">${item.done ? "✓" : "○"}</button><span>${item.text}</span><button class="edit-subtask" type="button" data-action="edit-subtask" data-index="${index}" aria-label="修改子任务">编辑</button></li>`).join(""); return `<div class="progress-label"><span>子任务进度</span><b>${value}%</b></div><div class="progress-track"><i style="width:${value}%"></i></div><div class="subtask-count">${task.subtasks.filter(x => x.done).length}/${task.subtasks.length} 已完成</div><ul class="subtask-list">${items}</ul>`; }
function taskHTML(task) { const value = progress(task); const delay = task.delayCount ? `<b class="delay-badge">延期 ${task.delayCount} 次</b>` : ""; const focus = task.focusDate === dayKey() ? '<b class="focus-badge">今日重点</b>' : ""; const meta = `<small class="auto-meta">${task.estimate} 分钟 · ${task.energy}</small>`; return `<article class="task flow-${task.flow} ${task.status === "done" ? "done" : ""}" data-id="${task.id}" draggable="true"><div class="task-top"><strong>${task.title}</strong>${task.isLarge ? '<em>大任务</em>' : ''}</div><span>${task.project} · ${task.output || "未设置完成标准"}</span>${meta}${focus}${delay}${progressHTML(task)}<div class="task-actions">${value !== null ? '<button data-action="subtask" type="button">子任务</button><button data-action="ai" type="button">智能拆分</button>' : '<button data-action="subtask" type="button">＋ 子任务</button>'}<button class="check" data-action="toggle" type="button">${task.status === "done" ? "↺ 恢复" : "✓ 完成"}</button><button class="del" data-action="delete" type="button" title="删除这条任务（可撤销）">删除</button></div></article>`; }
function render() {
  $("date-label").textContent = new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "long" }).format(new Date());
  $("schedule").innerHTML = Object.entries(slots).map(([key, value]) => `<section class="slot"><h3>${value[0]}</h3><small>${value[1]} · ${value[2]}</small>${tasks.filter(t => t.slot === key && t.status !== "done").map(taskHTML).join("") || '<p class="side-note">留白：不额外填任务。</p>'}</section>`).join("");
  $("flow-banner").className = `flow-banner ${activeFlow}`; $("flow-banner").innerHTML = activeFlow === "research" ? '<span>RESEARCH FLOW</span><strong>科研工作流</strong><small>科研、学习、组会与项目推进</small>' : '<span>LIFE FLOW</span><strong>日常生活兴趣爱好流</strong><small>音乐、运动、影像与生活技能</small>';
  $("board").innerHTML = Object.entries(names).map(([key, label]) => `<section class="column" data-status="${key}"><h3>${label}</h3><div class="drop-zone">${tasks.filter(t => t.flow === activeFlow && t.status === key && (key !== "done" || t.completedDate === dayKey())).map(taskHTML).join("") || '<p class="empty">拖放任务至此</p>'}</div></section>`).join("");
  $("done-count").textContent = tasks.filter(t => t.status === "done").length;
  $("deep-count").textContent = tasks.filter(t => ["morning", "night"].includes(t.slot) && t.status !== "done").length;
  $("exercise-count").textContent = tasks.filter(t => t.project === "兴趣与运动" && t.status === "done").length;
  $("archive-list").innerHTML = tasks.filter(t => t.status === "done" && t.completedDate !== dayKey() && t.completedDate >= weekStartKey()).map(t => `<article class="archive-item" data-id="${t.id}" title="点击编辑任务"><strong>${t.title}</strong><span>完成于 ${t.completedDate}${t.delayCount ? ` · 延期 ${t.delayCount} 次` : " · 未延期"}</span></article>`).join("") || '<p class="empty">本周暂无历史归档。</p>';
  bindTaskInteractions();
}
function bindTaskInteractions() {
  document.querySelectorAll(".task").forEach(card => {
    card.addEventListener("dragstart", (event) => { event.dataTransfer.setData("text/plain", card.dataset.id); card.classList.add("dragging"); });
    card.addEventListener("click", (event) => { if (event.target.closest("button")) return; openEditTask(+card.dataset.id); });
    card.addEventListener("dragend", () => card.classList.remove("dragging"));
    card.querySelectorAll("button").forEach(button => button.onclick = (event) => { event.stopPropagation(); handleAction(+card.dataset.id, button.dataset.action, Number(button.dataset.index)); });
  });
  document.querySelectorAll(".archive-item").forEach(item => { item.addEventListener("click", () => openEditTask(+item.dataset.id)); });
  document.querySelectorAll(".column").forEach(column => {
    column.addEventListener("dragover", event => { event.preventDefault(); column.classList.add("drag-over"); });
    column.addEventListener("dragleave", () => column.classList.remove("drag-over"));
    column.addEventListener("drop", event => { event.preventDefault(); const task = tasks.find(t => t.id === +event.dataTransfer.getData("text/plain")); if (task) { task.status = column.dataset.status; save(); } });
  });
}
function handleAction(id, action, index) {
  const task = tasks.find(t => t.id === id); if (!task) return;
  if (action === "delete") {
    const title = task.title;
    tasks = tasks.filter((item) => item.id !== id);
    save();
    toast("已删除「" + title + "」", true);
    return;
  }
  if (action === "toggle") { task.status = task.status === "done" ? "doing" : "done"; if (task.status === "done") { task.subtasks.forEach(item => item.done = true); task.completedDate = dayKey(); } else { task.completedDate = null; task.dueDate = dayKey(); } save(); return; }
  if (action === "toggle-subtask" && task.subtasks[index]) { task.subtasks[index].done = !task.subtasks[index].done; task.status = task.subtasks.length && task.subtasks.every(item => item.done) ? "done" : (task.status === "done" ? "doing" : task.status); task.completedDate = task.status === "done" ? dayKey() : null; save(); return; }
  if (action === "edit-subtask" && task.subtasks[index]) { const text = prompt("修改子任务：", task.subtasks[index].text); if (text && text.trim()) { task.subtasks[index].text = text.trim(); save(); } return; }
  if (action === "subtask") { const text = prompt("新增子任务（请使用可验证的动作描述）："); if (text && text.trim()) { task.isLarge = true; task.subtasks.push({ text: text.trim(), done: false }); save(); } return; }
  if (action === "ai") openAIPlan(task);
}
function openAIPlan(task) {
  planningTaskId = task.id;
  const suggestions = task.subtasks.length ? task.subtasks.map(x => x.text) : ["明确问题边界与可交付成果", "收集并筛选所需资料或数据", "完成核心分析 / 实现", "检查质量并形成可展示输出"];
  $("ai-subtasks").value = suggestions.join("\n");
  const count = suggestions.length;
  $("ai-review").textContent = count >= 3 && count <= 6 ? "合理性初检：子任务数量适中；建议每一项都能在一次专注时段内验收。" : "合理性初检：建议控制在 3–6 个子任务，并将过大的步骤继续拆分。";
  $("ai-dialog").showModal();
}
document.querySelectorAll(".nav").forEach(btn => btn.onclick = () => { document.querySelectorAll(".nav").forEach(x => x.classList.remove("active")); btn.classList.add("active"); if (btn.dataset.flow) activeFlow = btn.dataset.flow; document.querySelectorAll(".view").forEach(view => view.hidden = true); $(btn.dataset.view + "-view").hidden = false; $("view-title").textContent = btn.textContent; render(); });
$("new-task").onclick = () => { editingId = null; const status = $("task-status"); [...status.options].forEach(option => { if (option.value === "done") option.remove(); }); $("task-dialog-title").textContent = "新建任务"; $("task-save-button").textContent = "保存任务"; $("task-form").reset(); $("task-date").value = dayKey(); $("task-dialog").showModal(); };
function openEditTask(id) {
  const task = tasks.find(item => item.id === id); if (!task) return;
  editingId = id;
  $("task-dialog-title").textContent = "编辑任务";
  $("task-save-button").textContent = "保存修改";
  const status = $("task-status");
  if (![...status.options].some(option => option.value === "done")) { const option = document.createElement("option"); option.value = "done"; option.textContent = names.done; status.append(option); }
  $("task-title").value = task.title || "";
  $("task-flow").value = task.flow === "life" ? "life" : "research";
  $("task-project").value = task.project || "";
  $("task-slot").value = task.slot || "morning";
  $("task-date").value = task.dueDate || dayKey();
  status.value = task.status || "inbox";
  $("task-large").checked = !!task.isLarge;
  $("task-subtasks").value = (task.subtasks || []).map(item => item.text).join("\n");
  $("task-output").value = task.output || "";
  $("task-dialog").showModal();
}
window.addEventListener("workbench-edit-task", (event) => openEditTask(Number((event.detail || {}).id)));
$("task-form").onsubmit = (event) => {
  event.preventDefault();
  const lines = $("task-subtasks").value.split("\n").map(x => x.trim()).filter(Boolean);
  const current = editingId !== null ? tasks.find(item => item.id === editingId) : null;
  const fields = { title: $("task-title").value.trim(), flow: $("task-flow").value, project: $("task-project").value, slot: $("task-slot").value, status: $("task-status").value, output: $("task-output").value, dueDate: $("task-date").value || dayKey(), isLarge: $("task-large").checked || lines.length > 0 };
  if (current) {
    const previous = current.subtasks || [];
    Object.assign(current, fields);
    current.subtasks = lines.map(text => { const hit = previous.find(item => item.text === text); return { text, done: hit ? !!hit.done : false }; });
    if (current.status === "done") { if (!current.completedDate) current.completedDate = dayKey(); } else { current.completedDate = null; }
  } else {
    tasks.push(normalize(Object.assign({ id: Date.now(), delayCount: 0 }, fields, { subtasks: lines.map(text => ({ text, done: false })) })));
  }
  editingId = null;
  $("task-dialog").close();
  $("task-form").reset();
  save();
};
$("apply-ai-plan").onclick = () => { const task = tasks.find(t => t.id === planningTaskId); const lines = $("ai-subtasks").value.split("\n").map(x => x.trim()).filter(Boolean); if (task && lines.length) { task.isLarge = true; task.subtasks = lines.map(text => ({ text, done: false })); save(); } };
$("reset-demo").onclick = () => { if (confirm("恢复示例数据？当前本地任务将被替换。")) { tasks = freshSample(); save(); } };
$("copy-report").onclick = async () => { const done = tasks.filter(t => t.status === "done").map(t => `- ${t.title}`).join("\n") || "- 暂无"; const text = `# 本周进展\n\n## 已完成\n${done}\n\n## 可展示成果\n${$("weekly-notes").value || "待补充"}\n\n## 下周计划\n- `; await navigator.clipboard.writeText(text); alert("周报草稿已复制"); };
window.addEventListener("workbench-add-task", (event) => {
  const d = event.detail || {};
  if (!d.title) return;
  const mins = Math.max(5, Math.min(180, Number(d.dur || d.estimate) || 30));
  const task = normalize({
    id: Date.now(), title: String(d.title).slice(0, 60),
    flow: d.flow || "life", project: d.project || "临时事项",
    slot: d.slot || "night", status: "week", estimate: mins,
    energy: "按输入的时长",                     // 有 energy 才不会触发 autoMeta 覆盖时长
    place: d.place || null, output: d.output || "", subtasks: [],
    dueDate: dayKey(), delayCount: 0
  });
  task.estimate = mins;                        // 双保险
  tasks.push(task);
  save();
  if (!d.silent) toast("已添加「" + task.title + "」", true);   // 9 秒内可一键撤销
});

/* Ctrl+Z / ⌘+Z 撤销（输入框内不拦截，保留原生文字撤销） */
document.addEventListener("keydown", (event) => {
  const meta = event.ctrlKey || event.metaKey;
  if (!meta || event.key.toLowerCase() !== "z" || event.shiftKey) return;
  const el = event.target;
  const typing = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
  if (typing) return;
  if (undo()) { event.preventDefault(); }
});

refreshUndoUI();
window.addEventListener("workbench-set-task-place", (event) => {
  const { id, place } = event.detail || {};
  const task = tasks.find((item) => item.id === Number(id));
  if (!task) return;
  task.place = place || null;
  save();
});
render();
window.workbenchReady = true;

/* 撤销按钮（侧边栏 data-tools） */
(function () {
  const btn = document.getElementById("undo-btn");
  if (btn) btn.onclick = () => undo("已撤销上一步");
  if (btn) btn.title = "回退上一步改动（Ctrl+Z）";
})();
