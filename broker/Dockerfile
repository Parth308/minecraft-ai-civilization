FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY broker ./broker
COPY shared ./shared

EXPOSE 3001
ENV NODE_ENV=production

CMD ["node", "broker/index.js"]
