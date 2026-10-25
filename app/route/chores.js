/* chores.js —— 家务/琐事轨道（与科研、兴趣主线完全隔离）
 *
 * 为什么单独存：项目看板 / 今日专注 / 科研工作流 / 日常生活流 是"主线"，
 * 洗衣服、整理内务这类琐事如果混进去，会把专注内容切碎、破坏仪式感。
 * 所以这里用独立的 localStorage key，只被"今日路线"读取，只填时间轴的空档。
 */
(function (root) {
  "use strict";
  var KEY = "xingzhi-chores-v1";
  var HYG = "xingzhi-hygiene-v1";

  function todayKey(d) {
    d = d || new Date();
    return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
  }
  function read(key, fallback) {
    try { var v = JSON.parse(localStorage.getItem(key) || "null"); return v == null ? fallback : v; } catch (e) { return fallback; }
  }
  function write(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {} }

  var api = {
    todayKey: todayKey,

    /* ---------- 今日家务 ---------- */
    list: function (date) {
      var all = read(KEY, {});
      var d = date || todayKey();
      return (all[d] || []).slice();
    },
    add: function (name, opts) {
      opts = opts || {};
      var d = opts.date || todayKey();
      var all = read(KEY, {});
      all[d] = all[d] || [];
      if (!name || !String(name).trim()) return null;
      var item = {
        id: "c" + Date.now() + Math.floor(Math.random() * 1000),
        name: String(name).trim().slice(0, 24),
        dur: Math.max(5, Math.min(90, Number(opts.dur) || 20)),
        poi: opts.poi || "D12",
        done: false
      };
      all[d].push(item);
      write(KEY, all);
      return item;
    },
    toggle: function (id, date) {
      var d = date || todayKey();
      var all = read(KEY, {});
      (all[d] || []).forEach(function (c) { if (c.id === id) c.done = !c.done; });
      write(KEY, all);
    },
    remove: function (id, date) {
      var d = date || todayKey();
      var all = read(KEY, {});
      all[d] = (all[d] || []).filter(function (c) { return c.id !== id; });
      write(KEY, all);
    },
    clearDone: function (date) {
      var d = date || todayKey();
      var all = read(KEY, {});
      all[d] = (all[d] || []).filter(function (c) { return !c.done; });
      write(KEY, all);
    },

    /* ---------- 今天要不要洗澡 / 洗漱（每天点一下） ---------- */
    hygiene: function (date) {
      var d = date || todayKey();
      var all = read(HYG, {});
      var v = all[d];
      if (!v) v = { shower: true, washup: true };   // 默认：都要
      return { shower: v.shower !== false, washup: v.washup !== false };
    },
    setHygiene: function (part, val, date) {
      var d = date || todayKey();
      var all = read(HYG, {});
      var v = all[d] || { shower: true, washup: true };
      v[part] = !!val;
      all[d] = v;
      write(HYG, all);
      return v;
    }
  };
  root.PlanChores = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
