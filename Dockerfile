FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    DATA_DIR=/data \
    PORT=3000
COPY --from=build /app ./
RUN npx playwright install --with-deps chromium && rm -rf /var/lib/apt/lists/* /app/data
EXPOSE 3000
CMD ["sh", "-c", "exec npm run start -- --hostname 0.0.0.0 --port \"${PORT:-3000}\""]
