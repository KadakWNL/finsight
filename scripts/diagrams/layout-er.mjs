import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

// Install @viz-js/viz outside the application and supply its directory as argv[2].
const { instance } = await import(pathToFileURL(`${process.argv[2]}/node_modules/@viz-js/viz/dist/viz.js`).href);
const viz = await instance();
const catalog = JSON.parse(await readFile('docs/printable/schema-catalog.json', 'utf8'));
const verbs = {
  'customer.user_id': 'links operator', 'address.customer_id': 'resides at', 'account.customer_id': 'holds',
  'payment_method.account_id': 'provides', 'transaction.account_id,currency_code': 'records',
  'transaction.method_id,account_id': 'pays via', 'transaction.merchant_id': 'receives',
  'transaction.device_id': 'originates on', 'risk_signal.transaction_id': 'has evidence',
  'risk_signal.rule_id': 'fires', 'transaction_label.transaction_id': 'has label',
  'transaction_label.scenario_id': 'classifies', 'investigation_case.transaction_id': 'investigates',
  'investigation_case.assigned_to_user_id': 'assigned to', 'case_event.case_id': 'has history',
  'case_event.actor_user_id': 'records event', 'case_command_receipt.case_id': 'has receipt',
  'case_command_receipt.actor_user_id': 'issues command', 'app_session.user_id': 'has session',
  'app_session_cleanup.admin_id': 'authorizes',
};
const relationships = [];
for (const table of catalog.tables) for (const fk of table.constraints.filter(c => c.type === 'f')) {
  const parent = fk.references_table.replace('public.', '');
  const nullable = fk.columns.some(name => !table.columns.find(c => c.name === name).not_null);
  const unique = table.constraints.some(c => ['p', 'u'].includes(c.type) && c.columns.every(name => fk.columns.includes(name)));
  relationships.push({ id: `rel${relationships.length + 1}`, parent, child: table.name, columns: fk.columns,
    parentCardinality: nullable ? '0..1' : '1', childCardinality: unique ? '0..1' : '0..N',
    label: verbs[`${table.name}.${fk.columns.join(',')}`] || 'references', enforced: true });
}
relationships.push({ id: 'mongo_device', parent: 'device_fingerprint', child: 'device_telemetry', label: 'SQL-resolved device', parentCardinality: '1', childCardinality: '0..N', enforced: false });
relationships.push({ id: 'mongo_transaction', parent: 'transaction', child: 'device_telemetry', label: 'optional context', parentCardinality: '0..1', childCardinality: '0..N', enforced: false });
const names = [...catalog.tables.map(t => t.name), 'device_telemetry'];
const lines = ['digraph FinSight {', 'graph [rankdir=LR, nodesep=0.35, ranksep=0.55, splines=ortho, pad=0.1, outputorder=edgesfirst];',
  'node [fontname="Helvetica",fontsize=9];', 'edge [arrowhead=none,fontsize=9,fontname="Helvetica",color="#334155"];'];
for (const name of names) lines.push(`"${name}" [shape=box, fixedsize=true, width=5.0, height=3.55, style=invis];`);
for (const rel of relationships) {
  const label = rel.label.replaceAll(' ', '\\n');
  lines.push(`${rel.id} [shape=diamond, label="${label}",style=filled,fillcolor="#dddff6",color="#6975a3",width=0.85,height=0.55,margin=0.04];`);
  const style = rel.enforced ? '' : ',style=dashed,color="#7c5a26"';
  lines.push(`"${rel.parent}":e -> ${rel.id}:w [taillabel="${rel.parentCardinality}",labeldistance=1.8${style}];`);
  lines.push(`${rel.id}:e -> "${rel.child}":w [headlabel="${rel.childCardinality}",labeldistance=1.8${style}];`);
}
lines.push('}');
const dot = lines.join('\n');
await writeFile('docs/printable/er-layout.dot', dot);
const layout = viz.renderJSON(dot);
await writeFile('tmp/pdfs/er-layout.json', JSON.stringify(layout));
await writeFile('tmp/pdfs/er-base.svg', viz.renderString(dot, { format: 'svg' }));
await writeFile('docs/printable/relationships.json', JSON.stringify(relationships, null, 2) + '\n');
console.log({ graphviz: viz.graphvizVersion, dimensions: layout.bb, relationships: relationships.length });
