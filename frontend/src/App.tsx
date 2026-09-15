// โครงแอป: ตรวจการล็อกอิน, แถบเมนูข้าง และเส้นทางของแต่ละหน้า

import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { ApiError, api, setUnauthorizedHandler, type ApiUser } from './api/client.js';
import {
  IconAdmin,
  IconAlert,
  IconDashboard,
  IconLogout,
  IconSearch,
  LogoCube,
} from './components/icons.js';
import { Admin } from './pages/Admin.js';
import { Alerts } from './pages/Alerts.js';
import { Dashboard } from './pages/Dashboard.js';
import { Login } from './pages/Login.js';
import { Search } from './pages/Search.js';

export function useSession() {
  return useQuery({
    queryKey: ['session'],
    queryFn: async () => {
      try {
        const { user } = await api.get<{ user: ApiUser }>('/auth/me');
        return user;
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    retry: false,
    refetchInterval: false,
  });
}

function endSession(): void {
  window.location.replace('/');
}

function Shell({ user }: { user: ApiUser }) {
  const signOut = async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      endSession();
    }
  };

  return (
    <div className="app">
      <nav className="sidebar">
        <div className="brand">
          <LogoCube />
          <strong>Mini SIEM</strong>
        </div>

        <NavLink to="/" end className="nav-link"><IconDashboard /><span>Dashboard</span></NavLink>
        <NavLink to="/search" className="nav-link"><IconSearch /><span>Search</span></NavLink>
        <NavLink to="/alerts" className="nav-link"><IconAlert /><span>Alerts</span></NavLink>
        {user.role === 'admin' && (
          <NavLink to="/admin" className="nav-link"><IconAdmin /><span>Administration</span></NavLink>
        )}

        <div className="sidebar-footer">
          <div className="who">
            <span className="avatar" aria-hidden="true">{user.email.slice(0, 1).toUpperCase()}</span>
            <strong>{user.email}</strong>
          </div>
          <button onClick={() => void signOut()}>
            <IconLogout />
            Sign out
          </button>
        </div>
      </nav>

      <main className="main">
        <Routes>
          <Route path="/" element={<Dashboard user={user} />} />
          <Route path="/search" element={<Search user={user} />} />
          <Route path="/alerts" element={<Alerts user={user} />} />
          <Route
            path="/admin"
            element={
              user.role === 'admin' ? <Admin user={user} /> : <Navigate to="/" replace />
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

export function App() {
  const { data: user, isLoading } = useSession();

  useEffect(() => {
    setUnauthorizedHandler(endSession);
  }, []);

  if (isLoading) {
    return <div className="empty">Loading…</div>;
  }

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route path="*" element={<Shell user={user} />} />
    </Routes>
  );
}
