#!/usr/bin/env python3
"""把三形态的"当前实测"重算并写回 00-架构与编辑说明.md / overview.md / 99-审阅待决事项.md。

为什么需要这个脚本：
    页数、书签条数、三个产物的体积，都是每轮重建就会变的数。它们在全仓有十几处手写副本，
    已经漂过两次：
      · §5 配比表那一列引用旧值，与当时稿件差 0.4%–1.0%（由 stamp_arch.py 根治）
      · 2026-09-18 补完第 19 章与三张配图后，正文从 328 页变成 339 页、书签从 445 条变成
        456 条，而文档里 6 处"328 页 / 445 条 / 9.2 MB"仍是上一轮的数
    **一处手写的、会随每轮变动的数字必然会漂。** 所以不让它手写。

用法：
    python3 stamp_pdf_stats.py [书目录]            # 默认当前目录
    python3 stamp_pdf_stats.py . --no-check        # 跳过校验器项数那一类规则
    python3 stamp_pdf_stats.py . --check <path>    # 指定 check_manuscript.py 路径

它做三件事：
    1. 量：三个产物的体积、PDF 页数与三层书签分布、HTML 的目录/标题/图锚/重复 id 结构，
       以及 §5 合计行里的全书总字符（由 stamp_arch.py 负责，本脚本只读不写）
    2. 写回：只写"当前态"的行——产物清单、校验结论表、完成度句、待决事项的状态列
    3. 逐条断言每条规则在目标文件里**恰好命中一次**，命中 0 次或多次都报错退出

冻结范围（故意不改，改了就是造假）：
    overview.md §踩坑表里"328 页的 PDF 无法导航""对 328 页技术书完全失真"、
    99-审阅待决事项.md §7/§13 的核验行与作者原话（"一本 328 页的技术书籍，为什么会…"）、
    以及一切形如"本轮注入 445 条书签后实测…"的**轮次记录**。
    那些数字是当时那一轮的取证，只能随轮次一起存档。
    另一处已知残留：00-架构 §8.1"check_manuscript.py 八项全通过"后面跟着八项的中文列举，
    改项数等于改措辞，交作者裁定，不由脚本代劳。

设计原则（与 stamp_arch.py 同）：**只改数字，不改措辞。** 任何一处匹配不上就报错退出，不做猜测。
"""
from __future__ import annotations

import argparse
import collections
import re
import subprocess
import sys
from pathlib import Path

import pymupdf

BOOK = "智能体工程：从一次工具调用到可交付的系统"
ARCH = "00-架构与编辑说明.md"
OVW = "overview.md"
PEND = "99-审阅待决事项.md"
DEFAULT_CHECKER = Path.home() / ".workbuddy/skills/book-studio/scripts/check_manuscript.py"


def measure_html(html: Path) -> dict[str, int]:
    """HTML 结构：目录链接、标题 id、图锚、重复 id、残留 img、未解析 markdown。"""
    s = html.read_text(encoding="utf-8")
    nav = re.search(r'<nav id="nav"[^>]*>(.*?)</nav>', s, re.S)
    if not nav:
        raise SystemExit('ERROR 阅读版里找不到 <nav id="nav">，目录链接无法测量')
    # 「目录链接」沿用文档既有口径：阅读版里全部内部锚链接（目录项 + 正文图链），
    # 上一轮记的 484 = 445 标题 + 39 图锚，就是在这个口径上得到的。
    links = set(re.findall(r'<a[^>]*\bhref="#([^"]+)"', s))
    if not links or not re.search(r'<a[^>]*\bhref="#([^"]+)"', nav.group(1)):
        raise SystemExit("ERROR 目录里一条链接都没有，不能对外声称结构校验通过")
    hids = re.findall(r'<h[123][^>]*\bid="([^"]+)"', s)
    figs = re.findall(r'<(?:figure|section|div)[^>]*\bid="(fig-[^"]+)"', s)
    allids = re.findall(r'\bid="([^"]+)"', s)
    dup = [k for k, v in collections.Counter(allids).items() if v > 1]
    unresolved = len(re.findall(r"^\|\s*---", s, re.M))
    if set(links) - (set(hids) | set(figs)):
        raise SystemExit(f"ERROR 有 {len(set(links) - set(hids) - set(figs))} 条链接指向不存在的锚点")
    return {"nav": len(links), "hids": len(hids), "figs": len(set(figs)),
            "dup": len(dup), "img": s.count("<img"), "mdres": unresolved}


def measure_pdf(pdf: Path) -> dict[str, object]:
    d = pymupdf.open(str(pdf))
    toc = d.get_toc()
    levels = {lvl: sum(1 for t in toc if t[0] == lvl) for lvl in (1, 2, 3)}
    pages = d.page_count
    size = pdf.stat().st_size
    d.close()
    return {"pages": pages, "marks": len(toc), "l1": levels[1], "l2": levels[2],
            "l3": levels[3], "mb": f"{size / 1024 / 1024:.1f}"}


def measure_checker(checker: Path, root: Path) -> tuple[int, int, int]:
    """跑合稿校验器，取「N 项错误 / N 项提醒 / N 项通过」。

    工具版本变了，这三个数就会变——所以也不能手写。校验器本身不通过就报错退出。
    """
    if not checker.is_file():
        raise SystemExit(f"ERROR 找不到校验器 {checker}；确认路径或用 --no-check 跳过这一类规则")
    p = subprocess.run([sys.executable, str(checker), str(root)],
                       capture_output=True, text=True, check=False)
    m = re.search(r"❌ (\d+) 项错误 · ⚠️ (\d+) 项提醒 · ✅ (\d+) 项通过", p.stdout)
    if p.returncode != 0 or not m:
        raise SystemExit(f"ERROR 校验器未通过或未给出项数（exit={p.returncode}）：\n{p.stdout[-500:]}")
    errors, warns, items = (int(m.group(i)) for i in (1, 2, 3))
    return items, errors, warns


def measure_total(arch: Path) -> tuple[int, int]:
    """从 §5 合计行读回全书总字符与原定目标（那一行由 stamp_arch.py 生成）。"""
    m = re.search(r"\|\s*\*\*合计\*\*\s*\|\s*\*\*21 章\*\*\s*\|\s*\*\*([\d,]+)\*\*\s*\|\s*\*\*([\d,]+)\*\*",
                  arch.read_text(encoding="utf-8"))
    if not m:
        raise SystemExit("ERROR §5 合计行未匹配，先跑 stamp_arch.py")
    return int(m.group(2).replace(",", "")), int(m.group(1).replace(",", ""))


def rules() -> list[tuple[str, str, str]]:
    """返回 (文件, 正则, 替换串)。替换串用 {占位} 由 M 字典填充。"""
    return [
        # ---- 00-架构与编辑说明.md ----
        (ARCH, r"\| 规模（实际） \| \*\*21 章 \+ 5 附录 · \d+ 张配图 · A4 \d+ 页\*\*",
         "| 规模（实际） | **21 章 + 5 附录 · {figs} 张配图 · A4 {pages} 页**"),
        (ARCH, r"\*\*A4 打印版实测 \d+ 页\*\*，符合", "**A4 打印版实测 {pages} 页**，符合"),
        (ARCH, r"系统\.md` \| \d+ KB · \d+ 个分片合稿", "系统.md` | {md_kb} KB · {shards} 个分片合稿"),
        (ARCH, r"系统\.html` \| [\d.]+ KB · \d+ 图内联为矢量", "系统.html` | {html_kb} KB · {figs} 图内联为矢量"),
        (ARCH, r"\| \*\*\d+ 页\*\* · 595×842（A4）· 页码居中盖章 · \*\*三层书签 \d+ 条\*\* · 元数据齐备 · [\d.]+ MB \|",
         "| **{pages} 页** · 595×842（A4）· 页码居中盖章 · **三层书签 {marks} 条** · 元数据齐备 · {pdf_mb} MB |"),
        (ARCH, r"按字号带定位 \d+ 个标题", "按字号带定位 {marks} 个标题"),
        # ---- overview.md ----
        (OVW, r"\| 合稿主稿 · \d+ KB \|", "| 合稿主稿 · {md_kb} KB |"),
        (OVW, r"单文件离线阅读版 · [\d.]+ KB · \d+ 图内联为矢量", "单文件离线阅读版 · {html_kb} KB · {figs} 图内联为矢量"),
        (OVW, r"\| `<书名>\.pdf` \| A4 · \*\*\d+ 页\*\* · 页码居中盖章 · \*\*三层书签 \d+ 条\*\* · 元数据齐备 \|",
         "| `<书名>.pdf` | A4 · **{pages} 页** · 页码居中盖章 · **三层书签 {marks} 条** · 元数据齐备 |"),
        (OVW, r"总字符 \*\*[\d,]+\*\* · 配图 \*\*\d+\*\* · A4 \*\*\d+\+? 页\*\*（([^）]*)）",
         "总字符 **{total:,}** · 配图 **{figs}** · A4 **{pages} 页**（\\1）"),
        (OVW, r"目录链接 \d+ ⊆ 标题 id \d+ \+ 图锚 \d+ · \*\*重复 id \d+\*\* · 残留 `<img>` \d+ · 未解析 markdown 残留 \d+",
         "目录链接 {nav} ⊆ 标题 id {hids} + 图锚 {figs} · **重复 id {dup}** · 残留 `<img>` {img} · 未解析 markdown 残留 {mdres}"),
        (OVW, r"\| PDF（随时可在线读） \| \d+ 页 · 595×842（A4）", "| PDF（随时可在线读） | {pages} 页 · 595×842（A4）"),
        (OVW, r"\| \*\*PDF 书签\*\* \| \*\*\d+ 条三层书签（\d+ 篇/章 \+ \d+ 节 \+ \d+ 子节）",
         "| **PDF 书签** | **{marks} 条三层书签（{l1} 篇/章 + {l2} 节 + {l3} 子节）"),
        (OVW, r"已是一本 \d+ 页、\d+ 章体例齐全、\d+ 图完整的书", "已是一本 {pages} 页、{chapters} 章体例齐全、{figs} 图完整的书"),
        # ---- 99-审阅待决事项.md（只改状态列里的当前态） ----
        (PEND, r"（\d+ 图 / A4 \d+ 页），字数未达成（[\d.]+ 万 vs [\d.]+ 万）",
         "（{figs} 图 / A4 {pages} 页），字数未达成（{total_wan} 万 vs {target_wan} 万）"),
        (PEND, r"：HTML [\d.]+ KB（\d+ 图内联为矢量）、A4 打印版 \d+ 页 \|",
         "：HTML {html_kb} KB（{figs} 图内联为矢量）、A4 打印版 {pages} 页 |"),
        (PEND, r"\*\*A4 打印版实测 \d+ 页\*\*，符合", "**A4 打印版实测 {pages} 页**，符合"),
        (PEND, r"（已是一本 \d+ 页的完整书）", "（已是一本 {pages} 页的完整书）"),
    ]


CHECK_RULES: list[tuple[str, str, str]] = [
    (OVW, r"\| `check_manuscript\.py` \| \*\*\d+ 项全通过 · \d+ 错误 · \d+ 提醒\*\* \|",
     "| `check_manuscript.py` | **{items} 项全通过 · {errors} 错误 · {warns} 提醒** |"),
    (PEND, r"；校验 \d+ 项全通过 \|", "；校验 {items} 项全通过 |"),
]


def apply(root: Path, rules: list[tuple[str, str, str]], M: dict[str, object]) -> tuple[set[str], int]:
    cache: dict[str, str] = {}
    touched: set[str] = set()
    hits_total = 0
    for fn, pat, tpl in rules:
        path = root / fn
        if fn not in cache:
            cache[fn] = path.read_text(encoding="utf-8")
        body = cache[fn]
        c = re.compile(pat)
        hits = c.findall(body)
        if len(hits) != 1:
            raise SystemExit(f"ERROR {fn} 里该规则命中 {len(hits)} 次（应为 1 次）：{pat}")
        new = c.sub(tpl.format(**M), body, count=1)
        if new != body:
            touched.add(fn)
            hits_total += 1
        cache[fn] = new
    for fn, body in cache.items():
        (root / fn).write_text(body, encoding="utf-8")
    return touched, hits_total


def main() -> int:
    ap = argparse.ArgumentParser(description="重算并写回三形态的当前实测数字")
    ap.add_argument("root", nargs="?", default=".", type=Path)
    ap.add_argument("--check", type=Path, default=DEFAULT_CHECKER, help="check_manuscript.py 路径")
    ap.add_argument("--no-check", action="store_true", help="跳过校验器项数规则")
    a = ap.parse_args()

    root = a.root
    md, html, pdf = root / f"{BOOK}.md", root / f"{BOOK}.html", root / f"{BOOK}.pdf"
    for p in (md, html, pdf):
        if not p.is_file():
            print(f"ERROR 缺少产物 {p.name}，先重建三形态")
            return 1

    h = measure_html(html)
    p = measure_pdf(pdf)
    total, target = measure_total(root / ARCH)
    M: dict[str, object] = {
        "md_kb": round(md.stat().st_size / 1024),
        "html_kb": f"{html.stat().st_size / 1024:.1f}",
        "shards": len(list((root / "parts").glob("*.md"))),
        "pages": p["pages"], "marks": p["marks"], "l1": p["l1"], "l2": p["l2"], "l3": p["l3"],
        "pdf_mb": p["mb"], "total": total, "target": target,
        "total_wan": f"{total / 10000:.1f}", "target_wan": f"{target / 10000:.1f}",
        "figs": h["figs"], "nav": h["nav"], "hids": h["hids"], "dup": h["dup"],
        "img": h["img"], "mdres": h["mdres"], "chapters": 21,
    }
    changed: set[str] = set()
    n_sites = 0
    t, n = apply(root, rules(), M)
    changed |= t
    n_sites += n
    if not a.no_check:
        M["items"], M["errors"], M["warns"] = measure_checker(a.check, root)
        t, n = apply(root, CHECK_RULES, M)
        changed |= t
        n_sites += n
    print(f"✅ 已重算并写回 {n_sites} 处（涉及 {len(changed)} 个文件：{'、'.join(sorted(changed))}）")
    print(f"   合稿 {M['md_kb']} KB · 阅读版 {M['html_kb']} KB · PDF {M['pdf_mb']} MB")
    print(f"   {M['pages']} 页 · 书签 {M['marks']} 条（{M['l1']}/{M['l2']}/{M['l3']}）"
          f" · 目录链接 {M['nav']} ⊆ 标题 {M['hids']} + 图锚 {M['figs']}")
    print(f"   全书总字符 {total:,}（目标 {target:,}）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
