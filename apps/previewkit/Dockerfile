FROM node:24-alpine

# Install buildctl (for Dockerfile-based builds submitted to BuildKit)
ARG BUILDKIT_VERSION=0.29.0
RUN apk add --no-cache curl tar \
    && ARCH=$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/') \
    && curl -sSL "https://github.com/moby/buildkit/releases/download/v${BUILDKIT_VERSION}/buildkit-v${BUILDKIT_VERSION}.linux-${ARCH}.tar.gz" \
    | tar -xz -C /usr/local bin/buildctl

# Install railpack (for auto-detecting buildless projects)
RUN curl -sSfL https://raw.githubusercontent.com/railwayapp/railpack/main/install.sh | sh

WORKDIR /app
COPY . .

ENV NODE_ENV=production
USER node
EXPOSE 3000
CMD ["node", "--enable-source-maps", "dist/index.js"]
