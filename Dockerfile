FROM node:24-bookworm-slim@sha256:2c87ef9bd3c6a3bd4b472b4bec2ce9d16354b0c574f736c476489d09f560a203 AS build
WORKDIR /app

COPY package.json ./
COPY server/package.json server/package.json
COPY client/package.json client/package.json
RUN npm install

COPY . .
RUN npm run build

FROM node:24-bookworm-slim@sha256:2c87ef9bd3c6a3bd4b472b4bec2ce9d16354b0c574f736c476489d09f560a203
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

COPY package.json ./
COPY server/package.json server/package.json
COPY client/package.json client/package.json
RUN npm install --omit=dev

COPY --from=build /app/server/dist server/dist
COPY --from=build /app/client/dist client/dist

EXPOSE 8080
CMD ["node", "server/dist/index.js"]

