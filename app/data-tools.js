(() => {
  const mainKey = 'personal-research-workbench-v2';
  const safeKey = 'personal-research-workbench-safe-v1';
  const weeklyKey = 'xingzhi-weekly-notes-v1';
  const journalKey = 'xingzhi-daily-journal-v1';
  const orderKey = 'xingzhi-project-order-v1';
  const activeKey = () => window.workbenchReady ? mainKey : safeKey;
  const exportButton = document.getElementById('export-data');
  const importButton = document.getElementById('import-data');
  const input = document.getElementById('import-file');
  const readJSON = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key) || 'null') || fallback; } catch (error) { return fallback; } };
  exportButton.onclick = () => {
    let tasks = [];
    try { tasks = JSON.parse(localStorage.getItem(activeKey()) || '[]'); } catch (error) { alert('当前本地数据无法读取，请先刷新页面。'); return; }
    const weeklyNotes = localStorage.getItem(weeklyKey) || '';
    const journalEntries = readJSON(journalKey, {});
    const projectOrder = readJSON(orderKey, {});
    const file = new Blob([JSON.stringify({ app: '行止之间', version: 2, exportedAt: new Date().toISOString(), tasks, weeklyNotes, journalEntries, projectOrder }, null, 2)], { type: 'application/json' });
    const link = document.createElement('a'); link.href = URL.createObjectURL(file); link.download = `行止之间-备份-${new Date().toISOString().slice(0, 10)}.json`; link.click(); URL.revokeObjectURL(link.href);
  };
  importButton.onclick = () => input.click();
  input.onchange = async () => {
    const file = input.files[0]; if (!file) return;
    try {
      const backup = JSON.parse(await file.text());
      if (!backup || !Array.isArray(backup.tasks)) throw new Error('invalid');
      const diaryCount = backup.journalEntries ? Object.keys(backup.journalEntries).length : 0;
      if (!confirm(`将导入 ${backup.tasks.length} 项任务、${diaryCount} 条日记，并替换当前本地任务/复盘/日记。是否继续？`)) return;
      const content = JSON.stringify(backup.tasks);
      localStorage.setItem(mainKey, content); localStorage.setItem(safeKey, content);
      localStorage.setItem(weeklyKey, backup.weeklyNotes || '');
      localStorage.setItem(journalKey, JSON.stringify(backup.journalEntries || {}));
      localStorage.setItem(orderKey, JSON.stringify(backup.projectOrder || {}));
      location.reload();
    } catch (error) { alert('不是有效的“行止之间”备份文件。'); }
    input.value = '';
  };
})();
