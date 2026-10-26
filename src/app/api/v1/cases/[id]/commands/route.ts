import { caseCommand } from '@/server/case-api';

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  return caseCommand(request, id);
}
