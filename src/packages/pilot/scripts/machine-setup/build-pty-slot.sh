#!/usr/bin/env bash
# Builds node-pty's prebuild slot (out/orcad-prebuilds/linux-<arch>-glibc/pty.node) so it loads on glibc 2.28.
# Sourced by linux-engine.sh (orcad) and run by build-linux.mjs (the desktop app):
#   build-pty-slot.sh [--repo <dir>] [--dry-run]
# shellcheck disable=SC2034 # SETUP_* globals belong to step-runner.sh.

# CI's glibc 2.28 builders (.github/workflows/node-server-tests.yml), pinned by digest.
PTY_SLOT_IMAGE_X64=quay.io/pypa/manylinux_2_28_x86_64@sha256:407f771c51a2c3e83ebe5a7970b4289ead3a6db21d9b9c089168775cad11d328
PTY_SLOT_IMAGE_ARM64=quay.io/pypa/manylinux_2_28_aarch64@sha256:c22ffd129ac99a8a42d1f2c2f4e88a9089288dd9ee987a7092da1c7dc48f27a9

# build:orcad compiles node-pty on this host when out/orcad-prebuilds has no verified slot, and refuses a
# pty.node that won't load on glibc 2.28. A rolling distro's compiler (Arch's) links newer symbols, so build the
# slot as CI does: in a manylinux_2_28 container, with gcc-toolset, under the pinned Node the build downloads
# anyway (it runs on glibc 2.28). Without Docker, the build tries the host, which works on Debian or Ubuntu.
# N-API: the same pty.node serves orcad's Node and the desktop's Electron (build-linux.mjs ships it).
pty_slot_build() {
  local repo=$1 slot node image store
  if [ "$SETUP_DRY_RUN" = 1 ]; then
    say "  (builds node-pty's slot in a manylinux_2_28 container when out/orcad-prebuilds has none and Docker answers)"
    return 0
  fi
  slot=$(cd "$repo" && node config/scripts/build-orcad-prebuilds.mjs --print-slot) || die "couldn't read this machine's orcad prebuild slot"
  if (cd "$repo" && node config/scripts/build-orcad-prebuilds.mjs --require-slots "$slot" >/dev/null 2>&1); then
    say "  node-pty's $slot slot is already built and verified"
    return 0
  fi
  case "$slot" in
    linux-x64-glibc) image=$PTY_SLOT_IMAGE_X64 ;;
    linux-arm64-glibc) image=$PTY_SLOT_IMAGE_ARM64 ;;
    *)
      say "  no container builds the $slot slot; build:orcad builds it on this host"
      return 0
      ;;
  esac
  if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
    warn "Docker isn't reachable, so build:orcad builds node-pty on this host. If its glibc 2.28 check fails (likely on Arch), start Docker and join its group (sudo systemctl enable --now docker; sudo usermod -aG docker \$USER), log in again, and re-run."
    return 0
  fi
  node=$(cd "$repo" && node config/scripts/build-orcad-prebuilds.mjs --print-runtime | tail -n 1) || die "couldn't fetch the pinned Node"
  # pnpm's global virtual store holds node-pty's sources outside the checkout; mount it at the same path.
  store=$(cd "$repo" && pnpm store path) || die "couldn't find pnpm's store"
  store=${store%/*}
  run docker run --rm --user "$(id -u):$(id -g "$(id -un)")" \
    -v "$repo:$repo" -v "$store:$store:ro" -v "$(dirname "$(dirname "$node")"):/opt/pinned-node:ro" \
    -e HOME=/tmp -e CC=gcc -e CXX=g++ -e PYTHON=/opt/python/cp312-cp312/bin/python3 \
    -e PATH=/opt/pinned-node/bin:/opt/rh/gcc-toolset-14/root/usr/bin:/usr/local/bin:/usr/bin:/bin \
    -w "$repo" "$image" \
    bash -c "node config/scripts/build-orcad-prebuilds.mjs --slot=$slot && node config/scripts/build-orcad-prebuilds.mjs --require-slots $slot && node config/scripts/build-orcad-prebuilds.mjs --slot=$slot --smoke"
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  set -euo pipefail
  # shellcheck source=step-runner.sh
  . "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/step-runner.sh"
  pty_slot_repo=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)
  while [ $# -gt 0 ]; do
    case "$1" in
      --repo)
        pty_slot_repo=$2
        shift 2
        ;;
      --dry-run)
        SETUP_DRY_RUN=1
        shift
        ;;
      *) die "unknown option: $1 (build-pty-slot.sh [--repo <dir>] [--dry-run])" ;;
    esac
  done
  pty_slot_build "$pty_slot_repo"
fi
