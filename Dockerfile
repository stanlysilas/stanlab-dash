FROM node:24-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

COPY dist ./dist
COPY config ./config
COPY scripts ./scripts

RUN mkdir -p /app/data && chown -R node:node /app
ENV XDG_DATA_HOME=/app/data
USER node

EXPOSE 3000
CMD ["node", "dist/server/index.js"]
