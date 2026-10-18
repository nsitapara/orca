#!/usr/bin/env bash
# Sets up a second Mac (the Mac mini) to run Pilot's packaged desktop app: checks Xcode's tools and
# Node 24, updates Pilot's checkout, ~/.agents and pilotcli, keeps Pilot's settings in launchd with a
# LaunchAgent (PILOT_SCHEDULER=pinned by default), builds and installs /Applications/Pilot.app with
# build-mac.mjs, names the machine and prints how to pair it. Safe to re-run; it is also how the Mac is
# updated. Guide: src/packages/pilot/docs/machine-setup.md.
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=step-runner.sh
. "$SCRIPT_DIR/step-runner.sh"
# shellcheck source=checkouts-and-toolchain.sh
. "$SCRIPT_DIR/checkouts-and-toolchain.sh"

# Flag values. Empty means: keep what the LaunchAgent (else launchd) has, else the default.
MAC_FLAG_SCHEDULER=
MAC_FLAG_VAULT_EXPORT=
MAC_FLAG_USAGE_REPORT_DIR=
MAC_FLAG_OPEN_AT_LOGIN=
MAC_DEFAULT_USAGE_REPORT_DIR="$HOME/Library/Application Support/Pilot/usage-report"
# The resolved settings; an empty value is unset.
MAC_SCHEDULER=
MAC_VAULT_EXPORT=
MAC_USAGE_REPORT_DIR=
MAC_OPEN_AT_LOGIN=0
MAC_CURRENT=
MAC_SOURCE=
MAC_SKIP_BUILD=0
MAC_ENV_CHANGED=0
MAC_AGENT_LABEL=dev.nsitapara.pilot.environment
MAC_AGENT_PLIST=$HOME/Library/LaunchAgents/$MAC_AGENT_LABEL.plist
MAC_APP=/Applications/Pilot.app
# install-mac.mjs links it to the installed app's bin/pilot.
MAC_CLI=$HOME/.local/bin/pilot

usage() {
  cat <<'EOF'
Usage: macos.sh --machine-name <name> [options]

Sets up this Mac to run Pilot's desktop app beside the main Mac's, then prints how to pair it.
Re-run it to update the Mac. Example:

  macos.sh --machine-name "Mac mini" --open-at-login --pilotcli-binary ~/pilotcli-darwin-arm64

Options:
EOF
  setup_common_help
  cat <<'EOF'
  --scheduler all|pinned|off  PILOT_SCHEDULER (default pinned): pinned ticks only the jobs whose runs_on
                            names this Mac; all also ticks every unpinned job, repeating the main
                            Mac's runs.
  --vault-export on|off     PILOT_VAULT_EXPORT (default off: one machine exports to the vault).
  --usage-report-dir <dir>  PILOT_USAGE_REPORT_DIR (default ~/Library/Application Support/Pilot/
                            usage-report, so this Mac never overwrites the main Mac's token report).
                            "default" leaves Pilot's own default, the vault's 08 folder.
  --open-at-login / --no-open-at-login
                            Whether the LaunchAgent also opens Pilot at login, after it sets the
                            settings (default off). Use it instead of a Login Item, which can start
                            Pilot before them.
  --no-build                Skip pnpm install and build-mac.mjs (settings, name and pairing only).

The settings live in a LaunchAgent (~/Library/LaunchAgents/dev.nsitapara.pilot.environment.plist)
that runs launchctl setenv at every login; the script also sets them for this session. A setting
you leave out keeps what the LaunchAgent has (else launchd's current value), else its default.
EOF
}

mac_ensure_node24() {
  local nvm_sh=${NVM_DIR:-$HOME/.nvm}/nvm.sh brew_node=''
  if [ "$(setup_node_major)" != 24 ] && command -v fnm >/dev/null 2>&1; then
    # Not in a dry run: `fnm env` writes a multishell link.
    if [ "$SETUP_DRY_RUN" = 1 ] && fnm ls 2>/dev/null | grep -q 'v24\.'; then
      say "  (dry run: fnm has Node 24, which the real run puts on PATH)"
      return 0
    fi
    if [ "$SETUP_DRY_RUN" != 1 ]; then
      eval "$(fnm env --shell bash)"
      fnm use 24 >/dev/null 2>&1 || true
    fi
  fi
  if [ "$(setup_node_major)" != 24 ] && [ -s "$nvm_sh" ]; then
    set +eu
    # shellcheck source=/dev/null
    . "$nvm_sh"
    nvm use 24 >/dev/null 2>&1
    set -eu
  fi
  if [ "$(setup_node_major)" != 24 ] && command -v brew >/dev/null 2>&1; then
    brew_node="$(brew --prefix)/opt/node@24/bin"
    if [ -x "$brew_node/node" ]; then
      PATH=$brew_node:$PATH
      export PATH
    fi
  fi
  if [ "$(setup_node_major)" = 24 ]; then
    say "  Node $(node --version) at $(command -v node)"
    return 0
  fi
  die "Node 24 is required (package.json engines). Install it with what you use, then re-run:
  fnm:      fnm install 24
  nvm:      nvm install 24
  Homebrew: brew install node@24"
}

mac_check_prerequisites() {
  step "Prerequisites"
  if ! xcode-select -p >/dev/null 2>&1; then
    die "Xcode's Command Line Tools are missing. Install them (xcode-select --install), then re-run."
  fi
  say "  Xcode tools at $(xcode-select -p)"
  if ! command -v swiftc >/dev/null 2>&1; then
    die "swiftc is missing; build-mac.mjs compiles Pilot's Swift helpers. Install Xcode or its Command Line Tools."
  fi
  command -v git >/dev/null 2>&1 || die "git is missing (it comes with the Command Line Tools)"
  case $(uname -m) in
    arm64) say "  Apple silicon: build-mac.mjs builds dist/mac-arm64/Pilot.app" ;;
    *) say "  Intel: build-mac.mjs builds dist/mac/Pilot.app" ;;
  esac
  mac_ensure_node24
}

# What the existing LaunchAgent does with <key>: "set:<value>", "unset", or nothing.
mac_agent_setting() {
  local script value
  [ -f "$MAC_AGENT_PLIST" ] || return 0
  script=$(/usr/libexec/PlistBuddy -c 'Print :ProgramArguments:2' "$MAC_AGENT_PLIST" 2>/dev/null) || return 0
  case $script in
    *"launchctl unsetenv $1"*) echo unset ;;
    *"launchctl setenv $1 '"*)
      value=${script#*"launchctl setenv $1 '"}
      echo "set:${value%%\'*}"
      ;;
  esac
}

# <key> <default>: sets MAC_CURRENT to the LaunchAgent's value, else launchd's, else <default>, and
# MAC_SOURCE to where it came from.
mac_current() {
  local agent launchd
  agent=$(mac_agent_setting "$1")
  MAC_SOURCE='kept from the LaunchAgent'
  case $agent in
    set:*)
      MAC_CURRENT=${agent#set:}
      return 0
      ;;
    unset)
      MAC_CURRENT=
      return 0
      ;;
  esac
  launchd=$(launchctl getenv "$1" 2>/dev/null || true)
  if [ -n "$launchd" ]; then
    MAC_SOURCE='kept from launchd'
    MAC_CURRENT=$launchd
    return 0
  fi
  MAC_SOURCE=default
  MAC_CURRENT=$2
}

mac_resolve_settings() {
  local source
  step "Pilot's settings"
  case $MAC_FLAG_SCHEDULER in
    all) MAC_SCHEDULER=on source=--scheduler ;;
    pinned | off) MAC_SCHEDULER=$MAC_FLAG_SCHEDULER source=--scheduler ;;
    *)
      mac_current PILOT_SCHEDULER pinned
      MAC_SCHEDULER=$MAC_CURRENT source=$MAC_SOURCE
      ;;
  esac
  say "  PILOT_SCHEDULER=${MAC_SCHEDULER:-(unset: every job)}  ($source)"
  case $MAC_FLAG_VAULT_EXPORT in
    on) MAC_VAULT_EXPORT='' source=--vault-export ;;
    off) MAC_VAULT_EXPORT=off source=--vault-export ;;
    *)
      mac_current PILOT_VAULT_EXPORT off
      MAC_VAULT_EXPORT=$MAC_CURRENT source=$MAC_SOURCE
      ;;
  esac
  say "  PILOT_VAULT_EXPORT=${MAC_VAULT_EXPORT:-(unset: on)}  ($source)"
  case $MAC_FLAG_USAGE_REPORT_DIR in
    default) MAC_USAGE_REPORT_DIR='' source=--usage-report-dir ;;
    '')
      mac_current PILOT_USAGE_REPORT_DIR "$MAC_DEFAULT_USAGE_REPORT_DIR"
      MAC_USAGE_REPORT_DIR=$MAC_CURRENT source=$MAC_SOURCE
      ;;
    *) MAC_USAGE_REPORT_DIR=$MAC_FLAG_USAGE_REPORT_DIR source=--usage-report-dir ;;
  esac
  say "  PILOT_USAGE_REPORT_DIR=${MAC_USAGE_REPORT_DIR:-(unset: Pilot uses the vault 08 folder)}  ($source)"
  if [ -n "$MAC_FLAG_OPEN_AT_LOGIN" ]; then
    MAC_OPEN_AT_LOGIN=$MAC_FLAG_OPEN_AT_LOGIN
  elif [ -f "$MAC_AGENT_PLIST" ] && grep -q '/usr/bin/open' "$MAC_AGENT_PLIST"; then
    MAC_OPEN_AT_LOGIN=1
  fi
  say "  open Pilot at login: $([ "$MAC_OPEN_AT_LOGIN" = 1 ] && echo yes || echo no)"
  if [ "$MAC_SCHEDULER" != pinned ]; then
    warn "PILOT_SCHEDULER isn't pinned, so this Mac also ticks every job that has no runs_on, repeating the main Mac's runs"
  fi
}

# <key> <value> ('' unsets it): the launchd value apps started by `open` read.
mac_set_session_env() {
  local current
  current=$(launchctl getenv "$1" 2>/dev/null || true)
  if [ "$current" = "$2" ]; then
    say "  ${1}=${2:-(unset)}, already"
    return 0
  fi
  if [ -n "$2" ]; then
    run launchctl setenv "$1" "$2"
  else
    run launchctl unsetenv "$1"
  fi
  MAC_ENV_CHANGED=1
}

mac_agent_line() {
  if [ -n "$2" ]; then
    printf '/bin/launchctl setenv %s %s' "$1" "$(setup_single_quote "$2")"
  else
    printf '/bin/launchctl unsetenv %s' "$1"
  fi
}

mac_xml_escape() {
  printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'
}

mac_session_env() {
  MAC_ENV_CHANGED=0
  step "Pilot's settings for this login session (launchctl)"
  say "  build-mac.mjs relaunches Pilot with \`env -i ... open\` (install-mac.mjs launchApp), so your"
  say "  shell's exports never reach the app; \`open\` starts it through launchd, which hands it these."
  mac_set_session_env PILOT_SCHEDULER "$MAC_SCHEDULER"
  mac_set_session_env PILOT_VAULT_EXPORT "$MAC_VAULT_EXPORT"
  mac_set_session_env PILOT_USAGE_REPORT_DIR "$MAC_USAGE_REPORT_DIR"
}

# bootout returns before launchd lets go of the label, and a bootstrap then fails.
mac_wait_agent_gone() {
  local waited=0
  if [ "$SETUP_DRY_RUN" = 1 ]; then
    return 0
  fi
  while launchctl print "$1" >/dev/null 2>&1; do
    if [ "$waited" -ge 10 ]; then
      warn "launchd still lists $1 after 5 s"
      return 0
    fi
    sleep 0.5
    waited=$((waited + 1))
  done
}

mac_bootstrap_agent() {
  local tries=1
  until run launchctl bootstrap "$1" "$MAC_AGENT_PLIST"; do
    if [ "$tries" -ge 3 ]; then
      die "launchctl bootstrap failed 3 times. Try it yourself: launchctl bootstrap $1 $MAC_AGENT_PLIST"
    fi
    sleep 1
    tries=$((tries + 1))
  done
}

mac_write_agent() {
  local script domain
  domain=gui/$(id -u)
  step "LaunchAgent ($MAC_AGENT_PLIST)"
  script="$(mac_agent_line PILOT_SCHEDULER "$MAC_SCHEDULER")"
  script="$script && $(mac_agent_line PILOT_VAULT_EXPORT "$MAC_VAULT_EXPORT")"
  script="$script && $(mac_agent_line PILOT_USAGE_REPORT_DIR "$MAC_USAGE_REPORT_DIR")"
  if [ "$MAC_OPEN_AT_LOGIN" = 1 ]; then
    script="$script && /usr/bin/open -g $MAC_APP"
  fi
  SETUP_WROTE=0
  write_file "$MAC_AGENT_PLIST" 644 <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!-- Pilot's settings at every login, before Pilot reads them. Written by
     src/packages/pilot/scripts/machine-setup/macos.sh; re-run it to change them. -->
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$MAC_AGENT_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/sh</string>
    <string>-c</string>
    <string>$(mac_xml_escape "$script")</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
</dict>
</plist>
EOF
  if launchctl print "$domain/$MAC_AGENT_LABEL" >/dev/null 2>&1; then
    if [ "$SETUP_WROTE" = 0 ]; then
      say "  loaded"
      return 0
    fi
    run launchctl bootout "$domain/$MAC_AGENT_LABEL"
    mac_wait_agent_gone "$domain/$MAC_AGENT_LABEL"
  fi
  mac_bootstrap_agent "$domain"
}

mac_build() {
  step "Build and install Pilot.app (build-mac.mjs quits Pilot, installs $MAC_APP, relaunches it)"
  setup_ensure_pnpm "$SETUP_REPO_DIR"
  # build-mac.mjs builds only this Mac's architecture (electron-builder --mac --dir), so the
  # `pnpm install:release` that a two-architecture `pnpm build:mac` needs doesn't apply.
  run_in "$SETUP_REPO_DIR" pnpm install --frozen-lockfile
  run_in "$SETUP_REPO_DIR" node src/packages/pilot/scripts/build-mac.mjs
}

mac_name_machine() {
  local status
  step "Machine name"
  if [ "$SETUP_DRY_RUN" != 1 ] && [ ! -x "$MAC_CLI" ]; then
    die "$MAC_CLI is missing; build-mac.mjs links it when it installs Pilot"
  fi
  if [ "$MAC_SKIP_BUILD" = 1 ] && [ "$MAC_ENV_CHANGED" = 1 ]; then
    warn "the settings changed: quit Pilot (Cmd+Q) and reopen it, so it reads them"
  fi
  if ! run "$MAC_CLI" host name --name "$SETUP_MACHINE_NAME"; then
    die "Pilot didn't answer. Open $MAC_APP, then re-run with --no-build."
  fi
  if [ "$SETUP_DRY_RUN" != 1 ]; then
    status=$("$MAC_CLI" automations status --json || true)
    say "  $(printf '%s' "$status" | grep -o '"machineName":"[^"]*"\|"schedulerOn":[a-z]*' | tr '\n' ' ')"
  fi
}

mac_print_pairing() {
  local name tailscale_ip=''
  name=$(setup_single_quote "$SETUP_MACHINE_NAME")
  if command -v tailscale >/dev/null 2>&1; then
    tailscale_ip=$(tailscale ip -4 2>/dev/null | head -n 1 || true)
  fi
  step "Pair this Mac from the main Mac"
  cat <<EOF
1. On this Mac, in Pilot: Settings > Remote Hosts > Remote Orca Servers > Share this Orca server >
   New Link. Use this Mac's Tailscale address (${tailscale_ip:-tailscale ip -4}) and copy the
   orca://pair?code=... link. Pilot listens on loopback until a device pairs (STA-2370); making a
   network link opens its listener (port 6868) to the network.
2. On the main Mac (quote the link: zsh reads ? as a glob):
     pilot environment add --name $name --pairing-code 'orca://pair?code=...'
3. Check from the main Mac:
     pilot host name --environment $name
     pilot automations status --environment $name --json   # machineName, schedulerOn
EOF
}

main() {
  while [ $# -gt 0 ]; do
    case $1 in
      -h | --help)
        usage
        exit 0
        ;;
      --scheduler)
        setup_need_value "$@"
        case $2 in all | pinned | off) ;; *) die "--scheduler takes all, pinned or off" ;; esac
        MAC_FLAG_SCHEDULER=$2
        shift 2
        continue
        ;;
      --vault-export)
        setup_need_value "$@"
        case $2 in on | off) ;; *) die "--vault-export takes on or off" ;; esac
        MAC_FLAG_VAULT_EXPORT=$2
        shift 2
        continue
        ;;
      --usage-report-dir)
        setup_need_value "$@"
        if [ "$2" = default ]; then
          MAC_FLAG_USAGE_REPORT_DIR=default
        else
          MAC_FLAG_USAGE_REPORT_DIR=$(setup_expand_home "$2")
        fi
        shift 2
        continue
        ;;
      --open-at-login | --no-open-at-login)
        MAC_FLAG_OPEN_AT_LOGIN=$([ "$1" = --open-at-login ] && echo 1 || echo 0)
        shift
        continue
        ;;
      --no-build)
        MAC_SKIP_BUILD=1
        shift
        continue
        ;;
    esac
    setup_take_common_flag "$@"
    if [ "$SETUP_SHIFT" = 0 ]; then
      die "unknown option: $1 (see --help)"
    fi
    shift "$SETUP_SHIFT"
  done
  setup_require_os macos
  setup_check_common
  setup_banner
  mac_resolve_settings
  mac_check_prerequisites
  setup_ensure_pilot_repo
  setup_ensure_agents
  setup_install_pilotcli
  mac_session_env
  if [ "$MAC_SKIP_BUILD" = 0 ]; then
    mac_build
  fi
  mac_write_agent
  mac_name_machine
  mac_print_pairing
}

main "$@"
