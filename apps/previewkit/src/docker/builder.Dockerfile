# syntax=docker/dockerfile:1.7
#
# Previewkit's uniform BUILD image (Vercel-style split build model).
#
# Every preview app - whatever its framework - builds in THIS one image. The
# framework preset (packages/types previewkit-presets.ts) only supplies build
# SETTINGS (install / build / run commands, output artifact); it never selects a
# build image. The built output is then COPYed into a slim per-runtime serve image
# (the runtime-catalog images), so this fat builder never ships to production - it
# lives only on the buildkit warm pool, pulled once per node.
#
# Base OS is Amazon Linux 2023 (dnf) - the same base Vercel's build image uses, so
# native modules compile against the AWS-Lambda-family glibc. It bakes a CURATED
# set of language runtimes (no on-demand version fetch at app build time): multiple
# Node majors + bun, Python via uv, Go, Ruby, Elixir/Erlang. Version selection at
# app-build time is a `select-<lang> <version>` PATH shim emitted into the generated
# build stage - not a different base image.
#
# It also installs a broad OS dependency baseline via dnf (headless-browser
# libraries + a native build toolchain + headers), so app builds that compile
# native modules or run a browser have the libraries present. The slim serve images
# keep their own OS toolbelt (packages/types PREVIEWKIT_TOOLBELT: apt for the Debian
# language images, dnf for the Amazon Linux 2023 bare base) - a separate concern.
#
# Build + push. amd64/x86_64 only: app builds pin linux/amd64 (buildctl --opt
# platform=linux/amd64) and the preview Karpenter nodepool + app pods are amd64,
# so the toolchain downloads below hardcode x86_64 (no arch detection):
#
#   docker buildx build --platform linux/amd64 \
#     -t public.ecr.aws/autonoma/builder:al2023-1 \
#     -f apps/previewkit/src/docker/builder.Dockerfile --push .
#
# The ref is pinned in the runner env (PREVIEWKIT_BUILDER_IMAGE, apps/previewkit
# src/env.ts). Bump the tag when the baked toolchain or OS baseline changes.

FROM amazonlinux:2023

# Curated, pinned toolchain versions - the only knobs this image exposes. Validate
# each against its upstream release when bumping (a bad pin fails the buildx build).
ARG NODE_20_VERSION=20.19.0
ARG NODE_22_VERSION=22.14.0
ARG NODE_24_VERSION=24.4.0
ARG DEFAULT_NODE_MAJOR=22
ARG BUN_VERSION=1.2.20
ARG UV_VERSION=0.5.29
ARG PYTHON_VERSIONS="3.12 3.13"
ARG DEFAULT_PYTHON_VERSION=3.12
ARG GO_VERSION=1.23.6
ARG RUBY_INSTALL_VERSION=0.9.3
ARG RUBY_VERSION=3.3.7
ARG ASDF_VERSION=0.14.1
ARG ERLANG_VERSION=26.2.5
ARG ELIXIR_VERSION=1.16.3
# Elixir tags are cut per OTP major; keep this aligned with ERLANG_VERSION's major.
ARG ELIXIR_OTP_MAJOR=26

# `current` symlinks are repointed by the select-<lang> shims; keeping them on PATH
# means a version switch never has to rewrite PATH.
ENV PATH=/opt/node/current/bin:/opt/ruby/current/bin:/usr/local/go/bin:/opt/asdf/shims:/opt/asdf/bin:/usr/local/bin:$PATH
ENV UV_PYTHON_INSTALL_DIR=/opt/uv/python
ENV ASDF_DIR=/opt/asdf
ENV ASDF_DATA_DIR=/opt/asdf
# Let the Go toolchain honor a go.mod `go 1.x` directive by fetching that toolchain
# on demand, so one baked Go covers every project's pinned version.
ENV GOTOOLCHAIN=auto
# Stable, arch-independent handle for the baseline's Corretto 11 (symlink created
# after the OS-deps layer installs java).
ENV JAVA_HOME=/usr/lib/jvm/current

# --- Requested OS dependency baseline (dnf) ---------------------------------------
# Headless-browser (Chromium) libraries + a native build toolchain + dev headers.
# Names are AL2023-correct: procps-ng (not procps) and libjpeg-turbo(-devel) (not
# libjpeg) are the AL2023 package names. ImageMagick-devel may need a repo enabled on
# some AL2023 minor versions; the image is unverified until a real buildx run.
# ruby-devel installs AL2023's SYSTEM ruby + headers; the baked Ruby in /opt/ruby
# still wins on PATH (asserted in the sanity step below).
RUN set -eux; \
    dnf -y install \
        alsa-lib at-spi2-atk atk \
        autoconf automake brotli \
        bsdtar bzip2 bzip2-devel \
        cups-libs expat-devel gcc \
        gcc-c++ git glib2-devel \
        glibc-devel gtk3 gzip \
        ImageMagick-devel iproute java-11-amazon-corretto-headless \
        libXScrnSaver libXcomposite libXcursor \
        libXi libXrandr libXtst \
        libffi-devel libglvnd-glx libicu \
        libjpeg-turbo libjpeg-turbo-devel libpng \
        libpng-devel libstdc++ libtool \
        libwebp-tools libzstd-devel make \
        nasm ncurses-libs ncurses-compat-libs \
        openssl openssl-devel openssl-libs \
        pango procps-ng perl \
        readline-devel ruby-devel strace \
        sysstat tar unzip \
        which zlib-devel zstd; \
    dnf clean all

# --- Additions beyond the requested list ------------------------------------------
# Image-build essentials: xz (unpack the Node .tar.xz below), ca-certificates (TLS
# for the toolchain downloads), sed/grep (this Dockerfile's scripts + the
# select-<lang> shims), pkgconf (node-gyp / native builds expect pkg-config).
# dejavu-sans-fonts: the lightest single font so headless Chromium renders text
# instead of tofu boxes. Then pin a stable, arch-independent JAVA_HOME target
# (/usr/lib/jvm/current) at the Corretto 11 the baseline installed.
RUN set -eux; \
    dnf -y install ca-certificates xz sed grep pkgconf-pkg-config dejavu-sans-fonts; \
    dnf clean all; \
    ln -sfn "$(dirname "$(dirname "$(readlink -f "$(command -v java)")")")" /usr/lib/jvm/current

# --- Node majors + corepack (pnpm/yarn) -------------------------------------------
RUN set -eux; \
    mkdir -p /opt/node /opt/node-tmp; \
    for spec in "20:${NODE_20_VERSION}" "22:${NODE_22_VERSION}" "24:${NODE_24_VERSION}"; do \
        major="${spec%%:*}"; ver="${spec##*:}"; \
        curl -fsSL "https://nodejs.org/dist/v${ver}/node-v${ver}-linux-x64.tar.xz" \
            | tar -xJ -C /opt/node-tmp; \
        mv "/opt/node-tmp/node-v${ver}-linux-x64" "/opt/node/${major}"; \
        PATH="/opt/node/${major}/bin:$PATH" corepack enable; \
    done; \
    ln -sfn "/opt/node/${DEFAULT_NODE_MAJOR}" /opt/node/current; \
    rm -rf /opt/node-tmp

# --- bun (glibc build) ------------------------------------------------------------
RUN set -eux; \
    curl -fsSL -o /tmp/bun.zip "https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/bun-linux-x64.zip"; \
    unzip -q /tmp/bun.zip -d /tmp/bun; \
    mv "/tmp/bun/bun-linux-x64/bun" /usr/local/bin/bun; \
    chmod 0755 /usr/local/bin/bun; \
    rm -rf /tmp/bun /tmp/bun.zip

# --- uv + curated Python versions -------------------------------------------------
# uv installs pre-built (python-build-standalone) interpreters into
# UV_PYTHON_INSTALL_DIR; select-python repoints /usr/local/bin/python3 at one.
RUN set -eux; \
    curl -fsSL "https://astral.sh/uv/${UV_VERSION}/install.sh" | env UV_INSTALL_DIR=/usr/local/bin sh; \
    uv python install ${PYTHON_VERSIONS}; \
    ln -sf "$(uv python find ${DEFAULT_PYTHON_VERSION})" /usr/local/bin/python3; \
    ln -sf /usr/local/bin/python3 /usr/local/bin/python

# --- Go ---------------------------------------------------------------------------
RUN set -eux; \
    curl -fsSL "https://go.dev/dl/go${GO_VERSION}.linux-amd64.tar.gz" | tar -xz -C /usr/local

# --- Ruby -------------------------------------------------------------------------
# The compile deps (gcc, make, openssl-devel, readline-devel, zlib-devel,
# libffi-devel) come from the baseline; libyaml-devel is added here because Ruby
# needs it for psych/YAML (and bundler fails without it). --no-install-deps keeps
# ruby-install from re-resolving deps through its own distro detection.
RUN set -eux; \
    dnf -y install libyaml-devel; \
    dnf clean all; \
    curl -fsSL "https://github.com/postmodern/ruby-install/releases/download/v${RUBY_INSTALL_VERSION}/ruby-install-${RUBY_INSTALL_VERSION}.tar.gz" \
        | tar -xz -C /tmp; \
    make -C "/tmp/ruby-install-${RUBY_INSTALL_VERSION}" install; \
    ruby-install --no-install-deps --install-dir "/opt/ruby/${RUBY_VERSION}" ruby "${RUBY_VERSION}" -- --disable-install-doc; \
    ln -sfn "/opt/ruby/${RUBY_VERSION}" /opt/ruby/current; \
    rm -rf "/tmp/ruby-install-${RUBY_INSTALL_VERSION}"

# --- Elixir + Erlang/OTP (via asdf; single curated version) -----------------------
# asdf builds Erlang/OTP from source, so this is the slowest layer - acceptable in a
# CI-built base image. autoconf/automake/gcc/make/openssl-devel come from the
# baseline; ncurses-devel + m4 are the remaining kerl build requirements. The elixir
# tag is per-OTP-major, so it tracks ERLANG_VERSION's major.
RUN set -eux; \
    dnf -y install ncurses-devel m4; \
    dnf clean all; \
    git clone --depth 1 --branch "v${ASDF_VERSION}" https://github.com/asdf-vm/asdf.git /opt/asdf; \
    asdf plugin add erlang; \
    asdf plugin add elixir; \
    KERL_BUILD_DOCS=no asdf install erlang "${ERLANG_VERSION}"; \
    asdf global erlang "${ERLANG_VERSION}"; \
    asdf install elixir "${ELIXIR_VERSION}-otp-${ELIXIR_OTP_MAJOR}"; \
    asdf global elixir "${ELIXIR_VERSION}-otp-${ELIXIR_OTP_MAJOR}"; \
    mix local.hex --force; \
    mix local.rebar --force

# --- select-<lang> version shims --------------------------------------------------
# The generated build stage calls these to pick a pre-baked version, e.g.
# `RUN select-node 20`. They repoint a `current` symlink (node/ruby) or the
# python3 link, never install - an unknown version fails loudly.
RUN set -eux; \
    printf '%s\n' \
        '#!/bin/sh' \
        'set -eu' \
        'target="/opt/node/$1"' \
        '[ -d "$target" ] || { echo "node $1 is not baked into the builder (have: $(ls /opt/node | grep -v current))" >&2; exit 1; }' \
        'ln -sfn "$target" /opt/node/current' \
        > /usr/local/bin/select-node; \
    printf '%s\n' \
        '#!/bin/sh' \
        'set -eu' \
        'p="$(uv python find "$1" 2>/dev/null)" || { echo "python $1 is not baked into the builder" >&2; exit 1; }' \
        'ln -sf "$p" /usr/local/bin/python3' \
        > /usr/local/bin/select-python; \
    printf '%s\n' \
        '#!/bin/sh' \
        'set -eu' \
        'target="/opt/ruby/$1"' \
        '[ -d "$target" ] || { echo "ruby $1 is not baked into the builder (have: $(ls /opt/ruby | grep -v current))" >&2; exit 1; }' \
        'ln -sfn "$target" /opt/ruby/current' \
        > /usr/local/bin/select-ruby; \
    chmod 0755 /usr/local/bin/select-node /usr/local/bin/select-python /usr/local/bin/select-ruby

# Sanity: fail the image build if a core toolchain is missing or misconfigured.
RUN set -eux; \
    node --version; npm --version; corepack --version; bun --version; \
    python3 --version; uv --version; go version; ruby --version; \
    elixir --version; mix --version; gcc --version; java -version; \
    [ "$(command -v ruby)" = "/opt/ruby/current/bin/ruby" ] || { echo "baked ruby is not first on PATH (got: $(command -v ruby)) - the system ruby-devel is shadowing it" >&2; exit 1; }; \
    [ -x "$JAVA_HOME/bin/java" ] || { echo "JAVA_HOME does not point at a JDK: $JAVA_HOME" >&2; exit 1; }

WORKDIR /workspace
