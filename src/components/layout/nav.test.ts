import { describe, expect, it } from 'vitest';
import { NAV, visibleNav } from './nav';

describe('navigation', () => {
  it('lists all 26 required areas', () => {
    expect(NAV).toHaveLength(26);
    expect(NAV.map((n) => n.href)).toContain('/commission-rules');
  });
  it('hides items the user lacks permission for', () => {
    const support = visibleNav(['support.read', 'users.read']);
    expect(support.map((n) => n.href)).toEqual(['/users', '/support']);
    expect(visibleNav([])).toEqual([]);
  });
  it('shows reports when either analytics or exports is held', () => {
    expect(visibleNav(['exports.read']).map((n) => n.href)).toEqual(['/reports']);
  });
});
