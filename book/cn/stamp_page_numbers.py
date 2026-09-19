#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""给 A4 PDF 居中盖页码。

用法：
    /opt/miniconda3/bin/python3 stamp_page_numbers.py <in.pdf> [out.pdf]
不传 out.pdf 时写到 <in.pdf>.numbered.pdf（**不原地覆盖**——pymupdf 不允许
save to original 非增量保存，覆盖必须先写临时文件再替换）。

为什么需要这一步
----------------
Chrome 的 `--print-to-pdf` 配合 `--no-pdf-header-footer` 不生成页码。
页码是**事后盖**的：从封面之后的第 1 页起编号，封面不编号。

参数（与本书既有成品保持一致，改动会破坏跨轮一致性）
----------------------------------------------
字体 Helvetica 9pt · 颜色 #738599（0.451, 0.522, 0.600）· 水平居中 ·
基线 y = 812.4（A4 高 841.92，底边距 18mm，落在版心之下的页脚带）
"""
from __future__ import annotations

import sys
from pathlib import Path

import pymupdf

FONT = "helv"
SIZE = 9.0
BASELINE_Y = 812.4
COLOR = (0.451, 0.522, 0.600)  # #738599
COVER_PAGES = 1  # 封面页数，不编号


def stamp(in_pdf: str, out_pdf: str) -> None:
    doc = pymupdf.open(in_pdf)
    n = 0
    for i in range(COVER_PAGES, doc.page_count):
        page = doc[i]
        num = i + 1 - COVER_PAGES  # 封面之后重新起号
        text = str(num)
        w = pymupdf.get_text_length(text, fontname=FONT, fontsize=SIZE)
        x = (page.rect.width - w) / 2
        page.insert_text(
            (x, BASELINE_Y), text, fontname=FONT, fontsize=SIZE, color=COLOR
        )
        n += 1
    doc.save(out_pdf, garbage=3, deflate=True)
    print(f"✅ 页码已盖：{n} 页（跳过封面 {COVER_PAGES} 页）-> {out_pdf}")


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    src = Path(sys.argv[1])
    dst = Path(sys.argv[2]) if len(sys.argv) > 2 else src.with_suffix("").with_name(
        src.stem + ".numbered.pdf"
    )
    stamp(str(src), str(dst))
    return 0


if __name__ == "__main__":
    sys.exit(main())
