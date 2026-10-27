import 'server-only';
import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { authenticateRequest } from './authentication';
import { getPool } from './db';

export async function overviewRead(request:Request) {
  const requestId=randomUUID();
  const headers={'Cache-Control':'private, no-store'};
  const failure=(status:number,code:string,message:string)=>NextResponse.json({error:{code,message},request_id:requestId},{status,headers});
  try {
    const validation=await authenticateRequest(request);
    if(!validation.valid) return failure(401,'unauthenticated','Sign in to continue.');
    if(new URL(request.url).search) return failure(400,'invalid_request','Overview does not accept query parameters.');
    const {rows}=await getPool().query(`SELECT c.case_id,c.case_ref,c.status,c.priority,
      to_char(c.due_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS due_at,
      c.transaction_id,t.amount,t.amount_base,t.currency_code,m.merchant_name,
      CASE WHEN $2::text='admin' THEN u.display_name ELSE NULL END AS owner_label
      FROM public.investigation_case c JOIN public.transaction t USING(transaction_id)
      JOIN public.merchant m USING(merchant_id) LEFT JOIN public.app_user u ON u.user_id=c.assigned_to_user_id
      WHERE c.status IN ('open','in_review','escalated') AND ($2::text='admin' OR c.assigned_to_user_id=$1::uuid)
      ORDER BY c.due_at ASC NULLS LAST,CASE c.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,c.case_id LIMIT 26`,
      [validation.user.userId,validation.user.role]);
    return NextResponse.json({data:rows.slice(0,25),has_more:rows.length>25,request_id:requestId},{headers});
  } catch { return failure(503,'dependency_unavailable','Assigned work is temporarily unavailable.'); }
}
