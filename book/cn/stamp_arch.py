#!/usr/bin/env python3
"""把 00-架构与编辑说明.md §5 篇幅配比表里的数字重算并写回。

为什么需要这个脚本：
    那张表里有一列"实际总字符"，它会随每一轮编辑变动。曾经发生过一次——
    一份外部审稿意见引用了这一列的旧值，与当时的稿件已经差 0.4%–1.0%。
    **一处手写的、会随每轮变动的数字必然会漂。** 所以不让它手写。

用法：
    python3 stamp_arch.py [书目录]      # 默认当前目录

它做三件事：
    1. 重算各篇"实际总字符"与配图数，写回表格
    2. 重算合计行
    3. 重算表下那段"差额说明"里的百分比与三个篇级数字

设计原则：**只改数字，不改措辞。** 任何一处匹配不上就报错退出，不做猜测。
"""
import re
import sys
from pathlib import Path

CJK = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff]")

# 表格行标签 → parts/ 下的文件
GROUPS = [
    ("前置（前言 / 全书地图 / 阅读路线 / 术语与约定）", ["00-front.md"]),
    ("第 0 篇 起步", ["01-ch00.md"]),
    ("第一篇 认知", ["01-ch01.md", "03-ch02.md"]),
    ("第二篇 技艺", ["04-ch03.md", "05-ch04.md", "06-ch05.md"]),
    ("第三篇 能力", ["07-ch06.md", "08-ch07.md", "09-ch08.md", "10-ch09.md", "11-ch10.md"]),
    ("第四篇 系统", ["12-ch11.md", "13-ch12.md", "14-ch13.md"]),
    ("第五篇 交付", ["15-ch14.md", "16-ch15.md", "17-ch16.md"]),
    ("第六篇 综合", ["18-ch17.md", "19-ch18.md"]),
    ("第七篇 迁移", ["20-ch19.md", "21-ch20.md"]),
    ("附录 A–E", ["89-appendix-a.md", "90-appendix-b.md", "91-appendix-c.md",
                 "92-appendix-d.md", "93-appendix-e.md"]),
]
THIN = ("第五篇 交付", "第六篇 综合", "第七篇 迁移")   # 差额集中在这些篇


def measure(parts: Path):
    """返回 {标签: (总字符, 配图数)}、全书总字符、以及两个数字。"""
    figs = {}
    for f in (parts.parent / "images").glob("*.png"):
        m = re.match(r"fig-(\d+)-", f.stem)
        if m:
            figs[int(m.group(1))] = figs.get(int(m.group(1)), 0) + 1

    out, total = {}, 0
    for label, files in GROUPS:
        chars = sum(len((parts / n).read_text(encoding="utf-8")) for n in files)
        chs = []
        for n in files:
            m = re.match(r"^\d+-ch(\d+)\.md$", n)
            if m:
                chs.append(int(m.group(1)))
        nfig = sum(figs.get(c, 0) for c in chs)
        out[label] = (chars, nfig)
        total += chars

    per_ch = {}
    for f in parts.glob("*.md"):
        m = re.match(r"^\d+-ch(\d+)\.md$", f.name)
        if m:
            per_ch[int(m.group(1))] = len(f.read_text(encoding="utf-8"))
    thin_ch = [per_ch[c] for label, files in GROUPS if label in THIN
               for c in (int(re.match(r"^\d+-ch(\d+)\.md$", n).group(1)) for n in files
                         if re.match(r"^\d+-ch\d+\.md$", n))]
    return out, total, min(thin_ch), max(thin_ch)


def main() -> int:
    root = Path(sys.argv[1] if len(sys.argv) > 1 else ".")
    arch = root / "00-架构与编辑说明.md"
    parts = root / "parts"
    if not arch.exists() or not parts.is_dir():
        print(f"ERROR 找不到 {arch} 或 {parts}")
        return 1

    s = arch.read_text(encoding="utf-8")
    vals, total, thin_lo, thin_hi = measure(parts)
    target = 0
    changed = 0

    for label, (chars, nfig) in vals.items():
        pat = re.compile(r"(\|\s*" + re.escape(label) + r"\s*\|\s*[^|]*\|\s*[\d,]+\s*\|\s*)([\d,]+)(\s*\|\s*)(\d+)([^|]*\|)")
        m = pat.search(s)
        if not m:
            print(f"ERROR 表格行未匹配：{label}")
            return 1
        target += 0
        s = s[:m.start()] + m.group(1) + f"{chars:,}" + m.group(3) + str(nfig) + m.group(5) + s[m.end():]
        changed += 1

    # 合计行：目标列即各目标之和
    mt = re.search(r"\|\s*\*\*合计\*\*\s*\|\s*\*\*21 章\*\*\s*\|\s*\*\*([\d,]+)\*\*\s*\|\s*\*\*[\d,（）约万亿.]+\*\*\s*\|\s*\*\*(\d+)\*\*\s*\|", s)
    if not mt:
        print("ERROR 合计行未匹配")
        return 1
    target = int(mt.group(1).replace(",", ""))
    nfig_total = sum(v[1] for v in vals.values())
    s = s[:mt.start()] + (f"| **合计** | **21 章** | **{target:,}** | **{total:,}** | **{nfig_total}** |") + s[mt.end():]
    changed += 1

    # 差额段
    md = re.search(
        r"(> \*\*一处必须如实说明的差额\*\*：实际 \*\*)[\d,]+(\*\* 总字符，低于原定 )[\d,]+( 目标约 \*\*)[\d]+%(?:\*\*。)",
        s)
    if not md:
        print("ERROR 差额段未匹配")
        return 1
    gap = target - total
    pct = round(gap / target * 100)
    s = s[:md.start()] + (md.group(1) + f"{total:,}" + md.group(2) + f"{target:,}" + md.group(3) + f"{pct}%**。") + s[md.end():]
    changed += 1

    # 三个篇级数字（一次性替换，避免每次都命中第一个）
    newmap = {}
    for label in THIN:
        short = label.split()[-1]          # 交付 / 综合 / 迁移
        newmap[short] = vals[label][0]

    def _sub(mm):
        nonlocal changed
        short = mm.group(1)
        if short not in newmap:
            return mm.group(0)
        changed += 1
        return f"{short} {mm.group(2)}→{newmap[short]:,}"

    s, n = re.subn(r"(交付|综合|迁移) ([\d,]+)→[\d,]+", _sub, s)
    if n == 0:
        print("ERROR 篇级差额未匹配")
        return 1

    # 每章区间
    mr = re.search(r"\*\*这三篇的每章实际落在 [\d,]+–[\d,]+ 总字符\*\*", s)
    if mr:
        s = s[:mr.start()] + f"**这三篇的每章实际落在 {thin_lo:,}–{thin_hi:,} 总字符**" + s[mr.end():]
        changed += 1

    arch.write_text(s, encoding="utf-8")
    print(f"✅ 已重算并写回 {changed} 处")
    print(f"   全书总字符 {total:,} · 配图 {nfig_total} · 目标 {target:,} · 差额 {gap:,}（{pct}%）")
    print(f"   第五~七篇每章区间 {thin_lo:,}–{thin_hi:,}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
