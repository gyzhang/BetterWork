#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""引用块硬换行工具 —— 《智能体工程》书稿专用。

背景
----
markdwon 标准里，引用块内的连续行属于**同一个段落**，单个换行只是 soft line break，
渲染时按一个空格处理。数据卡的「口径 / 时点 / 来源 / 局限」、以及「核心判断 + 代价是：」
这类二段式结构，因此在 HTML / PDF 里会被合并成一段。

本脚本把"要不要换行"这件事**写死在源码里**（行尾追加 `<br>`），这样：
  · 不依赖渲染器（Typora / pandoc / GitHub / Jekyll / 微信排版工具行为一致）
  · 不依赖构建脚本的 breaks 开关
  · 不依赖 CSS 补丁
并且因为 `<br>` 是**可见字符**，它可以被 grep —— 这就是机械校验的抓手。

用法
----
    python3 fix_hard_breaks.py --check     # 只体检，违规即非零退出，不改文件
    python3 fix_hard_breaks.py --fix       # 就地修正
    python3 fix_hard_breaks.py --check --verbose   # 列出每一处

规则
----
1. 只处理引用块（`>` 起头）内部的段落续行；代码块、列表项、表格行一律跳过。
2. 段落续行判定：上一行与当前行是同一引用块内的连续非空行（中间没有空 `>` 行）。
3. 已有换行标记的行（行尾 `<br>` 或行尾两个空格）不动 —— 脚本幂等，可反复跑。
4. 引用块外的段内软换行不自动改，只告警：要么合写成一行，要么显式加 `<br>`。
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PARTS = ROOT / "parts"

QUOTE = re.compile(r'^\s*(>+)\s?(.*)$')
SKIP_CONTENT = re.compile(r'^(?:[-*+]\s|\d+\.\s|\||<[a-zA-Z/!])')

MARKED_END = re.compile(r'(?:<br\s*/?>|  )$', re.I)


def classify(content: str) -> str:
    """判定一行在引用块内的角色，决定是否参与硬换行处理。"""
    if not content:
        return "blank"
    if SKIP_CONTENT.match(content):
        return "skip"
    return "text"


def scan() -> tuple[list[dict], int, int]:
    """扫描全部 parts，返回违规明细。

    判定核心：**换行是否成立，取决于"上一行"是否以换行标记结尾**，而不是看当前行。
    上一行已标记 -> 这是显式硬换行，合法；未标记且紧跟一行 -> 缺标记，违规。
    """
    issues: list[dict] = []
    total_br = 0
    files = sorted(PARTS.glob("*.md"))
    for f in files:
        raw = f.read_text(encoding="utf-8")
        lines = raw.splitlines()
        fence = False
        quote_depth: str | None = None
        prev_idx = -1           # 上一个参与续行判定的行号
        prev_content = ""
        prev_marked = False     # 上一行是否已带换行标记
        for i, line in enumerate(lines):
            if line.strip().startswith("```"):
                fence = not fence
                quote_depth = None
                prev_idx, prev_content, prev_marked = -1, "", False
                continue
            if fence:
                continue
            m = QUOTE.match(line)
            if not m:
                # 引用块之外：软换行只告警，不自动修正
                quote_depth = None
                cur = line.strip()
                outside_ok = bool(cur) and not SKIP_CONTENT.match(cur) \
                    and cur[:1] not in ("#", "|", ">") and not cur.startswith("<")
                if (prev_idx == i - 1 and prev_content and not prev_marked
                        and outside_ok):
                    issues.append({"file": f.name, "lineno": i, "kind": "warn-outside",
                                   "prev": prev_content, "cur": cur})
                prev_idx, prev_content = i, cur
                prev_marked = bool(MARKED_END.search(cur))
                continue

            depth, content = m.group(1), m.group(2)
            role = classify(content.strip())
            if role == "blank" or quote_depth != depth:
                quote_depth = depth
                prev_idx, prev_content, prev_marked = -1, "", False
                if role == "blank":
                    continue
            if role == "skip":
                prev_idx, prev_content, prev_marked = -1, "", False
                continue

            c = content.rstrip()
            marked = bool(MARKED_END.search(content))
            if marked:
                total_br += 1
            elif prev_idx == i - 1 and prev_content and not prev_marked:
                issues.append({"file": f.name, "lineno": i, "kind": "error-missing",
                               "prev": prev_content, "cur": c})
            prev_idx, prev_content, prev_marked = i, c, marked
    return issues, total_br, len(files)


def fix(issues: list[dict]) -> int:
    """就地给缺失标记的行补 `<br>`（按文件倒序改行号，避免位移）。"""
    by_file: dict[str, list[int]] = {}
    for it in issues:
        if it["kind"] != "error-missing":
            continue
        # lineno 记的是"下一行"的位置，真正要补标记的是它前一行 -> 用 prev 内容定位
        by_file.setdefault(it["file"], []).append(it["lineno"] - 1)

    changed = 0
    for name, targets in by_file.items():
        p = PARTS / name
        lines = p.read_text(encoding="utf-8").splitlines(keepends=True)
        for idx in sorted(set(targets), reverse=True):
            if idx < 0 or idx >= len(lines):
                continue
            raw = lines[idx].rstrip("\n").rstrip("\r")
            if MARKED_END.search(raw):
                continue
            lines[idx] = raw + "<br>\n"
            changed += 1
        p.write_text("".join(lines), encoding="utf-8")
    return changed


def main() -> int:
    args = sys.argv[1:]
    do_fix = "--fix" in args
    verbose = "--verbose" in args

    issues, existing_br, nfiles = scan()
    errs = [i for i in issues if i["kind"] == "error-missing"]
    warns = [i for i in issues if i["kind"] == "warn-outside"]

    print("扫描 %d 个分片，现有硬换行标记 %d 处" % (nfiles, existing_br))
    print("  引用块内缺换行标记：%d 处" % len(errs))
    print("  引用块外的段内软换行：%d 处（需人工确认语义）" % len(warns))

    if verbose:
        print("\n" + "-" * 66)
        for i in warns[:20]:
            print("[引用块外] %s:%d" % (i["file"], i["lineno"]))
            print("   上行: ...%s" % i["prev"][-48:])
            print("   下行: %s..." % i["cur"][:48])
        for i in errs[:10]:
            print("[引用块内] %s:%d" % (i["file"], i["lineno"]))
            print("   上行: ...%s" % i["prev"][-48:])
            print("   下行: %s..." % i["cur"][:48])

    if not do_fix:
        if errs:
            print("\n[FAIL] 存在未标记的引用块软换行，请以 --fix 修正")
        else:
            print("\n[OK] 引用块内换行全部已显式标记")
        return 1 if errs else 0

    # --all 时引用块外的软换行一并标记。默认只动引用块内：正文里出现多-line 段落
    # 更可能是"忘了合写成一行"，应先由人确认语义再决定。
    if "--all" in args:
        for i in issues:
            if i["kind"] == "warn-outside":
                i["kind"] = "error-missing"
    n = fix(issues)
    print("\n已补 %d 处 `<br>`" % n)
    again, br2, _ = scan()
    errs2 = [i for i in again if i["kind"] == "error-missing"]
    print("复检：剩余未标记 %d 处 / 标记总数 %d -> %d" % (len(errs2), existing_br, br2))
    return 1 if errs2 else 0


if __name__ == "__main__":
    sys.exit(main())
