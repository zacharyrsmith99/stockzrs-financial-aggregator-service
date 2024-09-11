# Production Dockerfile
FROM node:20 AS builder

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm install

COPY . .

RUN npm run build

FROM node:20-slim

WORKDIR /usr/src/app

COPY --from=builder /usr/src/app/dist ./dist
COPY --from=builder /usr/src/app/package*.json ./
COPY --from=builder /usr/src/app/.env.tpl ./.env.tpl

RUN npm install --only=production

COPY start.sh .
RUN chmod +x start.sh

CMD ["./start.sh"]