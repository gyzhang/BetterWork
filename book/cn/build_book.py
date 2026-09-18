#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""《智能体工程：从一次工具调用到可交付的系统》合稿脚本。

用法：
    /opt/miniconda3/bin/python3 build_book.py

做三件事：
  1. 按显式顺序把 parts/*.md 合稿成 <书名>.md（**顺序写死在脚本里，不靠记忆**）
  2. 校验 md == "".join(parts)，任何缺片/重片立即报错
  3. 打印字数与章数概览

合稿产物是脚本生成的，**永远不手改**。改正文请改 parts/，然后重跑本脚本。
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PARTS = ROOT / "parts"
BOOK_TITLE = "智能体工程：从一次工具调用到可交付的系统"
OUT_MD = ROOT / f"{BOOK_TITLE}.md"

# ---- 合稿顺序（显式，不靠 glob 排序） ------------------------------------
ORDER = [
    "00-front.md",
    "01-ch00.md",
    "01-ch01.md",
    "03-ch02.md",
    "04-ch03.md",
    "05-ch04.md",
    "06-ch05.md",
    "07-ch06.md",
    "08-ch07.md",
    "09-ch08.md",
    "10-ch09.md",
    "11-ch10.md",
    "12-ch11.md",
    "13-ch12.md",
    "14-ch13.md",
    "15-ch14.md",
    "16-ch15.md",
    "17-ch16.md",
    "18-ch17.md",
    "19-ch18.md",
    "20-ch19.md",
    "21-ch20.md",
    "89-appendix-a.md",
    "90-appendix-b.md",
    "91-appendix-c.md",
    "92-appendix-d.md",
    "93-appendix-e.md",
]


def main() -> int:
    missing = [n for n in ORDER if not (PARTS / n).exists()]
    if missing:
        print("ERROR 缺少分片：", ", ".join(missing))
        return 1

    on_disk = sorted(p.name for p in PARTS.glob("*.md"))
    extra = [n for n in on_disk if n not in ORDER]
    if extra:
        print("ERROR parts/ 里有未纳入合稿顺序的文件：", ", ".join(extra))
        return 1

    bodies = []
    for name in ORDER:
        text = (PARTS / name).read_text(encoding="utf-8")
        bodies.append(text.rstrip("\n") + "\n")

    merged = "\n".join(bodies)

    # 独立复算：从磁盘重读全部文件再拼一次，两路必须一致
    verify = "\n".join(
        (PARTS / n).read_text(encoding="utf-8").rstrip("\n") + "\n" for n in ORDER
    )
    if merged != verify:
        print("ERROR 合稿校验失败：两路拼接结果不一致")
        return 1

    OUT_MD.write_text(merged, encoding="utf-8")

    # 附录 B 一致性：正文引用的参考实现文件必须在附录 B 登记（反之不强制）
    import re as _re
    btxt = (PARTS / "90-appendix-b.md").read_text(encoding="utf-8")
    listed = set(_re.findall(r"`((?:docs|packages|apps|resources|scripts)/[^`]+|package(?:-lock)?\.json|LICENSE)`", btxt))
    pat = _re.compile(r"`((?:docs|packages|apps|resources|scripts)/[^`]+|package(?:-lock)?\.json|LICENSE)`")
    missing = {}
    for name, text in zip(ORDER, bodies):
        if name == "90-appendix-b.md":
            continue
        for i, line in enumerate(text.splitlines(), 1):
            for m in pat.finditer(line):
                p_ = m.group(1)
                if p_.endswith("/*") or p_ not in listed:
                    if not p_.endswith("/*"):
                        missing.setdefault(p_, []).append(f"{name}:{i}")
    if missing:
        print("ERROR 以下文件被正文引用，但未在附录 B 登记：")
        for k, v in sorted(missing.items()):
            print(f"   {k}  ← {', '.join(v[:3])}")
        return 1

    chars = sum(len(t) for t in bodies)
    chapters = merged.count("\n# 第 ") + sum(
        1 for line in merged.splitlines() if line.startswith("# 第 ")
    )
    print(f"✅ 合稿完成：{OUT_MD.name}")
    print(f"   分片 {len(ORDER)} 个 · 中文总字符 {chars:,} · 章标题 {max(chapters, 1)} 个")
    print(f"   体积 {OUT_MD.stat().st_size / 1024:.0f} KB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
