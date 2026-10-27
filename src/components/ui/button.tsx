import type { ComponentPropsWithRef } from 'react';
import { cn } from '@/lib/utils';

export function Button({ className, type = 'button', ...props }: ComponentPropsWithRef<'button'>) {
  return <button type={type} className={cn('inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50', className)} {...props} />;
}
