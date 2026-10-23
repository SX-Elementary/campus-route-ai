#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""高德瓦片拼接：<kind> road|sat|satlbl  经纬度范围  zoom  out.png"""
import io, math, os, sys, time, urllib.request, ssl
ctx = ssl.create_default_context(); ctx.check_hostname=False; ctx.verify_mode=ssl.CERT_NONE
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
TEMPLATES = {
 "road":   "https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}",
 "sat":    "https://webst0{s}.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}",
 "satlbl": "https://webst0{s}.is.autonavi.com/appmaptile?style=8&x={x}&y={y}&z={z}",
}
def deg2num(lat, lon, z):
    n = 2.0**z
    x = (lon+180.0)/360.0*n
    y = (1.0-math.asinh(math.tan(math.radians(lat)))/math.pi)/2.0*n
    return x, y
def num2deg(x, y, z):
    n = 2.0**z
    return math.degrees(math.atan(math.sinh(math.pi*(1-2*y/n)))), x/n*360.0-180.0
def fetch(url, retries=3):
    last=None
    for i in range(retries):
        try:
            req=urllib.request.Request(url, headers={"User-Agent":UA,"Referer":"https://www.amap.com/"})
            with urllib.request.urlopen(req, timeout=20, context=ctx) as r:
                return r.read()
        except Exception as e:
            last=e; time.sleep(1.0+i)
    raise last
def stitch(kind, lon1, lat1, lon2, lat2, z, out, cache_dir="tiles"):
    from PIL import Image
    tmpl = TEMPLATES[kind]
    xa, ya = deg2num(lat2, lon1, z)
    xb, yb = deg2num(lat1, lon2, z)
    tx0, ty0, tx1, ty1 = int(math.floor(xa)), int(math.floor(ya)), int(math.floor(xb)), int(math.floor(yb))
    nx, ny = tx1-tx0+1, ty1-ty0+1
    canvas = Image.new("RGB", (nx*256, ny*256), (250,250,250))
    os.makedirs(cache_dir, exist_ok=True)
    ok=0
    for j in range(ny):
        for i in range(nx):
            x, y = tx0+i, ty0+j
            cache = os.path.join(cache_dir, "%s_%d_%d_%d.png" % (kind, z, x, y))
            if os.path.exists(cache) and os.path.getsize(cache) > 500:
                data = open(cache,"rb").read()
            else:
                data = fetch(tmpl.format(s=((x+y)%4)+1, x=x, y=y, z=z)); open(cache,"wb").write(data)
            try:
                canvas.paste(Image.open(io.BytesIO(data)).convert("RGB"), (i*256, j*256)); ok+=1
            except Exception as e:
                print("bad tile", x, y, e, file=sys.stderr)
    canvas.save(out)
    lat_tl, lon_tl = num2deg(tx0, ty0, z)
    lat_br, lon_br = num2deg(tx1+1, ty1+1, z)
    print("saved %s  tiles %dx%d ok=%d" % (out, nx, ny, ok))
    print("geo z=%d TL=(%.6f,%.6f) BR=(%.6f,%.6f)" % (z, lat_tl, lon_tl, lat_br, lon_br))
if __name__ == "__main__":
    kind = sys.argv[1]
    lon1, lat1, lon2, lat2 = map(float, sys.argv[2:6])
    z = int(sys.argv[6]); out = sys.argv[7]
    stitch(kind, lon1, lat1, lon2, lat2, z, out)
