import { useEffect } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Layout } from "@/components/common/Layout";
import { PageLoader } from "@/components/ui";
import AdminDashboard from "@/dashboards/AdminDashboard";
import ProjectOverviewDashboard from "@/dashboards/ProjectOverviewDashboard";
import StudentDashboard from "@/dashboards/StudentDashboard";
import SupervisorDashboard from "@/dashboards/SupervisorDashboard";
import { useAuth } from "@/hooks/useAuth";
import AcceptInvite from "@/pages/AcceptInvite";
import { AuthPage } from "@/pages/AuthPages";
import ForgotPassword from "@/pages/ForgotPassword";
import Discover from "@/pages/Discover";
import Forum from "@/pages/Forum";
import GithubCallback from "@/pages/GithubCallback";
import LandingPage from "@/pages/LandingPage";
import Messages from "@/pages/Messages";
import Notifications from "@/pages/Notifications";
import ProfilePage from "@/pages/ProfilePage";
import Projects from "@/pages/Projects";
import ResetPassword from "@/pages/ResetPassword";

/** Requires a session and a loaded profile; otherwise sends the user to sign in (remembering where they were going). */
function Protected() {
  const { session, profile, loading } = useAuth(); const loc = useLocation();
  if (loading) return <div className="grid min-h-screen place-items-center"><PageLoader /></div>;
  if (!session) return <Navigate to={`/sign-in?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  if (!profile) return <div className="grid min-h-screen place-items-center"><PageLoader /></div>;
  return <Layout />;
}

/** The dashboard you see depends on your platform role. */
function DashboardRouter() {
  const role = useAuth((s) => s.profile?.role);
  return role === "admin" ? <AdminDashboard /> : role === "supervisor" ? <SupervisorDashboard /> : <StudentDashboard />;
}
function AdminOnly({ children }: { children: React.ReactNode }) { return useAuth((s) => s.profile?.role) === "admin" ? <>{children}</> : <Navigate to="/dashboard" replace />; }

export default function App() {
  const init = useAuth((s) => s.init);
  useEffect(() => { init(); }, [init]);
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/sign-in" element={<AuthPage mode="sign-in" />} />
      <Route path="/sign-up" element={<AuthPage mode="sign-up" />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/invite/:token" element={<AcceptInvite />} />
      <Route element={<Protected />}>
        <Route path="/dashboard" element={<DashboardRouter />} />
        <Route path="/projects" element={<Projects />} />
        <Route path="/projects/:id" element={<ProjectOverviewDashboard />} />
        <Route path="/discover" element={<Discover />} />
        <Route path="/messages" element={<Messages />} />
        <Route path="/forum" element={<Forum />} />
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/github/callback" element={<GithubCallback />} />
        <Route path="/admin" element={<AdminOnly><AdminDashboard /></AdminOnly>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
