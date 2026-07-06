FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
COPY scripts ./scripts
RUN npm ci --omit=dev
COPY server ./server
COPY snippets ./snippets
COPY --from=build /app/dist ./dist
ENV PORT=5328
ENV DATA_DIR=/data
VOLUME /data
EXPOSE 5328
CMD ["node", "server/index.js"]
