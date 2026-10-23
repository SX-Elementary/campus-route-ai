#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""把平台导出的 campus_pois_*.json 合并进数据包，并重出全部产物。

用法：
    python merge_pois.py 你的导出文件.json
    python merge_pois.py            # 不带参数时，自动在上级目录找 campus_pois_*.json

做四件事：
  1) 用导出文件的点位表更新 campus_data.json（先备份）
  2) 重建 campus_graph.json（路网 + 接入边 + 连通性检查）
  3) 重出静态标注图 campus_annotated_road.png / campus_annotated_sat.jpg（新点会自动标上）
  4) 刷新 web/data.js 与底图，让平台"恢复初始"时就是你这版点位
"""
import glob, json, os, shutil, subprocess, sys

BASE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(BASE, "web")
DATA = os.path.join(BASE, "campus_data.json")
PY = sys.executable

VALID_CATS = {"gate", "lib", "teach", "dorm", "food", "sport",
              "shop", "bath", "clinic", "parcel", "door", "other"}

def find_export():
    if len(sys.argv) > 1:
        return sys.argv[1]
    cands = []
    for pat in ("campus_pois_*.json", "*pois*.json"):
        cands += glob.glob(os.path.join(BASE, pat))
        cands += glob.glob(os.path.join(os.path.dirname(BASE), pat))
    cands = [c for c in cands if os.path.abspath(c) != os.path.abspath(DATA)]
    return cands[0] if cands else None

def norm(p):
    px = p.get("px") or p.get("road_px")
    if not px or len(px) != 2:
        raise ValueError("缺少 px 坐标: %r" % (p.get("name"),))
    cat = p.get("cat") or "other"
    if cat not in VALID_CATS:
        cat = "other"
    return dict(id=str(p.get("id") or ""), name=str(p.get("name") or "未命名").strip(),
                cat=cat, road_px=[round(float(px[0]), 2), round(float(px[1]), 2)],
                custom=bool(p.get("custom", True)))

def main():
    src = find_export()
    if not src:
        print("没找到导出文件。请先在平台点「导出」，把下载的 JSON 放到：")
        print("  " + os.path.dirname(BASE))
        print("或直接： python merge_pois.py 具体路径.json")
        return 1
    print("导入文件:", src)
    raw = json.load(open(src, encoding="utf-8"))
    incoming = [norm(p) for p in raw.get("pois", []) if p.get("name")]
    if not incoming:
        print("文件里没有点位"); return 1

    seen, dedup = set(), []
    for p in incoming:
        k = p["id"] or ("%s@%.1f,%.1f" % (p["name"], p["road_px"][0], p["road_px"][1]))
        if k in seen:
            continue
        seen.add(k)
        if not p["id"]:
            p["id"] = "U%d" % (len(dedup) + 1)
        dedup.append(p)
    incoming = dedup

    data = json.load(open(DATA, encoding="utf-8"))
    old = {p["id"]: p for p in data["pois"]}

    for p in incoming:
        if p["id"] in old:
            ex = old[p["id"]]
            if ex["name"] != p["name"] or ex["cat"] != p["cat"] or ex["road_px"] != p["road_px"]:
                print("  更新 %-8s %s -> %s  cat=%s  px=%s" % (p["id"], ex["name"], p["name"], p["cat"], p["road_px"]))
        else:
            print("  新增 %-8s %-14s cat=%-7s px=%s" % (p["id"], p["name"], p["cat"], p["road_px"]))
    removed = [i for i in old if i not in {p["id"] for p in incoming}]
    if removed:
        print("  移除 %d 个（导出里没有的）：%s" % (len(removed), "、".join(old[i]["name"] for i in removed)))

    shutil.copyfile(DATA, DATA + ".bak")
    data["pois"] = incoming
    data["poi_source"] = os.path.basename(src)
    json.dump(data, open(DATA, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print("campus_data.json 已更新：%d 个点位（原 %d，备份在 campus_data.json.bak）" % (len(incoming), len(old)))

    # 顺序很重要：annotate 先把新道路/新位写回 campus_data.json，再据此建路网
    for script, label in (("annotate.py", "重出标注图"), ("build_graph.py", "重建路网")):
        print("-- %s --" % label)
        r = subprocess.run([PY, os.path.join(BASE, script)], capture_output=True, text=True, encoding="utf-8")
        if r.returncode != 0:
            print(r.stdout[-800:]); print(r.stderr[-800:]); return 1
        print((r.stdout or "").strip()[:400])

    # 刷新 web/data.js + 底图
    g = data["geo_ref"]
    dlo = g["road_span"]["lon"] / g["road"]["w"]
    dla = g["road_span"]["lat"] / g["road"]["h"]
    sat_w, sat_h = 4864, 2816
    sat = dict(src="sat.jpg", w=sat_w, h=sat_h, lon_tl=116.354828, lat_tl=39.770548,
               dlo=round((116.380920 - 116.354828) / sat_w, 12),
               dla=round((39.770548 - 39.758936) / sat_h, 12))
    out = dict(
        campus=data["campus"], M_PER_PX=round(g["meters_per_px_road"], 6),
        geo=dict(lon_tl=g["road"]["lon_tl"], lat_tl=g["road"]["lat_tl"],
                 dlo=round(dlo, 10), dla=round(dla, 10)),
        sat=sat,
        pois=[dict(id=p["id"], name=p["name"], cat=p["cat"], px=p["road_px"]) for p in data["pois"]],
        roads=[dict(name=r["name"], polyline=[[float(a), float(b)] for a, b in r["polyline"]])
               for r in data["roads"]],
        boundary=[[float(a), float(b)] for a, b in data["campus_boundary_px"]],
    )
    body = ("/* data.js —— 底图参照 + 初始点位（由 campus_data.json 生成；可手改） */\n"
            "window.CAMPUS = " + json.dumps(out, ensure_ascii=False, indent=1) + ";\n")
    open(os.path.join(WEB, "data.js"), "w", encoding="utf-8").write(body)

    # 统计
    from collections import Counter
    cnt = Counter(p["cat"] for p in incoming)
    print("\n完成。点位 %d 个：%s" % (len(incoming), "、".join("%s %d" % (k, v) for k, v in cnt.most_common())))
    print("web/data.js 已刷新 —— 平台里点「恢复初始」就是这版点位。")
    return 0

if __name__ == "__main__":
    sys.exit(main())
