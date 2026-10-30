"""Check print masters against the exported catalog and current migration sources."""
import hashlib
import json
from pathlib import Path
import pymupdf

root=Path(__file__).resolve().parents[2]
catalog=json.loads((root/'docs/printable/schema-catalog.json').read_text(encoding='utf-8'))
migration_files=sorted((root/'migrations').glob('*.sql'))
assert [p.name for p in migration_files]==[m['filename'] for m in catalog['migrations']]
for source,migration in zip(migration_files,catalog['migrations']):
    assert hashlib.sha256(source.read_bytes()).hexdigest()==migration['checksum'],source.name

layout=json.loads((root/'docs/printable/a4-layout.json').read_text(encoding='utf-8'))
for table in catalog['tables']:
    for diagram in ['ER','Schema']:
        actual=[row['attribute'] for row in layout if row['diagram']==diagram and row['entity']==table['name']]
        assert set(actual)=={column['name'] for column in table['columns']},(diagram,table['name'])
        assert len(actual)==len(table['columns']),(diagram,table['name'])

files=[]
for filename in ['FinSight-ER-A4-Revised.pdf','FinSight-Schema-A4-Revised.pdf']:
    path=root/'output/pdf'/filename
    document=pymupdf.open(path)
    assert len(document)==1
    assert abs(document[0].rect.width-841.8898)<.1 and abs(document[0].rect.height-595.2756)<.1
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
                  'pages':1,'paper':'A4 landscape','widthPoints':document[0].rect.width,'heightPoints':document[0].rect.height})
manifest={'title':catalog['title'],'members':catalog['members'],'sourceCommit':catalog['sourceCommit'],
          'applicationTables':17,'toolingTables':1,'views':1,'sqlAttributes':sum(len(t['columns']) for t in catalog['tables']),
          'declaredSqlForeignKeys':sum(c['type']=='f' for t in catalog['tables'] for c in t['constraints']),
          'mongoCollection':catalog['mongo']['collection'],'migrationChecksumsMatch':True,
          'catalogAttributeCoverage':'passed','deferredEntitiesExcluded':True,'paper':'A4 landscape','files':files}
(root/'docs/printable/verification.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
print(json.dumps(manifest,indent=2))
