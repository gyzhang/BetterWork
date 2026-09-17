#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""给 A4 PDF 注入书签（大纲）与文档元数据。

用法：
    /opt/miniconda3/bin/python3 add_pdf_bookmarks.py <book.html> <in.pdf> [out.pdf]
不传 out.pdf 时原地覆盖。

为什么需要这一步
----------------
Chrome 的 `--print-to-pdf` **不会**从 HTML 标题生成 PDF 大纲。一份 300+ 页、400 多个标题的
书，没有书签就只能在在线阅读器里一页页翻——PDF 不"只是打印版"，它往往就是在线阅读版。

定位原理（不靠猜）
----------------
1. 从 HTML 取标题序列（文档顺序、层级、显示文本）——那是权威清单。
2. 在 PDF 里按**字号带**抓标题候选：
     层级 1（篇/章/附录）：15.5–17.5pt
     层级 2（节）        ：12.70–12.95pt
     层级 3（子节）      ：10.90–11.15pt
   （正文 10.5pt、代码 8.7pt、表 9.1pt，与三档均不重叠）
3. **排除封面页**——封面是独立 SVG，它的副标题字号会落进第 3 档，制造一条假标题。
4. 两份清单**逐条比对归一化文本**；只有全部对上才落书签。
   **对不上就报错退出，不猜页码。**
"""
from __future__ import annotations

import html as H
import re
import sys
from pathlib import Path

import pymupdf

# 字号带：(层级, 下界, 上界)
BANDS = [(1, 15.5, 17.5), (2, 12.70, 12.95), (3, 10.90, 11.15)]
COVER_PAGES = 1  # 封面页数，从第 1 页起


def norm(s: str) -> str:
    """归一化：去掉全部空白。只用于比对，不用于显示。"""
    return re.sub(r"\s+", "", s)


def headings_from_html(path: Path) -> list[tuple[int, str]]:
    """按文档顺序取 <h1|h2|h3 id="...">：返回 (层级, 显示文本)。"""
    src = path.read_text(encoding="utf-8")
    out: list[tuple[int, str]] = []
    for m in re.finditer(r'<h([1-3])[^>]*\bid="[^"]+"[^>]*>(.*?)</h\1>', src, re.S):
        level = int(m.group(1))
        text = H.unescape(re.sub(r"<[^>]+>", "", m.group(2))).strip()
        text = re.sub(r"\s+", " ", text)
        if text:
            out.append((level, text))
    return out


def headings_from_pdf(doc: pymupdf.Document) -> list[tuple[int, int, str]]:
    """按文档顺序取 PDF 里的标题候选：(层级, 页码 1 起, 文本)。"""
    out: list[tuple[int, int, str]] = []
    for pno, page in enumerate(doc, 1):
        if pno <= COVER_PAGES:
            continue
        for block in page.get_text("dict")["blocks"]:
            for line in block.get("lines", []):
                spans = line.get("spans", [])
                if not spans:
                    continue
                size = max(s["size"] for s in spans)
                text = norm("".join(s["text"] for s in spans))
                if not text:
                    continue
                for level, lo, hi in BANDS:
                    if lo <= size <= hi:
                        out.append((level, pno, text))
                        break
    return out


def main() -> int:
    if len(sys.argv) < 3:
        print(__doc__)
        return 2
    html_path, in_pdf = Path(sys.argv[1]), Path(sys.argv[2])
    out_pdf = Path(sys.argv[3]) if len(sys.argv) > 3 else in_pdf

    expected = headings_from_html(html_path)
    doc = pymupdf.open(in_pdf)
    actual = headings_from_pdf(doc)

    print(f"HTML 标题 {len(expected)} 条 | PDF 抓到候选 {len(actual)} 条")

    # 逐条比对：层级与归一化文本都必须一致
    if len(expected) != len(actual):
        print(f"ERROR 条数不一致（HTML {len(expected)} / PDF {len(actual)}），拒绝写书签。")
        print("  请检查：封面页数、字号带、模板字号是否被改过。")
        return 1

    toc: list[list] = []
    bad: list[tuple[int, tuple[int, str], tuple[int, int, str]]] = []
    for i, ((el, et), (al, ap, at)) in enumerate(zip(expected, actual)):
        if el != al or norm(et) != at:
            bad.append((i, (el, et), (al, ap, at)))
        toc.append([el, et, ap])

    if bad:
        print(f"ERROR {len(bad)} 条对不上，拒绝写书签：")
        for i, e, a in bad[:10]:
            print(f"  #{i}\n    题目 {e}\n    实际 {a}")
        return 1

    print("✅ 全部逐条对上（层级 + 文本）")

    doc.set_toc(toc)
    doc.set_metadata(
        {
            "title": "智能体工程：从一次工具调用到可交付的系统",
            "author": "Kevin + AI",
            "subject": "智能体工程设计：从一次工具调用到可交付的系统（21 章 · 39 图 · 参考实现已通过测试）",
            "keywords": "智能体, Agent, Agent Loop, Harness, MCP, 上下文工程, 检索, 评估, 交付",
            "creator": "book-studio · md-to-html-book（Chrome 排版 + pymupdf 书签）",
        }
    )
    doc.save(out_pdf, garbage=3, deflate=True)
    doc.close()

    chk = pymupdf.open(out_pdf)
    got = chk.get_toc()
    depth = {1: 0, 2: 0, 3: 0}
    for lvl, _t, _p in got:
        depth[lvl] = depth.get(lvl, 0) + 1
    print(f"✅ 书签已写入：{len(got)} 条（1 级 {depth.get(1,0)} / 2 级 {depth.get(2,0)} / 3 级 {depth.get(3,0)}）")
    print(f"   首页书签: {got[0] if got else '—'}")
    print(f"   末条书签: {got[-1] if got else '—'}")
    print(f"   页数 {chk.page_count} | 体积 {out_pdf.stat().st_size/1024/1024:.1f} MB -> {out_pdf.name}")
    chk.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
