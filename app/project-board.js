(() => {
  const orderKey = 'xingzhi-project-order-v1';
  const root = document.getElementById('projects-view');
  let tasks = [];
  let dragging = null;
  let draggingTask = null;
  const expandedProjects = new Set();
  const read = (key, fallback) => {
    try { return JSON.parse(localStorage.getItem(key)) || fallback; }
    catch (_) { return fallback; }
  };
  const taskKey = () => window.workbenchReady ? 'personal-research-workbench-v2' : 'personal-research-workbench-safe-v1';
  function syncSavedTasks() {
    const stored = read(taskKey(), []);
    tasks = Array.isArray(stored) ? stored : [];
    render();
  }
  const flowOf = task => {
    const name = typeof task.project === 'string' ? task.project.trim() : '';
    return task.flow || (name === '兴趣与运动' ? 'life' : 'research');
  };
  const flowLabel = flow => flow === 'life' ? '日常生活流' : '科研工作流';
  let order = read(orderKey, {});
  if (!order || typeof order !== 'object' || Array.isArray(order)) order = {};
  const groupProjects = flow => {
    const groups = new Map();
    tasks.forEach(task => {
      const name = typeof task.project === 'string' ? task.project.trim() : '';
      if (!name || flowOf(task) !== flow) return;
      if (!groups.has(name)) groups.set(name, { name, total: 0, pending: 0, tasks: [] });
      const project = groups.get(name);
      project.total += 1;
      if (task.status !== 'done') project.pending += 1;
      project.tasks.push(task);
    });
    const saved = Array.isArray(order[flow]) ? order[flow] : [];
    const names = [...new Set([...saved.filter(name => groups.has(name)), ...groups.keys()])];
    return names.map(name => groups.get(name));
  };
  function setStatus(text, action) {
    const status = document.getElementById('project-sort-status');
    status.replaceChildren();
    status.append(document.createTextNode(text));
    if (action) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'project-undo-button';
      button.textContent = action.label;
      button.onclick = action.onClick;
      status.append(' ', button);
    }
  }
  function saveOrder(flow, names) {
    order[flow] = names;
    try {
      localStorage.setItem(orderKey, JSON.stringify(order));
      setStatus('项目顺序已保存');
    } catch (_) {
      setStatus('浏览器未能保存顺序，请检查本地存储空间');
    }
    render();
  }
  function move(flow, name, delta) {
    const names = groupProjects(flow).map(project => project.name);
    const index = names.indexOf(name);
    const next = index + delta;
    if (index < 0 || next < 0 || next >= names.length) return;
    [names[index], names[next]] = [names[next], names[index]];
    saveOrder(flow, names);
  }
  function deleteProject(flow, name) {
    const count = tasks.filter(task => {
      const taskName = typeof task.project === 'string' ? task.project.trim() : '';
      return taskName === name && flowOf(task) === flow;
    }).length;
    if (!count || !window.confirm(`删除项目“${name}”？该项目下的 ${count} 项任务也会从今日专注和对应流线中删除。此操作不可自动恢复。`)) return;
    window.dispatchEvent(new CustomEvent('workbench-delete-project', { detail: { flow, name } }));
  }
  // 任务改属：把任务拖到别的项目卡片上，直接改 project（跨流线时同时改 flow）
  function applyTaskMove(task, target) {
    window.dispatchEvent(new CustomEvent('workbench-move-task-project', { detail: { id: task.id, project: target.name, flow: target.flow } }));
  }
  function clearTaskDrop() {
    root.querySelectorAll('.project-card.project-task-drop').forEach(card => card.classList.remove('project-task-drop'));
  }
  function moveTaskToProject(task, target) {
    const unchanged = task.project === target.name && task.flow === target.flow;
    const from = { name: task.project, flow: task.flow };
    draggingTask = null;
    clearTaskDrop();
    if (unchanged) { setStatus(`「${task.title}」已经在这个项目下`); return; }
    applyTaskMove(task, target);
    setStatus(`已将「${task.title}」移动到「${target.name}」${target.flow === from.flow ? '' : `（同时切换到${flowLabel(target.flow)}）`}`, {
      label: '撤销',
      onClick: () => {
        applyTaskMove(task, from);
        setStatus(`已把「${task.title}」移回「${from.name}」`);
      }
    });
  }
  function render() {
    let total = 0;
    ['research', 'life'].forEach(flow => {
      const list = document.getElementById('projects-' + flow);
      const projects = groupProjects(flow);
      total += projects.length;
      document.getElementById('projects-' + flow + '-count').textContent = projects.length;
      list.replaceChildren();
      if (!projects.length) {
        const empty = document.createElement('p');
        empty.className = 'project-empty';
        empty.textContent = '暂无项目。在新建任务时填写项目名称，保存后会自动显示在这里。';
        list.append(empty);
      }
      projects.forEach((project, index) => {
        const projectKey = `${flow}::${project.name}`;
        const expanded = expandedProjects.has(projectKey);
        const card = document.createElement('li');
        card.className = 'project-card';
        card.draggable = true;
        card.dataset.project = project.name;
        card.dataset.flow = flow;
        const handle = document.createElement('span');
        handle.className = 'project-handle';
        handle.textContent = '⠿';
        handle.setAttribute('aria-hidden', 'true');
        const content = document.createElement('div');
        content.className = 'project-content';
        const name = document.createElement('h3');
        name.textContent = project.name;
        const meta = document.createElement('p');
        meta.textContent = `${project.total} 项任务 · ${project.pending} 项未完成`;
        content.append(name, meta);
        const controls = document.createElement('div');
        controls.className = 'project-sort-buttons';
        [-1, 1].forEach(delta => {
          const button = document.createElement('button');
          button.type = 'button';
          button.textContent = delta < 0 ? '↑' : '↓';
          button.setAttribute('aria-label', `${delta < 0 ? '上移' : '下移'}项目：${project.name}`);
          button.disabled = delta < 0 ? index === 0 : index === projects.length - 1;
          button.onclick = () => move(flow, project.name, delta);
          controls.append(button);
        });
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'project-delete-button';
        remove.textContent = '删除';
        remove.setAttribute('aria-label', `删除项目：${project.name}`);
        remove.onclick = event => { event.stopPropagation(); deleteProject(flow, project.name); };
        controls.append(remove);
        // 计数只统计“还没完成的任务”，按任务而不是子任务计数：
        // 没有子任务的任务同样会被算进去，不会再出现有任务却显示 0 的情况。
        const pendingLabel = project.pending ? `${project.pending} 项未完成` : '全部已完成';
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'project-subtask-toggle';
        toggle.textContent = `${expanded ? '收起任务' : '展开任务'}（${pendingLabel}）`;
        toggle.setAttribute('aria-label', `${expanded ? '收起' : '展开'}项目“${project.name}”的任务：${pendingLabel}`);
        toggle.setAttribute('aria-expanded', String(expanded));
        toggle.onclick = event => {
          event.stopPropagation();
          if (expandedProjects.has(projectKey)) expandedProjects.delete(projectKey);
          else expandedProjects.add(projectKey);
          render();
        };
        controls.append(toggle);
        const panel = document.createElement('div');
        panel.className = 'project-subtask-panel';
        panel.hidden = !expanded;
        if (expanded) {
          const hint = document.createElement('p');
          hint.className = 'project-task-hint';
          hint.textContent = '点击任务可回到任务界面重新编辑；拖动任务到其他项目卡片，即可更改任务所属项目。';
          panel.append(hint);
        }
        project.tasks.forEach(task => {
          const done = task.status === 'done';
          const taskRow = document.createElement('section');
          taskRow.className = `project-task-row ${done ? 'is-done' : 'is-pending'}`;
          taskRow.draggable = true;
          taskRow.dataset.taskId = String(task.id);
          taskRow.title = '点击编辑任务；拖动到其他项目卡片可更改所属项目';
          const head = document.createElement('div');
          head.className = 'project-task-head';
          const taskTitle = document.createElement('h4');
          taskTitle.textContent = task.title || '未命名任务';
          const taskStatus = document.createElement('span');
          taskStatus.className = `project-task-status ${done ? 'is-done' : 'is-pending'}`;
          taskStatus.textContent = done ? '✓ 已完成' : '○ 待完成';
          head.append(taskTitle, taskStatus);
          taskRow.append(head);
          const subtasks = document.createElement('ul');
          subtasks.className = 'project-subtask-list';
          const taskItems = Array.isArray(task.subtasks) ? task.subtasks : [];
          if (!taskItems.length) {
            const empty = document.createElement('li');
            empty.className = 'project-subtask-empty';
            empty.textContent = '暂无子任务';
            subtasks.append(empty);
          } else {
            taskItems.forEach(item => {
              const itemRow = document.createElement('li');
              itemRow.className = item.done ? 'is-done' : 'is-pending';
              itemRow.textContent = `${item.done ? '✓' : '○'} ${item.text || '未命名子任务'}`;
              subtasks.append(itemRow);
            });
          }
          taskRow.append(subtasks);
          taskRow.addEventListener('dragstart', event => {
            event.stopPropagation();
            draggingTask = { id: task.id, title: task.title || '未命名任务', project: project.name, flow };
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('application/x-xingzhi-task', String(task.id));
            taskRow.classList.add('project-task-dragging');
            setStatus('把任务拖到其他项目卡片上，即可更改所属项目');
          });
          taskRow.addEventListener('dragend', () => {
            draggingTask = null;
            taskRow.classList.remove('project-task-dragging');
            clearTaskDrop();
          });
          // 点击任务行 → 打开任务弹窗重新编辑（实际由任务数据层处理）
          taskRow.addEventListener('click', event => {
            event.stopPropagation();
            window.dispatchEvent(new CustomEvent('workbench-edit-task', { detail: { id: task.id } }));
          });
          panel.append(taskRow);
        });
        card.append(handle, content, controls, panel);
        card.addEventListener('dragstart', event => {
          if (draggingTask) return;
          dragging = { flow, name: project.name };
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('application/x-xingzhi-project', project.name);
          card.classList.add('project-dragging');
          setStatus('');
        });
        card.addEventListener('dragover', event => {
          if (draggingTask) {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
            root.querySelectorAll('.project-card.project-task-drop').forEach(item => { if (item !== card) item.classList.remove('project-task-drop'); });
            card.classList.add('project-task-drop');
            return;
          }
          if (!dragging || dragging.flow !== flow || dragging.name === project.name) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
          const after = event.clientY > card.getBoundingClientRect().top + card.offsetHeight / 2;
          card.classList.toggle('project-drop-after', after);
          card.classList.toggle('project-drop-before', !after);
        });
        const clearDrop = () => card.classList.remove('project-drop-before', 'project-drop-after');
        card.addEventListener('dragleave', clearDrop);
        card.addEventListener('drop', event => {
          if (draggingTask) {
            event.preventDefault();
            event.stopPropagation();
            moveTaskToProject(draggingTask, { name: project.name, flow });
            return;
          }
          if (!dragging || dragging.flow !== flow || dragging.name === project.name) return;
          event.preventDefault();
          event.stopPropagation();
          const after = event.clientY > card.getBoundingClientRect().top + card.offsetHeight / 2;
          const names = groupProjects(flow).map(item => item.name).filter(name => name !== dragging.name);
          names.splice(names.indexOf(project.name) + (after ? 1 : 0), 0, dragging.name);
          dragging = null;
          saveOrder(flow, names);
        });
        card.addEventListener('dragend', () => {
          dragging = null;
          clearDrop();
          clearTaskDrop();
          root.querySelectorAll('.project-card').forEach(item => item.classList.remove('project-dragging'));
        });
        list.append(card);
      });
    });
    document.getElementById('projects-total').textContent = total;
  }
  window.addEventListener('workbench-tasks-updated', event => {
    tasks = Array.isArray(event.detail) ? event.detail : [];
    render();
  });
  window.addEventListener('storage', event => {
    if (event.key === orderKey) { order = read(orderKey, {}); render(); }
    else if (event.key === taskKey() || event.key === null) syncSavedTasks();
  });
  // Read the same saved data as the task views, even when an older cached
  // task script does not send the update event.
  document.getElementById('task-form').addEventListener('submit', () => {
    queueMicrotask(syncSavedTasks);
  });
  document.querySelector('[data-view="projects"]').addEventListener('click', () => {
    queueMicrotask(syncSavedTasks);
  });
  window.addEventListener('DOMContentLoaded', syncSavedTasks);
  window.addEventListener('focus', syncSavedTasks);
  syncSavedTasks();
})();
