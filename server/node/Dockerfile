# Build from the repository root:
#   docker build -f server/node/Dockerfile -t openparty-server .
#   docker run -p 8787:8787 -e PUBLIC_HOST=party.example.com openparty-server
FROM node:24-alpine
WORKDIR /app
COPY server/node/package.json server/node/package-lock.json ./server/node/
RUN cd server/node && npm ci --omit=dev && npm cache clean --force
COPY server/core ./server/core
COPY server/node/server.js ./server/node/
ENV NODE_ENV=production PORT=8787
EXPOSE 8787
USER node
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8787/healthz || exit 1
CMD ["node", "server/node/server.js"]
