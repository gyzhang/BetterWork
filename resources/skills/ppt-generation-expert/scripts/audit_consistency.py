#!/usr/bin/env python3
"""audit_consistency.py — skill 文档 ↔ 磁盘 ↔ ppt-master 仓库 的一致性审计。

文档写久了必然漂移：声称的套件数、骨架数、品牌数、分支名、上游版本，写的时候是对的，
上游升级或改了 remote 布局之后就悄悄变成错的。本脚本把文档里的每条**可核对断言**
拿去和实际状态对账，退出码非 0 即存在不一致。

用法：
    PPTM_HOME=/path/to/ppt-master python3 audit_consistency.py          # 全量审计
    PPTM_HOME=/path/to/ppt-master python3 audit_consistency.py --quiet  # 只印不一致项

检查族：
  A 版本     Skill 文档包声明的 ppt-master 版本 == 仓库实际版本
  B 资产计数 charts/tables/icons/styles/layouts/brands 实际数 == 文档声称数
  C 自身资产 scripts/diagrams/atlas 实际数 == 文档声称数（脚本须在维护手册登记）
  D 自检     selftest 实际套件与断言数 == 文档包声称数
  E 同步     仓库 tracking 模式（纯上游=git pull / fork=rebase）与维护手册同步命令一致
  F 上游原样 radar 等上游文件保持官方原样（无本地补丁）
  G 依赖     我们直接调用的上游脚本仍存在
  H 引用     文档引用的上游文件与上游脚本路径真实存在

使用 Skill 锁定依赖对应的 Python，并显式设置 PPTM_HOME。
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path

SKILL = Path(__file__).resolve().parent.parent
PPTM = Path(os.environ.get('PPTM_HOME', ''))
UP = PPTM / 'skills' / 'ppt-master'

issues: list[tuple[str, str]] = []
notes: list[str] = []


def bad(kind: str, msg: str) -> None:
    issues.append((kind, msg))


def good(msg: str) -> None:
    notes.append(msg)


def git(*args: str) -> str:
    cp = subprocess.run(['git', '-C', str(PPTM), *args], capture_output=True, text=True)
    return cp.stdout.strip()


def num_in(text: str, *pats: str) -> str | None:
    """按给定模式取第一个数字断言。"""
    for p in pats:
        m = re.search(p, text)
        if m:
            return m.group(1)
    return None


def main() -> int:
    if not os.environ.get('PPTM_HOME'):
        raise SystemExit('ERROR: 请设置 PPTM_HOME 指向已校验的 ppt-master 工具链。')
    ap = argparse.ArgumentParser(description='skill 一致性审计')
    ap.add_argument('--quiet', action='store_true', help='只印不一致项')
    args = ap.parse_args()

    skill_md = (SKILL / 'SKILL.md').read_text(encoding='utf-8')
    package_docs = [skill_md] + [
        p.read_text(encoding='utf-8')
        for p in sorted((SKILL / 'references').rglob('*.md'))
    ]
    package_docs_text = '\n'.join(package_docs)
    tmpl_md = (SKILL / 'templates' / '中电金信.md').read_text(encoding='utf-8')

    def say(s: str) -> None:
        if not args.quiet:
            print(s)

    # ---- A 版本 -----------------------------------------------------------
    say('=== A. 上游版本 ===')
    up_ver = num_in((UP / 'SKILL.md').read_text(encoding='utf-8'), r'version:\s*"([\d.]+)"')
    doc_ver = num_in(package_docs_text, r'ppt-master `v([\d.]+)`', r'ppt-master v([\d.]+)')
    say(f'  仓库实际: v{up_ver}   文档声称: v{doc_ver}')
    if up_ver and doc_ver and up_ver != doc_ver:
        bad('版本', f'文档包声称 ppt-master v{doc_ver}，仓库实际 v{up_ver}')
    elif up_ver:
        good(f'版本一致 v{up_ver}')

    # ---- B 上游资产计数 ---------------------------------------------------
    say('\n=== B. 上游资产计数 ===')
    def dirs(p: Path) -> int:
        return len([d for d in p.iterdir() if d.is_dir()]) if p.is_dir() else -1

    actual = {
        'charts': len(list((UP / 'templates' / 'charts').glob('*.svg'))),
        'tables': len(list((UP / 'templates' / 'tables').glob('*.svg'))),
        'icons': len(list((UP / 'templates' / 'icons').rglob('*.svg'))),
        'styles': dirs(UP / 'templates' / 'styles'),
        'layouts': dirs(UP / 'templates' / 'layouts'),
        'brands': dirs(UP / 'templates' / 'brands'),
    }
    claimed = {
        'charts': num_in(package_docs_text, r'chart/`?\((\d+)'),
        'tables': num_in(package_docs_text, r'table/`?\((\d+)'),
        'icons': num_in(package_docs_text, r'icons/`\((\d+)\)'),
        'styles': num_in(package_docs_text, r'styles/`\((\d+) 套'),
        'layouts': num_in(package_docs_text, r'layouts/`\((\d+) 族'),
        'brands': num_in(package_docs_text, r'brands/`\((\d+)\)'),
    }
    for k, av in actual.items():
        cv = claimed.get(k)
        mark = 'ok ' if cv == str(av) else 'BAD'
        say(f'  [{mark}] {k}: 实际 {av} / 声称 {cv}')
        if cv != str(av):
            bad('资产计数', f'{k}: 文档声称 {cv}，实际 {av}')

    # ---- C 自身资产 -------------------------------------------------------
    say('\n=== C. 本 skill 资产 ===')
    own = {
        'scripts': len(list((SKILL / 'scripts').glob('*.py'))),
        'diagrams': len(list((SKILL / 'assets' / 'diagrams').glob('*.svg'))),
        'atlas': len(list((SKILL / 'assets' / 'atlas').glob('*.png'))),
    }
    say(f'  scripts {own["scripts"]} · diagrams {own["diagrams"]} · atlas {own["atlas"]}')
    for name in [p.name for p in (SKILL / 'scripts').glob('*.py')]:
        if name not in package_docs_text:
            bad('脚本未登记', f'{name} 存在但 Skill 文档包未提及')

    # 关系图骨架数：散文声称值必须与磁盘真实数一致（防 F1 类漂移，把盲区变成硬门禁）
    true_n = own['diagrams']
    claim_patterns = [
        r'`assets/diagrams/`：(\d+) 个关系/结构图骨架',
        r'(\d+) 个关系/结构图骨架',
        r'(\d+) 个关系／结构图骨架',
        r'(\d+) 类固化成骨架',
        r'(\d+) 个骨架都遵守',
        r'`diagram/` (\d+)（',
        r'assets/diagrams/` \| (\d+)',
    ]
    checked = [SKILL / 'SKILL.md'] + sorted(
        p for p in SKILL.glob('**/*.md') if p != SKILL / 'SKILL.md'
    )
    for fp in checked:
        try:
            text = fp.read_text(encoding='utf-8', errors='ignore')
        except Exception:
            continue
        for pat in claim_patterns:
            for m in re.finditer(pat, text):
                claimed = int(m.group(1))
                if claimed != true_n:
                    bad('关系图骨架数',
                        f'{fp.relative_to(SKILL)} 声称 {claimed} 个关系图骨架，但磁盘实际 {true_n} 个')
    say(f'  关系图骨架数散文一致性：磁盘 {true_n} 个，已逐文档核对')

    # ---- D 自检 -----------------------------------------------------------
    say('\n=== D. 自检套件与断言数 ===')
    st = (SKILL / 'tests' / 'selftest_e2e.py').read_text(encoding='utf-8')
    m = re.search(r"choices=\[(.*?)\]", st, re.S)
    choices = [c for c in re.findall(r"'(\w+)'", m.group(1))] if m else []
    n_suite = len([c for c in choices if c != 'all'])
    # 中文数字：改套件数时不必再回来补这张表（>=10 走「十N」/「N」写法）
    _DIGIT = '零一二三四五六七八九'
    if n_suite < 10:
        zh = _DIGIT[n_suite]
    elif n_suite == 10:
        zh = '十'
    elif n_suite < 20:
        zh = '十' + _DIGIT[n_suite - 10]
    else:
        zh = str(n_suite)
    ok_suite = f'{zh}套件共' in package_docs_text or f'{zh}套件 ' in package_docs_text or f'（{zh}套件' in package_docs_text
    say(f'  实际套件 {n_suite} 个；文档措辞「{zh}套件」: {"匹配" if ok_suite else "不匹配"}')
    if not ok_suite:
        bad('自检', f'实际 {n_suite} 个套件，但 SKILL.md 未用「{zh}套件」措辞')
    n_items = num_in(package_docs_text, r'共 \*\*(\d+) 项\*\*断言', r'\*\*(\d+) 项\*\*')
    say(f'  文档声称断言数: {n_items}（实际以跑出来的汇总为准，改动后请同步）')

    # ---- E 同步模式 -------------------------------------------------------
    say('\n=== E. 同步模式 ===')
    branch = git('branch', '--show-current')
    upstream_ref = git('rev-parse', '--abbrev-ref', '@{u}')
    say(f'  当前分支 {branch} → tracking {upstream_ref}')
    if branch and branch not in package_docs_text:
        bad('分支', f'当前分支 {branch} 未在 Skill 文档包中出现')
    # 以 tracking 远程的 URL 判定模式（不依赖 remote 叫 origin 还是 upstream）：
    #   URL 指向源仓库 hugohe3/ppt-master → 纯上游（git pull 即同步）
    #   URL 指向个人 fork → fork 模式（必须 fetch+rebase upstream/main）
    remote_name = upstream_ref.split('/')[0]
    try:
        remote_url = git('remote', 'get-url', remote_name)
    except Exception:
        remote_url = ''
    say(f'  tracking 远程 {remote_name} URL: {remote_url}')
    is_source = 'hugohe3/ppt-master' in remote_url
    if is_source:
        # 纯上游模式：pull 即同步，文档必须这么教，且不能再教 rebase
        if 'git pull' not in package_docs_text:
            bad('同步命令', '仓库已直接 tracking 源仓库，但 维护手册没有 `git pull` 同步指引')
        if re.search(r'git rebase upstream/main', package_docs_text):
            bad('同步命令', '维护手册仍教 `git rebase upstream/main`——纯上游模式下 pull 即可，rebase 指引已过时')
        else:
            good('纯上游模式：维护手册同步指引与 tracking 源仓库一致')
    else:
        # fork 模式：必须走 fetch+rebase
        if 'git rebase upstream/main' not in package_docs_text:
            bad('同步命令', 'tracking 远程是 fork，但 维护手册缺少 `git rebase upstream/main`')
        else:
            good('fork 模式：同步命令走 upstream')
        if re.search(r'git pull\s+#', package_docs_text):
            bad('同步命令', '维护手册仍把裸 `git pull` 当作同步上游的手段（fork 模式下 pull 拉不到上游）')

    # ---- F 上游原样 --------------------------------------------------------
    say('\n=== F. 上游原样 ===')
    radar = UP / 'templates' / 'charts' / 'radar_chart.svg'
    if radar.is_file():
        native = 'data-pptx-replace-with' in radar.read_text(encoding='utf-8')
        say(f'  radar_chart.svg 原生 marker: {native}（纯上游模式应为 True，形状化由 §2.4.3 三步转换承担）')
        if not native:
            bad('定制残留', 'radar_chart.svg 不含原生 marker——本地补丁残留，与「不 fork 上游」约定冲突')

    # ---- G 上游依赖脚本 ---------------------------------------------------
    say('\n=== G. 上游依赖脚本 ===')
    deps = ['project_manager.py', 'svg_position_calculator.py', 'visualization_recall.py',
            'icon_sync.py', 'attribution_guard.py', 'svg_quality_checker.py', 'svg_to_pptx.py']
    for d in deps:
        p = UP / 'scripts' / d
        if not p.exists():
            bad('依赖缺失', f'上游脚本缺失: {d}')
    say(f'  {len(deps)} 个依赖脚本: {"全部存在" if not any(i[0]=="依赖缺失" for i in issues) else "有缺失"}')

    # ---- H 文档引用的上游路径 ---------------------------------------------
    say('\n=== H. 文档引用的上游路径 ===')
    docs = {p: p.read_text(encoding='utf-8')
            for p in list((SKILL / 'references').rglob('*.md')) + [SKILL / 'SKILL.md',
                                                                   SKILL / 'templates' / '中电金信.md']}
    miss = 0
    for p, txt in docs.items():
        for m in re.finditer(r'\$PPTM_HOME/([A-Za-z0-9_\-/]+\.(?:py|json|svg|md))', txt):
            rel = m.group(1)
            if '<' in rel or 'projects/' in rel:
                continue
            if not (PPTM / rel).exists():
                bad('引用失效', f'{p.name}: $PPTM_HOME/{rel}')
                miss += 1
        for m in re.finditer(r'\$\{SKILL_DIR\}/scripts/([a-z_]+\.py)', txt):
            if not (UP / 'scripts' / m.group(1)).exists():
                bad('引用失效', f'{p.name}: ${{SKILL_DIR}}/scripts/{m.group(1)}')
                miss += 1
    say(f'  {len(docs)} 份文档，失效引用 {miss} 处')

    # ---- 结论 -------------------------------------------------------------
    say('\n=== 结论 ===')
    if not issues:
        say(f'  未发现不一致（核对项 {len(notes)} 条）。')
    for kind, msg in issues:
        print(f'  [{kind}] {msg}')
    return 1 if issues else 0


if __name__ == '__main__':
    raise SystemExit(main())
