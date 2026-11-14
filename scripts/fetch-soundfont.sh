#!/usr/bin/env sh
# Fetch the General-MIDI sound bank used for "Listen" and the accompaniment:
# GeneralUser GS v2.0.3 by S. Christian Collins (https://schristiancollins.com).
#
# Its licence allows use in software projects and asks that sites host their
# own copy rather than link to the author's downloads — so the build fetches a
# pinned revision once and the app serves it from public/soundfonts/. Not
# committed (32 MB); the checksum guards against a changed upstream file.
set -eu

REV=684543d5e5efaef08d02be50dcda8d552478fa60
SHA256=9575028c7a1f589f5770fccc8cff2734566af40cd26ed836944e9a5152688cfe
OUT="$(dirname "$0")/../public/soundfonts/gm.sf2"

sum() { (sha256sum "$1" 2>/dev/null || shasum -a 256 "$1") | cut -d' ' -f1; }

if [ -f "$OUT" ] && [ "$(sum "$OUT")" = "$SHA256" ]; then
  echo "sound bank already present"
  exit 0
fi

mkdir -p "$(dirname "$OUT")"
curl -sSfL -o "$OUT.tmp" "https://raw.githubusercontent.com/mrbumpy409/GeneralUser-GS/$REV/GeneralUser-GS.sf2"
if [ "$(sum "$OUT.tmp")" != "$SHA256" ]; then
  rm -f "$OUT.tmp"
  echo "sound bank checksum mismatch" >&2
  exit 1
fi
mv "$OUT.tmp" "$OUT"
echo "sound bank installed: $OUT"
