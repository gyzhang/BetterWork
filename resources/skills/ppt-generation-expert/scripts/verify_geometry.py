#!/usr/bin/env python3
"""verify_geometry.py — 值驱动图形的几何一致性校验（数据 ⇄ 标记坐标）。

用途：在导出前机械核对「数据编码成的标记几何」是否与权威计算器一致。手算坐标、改数没
重算几何、复制骨架忘了换算——这类错误静态质检查不出来（SVG 语法完全合法），只有把
坐标算一遍才能发现。本脚本取代「靠肉眼看出柱高不对」。

原理：
  1. 扫 `svg_output/*.svg`，找页面里的 `<!-- chart-data: ... -->` 声明（由编写者写下数据与口径）
  2. 用上游 `svg_position_calculator.py` 按同一声明重算权威坐标
  3. 找 `<g id="<object>-area">`（兼容上游写法 `<object>-chartArea`）内实际绘制的标记
  4. 逐个比对，超出容差即报错（默认 2px）

支持模式（与上游 verify-charts 的模式表对齐）：
  calc=bar   → direct-calc，比对组内 <rect> 的 x/y/width/height
  calc=line  → direct-calc，比对 <polyline> 的 points
  calc=radar → direct-calc，比对 <polygon> 的 points（相对坐标，须在 translate 组内）
  其他/缺 calc  → manual-verify，只出 receipt 不判失败（诚实标注，不假装验过）

用法：
    PPTM_HOME=/path/to/ppt-master python3 verify_geometry.py <project_dir> [--tolerance 2] [--json]

退出码：0 = 全部通过（或无需校验）；1 = 存在几何不一致。
使用 Skill 锁定依赖对应的 Python，并显式设置 PPTM_HOME。
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

SKILL_DIR = Path(__file__).resolve().parent.parent
PPTM_HOME = Path(os.environ.get('PPTM_HOME', ''))
CALCULATOR = PPTM_HOME / 'skills' / 'ppt-master' / 'scripts' / 'svg_position_calculator.py'

SVG_NS = 'http://www.w3.org/2000/svg'
DATA_RE = re.compile(r'<!--\s*chart-data:(.*?)-->', re.S)
PLOT_AREA_RE = re.compile(r'<!--\s*chart-plot-area:([^>]*?)-->', re.S)

DIRECT_CALC = {'bar', 'line', 'radar'}


def parse_payload(raw: str) -> dict:
    """把 `object=x | k=v | k=v` 形式的负载解析成 dict（object 用 obj 键）。"""
    out: dict[str, str] = {}
    for chunk in raw.split('|'):
        chunk = chunk.strip()
        if not chunk:
            continue
        if '=' not in chunk:
            out['obj'] = chunk
            continue
        key, value = chunk.split('=', 1)
        key = key.strip()
        out['obj' if key == 'object' else key] = value.strip()
    return out


def find_group(root: ET.Element, object_key: str) -> ET.Element | None:
    for gid in (f'{object_key}-area', f'{object_key}-chartArea'):
        for el in root.iter(f'{{{SVG_NS}}}g'):
            if el.get('id') == gid:
                return el
    return None


def collect_numbers(el: ET.Element, tag: str, attrs: tuple[str, ...]) -> list[tuple[float, ...]]:
    rows = []
    for node in el.iter(f'{{{SVG_NS}}}{tag}'):
        try:
            rows.append(tuple(float(node.get(a)) for a in attrs))
        except (TypeError, ValueError):
            continue
    return rows


def collect_points(el: ET.Element, tag: str) -> list[tuple[float, ...]]:
    """把 points="x,y x,y" 解析成扁平浮点序列。"""
    out = []
    for node in el.iter(f'{{{SVG_NS}}}{tag}'):
        raw = (node.get('points') or '').strip()
        if not raw:
            continue
        nums = [float(v) for v in re.findall(r'-?\d+(?:\.\d+)?', raw)]
        out.append(tuple(nums))
    return out


def run_calculator(mode: str, payload: dict) -> tuple[str, str]:
    """按声明重算权威坐标，返回 (stdout, error)。"""
    labels = [v.strip() for v in payload.get('labels', '').split(',') if v.strip()]
    values = [v.strip() for v in payload.get('values', '').split(',') if v.strip()]
    if not labels or len(labels) != len(values):
        return '', f'labels({len(labels)}) 与 values({len(values)}) 数量不一致或缺失'
    if mode == 'line':
        # 折线/散点走数值 x 轴：标签仅用于显示，x 取顺序索引（与上游 calc line 的 x:y 约定一致）
        data = ','.join(f'{i}:{v}' for i, v in enumerate(values, 1))
    else:
        data = ','.join(f'{a}:{b}' for a, b in zip(labels, values))

    cmd = [sys.executable, str(CALCULATOR), 'calc', mode, '--data', data]
    if payload.get('area'):
        cmd += ['--area', payload['area']]
    if mode == 'bar':
        if payload.get('bar-width'):
            cmd += ['--bar-width', payload['bar-width']]
        if payload.get('gap-width'):
            cmd += ['--gap-width', payload['gap-width']]
        if payload.get('horizontal', '').lower() in ('1', 'true', 'yes'):
            cmd.append('--horizontal')
    if payload.get('value-range'):
        cmd += [f'--value-range={payload["value-range"]}']
    if payload.get('y-range'):
        cmd += [f'--y-range={payload["y-range"]}']
    if payload.get('center'):
        cmd += ['--center', payload['center']]
        if payload.get('radius'):
            cmd += ['--radius', payload['radius']]
        if payload.get('max-value'):
            cmd += ['--max-value', payload['max-value']]

    env = dict(os.environ)
    env.pop('PYTHONPATH', None)
    cp = subprocess.run(cmd, capture_output=True, text=True, env=env)
    text = (cp.stdout or '') + (cp.stderr or '')
    if cp.returncode != 0:
        return text, f'计算器退出码 {cp.returncode}'
    return text, ''


def parse_bar_table(text: str) -> list[tuple[float, ...]]:
    """解析计算器的坐标表，从右侧取 5 列（value,x,y,width,height），标签可含空格。"""
    rows = []
    started = False
    for line in text.splitlines():
        if line.strip().startswith('----'):
            started = True
            continue
        if not started or not line.strip():
            continue
        parts = line.split()
        if len(parts) < 7:
            continue
        try:
            nums = tuple(float(v) for v in parts[-5:])
        except ValueError:
            continue
        rows.append(nums)  # (value, x, y, width, height)
    return rows


def parse_points_line(text: str) -> tuple[float, ...]:
    """取计算器给出的坐标序列。

    两种输出形态都要支持：radar/pie 给 `points="x,y x,y"`；line/area 给
    `=== SVG Path ===` 下的 `M x,y L x,y …`（没有 points 属性）。
    """
    m = re.search(r'points="([^"]+)"', text)
    if m:
        return tuple(float(v) for v in re.findall(r'-?\d+(?:\.\d+)?', m.group(1)))
    m = re.search(r'=== SVG Path ===\s*(.+)', text)
    if m:
        return tuple(float(v) for v in re.findall(r'-?\d+(?:\.\d+)?', m.group(1)))
    return ()


def verify_page(svg_path: Path, tolerance: float) -> list[dict]:
    raw = svg_path.read_text(encoding='utf-8')
    declarations = DATA_RE.findall(raw)
    if not declarations:
        return []
    try:
        tree = ET.parse(svg_path)
    except ET.ParseError as exc:
        return [{'file': svg_path.name, 'object': '?', 'calc': '(无法解析)', 'mode': '-',
                 'status': 'svg-parse-error', 'mismatches': [], 'detail': str(exc)}]

    root = tree.getroot()
    plot_areas = PLOT_AREA_RE.findall(raw)
    results = []

    for raw_decl in declarations:
        payload = parse_payload(raw_decl)
        obj = payload.get('obj', '?')
        mode = payload.get('calc', '')
        rec = {
            'file': svg_path.name,
            'object': obj,
            'calc': mode or '(未声明)',
            'mode': 'direct-calc' if mode in DIRECT_CALC else 'manual-verify',
            'mismatches': [],
        }

        if f'object={obj}' not in ' '.join(plot_areas).replace(' ', ''):
            rec['mismatches'].append('缺少 chart-plot-area 标记（或 object 不匹配）')

        if mode not in DIRECT_CALC:
            rec['status'] = 'manual-verify'
            rec['detail'] = '无直接布局模型，按公式人工核对（见骨架内注释）'
            results.append(rec)
            continue

        text, err = run_calculator(mode, payload)
        if err:
            rec['status'] = 'calc-failed'
            rec['detail'] = err
            results.append(rec)
            continue

        group = find_group(root, obj)
        if group is None:
            rec['status'] = 'group-missing'
            rec['detail'] = f'未找到 <g id="{obj}-area"> 或 <g id="{obj}-chartArea">'
            results.append(rec)
            continue

        if mode == 'bar':
            expected = [(n[1], n[2], n[3], n[4]) for n in parse_bar_table(text)]
            actual = collect_numbers(group, 'rect', ('x', 'y', 'width', 'height'))
        elif mode == 'line':
            expected = [parse_points_line(text)]
            actual = collect_points(group, 'polyline')
        else:
            expected = [parse_points_line(text)]
            actual = collect_points(group, 'polygon')

        expected = [e for e in expected if e]
        rec['marks'] = len(actual)
        if len(expected) != len(actual):
            rec['mismatches'].append(f'标记数不符：计算得 {len(expected)}，页面绘制 {len(actual)}')

        for idx, (exp, act) in enumerate(zip(expected, actual), 1):
            if len(exp) != len(act):
                rec['mismatches'].append(f'第 {idx} 项维度不符：期望 {len(exp)}，实际 {len(act)}')
                continue
            bad = [f'{e:.1f}→{a:.1f}' for e, a in zip(exp, act) if abs(e - a) > tolerance]
            if bad:
                rec['mismatches'].append(f'第 {idx} 项超出 {tolerance:g}px：' + ', '.join(bad))

        rec['status'] = 'ok' if not rec['mismatches'] else 'mismatch'
        results.append(rec)

    return results


def main() -> int:
    ap = argparse.ArgumentParser(description='值驱动图形几何一致性校验')
    ap.add_argument('project')
    ap.add_argument('--tolerance', type=float, default=2.0, help='允许偏差（px，默认 2）')
    ap.add_argument('--json', action='store_true')
    args = ap.parse_args()

    if not os.environ.get('PPTM_HOME'):
        raise SystemExit('ERROR: 请设置 PPTM_HOME 指向已校验的 ppt-master 工具链。')

    project = Path(args.project).resolve()
    svg_dir = project / 'svg_output'
    if not svg_dir.is_dir():
        raise SystemExit(f'ERROR: {svg_dir} 不存在')

    if not CALCULATOR.is_file():
        raise SystemExit(f'ERROR: 未找到上游计算器 {CALCULATOR}')

    all_recs: list[dict] = []
    for svg in sorted(svg_dir.glob('*.svg')):
        all_recs.extend(verify_page(svg, args.tolerance))

    if args.json:
        print(json.dumps({'objects': all_recs}, ensure_ascii=False, indent=2))
    else:
        if not all_recs:
            print('verify-geometry: 未发现 chart-data 声明，无需校验数据几何')
        for rec in all_recs:
            line = (f"verify-geometry: {rec['file']} | object={rec['object']} | "
                    f"calc={rec['calc']} | mode={rec['mode']} | marks={rec.get('marks', '-')} | "
                    f"status={rec['status']}")
            print(line)
            for bad in rec.get('mismatches', []):
                print(f'    !! {bad}')
            if rec.get('detail'):
                print(f'    -- {rec["detail"]}')

    failed = [r for r in all_recs if r['status'] in ('mismatch', 'calc-failed', 'group-missing', 'svg-parse-error')]
    manual = [r for r in all_recs if r['status'] == 'manual-verify']
    print(f'\n汇总：对象 {len(all_recs)} 个（通过 {len(all_recs) - len(failed) - len(manual)} · '
          f'人工核对 {len(manual)} · 失败 {len(failed)}）')
    if failed:
        print('结论：存在几何不一致，导出前必须修复')
        return 1
    print('结论：数据与几何一致' + ('（人工核对项需按公式复核）' if manual else ''))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
