import type { Metadata } from 'next';
import './globals.css';
import { Sidebar } from '@/components/sidebar';
import { Providers } from '@/components/providers';

export const metadata: Metadata = {
  title: 'DevPilot – Intelligence & Grooming',
  description: 'AI-powered delivery intelligence, grooming & PR review platform',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="flex min-h-screen">
        <Providers>
          <Sidebar />
          <main className="flex-1 ml-[var(--sidebar-width)] p-6">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
