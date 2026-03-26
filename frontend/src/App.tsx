import React, { Suspense, useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { isLocalAccess, getLocalToken } from './lib/api';
import { useAuthStore } from './lib/stores';
import { ThemeProvider } from './components/theme-provider';
import { Toaster } from 'sonner';
import { ErrorBoundary } from './components/ErrorBoundary';

// Lazy-loaded routes
const ProjectPage = React.lazy(() => import('./pages/ProjectPage').then((m) => ({ default: m.ProjectPage })));
const SettingsPage = React.lazy(() => import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const SkillHubPage = React.lazy(() => import('./pages/SkillHubPage').then((m) => ({ default: m.SkillHubPage })));
const ShareViewPage = React.lazy(() => import('./pages/ShareViewPage').then((m) => ({ default: m.ShareViewPage })));

function LazyFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <span className="text-muted-foreground text-sm">Loading…</span>
    </div>
  );
}

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const token = useAuthStore((s) => s.token);
  const storeSetToken = useAuthStore((s) => s.setToken);

  useEffect(() => {
    if (token) {
      setReady(true);
      return;
    }

    // No token — try local auto-auth
    if (isLocalAccess()) {
      getLocalToken()
        .then((t) => storeSetToken(t))
        .catch(() => {})
        .finally(() => setReady(true));
    } else {
      setReady(true);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!ready && !token) return null; // brief loading
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function App() {
  return (
    <ThemeProvider>
    <Toaster richColors position="bottom-right" />
    <ErrorBoundary>
    <BrowserRouter>
      <Suspense fallback={<LazyFallback />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/"
          element={
            <PrivateRoute>
              <DashboardPage />
            </PrivateRoute>
          }
        />
        <Route
          path="/projects/:id"
          element={
            <PrivateRoute>
              <ProjectPage />
            </PrivateRoute>
          }
        />
        <Route
          path="/settings"
          element={
            <PrivateRoute>
              <SettingsPage />
            </PrivateRoute>
          }
        />
        <Route
          path="/skillhub"
          element={
            <PrivateRoute>
              <SkillHubPage />
            </PrivateRoute>
          }
        />
        <Route path="/share/:token" element={<ShareViewPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
    </BrowserRouter>
    </ErrorBoundary>
    </ThemeProvider>
  );
}

export default App;
