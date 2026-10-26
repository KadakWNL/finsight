import { transactionRead } from '@/server/transaction-api';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return transactionRead(request,id);
}
