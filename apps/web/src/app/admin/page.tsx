import { Dashboard } from '@/components/Dashboard';

// Sprint 0 shell. Admin surfaces (user/client/route/meter management) land in Sprint 4.
export default function AdminPage() {
  return <Dashboard requiredRole="admin" title="Admin" />;
}
