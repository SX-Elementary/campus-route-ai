(() => {
  const mainKey = 'personal-research-workbench-v2';
  const safeKey = 'personal-research-workbench-safe-v1';
  const dayKey = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  let offset = 0;
  const dataKey = () => window.workbenchReady ? mainKey : safeKey;
  const load = () => { try { return JSON.parse(localStorage.getItem(dataKey()) || '[]'); } catch (error) { return []; } };
  const save = tasks => localStorage.setItem(dataKey(), JSON.stringify(tasks));
  const suggest = (tasks, flow, index) => tasks.filter(task => task.flow === flow && task.status !== 'done' && (task.dueDate && task.dueDate <= dayKey())).sort((a, b) => (b.delayCount || 0) - (a.delayCount || 0) || (b.estimate || 60) - (a.estimate || 60))[index % Math.max(1, tasks.filter(task => task.flow === flow && task.status !== 'done' && (task.dueDate && task.dueDate <= dayKey())).length)];
  const card = (task, flow) => task ? `<article class="startup-card ${flow}"><span>${flow === 'research' ? '科研工作流' : '日常生活流'}</span><h2>${task.title}</h2><p>${task.project} · ${task.estimate || 60} 分钟 · ${task.energy || '中等专注'}</p>${task.delayCount ? `<b>延期 ${task.delayCount} 次，建议优先处理</b>` : '<b>今日可专注完成</b>'}</article>` : `<article class="startup-card ${flow}"><span>${flow === 'research' ? '科研工作流' : '日常生活流'}</span><h2>今天留白</h2><p>当前没有待完成任务。</p></article>`;
  const render = () => { const tasks = load(); const research = suggest(tasks, 'research', offset); const life = suggest(tasks, 'life', offset); document.getElementById('startup-grid').innerHTML = card(research, 'research') + card(life, 'life'); document.getElementById('confirm-focus').dataset.research = research ? research.id : ''; document.getElementById('confirm-focus').dataset.life = life ? life.id : ''; };
  document.querySelector('[data-view="startup"]').onclick = () => { document.querySelectorAll('.nav').forEach(button => button.classList.remove('active')); document.querySelector('[data-view="startup"]').classList.add('active'); document.querySelectorAll('.view').forEach(view => view.hidden = true); document.getElementById('startup-view').hidden = false; document.getElementById('view-title').textContent = '每日启动'; render(); };
  document.getElementById('refresh-focus').onclick = () => { offset += 1; render(); };
  document.getElementById('confirm-focus').onclick = event => { const tasks = load(); [event.currentTarget.dataset.research, event.currentTarget.dataset.life].filter(Boolean).forEach(id => { const task = tasks.find(item => item.id === Number(id)); if (task) task.focusDate = dayKey(); }); save(tasks); alert('今日重点已确认：只守住这两件事即可。'); location.reload(); };
  render();
})();
