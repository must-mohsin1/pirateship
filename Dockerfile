# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS dependencies

WORKDIR /app/services/product-key
COPY services/product-key/package.json services/product-key/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4173 \
    DATABASE_PATH=/data/product-keys.db

WORKDIR /app

COPY --from=dependencies /app/services/product-key/node_modules services/product-key/node_modules
COPY services/product-key/package.json services/product-key/package-lock.json services/product-key/
COPY services/product-key/server services/product-key/server
COPY pirate-network-blog.html mainnet-release-criteria.html page.js escrow-config.js escrow.js tokens.css ./
COPY assets assets

RUN install -d -m 0700 -o node -g node /data

USER node

EXPOSE 4173
VOLUME ["/data"]
STOPSIGNAL SIGTERM

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || '4173') + '/api/live').then((response) => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1));"]

CMD ["node", "services/product-key/server/index.mjs"]
