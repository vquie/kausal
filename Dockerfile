FROM node:24-bookworm-slim@sha256:b31e7a42fdf8b8aa5f5ed477c72d694301273f1069c5a2f71d53c6482e99a2fc AS build
WORKDIR /app

COPY package.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/client/package.json apps/client/package.json
RUN npm install

COPY . .
RUN npm run build

FROM node:24-bookworm-slim@sha256:b31e7a42fdf8b8aa5f5ed477c72d694301273f1069c5a2f71d53c6482e99a2fc
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

COPY package.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/client/package.json apps/client/package.json
RUN npm install --omit=dev

COPY --from=build /app/apps/server/dist apps/server/dist
COPY --from=build /app/apps/client/dist apps/client/dist

EXPOSE 8080
CMD ["node", "apps/server/dist/index.js"]
