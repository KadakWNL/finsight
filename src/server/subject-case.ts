import 'server-only';
import { authenticateRequest } from './authentication';
import { isSameOriginRequest } from './auth-security';
import { executeCaseCommand } from './case-commands';
import { getPool } from './db';

export type CreateCaseResult = {ok:true;caseId:string;caseRef:string;replayed:boolean} | {ok:false;status:number;message:string};
export async function createSubjectCase(request:Request,input:Record<string,unknown>):Promise<CreateCaseResult> {
  if(!isSameOriginRequest(request)) return {ok:false,status:403,message:'This request could not be verified. Reload the page and try again.'};
  try {
    const validation=await authenticateRequest(request);
    if(!validation.valid) return {ok:false,status:401,message:'Your session ended. Sign in again, then retry. Your draft is still here.'};
    if(validation.user.role!=='analyst') return {ok:false,status:403,message:'Only analysts can open a new case.'};
    const {transactionId,idempotencyKey,priority}=input;
    const reason=typeof input.reason==='string' ? input.reason.trim() : '';
    const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if(Object.keys(input).some(k=>!['transactionId','idempotencyKey','priority','reason'].includes(k))
      ||typeof transactionId!=='string'||!uuid.test(transactionId)||typeof idempotencyKey!=='string'||!uuid.test(idempotencyKey)
      ||typeof priority!=='string'||!['low','medium','high'].includes(priority)||!reason||reason.length>2000) {
      return {ok:false,status:400,message:'Check the transaction, priority and reason (1-2,000 characters).'};
    }
    const result=await executeCaseCommand(getPool(),{commandType:'create',actorUserId:validation.user.userId,
      transactionId,idempotencyKey,priority:priority as 'low'|'medium'|'high',reason});
    return {ok:true,caseId:result.caseId,caseRef:result.caseRef,replayed:result.replayed};
  } catch(error) {
    const code=typeof error==='object'&&error!==null&&'code' in error ? error.code : '';
    if(code==='23505'||code==='P0409') return {ok:false,status:409,message:'A case already exists or this request changed. Refresh the transaction before trying again.'};
    if(code==='23503'||code==='P0002') return {ok:false,status:404,message:'This transaction is no longer available.'};
    if(code==='28000'||code==='42501') return {ok:false,status:403,message:'You no longer have permission to open this case.'};
    return {ok:false,status:503,message:'The case could not be saved. Retry with your draft unchanged.'};
  }
}
