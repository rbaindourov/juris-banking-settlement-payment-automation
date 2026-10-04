import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useParams } from 'react-router-dom';
import { AdminLayout } from './components/AdminLayout';
import { CaseList } from './pages/CaseList';
import { CaseDetail } from './pages/CaseDetail';
import { ClaimantPortalPage } from './portal/ClaimantPortalPage';
import { ClaimantReceiptPage } from './portal/ClaimantReceiptPage';

const AdminCaseListRoute: React.FC = () => {
  const navigate = useNavigate();
  return <CaseList onSelectCase={(id) => navigate(`/cases/${id}`)} />;
};

const AdminCaseDetailRoute: React.FC = () => {
  const { caseId } = useParams<{ caseId: string }>();
  const navigate = useNavigate();
  if (!caseId) return <Navigate to="/cases" replace />;
  return <CaseDetail caseId={caseId} onBack={() => navigate('/cases')} />;
};

const AdminCaseAnalyticsRoute: React.FC = () => {
  const { caseId } = useParams<{ caseId: string }>();
  const navigate = useNavigate();
  if (!caseId) return <Navigate to="/cases" replace />;
  return <CaseDetail caseId={caseId} onBack={() => navigate('/cases')} initialTab="analytics" />;
};

export const App: React.FC = () => {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public Claimant Magic Link Portal Routes */}
        <Route path="/claim/:token" element={<ClaimantPortalPage />} />
        <Route path="/claim/:token/receipt" element={<ClaimantReceiptPage />} />

        {/* Administrative Back-Office Routes wrapped in AdminLayout */}
        <Route
          path="/"
          element={
            <AdminLayout>
              <AdminCaseListRoute />
            </AdminLayout>
          }
        />
        <Route
          path="/cases"
          element={
            <AdminLayout>
              <AdminCaseListRoute />
            </AdminLayout>
          }
        />
        <Route
          path="/cases/:caseId"
          element={
            <AdminLayout>
              <AdminCaseDetailRoute />
            </AdminLayout>
          }
        />
        <Route
          path="/cases/:caseId/analytics"
          element={
            <AdminLayout>
              <AdminCaseAnalyticsRoute />
            </AdminLayout>
          }
        />

        {/* Fallback route */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
};

export default App;
