import { Navigate, Route, Routes, useLocation, useParams } from "react-router-dom";
import { AppShellV2 } from "./components/app/AppShellV2";
import { AppProviders } from "./components/app/AppProviders";
import { PublicShell } from "./components/public/PublicShell";
import { useAuth } from "./lib/auth";
import { getToken } from "./lib/apiClient";
import { LEGACY_REDIRECTS, resolveLegacyTarget, type LegacyRedirect } from "./lib/legacyRoutes";

// Public surface
import { ProductLanding } from "./pages/ProductLanding";
import { Login } from "./pages/Login";

// v2 app surface
import { HomeV2 } from "./pages/app/HomeV2";
import { CustomerInbox } from "./pages/app/CustomerInbox";
import { CustomerMemory } from "./pages/app/CustomerMemory";
import { ReportsV2 } from "./pages/app/ReportsV2";
import { ConnectHub } from "./pages/app/ConnectHub";
import { SettingsHome } from "./pages/app/SettingsHome";

// Carried-over working surfaces. These keep their behaviour in Slice 3 and are re-homed under the
// new IA; the ones scheduled for replacement are rebuilt in Slices 4-6.
import { Orders } from "./pages/Orders";
import { ChannelWorkspace } from "./pages/app/ChannelWorkspace";
import { Upload } from "./pages/Upload";
import { ReviewImport } from "./pages/ReviewImport";
import { OperationsHome } from "./pages/OperationsHome";
import { Operations } from "./pages/Operations";
import { AlertSettings } from "./pages/AlertSettings";
import { Cafe24Connect } from "./pages/Cafe24Connect";
import { Cafe24ConnectResult } from "./pages/Cafe24ConnectResult";
import { Cafe24Tutorial } from "./pages/Cafe24Tutorial";
import { ConnectNaver } from "./pages/ConnectNaver";
import { ConnectCoupang } from "./pages/ConnectCoupang";
import { Agent } from "./pages/Agent";
import { NotFound } from "./pages/NotFound";

function Protected({ children }: { children: JSX.Element }) {
  if (!getToken()) {
    return <Navigate to="/login" replace />;
  }
  return children;
}

/** Renders one entry of the legacy map, substituting route params and query string. */
function LegacyRoute({ redirect }: { redirect: LegacyRedirect }) {
  const params = useParams();
  const { search } = useLocation();
  return <Navigate to={resolveLegacyTarget(redirect, params, search)} replace />;
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
      {/* Public surface — renders with no token, no org, no app state. `PublicShell` must stay
          free of auth/alert providers so an unauthenticated visitor can reach it.

          There is deliberately NO public `*` catch-all: two catch-alls at the same depth rank
          equally in the router, and the earlier one would then swallow unknown paths for SIGNED-IN
          users too, replacing the app 404 with the public one. Unauthenticated unknown paths land
          on /login (via <Protected> below), which links back to /product. */}
      <Route element={<PublicShell />}>
        <Route path="/product" element={<ProductLanding />} />
        <Route path="/product/*" element={<Navigate to="/product" replace />} />
        <Route path="/login" element={<Login />} />
      </Route>

      <Route
        element={
          <Protected>
            <AppProviders>
              <AppShellV2 />
            </AppProviders>
          </Protected>
        }
      >
        {/* 운영 — the daily customer-operations surface */}
        <Route path="/" element={<HomeV2 />} />
        <Route path="/inbox" element={<CustomerInbox />} />
        {/* Deep link to one row. The page resolves it against everything loaded, so a shared link
            opens its item even when the reader's filters would have hidden it. */}
        <Route path="/inbox/:itemRef" element={<CustomerInbox />} />
        <Route path="/memory" element={<CustomerMemory />} />
        <Route path="/memory/:issueId" element={<CustomerMemory />} />
        <Route path="/orders" element={<Orders />} />
        <Route path="/reports" element={<ReportsV2 />} />

        {/* 연결·설정 — everything about getting data in and keeping it flowing */}
        <Route path="/connect" element={<ConnectHub />} />
        {/* The channel list lives on the hub itself; a separate list page had nothing to say
            except "the list is over there". */}
        <Route path="/connect/channels" element={<Navigate to="/connect" replace />} />
        <Route path="/connect/channels/:accountId" element={<ChannelWorkspace />} />
        <Route path="/connect/upload" element={<Upload />} />
        <Route path="/connect/review-history" element={<ReviewImport />} />
        <Route path="/connect/imports" element={<OperationsHome />} />
        <Route path="/connect/imports/current" element={<Operations />} />
        <Route path="/connect/cafe24" element={<Cafe24Connect />} />
        <Route path="/connect/cafe24/tutorial" element={<Cafe24Tutorial />} />
        <Route path="/connect/cafe24/result" element={<Cafe24ConnectResult />} />
        <Route path="/connect/naver" element={<ConnectNaver />} />
        <Route path="/connect/coupang" element={<ConnectCoupang />} />

        <Route path="/settings" element={<SettingsHome />} />
        <Route path="/settings/alerts" element={<AlertSettings />} />

        {/* Operations agent — reachable, but not a navigation destination. It becomes an action
            offered inside 운영 홈 / 인박스 / 메모리 rather than a menu entry of its own. */}
        <Route path="/agent" element={<Agent />} />

        {/* Legacy paths from the pre-v2 IA. Kept for one release so existing links and bookmarks
            do not break; the map lives in `lib/legacyRoutes.ts` and removal is decided after
            Slice 6. */}
        {LEGACY_REDIRECTS.map((redirect) => (
          <Route
            key={redirect.from}
            path={redirect.from}
            element={<LegacyRoute redirect={redirect} />}
          />
        ))}

        {/* Unknown paths render a real 404 (no silent redirect). An unauthenticated visitor is
            sent to /login first by <Protected> above. */}
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
