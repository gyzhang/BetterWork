#!/usr/bin/env python3
"""骨架换色器：把上游 chart/table 骨架的原生配色，映射进公司模板色板。

背景（2026-09-29 实测）：上游 39 个骨架（33 chart + 6 table）**全部**带着
上游样例配色（105 种色），没有一种落在中电金信色板内。直接 cp 骨架会被
verify_palette.py 拒绝（实测单页 96 处越板）。骨架是拷贝源头，越板会被
复制到每一页——所以取用骨架必须先换色。

用法：
    python3 recolour_skeleton.py <骨架.svg> <输出.svg> [--palette 中电金信] [--report]
    python3 recolour_skeleton.py --batch <骨架目录> <输出目录>

换色策略（显式表优先，未命中走亮度/色相兜底）：
  1. 显式映射表 EXPLICIT：覆盖上游骨架里最高频的语义色（标题/正文/浅底/网格/序列蓝/正负向）
  2. 兜底规则 FALLBACK：按相对亮度 + 色相分档，保证**任何**上游色都能落到色板内
兜底阶段产生的替换会在 --report 里标注 `fallback`，供人工复核语义是否合理。

注意：换色只改颜色字面量，不动几何/数据。换色后仍须按 SKILL.md §2.5 用
svg_position_calculator.py 按新值重算标记几何。
"""

import argparse
import colorsys
import re
import sys
from pathlib import Path

# 中电金信色板（templates/中电金信.md §2，唯一事实源）
PALETTES = {
    '中电金信': {
        'bg': '#FFFFFF',
        'primary': '#1B4593',
        'accent': '#266DE7',
        'secondary_accent': '#048AE3',
        'border': '#00D3E4',
        'text_secondary': '#778495',
        'navy': '#0C2864',
        'risk': '#DF203C',
        'panel': '#E4E6EA',
    },
}

# 上游骨架高频语义色 → 色板角色（显式表，人工核定过语义）
EXPLICIT = {
    # 文字层级
    '#0F172A': 'navy',            # 标题/正文近黑 → 藏蓝
    '#1E293B': 'navy',
    '#334155': 'navy',
    '#475569': 'text_secondary',  # 正文灰 → 灰蓝
    '#64748B': 'text_secondary',  # 次要文字
    '#94A3B8': 'text_secondary',  # 浅灰
    # 底/线
    '#F8FAFC': 'bg',              # 极浅底 → 白（白底占比 ≥60% 纪律）
    '#F1F5F9': 'bg',
    '#EFF6FF': 'bg',
    '#E2E8F0': 'panel',           # 表头底/斑马纹 → 浅灰
    '#CBD5E1': 'panel',           # 网格线
    '#BFDBFE': 'panel',           # 浅蓝底
    '#DBEAFE': 'panel',
    # 序列蓝（按模板 §8 图表配色序列归位）
    '#1E3A8A': 'navy',
    '#1D4ED8': 'primary',
    '#2563EB': 'primary',
    '#3B82F6': 'accent',
    '#60A5FA': 'secondary_accent',
    '#93C5FD': 'border',
    # 正向/负向（色板内语义：青/亮蓝表正向，红表风险）
    '#059669': 'border',          # 绿 → 青（正向）
    '#10B981': 'border',
    '#34D399': 'border',
    '#D97706': 'risk',            # 琥珀 → 红（警示）
    '#F59E0B': 'risk',
    '#E11D48': 'risk',
    '#DC2626': 'risk',
    '#EF4444': 'risk',
}

HEX_RE = re.compile(r'#([0-9A-Fa-f]{6})\b')


def _rel_lum(hex_str: str) -> float:
    """相对亮度（0=黑 1=白），用于兜底分档。"""
    r, g, b = (int(hex_str[i:i + 2], 16) / 255 for i in (1, 3, 5))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def _hue(hex_str: str) -> float:
    r, g, b = (int(hex_str[i:i + 2], 16) / 255 for i in (1, 3, 5))
    h, _l, _s = colorsys.rgb_to_hls(r, g, b)
    return h * 360


def fallback_role(hex_str: str) -> str:
    """未命中显式表时，按亮度 + 色相分档，保证结果仍在色板内。"""
    lum = _rel_lum(hex_str)
    if lum > 0.93:
        return 'bg'          # 近白 → 白底
    if lum > 0.75:
        return 'panel'       # 浅 → 浅灰面板
    if lum > 0.40:
        return 'text_secondary'  # 中灰 → 辅助文字
    # 深色：按色相判语义
    h = _hue(hex_str)
    if h < 60 or h > 330:
        return 'risk'        # 红/橙 → 风险
    if 90 < h < 200:
        return 'border'      # 绿/青 → 正向点缀
    if 200 <= h <= 260:
        return 'primary'     # 蓝 → 主蓝
    return 'navy'            # 其余深色 → 藏蓝


def recolour(src: Path, dst: Path, palette: dict, report: bool = False) -> dict:
    text = src.read_text(encoding='utf-8')
    mapping, stats = {}, {}

    for m in HEX_RE.finditer(text):
        raw = '#' + m.group(1)
        key = raw.upper()
        if key in mapping:
            continue
        role = EXPLICIT.get(key)
        origin = 'explicit'
        if role is None:
            role = fallback_role(key)
            origin = 'fallback'
        mapping[key] = palette[role]
        stats[key] = (palette[role], origin, role)

    out = HEX_RE.sub(lambda m: mapping['#' + m.group(1).upper()], text)
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_text(out, encoding='utf-8')

    if report:
        print(f'--- {src.name} → {dst.name}')
        for k, (v, origin, role) in sorted(stats.items()):
            mark = ' ' if origin == 'explicit' else '*'
            print(f'  {mark} {k} → {v}  [{role}]{"" if origin == "explicit" else " (fallback)"}')
    return {'file': src.name, 'replaced': len(stats),
            'fallback': sum(1 for s in stats.values() if s[1] == 'fallback')}


def main() -> int:
    ap = argparse.ArgumentParser(description='把上游骨架配色映射进公司模板色板')
    ap.add_argument('src', help='骨架 SVG 文件或（--batch 时）目录')
    ap.add_argument('dst', help='输出文件或目录')
    ap.add_argument('--palette', default='中电金信', choices=list(PALETTES))
    ap.add_argument('--batch', action='store_true', help='src/dst 按目录批量处理')
    ap.add_argument('--report', action='store_true', help='打印逐色替换清单')
    args = ap.parse_args()

    pal = PALETTES[args.palette]
    src, dst = Path(args.src), Path(args.dst)
    total = {'files': 0, 'colors': 0, 'fallback': 0}

    if args.batch:
        if not src.is_dir():
            print(f'错误：--batch 要求 src 是目录：{src}', file=sys.stderr)
            return 2
        for f in sorted(src.glob('*.svg')):
            r = recolour(f, dst / f.name, pal, args.report)
            total['files'] += 1
            total['colors'] += r['replaced']
            total['fallback'] += r['fallback']
    else:
        if not src.is_file():
            print(f'错误：找不到 {src}', file=sys.stderr)
            return 2
        r = recolour(src, dst, pal, args.report)
        total['files'] = 1
        total['colors'] = r['replaced']
        total['fallback'] = r['fallback']

    print(f"\n换色完成：{total['files']} 个骨架 / {total['colors']} 种色 → 色板 {args.palette}")
    if total['fallback']:
        print(f"  其中 {total['fallback']} 种走兜底规则（带 * 标记），建议人工复核语义")
    return 0


if __name__ == '__main__':
    sys.exit(main())
