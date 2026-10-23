/* core.js —— 路网构建 + 最短路（纯逻辑，无 DOM，可在 Node 里单测）
 * 坐标：底图像素（campus_road_final_z17.png, 2560x1536），1px ≈ 0.9167 m
 * 与 build_graph.py 完全同构：道路两两求交 -> POI 投影到最近道路 -> 沿路连边
 */
(function (root) {
  "use strict";

  var M_PER_PX = 0.916532;            // 由地理参照算出，见 README
  var EPS = 0.5;                      // 去重阈值（像素）

  var CATS = {
    gate:   { name: "校门",      fg: "#37474f", bg: "#ffe082" },
    lib:    { name: "图书馆",    fg: "#6a1b9a", bg: "#e1bee7" },
    teach:  { name: "教学/实验", fg: "#0d47a1", bg: "#90caf9" },
    dorm:   { name: "学生公寓",  fg: "#1b5e20", bg: "#a5d6a7" },
    food:   { name: "食堂/餐厅", fg: "#bf360c", bg: "#ffb799" },
    sport:  { name: "训练/体育", fg: "#ad1457", bg: "#f48fb1" },
    shop:   { name: "超市/便利店", fg: "#00695c", bg: "#80cbc4" },
    bath:   { name: "澡堂/热水",  fg: "#0277bd", bg: "#81d4fa" },
    clinic: { name: "医务室",    fg: "#c62828", bg: "#ef9a9a" },
    parcel: { name: "快递/驿站",  fg: "#5d4037", bg: "#d7ccc8" },
    door:   { name: "楼门/出入口", fg: "#455a64", bg: "#cfd8dc" },
    other:  { name: "其他",      fg: "#37474f", bg: "#eceff1" }
  };

  function key(p) { return p[0].toFixed(2) + "," + p[1].toFixed(2); }
  function dist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }

  function segInter(p1, p2, p3, p4) {
    var x1 = p1[0], y1 = p1[1], x2 = p2[0], y2 = p2[1];
    var x3 = p3[0], y3 = p3[1], x4 = p4[0], y4 = p4[1];
    var d = (x2 - x1) * (y4 - y3) - (y2 - y1) * (x4 - x3);
    if (Math.abs(d) < 1e-9) return null;
    var t = ((x3 - x1) * (y4 - y3) - (y3 - y1) * (x4 - x3)) / d;
    var u = ((x3 - x1) * (y2 - y1) - (y3 - y1) * (x2 - x1)) / d;
    if (t < -1e-6 || t > 1 + 1e-6 || u < -1e-6 || u > 1 + 1e-6) return null;
    return [x1 + t * (x2 - x1), y1 + t * (y2 - y1)];
  }

  function projectOnSeg(p, a, b) {
    var vx = b[0] - a[0], vy = b[1] - a[1];
    var L2 = vx * vx + vy * vy;
    var t = L2 === 0 ? 0 : ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / L2;
    t = Math.max(0, Math.min(1, t));
    return [a[0] + t * vx, a[1] + t * vy];
  }

  /* 构建路网。
   * roads: [{name, polyline:[[x,y],...]}]
   * pois:  [{id, name, cat, px:[x,y]}]
   * 返回 {nodes, edges, adj, access, poiNode}
   */
  function buildGraph(roads, pois) {
    var ptRoads = Object.create(null);   // "x,y" -> Set(roadIdx)
    var ptPx = Object.create(null);

    function addPt(p, roadIdx) {
      var k = key(p);
      if (!ptRoads[k]) { ptRoads[k] = new Set(); ptPx[k] = [Number(k.split(",")[0]), Number(k.split(",")[1])]; }
      ptRoads[k].add(roadIdx);
      return k;
    }

    // 1) 交点
    for (var i = 0; i < roads.length; i++) {
      for (var j = i + 1; j < roads.length; j++) {
        var A = roads[i].polyline, B = roads[j].polyline;
        for (var a = 0; a < A.length - 1; a++) {
          for (var b = 0; b < B.length - 1; b++) {
            var p = segInter(A[a], A[a + 1], B[b], B[b + 1]);
            if (p) { addPt(p, i); addPt(p, j); }
          }
        }
      }
    }

    // 2) POI 投影
    var proj = Object.create(null);
    pois.forEach(function (poi) {
      var best = null;
      for (var r = 0; r < roads.length; r++) {
        var pl = roads[r].polyline;
        for (var s = 0; s < pl.length - 1; s++) {
          var q = projectOnSeg(poi.px, pl[s], pl[s + 1]);
          var dd = dist(poi.px, q);
          if (!best || dd < best.d) best = { d: dd, p: q, r: r };
        }
      }
      // 1px 内的已有节点直接吸附，避免亚像素缝隙把路网截断
      var proj_pt = best.p, dd2 = best.d;
      for (var pk in ptRoads) {
        if (ptRoads[pk].has(best.r)) {
          var q = ptPx[pk];
          if (Math.hypot(q[0] - proj_pt[0], q[1] - proj_pt[1]) < 1.0) { proj_pt = q; dd2 = Math.hypot(poi.px[0] - q[0], poi.px[1] - q[1]); break; }
        }
      }
      var k = addPt(proj_pt, best.r);
      proj[poi.id] = { d: dd2, k: k, road: roads[best.r].name };
    });

    // 3) 节点表
    var nodes = [], nodeOf = Object.create(null);
    function nodeId(k) {
      if (!nodeOf[k]) { nodeOf[k] = "n" + nodes.length; nodes.push({ id: nodeOf[k], px: ptPx[k], kind: "road" }); }
      return nodeOf[k];
    }
    pois.forEach(function (poi) {
      var kk = "poi:" + poi.id;
      if (!nodeOf[kk]) { nodeOf[kk] = "p" + poi.id; nodes.push({ id: nodeOf[kk], px: poi.px.slice(), kind: "poi", poi: poi.id }); }
    });

    // 4) 沿路连边
    var edges = [], adj = Object.create(null);
    function link(u, v, w, road) {
      if (u === v || w <= 0) return;
      edges.push({ a: u, b: v, dist_m: +w.toFixed(1), road: road || "" });
      (adj[u] = adj[u] || []).push([v, w]);
      (adj[v] = adj[v] || []).push([u, w]);
    }

    roads.forEach(function (road, ri) {
      var pts = [];
      for (var k in ptRoads) if (ptRoads[k].has(ri)) pts.push(ptPx[k]);
      if (pts.length < 2) return;
      var p0 = road.polyline[0], p1 = road.polyline[road.polyline.length - 1];
      var vx = p1[0] - p0[0], vy = p1[1] - p0[1];
      var L = Math.hypot(vx, vy) || 1;
      pts.sort(function (u, v) {
        return ((u[0] - p0[0]) * vx + (u[1] - p0[1]) * vy) / L
             - ((v[0] - p0[0]) * vx + (v[1] - p0[1]) * vy) / L;
      });
      for (var i2 = 0; i2 < pts.length - 1; i2++) {
        var dpx = dist(pts[i2], pts[i2 + 1]);
        if (dpx < EPS) continue;
        link(nodeId(key(pts[i2])), nodeId(key(pts[i2 + 1])), dpx * M_PER_PX, road.name);
      }
    });

    // 5) POI 接入边
    var access = Object.create(null);
    pois.forEach(function (poi) {
      var p = proj[poi.id];
      var a = nodeOf["poi:" + poi.id], b = nodeId(p.k);
      access[poi.id] = { node: a, roadNode: b, access_m: +(p.d * M_PER_PX).toFixed(1), road: p.road };
      if (p.d * M_PER_PX > 0.5) link(a, b, p.d * M_PER_PX, "接入");
    });

    return { nodes: nodes, edges: edges, adj: adj, access: access, nodesById: nodeOf, proj: proj };
  }

  /* Dijkstra：返回 {dist(米), path:[nodeId...]} */
  function shortest(adj, src, dst) {
    var distMap = Object.create(null), prev = Object.create(null), done = Object.create(null);
    distMap[src] = 0;
    var pq = [[0, src]];
    while (pq.length) {
      // 简单二叉堆够用；图很小
      pq.sort(function (x, y) { return x[0] - y[0]; });
      var cur = pq.shift(), u = cur[1], du = cur[0];
      if (done[u]) continue;
      done[u] = 1;
      if (u === dst) break;
      var nb = adj[u] || [];
      for (var i = 0; i < nb.length; i++) {
        var v = nb[i][0], w = nb[i][1];
        var nd = du + w;
        if (distMap[v] === undefined || nd < distMap[v]) {
          distMap[v] = nd; prev[v] = u; pq.push([nd, v]);
        }
      }
    }
    if (distMap[dst] === undefined) return null;
    var path = [dst], x = dst;
    while (x !== src) { x = prev[x]; path.push(x); }
    path.reverse();
    return { dist: distMap[dst], path: path };
  }

  /* POI -> POI 路线，返回 {dist_m, walk_s, pts:[[x,y],...]} */
  function routeBetween(graph, poiA, poiB, speed) {
    speed = speed || 1.3;
    var g = graph;
    var a = g.access[poiA], b = g.access[poiB];
    if (!a || !b) return null;
    var r = shortest(g.adj, a.node, b.node);
    if (!r) return null;
    var byId = Object.create(null);
    g.nodes.forEach(function (n) { byId[n.id] = n.px; });
    var pts = [byId[g.nodesById["poi:" + poiA]]];
    r.path.forEach(function (nid) { pts.push(byId[nid].slice()); });
    pts.push(byId[g.nodesById["poi:" + poiB]].slice());
    // 去重
    var out = [pts[0]];
    for (var i = 1; i < pts.length; i++) {
      if (dist(pts[i], out[out.length - 1]) > 0.3) out.push(pts[i]);
    }
    return { dist_m: +r.dist.toFixed(1), walk_s: +(r.dist / speed).toFixed(0), pts: out, nodes: r.path };
  }

  var api = { M_PER_PX: M_PER_PX, CATS: CATS, buildGraph: buildGraph, shortest: shortest, routeBetween: routeBetween };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.CampusCore = api;
})(typeof window !== "undefined" ? window : globalThis);
