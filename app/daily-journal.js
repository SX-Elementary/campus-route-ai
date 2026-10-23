(function () {
  var WEEKLY_KEY = 'xingzhi-weekly-notes-v1';
  var JOURNAL_KEY = 'xingzhi-daily-journal-v1';
  function byId(id) { return document.getElementById(id); }
  function todayKey(date) {
    var d = date || new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function loadJSON(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || 'null') || fallback; }
    catch (error) { return fallback; }
  }
  function saveJSON(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
  function stamp(target, text) {
    if (!target) return;
    target.textContent = text || ('已保存 · ' + new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }));
  }
  function initWeeklyNotes() {
    var notes = byId('weekly-notes');
    var saveButton = byId('save-weekly-notes');
    var copyButton = byId('copy-report');
    var status = byId('weekly-save-status');
    if (!notes) return;
    notes.value = localStorage.getItem(WEEKLY_KEY) || '';
    if (notes.value) stamp(status, '已载入上次复盘');
    var timer = null;
    function saveWeekly(silent) {
      localStorage.setItem(WEEKLY_KEY, notes.value);
      if (!silent) stamp(status);
    }
    notes.addEventListener('input', function () {
      stamp(status, '正在输入…');
      window.clearTimeout(timer);
      timer = window.setTimeout(function () { saveWeekly(false); }, 600);
    });
    if (saveButton) saveButton.onclick = function () { saveWeekly(false); };
    if (copyButton) copyButton.onclick = async function () {
      saveWeekly(true);
      var done = Array.from(document.querySelectorAll('#archive-list strong')).map(function (item) { return '- ' + item.textContent; }).join('\n') || '- 暂无';
      var text = '# 本周进展\n\n## 已完成\n' + done + '\n\n## 可展示成果 / 复盘记录\n' + (notes.value || '待补充') + '\n\n## 下周计划\n- ';
      await navigator.clipboard.writeText(text);
      stamp(status, '已复制并保存');
      alert('周报草稿已复制，复盘内容也已保存。');
    };
  }
  function initJournal() {
    var dateInput = byId('journal-date');
    var textarea = byId('daily-journal');
    var saveButton = byId('save-journal');
    var copyButton = byId('copy-journal');
    var todayButton = byId('new-journal-entry');
    var list = byId('journal-list');
    var status = byId('journal-save-status');
    if (!dateInput || !textarea) return;
    var entries = loadJSON(JOURNAL_KEY, {});
    function selectedDate() { return dateInput.value || todayKey(); }
    function renderList() {
      var dates = Object.keys(entries).filter(function (date) { return entries[date] && entries[date].trim(); }).sort().reverse().slice(0, 7);
      list.innerHTML = dates.length ? dates.map(function (date) {
        var preview = entries[date].trim().replace(/\s+/g, ' ').slice(0, 46);
        return '<button class="journal-entry" type="button" data-date="' + date + '"><strong>' + date + '</strong><span>' + preview + (entries[date].length > 46 ? '…' : '') + '</span></button>';
      }).join('') : '<p class="empty">还没有日记。写下第一条就会出现在这里。</p>';
      Array.from(list.querySelectorAll('[data-date]')).forEach(function (button) {
        button.onclick = function () { dateInput.value = button.getAttribute('data-date'); loadEntry(); };
      });
    }
    function loadEntry() {
      textarea.value = entries[selectedDate()] || '';
      stamp(status, textarea.value ? '已载入 ' + selectedDate() : '这天还没有记录');
    }
    function saveEntry(silent) {
      var key = selectedDate();
      entries[key] = textarea.value;
      saveJSON(JOURNAL_KEY, entries);
      renderList();
      if (!silent) stamp(status);
    }
    var timer = null;
    dateInput.value = todayKey();
    loadEntry();
    renderList();
    dateInput.addEventListener('change', loadEntry);
    textarea.addEventListener('input', function () {
      stamp(status, '正在输入…');
      window.clearTimeout(timer);
      timer = window.setTimeout(function () { saveEntry(false); }, 600);
    });
    if (saveButton) saveButton.onclick = function () { saveEntry(false); };
    if (todayButton) todayButton.onclick = function () { dateInput.value = todayKey(); loadEntry(); textarea.focus(); };
    if (copyButton) copyButton.onclick = async function () {
      saveEntry(true);
      var text = '# 每日规划日记 · ' + selectedDate() + '\n\n' + (textarea.value || '');
      await navigator.clipboard.writeText(text);
      stamp(status, '已复制并保存');
      alert('日记已复制，内容也已保存。');
    };
  }
  window.addEventListener('DOMContentLoaded', function () {
    initWeeklyNotes();
    initJournal();
  });
})();
