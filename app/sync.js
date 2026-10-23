/* 行止之间 · 云端同步（可选）
 * 有 /api/ 同步服务时：自动把本机数据同步到云端，并在多台设备之间保持一致。
 * 没有同步服务时（本地运行、直接打开文件）：完全静默，仍按原来的 localStorage 方式工作。
 */
(() => {
  'use strict';
  const API = typeof window.__XINGZHI_SYNC_API === 'string' ? window.__XINGZHI_SYNC_API : 'api/';
  const MAIN_KEY = 'personal-research-workbench-v2';
  const SAFE_KEY = 'personal-research-workbench-safe-v1';
  const ORDER_KEY = 'xingzhi-project-order-v1';
  const WEEKLY_KEY = 'xingzhi-weekly-notes-v1';
  const JOURNAL_KEY = 'xingzhi-daily-journal-v1';
  const META_KEY = 'xingzhi-sync-meta-v1';
  const RELOAD_FLAG = 'xingzhi-sync-adopted';
  const ADOPT_AT = 'xingzhi-sync-adopt-at';
  const WATCH = [MAIN_KEY, SAFE_KEY, ORDER_KEY, WEEKLY_KEY, JOURNAL_KEY];

  let rawGet;
  let rawSet;
  try {
    rawGet = localStorage.getItem.bind(localStorage);
    rawSet = localStorage.setItem.bind(localStorage);
  } catch (error) {
    return; // 浏览器禁用了本地存储时直接退出，不影响页面本身
  }
  const readJSON = (key, fallback) => {
    try {
      const value = JSON.parse(rawGet(key) || 'null');
      return value === null || value === undefined ? fallback : value;
    } catch (error) { return fallback; }
  };

  const storedMeta = readJSON(META_KEY, null);
  const hasMeta = !!storedMeta;
  const state = storedMeta || { revision: 0, dirty: false, lastSyncAt: 0 };
  const saveMeta = () => rawSet(META_KEY, JSON.stringify(state));

  let writing = false;
  let online = false;
  let pushing = false;
  let pushTimer = null;
  let statusEl = null;
  let barEl = null;

  const clockText = () => new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  const deviceName = () => {
    const ua = navigator.userAgent;
    const platform = /Android/i.test(ua) ? 'Android' : /iPhone|iPad|iPod/i.test(ua) ? 'iOS' : /Windows/i.test(ua) ? 'Windows' : /Mac OS X/i.test(ua) ? 'Mac' : /Linux/i.test(ua) ? 'Linux' : '设备';
    const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '浏览器';
    return `${platform} · ${browser}`;
  };

  const collect = () => ({
    app: '行止之间',
    version: 2,
    exportedAt: new Date().toISOString(),
    tasks: readJSON(SAFE_KEY, null) || readJSON(MAIN_KEY, []) || [],
    weeklyNotes: rawGet(WEEKLY_KEY) || '',
    journalEntries: readJSON(JOURNAL_KEY, {}),
    projectOrder: readJSON(ORDER_KEY, {})
  });

  const apply = payload => {
    writing = true;
    try {
      const tasks = JSON.stringify(payload.tasks || []);
      rawSet(SAFE_KEY, tasks);
      rawSet(MAIN_KEY, tasks);
      rawSet(WEEKLY_KEY, payload.weeklyNotes || '');
      rawSet(JOURNAL_KEY, JSON.stringify(payload.journalEntries || {}));
      rawSet(ORDER_KEY, JSON.stringify(payload.projectOrder || {}));
    } finally { writing = false; }
  };

  const request = async (method, path, body) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      return await fetch(API + path, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
        credentials: 'same-origin',
        cache: 'no-store'
      });
    } finally { clearTimeout(timer); }
  };

  const setStatus = (text, kind) => {
    if (!statusEl) return;
    statusEl.textContent = '云同步：' + text;
    statusEl.style.color = kind === 'ok' ? '#0f766e' : kind === 'warn' ? '#b45309' : '#64748b';
  };

  const installStatus = () => {
    if (statusEl) return;
    statusEl = document.createElement('div');
    statusEl.id = 'sync-status';
    statusEl.style.cssText = 'margin-top:auto;font-size:13px;line-height:1.6;color:#64748b';
    const sidebar = document.querySelector('.sidebar');
    (sidebar || document.body).append(statusEl);
    setStatus('连接中…', '');
  };

  const hideConflict = () => { if (barEl) { barEl.remove(); barEl = null; } };

  const showConflict = (server, firstTime) => {
    const serverCount = ((server.payload || {}).tasks || []).length;
    const localCount = (collect().tasks || []).length;
    if (!barEl) {
      barEl = document.createElement('div');
      barEl.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:9998;display:flex;flex-wrap:wrap;gap:10px;align-items:center;padding:12px 18px;background:#fff8e9;border-top:3px solid #e0a33a;font-size:14px;box-shadow:0 -6px 18px rgba(23,50,77,.12)';
      document.body.append(barEl);
    }
    barEl.replaceChildren();
    const text = document.createElement('span');
    text.textContent = firstTime
      ? `第一次连接云同步：云端有 ${serverCount} 项任务，这台设备本机有 ${localCount} 项任务，请选择保留哪一边（另一边的数据仍可在服务器历史快照里找回）。`
      : `云端有更新的数据：云端 ${serverCount} 项任务，本机 ${localCount} 项任务。`;
    text.style.flex = '1 1 320px';
    const useCloud = document.createElement('button');
    useCloud.type = 'button';
    useCloud.textContent = '用云端覆盖本机';
    useCloud.className = 'primary small';
    useCloud.onclick = () => {
      apply(server.payload || {});
      state.revision = server.revision;
      state.dirty = false;
      state.lastSyncAt = server.updatedAt;
      saveMeta();
      sessionStorage.removeItem(RELOAD_FLAG);
      location.reload();
    };
    const useLocal = document.createElement('button');
    useLocal.type = 'button';
    useLocal.textContent = '用本机覆盖云端';
    useLocal.className = 'primary small';
    useLocal.onclick = () => { state.revision = server.revision; state.dirty = true; saveMeta(); hideConflict(); push(true); };
    const later = document.createElement('button');
    later.type = 'button';
    later.textContent = '稍后决定';
    later.className = 'ghost small';
    later.onclick = () => { state.dirty = true; saveMeta(); hideConflict(); setStatus('未同步：本机改动还没上传', 'warn'); };
    barEl.append(text, useCloud, useLocal, later);
  };

  const push = async force => {
    if (pushing) return;
    pushing = true;
    setStatus('正在同步…', '');
    try {
      const response = await request('PUT', 'state', {
        baseRevision: state.revision || 0,
        device: deviceName(),
        payload: collect(),
        force: !!force
      });
      if (response.status === 409) {
        showConflict(await response.json(), false);
        setStatus('云端有更新的数据，请选择一次', 'warn');
      } else if (!response.ok) {
        throw new Error('HTTP ' + response.status);
      } else {
        const out = await response.json();
        state.revision = out.revision;
        state.dirty = false;
        state.lastSyncAt = out.updatedAt;
        saveMeta();
        hideConflict();
        setStatus('已同步 · ' + clockText(), 'ok');
      }
    } catch (error) {
      state.dirty = true;
      saveMeta();
      setStatus('同步失败，数据已保存在本机，稍后自动重试', 'warn');
    } finally {
      pushing = false;
    }
  };

  const schedulePush = () => {
    state.dirty = true;
    saveMeta();
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => { if (online) push(false); }, 800);
  };

  const markLocalChange = () => {
    if (writing) return;
    schedulePush();
    setStatus('本机有改动，正在上传…', '');
  };

  // 任何写入 localStorage 的改动（任务、顺序、复盘、日记）都会触发同步
  localStorage.setItem = function (key, value) {
    const before = rawGet(key);
    rawSet(key, value);
    if (WATCH.indexOf(key) >= 0 && before !== value) markLocalChange();
  };

  const adopt = server => {
    apply(server.payload || {});
    state.revision = server.revision;
    state.dirty = false;
    state.lastSyncAt = server.updatedAt;
    saveMeta();
    // 防护：同一设备 15 秒内最多自动刷新一次，避免极端情况下反复刷新
    const now = Date.now();
    const lastAdopt = Number(rawGet(ADOPT_AT) || 0) || 0;
    if (sessionStorage.getItem(RELOAD_FLAG) === '1' || now - lastAdopt < 15000) {
      setStatus('已从云端更新，刷新页面后生效', 'warn');
      return;
    }
    rawSet(ADOPT_AT, String(now));
    sessionStorage.setItem(RELOAD_FLAG, '1');
    location.reload();
  };

  const boot = async () => {
    let health;
    try {
      health = await request('GET', 'health');
    } catch (error) {
      return; // 没有云同步服务：本机模式，保持安静
    }
    if (!health.ok) return;
    online = true;
    installStatus();

    let response;
    try {
      response = await request('GET', 'state');
    } catch (error) {
      setStatus('云端暂时连不上，稍后自动重试', 'warn');
      return;
    }
    if (response.status === 204) {
      const localCount = (collect().tasks || []).length;
      if (localCount) { state.revision = 0; state.dirty = true; saveMeta(); push(true); }
      else setStatus('云端已就绪', 'ok');
      return;
    }
    if (!response.ok) {
      setStatus('云端读取失败（HTTP ' + response.status + '）', 'warn');
      return;
    }

    const server = await response.json();
    const serverCount = ((server.payload || {}).tasks || []).length;
    const localCount = (collect().tasks || []).length;

    if (!hasMeta) {
      if (localCount && serverCount) { showConflict(server, true); setStatus('第一次连接：请选择以哪一边为准', 'warn'); return; }
      if (localCount) { state.revision = server.revision; state.dirty = true; saveMeta(); push(false); return; }
      adopt(server);
      return;
    }
    if (state.revision === server.revision) {
      sessionStorage.removeItem(RELOAD_FLAG);
      if (state.dirty) push(false);
      else setStatus('已是最新 · ' + clockText(), 'ok');
      return;
    }
    if (state.dirty) { push(false); return; }
    adopt(server);
  };

  setInterval(() => { if (online && state.dirty && !pushing) push(false); }, 30000);
  window.addEventListener('online', () => { if (online && state.dirty) push(false); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && online && state.dirty) push(false); });

  window.xingzhiSync = {
    push: () => push(true),
    state: () => state,
    collect
  };

  boot();
})();
