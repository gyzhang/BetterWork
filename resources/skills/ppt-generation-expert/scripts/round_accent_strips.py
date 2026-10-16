#!/usr/bin/env python3
"""round_accent_strips.py — 把「卡片边缘同色装饰条」批量改写为跟随宿主圆角的贴边 path。

为什么需要它：卡片左/顶边缘的装饰条（6px 实心 rect）常被写成**直角矩形**，而宿主是
`rx=8` 的圆角矩形。于是
  ① 装饰条的直角戳到宿主圆角轮廓之外 —— 视觉上"条是方的、卡是圆的"；
  ② 若条的高度与宿主不等（历史改动遗留），一端还会短一截。
（2026-09-16 Kevin 在真 PowerPoint 里逐页验收时指出此类瑕疵。）

正确形态是**贴边 path**：与宿主同侧的两个角用宿主半径 r 倒角，另两侧平直，
纵向覆盖宿主全高。本脚本按宿主几何自动生成该 path，替换原 rect。纯形状、
零新依赖，导出后仍是原生可编辑形状。

⚠️ **2026-09-20 修：判据原本只认「无 rx 的直角矩形」，导致带 rx 的条对整条工具链隐形。**
书稿的 29 处强调条全部写作 `rx="2"`（封面 `rx="3"`），于是本脚本与 `verify_layout.py`
的 L5 **双双跳过它们**——实测把本脚本指向那个 `svg/` 目录跑，命中 **0 处**，而实际有 29 处
不吻合（最大外露 6px，渲染 2.2× 后 13.2px，肉眼可见）。
**根因是把"无圆角"当成了缺陷特征**——但 `rect` 的 rx 是**四角统一**的，改 rx 根本修不了
这个形状（设小则戳出、设大则右侧也被倒角），所以**带 rx 与不带 rx 同样是缺陷**，
判据不该看 rx。现已改为：只要"窄条 + 实心 + 贴宿主边缘 + 落在宿主内"即处理。

用法：
    python3 round_accent_strips.py <project_dir> [--apply]

不带 `--apply` 只打印将要改写的清单（干跑，务必先看一遍）。改写后须重跑
`svg_native_export.py`（内含一道版式校验，会再验一遍 L5）。
"""
from __future__ import annotations

import math
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

SVG_NS = 'http://www.w3.org/2000/svg'

RECT_RE = re.compile(r'<rect\b[^>]*?/>')
ATTR_RE = re.compile(r'([\w:-]+)\s*=\s*"([^"]*)"')


def swap_rect(raw: str, want: dict, new_el: str) -> tuple[str, bool]:
    """按**属性值**匹配并替换单个自闭合 <rect/>（不依赖属性顺序与空白）。

    为什么不用精确字符串：原实现拼 `'<rect x=.. y=.. fill=".."/>'` 去 `str.replace`，
    只要属性顺序不同、多一个属性（比如 `rx`）、或 `/>` 前多一个空格，就匹配失败并
    **静默跳过**——正是这批条没被修掉的原因之一。

    比较规则：**`fill` 按字符串精确比，几何属性按数值比**。
    （留意：几何属性用数值比，是为了容忍 `170` 与 `170.0` 写法差异；
    而 fill 绝不能走数值比——`num('#2064AE')` 与 `num('#FFFFFF')` 都会退化成 0.0，
    会把任意两个颜色判成相等。）
    """
    for m in RECT_RE.finditer(raw):
        attrs = dict(ATTR_RE.findall(m.group(0)))
        ok = True
        for k, v in want.items():
            if k not in attrs:
                ok = False
                break
            a = attrs[k]
            if k == 'fill':
                if a != v:
                    ok = False
                    break
                continue
            try:
                if float(a) != float(v):
                    ok = False
                    break
            except ValueError:
                if a != v:
                    ok = False
                    break
        if ok:
            return raw[:m.start()] + new_el + raw[m.end():], True
    return raw, False


def num(v, default: float = 0.0) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def fmt(v: float) -> str:
    s = f'{v:.2f}'.rstrip('0').rstrip('.')
    return s if s else '0'


def read_rects(svg: Path):
    root = ET.parse(svg).getroot()
    out = []
    for el in root.iter(f'{{{SVG_NS}}}rect'):
        out.append((num(el.get('x')), num(el.get('y')), num(el.get('width')),
                    num(el.get('height')), num(el.get('rx')), el.get('fill'),
                    el.get('stroke')))
    return out


def build_path(x: float, y: float, w: float, h: float, r: float,
               orient: str = 'left') -> str:
    """贴边 path：与宿主同侧的两个角倒 r，另两侧平直。

    orient='left'  条贴宿主**左**边（竖条）：x=宿主x, y=宿主y, w=条宽, h=**宿主高**
    orient='top'   条贴宿主**上**边（横条）：x=宿主x, y=宿主y, w=**宿主宽**, h=条高

    当条的厚度 d < r 时，宿主的圆角弧会切进条的内边界，交点在 dy = dx 处；
    dx = r − √(2rd − d²)（竖条 d=条宽，横条 d=条高。r=8, w=6 → dx≈0.25，几何正确但肉眼不可见）。

    ⚠️ 两种朝向的**弧的 sweep 方向相反**（横条是把竖条沿 y=x 镜像，镜像会翻转手性）：
      竖条上端的弧从"内→外"是逆时针 → sweep 0；
      横条左端的弧从"内→外"是顺时针 → sweep 1。
    改这里务必重新渲染目检——sweep 写反会得到一个"内凹"的形状。
    """
    d = h if orient == 'top' else w
    dx = r - math.sqrt(max(2 * r * d - d * d, 0.0)) if d < r else 0.0
    if orient == 'top':
        return (f'M{fmt(x + dx)} {fmt(y + h)}'
                f'A{fmt(r)} {fmt(r)} 0 0 1 {fmt(x + r)} {fmt(y)}'
                f'H{fmt(x + w - r)}'
                f'A{fmt(r)} {fmt(r)} 0 0 1 {fmt(x + w - dx)} {fmt(y + h)}Z')
    return (f'M{fmt(x + w)} {fmt(y + dx)}'
            f'A{fmt(r)} {fmt(r)} 0 0 0 {fmt(x)} {fmt(y + r)}'
            f'V{fmt(y + h - r)}'
            f'A{fmt(r)} {fmt(r)} 0 0 0 {fmt(x + w)} {fmt(y + h - dx)}Z')


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if not args:
        raise SystemExit(__doc__)
    root = Path(args[0]).resolve()
    # 既可传 ppt-master 工作区（用其 svg_output/），也可传裸的 SVG 目录（骨架库、夹具）
    svg_dir = root / 'svg_output' if (root / 'svg_output').is_dir() else root
    if not svg_dir.is_dir():
        raise SystemExit(f'ERROR: {svg_dir} 不存在')
    apply = '--apply' in sys.argv

    total = 0
    skipped = 0
    for svg in sorted(svg_dir.glob('*.svg')):
        if 'defect' in svg.name.lower():
            # 缺陷对照夹具里必须保留原缺陷，切勿"修好"
            print(f'  -- {svg.name}: 文件名含 defect，按契约跳过（缺陷夹具须保留原状）')
            skipped += 1
            continue
        rects = read_rects(svg)
        hosts = [(x, y, w, h, rx) for (x, y, w, h, rx, _f, _s) in rects
                 if rx >= 4 and w >= 100 and h >= 40]
        raw = svg.read_text(encoding='utf-8')
        changed = 0

        for (x, y, w, h, rx, fill, stroke) in rects:
            # 判据**不看 rx**：带 rx 与不带 rx 同样是缺陷
            # （rect 的 rx 四角统一，设小则戳出、设大则右侧也被倒角，改它修不了这个形状）
            if not fill:
                continue
            if w <= 10 and h >= 20:
                orient = 'left'                   # 竖条，贴宿主左边
            elif h <= 10 and w >= 20:
                orient = 'top'                    # 横条，贴宿主上边
            else:
                continue
            if orient == 'left':
                cands = [H for H in hosts
                         if abs(H[0] - x) <= 0.6
                         and y >= H[1] - 0.6 and y + h <= H[1] + H[3] + 0.6]
            else:
                cands = [H for H in hosts
                         if abs(H[1] - y) <= 0.6
                         and x >= H[0] - 0.6 and x + w <= H[0] + H[2] + 0.6]
            if not cands:
                continue
            # 取最紧的宿主（高度最小），避免嵌套容器时误选外层大容器
            cands.sort(key=lambda H: H[3])
            if len(cands) > 1 and abs(cands[0][3] - cands[1][3]) < 0.5:
                print(f'  ?? {svg.name}: x={x:g} y={y:g} 有多个同紧度宿主，取第一个'
                      f'（h={cands[0][3]:g}）—— 请人工确认')
            hx, hy, hw, hh, hr = cands[0]
            if orient == 'left':
                new_el = f'<path d="{build_path(hx, hy, w, hh, hr, "left")}" fill="{fill}"/>'
                geo = f'x={x:g} y={y:g} h={h:g}'
                flush = abs(y - hy) < 0.5 and abs(h - hh) < 0.5
                align = f'纵向取宿主全高 {hh:g}'
            else:
                new_el = f'<path d="{build_path(hx, hy, hw, h, hr, "top")}" fill="{fill}"/>'
                geo = f'x={x:g} y={y:g} w={w:g}'
                flush = abs(x - hx) < 0.5 and abs(w - hw) < 0.5
                align = f'横向取宿主全宽 {hw:g}'
            raw, done = swap_rect(raw, {'x': x, 'y': y, 'width': w, 'height': h,
                                        'fill': fill}, new_el)
            if not done:
                print(f'  ?? {svg.name}: 未找到对应 rect，跳过（x={x:g} y={y:g}）')
                continue
            total += 1
            changed += 1
            tail = '' if flush else f'（原 {geo} ≠ 宿主，已按「{align}」齐平）'
            prx = f'、原 rx={rx:g}' if rx else ''
            print(f'  {svg.name}: {orient == "left" and "竖条" or "横条"} {geo}{prx}'
                  f' → 贴边 r={hr:g}{tail}')

        if apply and changed:
            svg.write_text(raw, encoding='utf-8')

    tail = f'（另跳过缺陷夹具 {skipped} 个）' if skipped else ''
    print(f'\n{"已改写" if apply else "待改写（干跑，确认后加 --apply）"} {total} 处装饰条{tail}')
    if total and not apply:
        print('提示：改写前建议先 git 或备份 svg_output/。')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
