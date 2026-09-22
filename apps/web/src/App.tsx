import { Route, Routes, Navigate } from "react-router-dom";
import { AdminLayout } from "./pages/admin/AdminLayout";
import { LoginPage } from "./pages/admin/LoginPage";
import { DashboardPage } from "./pages/admin/DashboardPage";
import { EventsPage } from "./pages/admin/EventsPage";
import { EventDetailPage } from "./pages/admin/EventDetailPage";
import { AdminUsersPage } from "./pages/admin/AdminUsersPage";
import { JoinPage } from "./pages/judge/JoinPage";
import { ViewerPage } from "./pages/judge/ViewerPage";
import { AuthProvider, useAuth } from "./lib/auth";
import { isJudgeDevice } from "./lib/judge";

function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex h-screen items-center justify-center text-ink-400">Loading…</div>;
  // A device that was used for judging never gets to see the admin area, even
  // after leaving the session: send it back to the join page instead of the
  // admin login URL.
  if (!user && isJudgeDevice()) return <Navigate to="/join" replace />;
  if (!user) return <Navigate to="/admin/login" replace />;
  return <>{children}</>;
}

function AdminEntry({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex h-screen items-center justify-center text-ink-400">Loading…</div>;
  // Judge devices never land on the admin login page, even by typing the URL.
  if (!user && isJudgeDevice()) return <Navigate to="/join" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route
          path="/admin/login"
          element={
            <AdminEntry>
              <LoginPage />
            </AdminEntry>
          }
        />
        <Route
          path="/admin"
          element={
            <RequireAdmin>
              <AdminLayout />
            </RequireAdmin>
          }
        >
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="events" element={<EventsPage />} />
          <Route path="events/:id" element={<EventDetailPage />} />
          <Route path="users" element={<AdminUsersPage />} />
        </Route>

        <Route path="/join" element={<JoinPage />} />
        <Route path="/viewer" element={<ViewerPage />} />

        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
    </AuthProvider>
  );
}