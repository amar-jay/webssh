#!/bin/sh
set -eu
# A version argument installs that release. No argument, or "latest", follows the
# current GitHub release, then checks its checksum before replacing a binary.
version=${1:-latest}
destination=${2:-"$HOME/.local/bin"}
case "$destination" in /*) ;; *) destination="$(pwd)/$destination";; esac
if [ "$version" = latest ]; then
  resolved=$(curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 -o /dev/null -w '%{url_effective}' https://github.com/amar-jay/webssh/releases/latest)
  version=${resolved##*/}
  version=${version#v}
fi
case "$version" in *[!0-9.]*|''|.*|*..*) echo 'Invalid version' >&2; exit 1;; esac
case "$(uname -s)" in Linux) platform=linux;; Darwin) platform=darwin;; *) echo 'Supported: Linux and macOS' >&2; exit 1;; esac
case "$(uname -m)" in x86_64|amd64) arch=amd64;; arm64|aarch64) arch=arm64;; *) echo 'Unsupported CPU architecture' >&2; exit 1;; esac
archive="webssh_${version}_${platform}_${arch}.tar.gz"
base="https://github.com/amar-jay/webssh/releases/download/v${version}"
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT HUP INT TERM
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 "$base/$archive" -o "$scratch/$archive"
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 "$base/SHA256SUMS" -o "$scratch/SHA256SUMS"
cd "$scratch"
awk -v name="$archive" '$2==name {print;found=1} END{if(!found)exit 1}' SHA256SUMS > selected.sha256
if command -v sha256sum >/dev/null; then sha256sum -c selected.sha256; else shasum -a 256 -c selected.sha256; fi
tar -xzf "$archive" webssh
./webssh --version
mkdir -p "$destination"
# Create the replacement in the destination filesystem for an atomic rename.
replacement=$(mktemp "$destination/.webssh.XXXXXX")
cp webssh "$replacement"
chmod 755 "$replacement"
mv -f "$replacement" "$destination/webssh"
echo "Installed $destination/webssh; add $destination to PATH if needed."
