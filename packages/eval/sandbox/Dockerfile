# syntax=docker/dockerfile:1.7

# Pin the Python runtime image by its multi-arch index digest.
FROM python:3.14-slim-bookworm@sha256:945c2676dc2b18e0c1f16879244122c57c0ffede60006bf3df159c507a31bcae

ARG TARGETARCH

ENV DEBIAN_FRONTEND=noninteractive
ENV GOTOOLCHAIN=local
ENV PYTHONDONTWRITEBYTECODE=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        bash \
        ca-certificates \
        curl \
        git \
        patch \
        procps \
        ripgrep \
        socat \
        xz-utils \
    && rm -rf /var/lib/apt/lists/*

RUN set -eux; \
    case "${TARGETARCH}" in \
      amd64) \
        NODE_ARCH="x64"; \
        NODE_SHA256="9a6bc82f9b491279147219f6a18add1e18424dce90d41d2a5fcd69d4924ba3aa"; \
        GO_ARCH="amd64"; \
        GO_SHA256="d0f743b33e8d8945e6b1f432edd15785c70507121d6e2a723b21285eddf8b57b" \
        ;; \
      arm64) \
        NODE_ARCH="arm64"; \
        NODE_SHA256="0f3550d58d45e5d3cf7103d9e3f69937f09fe82fb5dd474c66a5d816fa58c9ee"; \
        GO_ARCH="arm64"; \
        GO_SHA256="211ffced9dcb9633a55eac6364816ec0ddd951389a740e88fa8b3337971bdda0" \
        ;; \
      *) \
        echo "unsupported architecture: ${TARGETARCH}" >&2; \
        exit 1 \
        ;; \
    esac; \
    curl -fsSLO "https://nodejs.org/dist/v22.22.1/node-v22.22.1-linux-${NODE_ARCH}.tar.xz"; \
    echo "${NODE_SHA256}  node-v22.22.1-linux-${NODE_ARCH}.tar.xz" | sha256sum -c -; \
    tar -xJf "node-v22.22.1-linux-${NODE_ARCH}.tar.xz" -C /usr/local --strip-components=1; \
    rm "node-v22.22.1-linux-${NODE_ARCH}.tar.xz"; \
    curl -fsSLO "https://dl.google.com/go/go1.26.8.linux-${GO_ARCH}.tar.gz"; \
    echo "${GO_SHA256}  go1.26.8.linux-${GO_ARCH}.tar.gz" | sha256sum -c -; \
    tar -xzf "go1.26.8.linux-${GO_ARCH}.tar.gz" -C /usr/local; \
    rm "go1.26.8.linux-${GO_ARCH}.tar.gz"

RUN npm_config_update_notifier=false npm install --global \
        opencode-ai@1.18.30 \
        tsx@4.23.15 \
    && npm cache clean --force

RUN useradd --create-home --uid 1000 --shell /bin/bash eval \
    && mkdir -p /home/eval/.config /home/eval/.local/share /home/eval/.local/state \
    && chown -R eval:eval /home/eval \
    && printf '%s\n' \
        'export PATH="/usr/local/go/bin:/usr/local/bin:/home/eval/.local/bin:$PATH"' \
        > /etc/profile.d/eval-path.sh \
    && chmod 0644 /etc/profile.d/eval-path.sh

COPY entrypoint.sh /usr/local/bin/eval-entrypoint
RUN chmod 0755 /usr/local/bin/eval-entrypoint

ENV HOME=/home/eval
ENV PATH="/usr/local/go/bin:/usr/local/bin:/home/eval/.local/bin:${PATH}"
ENV GOPATH=/home/eval/go
ENV GOCACHE=/home/eval/.cache/go-build
ENV GOMODCACHE=/home/eval/go/pkg/mod

WORKDIR /workspace
USER eval

ENTRYPOINT ["/usr/local/bin/eval-entrypoint"]
