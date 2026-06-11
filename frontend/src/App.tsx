import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { useAuth } from "./lib/auth";
import { getToken } from "./lib/apiClient";
import { Login } from "./pages/Login";
import { Home } from "./pages/Home";
import { Inbox } from "./pages/Inbox";
import { Orders } from "./pages/Orders";
import { Channels } from "./pages/Channels";
import { ChannelDetail } from "./pages/ChannelDetail";
import { Upload } from "./pages/Upload";
import { ProductIssues } from "./pages/ProductIssues";
import { AiSearch } from "./pages/AiSearch";
import { Reports } from "./pages/Reports";
import { AlertSettings } from "./pages/AlertSettings";

function Protected({ children }: { children: JSX.Element }) {
  if (!getToken()) {
    return <Navigate to="/login" replace />;
  }
  return children;
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
            <AppShell />
          </Protected>
        }
      >
        <Route path="/" element={<Home />} />
        <Route path="/inbox" element={<Inbox />} />
        <Route path="/orders" element={<Orders />} />
        <Route path="/issues" element={<ProductIssues />} />
        <Route path="/search" element={<AiSearch />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/channels" element={<Channels />} />
        <Route path="/channels/:accountId" element={<ChannelDetail />} />
        <Route path="/upload" element={<Upload />} />
        <Route path="/alerts" element={<AlertSettings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
