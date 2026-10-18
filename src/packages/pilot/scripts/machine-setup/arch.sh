#!/usr/bin/env bash
# Sets up an Arch machine (Omarchy included) to run Pilot's engine, orcad, as the systemd user service
# pilot-engine.service: pacman packages, Node 24 (pacman's nodejs when it is 24, else fnm), Pilot's
# checkout, ~/.agents and pilotcli, then linux-engine.sh's engine steps. Safe to re-run; it is also how
# the machine is updated. Guide: src/packages/pilot/docs/machine-setup.md.
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=setup-steps.sh
. "$SCRIPT_DIR/setup-steps.sh"
# shellcheck source=linux-engine.sh
. "$SCRIPT_DIR/linux-engine.sh"

ARCH_SKIP_PACKAGES=0
# node-gyp compiles node-pty (python, make, gcc); the build gate reads it with objdump (binutils, in
# base-devel); fnm's download is a zip; ps and ip serve Pilot and the engine launcher.
ARCH_PACKAGES=(git curl base-devel python unzip procps-ng iproute2)

usage() {
  cat <<'EOF'
Usage: arch.sh --machine-name <name> [options]

Sets up this Arch machine to run Pilot's headless engine (orcad) as the systemd user service
pilot-engine.service, then prints the command that pairs it from the main Mac. Re-run it to update
the machine. Example:

  arch.sh --machine-name "Omarchy" --bind tailscale --pilotcli-binary ~/pilotcli-linux-amd64

Options:
EOF
  setup_common_help
  cat <<'EOF'
  --skip-packages           Don't check or install pacman packages.
  --desktop                 Not supported yet: Pilot has no Linux desktop package (see the guide's
                            "Linux desktop app" section). The engine is the Linux path.
EOF
  engine_help
}

arch_refuse_desktop() {
  cat >&2 <<'EOF'
error: --desktop isn't supported yet. Pilot has no Linux desktop package:
  - Pilot's electron-builder wrapper only renames the Linux executable to pilot, and the CLI launcher
    it still ships (resources/linux/bin/orca-ide) looks for orca-ide, orca or Orca, so `pilot` can't
    find the app;
  - that launcher doesn't pin Pilot's data folder, so the CLI would act on real Orca's ~/.config/orca;
  - the deb/rpm install hooks manage Orca's /opt and /usr/bin paths, and nothing builds or tests it.
See "Linux desktop app (follow-up)" in src/packages/pilot/docs/machine-setup.md. Re-run without
--desktop to set up the headless engine, which the main Mac's Pilot window shows like any machine.
EOF
  exit 2
}

arch_install_packages() {
  local wanted=("${ARCH_PACKAGES[@]}") missing=() package
  step "System packages (pacman)"
  if [ -n "$SETUP_PILOTCLI_REPO" ]; then
    wanted+=(go)
  fi
  for package in "${wanted[@]}"; do
    if ! pacman -Q "$package" >/dev/null 2>&1; then
      missing+=("$package")
    fi
  done
  if [ "${#missing[@]}" = 0 ]; then
    say "  installed: ${wanted[*]}"
    return 0
  fi
  # No -y: refreshing the databases without upgrading is a partial upgrade, which Arch doesn't support.
  if ! run_sudo "Install what building Pilot's engine needs: ${missing[*]}" pacman -S --needed --noconfirm "${missing[@]}"; then
    die "pacman couldn't install them. If it couldn't download a package, upgrade first (sudo pacman -Syu), then re-run."
  fi
}

main() {
  while [ $# -gt 0 ]; do
    case $1 in
      -h | --help)
        usage
        exit 0
        ;;
      --desktop) arch_refuse_desktop ;;
      --skip-packages)
        ARCH_SKIP_PACKAGES=1
        shift
        continue
        ;;
    esac
    setup_take_common_flag "$@"
    if [ "$SETUP_SHIFT" = 0 ]; then
      engine_take_flag "$@"
    fi
    if [ "$SETUP_SHIFT" = 0 ]; then
      die "unknown option: $1 (see --help)"
    fi
    shift "$SETUP_SHIFT"
  done
  setup_require_os arch
  engine_default_machine_name
  setup_check_common
  setup_banner
  if [ "$ARCH_SKIP_PACKAGES" = 0 ]; then
    arch_install_packages
  fi
  linux_ensure_node24 arch
  setup_ensure_pilot_repo
  setup_ensure_agents
  setup_install_pilotcli
  engine_main
}

main "$@"
