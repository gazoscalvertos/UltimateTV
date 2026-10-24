# UltimateTV PXE server: proxy DHCP and TFTP (dnsmasq) plus a small web server, so the box can
# reinstall itself over the network. Runs beside the router's DHCP, never instead of it.

FROM debian:bookworm-slim AS ipxe
ARG IPXE_REF=v2.0.0
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates git make gcc binutils perl liblzma-dev \
 && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 --branch "$IPXE_REF" https://github.com/ipxe/ipxe.git /ipxe
COPY embed.ipxe /embed.ipxe
# iPXE's default build includes HTTPS, so the Arch kernel comes straight from the Arch mirrors.
RUN make -C /ipxe/src -j"$(nproc)" bin-x86_64-efi/ipxe.efi EMBED=/embed.ipxe NO_WERROR=1

FROM debian:bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends dnsmasq busybox iproute2 \
 && rm -rf /var/lib/apt/lists/*
COPY --from=ipxe /ipxe/src/bin-x86_64-efi/ipxe.efi /srv/tftp/ipxe.efi
COPY entrypoint.sh /entrypoint.sh
COPY auto.sh /srv/http/auto.sh
ENTRYPOINT ["/entrypoint.sh"]
