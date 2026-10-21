#!/usr/bin/env bash
# Provision Node if it is missing, then hand off to the Node-side bootstrap.
#
#   ./setup.sh                 # use nvm if present; never install one silently
#   ./setup.sh --install-node  # install nvm (curl | bash) when there is none
#   ./setup.sh --dry-run       # forwarded to bootstrap: report, change nothing
#
# Why this is a shell script and not a step inside bootstrap.mjs: bootstrap is
# a Node program, so it cannot exist on a machine that has no Node — the check
# has to happen before it runs. And `nvm` is a shell function, not a binary: a
# child process cannot change the PATH of the shell you are standing in, so
# provisioning inside bootstrap would leave `dsh` unavailable in the very
# terminal it was installed from.
#
# Installing a Node runtime is a bigger decision than installing a CLI, so the
# two cases are kept distinct: an existing nvm is used without ceremony, while
# fetching and running nvm's installer requires --install-node.
set -euo pipefail

ROOT=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
NODE_VERSION=$(cat "$ROOT/.nvmrc" 2>/dev/null || echo '24')
NVM_DIR=${NVM_DIR:-$HOME/.nvm}
MIN_MAJOR=20

install_node=0
args=()
for arg in "$@"; do
	case "$arg" in
		--install-node) install_node=1 ;;
		*) args+=("$arg") ;;
	esac
done

say() { printf '%s\n' "$*"; }
die() {
	printf 'setup: %s\n' "$*" >&2
	exit 1
}

nvm_source() {
	# nvm.sh reads variables it has not set, which `set -u` turns into a fatal
	# error, so it is sourced with nounset relaxed and restored immediately.
	set +u
	# shellcheck disable=SC1091
	. "$NVM_DIR/nvm.sh"
	set -u
}

if ! command -v node >/dev/null 2>&1; then
	say 'node is not on PATH.'
	if [ -s "$NVM_DIR/nvm.sh" ]; then
		say "  using the nvm at $NVM_DIR"
		nvm_source
		# Prefer a version already installed; only reach the network if needed.
		if ! nvm use "$NODE_VERSION" >/dev/null 2>&1; then
			say "  installing Node $NODE_VERSION"
			nvm install "$NODE_VERSION" >/dev/null
			nvm use "$NODE_VERSION" >/dev/null
		fi
	elif [ "$install_node" = 1 ]; then
		say '  no nvm found; installing it from the official installer'
		curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.8/install.sh | bash
		nvm_source
		say "  installing Node $NODE_VERSION"
		nvm install "$NODE_VERSION" >/dev/null
		nvm use "$NODE_VERSION" >/dev/null
		say ''
		say '  For future shells, add this to your shell rc file:'
		say '    export NVM_DIR="$HOME/.nvm"'
		say '    [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"'
	else
		cat <<EOF

  No nvm at $NVM_DIR and Node is not on PATH. Either:

    ./setup.sh --install-node      # install nvm (official installer) and Node $NODE_VERSION
    brew install node              # or your system's package manager
    # or install nvm yourself: https://github.com/nvm-sh/nvm

EOF
		exit 1
	fi
fi

command -v node >/dev/null 2>&1 || die 'Node still is not on PATH after provisioning.'

major=$(node -p 'process.versions.node.split(".")[0]')
self=$(node --version)
if [ "$major" -lt "$MIN_MAJOR" ]; then
	die "Node $self is too old; this repo needs $MIN_MAJOR or newer."
fi
if [ "$major" -lt 24 ]; then
	say "note: developed on Node 24 (see .nvmrc); you are on $self."
fi

exec node "$ROOT/scripts/bootstrap.mjs" ${args[@]+"${args[@]}"}
