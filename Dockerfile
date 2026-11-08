FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
# No runtime dependencies: Node runs the TypeScript sources directly (type stripping).
COPY package.json ./
COPY src ./src
USER node
ENV PORT=7000
EXPOSE 7000
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s \
  CMD wget -qO- "http://127.0.0.1:${PORT}${BASE_PATH:-}/health" >/dev/null || exit 1
CMD ["node", "src/server.ts"]
