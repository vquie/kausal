FROM node:24-bookworm-slim@sha256:2c87ef9bd3c6a3bd4b472b4bec2ce9d16354b0c574f736c476489d09f560a203 AS build
WORKDIR /app

COPY package.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/client/package.json apps/client/package.json
RUN npm install

COPY . .
RUN npm run build

FROM node:24-bookworm-slim@sha256:2c87ef9bd3c6a3bd4b472b4bec2ce9d16354b0c574f736c476489d09f560a203
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
