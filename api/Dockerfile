FROM rust:1-bookworm AS build
WORKDIR /app
COPY api/Cargo.toml api/Cargo.lock ./
COPY api/src ./src
RUN cargo build --release --locked

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV DATA_DIR=/data PORT=3000 RUST_LOG=instarss_api=info
COPY --from=build /app/target/release/instarss-api /usr/local/bin/instarss-api
EXPOSE 3000
CMD ["instarss-api"]
