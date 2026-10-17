'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Bell, ChevronDown, LogOut, KeyRound, Menu, Search, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useAuth } from '@/lib/auth';
import { Logo, useBranding } from '@/lib/branding';
import { useGet } from '@/lib/hooks';
import { NAV, NAV_GROUPS, visibleNav } from './nav';
import { Button, cx } from '@/components/ui/primitives';

/**
 * Application shell: a fixed-height viewport split into a black sidebar that
 * scrolls on its own and a main column (top bar + scrolling content). Below
 * `lg` the sidebar becomes a slide-in drawer.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { me, loading, logout } = useAuth();
  const { branding } = useBranding();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const failed = useGet<{ id: string }[]>(me?.permissions.includes('notifications.read') ? '/admin/notifications?status=FAILED&limit=10' : null);

  useEffect(() => {
    if (!loading && !me) router.replace('/login');
  }, [loading, me, router]);

  if (loading || !me) {
    return (
      <div className="flex h-dvh items-center justify-center text-sm text-grey-500" role="status">Loading…</div>
    );
  }
  const items = visibleNav(me.permissions);
  const isActive = (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href));
  const current = NAV.find((n) => isActive(n.href));
  const initials = me.fullName.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  const failedCount = Array.isArray(failed.data) ? failed.data.length : 0;

  const signOut = () => void logout().then(() => router.replace('/login'));
  const onSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const q = search.trim();
    if (!q) return;
    router.push(/^[0-9a-f-]{36}$/i.test(q) ? `/providers/${q}` : `/users?q=${encodeURIComponent(q)}`);
    setSearch('');
  };

  const nav = (
    <nav aria-label="Main" className="flex h-full flex-col bg-ink text-paper">
      <div className="flex items-center justify-between gap-3 px-4 py-4">
        <Link href="/" className="flex min-w-0 items-center gap-3" onClick={() => setOpen(false)}>
          <Logo size="sm" onDark className="shrink-0 rounded-lg" />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold leading-tight">{branding.name}</span>
            <span className="block truncate text-[11px] text-grey-400">Admin Panel</span>
          </span>
        </Link>
        <button className="text-grey-400 hover:text-paper lg:hidden" aria-label="Close menu" onClick={() => setOpen(false)}><X size={18} /></button>
      </div>
      <div className="dark-scroll flex-1 overflow-y-auto px-3 pb-4">
        {NAV_GROUPS.map((g) => {
          const group = items.filter((i) => i.group === g);
          if (!group.length) return null;
          return (
            <div key={g} className="mb-4">
              <p className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-grey-500">{g}</p>
              <ul className="space-y-0.5">
                {group.map((i) => (
                  <li key={i.href}>
                    <Link
                      href={i.href}
                      aria-current={isActive(i.href) ? 'page' : undefined}
                      onClick={() => setOpen(false)}
                      className={cx('flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors', isActive(i.href) ? 'bg-paper font-semibold text-ink shadow-sm' : 'text-grey-300 hover:bg-white/10 hover:text-paper')}
                    >
                      <i.icon size={16} aria-hidden className={isActive(i.href) ? 'text-ink' : 'text-grey-400'} />
                      <span className="truncate">{i.label}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      <div className="border-t border-white/10 px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-paper text-xs font-bold text-ink">{initials}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{me.fullName}</span>
            <span className="block truncate text-[11px] text-grey-400">{me.email ?? me.phone ?? me.roles.join(', ')}</span>
          </span>
          <button aria-label="Sign out" title="Sign out" onClick={signOut} className="text-grey-400 hover:text-paper"><LogOut size={16} /></button>
        </div>
      </div>
    </nav>
  );

  return (
    <div className="flex h-dvh overflow-hidden bg-canvas">
      <aside className="hidden h-full w-64 shrink-0 lg:block">{nav}</aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] shadow-xl">{nav}</aside>
        </div>
      )}
      <div className="flex h-full min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center gap-3 border-b border-grey-200 bg-paper/90 px-4 backdrop-blur lg:px-8">
          <button className="lg:hidden" aria-label="Open menu" onClick={() => setOpen(true)}><Menu size={20} /></button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-semibold leading-tight">{current?.label ?? branding.name}</p>
            <p className="hidden truncate text-xs text-grey-500 sm:block">{current ? `${current.group} · ${branding.name}` : branding.tagline}</p>
          </div>
          <form onSubmit={onSearch} role="search" className="relative hidden md:block">
            <Search size={16} aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-grey-400" />
            <input aria-label="Search users or paste a provider id" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} className="h-10 w-56 rounded-lg border border-grey-200 bg-grey-50 pr-3 pl-9 text-sm placeholder:text-grey-400 focus:border-ink focus:bg-paper lg:w-72" />
          </form>
          <Link href="/notifications" aria-label={`Notifications${failedCount ? `, ${failedCount} failed` : ''}`} className="relative flex h-10 w-10 items-center justify-center rounded-full text-grey-600 hover:bg-grey-100 hover:text-ink">
            <Bell size={18} />
            {failedCount > 0 && <span className="absolute top-2 right-2 h-2 w-2 rounded-full bg-red ring-2 ring-paper" />}
          </Link>
          <details className="relative">
            <summary className="flex cursor-pointer list-none items-center gap-2 rounded-full p-1 pr-2 hover:bg-grey-100 [&::-webkit-details-marker]:hidden">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-ink text-xs font-bold text-paper">{initials}</span>
              <ChevronDown size={14} className="text-grey-500" />
            </summary>
            <div className="absolute right-0 z-30 mt-2 w-60 rounded-xl border border-grey-200 bg-paper p-2 text-sm shadow-[var(--shadow-float)]">
              <p className="truncate px-2 py-1 font-medium">{me.fullName}</p>
              <p className="truncate px-2 pb-2 text-xs text-grey-500">{me.roles.join(', ') || 'No Platform Role'}</p>
              <Link href="/account/password" className="flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-grey-100"><KeyRound size={14} /> Change Password</Link>
              <Button variant="ghost" size="sm" className="w-full justify-start" onClick={signOut}><LogOut size={14} /> Sign Out</Button>
            </div>
          </details>
        </header>
        <main className="flex-1 overflow-y-auto px-4 py-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}

/** Page-level permission gate: renders a clear denial instead of a broken page. */
export function RequirePermission({ anyOf, children }: { anyOf: string[]; children: ReactNode }) {
  const { me } = useAuth();
  if (!me || !anyOf.some((p) => me.permissions.includes(p))) {
    return (
      <div role="alert" className="rounded-2xl border border-red/30 bg-red-soft px-6 py-10 text-center">
        <p className="font-medium text-red">You don&apos;t have access to this area</p>
        <p className="mt-1 text-sm text-grey-700">Required permission: {anyOf.join(' or ')}</p>
      </div>
    );
  }
  return <>{children}</>;
}
