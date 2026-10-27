'use client';
import Link from 'next/link';
import { useApi } from './use-api';
import { EmptyState, ErrorState, LoadingState, PageHeading } from './ui';
import { TransactionTable } from './transaction-table';
import { formatMoney, formatTime } from '@/lib/workspace';
import type { OverviewData, TransactionPage } from '@/lib/transaction-types';

export function OverviewScreen({admin=false}:{admin?:boolean}) {
  const work=useApi<OverviewData>('/api/v1/overview');
  const high=useApi<TransactionPage>('/api/v1/transactions?risk=high&page_size=5');
  const critical=useApi<TransactionPage>('/api/v1/transactions?risk=critical&page_size=5');
  const path=admin?'/admin':'/overview';
  const signals=[...(high.data?.data??[]),...(critical.data?.data??[])].sort((a,b)=>b.occurred_at.localeCompare(a.occurred_at)||b.transaction_id.localeCompare(a.transaction_id)).slice(0,5);
  return <><PageHeading title={admin?'Team overview':'Your overview'} description={admin?'Review active team work and recent transactions that need attention.':'Start with your assigned work, then explore the latest risk evidence.'}/>
    <section className="work-panel" aria-labelledby="work-title"><div className="panel-heading"><h2 id="work-title">{admin?'Active team work':'Your active work'}</h2><p>Due date first · up to 25 cases</p></div>
      {work.error?<div className="panel-content"><ErrorState {...work.error} returnTo={path} retry={work.reload}/></div>:work.loading?<LoadingState label="Loading assigned work"/>:!work.data?.data.length?<EmptyState title="No active work"><p>{admin?'There are no active cases.':'You have no assigned active cases.'} Explore transactions to review evidence.</p><Link href="/transactions">Explore transactions</Link></EmptyState>:<>
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Active cases"><table className="work-table"><caption className="sr-only">Active cases ordered by due date and priority</caption><thead><tr>{['Case / status','Subject transaction','Priority','Due (UTC)',...(admin?['Owner']:[])].map(label=><th scope="col" key={label}>{label}</th>)}</tr></thead><tbody>{work.data.data.map(row=><tr key={row.case_id}><td><Link className="transaction-link" href={'/cases/'+row.case_id+'?returnTo='+encodeURIComponent(path)}><strong>{row.case_ref}</strong></Link><span className="cell-secondary">{row.status.replaceAll('_',' ')}</span></td><td><Link className="transaction-link" href={'/transactions/'+row.transaction_id+'?returnTo='+encodeURIComponent(path)}>{row.merchant_name}</Link><span className="cell-secondary">{formatMoney(row.amount,row.currency_code)}</span></td><td>{row.priority}</td><td>{formatTime(row.due_at)}</td>{admin?<td>{row.owner_label??'Unassigned'}</td>:null}</tr>)}</tbody></table></div>
        {work.data.has_more?<p className="panel-content muted">Showing the first 25 active cases.</p>:null}</>}
    </section>
    <section className="work-panel" aria-labelledby="attention-title"><div className="panel-heading"><div><h2 id="attention-title">Recent high and critical risk</h2><p>Latest 5 · current risk totals · synthetic transactions</p></div><Link href="/transactions?risk=high">Explore high risk</Link></div>
      {high.error||critical.error?<div className="panel-content"><ErrorState {...(high.error??critical.error)!} returnTo={path} retry={()=>{high.reload();critical.reload();}}/></div>:high.loading||critical.loading?<LoadingState label="Loading recent risk"/>:!signals.length?<EmptyState title="No high or critical risk transactions"><p>Browse all transactions to inspect the recorded evidence.</p></EmptyState>:<TransactionTable rows={signals} returnTo={path}/>}</section>
  </>;
}
