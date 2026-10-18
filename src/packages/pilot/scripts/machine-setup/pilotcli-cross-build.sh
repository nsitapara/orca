#!/usr/bin/env bash
# Builds pilotcli on the main Mac for another machine (GOOS/GOARCH), since pilotcli has no git remote a
# new machine could clone. Like pilotcli's scripts/install.sh it builds only a clean, tested main and
# stamps the commit in. Copy the result over and pass it to the setup script with --pilotcli-binary.
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=setup-steps.sh
. "$SCRIPT_DIR/setup-steps.sh"

CROSS_TARGETS=()
CROSS_OUT_DIR=
CROSS_ALLOW_DIRTY=0
CROSS_SKIP_TESTS=0

usage() {
  cat <<'EOF'
Usage: pilotcli-cross-build.sh [options]

Builds pilotcli for other machines into <pilotcli-dir>/bin (gitignored), one file per target, e.g.
bin/pilotcli-linux-amd64. Then, for example:

  scp ~/Documents/GitHub/pilotCLI/bin/pilotcli-linux-amd64 debian-box:~/
  ssh debian-box '~/Documents/GitHub/pilot/src/packages/pilot/scripts/machine-setup/debian.sh \
    --machine-name "Debian box" --pilotcli-binary ~/pilotcli-linux-amd64'

Options:
  --pilotcli-dir <dir>  pilotcli's checkout (default ~/Documents/GitHub/pilotCLI).
  --target <os/arch>    A Go target, repeatable (default linux/amd64 and linux/arm64). The Mac mini
                        is darwin/arm64 (Apple silicon) or darwin/amd64 (Intel).
  --out-dir <dir>       Where the builds go (default <pilotcli-dir>/bin).
  --allow-dirty         Build even off main or with uncommitted changes (the version says -dirty).
  --skip-tests          Don't run go test ./... first.
  --dry-run             Print every command that would change something, and run none of them.
  --help                Show this help.
EOF
}

cross_check_tree() {
  local dir=$SETUP_PILOTCLI_DIR branch
  [ -f "$dir/go.mod" ] || die "no pilotcli checkout at $dir (pass --pilotcli-dir)"
  branch=$(git -C "$dir" rev-parse --abbrev-ref HEAD)
  if [ "$CROSS_ALLOW_DIRTY" = 1 ]; then
    return 0
  fi
  if [ "$branch" != main ]; then
    die "$dir is on $branch; pilotcli installs only from main (or pass --allow-dirty)"
  fi
  if [ -n "$(GIT_OPTIONAL_LOCKS=0 git -C "$dir" status --porcelain)" ]; then
    die "$dir has uncommitted changes; commit them, or pass --allow-dirty"
  fi
}

main() {
  local version target os arch out name
  while [ $# -gt 0 ]; do
    case $1 in
      -h | --help)
        usage
        exit 0
        ;;
      --dry-run)
        SETUP_DRY_RUN=1
        shift
        ;;
      --pilotcli-dir)
        setup_need_value "$@"
        SETUP_PILOTCLI_DIR=$(setup_expand_home "$2")
        shift 2
        ;;
      --target)
        setup_need_value "$@"
        case $2 in */*) ;; *) die "--target takes <os>/<arch>, like linux/amd64" ;; esac
        CROSS_TARGETS+=("$2")
        shift 2
        ;;
      --out-dir)
        setup_need_value "$@"
        CROSS_OUT_DIR=$(setup_expand_home "$2")
        shift 2
        ;;
      --allow-dirty)
        CROSS_ALLOW_DIRTY=1
        shift
        ;;
      --skip-tests)
        CROSS_SKIP_TESTS=1
        shift
        ;;
      *) die "unknown option: $1 (see --help)" ;;
    esac
  done
  case $(setup_detect_os) in
    macos | debian | arch) ;;
    *) die "pilotcli-cross-build.sh runs on macOS (or Linux); this machine is $(setup_detect_os)" ;;
  esac
  if [ "${#CROSS_TARGETS[@]}" = 0 ]; then
    CROSS_TARGETS=(linux/amd64 linux/arm64)
  fi
  out=${CROSS_OUT_DIR:-$SETUP_PILOTCLI_DIR/bin}
  setup_banner
  cross_check_tree
  command -v go >/dev/null 2>&1 || die "Go is missing (brew install go)"
  version=$(GIT_OPTIONAL_LOCKS=0 git -C "$SETUP_PILOTCLI_DIR" describe --tags --always --dirty)
  step "pilotcli $version from $SETUP_PILOTCLI_DIR"
  if [ "$CROSS_SKIP_TESTS" = 0 ]; then
    run_in "$SETUP_PILOTCLI_DIR" go test ./...
  fi
  run mkdir -p "$out"
  for target in "${CROSS_TARGETS[@]}"; do
    os=${target%%/*}
    arch=${target#*/}
    name=$out/pilotcli-$os-$arch
    # No cgo, so the binary needs nothing from the target's libc.
    run_in "$SETUP_PILOTCLI_DIR" env CGO_ENABLED=0 GOOS="$os" GOARCH="$arch" \
      go build -trimpath -ldflags "-X pilotcli/internal/cli.Version=$version" -o "$name" ./cmd/pilotcli
  done
  step "Copy a build to its machine, then pass it to the setup script"
  for target in "${CROSS_TARGETS[@]}"; do
    say "  $out/pilotcli-${target%%/*}-${target#*/}"
  done
  say ""
  say "  scp $out/pilotcli-linux-amd64 <machine>:~/"
  say "  then on <machine>: debian.sh (or arch.sh, macos.sh) ... --pilotcli-binary ~/pilotcli-linux-amd64"
}

main "$@"
