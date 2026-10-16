#!/usr/bin/env python3
"""针对 PowerPoint '修复' 触发点的 OOXML 静态校验器"""
import sys, re, zipfile, posixpath
from collections import Counter
from lxml import etree

NS_R = 'http://schemas.openxmlformats.org/package/2006/relationships'
NS_CT = 'http://schemas.openxmlformats.org/package/2006/content-types'
R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
P_NS = 'http://schemas.openxmlformats.org/presentationml/2006/main'

SLIDE_CT = 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml'
NOTES_CT = 'application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml'

def validate(path):
    z = zipfile.ZipFile(path)
    names = set(z.namelist())
    issues = []

    # 0. zip 完整性
    bad = z.testzip()
    if bad: issues.append(f'[zip] corrupt at {bad}')

    # 1. XML 良构性
    for n in sorted(names):
        if n.endswith(('.xml', '.rels')):
            try:
                etree.fromstring(z.read(n))
            except Exception as e:
                issues.append(f'[xml] malformed {n}: {e}')

    # 2. content types
    ctb = z.read('[Content_Types].xml')
    ct = etree.fromstring(ctb)
    defaults = {e.get('Extension').lower() for e in ct.iter(f'{{{NS_CT}}}Default')}
    overrides = [e.get('PartName') for e in ct.iter(f'{{{NS_CT}}}Override')]
    ov_dup = [k for k, v in Counter(overrides).items() if v > 1]
    if ov_dup: issues.append(f'[ct] duplicate Overrides: {ov_dup}')
    ovs = set(overrides)
    for n in sorted(names):
        if n == '[Content_Types].xml' or n.endswith('.rels') or n.endswith('/'):
            continue
        ext = n.rsplit('.', 1)[-1].lower()
        if ext not in defaults and ('/' + n) not in ovs:
            issues.append(f'[ct] no content type for {n}')
    # 幻灯片/备注页必须有专属 Override（xml Default 是 application/xml，不够）
    for n in sorted(names):
        if re.match(r'ppt/slides/slide\d+\.xml$', n):
            if '/' + n not in ovs or SLIDE_CT not in ctb.decode('utf8', 'ignore'):
                issues.append(f'[ct] slide part missing slide Override: {n}')
        if re.match(r'ppt/notesSlides/notesSlide\d+\.xml$', n):
            if '/' + n not in ovs:
                issues.append(f'[ct] notes part missing Override: {n}')

    # 3. rels：目标存在 + rId 唯一
    for n in sorted(x for x in names if x.endswith('.rels')):
        m = re.match(r'^(.*)_rels/[^/]+\.rels$', n)
        base = posixpath.dirname(m.group(1)) if m else ''
        ids = []
        for rel in etree.fromstring(z.read(n)).iter(f'{{{NS_R}}}Relationship'):
            ids.append(rel.get('Id'))
            if rel.get('TargetMode') == 'External':
                continue
            t = rel.get('Target')
            if not t:
                issues.append(f'[rels] {n}: empty Target'); continue
            full = t.lstrip('/') if t.startswith('/') else posixpath.normpath(posixpath.join(base, t))
            if full not in names:
                issues.append(f'[rels] {n}: missing target {t} (-> {full})')
        dup = [k for k, v in Counter(ids).items() if v > 1]
        if dup: issues.append(f'[rels] {n}: duplicate rIds {dup}')

    # 4. slide/notesSlide/presentation 里用到的 r:id 必须在自己的 rels 中定义
    scan = [x for x in names if re.match(r'ppt/(slides|notesSlides)/[^/]+\.xml$', x)] + ['ppt/presentation.xml']
    for n in sorted(scan):
        d = posixpath.dirname(n)
        relsn = f'{d}/_rels/{posixpath.basename(n)}.rels'
        defined = set()
        if relsn in names:
            for rel in etree.fromstring(z.read(relsn)).iter(f'{{{NS_R}}}Relationship'):
                defined.add(rel.get('Id'))
        xmlc = z.read(n).decode('utf-8', 'ignore')
        used = set(re.findall(r'r:(?:id|embed|link|pict|dm|lo|qs|cs)="(rId\d+)"', xmlc))
        miss = used - defined
        if miss: issues.append(f'[rid] {n}: uses undefined {sorted(miss)}')

    # 5. presentation.xml：sldIdLst / sldMasterIdLst / notesMasterIdLst
    pres = etree.fromstring(z.read('ppt/presentation.xml'))
    prels = etree.fromstring(z.read('ppt/_rels/presentation.xml.rels'))
    relmap = {r.get('Id'): r.get('Target') for r in prels.iter(f'{{{NS_R}}}Relationship')}
    sldids, seen_rid = [], set()
    for el in pres.iter(f'{{{P_NS}}}sldId'):
        sid = int(el.get('id')); rid = el.get(f'{{{R_NS}}}id')
        sldids.append((sid, rid))
        if rid in seen_rid: issues.append(f'[pres] sldIdLst duplicate rId {rid}')
        seen_rid.add(rid)
    ids = [i for i, _ in sldids]
    if len(set(ids)) != len(ids):
        issues.append(f'[pres] DUPLICATE sldId ids: {[k for k,v in Counter(ids).items() if v>1]}')
    if ids and min(ids) < 256: issues.append(f'[pres] sldId id < 256: {min(ids)}')
    for sid, rid in sldids:
        t = relmap.get(rid)
        if t is None:
            issues.append(f'[pres] sldId {sid}: {rid} not in presentation rels'); continue
        full = t.lstrip('/') if t.startswith('/') else posixpath.normpath(posixpath.join('ppt', t))
        if full not in names:
            issues.append(f'[pres] sldId {sid}: target missing {t}')
    # 每个 sldId 指向的 slide 必须唯一（一个 slide part 不应被引用两次）
    tgts = [relmap.get(r) for _, r in sldids]
    dt = [k for k, v in Counter(tgts).items() if v > 1]
    if dt: issues.append(f'[pres] same slide target referenced twice: {dt}')
    # master / notesMaster 引用
    for tag in ('sldMasterIdLst', 'notesMasterIdLst'):
        for el in pres.iter(f'{{{P_NS}}}{tag[:-3]}Id'):
            rid = el.get(f'{{{R_NS}}}id')
            t = relmap.get(rid)
            if t is None:
                issues.append(f'[pres] {tag}: {rid} missing in rels'); continue
            full = posixpath.normpath(posixpath.join('ppt', t)) if not t.startswith('/') else t.lstrip('/')
            if full not in names:
                issues.append(f'[pres] {tag}: target missing {t}')

    # 6. 每个 slide 必须有 slideLayout 关系
    for n in sorted(x for x in names if re.match(r'ppt/slides/slide\d+\.xml$', x)):
        relsn = f'ppt/slides/_rels/{n.split("/")[-1]}.rels'
        if relsn not in names:
            issues.append(f'[lay] {n}: no rels at all'); continue
        types = [r.get('Type') for r in etree.fromstring(z.read(relsn)).iter(f'{{{NS_R}}}Relationship')]
        if 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout' not in types:
            issues.append(f'[lay] {n}: missing slideLayout relationship')

    # 7. 数值属性含小数（sz/rot/spc/EMU 坐标必须为整数）
    floats = Counter()
    for n in sorted(x for x in names if x.startswith('ppt/slides/slide') and x.endswith('.xml')):
        xmlc = z.read(n).decode('utf-8', 'ignore')
        for attr, val in re.findall(r'(\w+)="(-?\d+\.\d+)"', xmlc):
            if attr == 'version':
                continue
            floats[f'{n.split("/")[-1]}:{attr}={val}'] += 1
    if floats:
        for k, v in sorted(floats.items())[:20]:
            issues.append(f'[num] float attr {k} x{v}')

    # 8. 同一 slide 内 shape id 重复
    for n in sorted(x for x in names if re.match(r'ppt/slides/slide\d+\.xml$', x)):
        xmlc = z.read(n).decode('utf-8', 'ignore')
        allids = re.findall(r'cNvPr id="(\d+)"', xmlc)
        dup = [k for k, v in Counter(allids).items() if v > 1]
        if dup: issues.append(f'[shp] {n.split("/")[-1]}: duplicate shape ids {dup[:8]}')

    # 9. media 扩展与真实格式
    for n in sorted(x for x in names if x.startswith('ppt/media/')):
        head = z.read(n)[:8]
        ext = n.rsplit('.', 1)[-1].lower()
        sig = {'png': b'\x89PNG', 'jpeg': b'\xff\xd8\xff', 'jpg': b'\xff\xd8\xff', 'gif': b'GIF8', 'bmp': b'BM'}.get(ext)
        if sig and not head.startswith(sig):
            issues.append(f'[media] {n}: extension {ext} but magic bytes mismatch')

    nparts = len(names)
    nslides = len([x for x in names if re.match(r'ppt/slides/slide\d+\.xml$', x)])
    return issues, nparts, nslides

if __name__ == '__main__':
    exit_code = 0
    for path in sys.argv[1:]:
        issues, nparts, nslides = validate(path)
        print(f'== {path.split("/")[-1]}  (parts={nparts}, slides={nslides})')
        if issues:
            exit_code = 1
            for i in issues[:40]:
                print('  !!', i)
            if len(issues) > 40:
                print(f'  ... 共 {len(issues)} 条')
        else:
            print('   OK: 未发现触发修复的结构问题')
        print()
    sys.exit(exit_code)
