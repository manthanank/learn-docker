# ==========================================
# Stage 1: Build & Compilation Stage
# ==========================================
FROM node:22-alpine AS builder

WORKDIR /app

# Copy dependency manifests
COPY package*.json tsconfig.json ./

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy source code and public assets
COPY src/ ./src/
COPY public/ ./public/

# Compile TypeScript
RUN npm run build

# Prune devDependencies to keep final image slim
RUN npm prune --production

# ==========================================
# Stage 2: Hardened Production Runtime Stage
# ==========================================
FROM node:22-alpine AS runner

# Security: Define build metadata & OCI annotations
LABEL org.opencontainers.image.title="learn-docker" \
      org.opencontainers.image.description="Interactive Docker Internals & Architecture Platform" \
      org.opencontainers.image.authors="Manthan Ankolekar" \
      org.opencontainers.image.licenses="MIT"

# Security: Create non-root system user and group
RUN addgroup -S -g 1001 appgroup && \
    adduser -S -u 1001 -G appgroup appuser

WORKDIR /app

# Set production environment
ENV NODE_ENV=production \
    PORT=3000

# Copy runtime artifacts from builder stage
COPY --from=builder --chown=appuser:appgroup /app/package*.json ./
COPY --from=builder --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=builder --chown=appuser:appgroup /app/dist ./dist
COPY --from=builder --chown=appuser:appgroup /app/public ./public

# Drop privileges to non-root user (CIS Docker Benchmark 4.1)
USER appuser

# Expose HTTP port
EXPOSE 3000

# Configure Healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Graceful termination handling
STOPSIGNAL SIGTERM

# Execute server
CMD ["node", "dist/server.js"]