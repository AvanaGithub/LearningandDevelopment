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
import Expenses from './pages/Expenses.jsx';
import Reports from './pages/Reports.jsx';
import PublicCheckin from './pages/PublicCheckin.jsx';
import PublicFeedback from './pages/PublicFeedback.jsx';

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

const ToastCtx = createContext(null);
export const useToast = () => useContext(ToastCtx);

export default function App() {
  const [auth, setAuth] = useState({ loading: true, user: null, ssoConfigured: false, devLogin: false });
  const [toast, setToast] = useState(null);

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
      <ToastCtx.Provider value={showToast}>
        <Routes>
          <Route path="/p/att/:token" element={<PublicCheckin />} />
          <Route path="/p/fb/:token" element={<PublicFeedback />} />
          <Route path="/login" element={auth.user ? <Navigate to="/" replace /> : <Login />} />
          <Route element={<RequireUser user={auth.user}><Shell /></RequireUser>}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/calendar" element={<Calendar />} />
            <Route path="/employees" element={<Employees />} />
            <Route path="/trainings" element={<Trainings />} />
            <Route path="/attendance" element={<Attendance />} />
            <Route path="/feedback" element={<Feedback />} />
            <Route path="/expenses" element={<RequireAdmin><Expenses /></RequireAdmin>} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/users" element={<RequireAdmin><Users /></RequireAdmin>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
        {toast && <div className="toast">{toast}</div>}
      </ToastCtx.Provider>
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
