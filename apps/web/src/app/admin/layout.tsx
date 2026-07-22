import { Shell, type NavItem } from '@/components/console/Shell';

const ADMIN_NAV: NavItem[] = [
  { href: '/admin', label: 'Overview' },
  { href: '/admin/staff', label: 'Staff' },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <Shell nav={ADMIN_NAV} home="/admin" allow={['admin']}>
      {children}
    </Shell>
  );
}
