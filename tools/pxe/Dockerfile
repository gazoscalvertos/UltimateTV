# UltimateTV PXE server: proxy DHCP and TFTP (dnsmasq) plus a small web server, so the box can
# reinstall itself over the network. Runs beside the router's DHCP, never instead of it.

FROM debian:bookworm-slim AS ipxe
ARG IPXE_REF=v2.0.0
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates git make gcc libc6-dev binutils perl liblzma-dev \
 && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 --branch "$IPXE_REF" https://github.com/ipxe/ipxe.git /ipxe
COPY embed.ipxe /embed.ipxe
# snponly.efi drives the network card through the firmware's own driver (which just netbooted
# it), rather than iPXE's, which can't receive on some 2.5G cards.
RUN make -C /ipxe/src -j"$(nproc)" bin-x86_64-efi/snponly.efi EMBED=/embed.ipxe NO_WERROR=1

FROM debian:bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends dnsmasq busybox iproute2 curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY --from=ipxe /ipxe/src/bin-x86_64-efi/snponly.efi /srv/tftp/ipxe.efi
COPY entrypoint.sh /entrypoint.sh
COPY auto.sh /srv/http/auto.sh
ENTRYPOINT ["/entrypoint.sh"]
