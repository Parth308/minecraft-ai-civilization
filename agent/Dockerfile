FROM node:20-alpine

WORKDIR /app

# Copy root package files
COPY package*.json ./

# Install dependencies
RUN npm install --omit=dev

# Copy application source
COPY agent ./agent
COPY shared ./shared

ENV NODE_ENV=production

CMD ["node", "agent/index.js"]

