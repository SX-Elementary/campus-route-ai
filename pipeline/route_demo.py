#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""原型：日程 → 路网最短路径 → 时间轴 → 地图可视化。
读取 campus_graph.json（沿道路的步行网），用 Dijkstra 求段间路径；
日程按时间排序，早到则等待，超时给出警告。
"""
import heapq, json, os
from PIL import Image, ImageDraw, ImageFont

BASE = os.path.dirname(os.path.abspath(__file__))
D = json.load(open(os.path.join(BASE, "campus_data.json"), encoding="utf-8"))
GJ = json.load(open(os.path.join(BASE, "campus_graph.json"), encoding="utf-8"))
POI = {p["id"]: p for p in D["pois"]}
SPEED = D["walk_speed_mps"]
NODE = {n["id"]: n for n in GJ["nodes"]}
ACC = GJ["poi_access"]

ADJ = {n["id"]: [] for n in GJ["nodes"]}
for e in GJ["edges"]:
    ADJ[e["a"]].append((e["b"], e["dist_m"]))
    ADJ[e["b"]].append((e["a"], e["dist_m"]))

def dijkstra(src, dst):
    dist = {src: 0.0}; prev = {}; pq = [(0.0, src)]
    while pq:
        d0, u = heapq.heappop(pq)
        if u == dst: break
        if d0 > dist.get(u, 1e18): continue
        for v, w in ADJ[u]:
            nd = d0 + w
            if nd < dist.get(v, 1e18):
                dist[v] = nd; prev[v] = u; heapq.heappush(pq, (nd, v))
    if dst not in dist: return None, None
    path = [dst]
    while path[-1] != src: path.append(prev[path[-1]])
    return dist[dst], path[::-1]

def route(a_poi, b_poi):
    """POI→POI 的步行路线：接入段 + 路网段"""
    na, nb = ACC[a_poi]["node"], ACC[b_poi]["node"]
    d1, p1 = dijkstra(na, nb)
    if d1 is None: return None, None
    nodes = p1
    # 接上 POI 自身像素点，便于画图
    pts = [tuple(POI[a_poi]["road_px"])] + [tuple(NODE[n]["px"]) for n in nodes] + [tuple(POI[b_poi]["road_px"])]
    ded = [pts[0]]
    for q in pts[1:]:
        if q != ded[-1]: ded.append(q)
    return d1, ded

SCHEDULE = [
    ("07:20", "07:50", "早餐",           "F1",  30),
    ("08:00", "08:00", "第1-2节 上课",    "B3",  95),
    ("10:05", "10:05", "第3-4节 上课",    "B2",  95),
    ("12:00", "12:20", "午餐",           "F1",  40),
    ("13:30", "13:40", "图书馆自习",      "B1", 120),
    ("16:00", "16:10", "田径场 体能训练",  "S1",  60),
    ("17:30", "17:40", "晚餐",           "F1",  40),
    ("19:00", "19:10", "回宿舍 晚自习",   "D7", 120),
]

def hm(s):
    h, m = s.split(":"); return int(h)*60+int(m)
def mh(t):
    t = int(round(t)); return f"{t//60:02d}:{t%60:02d}"

def plan(start_poi="D7", start="07:00"):
    cur, t, rows = start_poi, hm(start), []
    for begin, deadline, name, poi, dur in sorted(SCHEDULE, key=lambda r: hm(r[0])):
        wm, pts = route(cur, poi)
        if wm is None:
            rows.append(dict(name=name, poi=poi, err=True)); continue
        minutes = wm / SPEED / 60.0
        arrive = t + minutes
        start_at = max(arrive, hm(begin))
        rows.append(dict(name=name, poi=poi, frm=cur, depart=mh(t), arrive=mh(arrive),
                         wait=start_at-arrive, start=mh(start_at), end=mh(start_at+dur),
                         walk_min=minutes, pts=pts,
                         late=arrive-hm(deadline)))
        cur, t = poi, start_at + dur
    return rows

def render(rows, out_png):
    im = Image.open(os.path.join(BASE, "campus_road_final_z17.png")).convert("RGB")
    sc = 2
    canvas = im.resize((im.width*sc, im.height*sc), Image.LANCZOS)
    d = ImageDraw.Draw(canvas, "RGBA")
    f = ImageFont.truetype("C:/Windows/Fonts/msyhbd.ttc", 30)
    fs = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 24)
    for i, r in enumerate(rows):
        if "pts" not in r: continue
        pts = [(x*sc, y*sc) for x, y in r["pts"]]
        col = (25, 118, 210, 235) if i % 2 == 0 else (216, 27, 96, 235)
        d.line(pts, fill=col, width=9, joint="curve")
        mx, my = pts[len(pts)//2]
        d.text((mx+10, my-34), str(i+1), font=f, fill=col)
    for i, r in enumerate(rows):
        p = POI[r["poi"]]; x, y = p["road_px"][0]*sc, p["road_px"][1]*sc
        d.ellipse([x-15, y-15, x+15, y+15], fill=(255,255,255), outline=(20,20,20), width=3)
        tw = d.textlength(str(i+1), font=f)
        d.text((x-tw/2, y-15), str(i+1), font=f, fill=(20,20,20))
        d.text((x+18, y-16), f"{r['start']} {p['name']}", font=fs, fill=(20,20,20))
    d.rectangle([0, 0, canvas.width, 54], fill=(255,255,255,242))
    d.text((16, 10), "示例：日程 → 路网最短路（原型）｜距离含绕行，1.3 m/s", font=f, fill=(20,20,20))
    canvas.save(out_png, optimize=True)
    print("saved", out_png)

if __name__ == "__main__":
    rows = plan()
    print("=== 今日行程 ===")
    tot = 0.0
    for i, r in enumerate(rows, 1):
        if r.get("err"):
            print(i, r["name"], "不可达"); continue
        tot += r["walk_min"]
        warn = f"  ⚠ 晚到 {r['late']:.0f} 分钟" if r["late"] > 0 else ""
        print(f"{i}. {r['start']}–{r['end']}  {r['name']:<12s} @{POI[r['poi']]['name']}"
              f"  步行 {r['walk_min']:.0f} 分钟（{r['depart']} 出发 / {r['arrive']} 到 / 等 {r['wait']:.0f} 分钟）{warn}")
    print(f"合计步行 {tot:.0f} 分钟")
    render(rows, os.path.join(BASE, "route_demo.png"))
