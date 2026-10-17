import {
  Activity, Ambulance, BadgeCheck, BarChart3, Bell, Building2, CalendarCheck, ClipboardList, CreditCard, FileSearch, FlaskConical, HeartPulse, Hospital, LayoutDashboard, Link2, ListTree, MessageSquareWarning, Percent, Pill, ScanLine, Settings, ShieldCheck, Stethoscope, Users, Wallet, type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Any of these permissions shows the item. */
  permissions: string[];
  group: string;
}

export const NAV: NavItem[] = [
  { href: '/', label: 'Overview', icon: LayoutDashboard, permissions: ['analytics.read'], group: 'Platform' },
  { href: '/users', label: 'Users', icon: Users, permissions: ['users.read'], group: 'Platform' },
  { href: '/roles', label: 'Roles & Permissions', icon: ShieldCheck, permissions: ['roles.read'], group: 'Platform' },
  { href: '/providers/doctors', label: 'Doctors', icon: Stethoscope, permissions: ['providers.read'], group: 'Providers' },
  { href: '/providers/hospitals', label: 'Hospitals', icon: Hospital, permissions: ['providers.read'], group: 'Providers' },
  { href: '/providers/clinics', label: 'Clinics', icon: Building2, permissions: ['providers.read'], group: 'Providers' },
  { href: '/providers/labs', label: 'Diagnostic Labs', icon: FlaskConical, permissions: ['providers.read'], group: 'Providers' },
  { href: '/providers/imaging', label: 'Imaging Centres', icon: ScanLine, permissions: ['providers.read'], group: 'Providers' },
  { href: '/providers/pharmacies', label: 'Pharmacies', icon: Pill, permissions: ['providers.read'], group: 'Providers' },
  { href: '/ambulance', label: 'Ambulance Operators', icon: Ambulance, permissions: ['ambulance.read'], group: 'Providers' },
  { href: '/applications', label: 'Provider Applications', icon: ClipboardList, permissions: ['providers.read'], group: 'Verification' },
  { href: '/verification', label: 'Credential Verification', icon: BadgeCheck, permissions: ['providers.verify'], group: 'Verification' },
  { href: '/affiliations', label: 'Doctor–Hospital Affiliations', icon: Link2, permissions: ['affiliations.read'], group: 'Verification' },
  { href: '/catalogue', label: 'Departments & Services', icon: ListTree, permissions: ['catalogue.read'], group: 'Operations' },
  { href: '/appointments', label: 'Appointments', icon: CalendarCheck, permissions: ['bookings.read'], group: 'Operations' },
  { href: '/pharmacy-orders', label: 'Pharmacy Orders', icon: Pill, permissions: ['pharmacy.read'], group: 'Operations' },
  { href: '/diagnostic-orders', label: 'Diagnostic Orders', icon: Activity, permissions: ['diagnostics.read'], group: 'Operations' },
  { href: '/dispatch', label: 'Ambulance Dispatch', icon: HeartPulse, permissions: ['dispatch.read'], group: 'Operations' },
  { href: '/payments', label: 'Payments & Refunds', icon: CreditCard, permissions: ['finance.read'], group: 'Finance' },
  { href: '/commission-rules', label: 'Commission Rules', icon: Percent, permissions: ['finance.read'], group: 'Finance' },
  { href: '/settlements', label: 'Provider Settlements', icon: Wallet, permissions: ['finance.read'], group: 'Finance' },
  { href: '/support', label: 'Complaints & Disputes', icon: MessageSquareWarning, permissions: ['support.read'], group: 'Service' },
  { href: '/notifications', label: 'Notifications', icon: Bell, permissions: ['notifications.read'], group: 'Service' },
  { href: '/reports', label: 'Reports & Exports', icon: BarChart3, permissions: ['analytics.read', 'exports.read'], group: 'Service' },
  { href: '/audit', label: 'Audit Logs', icon: FileSearch, permissions: ['audit.read'], group: 'Governance' },
  { href: '/settings', label: 'Platform Settings', icon: Settings, permissions: ['settings.read'], group: 'Governance' },
];

export const NAV_GROUPS = ['Platform', 'Providers', 'Verification', 'Operations', 'Finance', 'Service', 'Governance'];

export function visibleNav(permissions: string[]): NavItem[] {
  return NAV.filter((n) => n.permissions.some((p) => permissions.includes(p)));
}
