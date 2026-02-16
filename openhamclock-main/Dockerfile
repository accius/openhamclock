# OpenHamClock Dockerfile
# Multi-stage build for optimized production image

# ============================================
# Stage 1: Build Frontend
# ============================================
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install ALL dependencies (including devDependencies for Vite)
RUN npm install

# Copy source files
COPY . .

# Ensure public/ exists (may not be tracked in git)
RUN mkdir -p /app/public

# Download vendor assets for self-hosting (fonts, Leaflet — no external CDN at runtime)
RUN apk add --no-cache curl && bash scripts/vendor-download.sh || true

# Build the React app with Vite
RUN npm run build

# ============================================
# Stage 2: Production
# ============================================
FROM node:20-alpine AS production

# Set environment
ENV NODE_ENV=production
ENV PORT=3000

WORKDIR /app

# Create /data directory for persistent stats (Railway volume mount point)
RUN mkdir -p /data

# Copy package files and install production deps only
COPY package*.json ./
RUN npm install --omit=dev

# Copy server files
COPY server.js ./
COPY config.js ./

# Copy WSJT-X relay agent (served as download to users)
COPY wsjtx-relay ./wsjtx-relay

# Copy built frontend from builder stage
COPY --from=builder /app/dist ./dist

# Copy public folder from builder (for monolithic fallback reference)
# Using builder stage because public/ may not be separately available in production context
COPY --from=builder /app/public ./public

# Create local data directory as fallback
RUN mkdir -p /app/data

# Expose ports (3000 = web, 2237 = WSJT-X UDP)
EXPOSE 3000
EXPOSE 2237/udp

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

# Start server with explicit heap limit (fail fast rather than slow OOM at 4GB)
CMD ["node", "--max-old-space-size=1024", "server.js"]
