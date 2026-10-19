# Stage 1 — build the app: the Tailwind stylesheet (compiled through Vite's
# PostCSS pipeline) and the React bundle, into dist/.
FROM node:22-alpine AS build
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --include=dev
COPY vite.config.js postcss.config.js tailwind.config.js vitest.config.js ./
COPY styles ./styles
COPY web ./web
COPY public ./public
RUN npm run build

# Stage 2 — the app itself (server + dependencies + the built dist/).
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --chown=1000:1000 server.js ./
COPY --chown=1000:1000 --from=build /build/dist ./dist
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1
# Kubernetes enforces runAsNonRoot without supplying a UID. Keep this numeric:
# unlike a symbolic USER, it lets the kubelet verify the image before startup.
USER 1000:1000
CMD ["node", "server.js"]
