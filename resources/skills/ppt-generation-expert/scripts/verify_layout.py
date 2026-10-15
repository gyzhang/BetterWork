#!/usr/bin/env python3
"""verify_layout.py — 版式适配校验（文字 ⇄ 容器 / 标记 的空间冲突）。

补 verify_geometry.py 的盲区。几何校验只回答「标记画得对不对」，不回答「文字放得下
放不下」。下面两类缺陷的 SVG 语法完全合法、上游质检也过（元素都在声明的 bounds 内），
只有按字体估算文字包围盒才能发现：

  L1 数值标签压条  深色文字与深色条/块重叠 → 对比度不足，字「消失」在条里
                   （2026-09-16 真实事故：横向条图最长的第 1 条，标签右对齐锚点落在条内）
  L2 文字越出容器  卡片/表格面板内的文字超出面板边框（下边距按 descender 计）
                   （2026-09-16 真实事故：卡片高 240 而末行基线在 242，下边框横穿文字）
  L3 越出安全区    文字进入标题区（y<120）或越出页面/页脚带
  L5 装饰条不吻合  卡片左/顶边缘的同色窄条是直角矩形，戳出宿主圆角轮廓
                   （2026-09-16 Kevin 指出：左侧竖条应与卡片圆角角度一致）

字号→宽度用后验估算（Microsoft YaHei 度量），故意**略微高估**：宁可提醒一次，
也不要漏掉一次「字被边框切掉」。

用法：
    python3 verify_layout.py <project_dir|svg_dir> [--json] [--padding 6]

`<project_dir>` 下若有 `svg_output/` 就用它；**没有就当裸 SVG 目录**（书稿的 `svg/`、
骨架库、夹具都走这条路）。

退出码：0 = 无冲突；1 = 存在 error 级冲突。使用 Skill 锁定依赖对应的 Python。
"""
from __future__ import annotations

import argparse
import json
import math
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

SVG_NS = 'http://www.w3.org/2000/svg'
DATA_RE = re.compile(r'<!--\s*chart-data:(.*?)-->', re.S)

# ---- 版式常量（中电金信模板档案：内容区坐标）----
SAFE_LEFT, SAFE_RIGHT = 64.0, 1216.0
SAFE_TOP, SAFE_BOTTOM = 120.0, 704.0     # 顶部 <120 即侵入标题区；>704 即越出页脚带
CONTAINER_MIN_W, CONTAINER_MIN_H = 280.0, 90.0
DARK_LUM = 0.62                          # 感知亮度低于此值算「深色」（sRGB 近似）

HEX_RE = re.compile(r'^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$')


# --------------------------------------------------------------------------- #
# 文字度量
# --------------------------------------------------------------------------- #
def _is_fullwidth(ch: str) -> bool:
    o = ord(ch)
    return (0x2E80 <= o <= 0xA4CF or 0xAC00 <= o <= 0xD7A3 or 0xF900 <= o <= 0xFAFF
            or 0xFE30 <= o <= 0xFE4F or 0xFF00 <= o <= 0xFF60 or 0xFFE0 <= o <= 0xFFE6
            or o == 0x3000)


def est_text_width(text: str, font_size: float, bold: bool = False) -> float:
    """按 Microsoft YaHei 度量估算字串宽度（单位 px），末端 ×1.05 安全系数。"""
    w = 0.0
    for ch in text:
        if _is_fullwidth(ch):
            w += 1.00
        elif ch.isdigit():
            w += 0.556
        elif 'A' <= ch <= 'Z':
            w += 0.66
        elif 'a' <= ch <= 'z':
            w += 0.52
        elif ch == ' ':
            w += 0.28
        elif ch in '.,:;!\'"|`':
            w += 0.26
        elif ch in '-+*/\\=<>()[]{}':
            w += 0.36
        elif ch == '%':
            w += 0.72
        else:
            w += 0.60
    return w * font_size * (1.05 if bold else 1.02)


def text_rows(node: ET.Element) -> list[str]:
    """取文本行；有 tspan 子节点时按 tspan 分行（单段单 tspan 是编写合同）。"""
    tspans = [t for t in node.iter(f'{{{SVG_NS}}}tspan')]
    if tspans:
        rows = [''.join(t.itertext()) for t in tspans]
        if any(rows):
            return rows
    txt = ''.join(node.itertext())
    return [txt] if txt else []


def text_bbox(node: ET.Element) -> tuple[float, float, float, float] | None:
    """返回 (x0, y0, x1, y1)；anchor 参与定位，纵向按 ascender/descender 估算。"""
    try:
        base_x = float(node.get('x', 'nan'))
        base_y = float(node.get('y', 'nan'))
    except ValueError:
        return None
    if math.isnan(base_x) or math.isnan(base_y):
        return None
    try:
        fs = float(node.get('font-size', 14))
    except ValueError:
        fs = 14.0
    bold = (node.get('font-weight') or '').lower() in ('bold', '600', '700', '800', '900')
    anchor = (node.get('text-anchor') or 'start').strip()

    rows = text_rows(node)
    if not rows:
        return None
    width = max(est_text_width(r, fs, bold) for r in rows)

    if anchor == 'end':
        x0 = base_x - width
    elif anchor == 'middle':
        x0 = base_x - width / 2
    else:
        x0 = base_x
    # 纵向：CJK 字面顶约在基线上方 0.78em；下方取 0.26em 作 descender（略保守），
    # 多行时（基线在最末行）每行再上移 1.22em 行距。
    top = base_y - fs * 0.78 - fs * 1.22 * (len(rows) - 1)
    return x0, top, x0 + width, base_y + fs * 0.26


def _lum(color: str | None) -> float | None:
    """感知亮度 0~1；无法解析返回 None。"""
    if not color or color in ('none', 'transparent', 'currentColor'):
        return None
    m = re.match(r'rgba?\(([^)]+)\)', color)
    if m:
        parts = [p.strip() for p in m.group(1).split(',')]
        try:
            r, g, b = (float(parts[0]), float(parts[1]), float(parts[2]))
        except (ValueError, IndexError):
            return None
        a = float(parts[3]) if len(parts) > 3 else 1.0
        if a < 0.35:
            return None
        return (0.299 * r + 0.587 * g + 0.114 * b) / 255
    if not HEX_RE.match(color):
        return None
    h = color[1:]
    if len(h) == 3:
        h = ''.join(c * 2 for c in h)
    r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255


def _num(node: ET.Element, attr: str) -> float | None:
    try:
        return float(node.get(attr))
    except (TypeError, ValueError):
        return None


def _rect_box(node: ET.Element) -> tuple[float, float, float, float] | None:
    x, y = _num(node, 'x'), _num(node, 'y')
    w, h = _num(node, 'width'), _num(node, 'height')
    if None in (x, y, w, h) or w <= 0 or h <= 0:
        return None
    return x, y, x + w, y + h


def _inter(a: tuple[float, float, float, float], b: tuple[float, float, float, float]):
    return max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3])


def _area(box) -> float:
    return max(0.0, box[2] - box[0]) * max(0.0, box[3] - box[1])


# --------------------------------------------------------------------------- #
# 检查族
# --------------------------------------------------------------------------- #
def _plot_bars(root: ET.Element) -> list[tuple[str, ET.Element, tuple]]:
    """收集绘图组（id 以 -area 结尾）内的条/块标记。"""
    out = []
    for g in root.iter(f'{{{SVG_NS}}}g'):
        gid = g.get('id') or ''
        if not gid.endswith('-area'):
            continue
        for r in g.iter(f'{{{SVG_NS}}}rect'):
            box = _rect_box(r)
            if box is None:
                continue
            w, h = box[2] - box[0], box[3] - box[1]
            if h > 70 or w < 1.2:          # 卡片/面板/色块不是条
                continue
            out.append((gid[:-5], r, box))
    return out


def _containers(root: ET.Element):
    """产出 (容器 rect box, 该容器应负责的文字列表)。

    容器 = 组内宽≥280 且高≥90 的矩形（卡片/面板）；页面白底（宽≥1270）不算。
    文字归属：组内全部文字，减去落在「自带容器的子组」里的文字（避免父子重复判定）。
    """
    out = []
    for g in root.iter(f'{{{SVG_NS}}}g'):
        own = []
        for r in g.findall(f'{{{SVG_NS}}}rect'):
            box = _rect_box(r)
            if box and (box[2] - box[0]) >= CONTAINER_MIN_W and (box[3] - box[1]) >= CONTAINER_MIN_H \
                    and (box[2] - box[0]) < 1270:
                own.append((r, box))
        if not own:
            continue
        nested_ids = set()
        for sub in g.iter(f'{{{SVG_NS}}}g'):
            if sub is g:
                continue
            for r in sub.findall(f'{{{SVG_NS}}}rect'):
                box = _rect_box(r)
                if box and (box[2] - box[0]) >= CONTAINER_MIN_W and (box[3] - box[1]) >= CONTAINER_MIN_H \
                        and (box[2] - box[0]) < 1270:
                    nested_ids.add(id(sub))
                    break
        for r, box in own:
            texts = []
            for t in g.iter(f'{{{SVG_NS}}}text'):
                holder = next((a for a in g.iter(f'{{{SVG_NS}}}g') if id(a) in nested_ids
                               and t in list(a.iter(f'{{{SVG_NS}}}text'))), None)
                if holder is not None:
                    continue
                texts.append(t)
            out.append((g.get('id') or '?', box, texts))
    return out


def _suggest_range(obj: str, declarations: list[str], label_w: float, bar_end: float) -> str:
    """给出可执行的修法：锚点放错 → 给正确坐标；range 太小 → 给所需上限。"""
    for raw in declarations:
        if f'object={obj}' not in raw.replace(' ', ''):
            continue
        payload = {}
        for chunk in raw.split('|'):
            if '=' in chunk:
                k, v = chunk.split('=', 1)
                payload[k.strip()] = v.strip()
        try:
            values = [float(v) for v in payload.get('values', '').split(',') if v.strip()]
            area = [float(v) for v in payload.get('area', '').split(',')]
            lo, hi = [float(v) for v in payload.get('value-range', '').split(',')]
        except ValueError:
            return ''
        if not values or len(area) != 4:
            return ''
        span = area[2] - area[0]
        if span <= 0 or hi <= lo:
            return ''
        if bar_end + 8 + label_w <= area[2]:
            # 放得下：说明标签锚点不在条尾外侧（右对齐锚点落进了条里）
            return f'修法：标签改为 text-anchor="start"，x={bar_end + 8:.1f}（条尾 +8）'
        need = span - 8 - label_w - 6          # 6px 安全余量
        if need <= 1:
            return '修法：标签过长，需缩短（如只留数值，占比移到左栏或结论条）'
        suggested = math.ceil((lo + max(values) / (need / span)) / 10) * 10
        return f'修法：value-range 上限 ≥ {suggested}（当前 {hi:g}），或缩短标签'
    return ''


_LAST_LABEL_W = [0.0]           # 由 L1 写入，供 _suggest_range 使用


def _decor_strips(root: ET.Element):
    """产出 (宿主 rect 信息, 装饰条 rect 信息)：窄条贴宿主边缘且落在宿主范围内。

    装饰条 = 宽≤10 或 高≤10 的实心矩形；宿主 = rx≥4 且尺寸够大的矩形。
    必须"贴边"才算（避免把任意重叠的图形都算成装饰条）。

    ⚠️ **2026-09-20 修：判据原本额外要求「无圆角」（`rx>0` 直接跳过），这是错的。**
    书稿的 29 处强调条全部写作 `rx="2"`（封面 `rx="3"`），于是这道检查与
    `round_accent_strips.py` **双双对它们隐形**——实测跑那个 `svg/` 目录 L5 一条不报，
    而实际有 29 处不吻合。
    根本原因：`rect` 的 rx 是**四角统一**的，改 rx 修不了"同侧两角倒、另一侧平直"
    这个形状（设小则戳出、设大则右侧也被倒角），所以**带 rx 与不带 rx 同样是缺陷**，
    判据不该看 rx。
    """
    rects = [r for r in root.iter(f'{{{SVG_NS}}}rect')]
    hosts = []
    for r in rects:
        box = _rect_box(r)
        if box is None:
            continue
        rx = _num(r, 'rx') or 0.0
        if rx < 4 or (box[2] - box[0]) < 100 or (box[3] - box[1]) < 40:
            continue
        hosts.append((r, box, rx))
    strips = []
    for r in rects:
        box = _rect_box(r)
        if box is None:
            continue                          # 不再按 rx 跳过：带 rx 的窄条同样是缺陷
        w, h = box[2] - box[0], box[3] - box[1]
        if not (w <= 10 or h <= 10):
            continue
        if not (r.get('fill') or r.get('style')):
            continue
        for r2, hb, rx in hosts:
            if r is r2:
                continue
            inside = (box[0] >= hb[0] - 1 and box[2] <= hb[2] + 1
                      and box[1] >= hb[1] - 1 and box[3] <= hb[3] + 1)
            flush = (abs(box[0] - hb[0]) <= 1 or abs(box[2] - hb[2]) <= 1
                     or abs(box[1] - hb[1]) <= 1 or abs(box[3] - hb[3]) <= 1)
            if inside and flush:
                strips.append((box, hb, rx))
                break
    return strips


def check_page(svg: Path, padding: float) -> list[dict]:
    raw = svg.read_text(encoding='utf-8')
    declarations = DATA_RE.findall(raw)
    try:
        root = ET.parse(svg).getroot()
    except ET.ParseError as exc:
        return [{'file': svg.name, 'check': 'P', 'severity': 'error',
                 'detail': f'SVG 无法解析：{exc}', 'text': ''}]

    findings: list[dict] = []
    texts = list(root.iter(f'{{{SVG_NS}}}text'))
    boxes = {id(t): text_bbox(t) for t in texts}

    # ---- L1 数值标签压条 -------------------------------------------------
    for obj, bar, bar_box in _plot_bars(root):
        bar_lum = _lum(bar.get('fill'))
        if bar_lum is None or bar_lum >= DARK_LUM:      # 浅色条不会「吃掉」深色字
            continue
        for t in texts:
            tb = boxes[id(t)]
            if tb is None:
                continue
            t_lum = _lum(t.get('fill'))
            if t_lum is None or t_lum < DARK_LUM:        # 深字压深条 → 不可读
                pass_contrast = False
            else:
                pass_contrast = True                     # 浅字压深条 = 有意内嵌，可读
            ix0, iy0, ix1, iy1 = _inter(tb, bar_box)
            ih, iw = iy1 - iy0, ix1 - ix0
            if ih < 3 or iw < 6:
                continue
            frac = (ih * iw) / max(_area(tb), 1.0)
            if frac < 0.12:
                continue
            if pass_contrast:
                continue
            txt = ''.join(t.itertext()).strip()
            _LAST_LABEL_W[0] = tb[2] - tb[0]
            sug = _suggest_range(obj, declarations, tb[2] - tb[0], bar_box[2])
            findings.append({
                'file': svg.name, 'check': 'L1', 'severity': 'error', 'object': obj,
                'text': txt,
                'detail': (f'标签「{txt}」({tb[0]:.0f}~{tb[2]:.0f}) 与条 (x {bar_box[0]:.0f}~'
                           f'{bar_box[2]:.0f}) 重叠 {iw:.0f}×{ih:.0f}px，且同为深色（条亮度 '
                           f'{bar_lum:.2f}）→ 文字不可读。' + (f' {sug}' if sug else '')),
            })
            break                                        # 一条只报一次

    # ---- L2 文字越出容器 -------------------------------------------------
    for gid, box, ctexts in _containers(root):
        x0, y0, x1, y1 = box
        for t in ctexts:
            tb = boxes[id(t)]
            if tb is None or _area(tb) == 0:
                continue
            txt = ''.join(t.itertext()).strip()
            if not txt:
                continue
            # 越出边框本体 = error（边框会把字切断）；仅进入留白带 = warn（过紧）
            hard = {'左': tb[0] < x0, '右': tb[2] > x1, '上': tb[1] < y0, '下': tb[3] > y1}
            crossed = [k for k, v in hard.items() if v]
            if crossed:
                worst = ', '.join(
                    f'{k}切断 {abs({"左": x0 - tb[0], "右": tb[2] - x1, "上": y0 - tb[1], "下": tb[3] - y1}[k]):.1f}px'
                    for k in crossed)
                findings.append({
                    'file': svg.name, 'check': 'L2', 'severity': 'error', 'object': gid, 'text': txt,
                    'detail': (f'组「{gid}」容器 {x0:.0f},{y0:.0f}~{x1:.0f},{y1:.0f}：文字「{txt}」'
                               f'越过边框 → {worst}（边框会切断文字）'),
                })
                continue
            tight = {'左': x0 + padding - tb[0], '右': tb[2] - (x1 - padding),
                     '上': y0 + padding - tb[1], '下': tb[3] - (y1 - padding)}
            close = {k: v for k, v in tight.items() if v > 0}
            if close:
                worst = ', '.join(f'{k}仅余 {padding - v:.1f}px' for k, v in close.items())
                findings.append({
                    'file': svg.name, 'check': 'L2', 'severity': 'warn', 'object': gid, 'text': txt,
                    'detail': (f'组「{gid}」容器 {x0:.0f},{y0:.0f}~{x1:.0f},{y1:.0f}：文字「{txt}」'
                               f'距边框 {worst}（建议 ≥{padding:.0f}px）'),
                })

    # ---- L3 越出安全区 ---------------------------------------------------
    for t in texts:
        tb = boxes[id(t)]
        if tb is None or _area(tb) == 0:
            continue
        txt = ''.join(t.itertext()).strip()
        if not txt:
            continue
        bad = []
        if tb[0] < SAFE_LEFT:
            bad.append(f'左越界 {SAFE_LEFT - tb[0]:.0f}px')
        if tb[2] > SAFE_RIGHT:
            bad.append(f'右越界 {tb[2] - SAFE_RIGHT:.0f}px')
        if tb[1] < SAFE_TOP:
            bad.append(f'侵入标题区 {SAFE_TOP - tb[1]:.0f}px')
        if tb[3] > SAFE_BOTTOM:
            bad.append(f'越出页脚带 {tb[3] - SAFE_BOTTOM:.0f}px')
        if bad:
            findings.append({
                'file': svg.name, 'check': 'L3', 'severity': 'error', 'object': '-',
                'text': txt, 'detail': f'文字「{txt}」' + '，'.join(bad),
            })

    # ---- L4 文字互撞（warn）---------------------------------------------
    # 只报真撞：两轴都重叠 ≥2px 且重叠面积达较小者的 20%。相邻行（行距 ≥1.05em）
    # 在本 bbox 模型下不会重叠，故不会误报。
    live = [t for t in texts if boxes[id(t)] and _area(boxes[id(t)]) > 0
            and ''.join(t.itertext()).strip()]
    for i in range(len(live)):
        for j in range(i + 1, len(live)):
            a, b = boxes[id(live[i])], boxes[id(live[j])]
            ix0, iy0, ix1, iy1 = _inter(a, b)
            iw, ih = ix1 - ix0, iy1 - iy0
            if iw < 2 or ih < 2:
                continue
            if (iw * ih) / max(min(_area(a), _area(b)), 1.0) < 0.20:
                continue
            t1 = ''.join(live[i].itertext()).strip()
            t2 = ''.join(live[j].itertext()).strip()
            findings.append({
                'file': svg.name, 'check': 'L4', 'severity': 'warn', 'object': '-',
                'text': f'{t1} / {t2}',
                'detail': f'文字互撞：「{t1}」与「{t2}」重叠 {iw:.0f}×{ih:.0f}px',
            })

    # ---- L5 装饰条与宿主圆角不吻合 ---------------------------------------
    for sbox, hbox, r in _decor_strips(root):
        hx, hy, hx1, hy1 = hbox
        sx, sy, sx1, sy1 = sbox
        centers = [(hx + r, hy + r), (hx1 - r, hy + r), (hx + r, hy1 - r), (hx1 - r, hy1 - r)]
        worst = 0.0
        for cx, cy in ((sx, sy), (sx1, sy), (sx, sy1), (sx1, sy1)):
            for ox, oy in centers:
                if abs(cx - ox) <= r and abs(cy - oy) <= r:      # 落在宿主的圆角方格内
                    d = math.hypot(cx - ox, cy - oy)
                    if d > r + 0.5:
                        worst = max(worst, d - r)
        if worst > 0:
            w0 = sx1 - sx
            dx = r - math.sqrt(max(2 * r * w0 - w0 * w0, 0.0)) if w0 < r else 0.0
            # 只有「贴宿主左边」的竖条才能给出可自动修的具体 path；
            # 贴顶边/右边的条要点是同一个，但路径需按同侧旋转生成，别给错建议。
            if abs(sx - hx) <= 1:
                fix = (f'修法：改成贴边 path（纵向取宿主全高），'
                       f'd="M{sx1:g} {sy + dx:.2f}A{r:g} {r:g} 0 0 0 {sx:g} {sy + r:g}'
                       f'V{sy1 - r:g}A{r:g} {r:g} 0 0 0 {sx1:g} {sy1 - dx:.2f}Z"；'
                       f'或直接跑 scripts/round_accent_strips.py <project_dir> --apply')
            else:
                fix = (f'修法：改成「贴边 path」——与宿主同侧的两个角用宿主半径 r 倒角、'
                       f'另两侧平直；本条贴的不是左边，需按同侧旋转生成路径'
                       f'（round_accent_strips.py 可自动修左/竖条与上/横条两种朝向）')
            findings.append({
                'file': svg.name, 'check': 'L5', 'severity': 'error', 'object': '-',
                'text': f'装饰条 x={sx:g} y={sy:g}',
                'detail': (f'边缘装饰条 ({sx:g},{sy:g}~{sx1:g},{sy1:g}) 戳出宿主圆角轮廓 '
                           f'{worst:.1f}px（宿主 rx={r:g}）→ 条是方的、卡是圆的。' + fix),
            })

    return findings


def main() -> int:
    ap = argparse.ArgumentParser(description='版式适配校验（文字 ⇄ 容器）')
    ap.add_argument('project')
    ap.add_argument('--padding', type=float, default=6.0, help='容器内留白（px，默认 6）')
    ap.add_argument('--only', default=None,
                    help='只跑指定检查，逗号分隔（如 L5）。用途：书稿等自有版式只适用其中一项时，'
                         '避免不适用的检查产生成片误报（L1–L4 依赖 PPT 模板的标题带与容器关联约定）')
    ap.add_argument('--json', action='store_true')
    args = ap.parse_args()

    only = {s.strip().upper() for s in args.only.split(',')} if args.only else None

    # 既可传工作区（用其 svg_output/），也可传**裸 SVG 目录**（书稿的 svg/、骨架库、夹具）
    proj = Path(args.project).resolve()
    svg_dir = proj / 'svg_output' if (proj / 'svg_output').is_dir() else proj
    if not svg_dir.is_dir():
        raise SystemExit(f'ERROR: {svg_dir} 不存在')

    all_f: list[dict] = []
    for svg in sorted(svg_dir.glob('*.svg')):
        fs = check_page(svg, args.padding)
        if only:
            fs = [f for f in fs if str(f.get('check', '')).upper() in only]
        all_f.extend(fs)

    if args.json:
        print(json.dumps({'findings': all_f}, ensure_ascii=False, indent=2))
    else:
        if not all_f:
            print('verify-layout: 未发现文字空间冲突')
        for f in all_f:
            print(f"[{f['check']}][{f['file']}] {f['detail']}")
        errs = [f for f in all_f if f['severity'] == 'error']
        warns = [f for f in all_f if f['severity'] == 'warn']
        fam = lambda k: sum(1 for f in all_f if f['check'] == k)   # noqa: E731
        print(f"\n汇总：error {len(errs)} · warn {len(warns)}"
              f"（L1 压条 {fam('L1')} · L2 出容器 {fam('L2')} · L3 出安全区 {fam('L3')} · "
              f"L4 文字互撞 {fam('L4')} · L5 装饰条 {fam('L5')}）")

    return 1 if any(f['severity'] == 'error' for f in all_f) else 0


if __name__ == '__main__':
    raise SystemExit(main())
