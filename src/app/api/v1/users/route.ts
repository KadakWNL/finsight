import { analystCreate, analystList } from '@/server/identity-admin';

export async function GET(request: Request) {
  return analystList(request);
}

export async function POST(request: Request) {
  return analystCreate(request);
}
