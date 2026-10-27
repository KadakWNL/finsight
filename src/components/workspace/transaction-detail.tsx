'use client';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { useApi } from './use-api';
import { EmptyState, ErrorState, LoadingState, PageHeading, RiskBadge } from './ui';
import { CreateCaseDialog } from './create-case-dialog';
import { RecordIdentifier } from './record-identifier';
import { formatMoney, formatTime, type HumanRole } from '@/lib/workspace';
import type { TransactionDetail } from '@/lib/transaction-types';

function Facts({rows}:{rows:[string,React.ReactNode][]}) {return <dl className="facts">{rows.map(([label,value])=><div className="fact-pair" key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;}
export function TransactionDetailScreen({id,returnTo,role}:{id:string;returnTo:string;role:HumanRole}) {
  const read=useApi<{data:TransactionDetail;request_id:string}>('/api/v1/transactions/'+encodeURIComponent(id));
  const [created,setCreated]=useState(false);
  const confirmation=useRef<HTMLDivElement>(null);
  const tx=read.loadedUrl==='/api/v1/transactions/'+encodeURIComponent(id)?read.data?.data:undefined;
  const path='/transactions/'+id+'?returnTo='+encodeURIComponent(returnTo);
  return <><nav className="breadcrumb" aria-label="Breadcrumb"><Link href={returnTo}>← Back to {returnTo.startsWith('/transactions')?'transactions':'overview'}</Link><span aria-current="page">Transaction detail</span></nav>
    <PageHeading title="Transaction detail" description={tx?.merchant_name??'Inspect the transaction and its recorded evidence.'}><RecordIdentifier key={id} kind="transaction" id={id}/></PageHeading>
    {created?<div ref={confirmation} tabIndex={-1} className="notice" role="status">Case created and assigned to you. Its reference appears under Investigation.</div>:null}
    {read.error?<ErrorState {...read.error} returnTo={path} retry={read.reload}/>:null}
    {read.loading?<LoadingState label="Loading transaction evidence"/>:null}
    {tx&&!read.error?<>
      <section className="detail-summary" aria-label="Transaction summary"><div><span className="summary-label">Original amount</span><strong className="amount-large">{formatMoney(tx.amount,tx.currency_code)}</strong><span className="base-amount">{formatMoney(tx.amount_base,'INR')} base · rate {tx.exchange_rate}</span></div><div><span className="summary-label">Current risk total</span><RiskBadge band={tx.risk_band}/><p>{tx.risk_score} points · {tx.signal_count} signals</p></div><div><span className="summary-label">Status / direction</span><strong>{tx.status} · {tx.direction}</strong><p>{formatTime(tx.occurred_at)} UTC</p></div></section>
      <div className="detail-grid"><div><section className="work-panel" aria-labelledby="evidence-title"><div className="panel-heading"><div><h2 id="evidence-title">Risk evidence</h2><p>{tx.configuration_label}</p></div></div><div className="panel-content"><p>{tx.coverage}</p><p>{tx.signal_summary}</p></div>
        {!tx.signals.length?<EmptyState title="No recorded signals"><p>This transaction has no recorded rule signals. This does not establish that it is safe.</p></EmptyState>:<div>{tx.signals.map(signal=><article className="signal" key={signal.signal_id}><div className="signal-heading"><div><h3>{signal.rule_name}</h3><span className="muted">{signal.rule_code} · {signal.dimension}</span></div><strong>+{signal.score_contribution} points</strong></div><p>{signal.evidence}</p><p>Observed value: <strong>{signal.observed_value}</strong></p><p className="muted">Recorded {formatTime(signal.triggered_at)} UTC</p><details><summary>Current rule configuration</summary><Facts rows={[["Weight",signal.current_rule_weight],["Threshold",signal.current_rule_threshold],["Version",signal.current_rule_version],["Active",signal.current_rule_active?'Yes':'No']]}/><p className="muted">Current settings may differ from the settings when this signal was recorded.</p></details></article>)}</div>}
        <div className="equation">Recorded signal contributions total {tx.risk_score} points · {tx.risk_band} risk</div></section>
        <section className="work-panel" aria-labelledby="record-title"><div className="panel-heading"><h2 id="record-title">Transaction record</h2></div><div className="panel-content"><Facts rows={[["Transaction ID",tx.transaction_id],["Type",tx.txn_type],["Description",tx.description||'Not recorded'],["Location",[tx.transaction_location.city,tx.transaction_location.country_code].filter(Boolean).join(', ')],["Occurred (UTC)",formatTime(tx.occurred_at)]]}/></div></section></div>
      <aside><section className="work-panel" aria-labelledby="case-title"><div className="panel-heading"><h2 id="case-title">Investigation</h2></div><div className="panel-content">{tx.active_case.exists?<><p>{tx.active_case.access==='permitted'?<>Active case <Link className="transaction-link" href={'/cases/'+tx.active_case.case_id+'?returnTo='+encodeURIComponent(path)}><strong>{tx.active_case.case_ref}</strong></Link></>:'An active case exists. Its details are restricted.'}</p>{tx.active_case.access==='permitted'?<p>Status: {tx.active_case.status.replaceAll('_',' ')}</p>:null}</>:<p>No active case for this transaction.</p>}
        {role==='analyst'?<div hidden={tx.active_case.exists}><CreateCaseDialog transactionId={tx.transaction_id} onCreated={()=>{setCreated(true);read.reload();requestAnimationFrame(()=>confirmation.current?.focus());}}/></div>:!tx.active_case.exists?<p className="muted">An analyst can create a case for this transaction.</p>:null}</div></section>
        <section className="work-panel" aria-labelledby="context-title"><div className="panel-heading"><h2 id="context-title">Masked context</h2></div><div className="context-section"><h3>Customer / account</h3><p>{tx.customer.display_label}</p><p>{tx.account.number_masked} · {tx.account.account_type}</p><p className="muted">{tx.account.currency_code} · {tx.account.status}</p><RecordIdentifier kind="account" id={tx.account_id}/><Link className="transaction-link" href={'/transactions?account_id='+tx.account_id}>Related account transactions</Link></div>
        <div className="context-section"><h3>Merchant</h3><p>{tx.merchant.name}</p><p>{tx.merchant.city??'City not recorded'} · {tx.merchant.country_code}</p><p className="muted">Current tier: {tx.merchant.current_risk_tier} · {tx.merchant.category_code}</p><RecordIdentifier kind="merchant" id={tx.merchant_id}/><Link className="transaction-link" href={'/transactions?merchant_id='+tx.merchant_id}>Related merchant transactions</Link></div>
        <div className="context-section"><h3>Device / payment</h3><p>{tx.device.os_family} · {tx.device.first_seen_country??'Country not recorded'}</p><p>{tx.payment_method?tx.payment_method.method_type+(tx.payment_method.last4?' · ending '+tx.payment_method.last4:''):'Payment method not recorded'}</p><RecordIdentifier kind="device" id={tx.device_id}/><Link className="transaction-link" href={'/transactions?device_id='+tx.device_id}>Related device transactions</Link></div></section></aside></div>
    </>:null}</>;
}
