'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { clsx } from 'clsx';

const GROOMPILOT_URL = process.env.NEXT_PUBLIC_GROOMPILOT_URL || 'http://localhost:5173';

const nav = [
  { href: '/', label: 'Overview', icon: '📊' },
  { href: '/teams', label: 'Teams', icon: '👥' },
  { href: '/repos', label: 'Repositories', icon: '📁' },
  { href: '/alerts', label: 'Alerts', icon: '🔔' },
  { href: '/admin', label: 'Admin', icon: '⚙️' },
];

const groomNav = [
  { href: `${GROOMPILOT_URL}/`, label: 'Sessions', icon: '📝' },
  { href: `${GROOMPILOT_URL}/reviews`, label: 'PR Reviews', icon: '🔍' },
  { href: `${GROOMPILOT_URL}/knowledge`, label: 'Knowledge', icon: '📚' },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed top-0 left-0 h-screen w-[var(--sidebar-width)] bg-brand-900 text-white flex flex-col">
      <div className="p-4 border-b border-brand-700">
        <h1 className="text-lg font-bold tracking-tight">DevPilot</h1>
        <p className="text-xs text-brand-200">Intelligence & Grooming</p>
      </div>

      <nav className="flex-1 py-4 space-y-1 overflow-y-auto">
        <p className="px-4 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-brand-400">
          Delivery
        </p>
        {nav.map((item) => {
          const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={clsx(
                'flex items-center gap-3 px-4 py-2.5 text-sm transition-colors',
                active
                  ? 'bg-brand-700 text-white font-medium'
                  : 'text-brand-200 hover:bg-brand-700/50 hover:text-white',
              )}
            >
              <span>{item.icon}</span>
              {item.label}
            </Link>
          );
        })}

        <p className="px-4 pt-4 pb-1 text-[10px] font-semibold uppercase tracking-wider text-brand-400">
          Grooming & Review
        </p>
        {groomNav.map((item) => (
          <a
            key={item.href}
            href={item.href}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 px-4 py-2.5 text-sm text-brand-200 hover:bg-brand-700/50 hover:text-white transition-colors"
          >
            <span>{item.icon}</span>
            {item.label}
            <span className="ml-auto text-[10px] text-brand-400">↗</span>
          </a>
        ))}
      </nav>

      <div className="p-4 border-t border-brand-700 text-xs text-brand-200">
        Peer Islands AI
      </div>
    </aside>
  );
}
