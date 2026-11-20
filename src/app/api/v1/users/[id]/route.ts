import { analystUpdate } from '@/server/identity-admin';

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  return analystUpdate(request, id);
}
