# syntax=docker/dockerfile:1
#
# Previewkit's default Postgres image (DEFAULT_POSTGRES_IMAGE in the recipe).
#
# Baked so every preview environment gets a broad set of popular extensions with
# zero config, on top of the contrib modules already in the base image. The set
# mirrors the extensions Neon ships in its compute image
# (compute/compute-node.Dockerfile), MINUS the heavyweight builds (plv8/V8,
# rdkit, pg_duckdb, pg_mooncake, pgrag) and Neon's serverless runtime - we keep
# the stock `postgres` entrypoint (initdb, /docker-entrypoint-initdb.d,
# POSTGRES_*), which the recipe (src/recipes/postgres-recipe.ts) relies on.
#
# How extensions get here, in order of preference:
#   1. PGDG apt packages - prebuilt and multi-arch, already configured in the
#      official image. Used for everything that has a package (the majority).
#   2. Source builds, compiled in the `ext-build` stage against THIS exact
#      Postgres - the few extensions PGDG does not package (a couple of small C
#      extensions plus the Rust/pgrx ones). Versions, source URLs, checksums and
#      the pgrx version bumps mirror Neon's recipes.
#
# This image is the source of truth for which extensions previews can use: the
# recipe has no code-side allowlist, so to make a new extension available, add it
# here. Conversely, `options.extensions` will fail at init for anything not
# installed below. timescaledb, pg_cron and pgaudit additionally require
# shared_preload_libraries - the recipe sets that automatically when they are
# requested (see PRELOAD_REQUIRED_EXTENSIONS in postgres-recipe.ts).
#
# Build + push (must be multi-arch: preview nodes may be arm64 (Graviton) or
# amd64, and a single-arch image will leave pods Unschedulable on the other).
# The Rust/pgrx layer dominates build time, especially for the non-native arch
# under QEMU emulation - expect tens of minutes:
#
#   docker buildx build --platform linux/amd64,linux/arm64 \
#     -t public.ecr.aws/autonoma/postgres:16 \
#     -f apps/previewkit/postgres.Dockerfile --push .
#
# Bump PG_MAJOR (and the tag) to track a new Postgres major. The pgrx toolchain
# version (PGRX_VERSION) must match the pgrx crate version pinned in each Rust
# extension below; bump them together.
ARG PG_MAJOR=16

#########################################################################################
# Stage: ext-build
# Compile the extensions PGDG does not package, against the exact Postgres they
# will run on. Their build artifacts are COPYed into the final image.
#########################################################################################
FROM postgres:${PG_MAJOR} AS ext-build
ARG PG_MAJOR
ARG PGRX_VERSION=0.12.9

ENV DEBIAN_FRONTEND=noninteractive
ENV CARGO_HOME=/usr/local/cargo
ENV RUSTUP_HOME=/usr/local/rustup
ENV PATH=/usr/local/cargo/bin:/usr/lib/postgresql/${PG_MAJOR}/bin:$PATH

# Toolchain + headers. libclang is required by pgrx (bindgen).
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
        "postgresql-server-dev-${PG_MAJOR}" \
        build-essential pkg-config \
        ca-certificates curl wget git \
        libssl-dev libclang-dev clang; \
    rm -rf /var/lib/apt/lists/*

# Rust toolchain.
RUN set -eux; \
    curl -fsSL https://sh.rustup.rs | sh -s -- -y --no-modify-path --profile minimal --default-toolchain stable

# cargo-pgrx must match the pgrx crate version pinned in every extension below.
# Pointing pgrx at the existing pg_config makes it build against the stock server
# rather than downloading/compiling its own.
RUN set -eux; \
    cargo install --locked --version "${PGRX_VERSION}" cargo-pgrx; \
    cargo pgrx init "--pg${PG_MAJOR}" "/usr/lib/postgresql/${PG_MAJOR}/bin/pg_config"

WORKDIR /ext-src

# --- Plain C / SQL extensions (PGXS, not in PGDG) -----------------------------------

# pgjwt - sign/verify JWTs in SQL (SQL only; depends on pgcrypto).
RUN set -eux; \
    wget -O pgjwt.tar.gz https://github.com/michelp/pgjwt/archive/f3d82fd30151e754e19ce5d6a06c71c20689ce3d.tar.gz; \
    echo "dae8ed99eebb7593b43013f6532d772b12dfecd55548d2673f2dfd0163f6d2b9 pgjwt.tar.gz" | sha256sum -c -; \
    mkdir pgjwt && tar xzf pgjwt.tar.gz --strip-components=1 -C pgjwt; \
    make -C pgjwt install

# pg_hashids - short, unique, YouTube-style hash IDs from integers.
RUN set -eux; \
    wget -O pg_hashids.tar.gz https://github.com/iCyberon/pg_hashids/archive/refs/tags/v1.2.1.tar.gz; \
    echo "74576b992d9277c92196dd8d816baa2cc2d8046fe102f3dcd7f3c3febed6822a pg_hashids.tar.gz" | sha256sum -c -; \
    mkdir pg_hashids && tar xzf pg_hashids.tar.gz --strip-components=1 -C pg_hashids; \
    make -C pg_hashids USE_PGXS=1; \
    make -C pg_hashids USE_PGXS=1 install

# --- Rust / pgrx extensions ----------------------------------------------------------
# We keep Neon's `unsafe-postgres` feature: it is a no-op on the stock image (it
# only relaxes pgrx's build-time check that the target Postgres was built the way
# pgrx expects, which the official image already satisfies). cargo-pgrx infers the
# pg16 feature from --pg-config and installs into pg_config's pkglibdir/sharedir.

# pg_jsonschema - JSON Schema validation (Supabase).
RUN set -eux; \
    wget -O pg_jsonschema.tar.gz https://github.com/supabase/pg_jsonschema/archive/refs/tags/v0.3.3.tar.gz; \
    echo "40c2cffab4187e0233cb8c3bde013be92218c282f95f4469c5282f6b30d64eac pg_jsonschema.tar.gz" | sha256sum -c -; \
    mkdir pg_jsonschema && tar xzf pg_jsonschema.tar.gz --strip-components=1 -C pg_jsonschema; \
    cd pg_jsonschema; \
    sed -i 's/pgrx = "0.12.6"/pgrx = { version = "0.12.9", features = [ "unsafe-postgres" ] }/g' Cargo.toml; \
    sed -i 's/pgrx-tests = "0.12.6"/pgrx-tests = "0.12.9"/g' Cargo.toml; \
    cargo pgrx install --release --pg-config "/usr/lib/postgresql/${PG_MAJOR}/bin/pg_config"

# pg_graphql - reflect a GraphQL API from your schema (Supabase). Neon's only
# patch here edits a test fixture, so it is intentionally omitted.
RUN set -eux; \
    wget -O pg_graphql.tar.gz https://github.com/supabase/pg_graphql/archive/refs/tags/v1.5.9.tar.gz; \
    echo "cf768385a41278be1333472204fc0328118644ae443182cf52f7b9b23277e497 pg_graphql.tar.gz" | sha256sum -c -; \
    mkdir pg_graphql && tar xzf pg_graphql.tar.gz --strip-components=1 -C pg_graphql; \
    cd pg_graphql; \
    sed -i 's/pgrx = "=0.12.6"/pgrx = { version = "0.12.9", features = [ "unsafe-postgres" ] }/g' Cargo.toml; \
    sed -i 's/pgrx-tests = "=0.12.6"/pgrx-tests = "=0.12.9"/g' Cargo.toml; \
    cargo pgrx install --release --pg-config "/usr/lib/postgresql/${PG_MAJOR}/bin/pg_config"

# pg_tiktoken - OpenAI BPE token counting (pinned to the commit Neon uses).
RUN set -eux; \
    wget -O pg_tiktoken.tar.gz https://github.com/kelvich/pg_tiktoken/archive/9118dd4549b7d8c0bbc98e04322499f7bf2fa6f7.tar.gz; \
    echo "a5bc447e7920ee149d3c064b8b9f0086c0e83939499753178f7d35788416f628 pg_tiktoken.tar.gz" | sha256sum -c -; \
    mkdir pg_tiktoken && tar xzf pg_tiktoken.tar.gz --strip-components=1 -C pg_tiktoken; \
    cd pg_tiktoken; \
    sed -i 's/pgrx = { version = "=0.12.6",/pgrx = { version = "0.12.9",/g' Cargo.toml; \
    sed -i 's/pgrx-tests = "=0.12.6"/pgrx-tests = "0.12.9"/g' Cargo.toml; \
    cargo pgrx install --release --pg-config "/usr/lib/postgresql/${PG_MAJOR}/bin/pg_config"

# pgx_ulid - ULID data type. v0.2.0 tracks pgrx 0.12.x, so it shares the toolchain
# above (extension name `pgx_ulid`).
RUN set -eux; \
    wget -O pgx_ulid.tar.gz https://github.com/pksunkara/pgx_ulid/archive/refs/tags/v0.2.0.tar.gz; \
    echo "cef6a9a2e5e7bd1a10a18989286586ee9e6c1c06005a4055cff190de41bf3e9f pgx_ulid.tar.gz" | sha256sum -c -; \
    mkdir pgx_ulid && tar xzf pgx_ulid.tar.gz --strip-components=1 -C pgx_ulid; \
    cd pgx_ulid; \
    sed -i 's/pgrx       = "^0.12.7"/pgrx       = { version = "0.12.9", features = [ "unsafe-postgres" ] }/g' Cargo.toml; \
    cargo pgrx install --release --pg-config "/usr/lib/postgresql/${PG_MAJOR}/bin/pg_config"

#########################################################################################
# Final image
#########################################################################################
FROM postgres:${PG_MAJOR}
ARG PG_MAJOR

LABEL org.opencontainers.image.description="Previewkit Postgres ${PG_MAJOR} with a broad bundled extension set"

# Prebuilt, multi-arch extensions from the PGDG apt repo (already configured in
# the official image). Runtime dependencies (GEOS/PROJ/GDAL for PostGIS, etc.)
# come in automatically as package deps. timescaledb and pg_cron also need
# shared_preload_libraries, which the recipe sets when they are requested.
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
        "postgresql-${PG_MAJOR}-postgis-3" \
        "postgresql-${PG_MAJOR}-pgrouting" \
        "postgresql-${PG_MAJOR}-h3" \
        "postgresql-${PG_MAJOR}-pgvector" \
        "postgresql-${PG_MAJOR}-hll" \
        "postgresql-${PG_MAJOR}-hypopg" \
        "postgresql-${PG_MAJOR}-ip4r" \
        "postgresql-${PG_MAJOR}-pg-hint-plan" \
        "postgresql-${PG_MAJOR}-pg-ivm" \
        "postgresql-${PG_MAJOR}-pg-uuidv7" \
        "postgresql-${PG_MAJOR}-pgaudit" \
        "postgresql-${PG_MAJOR}-pgauditlogtofile" \
        "postgresql-${PG_MAJOR}-partman" \
        "postgresql-${PG_MAJOR}-plpgsql-check" \
        "postgresql-${PG_MAJOR}-prefix" \
        "postgresql-${PG_MAJOR}-repack" \
        "postgresql-${PG_MAJOR}-roaringbitmap" \
        "postgresql-${PG_MAJOR}-rum" \
        "postgresql-${PG_MAJOR}-semver" \
        "postgresql-${PG_MAJOR}-pgtap" \
        "postgresql-${PG_MAJOR}-unit" \
        "postgresql-${PG_MAJOR}-wal2json" \
        "postgresql-${PG_MAJOR}-cron" \
        "postgresql-${PG_MAJOR}-timescaledb"; \
    rm -rf /var/lib/apt/lists/*

# Source-built extensions, compiled against this exact Postgres in ext-build. A
# missing file fails the build loudly (i.e. an extension that did not compile).
COPY --from=ext-build \
    "/usr/lib/postgresql/${PG_MAJOR}/lib/pg_jsonschema.so" \
    "/usr/lib/postgresql/${PG_MAJOR}/lib/pg_graphql.so" \
    "/usr/lib/postgresql/${PG_MAJOR}/lib/pg_tiktoken.so" \
    "/usr/lib/postgresql/${PG_MAJOR}/lib/pgx_ulid.so" \
    "/usr/lib/postgresql/${PG_MAJOR}/lib/pg_hashids.so" \
    "/usr/lib/postgresql/${PG_MAJOR}/lib/"

COPY --from=ext-build \
    "/usr/share/postgresql/${PG_MAJOR}/extension/pg_jsonschema"* \
    "/usr/share/postgresql/${PG_MAJOR}/extension/pg_graphql"* \
    "/usr/share/postgresql/${PG_MAJOR}/extension/pg_tiktoken"* \
    "/usr/share/postgresql/${PG_MAJOR}/extension/pgx_ulid"* \
    "/usr/share/postgresql/${PG_MAJOR}/extension/pg_hashids"* \
    "/usr/share/postgresql/${PG_MAJOR}/extension/pgjwt"* \
    "/usr/share/postgresql/${PG_MAJOR}/extension/"
