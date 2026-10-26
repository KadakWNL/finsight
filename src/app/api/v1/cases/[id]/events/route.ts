import { caseEvents } from '@/server/case-api';

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  return caseEvents(request, id);
}
