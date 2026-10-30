"""Two single-sheet A4 masters, using the verified implemented schema inventory."""
import hashlib
import heapq
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


class Router:
    def __init__(self,xs,ys,blocked=None):self.xs=xs;self.ys=ys;self.usage={};self.blocked=blocked or set()
    def route(self,start,end):
        q=[(0,start)];distance={start:0};prev={}
        while q:
            cost,node=heapq.heappop(q)
            if node==end:break
            if cost!=distance[node]:continue
            i,j=node
            for nxt in [(i-1,j),(i+1,j),(i,j-1),(i,j+1)]:
                if not (0<=nxt[0]<len(self.xs) and 0<=nxt[1]<len(self.ys)):continue
                edge=tuple(sorted([node,nxt]))
                if edge in self.blocked:continue
                nc=cost+1+self.usage.get(edge,0)*.35
                if nc<distance.get(nxt,1e9):distance[nxt]=nc;prev[nxt]=node;heapq.heappush(q,(nc,nxt))
        path=[end]
        while path[-1]!=start:path.append(prev[path[-1]])
        path.reverse()
        for a,b in zip(path,path[1:]):
            edge=tuple(sorted([a,b]));self.usage[edge]=self.usage.get(edge,0)+1
        return path
    def points(self,path,offset=0):return [(self.xs[i]+offset,self.ys[j]) for i,j in path]


def er():
    c=canvas.Canvas(str(OUT/'FinSight-ER-Diagram-A4.pdf'),pagesize=(W,H),pageCompression=1)
    heading(c,'ER Diagram (Chen notation)')
    # Four columns, six rows. Wide relations receive two cells rather than tiny lettering.
    positions={
      'app_user':(0,0,1),'customer':(1,0,1),'account':(2,0,1),'payment_method':(3,0,1),
      'app_session':(0,1,1),'address':(1,1,1),'merchant':(2,1,1),'device_fingerprint':(3,1,1),
      'app_session_cleanup':(0,2,1),'transaction':(1,2,2),'fraud_scenario':(3,2,1),
      'investigation_case':(0,3,1),'risk_rule':(1,3,1),'risk_signal':(2,3,1),'transaction_label':(3,3,1),
      'case_event':(0,4,1),'case_command_receipt':(1,4,1),'device_telemetry':(2,4,2),
      'schema_migrations':(0,5,1),'v_transaction_risk':(1,5,1)}
    xs=[12,215,418,621,824];ys=[H-51-i*81.5 for i in range(7)]
    blocked={tuple(sorted([(k,r),(k,r+1)])) for col,r,span in positions.values() for k in range(col+1,col+span)}
    router=Router(xs,ys,blocked);slots=set();routes=[]
    for index,rel in enumerate(REL):
        pc,pr,ps=positions[rel['parent']];cc,cr,cs=positions[rel['child']]
        # Relationship diamonds occupy gutter space, never attribute space.
        choices=[(abs(k-(pc+ps))+abs(k-(cc+cs))+abs(r-pr)+abs(r-cr),k,r)
                 for k in range(5) for r in range(6) if (k,r) not in slots and tuple(sorted([(k,r),(k,r+1)])) not in blocked]
        _,k,r=min(choices);slots.add((k,r))
        start=(pc+ps,pr);end=(cc+cs,cr)
        before=router.points(router.route(start,(k,r)),offset=8+(index%4)*.7)
        after=router.points(router.route((k,r+1),end),offset=8+(index%4)*.7)
        sx=(xs[pc]+xs[pc+ps])/2;tx=(xs[cc]+xs[cc+cs])/2
        cy=(ys[r]+ys[r+1])/2;dx=xs[k];dy=cy
        color=HexColor('#8a6530') if not rel['enforced'] else HexColor('#4d5863')
        points=[(sx,ys[pr]-7),(sx,ys[pr]),*before,(before[-1][0],dy+9),(dx,dy+7)]
        line(c,points,color,.35,not rel['enforced'])
        line(c,[(dx,dy-7),(after[0][0],dy-9),*after,(tx,ys[cr]),(tx,ys[cr]-7)],color,.35,not rel['enforced'])
        routes.append((index,dx,dy,rel))
    for index,x,y,rel in routes:
        c.setStrokeColor(HexColor('#7885aa'));c.setFillColor(BLUE);c.setLineWidth(.4)
        p=c.beginPath();p.moveTo(x,y+7);p.lineTo(x+7,y);p.lineTo(x,y-7);p.lineTo(x-7,y);p.close();c.drawPath(p,fill=1,stroke=1)
        label(c,x,y-1.7,f'{index+1:02}',5.4,True,True)
        label(c,x,y+9,rel['parentCardinality'],4.8,center=True)
        label(c,x,y-13.5,rel['childCardinality'],4.8,center=True)
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
    # Relationship names and explicit endpoint cardinalities in the two remaining cells.
    lx=xs[2]+15;ly=ys[5]-11
    label(c,lx,ly,'RELATIONSHIPS  (parent -> child; counts at the two ends)',6.7,True)
    for index,rel in enumerate(REL):
        column=index//11;rr=index%11
        s=f'{index+1:02} {rel["label"]}: {rel["parent"]}/{rel["child"]} [{rel["parentCardinality"]}:{rel["childCardinality"]}]'
        label(c,lx+column*194,ly-10-rr*5.7,s,min(5.75,185/stringWidth(s,'Helvetica',1)))
    footer(c,'Underline = PK; dashed oval = generated. Diamonds are numbered in the relationship key. Brown dashed links = validated Mongo references, not SQL FKs.')
    c.showPage();c.save()


def pack_fields(fields,width,font=7.2):
    bands=[[]];used=0
    for field in fields:
        ww=max(27,stringWidth(field,'Helvetica',font)+8)
        if used+ww>width:bands.append([]);used=0
        bands[-1].append((field,ww));used+=ww
    return bands


def schema():
    c=canvas.Canvas(str(OUT/'FinSight-Schema-Diagram-A4.pdf'),pagesize=(W,H),pageCompression=1)
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
    blocked={tuple(sorted([(col,r),(col+1,r)])) for col,row,span in positions.values() for r in range(row+1,row+span)}
    router=Router(xs,ys,blocked)
    for i,(table,fk) in enumerate((t,k) for t in CAT['tables'] for k in t['constraints'] if k['type']=='f'):
        parent=fk['references_table'].replace('public.','');sc,sr,_=positions[table['name']];tc,tr,_=positions[parent]
        route=router.points(router.route((sc,sr),(tc,tr)),offset=3+(i%4)*.7)
        for source,target in zip(fk['columns'],fk['references_columns']):
            sx,sy,sw,_=boxes[table['name']][source];tx,ty,tw,_=boxes[parent][target]
            sx+=sw/2;tx+=tw/2
            startx=xs[sc]+3+(i%4)*.7;endx=xs[tc]+3+(i%4)*.7
            pts=[(sx,sy),(sx,sy-1),(startx,sy-1),(startx,ys[sr]),*route,(endx,ty-1),(tx,ty-1),(tx,ty)]
            line(c,pts,HexColor('#5b626b'),.3,arrow=True)
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
        if name=='transaction':
            label(c,x,top-88,'Cream = stored generated fields.',6.3)
            label(c,x,top-98,'Composite FKs retain the exact account/currency',6.1)
            label(c,x,top-106,'and payment-method/account column pairings.',6.1)
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
    for i,s in enumerate(['KEY: solid underline PK; dotted underline FK.', 'Red arrows: PK dependencies; black arrows: FKs.',
                          'Attribute strips wrap within the same relation.', 'Mongo references are not SQL FKs.',
                          'Bookkeeping/view are implementation supplements.']):label(c,x,top-8-i*8,s,6.5,i==0)
    footer(c,'All attributes retained. View has no declared PK; candidate_session_ids is an audit array, not an FK. Deferred design entities are excluded.')
    c.showPage();c.save()


def finish():
    files=[]
    for name,kind in [('FinSight-ER-Diagram-A4.pdf','ER'),('FinSight-Schema-Diagram-A4.pdf','Schema')]:
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
    with ZipFile(OUT/'FinSight-A4-Diagrams.zip','w',ZIP_DEFLATED) as z:
        for name in ['FinSight-ER-Diagram-A4.pdf','FinSight-Schema-Diagram-A4.pdf']:z.write(OUT/name,name)
        for name in ['finsight-er-preview.png','finsight-schema-preview.png','schema-catalog.json','verification.json']:
            z.write(ROOT/'docs/printable'/name,'reference/'+name)
        z.writestr('README.txt','FinSight\nShrikar Desai | Shreyas P Kulkarni\n\nBoth diagrams are ONE A4 landscape page each. Print at 100% on A4; no poster scaling is needed. All current attributes are retained.\n')
    print('Both diagrams: one A4 landscape page, all SQL attributes present, names verified, bounds passed.')


if __name__=='__main__':er();schema();finish()
