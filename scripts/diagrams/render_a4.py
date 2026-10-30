"""Two single-sheet A4 masters, using the verified implemented schema inventory."""
import hashlib
import json
import math
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

import pymupdf as fitz
from reportlab.lib.colors import HexColor, black, white
from reportlab.lib.pagesizes import A4, landscape
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas

ROOT=Path(__file__).resolve().parents[2]
CAT=json.loads((ROOT/'docs/printable/schema-catalog.json').read_text(encoding='utf-8'))
REL=json.loads((ROOT/'docs/printable/relationships.json').read_text(encoding='utf-8'))
TABLES={t['name']:t for t in CAT['tables']}
OUT=ROOT/'output/pdf'
W,H=landscape(A4)
INK=HexColor('#17212b'); GREEN=HexColor('#e4efdc'); PINK=HexColor('#fff3f5'); BLUE=HexColor('#e5e7f7')
audit=[]


def label(c,x,y,s,size=7,bold=False,center=False,color=INK,right=False):
    c.setFont('Helvetica-Bold' if bold else 'Helvetica',size);c.setFillColor(color)
    (c.drawRightString if right else c.drawCentredString if center else c.drawString)(x,y,s)


def line(c,points,color=INK,width=.4,dash=False,arrow=False):
    c.setStrokeColor(color);c.setFillColor(color);c.setLineWidth(width)
    c.setDash(2,1.5) if dash else c.setDash()
    p=c.beginPath();p.moveTo(*points[0])
    for x,y in points[1:]:p.lineTo(x,y)
    c.drawPath(p);c.setDash()
    if arrow:
        x,y=points[-1];px,py=points[-2];a=math.atan2(y-py,x-px)
        p=c.beginPath();p.moveTo(x,y)
        p.lineTo(x+2*math.cos(a+2.6),y+2*math.sin(a+2.6))
        p.lineTo(x+2*math.cos(a-2.6),y+2*math.sin(a-2.6));p.close();c.drawPath(p,stroke=0,fill=1)


def heading(c,kind):
    c.setTitle('FinSight - '+kind+' - A4')
    c.setAuthor('Shrikar Desai; Shreyas P Kulkarni')
    label(c,17,H-21,'FinSight',17,True)
    label(c,107,H-20,kind,11,True)
    label(c,W-17,H-20,'Shrikar Desai  |  Shreyas P Kulkarni',9,True,right=True)
    line(c,[(17,H-29),(W-17,H-29)],HexColor('#a4b1bc'),.65)
    label(c,17,H-41,'Implemented schema: 17 application tables + bookkeeping + risk view + Mongo telemetry',6.8)


def footer(c,text):
    line(c,[(17,35),(W-17,35)],HexColor('#bbc3ca'),.45)
    label(c,17,24,text,6.2)
    label(c,17,13,'Current migrations 010-060 / Mongo validator | main '+CAT['sourceCommit'][:12]+' | 30 Oct 2026',6.2)
    label(c,W-17,13,'A4 landscape - print at 100%',6.2,right=True)


def mongo_fields():
    schema=CAT['mongo']['validator']['$jsonSchema']
    base=list(schema['properties'])
    shapes=[(s['properties']['shape_type']['enum'][0],list(s['properties']['payload']['properties'])) for s in schema['oneOf']]
    return base,shapes



def er():
    c=canvas.Canvas(str(OUT/'FinSight-ER-A4-Revised.pdf'),pagesize=(W,H),pageCompression=1)
    heading(c,'ER Diagram (Chen notation)')
    # Four columns, six rows. Wide relations receive two cells rather than tiny lettering.
    positions={
      'app_user':(0,0,1),'customer':(1,0,1),'account':(2,0,1),'payment_method':(3,0,1),
      'app_session':(0,1,1),'address':(1,1,1),'merchant':(2,1,1),'device_fingerprint':(3,1,1),
      'app_session_cleanup':(0,2,1),'transaction':(1,2,2),'fraud_scenario':(3,2,1),
      'investigation_case':(0,3,1),'risk_rule':(1,3,1),'risk_signal':(2,3,1),'transaction_label':(3,3,1),
      'case_event':(0,4,1),'case_command_receipt':(1,4,1),'device_telemetry':(2,4,2)}
    xs=[12,215,418,621,824];ys=[H-51-i*78 for i in range(7)]
    base,shapes=mongo_fields()
    for name,(col,row,span) in positions.items():
        x=xs[col]+13;right=xs[col+span]-12;top=ys[row]-5;cw=right-x;center=(x+right)/2
        table=TABLES.get(name)
        fields=[a['name'] for a in table['columns']] if table else base+['payload.'+a for _,attrs in shapes for a in attrs]
        pk=next((set(k['columns']) for k in table['constraints'] if k['type']=='p'),set()) if table else {'_id'}
        cols=4 if span==2 else 2;nrows=math.ceil(len(fields)/cols);cellw=cw/cols
        fill=GREEN if table and table['kind']=='r' and name!='schema_migrations' else HexColor('#fff0d8')
        c.setFillColor(fill);c.setStrokeColor(HexColor('#6e8865'));c.setLineWidth(.55)
        ew=min(cw-8, max(115,stringWidth(name,'Helvetica-Bold',7.7)+14))
        c.rect(center-ew/2,top-13,ew,13,fill=1,stroke=1);label(c,center,top-9.1,name,7.7,True,True)
        for i,field in enumerate(fields):
            fc=i//nrows;fr=i%nrows
            ax=x+(fc+.5)*cellw;ay=top-22-fr*8.3;rx=cellw/2-2.2;ry=3.65
            # A shared branch outside the ellipses leaves the labels unobstructed.
            rail=x+fc*cellw+1
            line(c,[(center,top-13),(center,top-16),(rail,top-16),(rail,ay),(ax-rx,ay)],HexColor('#c1a3ad'),.28)
            c.setStrokeColor(HexColor('#b99aa4'));c.setFillColor(PINK);c.setLineWidth(.35)
            if table and next(a for a in table['columns'] if a['name']==field)['generated']:c.setDash(2,1)
            c.ellipse(ax-rx,ay-ry,ax+rx,ay+ry,stroke=1,fill=1);c.setDash()
            size=min(6.45,(2*rx-5)/stringWidth(field,'Helvetica',1))
            label(c,ax,ay-size*.32,field,size,False,True)
            if field in pk:
                tw=stringWidth(field,'Helvetica',size);line(c,[(ax-tw/2,ay-size*.55),(ax+tw/2,ay-size*.55)],width=.35)
            audit.append({'diagram':'ER','entity':name,'attribute':field,'font':size,'box':[ax-rx,ay-ry,ax+rx,ay+ry]})
    # Each relationship is drawn separately: no shared route, crossing or implicit bus.
    ly=ys[5]-2
    label(c,20,ly,'RELATIONSHIPS - repeated entity names refer to the attribute definitions above',6.7,True)
    for index,rel in enumerate(REL):
        col=index//8;rr=index%8;x=20+col*268;y=ly-9-rr*11.8
        parent_width=78;child_width=78;diamond_width=64;gap=16;rh=9.0
        left=x;diamond_x=x+parent_width+gap+diamond_width/2;child_x=x+parent_width+gap+diamond_width+gap
        color=HexColor('#8a6530') if not rel['enforced'] else HexColor('#475462')
        for xx,name in [(left,rel['parent']),(child_x,rel['child'])]:
            c.setFillColor(GREEN if name!='device_telemetry' else HexColor('#fff0d8'))
            c.setStrokeColor(HexColor('#82947b'));c.setLineWidth(.35)
            c.rect(xx,y-rh/2,78,rh,fill=1,stroke=1)
            label(c,xx+39,y-1.8,name,min(6,(73/stringWidth(name,'Helvetica',1))),center=True)
        c.setFillColor(BLUE);c.setStrokeColor(HexColor('#7885aa'))
        pp=c.beginPath();pp.moveTo(diamond_x,y+5.4);pp.lineTo(diamond_x+32,y);pp.lineTo(diamond_x,y-5.4);pp.lineTo(diamond_x-32,y);pp.close();c.drawPath(pp,stroke=1,fill=1)
        verb={'SQL-resolved device':'device context','optional context':'context'}.get(rel['label'],rel['label'])
        label(c,diamond_x,y-1.6,verb,min(5.2,54/stringWidth(verb,'Helvetica',1)),center=True)
        for ax,bx,count in [(left+78,diamond_x-32,rel['parentCardinality']), (diamond_x+32,child_x,rel['childCardinality'])]:
            line(c,[(ax,y),(bx,y)],color,.4,not rel['enforced'])
            tw=stringWidth(count,'Helvetica',4.7)
            c.setFillColor(white);c.rect((ax+bx-tw)/2-1,y-2.6,tw+2,5.5,fill=1,stroke=0)
            label(c,(ax+bx)/2,y-1.55,count,4.7,center=True)
    # Non-domain SQL objects are small explicit attribute strips, not extra business entities.
    for name,x,width in [('schema_migrations',20,365),('v_transaction_risk',420,400)]:
        label(c,x,41.5,name+':',6.0,True)
        xx=x+stringWidth(name+':','Helvetica-Bold',6.0)+5
        for attr in TABLES[name]['columns']:
            field=attr['name'];ww=stringWidth(field,'Helvetica',5.9)+8
            label(c,xx+ww/2,41.5,field,5.9,center=True)
            audit.append({'diagram':'ER','entity':name,'attribute':field,'font':5.9,'box':[xx,38,xx+ww,46]})
            xx+=ww
    footer(c,'Underline = PK; dashed oval = generated. Each local diamond is a separate relationship; brown dashed connectors are Mongo references, not SQL FKs.')
    c.showPage();c.save()


def pack_fields(fields,width,font=7.2):
    bands=[[]];used=0
    for field in fields:
        ww=max(27,stringWidth(field,'Helvetica',font)+8)
        if used+ww>width:bands.append([]);used=0
        bands[-1].append((field,ww));used+=ww
    return bands


def fk_continuation(c,x,y,refs,width=239):
    # Short, isolated arrows name their endpoints; there is no route shared with another table.
    parsed=[tuple(ref.split(' -> ',1)) for ref in refs]
    unit=stringWidth('FK ','Helvetica',1)+sum(stringWidth(a+b,'Helvetica',1) for a,b in parsed)
    gaps=16*len(parsed)+7*max(0,len(parsed)-1)
    size=min(6.0,(width-gaps)/unit)
    label(c,x,y,'FK ',size,True);xx=x+stringWidth('FK ','Helvetica-Bold',size)
    for i,(source,target) in enumerate(parsed):
        if i:xx+=7
        label(c,xx,y,source,size);xx+=stringWidth(source,'Helvetica',size)+2
        line(c,[(xx,y+size*.3),(xx+9,y+size*.3)],width=.45,arrow=True);xx+=13
        label(c,xx,y,target,size);xx+=stringWidth(target,'Helvetica',size)


def schema():
    c=canvas.Canvas(str(OUT/'FinSight-Schema-A4-Revised.pdf'),pagesize=(W,H),pageCompression=1)
    heading(c,'Relational Schema Diagram')
    positions={
      'app_user':(0,0,1),'customer':(0,1,1),'address':(0,2,1),'account':(0,3,1),
      'payment_method':(0,4,1),'app_session':(0,5,1),'app_session_cleanup':(0,6,1),'schema_migrations':(0,7,1),
      'merchant':(1,0,1),'device_fingerprint':(1,1,1),'transaction':(1,2,2),'risk_rule':(1,4,1),
      'risk_signal':(1,5,1),'fraud_scenario':(1,6,1),'transaction_label':(1,7,1),
      'investigation_case':(2,0,1),'case_event':(2,1,1),'case_command_receipt':(2,2,1),'v_transaction_risk':(2,3,1)}
    xs=[12,283,554,825];ys=[H-51-i*61.1 for i in range(9)]
    boxes={};bands_by={}
    for name,(col,row,span) in positions.items():
        x=xs[col]+17;top=ys[row]-5;bands=pack_fields([a['name'] for a in TABLES[name]['columns']],239)
        bands_by[name]=bands;boxes[name]={}
        for bi,band in enumerate(bands):
            xx=x;y=top-22-bi*14
            for field,ww in band:boxes[name][field]=(xx,y,ww,12);xx+=ww
        assert 22+len(bands)*14 <=61.1*span+6,name
    red=HexColor('#b72b2b')
    for name,(col,row,span) in positions.items():
        table=TABLES[name];x=xs[col]+17;top=ys[row]-5
        pk=next((set(k['columns']) for k in table['constraints'] if k['type']=='p'),set())
        fks={a for k in table['constraints'] if k['type']=='f' for a in k['columns']}
        label(c,x,top-5,name,8.2,True)
        for bi,band in enumerate(bands_by[name]):
            by=top-22-bi*14;bar=by+13.5
            if pk:
                centers=[boxes[name][f][0]+boxes[name][f][2]/2 for f,_ in band if f not in pk]
                if centers:
                    line(c,[(x-3,bar),(max(centers),bar)],red,.35)
                    if bi>0:line(c,[(x-3,top-8.5),(x-3,bar)],red,.35)
                    for xx in centers:line(c,[(xx,bar),(xx,by+12)],red,.35,arrow=True)
            for field,ww in band:
                xx,yy,_,hh=boxes[name][field]
                generated=next(a for a in table['columns'] if a['name']==field)['generated']
                c.setFillColor(HexColor('#fff3dd') if generated else white);c.setStrokeColor(HexColor('#858b92'));c.setLineWidth(.4)
                c.rect(xx,yy,ww,hh,fill=1,stroke=1);label(c,xx+ww/2,yy+3.4,field,7.2,center=True)
                tw=stringWidth(field,'Helvetica',7.2)
                if field in pk:
                    line(c,[(xx+ww/2-tw/2,yy+2.5),(xx+ww/2+tw/2,yy+2.5)],width=.4)
                    line(c,[(xx+ww/2,yy+12),(xx+ww/2,top-8.5),(x-3,top-8.5)],red,.35)
                if field in fks:line(c,[(xx+ww/2-tw/2,yy+1.2),(xx+ww/2+tw/2,yy+1.2)],width=.35,dash=True)
                audit.append({'diagram':'Schema','entity':name,'attribute':field,'font':7.2,'box':[xx,yy,xx+ww,yy+hh]})
        refs=[]
        for fk in table['constraints']:
            if fk['type']!='f':continue
            parent=fk['references_table'].replace('public.','')
            if len(fk['columns'])>1:
                refs.append('('+','.join(fk['columns'])+') -> '+parent+'('+','.join(fk['references_columns'])+')')
            else:
                refs.append(fk['columns'][0]+' -> '+parent+'.'+fk['references_columns'][0])
        if refs:
            last_bottom=min(cell[1] for cell in boxes[name].values())
            if name=='transaction':
                for i,ref in enumerate(refs):fk_continuation(c,x,last_bottom-8-i*7,[ref])
            else:
                fk_continuation(c,x,last_bottom-8,refs)
    base,shapes=mongo_fields()
    supplements=[('device_telemetry [Mongo]',base),*[(kind+' : payload',fields) for kind,fields in shapes]]
    for row,(name,fields) in enumerate(supplements,4):
        x=xs[2]+17;top=ys[row]-5;label(c,x,top-7,name,7.5,True)
        for bi,band in enumerate(pack_fields(fields,239,7.2)):
            xx=x;yy=top-22-bi*14
            for field,ww in band:
                c.setFillColor(HexColor('#fff3dd'));c.setStrokeColor(HexColor('#aa916b'));c.setLineWidth(.4)
                c.rect(xx,yy,ww,12,fill=1,stroke=1);label(c,xx+ww/2,yy+3.4,field,7.2,center=True)
                if field=='_id':line(c,[(xx+ww/2-4,yy+2.3),(xx+ww/2+4,yy+2.3)],width=.4)
                audit.append({'diagram':'Schema','entity':name,'attribute':field,'font':7.2,'box':[xx,yy,xx+ww,yy+12]})
                xx+=ww
    x=xs[2]+17;top=ys[7]-5
    for i,s in enumerate(['KEY: solid underline PK; dotted underline FK.', 'Red arrows stay inside their own relation.',
                          'FK source -> target is written below each relation.', 'Mongo references are not SQL FKs.',
                          'Bookkeeping/view are implementation supplements.']):label(c,x,top-8-i*8,s,6.5,i==0)
    footer(c,'All attributes retained. FK continuations explicitly name both source and target. No cross-page lines or shared buses. Cream cells are generated.')
    c.showPage();c.save()


def finish():
    files=[]
    for name,kind in [('FinSight-ER-A4-Revised.pdf','ER'),('FinSight-Schema-A4-Revised.pdf','Schema')]:
        p=OUT/name;d=fitz.open(p);assert len(d)==1
        assert abs(d[0].rect.width-W)<.1 and abs(d[0].rect.height-H)<.1
        content=d[0].get_text()
        for expected in ['FinSight',*CAT['members']]:assert expected in content,expected
        for table in CAT['tables']:
            assert table['name'] in content,table['name']
            for attr in table['columns']:assert attr['name'] in content,(table['name'],attr['name'])
        for item in audit:
            if item['diagram']==kind:
                x0,y0,x1,y1=item['box'];assert 0<x0<x1<W and 35<y0<y1<H-45,item
        d[0].get_pixmap(matrix=fitz.Matrix(2,2),alpha=False).save(ROOT/'docs/printable'/('finsight-'+kind.lower()+'-preview.png'))
        if kind=='ER':(ROOT/'docs/printable/finsight-er-diagram.svg').write_text(d[0].get_svg_image(),encoding='utf-8')
        files.append({'file':'output/pdf/'+name,'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'pages':1,'paper':'A4 landscape','widthPoints':W,'heightPoints':H})
    (ROOT/'docs/printable/a4-layout.json').write_text(json.dumps(audit,indent=2)+'\n',encoding='utf-8')
    manifest={'title':CAT['title'],'members':CAT['members'],'sourceCommit':CAT['sourceCommit'],'applicationTables':17,
              'toolingTables':1,'views':1,'sqlAttributes':161,'declaredSqlForeignKeys':20,'paper':'A4 landscape',
              'catalogAttributeCoverage':'passed','files':files}
    (ROOT/'docs/printable/verification.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
    with ZipFile(OUT/'FinSight-A4-Revised.zip','w',ZIP_DEFLATED) as z:
        for name in ['FinSight-ER-A4-Revised.pdf','FinSight-Schema-A4-Revised.pdf']:z.write(OUT/name,name)
        for name in ['finsight-er-preview.png','finsight-schema-preview.png','schema-catalog.json','verification.json']:
            z.write(ROOT/'docs/printable'/name,'reference/'+name)
        z.writestr('README.txt','FinSight\nShrikar Desai | Shreyas P Kulkarni\n\nBoth diagrams are ONE A4 landscape page each. Print at 100% on A4; no poster scaling is needed. All current attributes are retained.\n')
    print('Both diagrams: one A4 landscape page, all SQL attributes present, names verified, bounds passed.')


if __name__=='__main__':er();schema();finish()
