#!/usr/bin/env python3
# merge_into_template.py — 把管线产出页（svg_to_pptx 导出）移植进公司模板
# （保留母版/版式），标题写入版式占位符
# 用法: python3 merge_into_template.py <source.pptx> <template.pptx> <final_output.pptx> <pages.json>
# pages.json 示例:
# {
#   "pages": [
#     {"src": null, "layout": "封面", "title": "AI+项目管理", "subtitle": "智能体场景规划"},
#     {"src": 0, "layout": "标题_内容_底纹", "title": "总起页标题"},
#     {"src": 1, "layout": "标题_底纹", "title": "立项申报智能体", "tag": "立项申报阶段"}
#   ]
# }
# src = 源 PPTX 中的页索引（0-based）；null = 纯版式页（仅填占位符）
import sys, json, copy
from pptx import Presentation
from pptx.oxml.ns import qn
from pptx.opc.constants import RELATIONSHIP_TYPE as RT
from pptx.util import Pt
from pptx.enum.shapes import PP_PLACEHOLDER


def find_layout(host, name):
    for layout in host.slide_masters[0].slide_layouts:
        if layout.name == name:
            return layout
    raise SystemExit(f"ERROR: 版式 '{name}' 不存在。可用: {[l.name for l in host.slide_masters[0].slide_layouts]}")


def is_fullpage_backdrop(el):
    """判定管线注入的全页底板（SVG 白底 rect）：≥1200×650 的纯色/无文字矩形，移植时跳过以露出模板版式底纹。"""
    if not el.tag.endswith('}sp'):
        return False
    off = el.find('.//' + qn('a:off'))
    ext = el.find('.//' + qn('a:ext'))
    if off is None or ext is None:
        return False
    w, h = int(ext.get('cx')), int(ext.get('cy'))
    if w < 1200 * 9525 or h < 650 * 9525:
        return False
    if el.find('.//' + qn('a:t')) is not None:
        return False
    return True


R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
_REL_ATTR_KINDS = ('embed', 'link', 'id', 'dm', 'lo', 'qs', 'cs', 'pict')
SLIDE_RELTYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide'


def _strip_cust_data(root_el):
    """剥离 p:custDataLst（shape 级 tags 等自定义元数据）。
    这些 tags 部件不会随形状移植，残留的 r:id 悬空引用会让 PowerPoint 报'修复'。"""
    for cd in root_el.findall('.//' + qn('p:custDataLst')):
        cd.getparent().remove(cd)


def _max_shape_id(tree):
    m = 1
    for el in tree.iter(qn('p:cNvPr')):
        try:
            m = max(m, int(el.get('id')))
        except (TypeError, ValueError):
            pass
    return m


def migrate_shapes(src_slide, host_slide, slide_rel_map=None):
    """把源页 spTree 中的全部形状元素深拷贝到宿主页（跳过全页底板），
    并修复全部关系引用：重映射所有 r: 命名空间属性（图片/超链接/图表等），
    剥离 custDataLst 元数据，重编号 shape id 避免与宿主占位符冲突。

    `slide_rel_map` 是「源页部件 → 宿主页部件」的映射，供**同册跳转超链接**
    （`<a href="#slide-N">`，导出后成为指向 slide 部件的内部关系）重映射。
    没有映射时若直接 `relate_to(源页部件)`，python-pptx 会把源 pptx 的那一页
    连同它的 layout/master/theme 一起复制进目标包，产生 `ppt/slides/slideN.xml`
    等重名条目，PowerPoint 打开必报"修复"。故映射缺失时一律移除该跳转并告警。"""
    src_tree = src_slide.shapes._spTree
    dst_tree = host_slide.shapes._spTree
    count = 0
    skipped = 0
    next_id = _max_shape_id(dst_tree) + 1
    for child in list(src_tree):
        tag = child.tag
        if tag in (qn('p:nvGrpSpPr'), qn('p:grpSpPr')):
            continue
        if is_fullpage_backdrop(child):
            skipped += 1
            continue
        new_el = copy.deepcopy(child)
        _strip_cust_data(new_el)
        for el in new_el.iter():
            for attr in list(el.attrib):
                if not attr.startswith('{%s}' % R_NS):
                    continue
                kind = attr.rsplit('}', 1)[1]
                if kind not in _REL_ATTR_KINDS:
                    continue
                old_rid = el.get(attr)
                try:
                    rel = src_slide.part.rels[old_rid]
                except KeyError:
                    print(f"WARN: 源关系 {old_rid} 不存在，已移除引用 {attr}")
                    del el.attrib[attr]
                    continue
                if rel.is_external:
                    # 外部超链接：挂到宿主页自己的外部关系表，安全。
                    new_rid = host_slide.part.rels.get_or_add_ext_rel(rel.reltype, rel.target_ref)
                elif rel.reltype == SLIDE_RELTYPE:
                    # 同册跳转：改指宿主页里的对应页，绝不把源页部件拖进目标包。
                    target = (slide_rel_map or {}).get(rel.target_part)
                    if target is None:
                        print("WARN: 同册跳转目标页未进入本册"
                              f"（源 {getattr(rel.target_part, 'partname', '?')}），已移除该跳转")
                        del el.attrib[attr]
                        continue
                    new_rid = host_slide.part.rels.get_or_add(rel.reltype, target)
                else:
                    print(f"WARN: 源页出现非预期内部关系 {rel.reltype}，按原样重映射")
                    new_rid = host_slide.part.relate_to(rel.target_part, rel.reltype)
                el.set(attr, new_rid)
        for el in new_el.iter(qn('p:cNvPr')):
            el.set('id', str(next_id))
            next_id += 1
        dst_tree.append(new_el)
        count += 1
    if skipped:
        print(f"  跳过全页底板 {skipped} 个")
    return count


def drop_empty_placeholders(slide):
    """删除空文本占位符（已填字的保留），避免编辑视图显示'单击此处添加文本'。"""
    for ph in list(slide.placeholders):
        try:
            txt = ph.text_frame.text.strip()
        except Exception:
            txt = ''
        if not txt:
            el = ph._element
            el.getparent().remove(el)


def fill_title(slide, title, tag=None, tag_size=14):
    """向 title/ctrTitle 占位符写标题；tag 作为同段小字灰蓝 run。返回是否写入。"""
    for ph in slide.placeholders:
        if ph.placeholder_format.type in (PP_PLACEHOLDER.TITLE, PP_PLACEHOLDER.CENTER_TITLE):
            tf = ph.text_frame
            tf.clear()
            p = tf.paragraphs[0]
            r1 = p.add_run()
            r1.text = title
            r1.font.size = None  # Inherit the actual template layout title size.
            r1.font.bold = True
            r1.font.name = 'Microsoft YaHei'
            if tag:
                r2 = p.add_run()
                r2.text = '    ' + tag
                r2.font.size = Pt(tag_size)
                r2.font.bold = False
                r2.font.name = 'Microsoft YaHei'
            return True
    return False


def fill_subtitle(slide, text, size=18):
    for ph in slide.placeholders:
        if ph.placeholder_format.type == PP_PLACEHOLDER.SUBTITLE:
            tf = ph.text_frame
            tf.clear()
            r = tf.paragraphs[0].add_run()
            r.text = text
            r.font.size = Pt(size)
            r.font.name = 'Microsoft YaHei'
            return True
    return False


def drop_host_slides(host):
    """删除宿主文件原有全部页面（保留母版/版式/主题），用于模板自带的示例页。"""
    xml_slides = host.slides._sldIdLst
    for sld_id in list(xml_slides):
        rid = sld_id.get(qn('r:id'))
        try:
            host.part.drop_rel(rid)
        except Exception:
            pass
        xml_slides.remove(sld_id)


def main():
    if len(sys.argv) != 5:
        raise SystemExit(__doc__)
    source_pptx, template_path, final_out, config_path = sys.argv[1:5]
    with open(config_path, encoding='utf-8') as f:
        cfg = json.load(f)

    src = Presentation(source_pptx)
    host = Presentation(template_path)
    if cfg.get('drop_host_slides'):
        drop_host_slides(host)

    # 阶段 1：先把全部页建好并写好版式标题。
    # 必须两阶段——第 1 页可能跳到第 3 页，映射表要在移植前就完整。
    planned = []
    for page in cfg['pages']:
        layout = find_layout(host, page['layout'])
        slide = host.slides.add_slide(layout)
        fill_title(slide, page.get('title', ''), page.get('tag'))
        if page.get('subtitle'):
            fill_subtitle(slide, page['subtitle'])
        planned.append((page, slide))

    # 阶段 2：源页部件 → 宿主页部件（供同册跳转重映射）
    slide_rel_map = {}
    for page, slide in planned:
        si = page.get('src')
        if si is None:
            continue
        try:
            slide_rel_map[src.slides[si].part] = slide.part
        except IndexError:
            print(f"WARN: pages.json 的 src={si} 超出源册页数，已跳过该页移植")

    # 阶段 3：移植形状
    for i, (page, slide) in enumerate(planned):
        if page.get('src') is not None:
            n = migrate_shapes(src.slides[page['src']], slide, slide_rel_map)
            print(f"page{i+1} [{page['layout']}] 移植形状 {n} 个")
        drop_empty_placeholders(slide)

    host.save(final_out)
    print(f"OK: {final_out} 共 {len(host.slides._sldIdLst)} 页")


if __name__ == '__main__':
    main()
