# CV Tailor: OpenCode + web UI in one container.
#
# Build:  docker build -t cv-tailor .
# Run:    see docker-compose.yml or README.md ("Run in a container")

FROM node:22-bookworm-slim

ARG OPENCODE_VERSION=1.19.5
# Set to true to include the Typst compiler (about 40 MB) for local .typ -> PDF builds
ARG INSTALL_TYPST=false
ARG TYPST_VERSION=0.13.1

# python3: UI server and helper scripts (stdlib only)
# poppler-utils: pdftotext for reading PDF CVs and LinkedIn exports
# git: OpenCode uses it to detect the project
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       python3 poppler-utils git ca-certificates curl xz-utils \
    && rm -rf /var/lib/apt/lists/*

RUN if [ "$INSTALL_TYPST" = "true" ]; then \
      arch="$(uname -m)"; \
      curl -fsSL "https://github.com/typst/typst/releases/download/v${TYPST_VERSION}/typst-${arch}-unknown-linux-musl.tar.xz" \
        | tar -xJ -C /tmp \
      && mv /tmp/typst-*/typst /usr/local/bin/typst && rm -rf /tmp/typst-*; \
    fi

RUN npm install -g "opencode-ai@${OPENCODE_VERSION}" && npm cache clean --force

WORKDIR /app
COPY . .

# Pre-install the package the custom tools in .opencode/tools/ import,
# so the container does not need to download it at startup.
RUN cd .opencode \
    && printf '{\n  "dependencies": {\n    "@opencode-ai/plugin": "%s"\n  }\n}\n' "$OPENCODE_VERSION" > package.json \
    && npm install --omit=dev --no-audit --no-fund \
    && npm cache clean --force

# The container may run as any user id (see docker-compose.yml), so make the
# places OpenCode and the UI write to writable for everyone.
# HOME holds OpenCode's login (auth.json), sessions and cache; mount a volume there.
ENV HOME=/data/home \
    PYTHONUNBUFFERED=1
RUN mkdir -p /data/home inputs outputs \
    && chmod -R a+rwX /data /app/.opencode /app/inputs /app/outputs

EXPOSE 8765

# Bind to 0.0.0.0 inside the container. Publish the port only on 127.0.0.1 on the host.
# Absolute path so it also works under Apptainer, which ignores WORKDIR.
CMD ["python3", "/app/ui/server.py", "--host", "0.0.0.0", "--port", "8765"]
