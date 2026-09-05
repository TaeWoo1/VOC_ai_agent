FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
ARG VITE_API_BASE_URL=http://localhost:8080
ARG VITE_USE_MOCKS=false
# The browser's URL for the agent runtime. It is baked into the bundle, so on any host that is
# not the seller's own machine it MUST be set: the code default is http://127.0.0.1:8787, which
# on a remote pilot host points the seller's browser at the seller's own computer and makes the
# /agent lane fail as "AI 도우미를 시작하지 못했습니다" for everybody (Pilot Runtime Foundation v1 §11).
ARG VITE_AGENT_RUNTIME_URL=http://127.0.0.1:8787
# The reviewnary 도우미 (Local Agent Bridge) — the seller's own machine, so the URL stays local even on a
# remote pilot host. OFF by default: with it unset the production CSP does not name the bridge origin, the
# browser refuses the helper's http/ws, and the guided lanes degrade to the honest manual handoff. Turning
# it on is what makes Guided Reply composer fill a capability of a PILOT build rather than of a dev server
# (Pilot Release Closure v1 §2) — `VITE_AW_BRIDGE` is a different, dev-only flag and is NOT this.
ARG VITE_ENABLE_AGENT_BRIDGE=
ARG VITE_BRIDGE_URL=
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_USE_MOCKS=$VITE_USE_MOCKS
ENV VITE_AGENT_RUNTIME_URL=$VITE_AGENT_RUNTIME_URL
ENV VITE_ENABLE_AGENT_BRIDGE=$VITE_ENABLE_AGENT_BRIDGE
ENV VITE_BRIDGE_URL=$VITE_BRIDGE_URL
# Service Readiness v1 (docs/service_readiness_v1.md §5): all optional; absent = that vendor is OFF and the CSP
# does not name it. SELLEROPS_RELEASE = Sentry release (git SHA when the build has .git).
ARG VITE_SENTRY_DSN=
ARG VITE_SELLEROPS_ENV=local
ARG VITE_SENTRY_TRACES_SAMPLE_RATE=0.1
ARG VITE_GTM_ID=
ARG VITE_POSTHOG_KEY=
ARG VITE_POSTHOG_HOST=
ARG SELLEROPS_RELEASE=
ENV VITE_SENTRY_DSN=$VITE_SENTRY_DSN VITE_SELLEROPS_ENV=$VITE_SELLEROPS_ENV \
    VITE_SENTRY_TRACES_SAMPLE_RATE=$VITE_SENTRY_TRACES_SAMPLE_RATE VITE_GTM_ID=$VITE_GTM_ID \
    VITE_POSTHOG_KEY=$VITE_POSTHOG_KEY VITE_POSTHOG_HOST=$VITE_POSTHOG_HOST SELLEROPS_RELEASE=$SELLEROPS_RELEASE
RUN npm run build

FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
