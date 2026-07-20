import { Shell } from '@/components/console/Shell';

export default function SupervisorLayout({ children }: { children: React.ReactNode }) {
  return <Shell>{children}</Shell>;
}
