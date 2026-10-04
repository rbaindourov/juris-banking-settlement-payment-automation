import React from 'react';
import { Shield, Briefcase } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface AdminLayoutProps {
  children: React.ReactNode;
}

export const AdminLayout: React.FC<AdminLayoutProps> = ({ children }) => {
  const navigate = useNavigate();

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: '#f8fafc' }}>
      {/* Top Navbar */}
      <header
        style={{
          backgroundColor: '#ffffff',
          borderBottom: '1px solid #e2e8f0',
          padding: '14px 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          position: 'sticky',
          top: 0,
          zIndex: 100
        }}
      >
        <div
          onClick={() => navigate('/cases')}
          style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}
        >
          <div
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '8px',
              backgroundColor: '#1e3a8a',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#ffffff'
            }}
          >
            <Shield size={20} />
          </div>
          <div>
            <span style={{ fontSize: '18px', fontWeight: 700, color: '#0f172a' }}>
              Juris Banking
            </span>
            <span
              style={{
                marginLeft: '8px',
                fontSize: '11px',
                padding: '2px 8px',
                borderRadius: '12px',
                backgroundColor: '#eff6ff',
                color: '#1d4ed8',
                fontWeight: 600
              }}
            >
              Legal Settlement Administration
            </span>
          </div>
        </div>

        <nav style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button
            type="button"
            onClick={() => navigate('/cases')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              background: 'none',
              border: 'none',
              fontSize: '14px',
              fontWeight: 500,
              color: '#334155',
              cursor: 'pointer'
            }}
          >
            <Briefcase size={16} />
            Cases
          </button>
        </nav>
      </header>

      {/* Main Content Area */}
      <main style={{ flex: 1 }}>
        {children}
      </main>

      {/* Footer */}
      <footer
        style={{
          padding: '16px 24px',
          borderTop: '1px solid #e2e8f0',
          textAlign: 'center',
          fontSize: '12px',
          color: '#94a3b8',
          backgroundColor: '#ffffff'
        }}
      >
        Juris Banking Platform &bull; Automated Settlement Administration &bull; SOC2 Type II Certified
      </footer>
    </div>
  );
};
