'use server';
import { headers } from 'next/headers';
import { createSubjectCase } from '@/server/subject-case';

export async function createSubjectCaseAction(form:FormData) {
  const request=new Request(process.env.NEXTAUTH_URL ?? 'http://localhost:3000',{method:'POST',headers:await headers()});
  return createSubjectCase(request,Object.fromEntries(form.entries()));
}
