FROM oven/bun:1.2-alpine AS deps

USER root
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM oven/bun:1.2-alpine AS runtime

USER root
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=5000

COPY --from=deps --chown=bun:bun /app/node_modules ./node_modules
COPY --chown=bun:bun package.json ./
COPY --chown=bun:bun src ./src
RUN mkdir -p /app/logs /app/data/uploads && chown -R bun:bun /app

USER bun

EXPOSE 5000

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD bun -e "const r=await fetch('http://127.0.0.1:'+(process.env.PORT||5000)+'/api/v1/health/live'); if(!r.ok) process.exit(1)"

CMD ["bun", "src/index.ts"]
