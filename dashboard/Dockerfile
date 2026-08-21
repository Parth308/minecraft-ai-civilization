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

# Copy shared utilities first (needed by logger etc.)
COPY shared/ ./shared/

# Install dashboard deps
COPY dashboard/package.json ./dashboard/
WORKDIR /app/dashboard
RUN npm install --omit=dev

# Copy dashboard source
COPY dashboard/ ./

EXPOSE 3003

HEALTHCHECK --interval=10s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://localhost:3003/health').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]

