# syntax=docker/dockerfile:1
# ============================================================
# Foyer — single-image build (Angular SPA served by the API).
# The backend serves both /api and the built frontend, so one
# container is all you need to self-host.
# ============================================================

# ---- Stage 1: build the Angular frontend ----
FROM node:22-alpine AS frontend
ENV NG_CLI_ANALYTICS=false
WORKDIR /build/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---- Stage 2: build the backend ----
FROM node:22-alpine AS backend
WORKDIR /build/backend
COPY backend/package*.json ./
RUN npm ci
COPY backend/ ./
RUN npm run build

# ---- Stage 3: runtime ----
# Debian-slim (glibc) so better-sqlite3's prebuilt binary loads without compiling.
FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Backend production deps only
COPY backend/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Compiled backend + built frontend
COPY --from=backend /build/backend/dist ./dist
COPY --from=frontend /build/frontend/dist/frontend/browser ./public

ENV PORT=8099
ENV FOYER_DATA_DIR=/data
ENV FOYER_STATIC_DIR=/app/public
# Version affichée / comparée aux releases GitHub. Injectée depuis le tag Git au
# build (voir .github/workflows/docker.yml) ; vide → repli sur package.json.
ARG FOYER_VERSION=
ENV FOYER_VERSION=${FOYER_VERSION}
VOLUME ["/data"]
EXPOSE 8099

# Healthcheck using Node's global fetch (no extra tooling needed)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8099/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]
