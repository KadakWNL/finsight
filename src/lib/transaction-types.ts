export type RiskBand = 'low' | 'medium' | 'high' | 'critical';
export type ActiveCase = {exists:false;access:'none'} | {exists:true;access:'restricted'} | {exists:true;access:'permitted';case_id:string;case_ref:string;status:string};
export interface TransactionRow {
  transaction_id:string; account_id:string; merchant_id:string; device_id:string;
  amount:string; currency_code:'INR'|'USD'; exchange_rate:string; amount_base:string;
  direction:string;status:string;txn_type:string;occurred_at:string;description:string;
  merchant_name:string;current_merchant_tier:string;risk_score:string;signal_count:number;risk_band:RiskBand;
  account:{account_id:string;number_masked:string;account_type:string;currency_code:string;status:string};
  customer:{customer_id:string;display_label:string;country_code:string;status:string};
  merchant:{merchant_id:string;name:string;category_code:string;country_code:string;city:string|null;current_risk_tier:string};
  device:{device_id:string;os_family:string;first_seen_country:string|null};
  payment_method:{method_id:string;method_type:string;last4:string|null}|null;
  transaction_location:{country_code:string;city:string|null};active_case:ActiveCase;
}
export interface RiskSignal {
  signal_id:string;observed_value:string;score_contribution:string;evidence:string;triggered_at:string;
  rule_code:string;rule_name:string;dimension:string;current_rule_weight:string;current_rule_threshold:string;current_rule_active:boolean;current_rule_version:number;
}
export interface TransactionDetail extends TransactionRow {signals:RiskSignal[];coverage:string;signal_summary:string;configuration_label:string}
export interface TransactionPage {data:TransactionRow[];page_size:number;next_cursor:string|null;request_id:string}
export interface WorkRow {case_id:string;case_ref:string;status:string;priority:string;due_at:string|null;transaction_id:string;amount:string;amount_base:string;currency_code:string;merchant_name:string;owner_label:string|null}
export interface OverviewData {data:WorkRow[];has_more:boolean;request_id:string}
