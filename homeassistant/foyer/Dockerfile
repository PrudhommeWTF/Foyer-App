# Local-build fallback for the Foyer add-on.
# Only used when the `image:` line is removed from config.yaml. It builds the
# app straight from the public repository so no prebuilt image is required.
ARG BUILD_FROM=node:22-alpine
# hadolint ignore=DL3006
FROM node:22-alpine AS build
RUN apk add --no-cache git python3 make g++
ARG FOYER_REF=main
RUN git clone --depth 1 --branch "${FOYER_REF}" https://github.com/PrudhommeWTF/Foyer-App /src
WORKDIR /src/frontend
RUN npm ci && npm run build
WORKDIR /src/backend
RUN npm ci && npm run build

FROM ${BUILD_FROM}
RUN apk add --no-cache nodejs npm 2>/dev/null || true
WORKDIR /app
COPY --from=build /src/backend/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /src/backend/dist ./dist
COPY --from=build /src/frontend/dist/frontend/browser ./public
ENV PORT=8099 FOYER_DATA_DIR=/data FOYER_STATIC_DIR=/app/public NODE_ENV=production
EXPOSE 8099
CMD ["node", "dist/server.js"]
