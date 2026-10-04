import React from 'react';
import { Shield, Briefcase } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface AdminLayoutProps {
  children: React.ReactNode;
}

export const AdminLayout: React.FC<AdminLayoutProps> = ({ children }) => {
  const navigate = useNavigate();

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--bg-body)' }}>
      {/* Top Navbar */}
      <header
        role="banner"
        style={{
          backgroundColor: '#ffffff',
          borderBottom: '1px solid var(--border-subtle)',
          padding: '14px 28px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          position: 'sticky',
          top: 0,
          zIndex: 100,
          boxShadow: 'var(--shadow-xs)'
        }}
      >
        <div
          onClick={() => navigate('/cases')}
          role="link"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate('/cases'); } }}
          style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer', outline: 'none' }}
          className="focus-visible:ring-2 focus-visible:ring-indigo-600"
          aria-label="Juris Banking Home"
        >
          <div
            style={{
              width: '38px',
              height: '38px',
              borderRadius: 'var(--radius-md)',
              backgroundColor: 'var(--color-primary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#ffffff',
              boxShadow: '0 2px 4px rgba(30, 58, 138, 0.2)'
            }}
          >
            <Shield size={22} aria-hidden="true" />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
              Juris Banking
            </span>
            <span
              style={{
                fontSize: '11px',
                padding: '3px 8px',
                borderRadius: 'var(--radius-full)',
                backgroundColor: 'var(--bg-active)',
                color: 'var(--color-indigo)',
                fontWeight: 600,
                border: '1px solid #bfdbfe'
              }}
            >
              Settlement Administration
            </span>
          </div>
        </div>

        <nav aria-label="Main Navigation" style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button
            type="button"
            onClick={() => navigate('/cases')}
            aria-label="View Settlement Cases"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '6px 14px',
              borderRadius: 'var(--radius-sm)',
              fontSize: '14px',
              fontWeight: 600,
              color: 'var(--color-primary)',
              backgroundColor: 'rgba(239, 246, 255, 0.7)',
              border: '1px solid #bfdbfe',
              transition: 'all 0.15s ease'
            }}
          >
            <Briefcase size={16} aria-hidden="true" />
            Cases
          </button>
        </nav>
      </header>

      {/* Main Content Area */}
      <main role="main" style={{ flex: 1, paddingBottom: '32px' }}>
        {children}
      </main>

      {/* Footer */}
      <footer
        role="contentinfo"
        style={{
          padding: '16px 28px',
          borderTop: '1px solid var(--border-subtle)',
          textAlign: 'center',
          fontSize: '12px',
          color: 'var(--text-muted)',
          backgroundColor: '#ffffff'
        }}
      >
        <span>Juris Banking Settlement Platform &bull; Automated Payment Distribution &bull; SOC 2 Type II Certified &bull; NACHA Compliant</span>
      </footer>
    </div>
  );
};
