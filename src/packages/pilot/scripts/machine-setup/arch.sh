#!/usr/bin/env bash
# Sets up an Arch machine (Omarchy included) to run Pilot's engine, orcad, as the systemd user service
# pilot-engine.service: pacman packages, Node 24 (pacman's nodejs when it is 24, else fnm), Pilot's
# checkout, ~/.agents and pilotcli, then linux-engine.sh's engine steps. Safe to re-run; it is also how
# the machine is updated. Guide: src/packages/pilot/docs/machine-setup.md.
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=step-runner.sh
. "$SCRIPT_DIR/step-runner.sh"
# shellcheck source=checkouts-and-toolchain.sh
. "$SCRIPT_DIR/checkouts-and-toolchain.sh"
# shellcheck source=linux-engine.sh
. "$SCRIPT_DIR/linux-engine.sh"

ARCH_SKIP_PACKAGES=0
ARCH_DESKTOP=0
# node-gyp compiles node-pty (python, make, gcc); the build gate reads it with objdump (binutils, in
# base-devel); fnm's download is a zip; ps and ip serve Pilot and the engine launcher.
ARCH_PACKAGES=(git curl base-devel python unzip procps-ng iproute2)

usage() {
  cat <<'EOF'
Usage: arch.sh --machine-name <name> [options]

Sets up this Arch machine to run Pilot's headless engine (orcad) as the systemd user service
pilot-engine.service, then prints the command that pairs it from the main Mac. Re-run it to update
the machine. Example:

  arch.sh --machine-name "Omarchy" --bind tailscale --pilotcli-repo https://github.com/nsitapara/pilotCLI.git

Options:
EOF
  setup_common_help
  cat <<'EOF'
  --skip-packages           Don't check or install pacman packages.
  --desktop                 Also build and install Pilot's desktop app (build-linux.mjs; needs Docker): a
                            launcher entry whose window shows this engine once paired, scheduler off.
EOF
  engine_help
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
      --desktop)
        ARCH_DESKTOP=1
        shift
        continue
        ;;
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
  # Before any package, Node or clone: refuse what can't end in a working, pairable engine.
  engine_check_user_manager
  engine_resolve_network
  if [ "$ARCH_SKIP_PACKAGES" = 0 ]; then
    arch_install_packages
  fi
  linux_ensure_node24 arch
  setup_ensure_pilot_repo
  setup_ensure_agents
  setup_install_pilotcli
  setup_link_skills
  engine_main
  if [ "$ARCH_DESKTOP" = 1 ]; then
    step "Pilot's desktop app (build-linux.mjs)"
    run_in "$SETUP_REPO_DIR" node src/packages/pilot/scripts/build-linux.mjs
    say "Pair it with this engine: run this script again with --pair, then in the app's terminal or a shell:"
    say "  pilot-desktop environment add --name 'this engine' --pairing-code 'orca://pair?code=...'"
  fi
}

main "$@"
