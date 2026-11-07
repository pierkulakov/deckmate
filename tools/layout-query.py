# -*- coding: utf-8 -*-
"""Query a captured layout tree: print ancestor chains for nodes whose text matches.
Usage: python -I tools/layout-query.py <capture.json> <text> [<text> ...] [--depth N]"""
import json, sys

args = sys.argv[1:]
depth = 6
if "--depth" in args:
    i = args.index("--depth"); depth = int(args[i + 1]); del args[i:i + 2]
path, texts = args[0], args[1:]
data = json.load(open(path, encoding="utf-8"))

KEYS = ["backgroundColor", "color", "fontSize", "fontWeight", "lineHeight", "borderRadius", "boxShadow",
        "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "gap", "borderTopWidth", "borderTopColor",
        "backgroundImage", "opacity", "fontFamily", "letterSpacing", "textTransform"]


def fmt(n):
    s = n.get("s", {})
    st = " ".join(f"{k}={s[k]}" for k in KEYS if k in s)
    b = n["b"]
    return f'{n["t"]} [{b[0]:.0f},{b[1]:.0f} {b[2]:.0f}x{b[3]:.0f}] {st}'.strip()


def walk(n, chain):
    chain = chain + [n]
    if n.get("x") is not None:
        for t in texts:
            if n["x"] == t or (t.startswith("~") and t[1:] in n["x"]):
                print(f"== {t!r}")
                for a in reversed(chain[-depth:]):
                    print("   ", fmt(a), (f'"{a.get("x")}"' if a.get("x") else ""))
    for k in n.get("k", []):
        walk(k, chain)


print(f'# {data.get("name", path)} vw={data["vw"]} vh={data["vh"]} dpr={data["dpr"]}')
walk(data["tree"], [])
