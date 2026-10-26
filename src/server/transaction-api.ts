import 'server-only';
import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { authenticateRequest } from './authentication';
import { getPool } from './db';
import { listTransactions, transactionRiskDetail } from './financial-queries';
import { parseTransactionQuery, transactionNextCursor, transactionUuid, TransactionParameterError } from './transaction-parameters';

const headers = { 'Cache-Control': 'private, no-store' };
function failure(status: number, code: string, message: string, requestId: string, fields?: Record<string,string>) {
  return NextResponse.json({ error: { code, message, ...(fields ? { fields } : {}) }, request_id: requestId }, { status, headers });
}

export async function transactionRead(request: Request, resourceId?: string) {
  const requestId = randomUUID();
  try {
    const validation = await authenticateRequest(request);
    if (!validation.valid) return failure(401,'unauthenticated','Sign in to continue.',requestId);
    const actor = validation.user;
    if (actor.role !== 'analyst' && actor.role !== 'admin') return failure(403,'forbidden','This role cannot read transactions.',requestId);
    if (resourceId !== undefined) {
      const id = transactionUuid(resourceId);
      if (new URL(request.url).search) throw new TransactionParameterError({ query: 'Detail requests do not accept query parameters.' });
      const data = await transactionRiskDetail(getPool(),id,actor);
      if (!data) return failure(404,'not_found','Transaction not found.',requestId);
      return NextResponse.json({ data, request_id: requestId },{ headers });
    }
    const query = parseTransactionQuery(new URL(request.url).searchParams,actor);
    const rows = await listTransactions(getPool(),{...query.options,fetchExtra:true},actor);
    const page = rows.slice(0,query.pageSize);
    const next = rows.length > query.pageSize ? transactionNextCursor(query,page.at(-1)!) : null;
    const data = page.map(row => { const safe = { ...row }; delete safe._cursor_key; return safe; });
    return NextResponse.json({ data,page_size:query.pageSize,next_cursor:next,request_id:requestId },{ headers });
  } catch (error) {
    if (error instanceof TransactionParameterError) return failure(400,'invalid_request',error.message,requestId,error.fields);
    return failure(503,'dependency_unavailable','Transaction data is temporarily unavailable.',requestId);
  }
}
