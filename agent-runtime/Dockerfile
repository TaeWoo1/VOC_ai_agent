# Agent Runtime container image.
#
# Runs the HTTP orchestration service via tsx (the same runner used for the CLIs) — no build
# step, so the image is the source plus its dependencies. The service holds NO channel credential
# and NO JWT signing key; it only forwards the operator's bearer token to the backend, so there
# are no secrets to bake in. Configure it entirely through env vars (see .env.example).
#
# NOTE: booting with APP_ENV=production requires AGENT_RUNTIME_RUNSTORE_KIND=spring (the
# backend-owned, org-isolated, optimistic-locked store); a file/in-memory store FAILS CLOSED at
# boot in production. The defaults below are dev/proof (file store); the pilot stack
# (docker-compose.yml) overrides APP_ENV=production + the spring store.
FROM node:20-slim

ENV NODE_ENV=production
WORKDIR /app

# Install dependencies first for layer caching. `npm ci` needs devDependencies too (tsx +
# typescript are the runtime here), so do not pass --omit=dev.
COPY package.json package-lock.json ./
RUN npm ci

# App source.
COPY tsconfig.json ./
COPY src ./src

# Defaults; override at run time.
ENV AGENT_RUNTIME_PORT=8787
ENV SELLEROPS_BASE_URL=http://host.docker.internal:8080
ENV AGENT_RUNTIME_RUNSTORE_KIND=file
ENV AGENT_RUNTIME_RUNSTORE_DIR=/data/runstore
ENV APP_ENV=development

EXPOSE 8787
VOLUME ["/data/runstore"]

# Liveness: the service answers /health without auth.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.AGENT_RUNTIME_PORT||8787)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "run", "serve"]
