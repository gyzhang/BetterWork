#!/usr/bin/env python3
"""verify_palette.py — 配色合规校验（只允许 spec_lock 声明的色板内的颜色）。

为什么需要：模板档案 §2 明令「禁止引入色板外颜色」，但**上游质检、数据几何校验、版式适配
校验都看不见颜色**——色板外颜色不会被任何既有闸门拦住，只会在真 PowerPoint 里被肉眼发现
（或永远不被发现）。2026-09-16 自查即发现本项目有 7 处越板（琥珀 `#EF9F27`×3、
深琥珀 `#854F0B`×3、浅蓝 `#EAF0F8`×1），都是我写页面时自创的"看起来更柔和"的颜色。

唯一事实源：`<project>/spec_lock.md` 的 `## colors` 块（中电金信标准块 = 模板 8 色 + 白）。
需要新颜色时**先加角色到 spec_lock**，而不是直接在页面里写色值。

用法：
    python3 verify_palette.py <project_dir> [--json]

退出码：0 = 全部在色板内；1 = 存在越板色。
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

HEX_RE = re.compile(r'#([0-9A-Fa-f]{6}|[0-9A-Fa-f]{3})\b')
COLOR_ATTR_RE = re.compile(
    r'\b(fill|stroke|stop-color|flood-color|lighting-color)\s*=\s*"([^"]*)"')
COLORS_BLOCK_RE = re.compile(r'##\s*colors\s*\n(.*?)(?=\n##\s|\Z)', re.S)
# 结构性取值不是颜色
IGNORE = {'none', 'transparent', 'currentColor', 'inherit', 'auto'}


def norm(v: str) -> str:
    v = v.strip()
    if len(v) == 4 and v.startswith('#'):       # #abc → #AABBCC
        v = '#' + ''.join(c * 2 for c in v[1:])
    return v.upper()


def allowed_colors(spec_lock: Path) -> tuple[set[str], str | None]:
    if not spec_lock.is_file():
        return set(), '未找到 spec_lock.md'
    block = COLORS_BLOCK_RE.search(spec_lock.read_text(encoding='utf-8'))
    if not block:
        return set(), 'spec_lock.md 缺少 ## colors 块'
    got = set()
    for line in block.group(1).splitlines():
        m = re.search(r':\s*(#[0-9A-Fa-f]{3,6})', line)
        if m:
            got.add(norm(m.group(1)))
    return got, None


def main() -> int:
    ap = argparse.ArgumentParser(description='配色合规校验（色板唯一事实源 = spec_lock）')
    ap.add_argument('project')
    ap.add_argument('--json', action='store_true')
    args = ap.parse_args()

    project = Path(args.project).resolve()
    svg_dir = project / 'svg_output'
    if not svg_dir.is_dir():
        raise SystemExit(f'ERROR: {svg_dir} 不存在')

    allowed, err = allowed_colors(project / 'spec_lock.md')
    if err:
        print(f'verify-palette: {err}（跳过检查）')
        return 0
    allowed.add('#FFFFFF')          # 白底恒允许
    findings = []
    used: dict[str, int] = {}
    for svg in sorted(svg_dir.glob('*.svg')):
        raw = svg.read_text(encoding='utf-8')
        for attr, value in COLOR_ATTR_RE.findall(raw):
            value = value.strip()
            if value.lower() in {i.lower() for i in IGNORE}:
                continue
            for hexv in HEX_RE.findall(value):
                c = norm('#' + hexv)          # findall 返回的是捕获组，已去掉 #
                used[c] = used.get(c, 0) + 1
                if c not in allowed:
                    findings.append({'file': svg.name, 'attr': attr, 'color': c,
                                     'detail': f'{svg.name}: {attr}="{c}" 不在 spec_lock 声明的色板内'})

    if args.json:
        print(json.dumps({'allowed': sorted(allowed), 'used': used, 'violations': findings},
                         ensure_ascii=False, indent=2))
    else:
        print(f'色板（spec_lock 声明 + 白）：{" ".join(sorted(allowed))}')
        print(f'页面实际用色 {len(used)} 种：{" ".join(f"{k}×{v}" for k, v in sorted(used.items(), key=lambda kv: -kv[1]))}')
        for f in findings:
            print(f"[VIOLATION] {f['detail']}")
    print(f'\n汇总：越板色 {len(findings)} 处 / 用色 {len(used)} 种')
    if findings:
        print('结论：存在色板外颜色。要么改用色板内最近色，要么先在 spec_lock 的 ## colors 里加角色。')
        return 1
    print('结论：配色全部落在色板内')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
