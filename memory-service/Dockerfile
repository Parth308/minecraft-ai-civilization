FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY memory-service ./memory-service
COPY shared ./shared

EXPOSE 3002
ENV NODE_ENV=production

CMD ["node", "memory-service/index.js"]
