# shellcheck shell=bash
# shellcheck disable=SC2034 # Its SETUP_* globals are read by the scripts that source it.
# How every machine-setup script runs a step: prints it, runs it unless --dry-run, prints each sudo step
# with its reason first, writes files only when they change, and checks which OS it runs on. Sourced
# by every script here (checkouts-and-toolchain.sh sources it too). Keep it bash 3.2 safe: it runs
# under macOS's /bin/bash.
set -euo pipefail

if [ -n "${SETUP_STEP_RUNNER_LOADED:-}" ]; then
  return 0
fi
SETUP_STEP_RUNNER_LOADED=1

SETUP_DRY_RUN=0
# How many arguments the last setup_take_*_flag used (0: not one of its flags).
SETUP_SHIFT=0
# 1 once write_file changed a file; callers reset it before the writes they care about.
SETUP_WROTE=0

say() { printf '%s\n' "$*"; }
step() { printf '\n==> %s\n' "$*"; }
warn() { printf 'warning: %s\n' "$*" >&2; }
die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

setup_quote() {
  local out='' arg
  for arg in "$@"; do
    out="$out $(printf '%q' "$arg")"
  done
  printf '%s' "${out# }"
}

# Shell-safe single quoting, for commands printed for someone to paste.
setup_single_quote() {
  printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"
}

run() {
  printf '+ %s\n' "$(setup_quote "$@")"
  if [ "$SETUP_DRY_RUN" = 1 ]; then
    return 0
  fi
  "$@"
}

run_in() {
  local dir=$1
  shift
  printf '+ (cd %s && %s)\n' "$(printf '%q' "$dir")" "$(setup_quote "$@")"
  if [ "$SETUP_DRY_RUN" = 1 ]; then
    return 0
  fi
  (cd "$dir" && "$@")
}

# Every sudo step says why first, then shows the exact command.
run_sudo() {
  local why=$1
  shift
  printf '\n[sudo] %s\n+ sudo %s\n' "$why" "$(setup_quote "$@")"
  if [ "$SETUP_DRY_RUN" = 1 ]; then
    return 0
  fi
  if [ "$(id -u)" = 0 ]; then
    "$@"
  else
    sudo "$@"
  fi
}

# write_file <path> <octal mode>, content on stdin. An unchanged file is left alone.
write_file() {
  local path=$1 mode=$2 content current tmp
  content=$(
    cat
    printf .
  )
  content=${content%.}
  if [ -f "$path" ]; then
    current=$(
      cat "$path"
      printf .
    )
    current=${current%.}
    if [ "$current" = "$content" ]; then
      say "  unchanged: $path"
      return 0
    fi
  fi
  SETUP_WROTE=1
  printf '+ write %s (mode %s)\n' "$path" "$mode"
  if [ "$SETUP_DRY_RUN" = 1 ]; then
    printf '%s' "$content" | sed 's/^/    | /'
    case $content in
      *$'\n') ;;
      *) echo ;;
    esac
    return 0
  fi
  mkdir -p "$(dirname "$path")"
  tmp=$(mktemp "$path.XXXXXX")
  printf '%s' "$content" >"$tmp"
  chmod "$mode" "$tmp"
  mv -f "$tmp" "$path"
}

setup_expand_home() {
  # shellcheck disable=SC2088 # Matching a literal ~ is the point.
  case $1 in
    '~') printf '%s' "$HOME" ;;
    '~/'*) printf '%s/%s' "$HOME" "${1#\~/}" ;;
    *) printf '%s' "$1" ;;
  esac
}

setup_need_value() {
  if [ $# -lt 2 ] || [ -z "$2" ]; then
    die "$1 needs a value (see --help)"
  fi
}

# Every path here is built from HOME, and some of them are deleted.
case ${HOME:-} in
  /?*) ;;
  *) die "HOME must be an absolute path (it is '${HOME:-}')" ;;
esac

# macos, debian, arch, or what this machine is. PILOT_SETUP_ASSUME_OS stands in for it in dry-run tests.
setup_detect_os() {
  if [ -n "${PILOT_SETUP_ASSUME_OS:-}" ]; then
    printf '%s\n' "$PILOT_SETUP_ASSUME_OS"
    return 0
  fi
  local id='' like=''
  case $(uname -s) in
    Darwin) echo macos ;;
    Linux)
      if [ -r /etc/os-release ]; then
        # shellcheck source=/dev/null
        id=$(. /etc/os-release && printf '%s' "${ID:-}")
        # shellcheck source=/dev/null
        like=$(. /etc/os-release && printf '%s' "${ID_LIKE:-}")
      fi
      case " $id $like " in
        *' arch '*) echo arch ;;
        *' debian '* | *' ubuntu '*) echo debian ;;
        *) echo "Linux (${id:-unknown})" ;;
      esac
      ;;
    *) uname -s ;;
  esac
}

setup_require_os() {
  local want=$1 have
  have=$(setup_detect_os)
  if [ -n "${PILOT_SETUP_ASSUME_OS:-}" ] && [ "$SETUP_DRY_RUN" != 1 ]; then
    die "PILOT_SETUP_ASSUME_OS is for --dry-run tests only"
  fi
  if [ "$have" != "$want" ]; then
    die "this script sets up $want, and this machine is $have. Use macos.sh, debian.sh or arch.sh from the same folder."
  fi
  if [ -n "${PILOT_SETUP_ASSUME_OS:-}" ]; then
    say "(dry-run test: treating this $(uname -s) machine as $want)"
  fi
}

setup_banner() {
  if [ "$SETUP_DRY_RUN" = 1 ]; then
    say "Dry run: every command that would change this machine is printed, and none of them runs."
  fi
}
