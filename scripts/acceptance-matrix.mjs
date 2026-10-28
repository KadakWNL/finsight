const auth = (match) => ({ stage: 'api', file: 'tests/api/auth.test.ts', match });
const cases = (match) => ({ stage: 'api', file: 'tests/api/cases.test.ts', match });
const gaps = (match) => ({ stage: 'api', file: 'tests/api/acceptance-gaps.test.ts', match });
const transactions = (match) => ({ stage: 'api', file: 'tests/api/transactions.test.ts', match });
const browser = (file, match) => ({ stage: 'browser', file: `tests/e2e/${file}.spec.ts`, match });
const phase = (stage) => ({ stage, file: undefined, match: undefined });
const demo = browser('mvp-acceptance', 'recorded analyst/admin investigation');

// Responsibility follows the acceptance plan; this is not a record of human sign-off.
export const acceptanceMatrix = [
  { id: 'VS01', owner: 'ShrikarDesai07', title: 'Human sign-in and protected deep links', evidence: [auth('authenticates active analyst'), auth('authenticates active admin'), demo] },
  { id: 'VS02', owner: 'ShrikarDesai07', title: 'Generic rejection, expiry and revoked-cookie replay', evidence: [auth('generic error on wrong password'), auth('generic error on inactive user'), auth('generic error on system'), auth('idle timeout has elapsed'), auth('absolute timeout has elapsed'), auth('round trips the login cookie'), browser('auth', 'Auth.js login protects')] },
  { id: 'VS03', owner: 'ShrikarDesai07', title: 'Current role and active-state enforcement', evidence: [auth('immediately reflects role changes'), auth('immediately reflects user deactivation'), gaps('VS03:')] },
  { id: 'VS04', owner: 'KadakWNL', title: 'Risk explanations, bounded filters and stable paging', evidence: [transactions('masked facts, decimal strings and zero-signal'), transactions('composes exact-ID'), transactions('pages tied timestamps'), phase('risk'), demo] },
  { id: 'VS05', owner: 'KadakWNL', title: 'Exact currencies and rejected financial invariants', evidence: [transactions('masked facts, decimal strings and zero-signal'), phase('financial-sql'), phase('financial-plans'), phase('operational-sql')] },
  { id: 'VS06', owner: 'ShrikarDesai07', title: 'Atomic self-assigned case creation and event shape', evidence: [cases('VS06:'), phase('case-sql'), demo] },
  { id: 'VS07', owner: 'ShrikarDesai07', title: 'Idempotency and competing creation', evidence: [cases('VS07:'), cases('serializes same-key retries')] },
  { id: 'VS08', owner: 'ShrikarDesai07', title: 'Concealed peer cases and denied administrative actions', evidence: [cases('VS08:'), browser('case-ui', 'concealed peer case')] },
  { id: 'VS09', owner: 'ShrikarDesai07', title: 'Invalid transitions and bounded rationale', evidence: [cases('VS09:'), gaps('VS09:'), phase('case-sql')] },
  { id: 'VS10', owner: 'ShrikarDesai07', title: 'Review, escalation and administrative return', evidence: [cases('VS10:'), demo] },
  { id: 'VS11', owner: 'ShrikarDesai07', title: 'All outcomes through both authorized paths', evidence: [gaps('VS11:'), cases('VS11:'), demo] },
  { id: 'VS12', owner: 'ShrikarDesai07', title: 'Repeated reopen and preserved terminal history', evidence: [cases('VS12:'), gaps('VS12:'), demo] },
  { id: 'VS13', owner: 'ShrikarDesai07', title: 'Denied and competing-subject reopening', evidence: [cases('VS13:'), phase('case-sql')] },
  { id: 'VS14', owner: 'Both', title: 'Concurrent versions, atomic failure rollback and retained draft', evidence: [cases('VS14:'), gaps('VS14:'), browser('case-ui', 'Optimistic concurrency'), browser('mvp-acceptance', 'two real tabs'), phase('financial-plans')] },
  { id: 'VS15', owner: 'Both', title: 'Runtime privileges and immutable-event triggers', evidence: [cases('VS15:'), phase('financial-sql'), browser('mvp-acceptance', 'runtime database role rejects')] },
  { id: 'VS16', owner: 'Both', title: 'Administrative and cross-store mutation gates stay closed', evidence: [browser('mvp-acceptance', 'VS16:')] },
];

export function evaluateMatrix(stages, records) {
  return acceptanceMatrix.map(scenario => {
    const evidence = scenario.evidence.map(required => {
      const stage = stages.find(value => value.id === required.stage);
      const matched = required.match ? records.filter(value => value.stage === required.stage
        && value.file.replaceAll('\\', '/').endsWith(required.file) && value.title.includes(required.match)) : [];
      const passed = stage?.status === 'passed' && (!required.match || matched.length > 0 && matched.every(value => value.status === 'passed'));
      return { ...required, status: passed ? 'passed' : 'blocking', tests: matched.map(value => ({ title: value.title, status: value.status })) };
    });
    return { id: scenario.id, owner: scenario.owner, title: scenario.title,
      status: evidence.every(value => value.status === 'passed') ? 'passed' : 'blocking', evidence };
  });
}

export function vitestRecords(report, stage) {
  return (report.testResults ?? []).flatMap(suite => (suite.assertionResults ?? []).map(result => ({
    stage, file: suite.name, title: result.fullName, status: result.status,
  })));
}

export function playwrightRecords(report) {
  const records = [];
  function visit(suite, parents = []) {
    const titles = [...parents, suite.title ?? ''];
    for (const spec of suite.specs ?? []) {
      const results = (spec.tests ?? []).flatMap(value => value.results ?? []);
      const rawFile = (spec.file ?? suite.file ?? '').replaceAll('\\', '/');
      const root = (report.config?.rootDir ?? 'tests/e2e').replaceAll('\\', '/');
      const file = rawFile.startsWith('tests/') || rawFile.startsWith('/') || /^[A-Z]:\//i.test(rawFile) ? rawFile : `${root}/${rawFile}`;
      records.push({ stage: 'browser', file, title: [...titles, spec.title].join(' '),
        status: results.length > 0 && results.every(value => value.status === 'passed') ? 'passed' : 'blocking' });
    }
    for (const child of suite.suites ?? []) visit(child, titles);
  }
  for (const suite of report.suites ?? []) visit(suite);
  return records;
}
