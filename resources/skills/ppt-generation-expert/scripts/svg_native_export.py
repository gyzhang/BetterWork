#!/usr/bin/env python3
# svg_native_export.py — 模式 E：把工作区的规范化 SVG 编译为原生可编辑形状 PPTX
# 用途: 由 BetterWork 按 betterwork.skill.json 的参数契约调用此脚本。
# 离线用法: python3 svg_native_export.py <project_dir> --output <output.pptx> [--skip-verify]
#   <project_dir>  BetterWork `project-init` 返回的工作区，svg_output/ 内已有按合同编写的 SVG。
#   --skip-verify  临时跳过版式适配 / 数据几何校验（仅排障用，交付前须补跑）。
# 本脚本封装四步：自动补 spec_lock（缺失时）→ 版式适配+数据几何校验（强制）
#                → final 质检（强制）→ svg_to_pptx 导出。
# 受管运行时由 BetterWork 提供 Python 与工具链环境；不要让 Run 用户执行这些 CLI 示例。
# 离线维护时若宿主注入 PYTHONPATH shim，本脚本会剥离该环境变量后重执行自身。
# ppt-master 定位：BetterWork 通过已绑定工具链注入 PPTM_HOME；离线维护也必须显式设置。
import os, sys, json, subprocess, re, shutil, time

PPTM_HOME = os.environ.get('PPTM_HOME')
SCRIPTS = os.path.join(PPTM_HOME, 'skills', 'ppt-master', 'scripts') if PPTM_HOME else ''

# 上游 exporter 的装配脚手架目录名（builder.py: _create_writable_work_dir）
BUILD_DIR_RE = re.compile(r'^\.pptx-build-\d+-[0-9a-f]{32}$')

DEFAULT_LOCK = {
    # primary_language 必须 BCP-47（zh-Hans，不是 zh-CN）——见 SKILL.md 铁律 6 / svg-native-guide §6
    'primary_language': 'zh-Hans', 'mode': 'quick',
    # consumption_mode 取上游枚举 text/balanced/presentation；scaffold 里是 [fill]，不填会残留模板令牌
    'consumption_mode': 'balanced',
    'visual_style': '中电金信公司模板 · 商务蓝 · 高密度信息图解',
    'font_family': 'Microsoft YaHei', 'title_family': 'Microsoft YaHei',
    'body_family': 'Microsoft YaHei', 'body': '14', 'title': '22',
    # icons / page_rhythm 是内容规划阶段的产出；未规划时留空（不得残留 [fill] 令牌）
    'library': 'tabler-filled', 'inventory': '', 'P01': '内容页',
}

# 中电金信模板 colors 标准块（模板档案 §2.1，直接拷贝，勿改角色名/顺序）。
# 上游 scaffold 只给 bg/primary/accent/text 四个键，不足且带 text: 角色——必须整块替换：
#   text: 角色恒锁 dk1 黑，用它锁藏蓝会被渲染成纯黑（铁律 8 明令禁止）；
#   其余角色按声明顺序前 2 名占 accent5/accent6，故 navy/risk 必须排在前两位且值与模板一致。
TEMPLATE_COLORS = """## colors
- bg: #FFFFFF
- primary: #1B4593
- accent: #266DE7
- secondary_accent: #048AE3
- border: #00D3E4
- text_secondary: #778495
- navy: #0C2864
- risk: #DF203C
- panel: #E4E6EA
"""


def _replace_section(text, heading, block):
    """把 spec_lock 中 <heading> 到下一个 ## 之间的内容整体替换为 block。"""
    start = text.find(heading + '\n')
    if start < 0:
        return text.rstrip('\n') + '\n\n' + block
    end = text.find('\n## ', start + 1)
    if end < 0:
        end = len(text)
    return text[:start] + block + text[end:]


def _print_captured_output(label, output, limit=4000):
    text = (output or '').strip()
    if text:
        print(f'[{label}]\n{text[-limit:]}', file=sys.stderr)


def ensure_spec_lock(project):
    """缺失 spec_lock.md 时用 scaffold 生成并填默认值（typography 必须纯数字 px）。"""
    lock = os.path.join(project, 'spec_lock.md')
    if os.path.exists(lock):
        return
    try:
        result = subprocess.run([sys.executable, os.path.join(SCRIPTS, 'project_manager.py'),
                                 'scaffold-lock', project], capture_output=True, text=True,
                                check=True)
    except subprocess.CalledProcessError as error:
        print(f'[LOCK][ERROR] scaffold-lock 失败，exit={error.returncode}', file=sys.stderr)
        _print_captured_output('scaffold-lock stdout', error.stdout)
        _print_captured_output('scaffold-lock stderr', error.stderr)
        raise SystemExit(
            'ERROR: 无法自动生成 spec_lock.md。确认底层原因后，可按本 Skill 的 spec-lock-fallback.md 创建完整锁再重试。'
        ) from error
    if not os.path.isfile(lock):
        print('[LOCK][ERROR] scaffold-lock 未创建 spec_lock.md', file=sys.stderr)
        _print_captured_output('scaffold-lock stdout', result.stdout)
        _print_captured_output('scaffold-lock stderr', result.stderr)
        raise SystemExit('ERROR: scaffold-lock 未生成 spec_lock.md；请检查底层输出后再继续。')
    s = open(lock, encoding='utf-8').read()
    for k, v in DEFAULT_LOCK.items():
        s = re.sub(rf'(- {k}: )\[fill\]', rf'\g<1>{v}', s)
    s = _replace_section(s, '## colors', TEMPLATE_COLORS)
    s = re.sub(r'(?m)[ \t]+$', '', s)
    with open(lock, 'w', encoding='utf-8') as f:
        f.write(s)
    left = s.count('[fill]')
    if left:
        print(f'[LOCK][WARN] 仍有 {left} 处 [fill] 令牌未替换——内容规划阶段需补真实值')
    print('[LOCK] 已生成并填充 spec_lock.md（quick / flat / 公司模板配色标准块）')


def run_final_check(project):
    checker = os.path.join(SCRIPTS, 'svg_quality_checker.py')
    r = subprocess.run([sys.executable, checker, project,
                        '--canonical-authoring', '--stage', 'final', '--json'],
                       capture_output=True, text=True)
    report = os.path.join(project, 'validation', 'svg_quality_report.json')
    if r.returncode != 0 or not os.path.exists(report):
        print(f'[CHECK][ERROR] final 质检 exit={r.returncode}; report_exists={os.path.exists(report)}',
              file=sys.stderr)
        _print_captured_output('svg_quality_checker stdout', r.stdout)
        _print_captured_output('svg_quality_checker stderr', r.stderr)
        sys.exit('ERROR: final 质检未通过或未生成报告，导出被拒绝。按上述诊断修复后再重试。')
    data = json.load(open(report, encoding='utf-8'))
    issues = data.get('issues') or []
    errors = [i for i in issues if str(i.get('severity', '')).lower() in ('error', 'fatal')]
    if errors:
        for e in errors[:8]:
            print('ERROR:', e.get('message', e))
        sys.exit(f'ERROR: 质检发现 {len(errors)} 个错误，导出被拒绝。')
    print(f'[CHECK] final 质检通过：报告 {report}')


def run_embedded_verify(project):
    """导出前跑本 skill 的三项静态校验（配色 → 版式适配 → 数据几何）。

    为什么必须挡在导出前：上游 final 质检只验「SVG 合同与声明的 bounds」，这三类都验不出——
    色板外颜色（模板档案明令禁止）、文字压在深色条上不可读、文字被卡片下边框切断，
    它们的 SVG 语法完全合法、元素也都在 bounds 内，只有在 PowerPoint 里渲染出来才看得见。
    2026-09-16 真实事故：4 页数值标签压进深蓝条、3 张卡片末行被下边框横穿、7 处自创色越板。
    --skip-verify 可临时跳过（排障用），但交付前必须补跑。
    """
    here = os.path.dirname(os.path.abspath(__file__))
    for name, label in (('verify_palette.py', '配色合规'),
                        ('verify_layout.py', '版式适配'),
                        ('verify_geometry.py', '数据几何')):
        script = os.path.join(here, name)
        if not os.path.isfile(script):
            print(f'[VERIFY][WARN] 未找到 {name}，跳过{label}校验')
            continue
        env = dict(os.environ)
        env.pop('PYTHONPATH', None)
        r = subprocess.run([sys.executable, script, project], capture_output=True,
                           text=True, env=env)
        out = ((r.stdout or '') + (r.stderr or '')).strip()
        tail = [ln for ln in out.splitlines() if ln.strip()][-6:]
        print(f'[VERIFY] {label}校验 exit={r.returncode}')
        for ln in tail:
            print('    ' + ln)
        if r.returncode != 0:
            sys.exit(f'ERROR: {label}校验未通过，导出被拒绝。按上面清单修 svg_output/ 后重试'
                     f'（临时排障可加 --skip-verify）。')
    print('[VERIFY] 配色合规 + 版式适配 + 数据几何 全部通过')


def sweep_stale_build_dirs(project, max_age_sec=600):
    """清扫上游 exporter 被中断后残留的 .pptx-build-* 装配脚手架目录。

    上游在 `finally: shutil.rmtree(temp_dir)` 里清理，进程被 Ctrl-C / kill 杀掉时来不及执行，
    于是残渣留在工作目录。上游 `_create_writable_work_dir` 的候选顺序是
    [输出文件所在目录, 当前工作目录, 系统临时目录]，**第一个恒胜**，所以正常都落在
    `<project>/exports/` 下——本函数只扫这一个目录，绝不触碰 cwd 或系统临时目录。
    跳过 max_age_sec 内的新目录，避免与并发运行的导出抢目录。
    """
    exports = os.path.join(project, 'exports')
    if not os.path.isdir(exports):
        return
    now = time.time()
    removed = 0
    for name in os.listdir(exports):
        path = os.path.join(exports, name)
        if not (BUILD_DIR_RE.match(name) and os.path.isdir(path)):
            continue
        try:
            if now - os.path.getmtime(path) < max_age_sec:
                continue
        except OSError:
            continue
        shutil.rmtree(path, ignore_errors=True)
        removed += 1
    if removed:
        print(f'[SWEEP] 清理 {removed} 个中断残留的 .pptx-build-* 目录（上游装配脚手架）')


def run_export(project, output_path):
    sweep_stale_build_dirs(project)
    exporter = os.path.join(SCRIPTS, 'svg_to_pptx.py')
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    r = subprocess.run([sys.executable, exporter, project, '-o', output_path],
                       capture_output=True, text=True)
    out = (r.stdout or '') + (r.stderr or '')
    if r.returncode != 0 or 'Saved:' not in out or not os.path.isfile(output_path):
        print(f'[EXPORT][ERROR] svg_to_pptx exit={r.returncode}', file=sys.stderr)
        _print_captured_output('svg_to_pptx stdout', r.stdout)
        _print_captured_output('svg_to_pptx stderr', r.stderr)
        sys.exit('ERROR: 导出未成功产出 PPTX。先依据上述输出定位并修复，不要原样重试。')
    print(out[-1800:])
    if os.path.getmtime(output_path) < os.path.getmtime(os.path.join(project, 'svg_output')):
        sys.exit('ERROR: 最新 PPTX 早于 svg_output 修改时间，导出可能未真正执行，请重跑。')
    print('OUTPUT_PPTX:', output_path)
    return output_path


def main():
    # 防御离线维护环境中可能注入的 sitecustomize shim；BetterWork 受管执行会清理 PYTHONPATH。
    if 'sitecustomize' in os.environ.get('PYTHONPATH', '') or 'WorkBuddy' in os.environ.get('PYTHONPATH', ''):
        env = dict(os.environ)
        env.pop('PYTHONPATH', None)
        os.execve(sys.executable, [sys.executable] + sys.argv, env)
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('project_dir')
    parser.add_argument('--output', required=True)
    parser.add_argument('--skip-verify', action='store_true')
    args = parser.parse_args()
    skip_verify = args.skip_verify
    project = os.path.abspath(args.project_dir)
    output_path = os.path.abspath(args.output)
    if not os.path.isdir(os.path.join(project, 'svg_output')):
        raise SystemExit(f'ERROR: {project} 缺少 svg_output/。请检查本次 project-init 返回的项目目录。')
    if not PPTM_HOME or not os.path.isdir(SCRIPTS):
        raise SystemExit('ERROR: 当前运行环境未绑定 PPT Master 工具链。'
                         '当前运行环境未提供所需工具链；不要在 Run 中自行安装或设置系统路径。')
    ensure_spec_lock(project)
    if skip_verify:
        print('[VERIFY][WARN] 已按 --skip-verify 跳过配色合规 + 版式适配 + 数据几何三项校验'
              '（排障用，交付前必须补跑）')
    else:
        run_embedded_verify(project)
    run_final_check(project)
    run_export(project, output_path)
    print('[NEXT] 使用本次命令返回的 PPTX outputId 调用 template-merge 合并公司模板版式。')


if __name__ == '__main__':
    main()
