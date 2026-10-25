/* schedule_data.js —— 课表 + 作息 + 校规约束（数据层，改这里就能改行为）
 * 来源：2026-2027学年第1学期课表 PDF（侦查学·数据侦查实验班）+ 你的补充说明 + 作息图
 * 待你确认的项都标了 TODO
 */
window.SCHEDULE = {
  meta: {
    name: "孙潇", grade: 2025, major: "侦查学（数据侦查实验班）",
    term: "2026-2027 学年第 1 学期",
    note: "周四 3-4 节《简明西方哲学史》(6-13周, 西配楼202)、5-6 节《公安人工智能导论》(线上, 13周铸剑楼随堂考) 为本周选课新增"
  },

  /* 节次时间：40 分钟一节；一二/三四节间 10 分钟，二三节间 20 分钟；下午四节间均 10 分钟 */
  periods: {
    1:  ["08:10", "08:50"],
    2:  ["09:00", "09:40"],
    3:  ["10:00", "10:40"],
    4:  ["10:50", "11:30"],
    5:  ["14:00", "14:40"],
    6:  ["14:50", "15:30"],
    7:  ["15:40", "16:20"],
    8:  ["16:30", "17:10"],
    9:  ["18:30", "19:10"],
    10: ["19:20", "20:00"],
    11: ["20:10", "20:50"],
    12: ["21:00", "21:40"]
  },
  /* 铸剑楼上午 3-4 节推迟 10 分钟（TODO：如与实际不符改这里） */
  periodOverride: {
    "B2": { 3: ["10:10", "10:50"], 4: ["11:00", "11:40"] }
  },

  /* 课表：day 1=周一 … 7=周日；periods [起, 止]；weeks 为周次区间数组
     地点映射：团西院 / 西院 = 西苑平房(U20)；育警西楼 / 西配楼 = U7；育警中楼 = 中楼(U8) */
  courses: [
    { day: 1, periods: [5, 6],  name: "社会调查与研究方法", teacher: "张旭芳", place: "团铸剑楼308", poi: "B2", weeks: [[1, 16]] },
    { day: 1, periods: [9, 10], name: "形势与政策III",      teacher: "罗豪",   place: "团阶二",     poi: "U15", weeks: [[9, 12]] },

    { day: 2, periods: [1, 2],  name: "民法学",             teacher: "张弛",   place: "团育警中楼112", poi: "U8", weeks: [[1, 16]] },
    { day: 2, periods: [3, 4],  name: "刑事诉讼法学",       teacher: "唐彬彬", place: "团西院3-2",  poi: "U20", weeks: [[1, 16]] },
    { day: 2, periods: [7, 8],  name: "社会网络分析",       teacher: "崔婉秋", place: "团铸剑楼105", poi: "B2", weeks: [[1, 16]] },
    { day: 2, periods: [9, 10], name: "香港警务",           teacher: "邱嘉威", place: "团铸剑楼101", poi: "B2", weeks: [[2, 17]] },

    { day: 3, periods: [3, 4],  name: "治安管理学",         teacher: "解源源", place: "团铸剑楼401", poi: "B2", weeks: [[1, 16]] },

    { day: 4, periods: [1, 2],  name: "毛泽东思想和中国特色社会主义理论体系概论", teacher: "诸葛瑞强", place: "团西院2-2", poi: "U20", weeks: [[1, 16]] },
    { day: 4, periods: [3, 4],  name: "简明西方哲学史",     teacher: "",       place: "育警西楼202", poi: "U7", weeks: [[6, 13]] },
    { day: 4, periods: [5, 6],  name: "公安人工智能导论",   teacher: "",       place: "线上",        poi: "U26", weeks: [[1, 16]], online: true,
      note: "线上课；第13周需到铸剑楼随堂考（暂定）" },
    { day: 4, periods: [7, 8],  name: "侦查数据建模技术",   teacher: "吴妍潼", place: "团铸剑楼104", poi: "B2", weeks: [[1, 16]] },
    { day: 4, periods: [9, 10], name: "军事理论",           teacher: "钱明凯", place: "团阶六",     poi: "U15", weeks: [[1, 8]] },

    { day: 5, periods: [3, 4],  name: "警察武器使用",       teacher: "周鹏",   place: "团靶场1",    poi: "S4", weeks: [[1, 16]] },
    { day: 5, periods: [5, 6],  name: "概率论与数理统计",   teacher: "罗婷",   place: "团铸剑楼306", poi: "B2", weeks: [[1, 16]] }
  ],

  /* 一日作息（周中）；周末另行处理 */
  semesterStart: "2026-09-07",      // 秋季学期第 1 周的周一（自动推算"第几周"；如不对改这一行）

  routine: {
    wake: "06:00",
    assemblyPoi: "U34",              // 三次集合都在文化广场
    marchVia: "文化广场东路（正心路）→ 求实路", // 文化广场东路 = 正心路；求实路 = 图上的"求实道"
    dismissAt: "U34",                // 早操在文化广场解散
    lateStudy: {                     // 熄灯后可选：宿舍楼内警苑自习空间
      enabled: "auto",               // auto = 当天有排不完的事才安排
      poi: null,                     // null 表示就在宿舍楼（无额外步行）
      startAfter: 5,                 // 熄灯后几分钟开始
      until: "24:00",
      minMin: 30
    },
    morningAssembly: {   // 早集合：周一/五跑操，周二/四队列操，周三内务操
      1: { time: "06:30", type: "跑操" },
      2: { time: "06:25", type: "队列操" },
      3: { time: "06:35", type: "内务操" },
      4: { time: "06:25", type: "队列操" },
      5: { time: "06:30", type: "跑操" }
    },
    breakfastWindow: ["07:00", "07:25"],
    goDownstairs: "07:30",
    preClassAssembly: "07:40",       // 带队行进至铸剑楼，再各自去上课
    /* 课前集合带队目的地：周二/周四 → 当日一二节课的教学点位；其余 → 铸剑楼。
       null 表示"跟着当天的第一节课走"，由引擎填。 */
    preClassAssemblyDest: { "1": "B2", "2": null, "3": "B2", "4": null, "5": "B2" },
    noonDismiss: "11:40",
    lunchWindow: ["11:40", "12:20"],
    napWindow: ["12:20", "13:15"],   // 周中不能回宿舍，午休在教室/自习点
    afternoonAssembly: "13:25",
    afternoonDismiss: "17:10",       // 17:10 之后直接自由（不再有讲评/带回）

    /* 每周三下午：中队统一组织长跑或团建，14:00-17:00 几乎占满。
       这段时间只做"碎片化提醒"（背知识点/单词），不写进看板任务。 */
    teamBlock: {
      day: 3,
      gather: "14:00",            // 周三 14:00 到文化广场点名
      gatherMin: 5,
      gatherPoi: "U34",
      end: "17:00",
      defaultMode: "observe",
      modes: {
        observe: {                // 身体原因不跑：留在文广见习
          label: "中队活动 · 文广见习",
          note: "不能跑就在文化广场见习；可以闲聊，也可以看手机背碎片知识点",
          tip: "见习期间适合碎片化：毛概 / 民法 / 刑诉 知识点、英语单词（只提醒，不排看板）",
          stay: true
        },
        run: {                    // 跟队跑操
          label: "中队跑操（路线每次不同）",
          note: "点名后直接从文化广场带开跑，路线不固定，但占用的时间固定到 17:00",
          tip: "这段时间在跟队跑操，路线每次不同，不再安排别的",
          stay: false
        }
      }
    },
    dinnerWindow: ["17:30", "18:15"],     // 你的习惯：要么这个窗口内吃，要么不吃（硬窗口）
    dinnerHard: true,
    washUp: "22:00",
    lightsOut: "22:30"
  },

  /* 内务/门禁：这期间不能回宿舍，洗漱盆必须留在宿舍 */
  dormRules: {
    weekdayNoDorm: [["08:00", "15:30"], ["18:20", "20:30"]],
    sundayNoDorm: [["18:30", "20:30"]],
    sundayDormUntil: "17:00",
    sundayDeepCleanFrom: "15:00",     // 周日大扫除：洗澡需 15:00 前到宿舍
    saturdayFree: true
  },

  /* 个人偏好 */
  prefs: {
    researchPoi: "U26",       // 未来警务学院（主据点）
    altStudyPois: ["B1", "B2"],   // 备用自习点：图书馆 / 铸剑楼（吃饭后离主据点太远时改用）
    showerPoi: "U3",          // 澡堂
    parcelPois: ["U4", "U5", "U6"], // 快递柜/站/外卖柜
    showerMin: 32,            // 30~35 分钟
    parcelMin: 8,             // 顺便取快递
    eatingMin: 25,            // 食堂吃饭耗时
    /* 家务快速添加：只填空档，不进项目看板 */
    chorePresets: [
      { name: "洗衣服", dur: 25, poi: "D12" },
      { name: "晾衣服", dur: 10, poi: "D12" },
      { name: "整理内务", dur: 15, poi: "D12" },
      { name: "取快递", dur: 10, poi: "U4" }
    ],
    showerEveryDays: 1,       // 洗澡频率：1=每天，2=隔天（偶数天洗）
    washUpEveryDays: 1,       // 洗漱频率：1=每天，2=隔天
    minResearchMin: 30,       // 值得"跑一趟自习点"的最小净学习时长（低于它就不去了）
    flexMin: 15,              // 空档超过这个长度就标成"机动"，并给就地建议
    /* 就地可做的事（不需要走路，所以不受 minResearchMin 限制） */
    flexHints: {
      dorm: ["洗衣服", "整理内务", "背单词", "拉伸放松"],
      away: ["背单词 / 背知识点", "复盘今天", "闭眼休息"]
    },
    napMin: 40,
    lunchPreferPois: ["U16", "U1", "U2", "F1"],          // 一食堂/二食堂/三食堂/接待餐厅（学生荟已排除：物价高）
    avoidMealPois: ["U27"],                              // 几乎不去吃的点位：学生荟
    takeoutPoi: "U36",                                   // 外卖点位（图书馆前，原地图未标注）
    takeoutPickMin: 6,                                   // 取外卖耗时
    takeoutEatMin: 22,                                   // 带回自习点吃
    /* 价格/偏好没法用距离算，就用权重表达（1 分 ≈ 1 分种科研时间）
       正数=更愿意去，负数=不太愿意去 */
    mealBias: { "U36": 15, "U16": 0, "U1": 0, "U2": 0, "F1": -15 },
    takeoutMaxAccess: 3,        // 自习点到取餐点步行超过这个分钟数，就不考虑外卖（带回吃纯属浪费走路）
    storePois: ["U11", "U32", "U29"],                    // 好邻居/警苑/被装超市（赶时间时的替代）
    walkSpeed: 1.2,           // m/s（含路口等待/绕行的保守值；1.3 会偏乐观）
    researchBlockMin: 45      // 少于这个长度就不算"整块科研"
  }
};
