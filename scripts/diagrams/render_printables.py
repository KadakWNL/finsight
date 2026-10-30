"""Render current catalog as Chen ER and dependency-style relational schema PDFs."""
import json
import math
from pathlib import Path
import xml.etree.ElementTree as ET

import pymupdf as fitz
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A0, A1, landscape
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.lib.colors import HexColor, black, white

ROOT = Path(__file__).resolve().parents[2]
CAT = json.loads((ROOT / 'docs/printable/schema-catalog.json').read_text(encoding='utf-8'))
OUT = ROOT / 'output/pdf'
OUT.mkdir(parents=True, exist_ok=True)
NS = 'http://www.w3.org/2000/svg'
ET.register_namespace('', NS)


def el(parent, tag, **attrs):
    return ET.SubElement(parent, f'{{{NS}}}{tag}', {k.replace('_', '-'): str(v) for k, v in attrs.items()})


def text(parent, x, y, label, size=10, weight='normal', anchor='middle', color='#182532'):
    node = el(parent, 'text', x=x, y=y, font_family='Helvetica,Arial,sans-serif', font_size=size,
              font_weight=weight, text_anchor=anchor, fill=color)
    node.text = label
    return node


def mongo_attributes():
    schema = CAT['mongo']['validator']['$jsonSchema']
    attrs = [{'name': name, 'not_null': name in schema['required'], 'generated': False}
             for name in schema['properties']]
    for shape in schema['oneOf']:
        payload = shape['properties']['payload']
        for name in payload['properties']:
            attrs.append({'name': 'payload.' + name, 'not_null': False, 'generated': False})
    return attrs


def er_diagram():
    base = ET.parse(ROOT / 'tmp/pdfs/er-base.svg').getroot()
    graph = base.find(f'{{{NS}}}g')
    layout = json.loads((ROOT / 'tmp/pdfs/er-layout.json').read_text())
    objects = {obj['_gvid']: obj for obj in layout['objects']}
    by_name = {obj['name']: obj for obj in layout['objects']}
    tables = {table['name']: table for table in CAT['tables']}
    names = set(tables) | {'device_telemetry'}
    # Extend Graphviz boundary ports through a free horizontal corridor to the entity box.
    for edge in layout['edges']:
        points = next((draw['points'] for draw in edge.get('_draw_', []) if draw['op'] == 'b'), [])
        if not points:
            continue
        for obj_id, point in [(edge['tail'], points[0]), (edge['head'], points[-1])]:
            obj = objects[obj_id]
            if obj['name'] not in names:
                continue
            cx, cy = map(float, obj['pos'].split(','))
            px, py = point
            side = 1 if px > cx else -1
            el(graph, 'polyline', points=f'{cx + side * 82},{-cy} {px},{-cy} {px},{-py}',
               fill='none', stroke='#334155', stroke_width=0.8)

    for name in names:
        obj = by_name[name]
        cx, cy = map(float, obj['pos'].split(','))
        cy = -cy
        table = tables.get(name)
        attrs = table['columns'] if table else mongo_attributes()
        pk = next((set(c['columns']) for c in table['constraints'] if c['type'] == 'p'), set()) if table else {'_id'}
        group = el(graph, 'g', id='entity-' + name)
        half = math.ceil(len(attrs) / 2)
        banks = [attrs[:half], attrs[half:]]
        for bank, direction in zip(banks, [-1, 1]):
            upper_count = math.ceil(len(bank) / 2)
            for index, attr in enumerate(bank):
                vertical = -1 if index < upper_count else 1
                offset = index if index < upper_count else index - upper_count
                ay = cy + vertical * (28 + offset * 21)
                ax = cx + direction * 122
                rail = cx + direction * 45
                near = ax - direction * 55
                el(group, 'polyline', points=f'{cx + direction * 35},{cy + vertical * 15} {rail},{cy + vertical * 19} {rail},{ay} {near},{ay}',
                   fill='none', stroke='#8a717b', stroke_width=0.65)
                ellipse = el(group, 'ellipse', cx=ax, cy=ay, rx=55, ry=8.5, fill='#fff0f3', stroke='#b78c98', stroke_width=0.65)
                if attr.get('generated'):
                    ellipse.set('stroke-dasharray', '3 2')
                size = min(9.4, 98 / max(stringWidth(attr['name'], 'Helvetica', 1), 1))
                text(group, ax, ay + size * 0.32, attr['name'], size=size)
                if attr['name'] in pk:
                    tw = stringWidth(attr['name'], 'Helvetica', size)
                    el(group, 'line', x1=ax - tw / 2, y1=ay + size * 0.49, x2=ax + tw / 2,
                       y2=ay + size * 0.49, stroke='#202020', stroke_width=0.7)
        color = '#d9edcf'
        label = name
        if name == 'schema_migrations':
            color = '#eef0f2'
        elif table and table['kind'] == 'v':
            color = '#fff4d6'
        elif not table:
            color = '#f8e0b5'
        rect = el(group, 'rect', x=cx-82, y=cy-15, width=164, height=30,
                  fill=color, stroke='#547245', stroke_width=1.0)
        if table and table['kind'] == 'v':
            rect.set('stroke-dasharray', '4 2')
        auxiliary = name in {'schema_migrations', 'v_transaction_risk', 'device_telemetry'}
        text(group, cx, cy-2 if auxiliary else cy+3.1, label, size=9.4, weight='bold')
        if name == 'schema_migrations':
            text(group, cx, cy+9, 'migration bookkeeping', size=7, color='#64748b')
        if table and table['kind'] == 'v':
            text(group, cx, cy+9, 'derived SQL view', size=7, color='#8a6530')
        if not table:
            text(group, cx, cy+9, 'Mongo collection / two payload shapes', size=7, color='#8a6530')

    # Retain scalable Graphviz artwork and add the compulsory heading and scope legend.
    width = float(base.attrib['viewBox'].split()[2])
    height = float(base.attrib['viewBox'].split()[3])
    outer = ET.Element(f'{{{NS}}}svg', {'width': str(width+100), 'height': str(height+230),
                                   'viewBox': f'0 0 {width+100} {height+230}'})
    el(outer, 'rect', x=0, y=0, width=width+100, height=height+230, fill='white')
    text(outer, (width+100)/2, 40, 'FinSight', size=32, weight='bold')
    text(outer, (width+100)/2, 70, 'ER Diagram - Chen notation', size=21)
    text(outer, (width+100)/2, 96, 'Shrikar Desai    |    Shreyas P Kulkarni', size=17, weight='bold')
    text(outer, (width+100)/2, 119, 'Implemented entities and exact attributes - PostgreSQL migrations 010-060 + Mongo telemetry', size=11)
    holder = el(outer, 'g', transform='translate(50 140)')
    holder.append(graph)
    fy = height + 169
    text(outer, 60, fy, 'Rectangles: entities  |  Ellipses: attributes  |  Diamonds: relationships  |  Underline: primary key  |  Dashed ellipse: stored generated column', size=11, anchor='start')
    text(outer, 60, fy+20, '1 = exactly one; 0..1 = optional one; 0..N = zero or many. Brown dashed links are application-validated Mongo references, not SQL foreign keys.', size=11, anchor='start')
    text(outer, 60, fy+40, 'Mongo payload.ip_routing_hash / connection_type / latency_ms / tls_cipher / vpn_detected belong to connection_telemetry; the other payload fields belong to client_environment.', size=10, anchor='start')
    text(outer, 60, fy+60, 'candidate_session_ids is a retained UUID-array snapshot, not an FK. View/tooling blocks are distinguished from the 17 application tables. Source: main ' + CAT['sourceCommit'][:12] + ' | 30 October 2026', size=10, anchor='start')
    svg = ET.tostring(outer, encoding='utf-8', xml_declaration=True)
    (ROOT / 'docs/printable/finsight-er-diagram.svg').write_bytes(svg)
    source = fitz.open(stream=svg, filetype='svg')
    vector = fitz.open('pdf', source.convert_to_pdf())
    doc = fitz.open()
    w, h = landscape(A0)
    page = doc.new_page(width=w, height=h)
    page.show_pdf_page(fitz.Rect(25, 25, w-25, h-25), vector, 0)
    doc.set_metadata({'title': 'FinSight - Current ER Diagram', 'author': 'Shrikar Desai; Shreyas P Kulkarni', 'subject': 'Implemented schema, Chen format, source ' + CAT['sourceCommit']})
    doc.save(OUT / 'FinSight-ER-Diagram.pdf')
    return doc


def arrow(c, points, color=black, width=0.55, dashed=False, head=True):
    c.setStrokeColor(color)
    c.setFillColor(color)
    c.setLineWidth(width)
    c.setDash(2, 2) if dashed else c.setDash()
    path = c.beginPath()
    path.moveTo(*points[0])
    for x, y in points[1:]:
        path.lineTo(x, y)
    c.drawPath(path)
    if not head:
        c.setDash()
        return
    x, y = points[-1]
    px, py = points[-2]
    angle = math.atan2(y-py, x-px)
    path = c.beginPath()
    path.moveTo(x, y)
    for delta in [2.65, -2.65]:
        path.lineTo(x + 4*math.cos(angle+delta), y + 4*math.sin(angle+delta))
    path.close()
    c.setDash()
    c.drawPath(path, stroke=0, fill=1)


def schema_diagram():
    w, h = landscape(A1)
    path = OUT / 'FinSight-Schema-Diagram.pdf'
    c = canvas.Canvas(str(path), pagesize=(w, h), pageCompression=1)
    c.setTitle('FinSight - Current Relational Schema Diagram')
    c.setAuthor('Shrikar Desai; Shreyas P Kulkarni')
    c.setFillColor(black)
    c.setFont('Helvetica-Bold', 25)
    c.drawCentredString(w/2, h-42, 'FinSight')
    c.setFont('Helvetica', 17)
    c.drawCentredString(w/2, h-66, 'Relational Schema Diagram')
    c.setFont('Helvetica-Bold', 13)
    c.drawCentredString(w/2, h-88, 'Shrikar Desai    |    Shreyas P Kulkarni')
    c.setFont('Helvetica', 9)
    c.drawCentredString(w/2, h-106, 'Exact implemented names | PK dependencies in red | FK references in black | PostgreSQL 17 + MongoDB')
    order = ['app_user', 'customer', 'address', 'account', 'payment_method', 'merchant', 'device_fingerprint',
             'transaction', 'risk_rule', 'risk_signal', 'fraud_scenario', 'transaction_label', 'investigation_case',
             'case_event', 'case_command_receipt', 'app_session', 'app_session_cleanup', 'schema_migrations', 'v_transaction_risk']
    tables = {t['name']: t for t in CAT['tables']}
    positions = {}
    start_x = 350
    row_gap = 65
    top = h-158
    row_h = 23
    red = HexColor('#bb2424')
    for index, name in enumerate(order):
        table = tables[name]
        y = top-index*row_gap
        pk = next((set(x['columns']) for x in table['constraints'] if x['type']=='p'), set())
        fk = {field for x in table['constraints'] if x['type']=='f' for field in x['columns']}
        x = start_x
        cells = {}
        for col in table['columns']:
            width = max(65, stringWidth(col['name'], 'Helvetica', 11.5)+20)
            cells[col['name']] = (x, y, width, row_h)
            x += width
        assert x < w-35, (name, x, w)
        positions[name] = cells
        c.setFillColor(black)
        c.setFont('Helvetica-Bold', 11)
        c.drawString(180, y+8, name)
        if name=='schema_migrations':
            c.setFont('Helvetica-Oblique', 8)
            c.drawString(x+12, y+8, 'migration bookkeeping')
        for col in table['columns']:
            xx, yy, ww, hh = cells[col['name']]
            c.setStrokeColor(HexColor('#303030'))
            c.setLineWidth(0.55)
            c.setFillColor(HexColor('#fff8e9') if col['generated'] else white)
            c.rect(xx, yy, ww, hh, fill=1, stroke=1)
            c.setFillColor(black)
            c.setFont('Helvetica', 11.5)
            c.drawCentredString(xx+ww/2, yy+8, col['name'])
            label_w = stringWidth(col['name'], 'Helvetica', 11.5)
            if col['name'] in pk:
                c.line(xx+ww/2-label_w/2, yy+6.2, xx+ww/2+label_w/2, yy+6.2)
            if col['name'] in fk:
                c.setDash(2, 1.5)
                c.line(xx+ww/2-label_w/2, yy+4.2, xx+ww/2+label_w/2, yy+4.2)
                c.setDash()
        if pk:
            determinant = [cells[field][0]+cells[field][2]/2 for field in pk]
            origin = sum(determinant)/len(determinant)
            dependency_y = y+row_h+22
            c.setStrokeColor(red)
            c.setLineWidth(0.55)
            for px in determinant:
                c.line(px,y+row_h,px,dependency_y)
            targets = [cells[field['name']][0]+cells[field['name']][2]/2 for field in table['columns'] if field['name'] not in pk]
            if targets:
                c.line(min([origin]+targets),dependency_y,max([origin]+targets),dependency_y)
                for px in targets:
                    arrow(c, [(px,dependency_y),(px,y+row_h)],red)
        else:
            c.setFont('Helvetica-Oblique',7.5)
            c.setFillColor(HexColor('#725322'))
            c.drawString(x+12,y+8,'view columns; no declared primary key')
    # FK edges use the outside left gutter and the spaces below relation rows.
    fks = [(table, fk) for table in CAT['tables'] for fk in table['constraints'] if fk['type']=='f']
    for index, (table, fk) in enumerate(fks):
        source = positions[table['name']]
        target = positions[fk['references_table'].replace('public.','')]
        source_xs = [source[name][0]+source[name][2]/2 for name in fk['columns']]
        target_xs = [target[name][0]+target[name][2]/2 for name in fk['references_columns']]
        sx = sum(source_xs)/len(source_xs)
        tx = sum(target_xs)/len(target_xs)
        sy = next(iter(source.values()))[1]
        ty = next(iter(target.values()))[1]
        gutter = 28+index*7
        offset = 9+(index%3)*4
        if len(source_xs)==1:
            arrow(c,[(sx,sy),(sx,sy-offset),(gutter,sy-offset),(gutter,ty-8),(tx,ty-8),(tx,ty)],width=0.45)
        else:
            # Composite references branch to the exact columns, never to an intervening attribute.
            source_y=sy-offset
            target_y=ty-8
            for px in source_xs:
                arrow(c,[(px,sy),(px,source_y)],width=0.45,head=False)
            arrow(c,[(min(source_xs),source_y),(max(source_xs),source_y)],width=0.45,head=False)
            arrow(c,[(sx,source_y),(gutter,source_y),(gutter,target_y),(tx,target_y)],width=0.45,head=False)
            arrow(c,[(min(target_xs),target_y),(max(target_xs),target_y)],width=0.45,head=False)
            for px in target_xs:
                arrow(c,[(px,target_y),(px,ty)],width=0.45)
    # Document store supplement uses the same attribute-strip format without fictitious SQL FKs.
    y = top-len(order)*row_gap
    schema = CAT['mongo']['validator']['$jsonSchema']
    mongo_rows = [('device_telemetry [Mongo collection]',list(schema['properties']))]
    for shape in schema['oneOf']:
        kind=shape['properties']['shape_type']['enum'][0]
        mongo_rows.append((f'payload when shape_type = {kind}',list(shape['properties']['payload']['properties'])))
    for label, fields in mongo_rows:
        c.setFillColor(black)
        c.setFont('Helvetica-Bold',10)
        c.drawString(start_x,y+row_h+8,label)
        x=start_x
        for field in fields:
            ww=max(75,stringWidth(field,'Helvetica',8.7)+18)
            c.setStrokeColor(HexColor('#8a6530'))
            c.setFillColor(HexColor('#fff5e4'))
            c.rect(x,y,ww,row_h,fill=1,stroke=1)
            c.setFillColor(black);c.setFont('Helvetica',8.7)
            c.drawCentredString(x+ww/2,y+8,field)
            if field=='_id':
                fw=stringWidth(field,'Helvetica',8.7);c.line(x+ww/2-fw/2,y+6,x+ww/2+fw/2,y+6)
            x+=ww
        y-=row_gap
    assert y > 40, y
    c.setFillColor(black);c.setFont('Helvetica',8.5)
    c.drawString(start_x,65,'Solid underline = PK. Dotted underline = FK (a field can be both). Red arrows = PK determines other columns. Black arrows = declared SQL FK references.')
    c.drawString(start_x,50,'Cream cells = stored generated columns. Composite FKs: transaction(account_id,currency_code) -> account(account_id,currency_code); transaction(method_id,account_id) -> payment_method(method_id,account_id).')
    c.drawString(start_x,35,'Mongo device_id/transaction_id are application-validated references, not SQL FKs; payload is one of the two shapes. No 3NF claim is made for derived fields, the view or document store.')
    c.drawRightString(w-35,20,'Source: main '+CAT['sourceCommit'][:12]+' | migrations 010-060 | 30 October 2026 | A1 landscape, vector')
    c.showPage();c.save()
    return fitz.open(path)


def render_preview(doc, name):
    page=doc[0]
    pix=page.get_pixmap(matrix=fitz.Matrix(2400/page.rect.width,2400/page.rect.width),alpha=False)
    pix.save(ROOT/'docs/printable'/name)


if __name__=='__main__':
    er=er_diagram(); schema=schema_diagram()
    render_preview(er,'finsight-er-preview.png')
    render_preview(schema,'finsight-schema-preview.png')
    # Exact text checks protect names and full schema coverage independently of visual QA.
    for doc in [er,schema]:
        content='\n'.join(page.get_text() for page in doc)
        for label in ['FinSight',*CAT['members']]:
            assert label in content,label
        for table in CAT['tables']:
            assert table['name'] in content,table['name']
            for col in table['columns']:
                assert col['name'] in content,(table['name'],col['name'])
        for attr in mongo_attributes():
            name=attr['name'] if doc is er else attr['name'].removeprefix('payload.')
            assert name in content,name
    print('Rendered both vector PDFs; all catalog table/column names and both team names are present.')
