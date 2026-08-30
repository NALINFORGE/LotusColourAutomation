FROM ghcr.io/home-assistant/base:latest

ARG BUILD_VERSION
ARG BUILD_ARCH

LABEL \
  io.hass.version="${BUILD_VERSION}" \
  io.hass.type="app" \
  io.hass.arch="${BUILD_ARCH}"

RUN apk add --no-cache \
    python3 \
    py3-aiohttp

WORKDIR /app
COPY app /app
COPY companion /companion
COPY run.sh /run.sh
RUN chmod a+x /run.sh

COPY VERSION /VERSION

CMD [ "/run.sh" ]
