#!/usr/bin/env python3
"""gatecheck.py — 在一批页面自己的私有目录里跑三闸门（并行派工专用）。

为什么需要它：`verify_palette.py` / `verify_layout.py` / `verify_geometry.py` 都是
`<project>/svg_output/*.svg` **全目录扫描**。多个子代理同时往同一个工作区写页时，
别人尚未写完的页会被判成你的错误（实测：一批 9 页去验，报出 40+ 条不属于本批的
error）。本脚本只拷 `spec_lock.md` + 你点名的页到 `/tmp/gatecheck_<batch>/`，
闸门只看本批，产出只看得到本批。

用法：
    python3 scripts/gatecheck.py <project_dir> --pages 'p15_*' 'p16_*' --batch B03

`--batch` **必填**且并行各批必须不同名：临时目录按批次名建，两批同名就是共用同一个
目录，先跑完的那批会把还在跑的那批的页清掉——隔离保证会静默失效，所以不给默认值。

退出码 0 = 本批三闸门全过；非 0 = 有 error（打印的修法来自各校验器本身）。
"""
from __future__ import annotations

import argparse
import fnmatch
import re
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
GATES = (('配色', 'verify_palette.py'), ('版式', 'verify_layout.py'), ('数据几何', 'verify_geometry.py'))
MAX_LINES_PER_GATE = 20


def brief(text: str) -> str:
    """只保留结论性行，压掉过程性输出，避免污染调用方上下文。"""
    keep = []
    for line in text.splitlines():
        s = line.strip()
        if not s:
            continue
        if re.search(r'(\[VIOLATION\]|\[L\d\]|!! |^ERROR|结论：|汇总：|status=(mismatch|calc-failed|group-missing|svg-parse-error))', s):
            if s not in keep:
                keep.append(s)
    if not keep:
        keep = [l.strip() for l in text.splitlines() if l.strip()][:3]
    if len(keep) > MAX_LINES_PER_GATE:
        extra = len(keep) - MAX_LINES_PER_GATE
        keep = keep[:MAX_LINES_PER_GATE] + [f'……另 {extra} 条同类（完整输出见各校验器单跑）']
    return '\n'.join(keep)


def main() -> int:
    ap = argparse.ArgumentParser(description='私有目录内跑三闸门（并行派工批次隔离）')
    ap.add_argument('project', help='含 spec_lock.md 与 svg_output/ 的项目目录')
    ap.add_argument('--pages', nargs='+', required=True, help='本批页的文件名模式（对 svg_output 内文件名 fnmatch）')
    ap.add_argument('--batch', required=True,
                    help='批次名，决定 /tmp/gatecheck_<batch>。并行各批必须不同名（同名会共用目录、互相清页），' +
                         '故无默认值')
    ap.add_argument('--keep', action='store_true', help='保留临时闸门目录排查')
    args = ap.parse_args()

    project = Path(args.project).resolve()
    svg_dir = project / 'svg_output'
    if not svg_dir.is_dir():
        print(f'ERROR: {svg_dir} 不存在')
        return 2
    spec_lock = project / 'spec_lock.md'
    if not spec_lock.is_file():
        print(f'ERROR: 缺 {spec_lock}（配色闸门的色板唯一事实源）')
        return 2

    names = sorted(p.name for p in svg_dir.glob('*.svg'))
    picked, missed = [], []
    for pat in args.pages:
        hit = [n for n in names if fnmatch.fnmatch(n, pat) or n == pat or n.removesuffix('.svg') == pat]
        (picked if hit else missed).extend(hit or [pat])
    picked = sorted(set(picked))
    if missed:
        print(f"ERROR: 模式没命中任何页：{' '.join(missed)}")
        print(f'svg_output 现有 {len(names)} 页，例：{" ".join(names[:5])}')
        return 2

    batch = re.sub(r'[^A-Za-z0-9_.-]', '_', args.batch)
    gate = Path('/tmp') / f'gatecheck_{batch}'
    if gate.exists():
        shutil.rmtree(gate)
    (gate / 'svg_output').mkdir(parents=True)
    shutil.copy2(spec_lock, gate / 'spec_lock.md')
    for n in picked:
        shutil.copy2(svg_dir / n, gate / 'svg_output' / n)

    env = {k: v for k, v in __import__('os').environ.items() if k != 'PYTHONPATH'}
    print(f'批次 {batch}：本批 {len(picked)} 页 → {gate}')
    print('本批页面：' + ' '.join(picked))
    failed = []
    for label, script in GATES:
        path = HERE / script
        if not path.is_file():
            print(f'ERROR: 找不到 {path}')
            return 2
        cp = subprocess.run([sys.executable, str(path), str(gate)],
                            capture_output=True, text=True, env=env)
        out = (cp.stdout or '') + (cp.stderr or '')
        if cp.returncode == 0:
            tail = [l for l in out.splitlines() if '结论' in l or '汇总' in l]
            print(f'[PASS] 闸门 {label}：{(tail[-1].strip() if tail else "无发现")}')
        else:
            failed.append(label)
            print(f'[FAIL] 闸门 {label}：')
            print('\n'.join('       ' + l for l in brief(out).splitlines()))
    if not args.keep:
        shutil.rmtree(gate, ignore_errors=True)
    if failed:
        print(f'结论：本批未过闸门（{" · ".join(failed)}）。修完本批页面再重跑，不要去动别人的页。')
        return 1
    print(f'结论：本批 {len(picked)} 页三闸门全过，可以进全册闸门/导出。')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
