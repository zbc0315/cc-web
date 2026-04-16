import React, { Suspense, useEffect, useState, useCallback } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { isLocalAccess, getLocalToken, getInstalledPlugins, type PluginInfo, type PluginScope } from './lib/api';
import { useAuthStore } from './lib/stores';
import { ThemeProvider } from './components/theme-provider';
import { Toaster } from 'sonner';
import { ErrorBoundary } from './components/ErrorBoundary';
import { PomodoroController, PomodoroOverlay } from './components/PomodoroTimer';
import { FloatManager } from './components/FloatManager';
import { PluginDock } from './components/PluginDock';

// Lazy-loaded routes
const ProjectPage = React.lazy(() => import('./pages/ProjectPage').then((m) => ({ default: m.ProjectPage })));
const SettingsPage = React.lazy(() => import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const SkillHubPage = React.lazy(() => import('./pages/SkillHubPage').then((m) => ({ default: m.SkillHubPage })));
const ShareViewPage = React.lazy(() => import('./pages/ShareViewPage').then((m) => ({ default: m.ShareViewPage })));
const MobilePage = React.lazy(() => import('./pages/MobilePage').then((m) => ({ default: m.MobilePage })));

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

// ── Mobile device detection (evaluated once at startup) ─────────────────────

const IS_MOBILE_DEVICE =
  window.matchMedia('(pointer: coarse)').matches && window.innerWidth < 768;

// ── Plugin state container (inside BrowserRouter) ────────────────────────────

function PluginLayer() {
  const [allPlugins, setAllPlugins] = useState<PluginInfo[]>([]);
  const [openIds, setOpenIds] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem('cc_plugin_open') || '[]'));
    } catch { return new Set(); }
  });
  const location = useLocation();

  useEffect(() => {
    getInstalledPlugins()
      .then(setAllPlugins)
      .catch(() => setAllPlugins([]));
  }, []);

  const handleToggle = useCallback((plugin: PluginInfo) => {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(plugin.id)) {
        next.delete(plugin.id);
      } else {
        next.add(plugin.id);
      }
      try { localStorage.setItem('cc_plugin_open', JSON.stringify([...next])); } catch { /* */ }
      return next;
    });
  }, []);

  const handleClose = useCallback((id: string) => {
    setOpenIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      try { localStorage.setItem('cc_plugin_open', JSON.stringify([...next])); } catch { /* */ }
      return next;
    });
  }, []);

  // Filter visible float windows by scope + current page + open state
  const currentPage = derivePageContext(location.pathname);
  const visiblePlugins = allPlugins.filter((p) => {
    if (!p.enabled || !openIds.has(p.id)) return false;
    const scope: PluginScope = p.userConfig.scope ?? p.float.scope.default;
    switch (scope) {
      case 'global': return true;
      case 'dashboard': return currentPage.type === 'dashboard';
      case 'project': return currentPage.type === 'project';
      case 'project:specific':
        return currentPage.type === 'project' && (p.userConfig.projectIds ?? []).includes(currentPage.projectId ?? '');
      default: return false;
    }
  });

  // Don't show dock on login page or mobile
  const isLoginPage = location.pathname === '/login';
  const isMobilePage = location.pathname === '/mobile';

  return (
    <>
      {!isLoginPage && !isMobilePage && !IS_MOBILE_DEVICE && (
        <PluginDock onTogglePlugin={handleToggle} activeIds={openIds} />
      )}
      <FloatManager
        plugins={visiblePlugins}
        onPluginsChange={setAllPlugins}
        onClose={handleClose}
      />
    </>
  );
}

function derivePageContext(pathname: string): { type: 'dashboard' | 'project' | 'other'; projectId?: string } {
  if (pathname === '/' || pathname === '/dashboard') return { type: 'dashboard' };
  const m = pathname.match(/^\/projects?\/([^/]+)/);
  if (m) return { type: 'project', projectId: m[1] };
  return { type: 'other' };
}

/** On mobile devices, redirect desktop routes to /mobile */
function MobileRedirectGuard({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  if (IS_MOBILE_DEVICE && location.pathname === '/') {
    return <Navigate to="/mobile" replace />;
  }
  return <>{children}</>;
}

// ── App ──────────────────────────────────────────────────────────────────────

function App() {
  return (
    <ThemeProvider>
    <Toaster richColors position="bottom-right" />
    <PomodoroController />
    <PomodoroOverlay />
    <ErrorBoundary>
    <BrowserRouter>
      <PluginLayer />
      <MobileRedirectGuard>
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
        <Route
          path="/mobile"
          element={
            <PrivateRoute>
              <MobilePage />
            </PrivateRoute>
          }
        />
        <Route path="/share/:token" element={<ShareViewPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
      </MobileRedirectGuard>
    </BrowserRouter>
    </ErrorBoundary>
    </ThemeProvider>
  );
}

export default App;
