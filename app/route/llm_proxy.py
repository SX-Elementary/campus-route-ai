#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""本地 API 代理 + 静态站点服务（零依赖）

作用：把浏览器对 /api/llm 的请求转发到你的大模型服务，Key 只留在本机环境变量里，
      网页端永远拿不到 Key。

用法：
    set LLM_BASE=https://api.deepseek.com/v1/chat/completions
    set LLM_KEY=sk-xxxx
    set LLM_MODEL=deepseek-chat
    python route\llm_proxy.py          # 默认 http://127.0.0.1:4181

然后在页面「今日路线 → API 设置」里填：
    Base URL: http://127.0.0.1:4181/api/llm
    模型:     deepseek-chat
    Key:      留空

如果不设 LLM_KEY，代理只做转发（适合 Ollama 这类本地模型，无需 Key）。
"""
import json
import os
import sys
import urllib.error
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV_FILE = os.environ.get("XINGZHI_ENV") or os.path.join(os.path.dirname(ROOT), ".secrets", "llm.env")


def load_env_file(path):
    """从站点目录之外的文件读配置（这样 key 不会被静态服务暴露）"""
    if not os.path.exists(path):
        return
    for line in open(path, encoding="utf-8"):
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        if k.strip() and not os.environ.get(k.strip()):
            os.environ[k.strip()] = v.strip()


load_env_file(ENV_FILE)
PORT = int(os.environ.get("PORT", "4181"))
LLM_BASE = os.environ.get("LLM_BASE", "").strip()
LLM_KEY = os.environ.get("LLM_KEY", "").strip()
LLM_MODEL = os.environ.get("LLM_MODEL", "").strip()
TIMEOUT = float(os.environ.get("LLM_TIMEOUT", "30"))


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS, GET")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        if self.path.startswith("/api/health"):
            body = json.dumps({
                "ok": True, "proxy": "xingzhi-route",
                "llm_base": LLM_BASE or None, "model": LLM_MODEL or None,
                "key": bool(LLM_KEY)
            }, ensure_ascii=False).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self._cors()
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        return super().do_GET()

    def do_POST(self):
        if not self.path.startswith("/api/llm"):
            self.send_error(404, "only /api/llm")
            return
        if not LLM_BASE:
            self._json(500, {"error": "未配置 LLM_BASE 环境变量"})
            return
        try:
            n = int(self.headers.get("Content-Length") or 0)
            payload = json.loads(self.rfile.read(n) or b"{}")
        except Exception as e:
            self._json(400, {"error": "请求体不是 JSON: %s" % e})
            return

        if LLM_MODEL and not payload.get("model"):
            payload["model"] = LLM_MODEL
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        req = urllib.request.Request(LLM_BASE, data=data, method="POST")
        req.add_header("Content-Type", "application/json")
        if LLM_KEY:
            req.add_header("Authorization", "Bearer " + LLM_KEY)

        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                body = r.read()
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self._cors()
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "ignore")[:500]
            self._json(e.code, {"error": "上游 %s: %s" % (e.code, detail)})
        except Exception as e:
            self._json(502, {"error": "%s: %s" % (type(e).__name__, e)})

    def _json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self._cors()
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        sys.stderr.write("[proxy] " + (fmt % args) + "\n")


if __name__ == "__main__":
    print("静态站点: http://127.0.0.1:%d/" % PORT)
    print("模型接口: http://127.0.0.1:%d/api/llm  -> %s" % (PORT, LLM_BASE or "（未设置 LLM_BASE）"))
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
