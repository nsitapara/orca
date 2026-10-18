# shellcheck shell=bash
# shellcheck disable=SC2034 # Its SETUP_* globals are read by the scripts that source it.
# What every Pilot machine-setup script shares: printing and running each step (and --dry-run), sudo
# steps, file writes, the flags every setup takes, and the checkouts it needs (Pilot's repo, ~/.agents,
# pilotcli). Sourced by macos.sh, debian.sh, arch.sh, linux-engine.sh and pilotcli-cross-build.sh.
# Keep it bash 3.2 safe: it runs under macOS's /bin/bash.
set -euo pipefail

# Sourced twice (debian.sh, then linux-engine.sh) must not reset the parsed flags.
if [ -n "${SETUP_STEPS_LOADED:-}" ]; then
  return 0
fi
SETUP_STEPS_LOADED=1

PILOT_REPO_URL=https://github.com/nsitapara/orca.git
SETUP_DRY_RUN=0
SETUP_MACHINE_NAME=
SETUP_REPO_DIR=$HOME/Documents/GitHub/pilot
SETUP_BRANCH=pilot
SETUP_AGENTS_REPO=https://github.com/nsitapara/agents.git
SETUP_PILOTCLI_REPO=
SETUP_PILOTCLI_BINARY=
SETUP_PILOTCLI_DIR=$HOME/Documents/GitHub/pilotCLI
SETUP_BIN_DIR=$HOME/.local/bin
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

# The flags every setup script takes. Sets SETUP_SHIFT to how many arguments it used (0: not one of these).
setup_take_common_flag() {
  SETUP_SHIFT=0
  case $1 in
    --dry-run)
      SETUP_DRY_RUN=1
      SETUP_SHIFT=1
      ;;
    --machine-name)
      setup_need_value "$@"
      SETUP_MACHINE_NAME=$2
      SETUP_SHIFT=2
      ;;
    --repo-dir)
      setup_need_value "$@"
      SETUP_REPO_DIR=$(setup_expand_home "$2")
      SETUP_SHIFT=2
      ;;
    --branch)
      setup_need_value "$@"
      SETUP_BRANCH=$2
      SETUP_SHIFT=2
      ;;
    --agents-repo)
      setup_need_value "$@"
      SETUP_AGENTS_REPO=$2
      SETUP_SHIFT=2
      ;;
    --pilotcli-repo)
      setup_need_value "$@"
      SETUP_PILOTCLI_REPO=$2
      SETUP_SHIFT=2
      ;;
    --pilotcli-binary)
      setup_need_value "$@"
      SETUP_PILOTCLI_BINARY=$(setup_expand_home "$2")
      SETUP_SHIFT=2
      ;;
    --pilotcli-dir)
      setup_need_value "$@"
      SETUP_PILOTCLI_DIR=$(setup_expand_home "$2")
      SETUP_SHIFT=2
      ;;
  esac
}

setup_common_help() {
  cat <<'EOF'
  --machine-name <name>     Required. This machine's name in Pilot: what runs_on matches and the
                            machine chips show. One line, at most 255 characters.
  --repo-dir <dir>          Pilot's checkout (default ~/Documents/GitHub/pilot). Cloned from
                            https://github.com/nsitapara/orca.git when missing.
  --branch <name>           Branch to build (default pilot).
  --agents-repo <url>       Where ~/.agents comes from (default https://github.com/nsitapara/agents.git,
                            private: sign git in first, or pass an SSH URL).
  --pilotcli-binary <file>  Install this pilotcli build (cross-built on the main Mac with
                            pilotcli-cross-build.sh) at ~/.local/bin/pilotcli.
  --pilotcli-repo <url>     Clone pilotcli from <url> into --pilotcli-dir and install it with its own
                            scripts/install.sh (needs a clean main; Go is installed if missing).
  --pilotcli-dir <dir>      pilotcli checkout for --pilotcli-repo (default ~/Documents/GitHub/pilotCLI).
  --dry-run                 Print every command that would change this machine, and run none of them.
                            Read-only checks (versions, git status) still run.
  --help                    Show this help.
EOF
}

# A runs_on name is one non-blank line of at most 255 characters (shared/definition/schema.ts).
setup_check_common() {
  local name=$SETUP_MACHINE_NAME
  if [ -z "${name//[[:space:]]/}" ]; then
    die "--machine-name is required: it is the name runs_on matches (see --help)"
  fi
  case $name in
    *$'\n'* | *$'\r'*) die "--machine-name must be one line" ;;
  esac
  if [ "${#name}" -gt 255 ]; then
    die "--machine-name is longer than 255 characters"
  fi
  if [ -n "$SETUP_PILOTCLI_REPO" ] && [ -n "$SETUP_PILOTCLI_BINARY" ]; then
    die "pass --pilotcli-repo or --pilotcli-binary, not both"
  fi
}

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

setup_node_major() {
  node --version 2>/dev/null | sed -n 's/^v\([0-9][0-9]*\)\..*/\1/p'
}

# pnpm comes from corepack at the version package.json pins (packageManager).
setup_ensure_pnpm() {
  local repo=$1 want have=''
  export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
  PATH=$SETUP_BIN_DIR:$PATH
  export PATH
  want=$(sed -n 's/.*"packageManager": *"pnpm@\([^+"]*\).*/\1/p' "$repo/package.json" 2>/dev/null || true)
  if [ -n "$want" ] && command -v pnpm >/dev/null 2>&1; then
    have=$(cd "$repo" && COREPACK_ENABLE_NETWORK=0 pnpm --version 2>/dev/null || true)
  fi
  if [ -n "$want" ] && [ "$have" = "$want" ]; then
    say "  pnpm $have"
    return 0
  fi
  if ! command -v corepack >/dev/null 2>&1; then
    if command -v npm >/dev/null 2>&1; then
      run npm install --global --prefix "$HOME/.local" corepack
    elif [ "$SETUP_DRY_RUN" != 1 ]; then
      die "corepack is missing, and so is npm to install it. Install Node 24 with corepack, then re-run."
    fi
  fi
  run mkdir -p "$SETUP_BIN_DIR"
  run corepack enable --install-directory "$SETUP_BIN_DIR" pnpm
}

setup_normalize_url() {
  local url=$1
  url=${url%/}
  url=${url%.git}
  url=${url#https://}
  url=${url#http://}
  url=${url#ssh://}
  url=${url#git@}
  url=${url/://}
  printf '%s' "$url" | tr '[:upper:]' '[:lower:]'
}

setup_origin_matches() {
  local have
  have=$(git -C "$1" remote get-url origin 2>/dev/null) || return 1
  [ "$(setup_normalize_url "$have")" = "$(setup_normalize_url "$2")" ]
}

# Clones <url> at <branch> into <dir>, or fast-forwards a clean checkout of it to origin/<branch>.
setup_ensure_checkout() {
  local url=$1 dir=$2 branch=$3 label=$4 current
  if [ ! -e "$dir" ]; then
    run mkdir -p "$(dirname "$dir")"
    run git clone --branch "$branch" "$url" "$dir"
    return 0
  fi
  if ! git -C "$dir" rev-parse --git-dir >/dev/null 2>&1; then
    die "$label: $dir exists but isn't a git checkout; move it aside, or pass another folder"
  fi
  if ! setup_origin_matches "$dir" "$url"; then
    warn "$label: $dir's origin isn't $url, so it is left as it is"
    return 0
  fi
  if [ -n "$(GIT_OPTIONAL_LOCKS=0 git -C "$dir" status --porcelain --untracked-files=no)" ]; then
    warn "$label: $dir has uncommitted changes, so it isn't updated"
    return 0
  fi
  run git -C "$dir" fetch origin "$branch"
  current=$(git -C "$dir" symbolic-ref --quiet --short HEAD || true)
  if [ "$current" != "$branch" ]; then
    if git -C "$dir" show-ref --verify --quiet "refs/heads/$branch"; then
      run git -C "$dir" checkout "$branch"
    else
      run git -C "$dir" checkout -b "$branch" --track "origin/$branch"
    fi
  fi
  if ! run git -C "$dir" merge --ff-only "origin/$branch"; then
    die "$label: $branch in $dir can't fast-forward to origin/$branch (local commits?). Sort it out, then re-run."
  fi
}

setup_ensure_pilot_repo() {
  step "Pilot's checkout ($SETUP_REPO_DIR, branch $SETUP_BRANCH)"
  setup_ensure_checkout "$PILOT_REPO_URL" "$SETUP_REPO_DIR" "$SETUP_BRANCH" "Pilot's checkout"
}

# ~/.agents holds the skills and automations (README: "Automations on the YAML engine").
setup_ensure_agents() {
  local dir=$HOME/.agents
  step "Skills and automations ($dir)"
  if [ -e "$dir" ] && ! git -C "$dir" rev-parse --git-dir >/dev/null 2>&1; then
    warn "$dir exists but isn't a git checkout. Move it aside and re-run, or clone $SETUP_AGENTS_REPO there yourself."
  elif [ ! -e "$dir" ]; then
    if ! run env GIT_TERMINAL_PROMPT=0 git clone "$SETUP_AGENTS_REPO" "$dir"; then
      die "couldn't clone $SETUP_AGENTS_REPO (it is private). Sign git in first (gh auth login, then gh auth setup-git), or pass --agents-repo git@github.com:nsitapara/agents.git with an SSH key, then re-run."
    fi
  else
    setup_ensure_checkout "$SETUP_AGENTS_REPO" "$dir" main "$dir"
  fi
  if [ -f "$dir/sync-skills.sh" ] || [ "$SETUP_DRY_RUN" = 1 ]; then
    run bash "$dir/sync-skills.sh"
  fi
  setup_link_automations
}

# The main Mac reads ~/.pilot/automations, a link to ~/.agents/automations; every machine gets the same.
setup_link_automations() {
  local link=$HOME/.pilot/automations target=$HOME/.agents/automations
  if [ -L "$link" ] && [ "$(readlink "$link")" = "$target" ]; then
    say "  $link -> $target"
    return 0
  fi
  if [ -e "$link" ] || [ -L "$link" ]; then
    warn "$link exists and isn't a link to $target; it is left as it is"
    return 0
  fi
  run mkdir -p "$HOME/.pilot"
  run ln -s "$target" "$link"
}

# 0 when version $1 >= $2 (dotted numbers).
setup_version_at_least() {
  local have=$1 want=$2 h w
  while [ -n "$want" ]; do
    h=${have%%.*}
    w=${want%%.*}
    h=${h%%[!0-9]*}
    w=${w%%[!0-9]*}
    [ -n "$h" ] || h=0
    [ -n "$w" ] || w=0
    if [ "$h" -gt "$w" ]; then
      return 0
    fi
    if [ "$h" -lt "$w" ]; then
      return 1
    fi
    case $have in *.*) have=${have#*.} ;; *) have='' ;; esac
    case $want in *.*) want=${want#*.} ;; *) want='' ;; esac
  done
  return 0
}

setup_sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  else
    shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

# Puts a Go at least as new as go.mod's on PATH: the one installed, else go.dev's release (checksum-checked)
# under ~/.local/share/pilot-setup. Distro Go is often older than pilotcli's go.mod.
setup_ensure_go() {
  local gomod=$1 want have='' os arch file dest sum
  want=$(awk '$1 == "go" { print $2; exit }' "$gomod" 2>/dev/null || true)
  if [ -z "$want" ]; then
    if [ "$SETUP_DRY_RUN" = 1 ]; then
      say "  (dry run: Go's version comes from $gomod once it is cloned)"
      return 0
    fi
    die "can't read the Go version from $gomod"
  fi
  if command -v go >/dev/null 2>&1; then
    have=$(go env GOVERSION 2>/dev/null | sed 's/^go//')
  fi
  if [ -n "$have" ] && setup_version_at_least "$have" "$want"; then
    say "  Go $have"
    return 0
  fi
  case $(uname -s) in Darwin) os=darwin ;; *) os=linux ;; esac
  case $(uname -m) in x86_64 | amd64) arch=amd64 ;; aarch64 | arm64) arch=arm64 ;; *) die "no Go download for $(uname -m)" ;; esac
  dest=$HOME/.local/share/pilot-setup/go$want
  if [ ! -x "$dest/go/bin/go" ]; then
    file=go$want.$os-$arch.tar.gz
    run mkdir -p "$dest"
    run curl -fsSL -o "$dest/$file" "https://dl.google.com/go/$file"
    run curl -fsSL -o "$dest/$file.sha256" "https://dl.google.com/go/$file.sha256"
    if [ "$SETUP_DRY_RUN" != 1 ]; then
      sum=$(tr -d '[:space:]' <"$dest/$file.sha256")
      [ "$(setup_sha256 "$dest/$file")" = "$sum" ] || die "the Go download's checksum doesn't match; delete $dest and re-run"
    fi
    run tar -C "$dest" -xzf "$dest/$file"
    run rm -f "$dest/$file" "$dest/$file.sha256"
  fi
  PATH=$dest/go/bin:$PATH
  export PATH
}

setup_install_pilotcli() {
  step "pilotcli ($SETUP_BIN_DIR/pilotcli)"
  if [ -n "$SETUP_PILOTCLI_BINARY" ]; then
    if [ ! -f "$SETUP_PILOTCLI_BINARY" ] && [ "$SETUP_DRY_RUN" != 1 ]; then
      die "--pilotcli-binary: no file at $SETUP_PILOTCLI_BINARY"
    fi
    run mkdir -p "$SETUP_BIN_DIR"
    run install -m 755 "$SETUP_PILOTCLI_BINARY" "$SETUP_BIN_DIR/pilotcli"
    if [ "$SETUP_DRY_RUN" != 1 ] && ! "$SETUP_BIN_DIR/pilotcli" self get-version; then
      warn "the copied pilotcli doesn't run here (built for another OS or architecture?)"
    fi
    return 0
  fi
  if [ -n "$SETUP_PILOTCLI_REPO" ]; then
    setup_ensure_checkout "$SETUP_PILOTCLI_REPO" "$SETUP_PILOTCLI_DIR" main pilotcli
    setup_ensure_go "$SETUP_PILOTCLI_DIR/go.mod"
    # install.sh insists on a clean, tested main; an empty PILOTCLI_REFERENCE_COPY keeps it out of a synced vault.
    run env PILOTCLI_INSTALL_DIR="$SETUP_BIN_DIR" PILOTCLI_REFERENCE_COPY= sh "$SETUP_PILOTCLI_DIR/scripts/install.sh"
    return 0
  fi
  if [ -x "$SETUP_BIN_DIR/pilotcli" ] || command -v pilotcli >/dev/null 2>&1; then
    say "  already installed; pass --pilotcli-binary or --pilotcli-repo to replace it"
    return 0
  fi
  warn "pilotcli isn't installed, so jobs that call it will fail. It has no git remote: cross-build it on the main Mac (pilotcli-cross-build.sh), copy it here, and re-run with --pilotcli-binary <file>."
}
