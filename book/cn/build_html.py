#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把合并后的 markdown 书稿构建为单文件、离线可读、SVG 内联的 HTML 阅读版。

用法:  /opt/miniconda3/bin/python3 build_html.py
输入:  Vibe时代的软件工程（2026全新版）.md  +  svg/*.svg
输出:  Vibe时代的软件工程（2026全新版）.html   （自包含，无外部依赖）
"""
import os
import re
import html as H

import markdown

ROOT = os.path.dirname(os.path.abspath(__file__))
MD_NAME = "智能体工程：从一次工具调用到可交付的系统.md"
OUT_NAME = "智能体工程：从一次工具调用到可交付的系统.html"
MD = os.path.join(ROOT, MD_NAME)
SVGDIR = os.path.join(ROOT, "svg")
OUT = os.path.join(ROOT, OUT_NAME)

BOOK_TITLE = "智能体工程"
BOOK_SUB = "从一次工具调用到可交付的系统"
DRAFT_LINE = "全稿 · 2026 年 9 月 18 日"
AUTHOR_LINE = "Kevin + AI"

# ---------------------------------------------------------------- 1. 读入并剥离封面块
src = open(MD, encoding="utf-8").read()

m = re.match(r'\s*<div align="center">(.*?)</div>\s*', src, re.S)
cover_inner = m.group(1) if m else ""
src = src[m.end():] if m else src

if cover_inner:
    t = re.search(r'^#\s*(.+)$', cover_inner, re.M)
    if t:
        BOOK_TITLE = t.group(1).strip()
    for line in cover_inner.splitlines():
        line = line.strip()
        if line.startswith("**") and line.endswith("**") and "草稿" in line:
            DRAFT_LINE = line.strip("*").strip()
        elif line.startswith("**") and line.endswith("**") and "当代码" in line:
            BOOK_SUB = line.strip("*").strip()
        elif line and not line.startswith("<") and not line.startswith("#") and not line.startswith("**"):
            AUTHOR_LINE = line

# ---------------------------------------------------------------- 2. markdown -> html
md = markdown.Markdown(
    extensions=["tables", "fenced_code", "sane_lists", "toc"],
    extension_configs={"toc": {"toc_depth": "1-3", "anchorlink": False}},
)
body = md.convert(src)

# ---------------------------------------------------------------- 3. 图片 -> 内联 SVG
def inline_svg(name):
    s = open(os.path.join(SVGDIR, name + ".svg"), encoding="utf-8").read()
    s = re.sub(r'\s*data-pptx-[a-z-]+="[^"]*"', '', s)
    s = s.replace(' width="1280" height="720"', '')
    s = s.replace(' width="1200" height="1800"', '')
    slug = name.replace('_', '-')
    # 图内分组 id 在 39 张图之间大量重名（fig-header / fig-conclusion / fig-table …）。
    # 内联前一律加图名前缀；已确认全部 SVG 内不存在 url(#...) 引用，重命名安全。
    s = re.sub(r'id="([^"]+)"',
               lambda mm: 'id="%s__%s"' % (slug, mm.group(1)), s)
    s = s.replace("<svg ", '<svg role="img" aria-label="%s" ' % name, 1)
    return s


def caption_for(name, alt):
    # 正文中的 alt 通常已含"图 N-M"前缀，先剥掉，避免图注出现"图 1-1　图 1-1 …"
    alt = re.sub(r'^\s*图\s*\d+-\d+\s*', '', alt).strip()
    mm = re.match(r'fig-(\d+)-(\d+)-', name)
    if mm:
        return "图 %s-%s　%s" % (mm.group(1), mm.group(2), alt)
    mm = re.match(r'fig-e-(\d+)-', name)
    if mm:
        return "图 E-%s　%s" % (mm.group(1), alt)
    return alt


FIG_ORDER = []


def repl_img(mm):
    name, alt = mm.group(1), mm.group(2)
    if name.startswith("cover"):
        return ""  # 封面已单独处理
    cap = caption_for(name, alt)
    FIG_ORDER.append((name, cap))
    return (
        '\n<figure class="fig" id="%s">'
        '<div class="fig-inner" title="点击放大">%s</div>'
        '<figcaption><span class="fignum">%s</span></figcaption>'
        '</figure>\n'
    ) % (name, inline_svg(name), H.escape(cap))


body = re.sub(r'<img src="images/([\w\-.]+)\.png"[^>]*?alt="([^"]*)"[^>]*?/?>', repl_img, body)
body = re.sub(r'<p>\s*</p>', '', body)

# ---------------------------------------------------------------- 4. 表格包裹（便于横向滚动）
body = body.replace('<table>', '<div class="tbl"><table>').replace('</table>', '</table></div>')

# ---------------------------------------------------------------- 5. 标题加类名
def add_cls(mm):
    lvl, hid, text = mm.group(1), mm.group(2), mm.group(3)
    plain = re.sub(r'<[^>]+>', '', text)
    cls = "h-sub" if lvl == "3" else ("h-sec" if lvl == "2" else "h-part")
    if lvl == "1":
        if re.match(r'^第[一二三四五六七八九十]+章', plain):
            cls = "h-chap"
        elif re.match(r'^第[一二三四五六七八九十]+篇', plain):
            cls = "h-part"
    return '<h%s class="%s" id="%s">%s</h%s>' % (lvl, cls, hid, text, lvl)


body = re.sub(r'<h([123]) id="([^"]+)">(.*?)</h\1>', add_cls, body, flags=re.S)

# 5.1 重写为可读锚点（默认 slug 会把中文全部丢掉，产生 #13 这类无意义 id）
def slug_of(text):
    t = re.sub(r'<[^>]+>', '', text).replace('&amp;', '&')
    t = re.sub(r'[^\w\u4e00-\u9fff.]', '', t, flags=re.UNICODE)
    return t.lower() or 'h'


_seen = {}


def reid(mm):
    lvl, cls, text = mm.group(1), mm.group(2), mm.group(4)
    base = slug_of(text)
    n = _seen.get(base, 0)
    _seen[base] = n + 1
    new = base if n == 0 else '%s-%d' % (base, n)
    return '<h%s class="%s" id="%s">%s</h%s>' % (lvl, cls, new, text, lvl)


body = re.sub(r'<h([123]) class="([^"]+)" id="([^"]+)">(.*?)</h\1>', reid, body, flags=re.S)

# ---------------------------------------------------------------- 6. 目录
heads = re.findall(r'<h([123]) class="([^"]+)" id="([^"]+)">(.*?)</h\1>', body, re.S)
toc_items = []
for lvl, cls, hid, text in heads:
    plain = re.sub(r'<[^>]+>', '', text).strip()
    plain = plain.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
    toc_items.append((int(lvl), cls, hid, plain))

toc_html = "\n".join(
    '<a class="toc-l%d %s" href="#%s" data-t="%s">%s</a>'
    % (lvl, cls, hid, H.escape(plain.lower(), quote=True), H.escape(plain))
    for lvl, cls, hid, plain in toc_items
)

fig_index = "\n".join(
    '<a class="toc-fig" href="#%s">%s</a>' % (n, H.escape(c)) for n, c in FIG_ORDER
)

# ---------------------------------------------------------------- 7. 统计
plain_all = re.sub(r'<[^>]+>', '', re.sub(r'<figure.*?</figure>', '', body, flags=re.S))
cj = len(re.findall(r'[\u4e00-\u9fff]', plain_all))
total_chars = len(re.sub(r'\s', '', plain_all))
# 不提供"预计阅读时间"：那是一个用虚构速度除出来的数字。
# 一本有大量代码、表格与配图的技术书，阅读速度因人因章差异极大，任何单一数字都是假的。
# 改为给读者一个可数的结构事实：正文里有多少段代码、多少张表。
n_code = body.count('<pre>')
n_table = body.count('<table>')

CSS = """
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;scroll-behavior:smooth;--sw:312px}
html[data-theme="paper"]{
  --bg:#F4F7FB; --paper:#FFFFFF; --panel:#F7FAFD; --side:#F7FAFD;
  --ink:#1F2937; --ink-soft:#475569; --head:#0C2864; --head2:#2064AE;
  --muted:#7B8CA0; --line:#E3EBF4; --accent:#08A6F6;
  --code-bg:#F4F8FC; --code-line:#E0E9F3; --th-bg:#0C2864; --th-ink:#fff;
  --quote-bg:#F1F6FC; --fig-bg:#FFFFFF; --shadow:0 1px 2px rgba(12,40,100,.05),0 8px 24px rgba(12,40,100,.06);
}
html[data-theme="night"]{
  --bg:#0C1119; --paper:#131B26; --panel:#18222F; --side:#141C27;
  --ink:#D8E1EC; --ink-soft:#AAB8C8; --head:#9CC2EE; --head2:#7FB2E8;
  --muted:#8494A8; --line:#26323F; --accent:#3FB6F5;
  --code-bg:#19222E; --code-line:#26323F; --th-bg:#1E2C3F; --th-ink:#DCE6F2;
  --quote-bg:#17222F; --fig-bg:#FFFFFF; --shadow:0 1px 2px rgba(0,0,0,.3),0 8px 24px rgba(0,0,0,.35);
}
body{
  margin:0;background:var(--bg);color:var(--ink);
  font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Source Han Sans SC",sans-serif;
  font-size:var(--fs,17px);line-height:1.95;letter-spacing:.012em;
  text-rendering:optimizeLegibility;
}
/* ---------- 顶栏 ---------- */
#topbar{
  position:fixed;left:0;right:0;top:0;height:52px;z-index:60;
  display:flex;align-items:center;gap:12px;padding:0 16px;
  background:color-mix(in srgb,var(--paper) 88%,transparent);
  backdrop-filter:saturate(160%) blur(10px);
  border-bottom:1px solid var(--line);
}
#topbar .tb-title{font-weight:700;color:var(--head);font-size:.95em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.chip{display:inline-block;padding:1px 8px;border-radius:999px;font-size:.72em;font-weight:700;
  background:#DF203C;color:#fff;letter-spacing:.06em;vertical-align:2px}
.tb-tools{margin-left:auto;display:flex;gap:6px;align-items:center}
.tb-tools button{
  font:inherit;font-size:.8em;padding:5px 10px;border-radius:8px;cursor:pointer;
  border:1px solid var(--line);background:var(--panel);color:var(--ink-soft);
  transition:.15s;
}
.tb-tools button:hover{border-color:var(--head2);color:var(--head2)}
#menuBtn{display:none}
/* ---------- 进度条 ---------- */
#progress{position:fixed;top:0;left:0;height:3px;width:0;z-index:80;
  background:linear-gradient(90deg,#2064AE,#08A6F6);transition:width .1s linear}
/* ---------- 侧栏 ---------- */
#side{
  position:fixed;left:0;top:52px;bottom:0;width:var(--sw);z-index:50;
  background:var(--side);border-right:1px solid var(--line);
  overflow-y:auto;overscroll-behavior:contain;padding:14px 10px 60px;
}
#side::-webkit-scrollbar{width:8px}
#side::-webkit-scrollbar-thumb{background:var(--line);border-radius:8px}
#q{
  width:100%;font:inherit;font-size:.82em;padding:7px 10px;margin-bottom:10px;
  border:1px solid var(--line);border-radius:8px;background:var(--paper);color:var(--ink);
}
#q:focus{outline:2px solid var(--accent);outline-offset:-1px}
#nav{display:flex;flex-direction:column;gap:1px}
#nav a{
  display:flex;align-items:center;gap:2px;text-decoration:none;color:var(--ink-soft);border-radius:7px;
  padding:5px 9px;font-size:.83em;line-height:1.55;border-left:3px solid transparent;
}
#nav a .t{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#nav a:hover{background:var(--panel);color:var(--head2)}
#nav a.h-part{font-weight:700;color:var(--head);margin-top:9px;letter-spacing:.04em}
#nav a.h-chap{font-weight:700;color:var(--head);margin-top:9px}
#nav a.toc-l2{padding-left:20px}
#nav a.toc-l3{padding-left:32px;font-size:.79em;color:var(--muted)}
#nav a.active{background:var(--panel);border-left-color:var(--accent);color:var(--head2);font-weight:600}
#side details{margin-top:16px;border-top:1px solid var(--line);padding-top:10px}
#side summary{cursor:pointer;font-size:.8em;font-weight:700;color:var(--head2);padding:4px 2px}
#side .toc-fig{display:block;font-size:.77em;color:var(--muted);text-decoration:none;padding:3px 9px;border-radius:6px}
#side .toc-fig:hover{background:var(--panel);color:var(--head2)}
/* ---------- 正文 ---------- */
#wrap{margin-left:var(--sw);padding:52px 0 0}
main{
  max-width:880px;margin:0 auto;background:var(--paper);
  padding:44px 56px 120px;min-height:100vh;box-shadow:var(--shadow);
}
h1,h2,h3{line-height:1.4;letter-spacing:.01em}
h1.h-part{
  font-size:1.55em;margin:2.6em 0 1.1em;padding:14px 20px;border-radius:10px;
  background:linear-gradient(100deg,#0C2864,#2064AE);color:#fff;
}
h1.h-chap{
  font-size:1.72em;margin:2.2em 0 1em;padding-bottom:.45em;color:var(--head);
  border-bottom:2px solid var(--head);
}
h1.h-part:first-of-type,h1.h-chap:first-of-type{margin-top:.6em}
h2.h-sec{
  font-size:1.22em;margin:2.2em 0 .7em;padding-left:12px;color:var(--head2);
  border-left:4px solid var(--accent);
}
h3.h-sub{font-size:1.05em;margin:1.8em 0 .5em;color:var(--head)}
h1,h2,h3{scroll-margin-top:70px}
p{margin:0 0 1.05em}
strong{font-weight:700;color:var(--head)}
em{font-style:normal;color:var(--ink-soft)}
a{color:var(--head2)}
hr{border:0;border-top:1px solid var(--line);margin:2.6em 0}
ul,ol{margin:0 0 1.1em;padding-left:1.5em}
li{margin:.3em 0}
blockquote{
  margin:1.4em 0;padding:14px 20px;background:var(--quote-bg);
  border-left:4px solid var(--head2);border-radius:0 8px 8px 0;color:var(--head);
}
blockquote p{margin:0}
blockquote p+p{margin-top:.5em}
code{
  font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;
  font-size:.87em;background:var(--code-bg);border:1px solid var(--code-line);
  border-radius:4px;padding:.1em .36em;color:var(--head2);
}
pre{
  background:var(--code-bg);border:1px solid var(--code-line);border-radius:10px;
  padding:14px 16px;overflow-x:auto;margin:1.3em 0;
}
pre code{background:none;border:0;padding:0;color:var(--ink-soft);font-size:.83em;line-height:1.75;white-space:pre}
.tbl{overflow-x:auto;margin:1.3em 0;border:1px solid var(--line);border-radius:10px}
.tbl table{border-collapse:collapse;width:100%;font-size:.87em;line-height:1.7}
.tbl th{background:var(--th-bg);color:var(--th-ink);text-align:left;padding:9px 12px;font-weight:600;white-space:nowrap}
.tbl td{padding:9px 12px;border-top:1px solid var(--line);vertical-align:top}
.tbl tr:nth-child(even) td{background:var(--code-bg)}
.tbl td:first-child{color:var(--head);font-weight:600}
/* ---------- 配图 ---------- */
figure.fig{margin:2em 0;padding:0}
.fig-inner{
  background:var(--fig-bg);border:1px solid var(--line);border-radius:12px;
  overflow:hidden;cursor:zoom-in;transition:.18s;
}
.fig-inner:hover{box-shadow:var(--shadow);transform:translateY(-1px);border-color:var(--head2)}
.fig-inner svg{display:block;width:100%;height:auto}
html[data-theme="night"] .fig-inner{filter:invert(1) hue-rotate(180deg)}
figcaption{margin-top:.6em;text-align:center;font-size:.8em;color:var(--muted);line-height:1.6}
figcaption .fignum{color:var(--head2);font-weight:600}
/* ---------- 封面与题头 ---------- */
.hero{
  border:1px solid var(--line);border-radius:14px;overflow:hidden;margin:0 0 26px;
  background:var(--panel);
}
.hero .hero-cv{max-width:400px;margin:0 auto;padding:18px}
.hero .hero-cv svg{display:block;width:100%;height:auto}
html[data-theme="night"] .hero .hero-cv{filter:invert(1) hue-rotate(180deg)}
.hero-meta{padding:0 22px 20px;text-align:center}
.hero-meta h1{font-size:1.9em;margin:.5em 0 .35em;color:var(--head)}
.hero-meta .sub{font-size:1.02em;color:var(--head2);font-weight:600;margin:0 0 .7em}
.hero-meta .ver{font-size:.85em;color:var(--muted);margin:0}
.draftbar{
  margin:0 0 22px;padding:12px 16px;border-radius:10px;font-size:.85em;
  background:#FDF3E3;border:1px solid #E8C79A;color:#8A5A0B;
}
html[data-theme="night"] .draftbar{background:#2A2113;border-color:#5A451F;color:#E2B96B}
.stats{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin:14px 0 0}
.stats span{font-size:.78em;color:var(--ink-soft);background:var(--paper);border:1px solid var(--line);
  padding:3px 10px;border-radius:999px}
.hint{font-size:.8em;color:var(--muted);margin:12px 0 0;line-height:1.7}
/* ---------- 放大层 ---------- */
#lb{
  position:fixed;inset:0;z-index:100;display:none;background:rgba(6,14,26,.93);
  overflow:auto;padding:56px 24px;
}
#lb.on{display:block}
#lb .lb-in{width:min(94vw,1500px);margin:0 auto}
#lb svg{display:block;width:100%;height:auto;background:#fff;border-radius:10px}
#lb .lb-cap{color:#CBD9E8;text-align:center;font-size:.85em;margin-top:12px}
#lb .lb-x{
  position:fixed;top:14px;right:18px;width:38px;height:38px;border-radius:50%;
  border:1px solid rgba(255,255,255,.35);background:rgba(255,255,255,.1);color:#fff;
  font-size:19px;line-height:1;cursor:pointer;
}
#toTop{
  position:fixed;right:20px;bottom:24px;z-index:70;display:none;
  width:42px;height:42px;border-radius:50%;cursor:pointer;
  border:1px solid var(--line);background:var(--paper);color:var(--head2);
  box-shadow:var(--shadow);font-size:16px;
}
#toTop.on{display:block}
#mask{position:fixed;inset:0;background:rgba(6,14,26,.5);z-index:45;display:none}
#mask.on{display:block}
/* ---------- 侧栏收起 / 沉浸阅读 ---------- */
#side{transition:transform .22s ease}
#side.off{transform:translateX(-100%)}
#wrap{transition:margin-left .22s ease,padding-top .22s ease}
#wrap.full{margin-left:0}
#topbar{transition:transform .25s ease}
html.immersive #topbar{transform:translateY(-100%)}
html.immersive #side{transform:translateX(-100%)}
html.immersive #wrap{margin-left:0;padding-top:12px}
html.immersive h1,html.immersive h2,html.immersive h3{scroll-margin-top:20px}
#nav a.toc-l1{padding-right:8px}
#nav .caret{
  flex:none;display:inline-flex;align-items:center;justify-content:center;
  width:24px;height:24px;margin:0 -4px 0 2px;border-radius:7px;
  color:var(--muted);cursor:pointer;user-select:none;
  transition:transform .18s,background .15s,color .15s,box-shadow .15s;
}
#nav .caret svg{display:block}
#nav .caret:hover{background:color-mix(in srgb,var(--head2) 14%,transparent);color:var(--head2);box-shadow:0 0 0 1px color-mix(in srgb,var(--head2) 25%,transparent)}
#nav .toc-group.folded .caret{transform:rotate(-90deg);color:var(--ink-soft)}
#nav .toc-group.folded .toc-subs{display:none}
#nav .toc-subs .toc-subs{margin-left:10px;border-left:1px solid var(--line);padding-left:4px}
.nav-tools{display:flex;gap:6px;margin:0 0 10px}
.nav-tools button{
  flex:1;font:inherit;font-size:.76em;padding:5px 8px;border-radius:8px;cursor:pointer;
  border:1px solid var(--line);background:var(--paper);color:var(--ink-soft);
  display:inline-flex;align-items:center;justify-content:center;gap:5px;
  transition:.15s;
}
.nav-tools button:hover{border-color:var(--head2);color:var(--head2)}
.nav-tools button svg{flex:none}
/* ---------- 侧栏宽度拖动 ---------- */
#resize{
  position:fixed;top:52px;bottom:0;left:var(--sw);width:8px;margin-left:-4px;z-index:52;
  cursor:col-resize;touch-action:none;
}
#resize::after{
  content:"";position:absolute;left:50%;top:0;bottom:0;width:2px;margin-left:-1px;
  background:transparent;transition:background .15s;
}
#resize:hover::after,#resize.on::after{background:var(--accent)}
#imExit{
  position:fixed;top:12px;right:16px;z-index:65;display:none;
  font:inherit;font-size:.8em;padding:6px 12px;border-radius:999px;cursor:pointer;
  border:1px solid var(--line);background:var(--paper);color:var(--ink-soft);
  box-shadow:var(--shadow);opacity:.4;transition:.2s;
}
#imExit:hover{opacity:1;color:var(--head2);border-color:var(--head2)}
html.immersive #imExit{display:block}
/* ---------- 窄屏 ---------- */
@media (max-width:1080px){
  #menuBtn{display:inline-block}
  #side{transform:translateX(-100%);transition:transform .22s;top:0;padding-top:64px;z-index:55}
  #side.on{transform:none}
  #wrap{margin-left:0}
  main{padding:28px 20px 90px;box-shadow:none}
  .tb-title{font-size:.88em}
  #sideBtn{display:none}
  #resize{display:none}
}
/* ---------- 打印 / PDF ---------- */
@page{size:A4;margin:18mm 16mm}
@media print{
  #topbar,#side,#progress,#toTop,#lb,#mask,#q,#imExit,#resize{display:none!important}
  html.immersive #wrap{margin:0;padding-top:0}
  #wrap{margin:0;padding:0}
  main{max-width:none;padding:0;box-shadow:none;background:#fff}
  body{background:#fff;font-size:10.5pt;line-height:1.7;
       -webkit-print-color-adjust:exact;print-color-adjust:exact}
  h1.h-chap,h1.h-part,h2.h-sec{page-break-after:avoid}
  h1.h-part{page-break-before:always}
  h1.h-part:first-of-type{page-break-before:auto}
  figure.fig,.tbl,pre,blockquote{page-break-inside:avoid}
  .fig-inner:hover{box-shadow:none;transform:none}
  .draftbar,.hero{page-break-inside:avoid}
  a{color:inherit;text-decoration:none}
}
"""

JS = """
(function(){
  var root=document.documentElement;
  var k='vibe-book';
  var pendingFold=null;
  try{
    var st=JSON.parse(localStorage.getItem(k)||'{}');
    if(st.fs) root.style.setProperty('--fs',st.fs+'px');
    if(st.theme) root.setAttribute('data-theme',st.theme);
    if(st.fold) pendingFold=st.fold;
    if(st.sw) root.style.setProperty('--sw',Math.round(st.sw)+'px');
  }catch(e){}
  function save(patch){
    var st={};
    try{st=JSON.parse(localStorage.getItem(k)||'{}');}catch(e){}
    for(var x in patch) st[x]=patch[x];
    try{localStorage.setItem(k,JSON.stringify(st));}catch(e){}
  }
  function curFs(){return parseFloat(getComputedStyle(root).getPropertyValue('--fs'))||17;}

  // ---------- 侧栏宽度拖动 ----------
  (function(){
    var rz=document.getElementById('resize');
    if(!rz)return;
    var drag=false;
    function setW(px){
      px=Math.min(560,Math.max(200,Math.round(px)));
      root.style.setProperty('--sw',px+'px');
      return px;
    }
    rz.addEventListener('pointerdown',function(e){
      drag=true;rz.classList.add('on');
      try{rz.setPointerCapture(e.pointerId);}catch(err){}
      e.preventDefault();
    });
    rz.addEventListener('pointermove',function(e){if(drag)setW(e.clientX);});
    rz.addEventListener('pointerup',function(e){
      if(!drag)return;
      drag=false;rz.classList.remove('on');
      save({sw:parseFloat(getComputedStyle(root).getPropertyValue('--sw'))||312});
    });
    rz.addEventListener('pointercancel',function(){drag=false;rz.classList.remove('on');});
    rz.addEventListener('dblclick',function(){setW(312);save({sw:312});});
  })();

  var bar=document.getElementById('progress');
  var toTop=document.getElementById('toTop');
  var side=document.getElementById('side');
  var mask=document.getElementById('mask');
  var navLinks=[].slice.call(document.querySelectorAll('#nav a'));
  var heads=[].slice.call(document.querySelectorAll('main h1[id],main h2[id],main h3[id]'));

  // ---------- 目录按篇/章/节多级折叠 ----------
  // 用栈构建嵌套分组：凡是有下级条目的层级（篇/章/节）都有折叠箭头。
  var groups=[];
  var CARET_SVG='<svg width="13" height="13" viewBox="0 0 14 14" aria-hidden="true">'+
    '<path d="M3 5l4 4.2L11 5" fill="none" stroke="currentColor" stroke-width="2.2" '+
    'stroke-linecap="round" stroke-linejoin="round"/></svg>';
  (function(){
    var stack=[]; // 保存当前各层级的打开分组
    navLinks.forEach(function(a){
      var lvl=a.classList.contains('toc-l1')?1:(a.classList.contains('toc-l2')?2:3);
      while(stack.length&&stack[stack.length-1].lvl>=lvl)stack.pop();
      var parentSubs=stack.length?stack[stack.length-1].subs:document.getElementById('nav');
      var g=document.createElement('div');g.className='toc-group';
      var subs=document.createElement('div');subs.className='toc-subs';
      parentSubs.appendChild(g);
      g.appendChild(a);g.appendChild(subs);
      if(lvl<3){
        stack.push({el:g,l1:a,subs:subs,lvl:lvl});
        groups.push({el:g,l1:a,subs:subs});
      }
    });
    // 只有真正拥有下级内容的组才配折叠箭头（如 2.2 无小节则不加）
    groups=groups.filter(function(g){
      if(!g.subs.firstChild)return false;
      var c=document.createElement('span');c.className='caret';c.title='展开 / 收起本组';
      c.innerHTML=CARET_SVG;
      g.l1.appendChild(c);
      return true;
    });
    // 单行省略号布局：把链接内文字包进 .t（flex:1 + ellipsis），箭头固定在右侧；
    // 完整标题放入 title，悬停可看全文。
    navLinks.forEach(function(a){
      var t=document.createElement('span');t.className='t';
      [].slice.call(a.childNodes).forEach(function(n){
        if(n.nodeType===1&&n.classList.contains('caret'))return;
        t.appendChild(n);
      });
      a.insertBefore(t,a.firstChild);
      var full=(t.textContent||'').replace(/\\s+/g,' ').trim();
      if(full)a.title=full;
    });
  })();
  function getFolds(){
    try{return (JSON.parse(localStorage.getItem(k)||'{}').fold)||{};}catch(e){return{};}
  }
  function setFold(g,fold,keep){
    var will=(fold===undefined)?!g.el.classList.contains('folded'):!!fold;
    g.el.classList.toggle('folded',will);
    if(!keep){
      var f=getFolds();
      f[g.l1.getAttribute('href')]=will;
      save({fold:f});
    }
  }
  // 事件委托：点击篇/章标题右侧的箭头折叠/展开该组。
  // 箭头内部是 SVG（path/svg 元素），e.target 不会是 .caret 本身，必须用 closest 向上找。
  document.getElementById('nav').addEventListener('click',function(e){
    var t=e.target;
    var c=t&&t.closest?t.closest('.caret'):null;
    if(c){
      e.preventDefault();e.stopPropagation();
      var grp=c.closest('.toc-group');
      if(grp)setFold({el:grp,l1:grp.querySelector('.toc-l1')});
    }
  });
  groups.forEach(function(g){
    if(pendingFold&&pendingFold[g.l1.getAttribute('href')])g.el.classList.add('folded');
  });
  // 全部展开 / 全部收起
  [].slice.call(document.querySelectorAll('.nav-tools button')).forEach(function(b){
    b.onclick=function(){
      var fold=b.getAttribute('data-navact')==='foldAll';
      var f=getFolds();
      groups.forEach(function(g){
        g.el.classList.toggle('folded',fold);
        f[g.l1.getAttribute('href')]=fold;
      });
      save({fold:f});
    };
  });

  function onScroll(){
    var st=window.scrollY||document.documentElement.scrollTop;
    var h=document.documentElement.scrollHeight-window.innerHeight;
    bar.style.width=(h>0?Math.min(100,st/h*100):0)+'%';
    toTop.className=st>700?'on':'';
    // 当前章节
    var idx=0;
    for(var i=0;i<heads.length;i++){
      if(heads[i].getBoundingClientRect().top<=90) idx=i; else break;
    }
    var id=heads[idx]?heads[idx].id:'';
    navLinks.forEach(function(a){
      if(a.getAttribute('href')==='#'+id){
        if(!a.classList.contains('active')){
          navLinks.forEach(function(b){b.classList.remove('active');});
          var pg=a.closest('.toc-group');
          if(pg&&pg.classList.contains('folded')&&!a.classList.contains('toc-l1'))setFold(pg,false,true);
          a.classList.add('active');
          var r=a.offsetTop-side.scrollTop;
          if(r<40||r>side.clientHeight-60) side.scrollTop=a.offsetTop-side.clientHeight*0.35;
        }
      }
    });
  }
  window.addEventListener('scroll',onScroll,{passive:true});
  window.addEventListener('resize',onScroll);
  onScroll();

  document.getElementById('toTop').onclick=function(){window.scrollTo({top:0,behavior:'smooth'});};
  document.getElementById('lb').onclick=function(e){
    if(e.target===this||e.target.className==='lb-x'){this.classList.remove('on');}
  };
  document.addEventListener('keydown',function(e){
    if(e.key==='Escape'){
      document.getElementById('lb').classList.remove('on');
      side.classList.remove('on');mask.classList.remove('on');
      if(root.classList.contains('immersive'))exitIm();
    }
  });

  // 配图放大
  [].slice.call(document.querySelectorAll('figure.fig')).forEach(function(f){
    var inner=f.querySelector('.fig-inner');
    if(!inner) return;
    inner.onclick=function(){
      var lb=document.getElementById('lb');
      var cap=f.querySelector('figcaption');
      lb.innerHTML='<button class="lb-x">×</button><div class="lb-in">'+inner.innerHTML+
                   '</div><div class="lb-cap">'+(cap?cap.textContent:'')+'（按 Esc 关闭）</div>';
      lb.classList.add('on');
      lb.scrollTop=0;
    };
  });

  // 目录筛选
  var q=document.getElementById('q');
  q.addEventListener('input',function(){
    var v=q.value.trim().toLowerCase();
    navLinks.forEach(function(a){
      var hit=!v||(a.getAttribute('data-t')||'').indexOf(v)>=0;
      a.style.display=hit?'':'none';
    });
    groups.forEach(function(g){
      if(v){g.el.classList.remove('folded');}
      else if(getFolds()[g.l1.getAttribute('href')]){g.el.classList.add('folded');}
    });
  });

  // 工具按钮
  [].slice.call(document.querySelectorAll('.tb-tools button')).forEach(function(b){
    b.onclick=function(){
      var act=b.getAttribute('data-act');
      if(act==='font+'){var n=Math.min(22,curFs()+1);root.style.setProperty('--fs',n+'px');save({fs:n});}
      else if(act==='font-'){var n2=Math.max(14,curFs()-1);root.style.setProperty('--fs',n2+'px');save({fs:n2});}
      else if(act==='font0'){root.style.setProperty('--fs','17px');save({fs:17});}
      else if(act==='theme'){
        var t=root.getAttribute('data-theme')==='night'?'paper':'night';
        root.setAttribute('data-theme',t);save({theme:t});
        b.textContent=t==='night'?'日间':'夜读';
      }
      else if(act==='menu'){side.classList.toggle('on');mask.classList.toggle('on');}
      else if(act==='side'){
        if(window.matchMedia&&window.matchMedia('(max-width:1080px)').matches){
          side.classList.toggle('on');mask.classList.toggle('on');
        }else{
          var off=!side.classList.contains('off');
          side.classList.toggle('off',off);
          document.getElementById('wrap').classList.toggle('full',off);
          b.textContent=off?'展目录':'收目录';
          save({side:off?'off':'on'});
        }
      }
      else if(act==='im'){root.classList.contains('immersive')?exitIm():enterIm();}
    };
  });

  // 点击目录后关闭移动端侧栏
  navLinks.forEach(function(a){
    a.onclick=function(){
      side.classList.remove('on');mask.classList.remove('on');
    };
  });
  mask.onclick=function(){side.classList.remove('on');mask.classList.remove('on');};

  // ---------- 沉浸阅读 ----------
  function enterIm(keep){
    root.classList.add('immersive');
    if(!keep)save({im:1});
  }
  function exitIm(keep){
    root.classList.remove('immersive');
    if(!keep)save({im:0});
  }
  document.getElementById('imExit').onclick=function(){exitIm();};
  if(st.im)enterIm(true);
  if(st.side==='off'&&!(window.matchMedia&&window.matchMedia('(max-width:1080px)').matches)){
    side.classList.add('off');
    document.getElementById('wrap').classList.add('full');
    var sb=document.getElementById('sideBtn');
    if(sb)sb.textContent='展目录';
  }

  // 打印时确保是日间主题
  window.addEventListener('beforeprint',function(){root.setAttribute('data-theme','paper');});
})();
"""

COVER_SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 560" role="img" aria-label="封面">
  <rect x="0" y="0" width="400" height="560" rx="10" fill="#FFFFFF" stroke="#D8E4F0" stroke-width="1.5"/>
  <rect x="0" y="0" width="400" height="10" rx="5" fill="#1B4593"/>
  <text x="40" y="96" font-size="19" fill="#2064AE" font-family="Microsoft YaHei">智能体工程</text>
  <line x1="40" y1="118" x2="96" y2="118" stroke="#08A6F6" stroke-width="3"/>
  <text x="40" y="196" font-size="32" font-weight="bold" fill="#0C2864" font-family="Microsoft YaHei">从一次工具调用</text>
  <text x="40" y="242" font-size="32" font-weight="bold" fill="#0C2864" font-family="Microsoft YaHei">到可交付的系统</text>
  <text x="40" y="292" font-size="16" fill="#475569" font-family="Microsoft YaHei">交付物必须能被别人复核与修改</text>
  <line x1="40" y1="330" x2="360" y2="330" stroke="#D8E4F0" stroke-width="1.5"/>
  <text x="40" y="368" font-size="15" fill="#64748B" font-family="Microsoft YaHei">21 章 · 七篇 · 五份附录</text>
  <text x="40" y="396" font-size="15" fill="#64748B" font-family="Microsoft YaHei">39 张手绘矢量配图</text>
  <text x="40" y="424" font-size="15" fill="#64748B" font-family="Microsoft YaHei">参考实现 · 已通过测试</text>
  <rect x="40" y="472" width="320" height="1.5" fill="#EEF4FB"/>
  <text x="40" y="508" font-size="17" font-weight="bold" fill="#1B4593" font-family="Microsoft YaHei">Kevin + AI</text>
  <text x="40" y="532" font-size="14" fill="#94A3B8" font-family="Microsoft YaHei">2026 年 9 月 · 全稿</text>
</svg>"""
cover_svg = COVER_SVG

SHELL = """<!DOCTYPE html>
<html lang="zh-CN" data-theme="paper">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>__TITLE__ · __DRAFT__</title>
<meta name="description" content="__TITLE__ —— __SUB__。__AUTHOR__，__DRAFT__。">
<style>__CSS__</style>
</head>
<body>
<div id="progress"></div>
<header id="topbar">
  <button id="menuBtn" data-act="menu">目录</button>
  <div class="tb-title">__TITLE__ <span class="chip">全稿</span></div>
  <div class="tb-tools">
    <button data-act="font-">A−</button>
    <button data-act="font0">A</button>
    <button data-act="font+">A＋</button>
    <button id="sideBtn" data-act="side">收目录</button>
    <button data-act="theme">夜读</button>
    <button data-act="im">沉浸</button>
  </div>
</header>
<div id="mask"></div>
<aside id="side">
  <input id="q" type="search" placeholder="筛选章节…" autocomplete="off">
  <div class="nav-tools">
    <button type="button" data-navact="expandAll" title="展开所有篇/章的小节">
      <svg width="11" height="11" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 5.5L7 9.5l4-4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>全部展开</button>
    <button type="button" data-navact="foldAll" title="收起所有篇/章的小节">
      <svg width="11" height="11" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 8.5L7 4.5l4 4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>全部收起</button>
  </div>
  <nav id="nav">__TOC__</nav>
  <details>
    <summary>配图索引（__NFIG__）</summary>
    __FIGIDX__
  </details>
</aside>
<div id="resize" title="拖动调整目录宽度（双击恢复默认）"></div>
<div id="wrap">
<main>
  <div class="hero">
    <div class="hero-cv">__COVER__</div>
    <div class="hero-meta">
      <h1>__TITLE__</h1>
      <p class="sub">__SUB__</p>
      <p class="ver">__AUTHOR__　·　__DRAFT__</p>
      <div class="stats"><span>中文 __CJ__ 字</span><span>配图 __NFIG__ 张</span><span>代码 __NCODE__ 段</span><span>表格 __NTABLE__ 个</span></div>
    </div>
  </div>
  <div class="draftbar"><strong>阅读提示</strong> —— 本书引用的协议版本、基准分数、漏洞统计与政策文件，<strong>快照时点均为 2026 年 9 月 18 日</strong>，半年后请复核；逐条口径、时点与局限见<strong>附录 C</strong>。案例数据全部为合成或已脱敏材料，机构类型不可混用（国有大行 ≠ 城商行 ≠ 农商行）。</div>
  <p class="hint">阅读提示：点击任意配图可放大（Esc 关闭）；右上角可调字号、收起目录、切换夜读或进入<strong>沉浸阅读</strong>（再按一次按钮或 Esc 退出）；目录中篇/章/节标题右侧的 <strong>˅ 箭头</strong>可折叠下级内容（如 2.1 收起其下的 2.1.1），也可用搜索框下方的「<strong>全部展开 / 全部收起</strong>」一键操作；用 Ctrl/⌘ + P 可直接打印为 PDF（打印时自动隐藏侧栏、按章分页）。</p>
__BODY__
</main>
</div>
<button id="imExit" title="退出沉浸模式（Esc）">⤢ 退出沉浸</button>
<button id="toTop" title="回到顶部">↑</button>
<div id="lb"></div>
<script>__JS__</script>
</body>
</html>
"""

out = SHELL
for k, v in [
    ("__TITLE__", H.escape(BOOK_TITLE)),
    ("__SUB__", H.escape(BOOK_SUB)),
    ("__DRAFT__", H.escape(DRAFT_LINE)),
    ("__AUTHOR__", H.escape(AUTHOR_LINE)),
    ("__CSS__", CSS),
    ("__TOC__", toc_html),
    ("__FIGIDX__", fig_index),
    ("__NFIG__", str(len(FIG_ORDER))),
    ("__COVER__", cover_svg),
    ("__CJ__", "{:,}".format(cj)),
    ("__NCODE__", str(n_code)),
    ("__NTABLE__", str(n_table)),
    ("__BODY__", body),
    ("__JS__", JS),
]:
    out = out.replace(k, v)

open(OUT, "w", encoding="utf-8").write(out)
print("OK ->", OUT)
print("  中文字数 %s | 配图 %d 张 | 代码 %d 段 | 表格 %d 个 | 目录 %d 条"
      % ("{:,}".format(cj), len(FIG_ORDER), n_code, n_table, len(toc_items)))
print("  文件大小 %.1f KB" % (os.path.getsize(OUT) / 1024))
