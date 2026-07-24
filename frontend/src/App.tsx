import { Navigate, Route, Routes, useLocation, useParams } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { useAuth } from "./lib/auth";
import { OpenAlertsProvider } from "./lib/openAlerts";
import { getToken } from "./lib/apiClient";
import { Login } from "./pages/Login";
import { Home } from "./pages/Home";
import { Inbox } from "./pages/Inbox";
import { Inquiries } from "./pages/Inquiries";
import { Orders } from "./pages/Orders";
import { Channels } from "./pages/Channels";
import { ChannelDetail } from "./pages/ChannelDetail";
import { Cafe24Connect } from "./pages/Cafe24Connect";
import { Cafe24ConnectResult } from "./pages/Cafe24ConnectResult";
import { ConnectNaver } from "./pages/ConnectNaver";
import { Upload } from "./pages/Upload";
import { ReviewImport } from "./pages/ReviewImport";
import { ProductIssues } from "./pages/ProductIssues";
import { Operations } from "./pages/Operations";
import { OperationsHome } from "./pages/OperationsHome";
import { Reports } from "./pages/Reports";
import { AlertSettings } from "./pages/AlertSettings";
import { NotFound } from "./pages/NotFound";

function Protected({ children }: { children: JSX.Element }) {
  if (!getToken()) {
    return <Navigate to="/login" replace />;
  }
  return children;
}

/** Backward-compatible redirect for the old channel-detail route, preserving the
 *  :accountId param: /channels/:id → /settings/channels/:id. */
function RedirectChannelDetail() {
  const { accountId = "" } = useParams();
  return <Navigate to={`/settings/channels/${accountId}`} replace />;
}

/** Backward-compatible redirect for /upload, preserving any query string (the
 *  `?channelId=` deep link the channel cards use). */
function RedirectUpload() {
  const { search } = useLocation();
  return <Navigate to={`/settings/upload${search}`} replace />;
}

export function App() {
  const { ready } = useAuth();
  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center text-muted">불러오는 중…</div>
    );
  }
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <Protected>
            <OpenAlertsProvider>
              <AppShell />
            </OpenAlertsProvider>
          </Protected>
        }
      >
        {/* Frontstage — daily seller operations */}
        <Route path="/" element={<Home />} />
        <Route path="/inbox" element={<Inbox />} />
        <Route path="/inquiries" element={<Inquiries />} />
        <Route path="/orders" element={<Orders />} />
        <Route path="/issues" element={<ProductIssues />} />
        {/* FE-2 IA: /operations = operations-agent home, /operations/current = run detail. */}
        <Route path="/operations" element={<OperationsHome />} />
        <Route path="/operations/current" element={<Operations />} />
        <Route path="/reports" element={<Reports />} />

        {/* Backstage — connection & collection management */}
        <Route path="/settings/channels" element={<Channels />} />
        <Route path="/settings/channels/:accountId" element={<ChannelDetail />} />
        <Route path="/settings/upload" element={<Upload />} />
        <Route path="/settings/review-import" element={<ReviewImport />} />
        <Route path="/settings/alerts" element={<AlertSettings />} />

        {/* Cafe24 OAuth connect flow (unchanged) */}
        <Route path="/connect/cafe24" element={<Cafe24Connect />} />
        <Route path="/connect/cafe24/result" element={<Cafe24ConnectResult />} />

        {/* NAVER guided-connection wizard (offline; §16.10 six steps) */}
        <Route path="/connect/naver" element={<ConnectNaver />} />

        {/* Backward-compatible redirects from the pre-Product-Shell routes */}
        <Route path="/channels" element={<Navigate to="/settings/channels" replace />} />
        <Route path="/channels/:accountId" element={<RedirectChannelDetail />} />
        <Route path="/upload" element={<RedirectUpload />} />
        <Route path="/alerts" element={<Navigate to="/settings/alerts" replace />} />

        {/* Unknown paths render a real 404 (no silent redirect). An unauthenticated
            visitor is sent to /login first by <Protected> above. */}
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
