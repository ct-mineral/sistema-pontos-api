FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma
COPY prisma.config.* ./
RUN npm install --frozen-lockfile

COPY . .

RUN npm run build

FROM node:22-alpine AS production

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma
COPY prisma.config.* ./
RUN npm install --omit=dev --frozen-lockfile

COPY --from=builder /app/dist ./dist

EXPOSE 3000

CMD ["npm", "run", "start:prod"]