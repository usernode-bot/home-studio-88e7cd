# The self-hosted Home Studio node. The store (with the gallery) is the
# main process; the signaling relay runs separately when you want
# multi-person collaboration (see docs/self-hosting.md).
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY store.js gallery.js signal.js ./
RUN mkdir -p /data && chown -R 1000:1000 /app /data
USER 1000:1000
ENV HOME_STUDIO_DATA=/data
EXPOSE 8787 8788
CMD ["node", "store.js"]