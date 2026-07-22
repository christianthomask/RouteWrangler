import Link from 'next/link';

/**
 * Admin overview. The shell (layout.tsx) owns the role guard and chrome, so
 * this is just landing content — unlike the previous Sprint 0 stub, which
 * rendered its own `Dashboard` header and would double up inside the shell.
 */
export default function AdminPage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--rw-space-5)' }}>
      <h1 style={{ fontSize: 'var(--rw-text-2xl)', margin: 0 }}>Admin</h1>

      <div className="rw-card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--rw-space-3)' }}>
        <div>
          <h2 style={{ fontSize: 'var(--rw-text-lg)', margin: '0 0 var(--rw-space-1)' }}>Staff</h2>
          <p style={{ fontSize: 'var(--rw-text-sm)', color: 'var(--rw-text-muted)', margin: 0 }}>
            Add supervisors and readers, change roles, and revoke access.
          </p>
        </div>
        <Link
          href="/admin/staff"
          className="rw-button"
          style={{ width: 'auto', alignSelf: 'flex-start', padding: '0.55rem 1rem', textDecoration: 'none' }}
        >
          Manage staff
        </Link>
      </div>

      <p style={{ fontSize: 'var(--rw-text-xs)', color: 'var(--rw-text-muted)', margin: 0 }}>
        Client, route and meter management land in a later sprint.
      </p>
    </div>
  );
}
