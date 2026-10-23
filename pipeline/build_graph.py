#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""由「道路折线 + 兴趣点」构建可路由的步行路网图（campus_graph.json）。
做法：
1) 道路折线两两求交，交点作为路网节点；
2) 兴趣点投影到最近的道路上，投影点作为接入节点；
3) 每条道路上的点按沿线顺序连边；兴趣点与其投影点连边（接入距离）。
输出：nodes / edges（米）/ poi_access，可直接给 Dijkstra/A* 用。
"""
import json, math, os

BASE = os.path.dirname(os.path.abspath(__file__))
D = json.load(open(os.path.join(BASE, "campus_data.json"), encoding="utf-8"))
ROADS = [(r["name"], [tuple(p) for p in r["polyline"]]) for r in D["roads"]]
POIS = [(p["id"], tuple(p["road_px"])) for p in D["pois"]]
M_PER_PX = D["geo_ref"]["meters_per_px_road"]
LON0 = D["geo_ref"]["road"]["lon_tl"]; LAT0 = D["geo_ref"]["road"]["lat_tl"]
SPAN = D["geo_ref"]["road_span"]; W = D["geo_ref"]["road"]["w"]; H = D["geo_ref"]["road"]["h"]
DLO = SPAN["lon"] / W; DLA = SPAN["lat"] / H

def px2geo(p):
    return (round(LON0 + p[0]*DLO, 6), round(LAT0 - p[1]*DLA, 6))

def seg_inter(p1, p2, p3, p4):
    """线段求交（含端点相触），返回交点或 None"""
    x1,y1 = p1; x2,y2 = p2; x3,y3 = p3; x4,y4 = p4
    d = (x2-x1)*(y4-y3) - (y2-y1)*(x4-x3)
    if abs(d) < 1e-9:
        return None
    t = ((x3-x1)*(y4-y3) - (y3-y1)*(x4-x3)) / d
    u = ((x3-x1)*(y2-y1) - (y3-y1)*(x2-x1)) / d
    if -1e-6 <= t <= 1+1e-6 and -1e-6 <= u <= 1+1e-6:
        return (round(x1 + t*(x2-x1), 2), round(y1 + t*(y2-y1), 2))
    return None

def dist(a, b):
    return math.hypot(a[0]-b[0], a[1]-b[1])

# --- 1) 交点 ---
pt_roads = {}          # 点 -> 经过它的道路集合
def add(pt, road):
    pt_roads.setdefault(pt, set()).add(road)

for i in range(len(ROADS)):
    n1, pl1 = ROADS[i]
    for j in range(i+1, len(ROADS)):
        n2, pl2 = ROADS[j]
        for a in range(len(pl1)-1):
            for b in range(len(pl2)-1):
                p = seg_inter(pl1[a], pl1[a+1], pl2[b], pl2[b+1])
                if p:
                    add(p, i); add(p, j)

# --- 2) POI 投影 ---
poi_proj = {}
for pid, pt in POIS:
    best = None
    for i, (n, pl) in enumerate(ROADS):
        for a in range(len(pl)-1):
            p, q = pl[a], pl[a+1]
            vx, vy = q[0]-p[0], q[1]-p[1]
            L2 = vx*vx + vy*vy
            t = 0.0 if L2 == 0 else max(0.0, min(1.0, ((pt[0]-p[0])*vx + (pt[1]-p[1])*vy) / L2))
            proj = (round(p[0]+t*vx, 2), round(p[1]+t*vy, 2))
            dd = dist(pt, proj)
            if best is None or dd < best[0]:
                best = (dd, proj, i)
    dd, proj, ri = best
    # 1px 内的已有节点直接吸附，避免 0.4px 缝隙把路网截断成孤岛
    for k, rs in pt_roads.items():
        if ri in rs and dist(proj, k) < 1.0:
            proj = k
            dd = dist(pt, proj)
            break
    poi_proj[pid] = (proj, dd, ri)
    add(proj, ri)

# --- 3) 连边 ---
nodes = {}
def node_id(pt, kind="road"):
    key = (pt, kind)
    if key not in nodes:
        nodes[key] = f"{'P' if kind=='poi' else 'N'}{len(nodes)}"
    return nodes[key]

edges = []
for i, (nm, pl) in enumerate(ROADS):
    pts = [p for p, rs in pt_roads.items() if i in rs]
    if len(pts) < 2:
        continue
    # 投影到道路方向排序
    p0, p1 = pl[0], pl[-1]
    vx, vy = p1[0]-p0[0], p1[1]-p0[1]
    L = math.hypot(vx, vy) or 1.0
    pts.sort(key=lambda q: ((q[0]-p0[0])*vx + (q[1]-p0[1])*vy) / L)
    for a, b in zip(pts, pts[1:]):
        d = dist(a, b)
        if d < 0.5:
            continue
        edges.append(dict(a=node_id(a), b=node_id(b), dist_m=round(d*M_PER_PX, 1), road=nm))

access = {}
for pid, (pt) in POIS:
    proj, dd, ri = poi_proj[pid]
    n_poi = node_id(pt, "poi")
    n_road = node_id(proj)
    access[pid] = dict(node=n_poi, road_node=n_road,
                       access_m=round(dd*M_PER_PX, 1), road=ROADS[ri][0])
    if dd*M_PER_PX > 0.5:
        edges.append(dict(a=n_poi, b=n_road, dist_m=round(dd*M_PER_PX, 1), road="接入"))

out = dict(
    campus=D["campus"], crs="GCJ-02", meters_per_px=M_PER_PX,
    note="节点坐标为底图像素；dist_m 为沿路网米数；接入边为兴趣点到最近道路的垂直距离",
    nodes=[dict(id=v, px=list(k[0]), kind=k[1], lon=px2geo(k[0])[0], lat=px2geo(k[0])[1])
           for k, v in nodes.items()],
    edges=edges, poi_access=access,
)
p = os.path.join(BASE, "campus_graph.json")
open(p, "w", encoding="utf-8").write(json.dumps(out, ensure_ascii=False, indent=2))
print("nodes", len(out["nodes"]), "edges", len(edges), "->", p)

# --- 连通性检查 ---
adj = {}
for e in edges:
    adj.setdefault(e["a"], []).append(e["b"]); adj.setdefault(e["b"], []).append(e["a"])
seen, stack = set(), ["N0"]
while stack:
    u = stack.pop()
    if u in seen: continue
    seen.add(u); stack.extend(adj.get(u, []))
unreach = [n["id"] for n in out["nodes"] if n["id"] not in seen and n["kind"] == "poi"]
print("POI 不可达:", unreach if unreach else "无")
