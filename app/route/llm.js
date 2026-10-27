/* route/llm.js —— API 适配层（可选）
 *
 * 设计原则：模型只做"理解"和"建议"，不直接产出时间表。
 *   - parseTasks(text) → 把"今晚八点去综训馆训练"解析成结构化事项
 *   - advise(context)  → 对当前计划给建议/权重/硬约束块
 * 排程仍由本地确定性引擎完成：可复现、不会编造时间、无网络也能用。
 *
 * 配置（三种方式，优先级从高到低）：
 *   1) window.PLAN_API = { enabled:true, base:"http://127.0.0.1:4181/api/llm", model:"deepseek-chat", timeout:9000 }
 *   2) localStorage['xingzhi-route-api'] = JSON 同上
 *   3) route/llm_proxy.py 启动后，在页面里点"配置 API"写入 localStorage
 *
 * 兼容 OpenAI 的 /v1/chat/completions 协议（DeepSeek / 通义 / 智谱 / OpenAI / Ollama 均可）。
 */
(function (root) {
  "use strict";
  var KEY = "xingzhi-route-api";
  var cfg = { enabled: false, base: "", model: "", timeout: 9000, keyHeader: "Authorization" };

  function load() {
    var j = null;
    try { j = JSON.parse(root.localStorage.getItem(KEY) || "null"); } catch (e) {}
    if (!j && root.PLAN_API) j = root.PLAN_API;
    if (!j) {
      var port = (root.location && root.location.port) || "";
      j = (port === "4181")
        ? { enabled: true, base: "/api/llm", model: "" }               // 由本地代理服务：同源，自动启用
        : { enabled: false, base: "http://127.0.0.1:4181/api/llm", model: "" }; // 其他端口：先不启用
    }
    if (j) {
      cfg.enabled = !!j.enabled && !!j.base;
      cfg.base = j.base || cfg.base;
      cfg.model = j.model || cfg.model;
      cfg.timeout = j.timeout || cfg.timeout;
      if (j.key) cfg.key = j.key;
    }
    return cfg;
  }
  function save(patch) {
    var cur = {};
    try { cur = JSON.parse(root.localStorage.getItem(KEY) || "{}"); } catch (e) {}
    Object.keys(patch || {}).forEach(function (k) { cur[k] = patch[k]; });
    root.localStorage.setItem(KEY, JSON.stringify(cur));
    load();
    return cfg;
  }

  function post(payload, timeout) {
    var ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, timeout || cfg.timeout);
    var headers = { "Content-Type": "application/json" };
    if (cfg.key) headers[cfg.keyHeader] = "Bearer " + cfg.key;
    return fetch(cfg.base, {
      method: "POST", headers: headers, body: JSON.stringify(payload), signal: ctl ? ctl.signal : undefined
    }).then(function (r) {
      clearTimeout(timer);
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }).then(function (j) {
      var txt = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
      if (!txt) throw new Error("响应里没有 choices[0].message.content");
      var clean = String(txt).replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
      return JSON.parse(clean);
    });
  }

  function sysPrompt() {
    return [
      "你是校园日程助理。只输出 JSON，不要解释。",
      "可用地点如下（name=地点名，id=标识）：",
      root.CAMPUS.pois.map(function (p) { return p.name + "=" + p.id; }).join("；"),
      "时间用 24 小时制 HH:MM；时长单位分钟（10-180）。",
      "要求：把一句话拆成【原子步骤】，一步一个动作一个地点；用『随后/然后/再/接着』连接的必须拆开；",
      "例如\"先去12号宿舍拿盆，再去澡堂洗澡，然后取快递\"要拆成 3 条；拿东西、取快递各给 5-15 分钟。",
      "如果信息不全，宁可少给字段，不要编造。"
    ].join("\n");
  }

  /* ---------- 1. 自然语言 → 结构化事项 ---------- */
  function parseTasks(text) {
    var local = parseLocal(text);
    if (!cfg.enabled) return Promise.resolve({ tasks: local, engine: "local-parser" });
    return post({
      model: cfg.model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: sysPrompt() + '\n输出格式：{"tasks":[{"name":"","poi":"","start":"HH:MM","end":"HH:MM","dur":60}]}' },
        { role: "user", content: text }
      ]
    }).then(function (j) {
      return { tasks: normalizeTasks(j && j.tasks), engine: "api" };
    }).catch(function (e) {
      return { tasks: local, engine: "local-parser", error: String(e.message || e) };
    });
  }

  /* ---------- 2. 计划建议 ---------- */
  function advise(ctx) {
    if (!cfg.enabled) return Promise.resolve(null);
    var brief = {
      now: ctx.nowText, weekday: ctx.weekday, week: ctx.week,
      atPoi: ctx.atPoi, dorm: ctx.dorm,
      researchMin: ctx.plan ? ctx.plan.researchMin : null,
      tasks: (ctx.tasks || []).map(function (t) { return { name: t.name, poi: t.poi, dur: t.dur }; }),
      segments: ctx.plan ? ctx.plan.segments.slice(0, 24) : []
    };
    return post({
      model: cfg.model,
      temperature: 0.3,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: sysPrompt() + '\n你是排程顾问：输出 {"advice":"不超过120字的中文建议","weights":{"research":1.0},"blocks":[{"start":"HH:MM","end":"HH:MM","label":""}]}' },
        { role: "user", content: JSON.stringify(brief) }
      ]
    }).then(function (j) {
      return {
        advice: j && j.advice ? String(j.advice).slice(0, 240) : "",
        weights: j && j.weights ? clampWeights(j.weights) : null,
        blocks: j && j.blocks ? normBlocks(j.blocks) : null
      };
    }).catch(function (e) { throw e; });
  }

  /* ---------- 校验与兜底 ---------- */
  function poiByName(s) {
    if (!s) return null;
    var list = root.CAMPUS.pois;
    var hit = list.filter(function (p) { return p.name === s || p.id === s; })[0];
    if (hit) return hit.id;
    hit = list.filter(function (p) { return p.name.indexOf(s) >= 0 || s.indexOf(p.name) >= 0; })[0];
    return hit ? hit.id : null;
  }
  function clampDur(v) { v = +v; if (!isFinite(v)) return 30; return Math.max(10, Math.min(180, Math.round(v))); }
  function hhmm(s, fb) {
    if (!/^\d{1,2}:\d{2}$/.test(s || "")) return fb;
    var p = s.split(":");
    return Math.max(0, Math.min(1439, (+p[0]) * 60 + (+p[1])));
  }
  function normalizeTasks(arr) {
    if (!Array.isArray(arr)) return [];
    return arr.slice(0, 6).map(function (t) {
      var poi = poiByName(t.poi || t.place) || guessPoi(t.name || "");
      var start = hhmm(t.start, null), end = hhmm(t.end, null);
      var dur = t.dur ? clampDur(t.dur) : (start != null && end != null ? Math.max(10, end - start) : 45);
      return {
        name: String(t.name || "临时事项").slice(0, 40),
        poi: poi, dur: dur,
        win: (start != null) ? [start, end != null ? end : Math.min(1439, start + dur)] : null
      };
    }).filter(function (t) { return t.name; });
  }
  function clampWeights(w) {
    var out = {};
    ["research", "meal", "walk", "shower"].forEach(function (k) {
      if (w[k] == null) return;
      var v = +w[k];
      if (isFinite(v)) out[k] = Math.max(0, Math.min(3, v));
    });
    return Object.keys(out).length ? out : null;
  }
  function normBlocks(arr) {
    if (!Array.isArray(arr)) return null;
    var out = arr.map(function (b) {
      var a = hhmm(b.start, null), z = hhmm(b.end, null);
      if (a == null || z == null || z <= a) return null;
      return { start: a, end: z, label: String(b.label || "占用").slice(0, 20) };
    }).filter(Boolean);
    return out.length ? out : null;
  }

  /* ---------- 无 API 时的本地解析（也要能拆链，不能把整句当一个任务） ---------- */
  function guessPoi(text) {
    var t = text || "";
    var mDorm = t.match(/(\d{1,2})\s*号?\s*(?:学生)?公寓/);
    if (mDorm) {
      var cand = "D" + mDorm[1];
      if (root.CAMPUS.pois.some(function (x) { return x.id === cand; })) return cand;
    }
    if (/宿舍/.test(t)) return root.PLAN_DORM || "D12";
    if (/洗漱|盆|毛巾|用品/.test(t)) return root.PLAN_DORM || "D12";
    var hit = root.CAMPUS.pois.filter(function (p) { return t.indexOf(p.name) >= 0; })
      .sort(function (a, b) { return b.name.length - a.name.length; })[0];
    if (hit) return hit.id;
    if (/乒乓|球|训练|运动|跑|健身/.test(t)) return "U24";
    if (/快递|取件|寄件/.test(t)) return "U4";
    if (/超市|买/.test(t)) return "U11";
    if (/医务|医院|看病/.test(t)) return "U13";
    if (/洗澡|澡堂/.test(t)) return "U3";
    if (/饭|餐|食堂/.test(t)) return "U16";
    if (/图书馆|文献|论文|自习/.test(t)) return "B1";
    if (/课|上课|教室/.test(t)) return "B2";
    return "U26";
  }
  function splitChain(text) {
    /* 先按分句符切，再按连接词切 */
    var parts = String(text || "")
      .replace(/[，,]\s*(?=(随后|然后|接着|之后|再|又|并|最后))/g, "|")
      .replace(/(随后|然后|接着|之后|再[去往到达]?|又|并|最后)/g, "|")
      .replace(/[；;、]/g, "|")
      .split("|")
      .map(function (x) { return x.trim(); })
      .filter(Boolean);
    return parts.length ? parts : [String(text || "").trim()];
  }
  function stepName(chunk) {
    var s = chunk
      .replace(/\d{1,2}\s*[:：点]\s*\d{0,2}/g, "")
      .replace(/[一二三四五六七八九十两]{1,3}\s*点\s*(半|[一二三四五六七八九十]{1,3}\s*分?)?/g, "")
      .replace(/\d+\s*(分钟|分|小时|钟头|个?小时)/g, "")
      .replace(/[一二三四五六七八九十两]{1,3}\s*(分钟|分|个?小时)/g, "")
      .replace(/各\s*[\d一二三四五六七八九十]{1,3}\s*(分钟|分)/g, "")
      .replace(/半\s*个?\s*小时/g, "")
      .replace(/(明早|明天|今晚|今天|早上|早晨|上午|中午|下午|晚上|晚|下课后|饭后|左右|准时)/g, "")
      .replace(/\d{1,2}\s*号?\s*(?:学生)?公寓/g, "宿舍")
      .replace(/^(先|再|又|然后|接着|之后|去|到|前往|往|顺便|顺路)/, "")
      .replace(/[，,。;；、]$/, "")
      .replace(/[，,]\s*$/, "")
      .replace(/的$/, "")
      .trim();
    return s || "临时事项";
  }
  /* ---------- 中文数字（"八点""三十分钟""两小时"） ---------- */
  var CN_DIGIT = { "零": 0, "〇": 0, "一": 1, "二": 2, "两": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9 };
  function cn2num(str) {
    if (str == null) return NaN;
    var t = String(str).trim();
    if (!t) return NaN;
    if (/^\d+$/.test(t)) return +t;
    if (t === "十") return 10;
    if (t.length === 1) return CN_DIGIT[t] != null ? CN_DIGIT[t] : NaN;
    var m = t.match(/^([一二三四五六七八九])?十([一二三四五六七八九])?$/);
    if (m) return (m[1] ? CN_DIGIT[m[1]] : 1) * 10 + (m[2] ? CN_DIGIT[m[2]] : 0);
    if (t.length === 2 && CN_DIGIT[t[0]] != null && CN_DIGIT[t[1]] != null) return CN_DIGIT[t[0]] * 10 + CN_DIGIT[t[1]];
    var n = 0;
    for (var i = 0; i < t.length; i++) {
      if (CN_DIGIT[t[i]] == null) return NaN;
      n = n * 10 + CN_DIGIT[t[i]];
    }
    return n;
  }

  function parseLocal(text) {
    var s = String(text || "").trim();
    if (!s) return [];
    var win = null, m;
    if ((m = s.match(/([一二三四五六七八九十两]{1,3}|\d{1,2})\s*[:：点]\s*([一二三四五六七八九十]{1,3}|\d{1,2}|半)?/))) {
      var h = cn2num(m[1]), mm = m[2] ? (m[2] === "半" ? 30 : cn2num(m[2])) : 0;
      if (/晚|下午|pm/i.test(s) && h < 12) h += 12;
      win = h * 60 + mm;
    } else if (/早上|早晨/.test(s)) win = 8 * 60;
    else if (/中午/.test(s)) win = 12 * 60;
    else if (/下午/.test(s)) win = 14 * 60;
    else if (/晚上|晚/.test(s)) win = 19 * 60;
    var dur0 = null;
    if ((m = s.match(/([一二三四五六七八九十两]{1,3}|\d+)\s*分(?:钟)?/))) dur0 = clampDur(cn2num(m[1]));
    else if ((m = s.match(/(\d+(?:\.\d+)?|[一二三四五六七八九十两]{1,3})\s*(?:个)?(小时|钟头)/))) dur0 = clampDur(cn2num(m[1]) * 60);

    var durAll = null, mall = s.match(/各\s*([一二三四五六七八九十两]{1,3}|\d+)\s*分(?:钟)?/);
    if (mall) durAll = clampDur(cn2num(mall[1]));
    var chunks = splitChain(s);
    var out = [], cursor = win;
    chunks.forEach(function (ck) {
      if (!ck) return;
      var poi = guessPoi(ck);
      var d = null, mm2;
      if ((mm2 = ck.match(/([一二三四五六七八九十两]{1,3}|\d+)\s*分(?:钟)?/))) d = clampDur(cn2num(mm2[1]));
      else if ((mm2 = ck.match(/(\d+(?:\.\d+)?|[一二三四五六七八九十两]{1,3})\s*(?:个)?(小时|钟头)/))) d = clampDur(cn2num(mm2[1]) * 60);
      else if (/半小时/.test(ck)) d = 30;
      else if (/拿|取|带|换/.test(ck)) d = 10;
      else if (/洗澡|澡/.test(ck)) d = 32;
      else if (/训练|球|运动/.test(ck)) d = 60;
      else d = dur0 || 20;
      if (durAll && !/\d+\s*(分钟|分)|小时/.test(ck) && !/半小时/.test(ck)) d = durAll;
      var name = stepName(ck);
      out.push({
        name: name.slice(0, 30), poi: poi, dur: d,
        win: cursor != null ? [cursor, Math.min(1439, cursor + d)] : null   // 精确预约：[起, 起+时长]
      });
      if (cursor != null) cursor = Math.min(1439, cursor + d);
    });
    return out.slice(0, 6);
  }

  /* ---------- 后处理：不管模型还是本地，都做一次"拆 + 去重" ---------- */
  function routineOf(name) {
    if (/用品|盆|毛巾|洗漱/.test(name)) return null;      // 拿东西不是日常动作
    if (/洗澡|冲澡/.test(name)) return "洗澡";
    /* 取快递不再默认吞掉：只有明确说"顺便/顺路/一起"时才并入洗澡 */
    if (/取快递|拿快递|取件|寄快递/.test(name)) return null;
    if (/吃饭|吃午饭|吃晚饭|吃早饭/.test(name) || /^(饭|午饭|晚饭|早饭)$/.test(name)) return "吃饭";
    return null;
  }
  /* 用户是否明确说"洗澡顺便取快递"——只有这种情况才允许并入洗澡 */
  function wantsParcelWithShower(text) {
    return /(洗澡|澡).{0,12}(顺便|顺路|一起|带上).{0,12}(快递|取件)/.test(text) ||
           /(顺便|顺路|一起|带上).{0,12}(取快递|取件)/.test(text);
  }

  function postProcess(tasks, rawText) {
    var out = [], merged = [], seen = {};
    (tasks || []).forEach(function (t) {
      var name = String(t.name || "").trim();
      if (!name) return;
      /* 名字里还带连接词 / 过长 → 再拆一次 */
      if (name.length > 16 || /随后|然后|接着|之后|再去|再前往/.test(name)) {
        parseLocal(name).forEach(function (x) { out.push(x); });
        return;
      }
      /* 日常动作：平台会自动安排，避免重复出现两次"洗澡" */
      var rt = routineOf(name);
      if (rt) { if (merged.indexOf(rt) < 0) merged.push(rt); return; }
      var key = name + "|" + t.poi;
      if (seen[key]) return;
      seen[key] = 1;
      out.push({ name: name.slice(0, 30), poi: t.poi, dur: clampDur(t.dur), win: t.win || null });
    });
    return { tasks: out.slice(0, 6), merged: merged,
             parcelWithShower: wantsParcelWithShower(rawText) };
  }

  root.PlanLLM = {
    load: load, save: save, parseTasks: parseTasks, advise: advise,
    parseLocal: parseLocal, postProcess: postProcess, normalizeTasks: normalizeTasks, poiByName: poiByName,
    get cfg() { return cfg; }
  };
})(typeof window !== "undefined" ? window : globalThis);
