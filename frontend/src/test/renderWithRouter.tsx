// FE-7 shared render helper for page-level DOM integration tests.
//
// The Operations pages need a Router in context only because they (and
// `ActiveRunCard`) render `<Link>` — no `useParams`/`useNavigate`. A `MemoryRouter`
// satisfies that with no route config and no history/navigation mocking, so tests
// render a page in isolation and assert what it renders from store state.
import type { ReactElement } from "react";
import { render, type RenderResult } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

export function renderWithRouter(ui: ReactElement): RenderResult {
  return render(ui, {
    wrapper: ({ children }) => <MemoryRouter>{children}</MemoryRouter>,
  });
}

// Re-export the query surface so page tests import everything from one place.
export { screen, within, waitFor } from "@testing-library/react";
export { default as userEvent } from "@testing-library/user-event";
