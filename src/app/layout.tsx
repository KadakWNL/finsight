import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = { title: 'FinSight', description: 'Financial transaction intelligence over synthetic data.' };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
