# Custom Dockerfile for Manus deploy
# Fixes ERR_PNPM_LOCKFILE_CONFIG_MISMATCH by using --no-frozen-lockfile
FROM us-east1-docker.pkg.dev/manus-webdev-prod/manus-prod/node-base:v0.0.6

WORKDIR /usr/src/app

# Copy package files first for better caching
COPY package.json pnpm-lock.yaml* ./

# Copy patches directory (needed for wouter patch)
COPY patches/ ./patches/

# Install dependencies with --no-frozen-lockfile to avoid config mismatch
# (pnpm 10 no longer reads the "pnpm" field from package.json but lockfile was generated with it)
RUN corepack pnpm install --no-frozen-lockfile --prod=false

# Copy all source files
COPY . .

# Build the application
RUN corepack pnpm build

# Expose port (uses PORT env var at runtime)
EXPOSE 3000

# Start the application
CMD ["node", "dist/index.js"]
