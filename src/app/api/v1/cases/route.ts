import { caseList, caseCreate } from '@/server/case-api';

export async function GET(request: Request) {
  return caseList(request);
}

export async function POST(request: Request) {
  return caseCreate(request);
}
