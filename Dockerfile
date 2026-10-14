# Build the client, then run the server from source: Node strips the TypeScript types itself.
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server server
COPY shared shared
COPY --from=build /app/dist dist
USER node
EXPOSE 8788
CMD ["node", "server/index.ts"]
