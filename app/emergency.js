(function () {
  function byId(id) { return document.getElementById(id); }
  window.setTimeout(function () {
    if (window.workbenchReady) return;
    var key = 'personal-research-workbench-safe-v1';
    var stored;
    try { stored = JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { stored = null; }
    var tasks = stored || [
      { id: 101, title: '完成 PubMed 真实检索闭环', project: '循质医献', slot: 'morning', status: 'week', output: '返回至少 10 篇带 PMID 的真实文献', subtasks: [{ text: '确定检索式', done: true }, { text: '检索并去重', done: false }, { text: '提取 PMID 与 DOI', done: false }] },
      { id: 102, title: '阅读医学 AI 综述', project: '技术学习', slot: 'noon', status: 'inbox', output: '写 3 条 Zotero 笔记', subtasks: [] },
      { id: 103, title: '力量训练', project: '兴趣与运动', slot: 'afternoon', status: 'doing', output: '45–60 分钟', subtasks: [] }
    ];
    var researchLabels = { inbox: '研究池', week: '本周承诺', doing: '深度推进', verify: '待复核', report: '可汇报成果', done: '今日已完成' }; var lifeLabels = { inbox: '灵感清单', week: '本周想做', doing: '今日行动', verify: '待整理（可选）', report: '体验 / 作品记录', done: '今日已完成' }; var labels = researchLabels;
    var slots = { morning: ['上午', '08:00–12:00', '深度思考'], noon: ['中午', '13:20–14:00', '低认知输入'], afternoon: ['下午', '14:00–18:00', '整理 / 运动'], night: ['晚上', '18:30–22:30', '深度专注'] };
    var activeFlow = 'research'; var editingId = null; function autoMeta(task) { var text = task.title + ' ' + task.project; if (/力量|跑步|乒乓|运动|吉他|音乐|摄影|剪辑/.test(text)) return { estimate: 60, energy: '动态恢复' }; if (/阅读|综述|Zotero|浏览|打字/.test(text)) return { estimate: 30, energy: '低认知' }; if (/实现|开发|检索|分析|写作|报告|论文|图表|代码/.test(text)) return { estimate: 90, energy: '高认知' }; return { estimate: 60, energy: '中等专注' }; } tasks.forEach(function (task) { if (!task.flow) task.flow = task.project === '兴趣与运动' ? 'life' : 'research'; if (!task.estimate || !task.energy) { var meta = autoMeta(task); task.estimate = meta.estimate; task.energy = meta.energy; } });
    function todayKey() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
    function weekStartKey() { var d = new Date(); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
    function daysBetween(a, b) { return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000); }
    var today = todayKey(); var carried = false; tasks.forEach(function (task) { if (task.dueDate === undefined) task.dueDate = today; if (!task.delayCount) task.delayCount = 0; if (task.status === 'done' && !task.completedDate) { task.completedDate = today; carried = true; } if (task.status !== 'done' && task.dueDate < today) { task.delayCount += Math.max(1, daysBetween(task.dueDate, today)); task.dueDate = today; carried = true; } }); if (carried) localStorage.setItem(key, JSON.stringify(tasks));
    function save() { localStorage.setItem(key, JSON.stringify(tasks)); draw(); }
    window.addEventListener('workbench-delete-project', function (event) {
      var detail = event.detail || {}; var name = typeof detail.name === 'string' ? detail.name.trim() : ''; var flow = detail.flow;
      if (!name || (flow !== 'research' && flow !== 'life')) return;
      tasks = tasks.filter(function (task) {
        var taskName = typeof task.project === 'string' ? task.project.trim() : '';
        var taskFlow = task.flow || (taskName === '兴趣与运动' ? 'life' : 'research');
        return !(taskName === name && taskFlow === flow);
      });
      save();
    });
    window.addEventListener('workbench-move-task-project', function (event) {
      var detail = event.detail || {}; var id = Number(detail.id); var name = typeof detail.project === 'string' ? detail.project.trim() : ''; var flow = detail.flow;
      if (!name || (flow !== 'research' && flow !== 'life')) return;
      var moved = null; tasks.forEach(function (task) { if (task.id === id) moved = task; });
      if (!moved) return;
      moved.project = name; moved.flow = flow; save();
    });
    function pct(task) { if (!task.subtasks || !task.subtasks.length) return ''; var done = task.subtasks.filter(function (item) { return item.done; }).length; var items = task.subtasks.map(function (item, index) { return '<li class="' + (item.done ? 'subtask-done' : '') + '"><button type="button" data-safe-sub="' + index + '">' + (item.done ? '✓' : '○') + '</button><span>' + item.text + '</span><button class="edit-subtask" type="button" data-safe-edit="' + index + '">编辑</button></li>'; }).join(''); return '<div class="progress-label"><span>子任务进度</span><b>' + Math.round(done / task.subtasks.length * 100) + '%</b></div><div class="progress-track"><i style="width:' + Math.round(done / task.subtasks.length * 100) + '%"></i></div><div class="subtask-count">' + done + '/' + task.subtasks.length + ' 已完成</div><ul class="subtask-list">' + items + '</ul>'; }
    function card(task) { var delay = task.delayCount ? '<b class="delay-badge">延期 ' + task.delayCount + ' 次</b>' : ''; var focus = task.focusDate === todayKey() ? '<b class="focus-badge">今日重点</b>' : ''; var plan = task.dueDate ? '计划：' + task.dueDate : '本周待排期'; var meta = '<small class="auto-meta">' + plan + ' · ' + task.estimate + ' 分钟 · ' + task.energy + '</small>'; return '<article class="task flow-' + task.flow + '" draggable="true" title="点击编辑任务" data-safe-id="' + task.id + '"><div class="task-top"><strong>' + task.title + '</strong></div><span>' + task.project + ' · ' + task.output + '</span>' + meta + focus + delay + pct(task) + '<div class="task-actions"><button type="button" data-safe-action="subtask">＋ 子任务</button><button type="button" data-safe-action="schedule">安排到今天</button><button class="check" type="button" data-safe-action="done">' + (task.status === 'done' ? '↺ 恢复' : '✓ 完成') + '</button></div></article>'; }
    function bind() {
      var cards = document.querySelectorAll('[data-safe-id]');
      for (var i = 0; i < cards.length; i++) {
        cards[i].ondragstart = function (event) { event.dataTransfer.setData('text/plain', this.getAttribute('data-safe-id')); };
        cards[i].onclick = function () { openEditTask(Number(this.getAttribute('data-safe-id'))); };
        var buttons = cards[i].querySelectorAll('button');
        for (var j = 0; j < buttons.length; j++) buttons[j].onclick = function (event) { event.stopPropagation(); var card = this.closest('[data-safe-id]'); var task = tasks.filter(function (item) { return item.id === Number(card.getAttribute('data-safe-id')); })[0]; if (!task) return; var subIndex = this.getAttribute('data-safe-sub'); var editIndex = this.getAttribute('data-safe-edit'); if (subIndex !== null) { task.subtasks[Number(subIndex)].done = !task.subtasks[Number(subIndex)].done; task.status = task.subtasks.every(function (item) { return item.done; }) ? 'done' : (task.status === 'done' ? 'doing' : task.status); if (task.status === 'done') task.completedDate = todayKey(); } else if (editIndex !== null) { var updated = prompt('修改子任务：', task.subtasks[Number(editIndex)].text); if (updated && updated.trim()) task.subtasks[Number(editIndex)].text = updated.trim(); } else if (this.getAttribute('data-safe-action') === 'schedule') { task.dueDate = todayKey(); } else if (this.getAttribute('data-safe-action') === 'done') { task.status = task.status === 'done' ? 'doing' : 'done'; if (task.status === 'done') task.completedDate = todayKey(); else { task.completedDate = null; task.dueDate = todayKey(); } } else { var text = prompt('新增子任务：'); if (text) task.subtasks.push({ text: text, done: false }); } save(); };
      }
      var columns = document.querySelectorAll('[data-safe-status]');
      for (var k = 0; k < columns.length; k++) { columns[k].ondragover = function (event) { event.preventDefault(); }; columns[k].ondrop = function (event) { event.preventDefault(); var id = Number(event.dataTransfer.getData('text/plain')); var next = this.getAttribute('data-safe-status'); var moving = tasks.filter(function (item) { return item.id === id; })[0]; if (activeFlow === 'research' && next === 'doing' && moving && moving.status !== 'doing' && tasks.filter(function (item) { return item.flow === 'research' && item.status === 'doing'; }).length >= 2) { alert('科研流的深度推进最多同时保留 2 项，请先完成、复核或移出其中一项。'); return; } for (var x = 0; x < tasks.length; x++) if (tasks[x].id === id) tasks[x].status = next; save(); }; }
    }
    function draw() {
      window.dispatchEvent(new CustomEvent('workbench-tasks-updated', { detail: tasks }));
      var d = new Date(); byId('date-label').textContent = (d.getMonth() + 1) + '月' + d.getDate() + '日 · 星期' + '日一二三四五六'.charAt(d.getDay());
      var schedule = ''; Object.keys(slots).forEach(function (name) { var s = slots[name]; var inside = tasks.filter(function (task) { return task.slot === name && task.status !== 'done' && task.dueDate === todayKey(); }).map(card).join('') || '<p class="side-note">留白：不额外填任务。</p>'; schedule += '<section class="slot"><h3>' + s[0] + '</h3><small>' + s[1] + ' · ' + s[2] + '</small>' + inside + '</section>'; }); byId('schedule').innerHTML = schedule;
      labels = activeFlow === 'research' ? researchLabels : lifeLabels; var banner = byId('flow-banner'); if (banner) { banner.className = 'flow-banner ' + activeFlow; banner.innerHTML = activeFlow === 'research' ? '<span>RESEARCH FLOW</span><strong>科研工作流</strong><small>研究池 → 本周承诺 → 深度推进 → 待复核 → 可汇报成果</small>' : '<span>LIFE FLOW</span><strong>日常生活兴趣爱好流</strong><small>灵感清单 → 本周想做 → 今日行动 → 体验 / 作品记录</small>'; } var board = ''; Object.keys(labels).forEach(function (name) { var inside = tasks.filter(function (task) { return task.flow === activeFlow && task.status === name && (name !== 'done' || task.completedDate === todayKey()); }).map(card).join('') || '<p class="empty">拖放任务至此</p>'; board += '<section class="column" data-safe-status="' + name + '"><h3>' + labels[name] + '</h3>' + inside + '</section>'; }); byId('board').innerHTML = board;
      byId('done-count').textContent = tasks.filter(function (task) { return task.status === 'done'; }).length; var archive = byId('archive-list'); if (archive) archive.innerHTML = tasks.filter(function (task) { return task.status === 'done' && task.completedDate !== todayKey() && task.completedDate >= weekStartKey(); }).map(function (task) { return '<article class="archive-item" data-safe-id="' + task.id + '" title="点击编辑任务"><strong>' + task.title + '</strong><span>完成于 ' + task.completedDate + (task.delayCount ? ' · 延期 ' + task.delayCount + ' 次' : ' · 未延期') + '</span></article>'; }).join('') || '<p class="empty">本周暂无历史归档。</p>'; bind();
    }
    var navs = document.querySelectorAll('.nav'); for (var n = 0; n < navs.length; n++) navs[n].onclick = function () { for (var q = 0; q < navs.length; q++) navs[q].classList.remove('active'); this.classList.add('active'); if (this.getAttribute('data-flow')) activeFlow = this.getAttribute('data-flow'); var views = document.querySelectorAll('.view'); for (var r = 0; r < views.length; r++) views[r].hidden = true; byId(this.getAttribute('data-view') + '-view').hidden = false; byId('view-title').textContent = this.textContent; draw(); };
    byId('new-task').onclick = function () { byId('task-dialog').showModal(); };
    function refreshStatusOptions(keep) { var research = byId('task-flow').value === 'research'; var options = research ? researchLabels : lifeLabels; var status = byId('task-status'); var selected = (typeof keep === 'string' && options[keep]) ? keep : status.value; status.innerHTML = ''; ['inbox','week','doing','verify','report'].forEach(function (key) { var option = document.createElement('option'); option.value = key; option.textContent = options[key]; status.appendChild(option); }); if (editingId !== null) { var doneOption = document.createElement('option'); doneOption.value = 'done'; doneOption.textContent = options.done; status.appendChild(doneOption); } status.value = options[selected] ? selected : 'inbox'; }
    function openTaskDialog(task) {
      editingId = task ? task.id : null;
      byId('task-dialog-title').textContent = task ? '编辑任务' : '新建任务';
      byId('task-save-button').textContent = task ? '保存修改' : '保存任务';
      if (!task) {
        byId('task-form').reset();
        byId('task-flow').value = activeFlow === 'life' ? 'life' : 'research';
        refreshStatusOptions();
        byId('task-slot').value = 'morning';
        byId('task-unscheduled').checked = false;
        byId('task-date').disabled = false;
        byId('task-date').required = true;
        byId('task-date').value = todayKey();
      } else {
        var items = Array.isArray(task.subtasks) ? task.subtasks : [];
        byId('task-title').value = task.title || '';
        byId('task-flow').value = task.flow === 'life' ? 'life' : 'research';
        refreshStatusOptions(task.status);
        byId('task-status').value = task.status || 'inbox';
        byId('task-project').value = task.project || '';
        byId('task-slot').value = task.slot || 'morning';
        byId('task-output').value = (task.output && task.output !== '待设置完成标准') ? task.output : '';
        byId('task-subtasks').value = items.map(function (item) { return item.text; }).join('\n');
        byId('task-large').checked = !!task.isLarge || items.length > 0;
        var noDate = !task.dueDate;
        byId('task-unscheduled').checked = noDate;
        byId('task-date').disabled = noDate;
        byId('task-date').required = !noDate;
        byId('task-date').value = noDate ? '' : task.dueDate;
      }
      byId('task-dialog').showModal();
    }
    function openEditTask(id) { var found = null; tasks.forEach(function (item) { if (item.id === id) found = item; }); if (found) openTaskDialog(found); } byId('task-flow').onchange = refreshStatusOptions; refreshStatusOptions(); byId('task-date').min = todayKey(); byId('task-date').value = todayKey(); byId('task-unscheduled').onchange = function () { byId('task-date').disabled = this.checked; byId('task-date').required = !this.checked; if (this.checked) byId('task-date').value = ''; else byId('task-date').value = todayKey(); }; byId('new-task').onclick = function () { openTaskDialog(null); }; window.addEventListener('workbench-edit-task', function (event) { openEditTask(Number((event.detail || {}).id)); }); var closers = document.querySelectorAll('.close-dialog'); for (var c = 0; c < closers.length; c++) closers[c].onclick = function () { var dialog = this.closest('dialog'); if (dialog) dialog.close(); }; byId('task-form').onsubmit = function (event) { event.preventDefault(); var title = byId('task-title').value.trim(); if (!title) return; var current = null; if (editingId !== null) tasks.forEach(function (item) { if (item.id === editingId) current = item; }); var flow = byId('task-flow').value; var status = byId('task-status').value; if ((!current || current.status !== 'doing') && flow === 'research' && status === 'doing' && tasks.filter(function (item) { return item.flow === 'research' && item.status === 'doing'; }).length >= 2) { alert('科研流的深度推进最多同时保留 2 项。'); return; } var lines = byId('task-subtasks').value.split(/\r?\n/).map(function (item) { return item.trim(); }).filter(Boolean);       var fields = { title: title, flow: flow, project: byId('task-project').value, slot: byId('task-slot').value, status: status, output: byId('task-output').value || '待设置完成标准', dueDate: byId('task-unscheduled').checked ? null : (byId('task-date').value || todayKey()), isLarge: byId('task-large').checked || lines.length > 0 };
      if (current) {
        var wasDone = current.status === 'done';
        var previous = Array.isArray(current.subtasks) ? current.subtasks : [];
        Object.keys(fields).forEach(function (name) { current[name] = fields[name]; });
        var meta = autoMeta(current); current.estimate = meta.estimate; current.energy = meta.energy;
        current.subtasks = lines.map(function (text) { var hit = null; previous.forEach(function (item) { if (!hit && item.text === text) hit = item; }); return { text: text, done: hit ? !!hit.done : false }; });
        if (status === 'done') { if (!wasDone) current.subtasks.forEach(function (item) { item.done = true; }); current.completedDate = current.completedDate || todayKey(); } else { current.completedDate = null; }
      } else {
        var fresh = autoMeta({ title: title, project: fields.project });
        tasks.push({ id: Date.now(), title: title, flow: flow, project: fields.project, slot: fields.slot, status: status, output: fields.output, dueDate: fields.dueDate, delayCount: 0, isLarge: fields.isLarge, estimate: fresh.estimate, energy: fresh.energy, subtasks: lines.map(function (text) { return { text: text, done: false }; }) });
      } editingId = null; byId('task-dialog').close(); this.reset(); refreshStatusOptions(); save(); };
    draw();
  }, 0);
})();
