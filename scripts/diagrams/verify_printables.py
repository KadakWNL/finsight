"""Check print masters against the exported catalog and current migration sources."""
import hashlib
import json
from pathlib import Path
import xml.etree.ElementTree as ET
import pymupdf

root=Path(__file__).resolve().parents[2]
catalog=json.loads((root/'docs/printable/schema-catalog.json').read_text(encoding='utf-8'))
migration_files=sorted((root/'migrations').glob('*.sql'))
assert [p.name for p in migration_files]==[m['filename'] for m in catalog['migrations']]
for source,migration in zip(migration_files,catalog['migrations']):
    assert hashlib.sha256(source.read_bytes()).hexdigest()==migration['checksum'],source.name

svg=ET.parse(root/'docs/printable/finsight-er-diagram.svg')
ns={'s':'http://www.w3.org/2000/svg'}
for table in catalog['tables']:
    group=svg.find(f".//s:g[@id='entity-{table['name']}']",ns)
    assert group is not None,table['name']
    labels={node.text for node in group.findall('s:text',ns)}
    assert {column['name'] for column in table['columns']} <= labels,table['name']
    assert len(group.findall('s:ellipse',ns))==len(table['columns']),table['name']

files=[]
for filename in ['FinSight-ER-Diagram.pdf','FinSight-Schema-Diagram.pdf']:
    path=root/'output/pdf'/filename
    document=pymupdf.open(path)
    assert len(document)==1
    text=document[0].get_text()
    for expected in [catalog['title'],*catalog['members']]:
        assert expected in text,expected
    for table in catalog['tables']:
        assert table['name'] in text
        for column in table['columns']:
            assert column['name'] in text,(table['name'],column['name'])
    for deferred in ['semantic_document','personal_data_redaction']:
        assert deferred not in text.lower(),deferred
    files.append({'file':str(path.relative_to(root)).replace('\\','/'),'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),
                  'pages':1,'widthPoints':document[0].rect.width,'heightPoints':document[0].rect.height})
manifest={'title':catalog['title'],'members':catalog['members'],'sourceCommit':catalog['sourceCommit'],
          'applicationTables':17,'toolingTables':1,'views':1,'sqlAttributes':sum(len(t['columns']) for t in catalog['tables']),
          'declaredSqlForeignKeys':sum(c['type']=='f' for t in catalog['tables'] for c in t['constraints']),
          'mongoCollection':catalog['mongo']['collection'],'migrationChecksumsMatch':True,
          'catalogAttributeCoverage':'passed','deferredEntitiesExcluded':True,'files':files}
(root/'docs/printable/verification.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
print(json.dumps(manifest,indent=2))
