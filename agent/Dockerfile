FROM node:20-slim

# Install system libraries needed by node-canvas at runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
    libcairo2 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libjpeg62-turbo \
    libgif7 \
    librsvg2-2 \
    && rm -rf /var/lib/apt/lists/*

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

