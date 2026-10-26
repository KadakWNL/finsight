import { overviewRead } from '@/server/overview';
export async function GET(request:Request) { return overviewRead(request); }
