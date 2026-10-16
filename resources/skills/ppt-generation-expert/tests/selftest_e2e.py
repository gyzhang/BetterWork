#!/usr/bin/env python3
"""端到端回归基线（ppt-generation-expert 自检）。

用途：skill 依赖的外部仓库 ppt-master 会持续演进（git pull），本脚本把「管线是否还能
端到端跑通、且产出符合交付口径」固化成断言，让上游更新后的回归从人肉目检变成一键验证。

用法：
    PPTM_HOME=/path/to/ppt-master python3 tests/selftest_e2e.py
    ... selftest_e2e.py --suite mainline     # 只跑主链路（默认，全绿才算通过）
    ... selftest_e2e.py --suite lockless     # 只跑「缺 spec_lock 自动生成」路径探针
    ... selftest_e2e.py --suite all
    ... selftest_e2e.py --keep               # 保留临时工作区供排查

退出码：0 = 主链路全绿；1 = 有非预期失败。
「已知缺陷探针」（KNOWN-ISSUE）失败不计入退出码——它们是 skill 现存缺陷的固见证，
修好之后会自动转为 PASS，届时应把它提升为必过断言。

使用 Skill 锁定依赖对应的 Python，并显式设置 PPTM_HOME；BetterWork 会注入已绑定的工具链快照。
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import zipfile
from pathlib import Path

SKILL_DIR = Path(__file__).resolve().parent.parent
FIXTURES = Path(__file__).resolve().parent / 'fixtures'
TEMPLATE_PPTX = SKILL_DIR / 'assets' / '中电金信模板.pptx'
DIAGRAMS_DIR = SKILL_DIR / 'assets' / 'diagrams'
EXPORT_SCRIPT = SKILL_DIR / 'scripts' / 'svg_native_export.py'
MERGE_SCRIPT = SKILL_DIR / 'scripts' / 'merge_into_template.py'
VALIDATE_SCRIPT = SKILL_DIR / 'scripts' / 'validate_pptx.py'
LAYOUT_SCRIPT = SKILL_DIR / 'scripts' / 'verify_layout.py'
PALETTE_SCRIPT = SKILL_DIR / 'scripts' / 'verify_palette.py'
TABLE_SCRIPT = SKILL_DIR / 'scripts' / 'native_table_inject.py'
GEOMETRY_SCRIPT = SKILL_DIR / 'scripts' / 'verify_geometry.py'
GATECHECK_SCRIPT = SKILL_DIR / 'scripts' / 'gatecheck.py'
CHARTS_LIB = SKILL_DIR / 'references' / 'charts-library.md'
CHARTS_ATLAS = SKILL_DIR / 'references' / 'charts-atlas.md'
DIAGRAMS_LIB = SKILL_DIR / 'references' / 'diagrams-library.md'
STYLES_DIR = SKILL_DIR / 'references' / 'styles'
ARCHIVE_MD = SKILL_DIR / 'templates' / '中电金信.md'
SKILL_MD = SKILL_DIR / 'SKILL.md'
DISCIPLINE_MD = SKILL_DIR / 'references' / 'doc-writing-discipline.md'

PPTM_HOME = Path(os.environ.get('PPTM_HOME', ''))
PPTM_SCRIPTS = PPTM_HOME / 'skills' / 'ppt-master' / 'scripts'

PASS, FAIL, KNOWN = 'PASS', 'FAIL', 'KNOWN-ISSUE'
_results: list[tuple[str, str, str]] = []


def record(status: str, name: str, detail: str = '') -> None:
    _results.append((status, name, detail))
    mark = {PASS: '  ok  ', FAIL: ' FAIL ', KNOWN: 'known '}[status]
    line = f'[{mark}] {name}'
    if detail:
        line += f'  — {detail}'
    print(line, flush=True)


def check(cond: bool, name: str, detail: str = '') -> bool:
    record(PASS if cond else FAIL, name, detail)
    return bool(cond)


def known_issue(cond: bool, name: str, detail: str = '') -> bool:
    """探针：cond 为真表示缺陷已修复（PASS），否则记为 KNOWN-ISSUE 不阻塞。"""
    record(PASS if cond else KNOWN, name, detail)
    return bool(cond)


def run(cmd: list[str], **kw) -> subprocess.CompletedProcess:
    """统一剥离 PYTHONPATH，避免宿主会话注入的沙箱 shim 干扰打包。"""
    env = dict(os.environ)
    env.pop('PYTHONPATH', None)
    return subprocess.run(cmd, capture_output=True, text=True, env=env, **kw)


def out_of(cp: subprocess.CompletedProcess) -> str:
    return (cp.stdout or '') + (cp.stderr or '')


def slide_pic_count(pptx: Path) -> int:
    z = zipfile.ZipFile(pptx)
    total = 0
    for n in z.namelist():
        if re.match(r'ppt/slides/slide\d+\.xml$', n):
            total += len(re.findall(r'<p:pic>', z.read(n).decode('utf-8', 'ignore')))
    return total


def slide_group_stats(pptx: Path) -> tuple[int, set[str]]:
    """返回 (原生分组数, 幻灯片里出现过的组名集合)。分组名 = 编写时 SVG 的 g id。"""
    z = zipfile.ZipFile(pptx)
    count = 0
    names: set[str] = set()
    for n in z.namelist():
        if re.match(r'ppt/slides/slide\d+\.xml$', n):
            xml = z.read(n).decode('utf-8', 'ignore')
            count += len(re.findall(r'<p:grpSp>', xml))
            names.update(re.findall(r'<p:cNvPr id="\d+" name="([^"]+)"', xml))
    return count, names


def svg_group_ids(svg: Path) -> list[str]:
    """取 SVG 里所有 <g id="...">（含嵌套），用于与导出的分组名比对。"""
    return re.findall(r'<g id="([^"]+)"', svg.read_text(encoding='utf-8'))


def slide_sp_count(pptx: Path) -> int:
    z = zipfile.ZipFile(pptx)
    total = 0
    for n in z.namelist():
        if re.match(r'ppt/slides/slide\d+\.xml$', n):
            total += len(re.findall(r'<p:sp>', z.read(n).decode('utf-8', 'ignore')))
    return total


def postflight_gate(text: str) -> str | None:
    m = re.search(r'\[POSTFLIGHT\][^\n]*quality_gate=([\w-]+)', text)
    return m.group(1) if m else None


def make_project(tag: str) -> Path | None:
    """建临时工作区；project_manager 强制写到 $PPTM_HOME/projects/ 下。"""
    name = f'zz_selftest_{tag}_{int(time.time())}'
    cp = run([sys.executable, str(PPTM_SCRIPTS / 'project_manager.py'),
              'init', name, '--quick-generate', '--format', 'ppt169'])
    m = re.search(r'Project initialized:\s*(\S+)', out_of(cp))
    return Path(m.group(1)) if m else None


def stage_fixtures(project: Path, with_lock: bool) -> None:
    dst = project / 'svg_output'
    for f in ('s01_summary.svg', 's02_compare.svg'):
        shutil.copy2(FIXTURES / f, dst / f)
    shutil.copy2(FIXTURES / 'pages.json', project / 'pages.json')
    if with_lock:
        shutil.copy2(FIXTURES / 'spec_lock.mainline.md', project / 'spec_lock.md')


def preflight() -> None:
    print('=== 0. 环境前提 ===')
    check(PPTM_HOME.is_dir(), 'PPTM_HOME 存在', str(PPTM_HOME))
    check(TEMPLATE_PPTX.is_file(), '公司模板 pptx 存在', TEMPLATE_PPTX.name)
    check(FIXTURES.is_dir(), '回归夹具目录存在', str(FIXTURES.name))

    guard = PPTM_SCRIPTS / 'attribution_guard.py'
    if guard.is_file():
        cp = run([sys.executable, str(guard)])
        check(cp.returncode == 0, 'ppt-master 署名守卫通过（fail-closed）',
              'exit=0' if cp.returncode == 0 else f'exit={cp.returncode}：删摘要文件或改 frontmatter 会导致整条管线拒跑')
    else:
        record(FAIL, 'ppt-master 署名守卫存在', '未找到 attribution_guard.py')

    try:
        import pptx  # noqa: F401
        check(True, 'python-pptx 可用', '当前解释器已装')
    except ImportError:
        check(False, 'python-pptx 可用', '请检查当前 Skill Python 环境的依赖锁。')


def suite_mainline(keep: bool) -> None:
    print('\n=== 主链路（S1：init → 导出 → merge → 校验）===')
    project = make_project('main')
    if not check(project is not None and project.is_dir(), '创建工作区', str(project)):
        return
    try:
        stage_fixtures(project, with_lock=True)

        output_path = project / 'export.pptx'
        cp = run([sys.executable, str(EXPORT_SCRIPT), str(project), '--output', str(output_path)])
        text = out_of(cp)
        if not check(cp.returncode == 0, 'svg_native_export 退出码 0',
                     text.strip().splitlines()[-1] if text.strip() else ''):
            print(text[-1500:])
            return
        check('[Done] Saved:' in text, '导出回执 [Done] Saved 出现')
        gate = postflight_gate(text)
        check(gate == 'passed', 'POSTFLIGHT quality_gate=passed',
              f'实际 {gate}' if gate != 'passed' else '质检报告与当前 SVG 指纹匹配')

        m = re.search(r'OUTPUT_PPTX:\s*(\S+)', text)
        exported = Path(m.group(1)) if m else None
        if not check(exported is not None and exported.is_file(), '声明的输出路径产出'):
            return

        check(slide_pic_count(exported) == 0, '导出产物 <p:pic>=0（零位图）',
              f'实际 {slide_pic_count(exported)}')
        check(slide_sp_count(exported) > 0, '导出产物 <p:sp> > 0（原生形状）',
              f'{slide_sp_count(exported)} 个形状')

        groups, pptx_names = slide_group_stats(exported)
        check(groups > 0, '导出产物含原生分组 <p:grpSp>（可一次点选整个卡片）',
              f'{groups} 个分组')
        expected_ids: list[str] = []
        for f in ('s01_summary.svg', 's02_compare.svg'):
            expected_ids += svg_group_ids(FIXTURES / f)
        missing_groups = [gid for gid in expected_ids if gid not in pptx_names]
        check(not missing_groups, '分组名与 SVG 的 g id 一一对应',
              f'缺失 {missing_groups}' if missing_groups else f'{len(expected_ids)} 个 id 全部落地')

        pages = json.loads((FIXTURES / 'pages.json').read_text(encoding='utf-8'))
        expected_pages = len(pages['pages'])

        from pptx import Presentation
        avail = [l.name for l in Presentation(str(TEMPLATE_PPTX)).slide_masters[0].slide_layouts]
        missing = [p['layout'] for p in pages['pages'] if p['layout'] not in avail]
        check(not missing, 'pages.json 版式名全部存在于模板', f'缺失 {missing}' if missing else f'{len(avail)} 个可用版式')

        final = project / 'final.pptx'
        cp = run([sys.executable, str(MERGE_SCRIPT), str(exported), str(TEMPLATE_PPTX),
                  str(final), str(project / 'pages.json')])
        if not check(cp.returncode == 0 and final.is_file(), 'merge_into_template 成功',
                     out_of(cp).strip().splitlines()[-1] if out_of(cp).strip() else ''):
            print(out_of(cp)[-1200:])
            return

        merged = Presentation(str(final))
        check(len(merged.slides) == expected_pages, f'合并产物页数 = {expected_pages}',
              f'实际 {len(merged.slides)}')

        empty_title = []
        for i, page in enumerate(pages['pages']):
            if i >= len(merged.slides):
                break
            got = any(
                ph.text_frame.text.strip()
                for ph in merged.slides[i].placeholders
                if ph.placeholder_format.idx == 0
            )
            if not got:
                empty_title.append(i + 1)
        check(not empty_title, '每页标题占位符均已填入', f'空标题页 {empty_title}' if empty_title else '含纯版式封面页')
        check(slide_pic_count(final) == 0, '合并产物 <p:pic>=0', f'实际 {slide_pic_count(final)}')

        cp = run([sys.executable, str(VALIDATE_SCRIPT), str(final)])
        bad = [l for l in out_of(cp).splitlines() if l.strip().startswith('!!')]
        check(not bad, 'validate_pptx 零问题（9 类修复触发点）',
              f'{len(bad)} 条：{bad[0].strip()}' if bad else '结构未发现触发修复的问题')
    finally:
        if project and project.is_dir() and not keep:
            shutil.rmtree(project, ignore_errors=True)
            print(f'  （已清理临时工作区 {project.name}）')


def suite_lockless(keep: bool) -> None:
    print('\n=== 缺 spec_lock 自动生成路径（探针）===')
    project = make_project('nolock')
    if not check(project is not None and project.is_dir(), '创建工作区（无 spec_lock）', str(project)):
        return
    try:
        stage_fixtures(project, with_lock=False)
        output_path = project / 'table-export.pptx'
        cp = run([sys.executable, str(EXPORT_SCRIPT), str(project), '--output', str(output_path)])
        text = out_of(cp)
        lock = project / 'spec_lock.md'
        if not check(lock.is_file(), '自动生成 spec_lock.md'):
            print(text[-1200:])
            return
        body = lock.read_text(encoding='utf-8')

        m = re.search(r'- primary_language:\s*(\S+)', body)
        lang = m.group(1) if m else '(缺失)'
        known_issue(lang == 'zh-Hans',
                    '默认锁 primary_language 为 BCP-47 (zh-Hans)',
                    f'{lang}｜铁律 6 与 svg-native-guide §6 要求 BCP-47，zh-CN 不合规')

        m = re.search(r'- consumption_mode:\s*(\S+)', body)
        mode = m.group(1) if m else '(缺失)'
        known_issue(mode != '[fill]',
                    '默认锁 consumption_mode 已落值（非模板令牌）',
                    f'{mode}｜上游枚举 text/balanced/presentation，[fill] 是未替换令牌')

        block = re.search(r'## colors\n(.*?)(?=\n## |\Z)', body, re.S)
        colors = block.group(1) if block else ''
        has_text_role = re.search(r'(?m)^- text:', colors) is not None
        known_issue(not has_text_role,
                    '默认锁 colors 未使用 text: 角色（dk1 恒黑，锁藏蓝会变纯黑）',
                    '仍存在 text: 角色' if has_text_role else '已改用 navy/risk/panel 标准角色名')
        roles = re.findall(r'(?m)^- (\w+):', colors)
        extra = [r for r in roles if r not in
                 ('bg', 'primary', 'accent', 'secondary_accent', 'border', 'text_secondary')]
        known_issue(extra[:2] == ['navy', 'risk'],
                    '默认锁 extra 前两位为 navy/risk（占 accent5/6，值与模板一致）',
                    f'{extra[:2]}｜浅灰等非主题色占前两位会整串色（2026-09-08 事故）')

        residual = re.findall(r'(?m)^- (\S+):\s*\[fill\]', body)
        known_issue(not residual,
                    '默认锁无残留 [fill] 令牌',
                    f'仍有 {residual}｜scaffold 共 16 处 [fill]，未替换会作为未解析令牌进入导出'
                    if residual else '16 处 [fill] 全部落值')
        style = re.search(r'- visual_style:\s*(\S.*)', body)
        known_issue(style is not None and style.group(1).strip() != '',
                    '默认锁 visual_style 已落值',
                    (style.group(1).strip()[:36] if style else '(缺失)'))

        gate = postflight_gate(text)
        check(gate == 'passed', '缺锁路径仍能导出且 quality_gate=passed',
              f'实际 {gate}' if gate != 'passed' else '便捷路径可用')
    finally:
        if project and project.is_dir() and not keep:
            shutil.rmtree(project, ignore_errors=True)
            print(f'  （已清理临时工作区 {project.name}）')


def _skeleton_file(fullkey: str) -> Path:
    """`<domain>/<key>` → 磁盘路径。chart/table 在上游，diagram 是本 skill 自持。"""
    domain, key = fullkey.split('/', 1)
    base = {
        'chart': PPTM_HOME / 'skills' / 'ppt-master' / 'templates' / 'charts',
        'table': PPTM_HOME / 'skills' / 'ppt-master' / 'templates' / 'tables',
        'diagram': DIAGRAMS_DIR,
    }[domain]
    return base / f'{key}.svg'


def suite_skeletons(keep: bool) -> None:
    """声明即存在：文档里点名的每个骨架都必须真实存在，且能过质检门。"""
    print('\n=== 骨架完整性（声明即存在 + 机械校验）===')
    chart_lib = CHARTS_LIB.read_text(encoding='utf-8')
    diagram_lib = DIAGRAMS_LIB.read_text(encoding='utf-8')

    chart_keys = sorted(set(re.findall(r'`chart/([a-z0-9_]+)`', chart_lib)))
    table_keys = sorted(set(re.findall(r'`table/([a-z0-9_]+)`', chart_lib)))
    diagram_keys = sorted(set(re.findall(r'`diagram/([a-z0-9_]+)`', chart_lib + diagram_lib)))

    check(len(chart_keys) > 0, 'charts-library 解析出 chart key', f'{len(chart_keys)} 个')
    check(len(table_keys) > 0, 'charts-library 解析出 table key', f'{len(table_keys)} 个')
    check(len(diagram_keys) > 0, 'diagrams-library 解析出 diagram key', f'{len(diagram_keys)} 个')

    charts_dir = PPTM_HOME / 'skills' / 'ppt-master' / 'templates' / 'charts'
    tables_dir = PPTM_HOME / 'skills' / 'ppt-master' / 'templates' / 'tables'
    miss = [k for k in chart_keys if not (charts_dir / f'{k}.svg').is_file()]
    check(not miss, 'chart 骨架全部存在于上游', f'缺失 {miss}' if miss else f'{len(chart_keys)} 个')
    miss = [k for k in table_keys if not (tables_dir / f'{k}.svg').is_file()]
    check(not miss, 'table 骨架全部存在于上游', f'缺失 {miss}' if miss else f'{len(table_keys)} 个')
    miss = [k for k in diagram_keys if not (DIAGRAMS_DIR / f'{k}.svg').is_file()]
    check(not miss, 'diagram 骨架全部存在于本 skill', f'缺失 {miss}' if miss else f'{len(diagram_keys)} 个')

    # 图册 atlas 用**裸 key**（前缀由所属章节标题决定），此前完全绕过了上级自检 ——
    # 2026-09-29 修：一并纳入，并强制三份文档的 key 集合完全一致，防止各说各话。
    atlas_map = {}
    if CHARTS_ATLAS.is_file():
        domain = None
        for line in CHARTS_ATLAS.read_text(encoding='utf-8').splitlines():
            head = re.match(r'^## \d\..*?`(chart|table|diagram)/', line)
            if head:
                domain = head.group(1)
            row = re.match(r'^\| `([a-z0-9_]+)` \|', line)
            if row and domain:
                atlas_map[f'{domain}/{row.group(1)}'] = True
        check(len(atlas_map) == 47, '图册列出 47 个骨架', f'实际 {len(atlas_map)} 个')
        miss = [k for k in atlas_map if not _skeleton_file(k).is_file()]
        check(not miss, '图册点名的骨架全部存在于磁盘', f'缺失 {miss}' if miss else f'{len(atlas_map)} 个')

        documented = {f'chart/{k}' for k in chart_keys} | {f'table/{k}' for k in table_keys} \
            | {f'diagram/{k}' for k in diagram_keys}
        check(documented == set(atlas_map), '图册与选型/结构库三处 key 集合完全一致',
              f'仅库有 {sorted(documented - set(atlas_map))[:5]} / 仅图册有 '
              f'{sorted(set(atlas_map) - documented)[:5]}' if documented != set(atlas_map) else '三处一致')

    # 2026-09-29 补：references/styles/ 三份风格包此前**完全不在任何校验范围内**——
    # mbb-consulting 页序表里的 `chart/comparison_matrix` 幻名就是这么存活到今天的
    # （真实 key 是 `table/comparison_matrix`，同文档下一行自己还写对了）。这一层把
    # 风格包点名的骨架、脚本、skill 内路径、章节引用全部纳入「声明即存在」。
    if STYLES_DIR.is_dir():
        packs = sorted(STYLES_DIR.glob('*.md'))
        bad_skel: list[str] = []
        bad_script: list[str] = []
        bad_path: list[str] = []
        bad_ref: list[str] = []
        for pack in packs:
            text = pack.read_text(encoding='utf-8')
            # 右侧反引号必须闭合：否则 `chart/foo_XX` 会被贪婪截成存在的 `chart/foo`
            for domain, key in re.findall(r'`(chart|table|diagram)/([a-z0-9_]+)`', text):
                if not _skeleton_file(f'{domain}/{key}').is_file():
                    bad_skel.append(f'{pack.name}: {domain}/{key}')
            # 补一道宽松兜底：}|（空格）分割、含大写或非法字符的写法也要被抓出来
            for domain, key in re.findall(r'`(chart|table|diagram)/([A-Za-z0-9_]+)`', text):
                if not re.fullmatch(r'[a-z0-9_]+', key):
                    bad_skel.append(f'{pack.name}: {domain}/{key}（key 含非法字符）')
                elif not _skeleton_file(f'{domain}/{key}').is_file():
                    bad_skel.append(f'{pack.name}: {domain}/{key}')
            for name in re.findall(r'`scripts/([a-z_]+\.py)`', text):
                if not (SKILL_DIR / 'scripts' / name).is_file():
                    bad_script.append(f'{pack.name}: scripts/{name}')
            # 宽松兜底：含大写或非常规字符的脚本名也要被抓出来（同样是上述截断漏洞）
            for name in re.findall(r'`?scripts/([A-Za-z0-9_]+\.py)`?', text):
                if not re.fullmatch(r'[a-z_]+\.py', name) or \
                        not (SKILL_DIR / 'scripts' / name).is_file():
                    bad_script.append(f'{pack.name}: scripts/{name}')
            for rel in re.findall(r'`((?:assets|tests|templates)/[^\s`]+\.(?:png|md|svg|pptx))`', text):
                if not (SKILL_DIR / rel).is_file():
                    bad_path.append(f'{pack.name}: {rel}')
            for sec in re.findall(r'(?:档案|模板档案)\s*§(\d+)', text):
                if not re.search(rf'^## {sec}\.', ARCHIVE_MD.read_text(encoding='utf-8'), re.M):
                    bad_ref.append(f'{pack.name}: 档案 §{sec}')
            for sec in re.findall(r'SKILL\.md\s*§(\d+(?:\.\d+)*)', text):
                esc = re.escape(sec)
                if not re.search(rf'^#{{2,3}}\s+{esc}[.\s]', SKILL_MD.read_text(encoding='utf-8'), re.M):
                    bad_ref.append(f'{pack.name}: SKILL.md §{sec}')
        check(bool(packs), 'references/styles/ 存在风格包', f'{len(packs)} 份')
        check(not bad_skel, '风格包点名的骨架全部存在于磁盘',
              f'缺失 {bad_skel}' if bad_skel else f'{len(packs)} 份包的 key 均有效')
        check(not bad_script, '风格包点名的脚本全部存在于 scripts/',
              f'缺失 {bad_script}' if bad_script else '全部命中')
        check(not bad_path, '风格包点名的 skill 内路径全部存在',
              f'缺失 {bad_path}' if bad_path else '全部命中')
        check(not bad_ref, '风格包的章节引用（档案 §N / SKILL.md §N）指向真实章节',
              f'悬空 {bad_ref}' if bad_ref else '全部命中')

    recall = PPTM_SCRIPTS / 'visualization_recall.py'
    if recall.is_file():
        cp = run([sys.executable, str(recall), 'validate']
                 + [f'chart/{k}' for k in chart_keys] + [f'table/{k}' for k in table_keys])
        blob = out_of(cp)
        m = re.search(r'"invalid"\s*:\s*\[(.*?)\]', blob, re.S)
        if m is None:
            invalid = ['<无法解析 validate 输出>']
        else:
            invalid = re.findall(r'"([^"]+)"', m.group(1))
        check(not invalid, '上游选型校验器全部接受（无幻名）',
              f'invalid={invalid}' if invalid else f'{len(chart_keys) + len(table_keys)} 个 key 通过')
    else:
        record(FAIL, '上游选型校验器存在', '未找到 visualization_recall.py')

    if not diagram_keys:
        return
    project = make_project('skel')
    if not check(project is not None and project.is_dir(), '创建骨架校验工作区', str(project)):
        return
    try:
        for i, k in enumerate(diagram_keys, 1):
            shutil.copy2(DIAGRAMS_DIR / f'{k}.svg', project / 'svg_output' / f'd{i:02d}_{k}.svg')
        shutil.copy2(FIXTURES / 'spec_lock.full.md', project / 'spec_lock.md')

        output_path = project / 'skel-export.pptx'
        cp = run([sys.executable, str(EXPORT_SCRIPT), str(project), '--output', str(output_path)])
        text = out_of(cp)
        gate = postflight_gate(text)
        check(gate == 'passed', f'{len(diagram_keys)} 个骨架整体过质检门 quality_gate=passed',
              f'实际 {gate}' if gate != 'passed' else '全部经原生形状编译')
        m = re.search(r'Slides:\s*(\d+)', text)
        check(bool(m) and int(m.group(1)) == len(diagram_keys),
              f'导出页数 = 骨架数 {len(diagram_keys)}', f'实际 {m.group(1) if m else "?"}')
        skipped = re.search(r'skipped\s+(\d+)', text)
        check(bool(skipped) and int(skipped.group(1)) == 0, '无被跳过元素',
              f'skipped={skipped.group(1) if skipped else "?"}')
    finally:
        if project and project.is_dir() and not keep:
            shutil.rmtree(project, ignore_errors=True)
            print(f'  （已清理临时工作区 {project.name}）')


def suite_geometry(keep: bool) -> None:
    """几何一致性：阳性（应通过）+ 阴性（注入错误必须被抓）双向验证。"""
    print('\n=== 几何一致性（数据 ⇄ 标记坐标 · 双向验证）===')
    check(GEOMETRY_SCRIPT.is_file(), '校验器存在', GEOMETRY_SCRIPT.name)
    project = make_project('geom')
    if not check(project is not None and project.is_dir(), '创建工作区', str(project)):
        return
    try:
        svg = project / 'svg_output' / 's01_summary.svg'
        shutil.copy2(FIXTURES / 's01_summary.svg', svg)
        shutil.copy2(FIXTURES / 'spec_lock.full.md', project / 'spec_lock.md')

        cp = run([sys.executable, str(GEOMETRY_SCRIPT), str(project)])
        text = out_of(cp)
        check(cp.returncode == 0, '阳性：几何与数据一致（退出码 0）',
              _last_meaningful(text))
        check('status=ok' in text, '阳性：对象状态 ok',
              re.search(r'object=\S+[^\n]*', text).group(0)[:70] if 'object=' in text else '')

        # 阴性：模拟「改了数没重算几何」——把 3 月柱高改成 100（数据声明仍是 135）
        original = '<rect x="439.5" y="465" width="90" height="135" fill="#266DE7"/>'
        broken = '<rect x="439.5" y="500" width="90" height="100" fill="#266DE7"/>'
        body = svg.read_text(encoding='utf-8')
        if original in body:
            svg.write_text(body.replace(original, broken), encoding='utf-8')
            cp = run([sys.executable, str(GEOMETRY_SCRIPT), str(project)])
            text = out_of(cp)
            check(cp.returncode == 1, '阴性：注入几何错误后必须判失败（退出码 1）',
                  _last_meaningful(text))
            check('status=mismatch' in text and '超出' in text,
                  '阴性：报出 mismatch 及具体偏差',
                  [l.strip() for l in text.splitlines() if l.strip().startswith('!!')][:1] or '')
        else:
            record(FAIL, '阴性：找到用于注入错误的目标柱', '夹具已变更，请更新注入锚点')

        # 恢复后质量门仍应通过（证明分组 + chart-data 不破坏导出）
        shutil.copy2(FIXTURES / 's01_summary.svg', svg)
        output_path = project / 'geom-export.pptx'
        cp = run([sys.executable, str(EXPORT_SCRIPT), str(project), '--output', str(output_path)])
        gate = postflight_gate(out_of(cp))
        check(gate == 'passed', '带 chart-data/chart-plot-area 标记的页面仍过质检门',
              f'实际 {gate}' if gate != 'passed' else 'quality_gate=passed')
    finally:
        if project and project.is_dir() and not keep:
            shutil.rmtree(project, ignore_errors=True)
            print(f'  （已清理临时工作区 {project.name}）')


def suite_layout(keep: bool) -> None:
    """版式适配：阳性（合规夹具通过）+ 阴性（三类空间冲突必须被抓）双向验证。

    覆盖 2026-09-16 真实事故的四类：L1 数值标签压进深色条、L2 文字越出容器边框、
    L4 文字互撞、L5 装饰条直角戳出宿主圆角。阴性测试是这套断言的牙齿——没有它，校验器可能只是永远返回 0。
    """
    print('\n=== 版式适配（文字 ⇄ 容器 · 双向验证）===')
    check(LAYOUT_SCRIPT.is_file(), '校验器存在', LAYOUT_SCRIPT.name)
    project = make_project('layout')
    if not check(project is not None and project.is_dir(), '创建工作区', str(project)):
        return
    try:
        svg_dir = project / 'svg_output'
        for old in svg_dir.glob('*.svg'):
            old.unlink()

        clean = svg_dir / 'l01_clean.svg'
        shutil.copy2(FIXTURES / 'layout_clean.svg', clean)
        cp = run([sys.executable, str(LAYOUT_SCRIPT), str(project)])
        text = out_of(cp)
        check(cp.returncode == 0, '阳性：合规页无冲突（退出码 0）', _last_meaningful(text))
        check('未发现文字空间冲突' in text, '阳性：报告「未发现文字空间冲突」',
              '校验器已扫过干净页')

        defect = svg_dir / 'l02_defect.svg'
        shutil.copy2(FIXTURES / 'layout_defect.svg', defect)
        cp = run([sys.executable, str(LAYOUT_SCRIPT), str(project)])
        text = out_of(cp)
        check(cp.returncode == 1, '阴性：注入四类冲突后必须判失败（退出码 1）',
              _last_meaningful(text))
        check('[L1]' in text and '文字不可读' in text,
              '阴性 L1：报出「深色标签压深色条 → 文字不可读」',
              next((l.strip()[:80] for l in text.splitlines() if l.startswith('[L1]')), ''))
        check('[L2]' in text and '切断' in text,
              '阴性 L2：报出「文字越过容器边框被切断」',
              next((l.strip()[:80] for l in text.splitlines() if l.startswith('[L2]')), ''))
        check('[L4]' in text and '文字互撞' in text,
              '阴性 L4：报出「文字互撞」',
              next((l.strip()[:80] for l in text.splitlines() if l.startswith('[L4]')), ''))
        check('[L5]' in text and '戳出宿主圆角轮廓' in text,
              '阴性 L5：报出「装饰条直角戳出宿主圆角」',
              next((l.strip()[:80] for l in text.splitlines() if l.startswith('[L5]')), ''))
        check('修法：' in text, '阴性：给出可执行的修法（锚点坐标或 range 上限）',
              next((l for l in text.splitlines() if '修法：' in l), '')[:80])
        check('round_accent_strips' in text, '阴性：L5 修法指向批量工具 round_accent_strips.py', '')

        # 只留缺陷页时退出码仍为 1；删掉缺陷页后必须回到 0（证明判定跟随内容而非文件数）
        defect.unlink()
        cp = run([sys.executable, str(LAYOUT_SCRIPT), str(project)])
        check(cp.returncode == 0, '阴性对照：移除缺陷页后恢复退出码 0', _last_meaningful(out_of(cp)))

        # 导出闸门：缺陷页必须让 svg_native_export 直接拒跑
        shutil.copy2(FIXTURES / 'layout_defect.svg', defect)
        shutil.copy2(FIXTURES / 'spec_lock.full.md', project / 'spec_lock.md')
        output_path = project / 'layout-export.pptx'
        cp = run([sys.executable, str(EXPORT_SCRIPT), str(project), '--output', str(output_path)])
        gate = out_of(cp)
        check(cp.returncode != 0 and '版式适配校验 exit=1' in gate,
              '导出闸门：版式冲突页被 svg_native_export 拒绝导出',
              _last_meaningful(gate))
    finally:
        if project and project.is_dir() and not keep:
            shutil.rmtree(project, ignore_errors=True)
            print(f'  （已清理临时工作区 {project.name}）')


def suite_palette(keep: bool) -> None:
    """配色合规：阳性（色板内通过）+ 阴性（色板外颜色必须被抓）。

    覆盖 2026-09-16 真实自查事故：中风险/第二层强调自创琥珀色，全册 7 处越板。
    这一类的特殊性：上游质检、几何校验、版式校验**都看不见颜色**，没有本套件就无人拦。
    """
    print('\n=== 配色合规（色板 ⇄ 页面用色 · 双向验证）===')
    check(PALETTE_SCRIPT.is_file(), '校验器存在', PALETTE_SCRIPT.name)
    project = make_project('palette')
    if not check(project is not None and project.is_dir(), '创建工作区', str(project)):
        return
    try:
        svg_dir = project / 'svg_output'
        for old in svg_dir.glob('*.svg'):
            old.unlink()
        shutil.copy2(FIXTURES / 'spec_lock.full.md', project / 'spec_lock.md')
        clean = svg_dir / 'c01_clean.svg'
        shutil.copy2(FIXTURES / 'layout_clean.svg', clean)
        cp = run([sys.executable, str(PALETTE_SCRIPT), str(project)])
        text = out_of(cp)
        check(cp.returncode == 0 and '落在色板内' in text,
              '阳性：色板内页面通过（退出码 0）', _last_meaningful(text))

        defect = svg_dir / 'c02_defect.svg'
        shutil.copy2(FIXTURES / 'palette_defect.svg', defect)
        cp = run([sys.executable, str(PALETTE_SCRIPT), str(project)])
        text = out_of(cp)
        check(cp.returncode == 1, '阴性：注入色板外颜色必须判失败（退出码 1）', _last_meaningful(text))
        check('VIOLATION' in text and '#EF9F27' in text and '#854F0B' in text,
              '阴性：精确报出越板色值',
              next((l.strip()[:80] for l in text.splitlines() if 'VIOLATION' in l), ''))
        defect.unlink()
        cp = run([sys.executable, str(PALETTE_SCRIPT), str(project)])
        check(cp.returncode == 0, '阴性对照：移除缺陷页后恢复退出码 0', _last_meaningful(out_of(cp)))

        shutil.copy2(FIXTURES / 'palette_defect.svg', defect)
        output_path = project / 'palette-export.pptx'
        cp = run([sys.executable, str(EXPORT_SCRIPT), str(project), '--output', str(output_path)])
        gate = out_of(cp)
        check(cp.returncode != 0 and '配色合规校验 exit=1' in gate,
              '导出闸门：越板色页面被 svg_native_export 拒绝导出', _last_meaningful(gate))

        # 批次闸门隔离（gatecheck.py）：三校验器都是 svg_output/ 全目录扫描，并行派工时
        # 各批必须只验自己那几页。锁 long-doc-deck.md §5 的变异验证（2026-09-30 实装）。
        print('  — 批次隔离（gatecheck.py，大册并行派工专用）—')
        batch = f'zz_selftest_{os.getpid()}'
        cp = run([sys.executable, str(GATECHECK_SCRIPT), str(project),
                  '--pages', 'c01_*', '--batch', batch])
        text = out_of(cp)
        check(cp.returncode == 0, '隔离阳性：同目录里有别人的坏页时，只验本批好页须判通过', _last_meaningful(text))
        check('c01_clean.svg' in text and 'c02_defect' not in text,
              '隔离生效：本批输出只看得到本批页（别人的页未被扫进来）',
              next((l.strip()[:88] for l in text.splitlines() if l.startswith('本批页面')), ''))
        cp = run([sys.executable, str(GATECHECK_SCRIPT), str(project),
                  '--pages', 'c02_*', '--batch', batch])
        text = out_of(cp)
        check(cp.returncode == 1 and 'VIOLATION' in text and '#EF9F27' in text,
              '隔离阴性：点名那张坏页必须被配色闸拦下并原样报出色值', _last_meaningful(text))
        cp = run([sys.executable, str(GATECHECK_SCRIPT), str(project), '--pages', 'c01_*'])
        text = out_of(cp)
        check(cp.returncode == 2 and '--batch' in text,
              '批次名必填：漏传 --batch 直接拒跑（同名会共用临时目录、互相清页，不给静默默认）',
              next((l.strip()[:88] for l in text.splitlines() if l.strip()), ''))
        cp = run([sys.executable, str(GATECHECK_SCRIPT), str(project),
                  '--pages', 'c9_*', '--batch', batch])
        text = out_of(cp)
        check(cp.returncode == 2 and '没命中任何页' in text,
              '模式打错不静默：无命中页时拒跑并列出目录现状（防验了个空目录报全绿）',
              next((l.strip()[:88] for l in text.splitlines() if l.strip().startswith('ERROR')), ''))
    finally:
        if project and project.is_dir() and not keep:
            shutil.rmtree(project, ignore_errors=True)
            print(f'  （已清理临时工作区 {project.name}）')



TABLE_JSON = {
    "tables": [{
        "page": 2, "x": 90, "y": 280, "w": 1100, "h": 300,
        "col_widths": [420, 340, 340], "row_heights": 44,
        "header": ["指标", "当前值", "建议目标（提议值）"],
        "rows": [["考核口径月合计", "8 月 90.60 万元", "9-12 月逐月递减至 65.37"],
                 ["外借报工占月合计比", "46.0%（41.71 / 90.60）", "≤ 26%（12 月 16.48 / 65.37）"],
                 ["收入 / 劳务成本比", "0.40（21.33 / 52.70）", "年内 ≥ 1.00（覆盖变动成本）"],
                 ["未标注人数占比", "8.46%（7-8 月抬头）", "< 2%"]],
        "header_fill": "0C2864", "header_color": "FFFFFF", "header_size": 14,
        "body_color": "0C2864", "body_size": 14, "body_fill": "FFFFFF",
        "align": ["left", "left", "left"], "bold_col0": True,
        "emphasize": {"col": 2, "color": "1B4593"},
        "rule_color": "E4E6EA", "rule_width": 0.75,
    }]
}
TABLE_PAGES = {
    "drop_host_slides": True,
    "pages": [{"src": None, "layout": "封面", "title": "原生表格注入验证", "subtitle": "SVG 留白 → JSON 声明 → 原生可编辑表格"},
              {"src": 0, "layout": "标题", "title": "表格转原生后客户可双击改数", "tag": "验证页"}],
}


def _slide_xml(pptx: Path, idx: int) -> str:
    with zipfile.ZipFile(pptx) as z:
        return z.read(f'ppt/slides/slide{idx}.xml').decode('utf-8', 'ignore')


def suite_table(keep: bool) -> None:
    """原生表格注入：留白页 → 导出 → merge → 注入 → 结构断言。

    锁的是「客户可双击改数」这条能力：必须是真 graphicFrame 表格、必须关掉 python-pptx 的
    默认蓝色主题（否则会把色板外颜色带进交付）、单元格填充必须落在色板内。
    """
    print('\n=== 原生表格注入（SVG 留白 → 原生表格）===')
    check(TABLE_SCRIPT.is_file(), '注入器存在', TABLE_SCRIPT.name)
    project = make_project('table')
    if not check(project is not None and project.is_dir(), '创建工作区', str(project)):
        return
    try:
        dst = project / 'svg_output'
        for old in dst.glob('*.svg'):
            old.unlink()
        shutil.copy2(FIXTURES / 't03_blank_table.svg', dst / 'p02_table.svg')
        shutil.copy2(FIXTURES / 'spec_lock.full.md', project / 'spec_lock.md')
        (project / 'native_tables.json').write_text(
            json.dumps(TABLE_JSON, ensure_ascii=False, indent=2), encoding='utf-8')
        (project / 'pages.json').write_text(
            json.dumps(TABLE_PAGES, ensure_ascii=False, indent=2), encoding='utf-8')

        output_path = project / 'table-export.pptx'
        cp = run([sys.executable, str(EXPORT_SCRIPT), str(project), '--output', str(output_path)])
        text = out_of(cp)
        if not check(cp.returncode == 0 and postflight_gate(text) == 'passed',
                     '留白页导出通过（quality_gate=passed）', _last_meaningful(text)):
            print(text[-1200:]); return
        m = re.search(r'OUTPUT_PPTX:\s*(\S+)', text)
        exported = Path(m.group(1)) if m else None
        if not check(exported is not None and exported.is_file(), '声明的输出路径产出'):
            return
        check(slide_pic_count(exported) == 0, '留白页导出 <p:pic>=0', f'{slide_pic_count(exported)}')

        final = project / 'final.pptx'
        cp = run([sys.executable, str(MERGE_SCRIPT), str(exported), str(TEMPLATE_PPTX),
                  str(final), str(project / 'pages.json')])
        if not check(cp.returncode == 0 and final.is_file(), 'merge_into_template 成功',
                     _last_meaningful(out_of(cp))):
            print(out_of(cp)[-1000:]); return
        check(len(__import__('pptx').Presentation(str(final)).slides) == 2, '合并产物 2 页')

        # 注入前：该页不应有表格对象（证明"留白"成立）
        check('<a:tbl>' not in _slide_xml(final, 2), '注入前该页无表格对象（SVG 确实留白）')

        cp = run([sys.executable, str(TABLE_SCRIPT), str(final), str(project)])
        ok = check(cp.returncode == 0, 'native_table_inject 退出码 0', _last_meaningful(out_of(cp)))

        xml = _slide_xml(final, 2)
        check(ok and '<p:graphicFrame>' in xml and '<a:tbl>' in xml,
              '产出真原生表格（graphicFrame + a:tbl，可双击改数）',
              f"graphicFrame={xml.count('<p:graphicFrame>')}")
        style = re.search(r'<a:tableStyleId>([^<]+)', xml)
        check(style is not None and '2D5ABB26' in style.group(1),
              '已改用 No Style, No Grid（关掉 python-pptx 默认蓝色主题）',
              style.group(1) if style else '(无 tableStyleId)')
        check(xml.count('<a:tr ') == 5, '行数 = 1 表头 + 4 数据 = 5', f"实际 {xml.count('<a:tr ')}")
        cols = re.findall(r'<a:gridCol w="(\d+)"', xml)
        px = [round(int(c) / 9525) for c in cols]
        check(px == [420, 340, 340], '列宽按声明落位（px）', f'实际 {px}')
        used = set(re.findall(r'<a:srgbClr val="([0-9A-F]{6})"', xml))
        palette = {'0C2864', '1B4593', '266DE7', '048AE3', '00D3E4', 'DF203C', '778495', 'E4E6EA', 'FFFFFF'}
        check(used <= palette, '表格用色全部落在色板内', f'越板 {sorted(used - palette)}' if used - palette else '/'.join(sorted(used)))

        # 回归（2026-09-29 测试片 P4 事故）：emphasize 强调色只准染正文行，
        # 表头格必须保持 header_color——否则强调列深蓝字压深蓝底不可读。
        pres = __import__('pptx').Presentation(str(final))
        tbl_frame = next(sh for sh in pres.slides[1].shapes if sh.has_table)

        def _cell_color(cell):
            run = cell.text_frame.paragraphs[0].runs[0]
            return str(run.font.color.rgb)

        check(_cell_color(tbl_frame.table.cell(0, 2)) == 'FFFFFF',
              '强调列表头格保持 header_color 白字（emphasize 不染表头）',
              f'表头实际 {_cell_color(tbl_frame.table.cell(0, 2))}')
        check(_cell_color(tbl_frame.table.cell(1, 2)) == '1B4593',
              '强调列正文格落强调色 1B4593',
              f'正文实际 {_cell_color(tbl_frame.table.cell(1, 2))}')

        cp = run([sys.executable, str(VALIDATE_SCRIPT), str(final)])
        check(cp.returncode == 0 and '未发现触发修复的结构问题' in out_of(cp),
              'validate_pptx 零问题（注入后结构完好）', _last_meaningful(out_of(cp)))
    finally:
        if project and project.is_dir() and not keep:
            shutil.rmtree(project, ignore_errors=True)
            print(f'  （已清理临时工作区 {project.name}）')


HYPERLINK_PAGES = {'drop_host_slides': True, 'pages': [
    {'src': 0, 'layout': '标题', 'title': '超链接夹具（第 1 页）'},
    {'src': 1, 'layout': '标题', 'title': '跳转目标页（第 2 页）'},
]}
SLIDE_RELTYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide'
HYPERLINK_RELTYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink'


def _slide_rels(pptx: Path, idx: int) -> str:
    with zipfile.ZipFile(pptx) as z:
        return z.read(f'ppt/slides/_rels/slide{idx}.xml.rels').decode('utf-8', 'ignore')


def _duplicate_parts(pptx: Path) -> list[str]:
    """包内重名条目——重名意味着 PowerPoint 打开必报"修复"。"""
    with zipfile.ZipFile(pptx) as z:
        seen: dict[str, int] = {}
        for n in z.namelist():
            seen[n] = seen.get(n, 0) + 1
    return sorted(n for n, k in seen.items() if k > 1)


def suite_hyperlink(keep: bool) -> None:
    """原生超链接：整对象同册跳转 + 行内外部链接，穿过 merge 后仍可点。

    锁的是 2026-09-28 修的那个坑：同册跳转在源 pptx 里是指向 slide 部件的**内部关系**，
    merge 时若直接 relate_to(源页部件)，python-pptx 会把源 pptx 那一页连同它的
    layout/master/theme 一起复制进目标包，产生 ppt/slides/slideN.xml 等重名条目，
    PowerPoint 打开必报"修复"。正确做法是按「源页 → 宿主页」映射重映射。
    """
    print('\n=== 原生超链接（同册跳转 + 外部链接 · 穿过 merge 仍可点）===')
    check(MERGE_SCRIPT.is_file(), '脚本存在', MERGE_SCRIPT.name)
    project = make_project('hyperlink')
    if not check(project is not None and project.is_dir(), '创建工作区', str(project)):
        return
    try:
        dst = project / 'svg_output'
        for old in dst.glob('*.svg'):
            old.unlink()
        shutil.copy2(FIXTURES / 'h01_nav.svg', dst / 'p01_nav.svg')
        shutil.copy2(FIXTURES / 'h02_target.svg', dst / 'p02_target.svg')
        shutil.copy2(FIXTURES / 'spec_lock.full.md', project / 'spec_lock.md')
        (project / 'pages.json').write_text(
            json.dumps(HYPERLINK_PAGES, ensure_ascii=False, indent=2), encoding='utf-8')

        output_path = project / 'hyperlink-export.pptx'
        cp = run([sys.executable, str(EXPORT_SCRIPT), str(project), '--output', str(output_path)])
        text = out_of(cp)
        if not check(cp.returncode == 0 and postflight_gate(text) == 'passed',
                     '带超链接页导出通过（quality_gate=passed）', _last_meaningful(text)):
            print(text[-1200:]); return
        m = re.search(r'OUTPUT_PPTX:\s*(\S+)', text)
        exported = Path(m.group(1)) if m else None
        if not check(exported is not None and exported.is_file(), '声明的输出路径产出'):
            return

        final = project / 'final.pptx'
        cp = run([sys.executable, str(MERGE_SCRIPT), str(exported), str(TEMPLATE_PPTX),
                  str(final), str(project / 'pages.json')])
        if not check(cp.returncode == 0 and final.is_file(), 'merge_into_template 成功',
                     _last_meaningful(out_of(cp))):
            print(out_of(cp)[-1000:]); return

        # 核心断言 1：包内不得有重名条目（旧实现污染包的直接证据）
        dup = _duplicate_parts(final)
        check(not dup, '包内无重名条目（源页部件未被复制进目标包）',
              f'重名 {dup}' if dup else '无')

        # 核心断言 2：同册跳转指向宿主册自己的第 2 页
        rels = _slide_rels(final, 1)
        slide_targets = re.findall(
            r'<Relationship[^>]*Type="[^"]*/relationships/slide"[^>]*Target="([^"]+)"', rels)
        check(slide_targets == ['slide2.xml'], '同册跳转指向宿主册第 2 页',
              f'实际 {slide_targets}')
        jump = re.findall(r'<a:hlinkClick[^>]*action="ppaction://hlinksldjump"', _slide_xml(final, 1))
        check(len(jump) >= 1, '跳转锚点落到原生 hlinkClick（可点击）', f'{len(jump)} 个')

        # 核心断言 3：外部链接存活
        ext = re.findall(r'<Relationship[^>]*Type="[^"]*/relationships/hyperlink"[^>]*Target="([^"]+)"',
                         rels)
        check(any(t.startswith('https://') for t in ext), '外部链接关系存活', f'实际 {ext}')

        cp = run([sys.executable, str(VALIDATE_SCRIPT), str(final)])
        check(cp.returncode == 0 and '未发现触发修复的结构问题' in out_of(cp),
              'validate_pptx 零问题（超链接不触发 PowerPoint 修复）', _last_meaningful(out_of(cp)))
    finally:
        if project and project.is_dir() and not keep:
            shutil.rmtree(project, ignore_errors=True)
            print(f'  （已清理临时工作区 {project.name}）')


def suite_recolour(keep: bool) -> None:
    """骨架换色：上游 39 个骨架的原生配色必须能全部映射进公司色板。

    锁的是 2026-09-29 实测的坑：上游 33 chart + 6 table 骨架**全部**带上游样例配色
    （105 种色），没有一种落在中电金信色板内——直接 cp 会被 verify_palette 拒绝
    （实测单页 96 处越板）。recolour_skeleton.py 就是这道转换，本套件保证它对任何
    骨架都能收敛到色板内（上游新增骨架带新色时会被这里抓到）。
    """
    print('\n=== 骨架换色（上游配色 → 公司色板，全部收敛）===')
    sys.path.insert(0, str(SKILL_DIR / 'scripts'))
    try:
        import recolour_skeleton as rc
    except Exception as exc:  # pragma: no cover
        record(FAIL, '导入 recolour_skeleton', str(exc))
        return

    charts_dir = PPTM_HOME / 'skills' / 'ppt-master' / 'templates' / 'charts'
    tables_dir = PPTM_HOME / 'skills' / 'ppt-master' / 'templates' / 'tables'
    pal = set(rc.PALETTES['中电金信'].values()) | {'#FFFFFF'}

    out_dir = Path(tempfile.mkdtemp(prefix='zz_selftest_recolour_'))
    try:
        files = sorted(charts_dir.glob('*.svg')) + sorted(tables_dir.glob('*.svg'))
        check(len(files) >= 39, '上游骨架齐备', f'{len(files)} 个（chart+table）')

        bad, replaced_total = [], 0
        for f in files:
            dst = out_dir / f.name
            rc.recolour(f, dst, rc.PALETTES['中电金信'])
            cols = {'#' + m.upper() for m in rc.HEX_RE.findall(dst.read_text(encoding='utf-8'))}
            off = sorted(cols - pal)
            if off:
                bad.append((f.name, off[:4]))
            replaced_total += len(cols)

        check(not bad, '换色后 39 个骨架零越板（全部落入色板）',
              f'越板骨架 {bad[:3]}' if bad else f'{len(files)} 个骨架用色收敛到色板内')
        check(replaced_total > 0, '换色确实产生了替换（非空转）', f'累计涉及 {replaced_total} 个色位')

        # 显式映射表必须命中：若全部走兜底说明映射表已失效
        upstream_cols = {'#' + m.upper()
                         for f in files for m in rc.HEX_RE.findall(f.read_text(encoding='utf-8'))}
        hit = sum(1 for k in rc.EXPLICIT if k in upstream_cols)
        check(hit >= 15, '显式语义映射表仍覆盖上游高频色', f'命中 {hit} 种（低于 15 说明上游换色系，需更新映射表）')
    finally:
        if out_dir.is_dir() and not keep:
            shutil.rmtree(out_dir, ignore_errors=True)


def _last_meaningful(text: str) -> str:
    for line in reversed([l.strip() for l in text.splitlines() if l.strip()]):
        if line.startswith(('汇总', '结论', '!!')):
            return line[:90]
    return ''


def suite_discipline(keep: bool) -> None:
    """文档写作纪律：`references/doc-writing-discipline.md` 主张的 SSOT 分层与引用
    规范必须机械成立。

    锁的是 2026-09-29 三轮通读总结出的根因——18 处不一致全部源于「同一规则在多份
    文档各抄一遍」+「章节引用不校验」。本套件把纪律文档自己变成可执行项：
      ① SSOT 登记表登记的事实源位置真实存在
      ② 全部 `档案/SKILL.md/xxx.md §N` 引用指向真实章节
      ③ 禁止裸引用（缺文档名的 `见 §N`）
      ④ L2/L3 不得脱离指向复述 L0 数值（色值档位、字号档位）
      ⑤ 每份 references 文档都在 SKILL.md 资产索引登记
    """
    del keep
    print('\n=== 文档写作纪律（SSOT 分层 + 引用可解析）===')
    if not DISCIPLINE_MD.is_file():
        record(FAIL, '纪律文档存在', str(DISCIPLINE_MD))
        return
    check(True, '纪律文档存在', DISCIPLINE_MD.name)

    skill_md = SKILL_MD.read_text(encoding='utf-8')
    archive_md = ARCHIVE_MD.read_text(encoding='utf-8')
    docs: dict[str, str] = {p.name: p.read_text(encoding='utf-8')
                            for p in sorted((SKILL_DIR / 'references').rglob('*.md'))}
    docs['SKILL.md'] = skill_md
    docs['档案'] = archive_md

    def _has_section(text: str, sec: str) -> bool:
        """命中 `## N.` / `### N` / `#### N.N.N` 开头的标题（SKILL.md 用四级标题承载 2.4.x）。"""
        esc = re.escape(sec)
        return bool(re.search(rf'^#{{2,4}}\s+{esc}[.\s]', text, re.M))

    # ① SSOT 登记表里登记的事实源位置必须真实存在
    table_sec = re.search(r'^## 4\..*?$(.*?)(?=^## |\Z)', DISCIPLINE_MD.read_text(encoding='utf-8'),
                          re.S | re.M)
    bad_ssot: list[str] = []
    rows = 0
    if table_sec:
        for line in table_sec.group(1).splitlines():
            cells = [c.strip() for c in line.strip().strip('|').split('|')]
            if len(cells) < 2 or cells[0].startswith('---') or cells[0] == '规则':
                continue
            rows += 1
            for m in re.finditer(r'`([A-Za-z0-9_./<>-]+\.md)`\s*(?:§(\d+(?:\.\d+)*))?', cells[1]):
                name, sec = m.group(1), m.group(2)
                if name.startswith('spec_lock'):
                    continue                           # spec_lock 属项目侧文件，不做存在性校验
                elif name.startswith('templates/') or name == '档案':
                    target = archive_md
                else:
                    cand = SKILL_DIR / 'references' / name
                    if not cand.is_file():
                        cand = SKILL_DIR / name
                    target = cand.read_text(encoding='utf-8') if cand.is_file() else None
                if target is None:
                    continue
                if sec and not _has_section(target, sec):
                    bad_ssot.append(f'{name} §{sec}')
            for m in re.finditer(r'档案 §(\d+(?:\.\d+)*)', cells[1]):
                if not _has_section(archive_md, m.group(1)):
                    bad_ssot.append(f'档案 §{m.group(1)}')
    check(rows >= 8, 'SSOT 登记表解析出足够行数', f'{rows} 行')
    check(not bad_ssot, 'SSOT 登记表登记的事实源位置真实存在',
          f'悬空 {bad_ssot}' if bad_ssot else f'{rows} 行全部命中')

    # ② 全部跨文档章节引用必须指向真实章节
    bad_ref: list[str] = []
    for name, text in docs.items():
        if name == '档案':
            continue
        for m in re.finditer(r'档案\s*§(\d+(?:\.\d+)*)', text):
            if not _has_section(archive_md, m.group(1)):
                bad_ref.append(f'{name}: 档案 §{m.group(1)}')
        for m in re.finditer(r'SKILL\.md\s*§(\d+(?:\.\d+)*)', text):
            if not _has_section(skill_md, m.group(1)):
                bad_ref.append(f'{name}: SKILL.md §{m.group(1)}')
        for m in re.finditer(r'`([a-z0-9_.-]+\.md)\s*§(\d+(?:\.\d+)*)`', text):
            fname, sec = m.group(1), m.group(2)
            cand = SKILL_DIR / 'references' / fname
            if not cand.is_file():
                cand = SKILL_DIR / fname
            if cand.is_file() and not _has_section(cand.read_text(encoding='utf-8'), sec):
                bad_ref.append(f'{name}: {fname} §{sec}')
    check(not bad_ref, '全部跨文档章节引用指向真实章节',
          f'悬空 {bad_ref[:6]}' if bad_ref else f'{len(docs)} 份文档全部命中')

    # ③ 禁止裸引用：`见/参见/详见 §N`（缺文档名，无法判定指向）
    #    豁免反引号内的举例——纪律文档本身要用 `` `见 §2.4` `` 演示「禁止的写法」。
    bare: list[str] = []
    for name, text in docs.items():
        for i, raw in enumerate(text.splitlines(), 1):
            if re.search(r'(?:见|参见|详见|主管部门)\s*§\d', re.sub(r'`[^`]*`', '', raw)):
                bare.append(f'{name}:{i}')
    check(not bare, '无裸章节引用（缺文档名的「见 §N」）',
          f'{bare[:6]}' if bare else '全部引用带文档名')

    # ④ L2/L3 不得脱离指向复述 L0 数值档位。
    #    判据不看连续写法（写成「13（辅助注释）/ 14 / 16」就能绕过），而是数**档位数字
    #    命中个数**：一行出现 ≥3 个 spec_lock 角色值且邻近无指向语境，即判为裸抄档位。
    repeated: list[str] = []
    handled = {'档案', 'SKILL.md'}
    for name, text in docs.items():
        if name in handled or name.endswith('discipline.md'):
            continue
        lines = text.splitlines()
        for i, line in enumerate(lines):
            hits = len(re.findall(r'(?<![0-9.])(?:13|14|16|21|22|24)(?=\s*(?:px|（|/|$|,|、|\)))', line))
            if hits < 3:
                continue
            window = '\n'.join(lines[max(0, i - 1):i + 2])
            if not re.search(r'spec_lock|档案 §|typography|唯一事实源|角色值', window):
                repeated.append(f'{name}:{i + 1}({hits}档)')
    check(not repeated, 'L2/L3 未脱离指向复述字号档位',
          f'{repeated[:6]}' if repeated else '无裸抄的档位串')

    # ⑤ 每份 references 文档都在 SKILL.md 资产索引登记（按其文件名，或按其所在目录）
    unregistered = []
    for name in docs:
        if name in ('SKILL.md', '档案'):
            continue
        rel_dir = None
        for cand in (SKILL_DIR / 'references').rglob(name):
            rel_dir = cand.parent.name
            break
        stem = name[:-3]
        # 已登记 = 文件名被提到，或其所在目录（`references/styles/` 这种整体登记）被提到
        if name in skill_md or stem in skill_md or \
                (rel_dir and f'references/{rel_dir}' in skill_md):
            continue
        unregistered.append(name)
    check(not unregistered, '每份参考文档都在 SKILL.md 资产索引登记',
          f'未登记 {unregistered}' if unregistered else f'{len(docs) - 2} 份全部登记')


def main() -> int:
    if not os.environ.get('PPTM_HOME'):
        raise SystemExit('ERROR: 请设置 PPTM_HOME 指向已校验的 ppt-master 工具链。')
    ap = argparse.ArgumentParser(description='ppt-generation-expert 端到端回归基线')
    ap.add_argument('--suite', choices=['mainline', 'lockless', 'skeletons', 'geometry',
                                                     'layout', 'palette', 'table', 'hyperlink',
                                                     'recolour', 'discipline', 'all'],
                    default='mainline')
    ap.add_argument('--keep', action='store_true', help='保留临时工作区')
    args = ap.parse_args()

    print(f'ppt-generation-expert 自检  |  PPTM_HOME={PPTM_HOME}')
    print(f'解释器 {sys.executable}\n')
    preflight()
    if args.suite in ('mainline', 'all'):
        suite_mainline(args.keep)
    if args.suite in ('lockless', 'all'):
        suite_lockless(args.keep)
    if args.suite in ('skeletons', 'all'):
        suite_skeletons(args.keep)
    if args.suite in ('geometry', 'all'):
        suite_geometry(args.keep)
    if args.suite in ('layout', 'all'):
        suite_layout(args.keep)
    if args.suite in ('palette', 'all'):
        suite_palette(args.keep)
    if args.suite in ('table', 'all'):
        suite_table(args.keep)
    if args.suite in ('hyperlink', 'all'):
        suite_hyperlink(args.keep)
    if args.suite in ('recolour', 'all'):
        suite_recolour(args.keep)
    if args.suite in ('discipline', 'all'):
        suite_discipline(args.keep)

    n_pass = sum(1 for s, _, _ in _results if s == PASS)
    n_fail = sum(1 for s, _, _ in _results if s == FAIL)
    n_known = sum(1 for s, _, _ in _results if s == KNOWN)
    print('\n=== 汇总 ===')
    print(f'  通过 {n_pass} · 失败 {n_fail} · 已知缺陷 {n_known}')
    if n_known:
        print('  已知缺陷（不阻塞，修复后自动转 PASS）：')
        for s, name, detail in _results:
            if s == KNOWN:
                print(f'    - {name}｜{detail}')
    if n_fail:
        print('  失败项：')
        for s, name, detail in _results:
            if s == FAIL:
                print(f'    - {name}｜{detail}')
    print('\n结论：' + ('主链路全绿' if not n_fail else '存在阻塞失败，见上'))
    return 1 if n_fail else 0


if __name__ == '__main__':
    raise SystemExit(main())
