import { Dashboard } from '@/components/Dashboard';

// Sprint 0 shell. The supervisor console (the centerpiece) lands in Sprint 2.
export default function SupervisorPage() {
  return <Dashboard requiredRole="supervisor" title="Supervisor" />;
}
