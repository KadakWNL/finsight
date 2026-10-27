'use client';
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import type { TransactionPage } from '@/lib/transaction-types';
import { useApi } from './use-api';
import { PageHeading, ErrorState, LoadingState, EmptyState } from './ui';
import { TransactionTable } from './transaction-table';
import { useDisplayPreferences } from './display-preferences';

const advanced=['from','to','account_id','merchant_id','device_id','currency','amount_mode','amount_min','amount_max'];
function utcInput(value:string|null) {
  if(!value) return '';
  const date=new Date(value);if(!Number.isFinite(date.getTime())) return '';
  const fraction=/\.([0-9]+)/.exec(value)?.[1];
  return date.toISOString().slice(0,19)+(fraction?'.'+fraction.slice(0,6):'');
}
function FilterForm({params,fields,loading,apply,reset}:{params:URLSearchParams;fields:Record<string,string>;loading:boolean;apply:(form:FormData)=>void;reset:()=>void}) {
  const [more,setMore]=useState(advanced.some(key=>params.has(key)));
  const [amountMode,setAmountMode]=useState(params.get('amount_mode') ?? 'original');
  useEffect(()=>{if(advanced.some(key=>fields[key])) setMore(true);},[fields]);
  const help=(name:string)=>fields[name]?<p id={name+'-error'} className="field-alert">{fields[name]}</p>:null;
  const attrs=(name:string)=>({id:name,name,'aria-invalid':!!fields[name],'aria-describedby':fields[name]?name+'-error':undefined});
  const size=params.get('page_size') ?? '25';
  return <form className="filter-panel" onSubmit={event=>{event.preventDefault();apply(new FormData(event.currentTarget));}}><fieldset><legend>Find transactions</legend>
    <div className="filter-grid"><div className="span-two"><label htmlFor="q">Description or exact transaction ID</label><input {...attrs('q')} defaultValue={params.get('q') ?? ''} maxLength={500} placeholder="Search recorded transaction descriptions"/>{help('q')}</div>
    <div><label htmlFor="risk">Risk band</label><select {...attrs('risk')} defaultValue={params.get('risk') ?? ''}><option value="">All bands</option>{['low','medium','high','critical'].map(x=><option key={x}>{x}</option>)}</select>{help('risk')}</div>
    <div><label htmlFor="status">Transaction status</label><select {...attrs('status')} defaultValue={params.get('status') ?? ''}><option value="">All statuses</option>{['posted','pending','reversed','blocked'].map(x=><option key={x}>{x}</option>)}</select>{help('status')}</div></div>
    <details className="filter-more" open={more} onToggle={event=>setMore(event.currentTarget.open)}><summary>More filters</summary><div className="filter-grid">
      <div><label htmlFor="from">From (UTC, inclusive)</label><input {...attrs('from')} type="datetime-local" step="0.000001" defaultValue={utcInput(params.get('from'))}/>{help('from')}</div>
      <div><label htmlFor="to">Until (UTC, exclusive)</label><input {...attrs('to')} type="datetime-local" step="0.000001" defaultValue={utcInput(params.get('to'))}/>{help('to')}</div>
      {(['account_id','merchant_id','device_id'] as const).map(name=><div key={name}><label htmlFor={name}>{name==='account_id'?'Account ID':name==='merchant_id'?'Merchant ID':'Device ID'}</label><input {...attrs(name)} defaultValue={params.get(name) ?? ''} placeholder="Exact UUID"/>{help(name)}</div>)}
      <div><label htmlFor="amount_mode">Amount mode</label><select {...attrs('amount_mode')} value={amountMode} onChange={event=>setAmountMode(event.target.value)}><option value="original">Original currency</option><option value="base">INR base, all currencies</option></select>{help('amount_mode')}</div>
      <div><label htmlFor="currency">Original currency</label><select {...attrs('currency')} disabled={amountMode==='base'} defaultValue={params.get('currency') ?? ''}><option value="">Select currency</option><option>INR</option><option>USD</option></select>{help('currency')}</div>
      <div><label htmlFor="amount_min">Minimum amount</label><input {...attrs('amount_min')} inputMode="decimal" defaultValue={params.get('amount_min') ?? ''} placeholder="0.00"/>{help('amount_min')}</div>
      <div><label htmlFor="amount_max">Maximum amount</label><input {...attrs('amount_max')} inputMode="decimal" defaultValue={params.get('amount_max') ?? ''} placeholder="No maximum"/>{help('amount_max')}</div>
    </div><p className="muted">Original amount filters and sorting need a currency. INR base mode compares converted INR values.</p></details>
    <div className="filter-actions"><div className="action-row"><Button type="submit" disabled={loading}>Apply filters</Button><Button className="secondary" onClick={reset}>Reset filters</Button></div>
      <div className="sort-controls"><label>Sort by<select {...attrs('sort')} defaultValue={params.get('sort') ?? 'occurred_at'}><option value="occurred_at">Time</option><option value="amount">Amount</option><option value="risk_score">Recorded risk</option><option value="status">Status</option></select>{help('sort')}</label>
      <label>Order<select {...attrs('order')} defaultValue={params.get('order') ?? 'desc'}><option value="desc">Descending</option><option value="asc">Ascending</option></select>{help('order')}</label>
      <label>Page size<select {...attrs('page_size')} defaultValue={size}>{!['25','50','100'].includes(size)&&/^[1-9]\d?$/.test(size)?<option value={size}>{size}</option>:null}<option>25</option><option>50</option><option>100</option></select>{help('page_size')}</label></div></div>
    </fieldset></form>;
}

export function ExplorerScreen() {
  const { timeZone } = useDisplayPreferences();
  const searchParams=useSearchParams();const search=searchParams.toString();const router=useRouter();
  const [previous,setPrevious]=useState<string[]>([]);
  const result=useApi<TransactionPage>('/api/v1/transactions'+(search?'?'+search:''));
  const returnTo='/transactions'+(search?'?'+search:'');
  function navigate(params:URLSearchParams) {router.push('/transactions'+(params.size?'?'+params:''),{scroll:false});}
  function apply(form:FormData) {
    const params=new URLSearchParams();
    for(const [key,raw] of form.entries()) {
      if(typeof raw!=='string'||!raw.trim()) continue;
      let value=raw.trim();
      if(key==='from'||key==='to') {if(value.length===16) value+=':00';value+='Z';}
      params.set(key,value);
    }
    setPrevious([]);navigate(params);
  }
  const reset=()=>{setPrevious([]);router.push('/transactions',{scroll:false});};
  const filters=[...searchParams.entries()].filter(([key])=>!['cursor','sort','order','page_size','amount_mode'].includes(key));
  return <><PageHeading title="Transactions" description="Find the financial facts, then inspect the recorded evidence."/>
    <FilterForm key={search} params={new URLSearchParams(search)} fields={result.error?.fields ?? {}} loading={result.loading} apply={apply} reset={reset}/>
    {filters.length?<p className="applied-filters">Applied filters: {filters.map(([key,value])=>`${key.replaceAll('_',' ')}: ${value}`).join('; ')}</p>:null}
    {result.error?<ErrorState status={result.error.status} message={result.error.message} returnTo={returnTo} retry={result.reload}/>:null}
    {result.error?.status===400?<div className="action-row"><Button className="secondary" onClick={()=>{const params=new URLSearchParams(search);params.delete('cursor');setPrevious([]);navigate(params);}}>Restart from first page</Button></div>:null}
    <section className="work-panel" aria-busy={result.loading} aria-label="Transaction results"><div className="panel-heading"><div><h2>Recorded transactions</h2><p>No recorded signals does not mean a transaction is safe.</p></div><span className="muted">{timeZone}</span></div>
      {result.loading?<LoadingState label="Loading transactions…"/>:null}
      {result.data&&!result.loading?<>{result.error?<p className="notice" role="status">Previous results shown. The latest request did not succeed.</p>:null}
        {result.data.data.length?<TransactionTable rows={result.data.data} returnTo={returnTo} sort={new URLSearchParams(result.loadedUrl?.split('?')[1]).get('sort')??'occurred_at'} order={new URLSearchParams(result.loadedUrl?.split('?')[1]).get('order')??'desc'}/>:<EmptyState title={filters.length?'No transactions match these filters':'No transactions available'}><p>{filters.length?'Reset or adjust the filters to broaden your search.':'Transactions will appear when financial data is available.'}</p></EmptyState>}
        <div className="pagination"><p>{result.data.data.length} rows on this page. Results reflect live data.</p><div className="action-row"><Button className="secondary" disabled={!searchParams.has('cursor')||result.loading} onClick={()=>{const params=previous.length?new URLSearchParams(previous.at(-1)):new URLSearchParams(search);if(!previous.length) params.delete('cursor');setPrevious(items=>items.slice(0,-1));navigate(params);}}>{previous.length?'Previous':'First page'}</Button>
        <Button className="secondary" disabled={!result.data.next_cursor||result.loading||!!result.error} onClick={()=>{setPrevious(items=>[...items,search]);const params=new URLSearchParams(search);params.set('cursor',result.data!.next_cursor!);navigate(params);}}>Next</Button></div></div></>:null}
    </section></>;
}
