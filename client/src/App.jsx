import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Shell from './components/Shell.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Employees from './pages/Employees.jsx';
import Users from './pages/Users.jsx';
import Trainings from './pages/Trainings.jsx';
import Calendar from './pages/Calendar.jsx';
import Attendance from './pages/Attendance.jsx';
import Feedback from './pages/Feedback.jsx';
import Assessments from './pages/Assessments.jsx';
import Certificates from './pages/Certificates.jsx';
import OrgDev from './pages/OrgDev.jsx';
import Expenses from './pages/Expenses.jsx';
import Reports from './pages/Reports.jsx';
import PublicCheckin from './pages/PublicCheckin.jsx';
import PublicFeedback from './pages/PublicFeedback.jsx';
import PublicNominate from './pages/PublicNominate.jsx';
import PublicApprove from './pages/PublicApprove.jsx';
import PublicCert from './pages/PublicCert.jsx';
import PublicAssessment from './pages/PublicAssessment.jsx';
import LearnerPortal from './pages/LearnerPortal.jsx';
import Mavericks from './pages/Mavericks.jsx';
import NewJoiners from './pages/NewJoiners.jsx';
import Settings from './pages/Settings.jsx';

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

const ToastCtx = createContext(null);
export const useToast = () => useContext(ToastCtx);

const SettingsCtx = createContext({ settings: null, reloadSettings: () => {} });
export const useSettings = () => useContext(SettingsCtx);

export default function App() {
  const [auth, setAuth] = useState({ loading: true, user: null, ssoConfigured: false, devLogin: false });
  const [toast, setToast] = useState(null);
  const [settings, setSettings] = useState(null);

  const reloadSettings = useCallback(() => {
    fetch('/api/settings', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null)).then(setSettings).catch(() => {});
  }, []);
  useEffect(() => { if (auth.user) reloadSettings(); }, [auth.user, reloadSettings]);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch('/auth/me', { credentials: 'same-origin' });
      const d = await r.json();
      setAuth({ loading: false, user: d.user, ssoConfigured: d.ssoConfigured, devLogin: d.devLogin });
    } catch {
      setAuth({ loading: false, user: null, ssoConfigured: false, devLogin: false });
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  }, []);

  if (auth.loading) return null;

  return (
    <AuthCtx.Provider value={{ ...auth, refresh }}>
      <SettingsCtx.Provider value={{ settings, reloadSettings }}>
      <ToastCtx.Provider value={showToast}>
        <Routes>
          <Route path="/p/att/:token" element={<PublicCheckin />} />
          <Route path="/p/fb/:token" element={<PublicFeedback />} />
          <Route path="/p/nom/:token" element={<PublicNominate />} />
          <Route path="/p/approve/:token" element={<PublicApprove />} />
          <Route path="/p/cert/:certNo" element={<PublicCert />} />
          <Route path="/p/as/:token" element={<PublicAssessment />} />
          <Route path="/login" element={auth.user ? <Navigate to="/" replace /> : <Login />} />
          {auth.user?.role === 'learner' ? (
            <>
              {auth.user.od && <Route path="/od" element={<LearnerOD />} />}
              <Route path="*" element={<LearnerPortal />} />
            </>
          ) : (
          <Route element={<RequireUser user={auth.user}><Shell /></RequireUser>}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/calendar" element={<Calendar />} />
            <Route path="/employees" element={<Employees />} />
            <Route path="/trainings" element={<Trainings />} />
            <Route path="/attendance" element={<Attendance />} />
            <Route path="/feedback" element={<Feedback />} />
            <Route path="/assessments" element={<RequireLeader><Assessments /></RequireLeader>} />
            <Route path="/certificates" element={<RequireAdmin><Certificates /></RequireAdmin>} />
            <Route path="/od" element={<RequireOD><OrgDev /></RequireOD>} />
            <Route path="/expenses" element={<RequireAdmin><Expenses /></RequireAdmin>} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/mavericks" element={<RequireLeader><Mavericks /></RequireLeader>} />
            <Route path="/joiners" element={<NewJoiners />} />
            <Route path="/users" element={<RequireAdmin><Users /></RequireAdmin>} />
            <Route path="/settings" element={<RequireAdmin><Settings /></RequireAdmin>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
          )}
        </Routes>
        {toast && <div className="toast">{toast}</div>}
      </ToastCtx.Provider>
      </SettingsCtx.Provider>
    </AuthCtx.Provider>
  );
}

function RequireUser({ user, children }) {
  const loc = useLocation();
  if (!user) return <Navigate to="/login" replace state={{ from: loc }} />;
  return children;
}

function RequireAdmin({ children }) {
  const { user } = useAuth();
  if (user.role !== 'admin' && user.role !== 'super_admin') return <Navigate to="/" replace />;
  return children;
}

function RequireLeader({ children }) {
  const { user } = useAuth();
  if (!['leader', 'admin', 'super_admin'].includes(user.role)) return <Navigate to="/" replace />;
  return children;
}

// Organization Development is confidential: authorised OD users, the
// budget approvers and the super admin only (the server enforces it too).
function RequireOD({ children }) {
  const { user } = useAuth();
  if (!user.od) return <Navigate to="/" replace />;
  return children;
}

// An OD-authorised person whose portal role is Learner still gets the OD
// module, on top of their own portal.
function LearnerOD() {
  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 16px' }}>
      <p style={{ marginBottom: 12 }}><a href="/">← Back to my portal</a></p>
      <OrgDev />
    </div>
  );
}
