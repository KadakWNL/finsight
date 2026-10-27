'use client';
import Link from 'next/link';
import { compactRecordId, formatTime } from '@/lib/workspace';
import type { TransactionRow } from '@/lib/transaction-types';
import { RiskBadge } from './ui';
import { TransactionAmount, useDisplayPreferences } from './display-preferences';

export function TransactionTable({rows,returnTo,sort='occurred_at',order='desc'}:{rows:TransactionRow[];returnTo:string;sort?:string;order?:string}) {
  const { timeZone } = useDisplayPreferences();
  const sorted=(key:string)=>sort===key?order==='asc'?'ascending' as const:'descending' as const:undefined;
  return <div className="table-scroll" tabIndex={0} aria-label="Transaction results, scroll horizontally for more columns"><table className="transaction-table"><caption className="sr-only">Transactions with original amounts, INR base values and recorded risk</caption>
    <thead><tr><th scope="col" aria-sort={sorted('occurred_at')}>Time ({timeZone})</th><th scope="col">Transaction / merchant</th><th scope="col">Account</th><th scope="col" aria-sort={sorted('amount')}>Amount</th><th scope="col" aria-sort={sorted('status')}>Status</th><th scope="col" aria-sort={sorted('risk_score')}>Recorded risk</th><th scope="col">Case</th></tr></thead>
    <tbody>{rows.map(row=><tr key={row.transaction_id}><td><time dateTime={row.occurred_at}>{formatTime(row.occurred_at, timeZone)}</time></td>
      <td><Link className="transaction-link merchant-link" aria-label={'View transaction '+row.transaction_id} href={'/transactions/'+row.transaction_id+'?returnTo='+encodeURIComponent(returnTo)}>{row.merchant_name}</Link><span className="cell-secondary identifier" title={'Transaction ID: '+row.transaction_id}>{compactRecordId('transaction',row.transaction_id)}</span></td>
      <td>{row.account.number_masked}<span className="cell-secondary identifier" title={'Account ID: '+row.account_id}>{compactRecordId('account',row.account_id)}</span></td><td className="numeric"><TransactionAmount amount={row.amount} currencyCode={row.currency_code} amountBase={row.amount_base}/></td>
      <td><span className="status-label">{row.status}</span></td><td><RiskBadge band={row.risk_band}/><span className="cell-secondary numeric">{row.risk_score} points</span><span className="cell-secondary">{row.signal_count ? `${row.signal_count} recorded signals` : 'No recorded signals'}</span></td>
      <td>{!row.active_case.exists?<span className="muted">No active case</span>:row.active_case.access==='permitted'?<span className="identifier">{row.active_case.case_ref}</span>:'Existing case'}</td></tr>)}</tbody>
  </table></div>;
}
