FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
ARG VITE_API_BASE_URL=http://localhost:8080
ARG VITE_USE_MOCKS=false
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_USE_MOCKS=$VITE_USE_MOCKS
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
