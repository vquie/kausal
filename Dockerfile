FROM node:20-bookworm-slim AS build
WORKDIR /app

COPY package.json ./
COPY server/package.json server/package.json
COPY client/package.json client/package.json
RUN npm install

COPY . .
RUN npm run build

FROM node:20-bookworm-slim
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

