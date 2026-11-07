FROM node:24-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:24-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    DASH_BIND_ADDRESS=0.0.0.0 \
    STANLAB_DATA_DIR=/app/data/stanlab-dash \
    XDG_DATA_HOME=/app/data
LABEL org.opencontainers.image.source="https://github.com/stanlysilas/stanlab-dash"

RUN apt-get update \
    && apt-get install --yes --no-install-recommends bash coreutils \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/config ./config
COPY --from=build /app/scripts/hello-world.sh ./scripts/hello-world.sh
COPY --from=build /app/scripts/setup-auth.mjs ./scripts/setup-auth.mjs
COPY docker-entrypoint.sh /usr/local/bin/stanlab-entrypoint

RUN mkdir -p /app/data/stanlab-dash && chown -R node:node /app /usr/local/bin/stanlab-entrypoint && chmod 755 /usr/local/bin/stanlab-entrypoint
USER node

EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/stanlab-entrypoint"]
