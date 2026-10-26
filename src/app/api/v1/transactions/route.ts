import { transactionRead } from '@/server/transaction-api';

export async function GET(request: Request) {
  return transactionRead(request);
}
