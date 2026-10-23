#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""团河校区地图标注（v2）：编号+名称+分类图例+比例尺，并导出结构化数据"""
import json, math, os
from PIL import Image, ImageDraw, ImageFont

BASE = os.path.dirname(os.path.abspath(__file__))
ROAD = os.path.join(BASE, "campus_road_final_z17.png")
SAT  = os.path.join(BASE, "campus_sat_final_z18.jpg")

ROAD_GEO = dict(lon_tl=116.353455, lat_tl=39.770548, w=2560, h=1536)
SAT_GEO  = dict(lon_tl=116.354828, lat_tl=39.770548, w=4864, h=2816)
ROAD_SPAN = dict(lon=116.380920-116.353455, lat=39.770548-39.757880)
SAT_SPAN  = dict(lon=116.380920-116.354828, lat=39.770548-39.758936)
DLO = ROAD_SPAN["lon"]/ROAD_GEO["w"]; DLA = ROAD_SPAN["lat"]/ROAD_GEO["h"]
M_PER_PX = 111320*math.cos(math.radians(39.766))*DLO

FONT  = "C:/Windows/Fonts/msyh.ttc"
FONTB = "C:/Windows/Fonts/msyhbd.ttc"

CAT = {
    "gate":  ("校门",      (70, 70, 70),   (255, 235, 59)),
    "lib":   ("图书馆",    (106, 27, 154), (225, 190, 231)),
    "teach": ("教学/实验",  (13, 71, 161),  (144, 202, 249)),
    "dorm":  ("学生公寓",   (27, 94, 32),   (165, 214, 167)),
    "food":  ("食堂/餐厅",  (191, 54, 12),  (255, 183, 154)),
    "sport": ("训练/体育",  (173, 20, 87),  (244, 143, 177)),
    "shop":  ("超市/便利店", (0, 105, 92),   (128, 203, 196)),
    "bath":  ("澡堂/热水",   (2, 119, 189),  (129, 212, 250)),
    "clinic":("医务室",      (198, 40, 40),  (239, 154, 154)),
    "parcel":("快递/驿站",   (93, 64, 55),   (215, 204, 200)),
    "door":  ("楼门/出入口", (69, 90, 100),  (207, 216, 220)),
    "other": ("其他",        (55, 71, 79),   (236, 239, 241)),
}

# id, 名称, 类别, px, py, 是否画全名
POIS = [
    ("G1", "南2门（主出入口）",       "gate",  1005,  931, True),
    ("B1", "图书馆",                 "lib",   1000,  770, True),
    ("B2", "铸剑楼",                 "teach", 1215,  712, True),
    ("B3", "教学楼",                 "teach", 1370,  812, True),
    ("B4", "实验楼（东区）",          "teach", 1450,  690, True),
    ("B5", "攀登楼",                 "teach",  975,  500, True),
    ("F1", "接待餐厅",               "food",  1590,  782, True),
    ("S1", "田径场（400m）",          "sport", 1393,  550, True),
    ("S2", "田径场看台",              "sport", 1318,  530, False),
    ("S3", "南篮球场",               "sport", 1580,  845, True),
    ("S4", "射击场",                 "sport", 1795,  440, True),
    ("D12","学生公寓12",             "dorm",  1745,  528, False),
    ("D11","学生公寓11",             "dorm",  1750,  580, False),
    ("D10","学生公寓10",             "dorm",  1755,  612, False),
    ("D9", "学生公寓9",              "dorm",  1750,  668, False),
    ("D8", "学生公寓8",              "dorm",  1765,  700, False),
    ("D7", "学生公寓7",              "dorm",  1685,  788, False),
    ("D6", "学生公寓6",              "dorm",  1695,  822, False),
    ("D5", "学生公寓5号楼",           "dorm",  1700,  872, False),
]
DATA_FILE = os.path.join(BASE, "campus_data.json")

def load_pois():
    """优先从 campus_data.json 读点位：这样平台里标注的点会自动进入静态图"""
    try:
        with open(DATA_FILE, encoding="utf-8") as f:
            d = json.load(f)
        out = []
        for p in d.get("pois", []):
            px = p.get("road_px") or p.get("px") or [0, 0]
            out.append((p["id"], p["name"], p.get("cat", "other"),
                        float(px[0]), float(px[1]), p.get("cat") != "dorm"))
        return out or None
    except Exception:
        return None

_loaded = load_pois()
if _loaded:
    POIS = _loaded

ROADS = [
    ("创新道",   [(710, 424), (1860, 424)]),
    ("勤奋道",   [(710, 655), (1860, 655)]),
    ("求实道",   [(900, 733), (1750, 733)]),
    ("忠诚道",   [(1000, 806), (1800, 806)]),
    ("警训路",   [(985, 182), (985, 430)]),
    ("北区横路", [(845, 242), (1085, 242)]),
    ("北纵路",   [(1085, 182), (1085, 300)]),
    ("警知路",   [(1125, 590), (1125, 812)]),
    ("警学路",   [(1265, 200), (1265, 700)]),
    ("警思路",   [(730, 755), (730, 935)]),
    ("正心路",   [(1620, 470), (1620, 900)]),
    ("修身路",   [(1800, 395), (1800, 900)]),
    ("黄亦路",   [(600, 862), (1990, 905)]),
    ("广平大街", [(640, 0), (640, 1536)]),
]
BOUNDARY = [(702, 166), (1118, 178), (1118, 322), (1842, 336), (1840, 912), (702, 866)]

def px2geo(px, py):
    return round(ROAD_GEO["lon_tl"] + px*DLO, 6), round(ROAD_GEO["lat_tl"] - py*DLA, 6)

def road2sat(px, py):
    lon, lat = px2geo(px, py)
    x = (lon - SAT_GEO["lon_tl"]) / (SAT_SPAN["lon"]/SAT_GEO["w"])
    y = (SAT_GEO["lat_tl"] - lat) / (SAT_SPAN["lat"]/SAT_GEO["h"])
    return x, y

def dashed(d, p1, p2, fill, width, dash=14, gap=10):
    x1,y1 = p1; x2,y2 = p2
    L = math.hypot(x2-x1, y2-y1)
    if L == 0: return
    ux, uy = (x2-x1)/L, (y2-y1)/L
    s = 0.0
    while s < L:
        e = min(s+dash, L)
        d.line([(x1+ux*s, y1+uy*s), (x1+ux*e, y1+uy*e)], fill=fill, width=width)
        s = e + gap

def _overlap(a, b):
    return not (a[2] <= b[0] or b[2] <= a[0] or a[3] <= b[1] or b[3] <= a[1])

def place_label(d, cx, cy, text, font, fg, r, occupied, fs):
    """8 个方向试位，选第一个不压盖已有标签的位置"""
    tw = d.textlength(text, font=font)
    th = fs * 1.05
    pad = 2
    cands = [
        (cx + r + 5, cy - th / 2),                 # 右
        (cx - r - 5 - tw, cy - th / 2),            # 左
        (cx + r * 0.7, cy - r - th - 3),           # 右上
        (cx + r * 0.7, cy + r + 3),                # 右下
        (cx - r * 0.7 - tw, cy - r - th - 3),      # 左上
        (cx - r * 0.7 - tw, cy + r + 3),           # 左下
        (cx - tw / 2, cy - r - th - 3),            # 上
        (cx - tw / 2, cy + r + 3),                 # 下
    ]
    for (lx, ly) in cands:
        rect = (lx - pad, ly - pad, lx + tw + pad, ly + th + pad)
        if not any(_overlap(rect, o) for o in occupied):
            occupied.append(rect)
            halo_text(d, (lx, ly), text, font, fg, halo=(255, 255, 255), off=2)
            return
    lx, ly = cands[0]
    occupied.append((lx - pad, ly - pad, lx + tw + pad, ly + th + pad))
    halo_text(d, (lx, ly), text, font, fg, halo=(255, 255, 255), off=2)

def short(s, n=10):
    return s if len(s) <= n else s[:n - 1] + "…"

def halo_text(d, xy, text, font, fill, halo=(255,255,255), off=2):
    x, y = xy
    for dx in (-off, 0, off):
        for dy in (-off, 0, off):
            d.text((x+dx, y+dy), text, font=font, fill=halo)
    d.text((x, y), text, font=font, fill=fill)

def annotate(src, kind, out, scale, title, W_target=5200):
    W, H = src.size
    img = src.resize((W*scale, H*scale), Image.LANCZOS)
    Wn, Hn = img.size
    canvas = Image.new("RGB", (Wn, Hn), (255,255,255))
    canvas.paste(img, (0,0))
    d = ImageDraw.Draw(canvas, "RGBA")
    fs = max(16, int(Wn/150))          # 主字号
    f_num = ImageFont.truetype(FONTB, int(fs*0.95))
    f_name = ImageFont.truetype(FONTB, int(fs*0.78))
    f_t = ImageFont.truetype(FONTB, int(fs*1.5))
    f_s = ImageFont.truetype(FONT, int(fs*0.8))
    r = int(fs*0.62)

    # 校界
    pts = []
    for (x, y) in BOUNDARY:
        if kind == "sat":
            sx, sy = road2sat(x, y); pts.append((sx*scale, sy*scale))
        else:
            pts.append((x*scale, y*scale))
    for i in range(len(pts)):
        dashed(d, pts[i], pts[(i+1) % len(pts)], (30,60,255,220), max(2, int(fs*0.12)))

    # POI：先落点，再避让放标签
    occupied = []
    drawn = []
    for pid, name, cat, x, y, full in POIS:
        if kind == "sat":
            sx, sy = road2sat(x, y); cx, cy = sx*scale, sy*scale
        else:
            cx, cy = x*scale, y*scale
        catname, fg, bg = CAT[cat]
        d.ellipse([cx-r-2, cy-r-2, cx+r+2, cy+r+2], fill=(255,255,255,235))
        d.ellipse([cx-r, cy-r, cx+r, cy+r], fill=bg, outline=fg, width=max(3, int(fs*0.14)))
        num = pid.lstrip("ABCDEFGS") or pid
        tw = d.textlength(num, font=f_num)
        d.text((cx-tw/2, cy-int(fs*0.52)), num, font=f_num, fill=fg)
        occupied.append((cx - r, cy - r, cx + r, cy + r))   # 点本身也占位
        if full:
            drawn.append((cx, cy, name, fg))
    for cx, cy, name, fg in drawn:
        place_label(d, cx, cy, short(name), f_name, fg, r, occupied, fs)

    # 图例
    items = list(CAT.values())
    lw = int(fs*13); lh = int(fs*(1.3*len(items)+6.2))
    lx, ly = int(fs*0.8), Hn - lh - int(fs*0.8)
    d.rectangle([lx, ly, lx+lw, ly+lh], fill=(255,255,255,238), outline=(120,120,120), width=2)
    d.text((lx+int(fs*0.5), ly+int(fs*0.35)), "图例", font=f_s, fill=(30,30,30))
    yy = ly + int(fs*1.9)
    for catname, fg, bg in items:
        d.rectangle([lx+int(fs*0.5), yy+int(fs*0.16), lx+int(fs*1.5), yy+int(fs*0.9)],
                    fill=bg, outline=fg, width=2)
        d.text((lx+int(fs*1.8), yy), catname, font=f_s, fill=(30,30,30))
        yy += int(fs*1.3)
    for extra in ("D5–D12 = 学生公寓5–12号楼", "底图：高德 · GCJ-02 坐标", "点位为人工读点，需实地校正"):
        d.text((lx+int(fs*0.5), yy), extra, font=ImageFont.truetype(FONT, int(fs*0.7)), fill=(70,70,70))
        yy += int(fs*0.95)

    # 比例尺
    bar_m = 200; bar_px = bar_m/M_PER_PX*scale
    x0, y0 = lx + lw + int(fs*1.0), Hn - int(fs*2.4)
    d.rectangle([x0, y0, x0+bar_px, y0+int(fs*0.3)], fill=(0,0,0))
    d.rectangle([x0+bar_px/2, y0, x0+bar_px, y0+int(fs*0.3)], fill=(255,255,255), outline=(0,0,0))
    halo_text(d, (x0, y0-int(fs*1.2)), f"{bar_m} m", f_s, (0,0,0))

    # 指北针
    nx, ny = Wn - int(fs*2.2), int(fs*3.0)
    d.polygon([(nx, ny-int(fs*1.4)), (nx-int(fs*0.65), ny+int(fs*0.55)),
               (nx, ny+int(fs*0.15)), (nx+int(fs*0.65), ny+int(fs*0.55))], fill=(200,0,0))
    halo_text(d, (nx-int(fs*0.32), ny+int(fs*0.7)), "N", f_num, (200,0,0))

    # 标题条
    th = int(fs*2.4)
    d.rectangle([0,0,Wn,th], fill=(255,255,255,242))
    d.text((int(fs*0.8), int(fs*0.35)), title, font=f_t, fill=(20,20,20))
    d.text((int(fs*0.85), th-int(fs*0.85)),
           f"底图：高德地图瓦片拼接（GCJ-02） · 比例约 1px≈{M_PER_PX/scale:.2f}m · 点位为人工读点，误差±30m",
           font=f_s, fill=(90,90,90))

    if out.lower().endswith((".jpg", ".jpeg")):
        canvas.save(out, quality=92, optimize=True, subsampling=1)
    else:
        canvas.save(out, optimize=True)
    print("saved", out, canvas.size)

def build_data():
    pois = []
    for pid, name, cat, x, y, _ in POIS:
        lon, lat = px2geo(x, y)
        pois.append(dict(id=pid, name=name, cat=cat, cat_name=CAT[cat][0],
                         lon=lon, lat=lat, road_px=[x, y],
                         note="坐标人工读点，建议实地校正"))
    def xy(p):
        return (p["lon"]-ROAD_GEO["lon_tl"])*102900*math.cos(math.radians(39.766)), \
               (p["lat"]-ROAD_GEO["lat_tl"])*110574
    pts = [xy(p) for p in pois]
    edges = []
    for i in range(len(pois)):
        for j in range(i+1, len(pois)):
            euc = math.hypot(pts[i][0]-pts[j][0], pts[i][1]-pts[j][1])
            if euc <= 800:
                walk = round(euc*1.3, 1)
                edges.append(dict(a=pois[i]["id"], b=pois[j]["id"],
                                  dist_m=walk, walk_s=round(walk/1.3, 1)))
    data = dict(
        campus="中国人民公安大学 团河校区",
        source="高德地图瓦片拼接 + 人工读点",
        crs="GCJ-02",
        note="点位误差约±30m；dist_m 为直线距离×1.3 绕行系数，非实测路径",
        geo_ref=dict(road=ROAD_GEO, road_span=ROAD_SPAN, meters_per_px_road=round(M_PER_PX, 3)),
        pois=pois,
        roads=[dict(name=nm, polyline=p) for nm, p in ROADS],
        campus_boundary_px=BOUNDARY,
        walk_speed_mps=1.3,
        edges=edges,
    )
    p = os.path.join(BASE, "campus_data.json")
    open(p, "w", encoding="utf-8").write(json.dumps(data, ensure_ascii=False, indent=2))
    print("json:", p, "pois", len(pois), "edges", len(edges))

if __name__ == "__main__":
    build_data()
    annotate(Image.open(ROAD).convert("RGB"), "road",
             os.path.join(BASE, "campus_annotated_road.png"), 2,
             "中国人民公安大学 团河校区 · 楼栋标注图")
    annotate(Image.open(SAT).convert("RGB"), "sat",
             os.path.join(BASE, "campus_annotated_sat.jpg"), 1,
             "中国人民公安大学 团河校区 · 卫星标注图")
