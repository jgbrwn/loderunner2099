#!/usr/bin/env bash
# Builds android/out/loderunner2099.apk without Gradle:
#   aapt2 (resources + manifest) -> javac -> d8 (dex) -> zipalign -> apksigner
# Installs the Android SDK pieces into $ANDROID_HOME (default ~/android-sdk) if missing.
set -euo pipefail
[[ -n "${WT_ENV_FILE:-}" ]] && WT_ENV_FILE="$(realpath "$WT_ENV_FILE")"
cd "$(dirname "$0")"

ANDROID_HOME="${ANDROID_HOME:-$HOME/android-sdk}"
BUILD_TOOLS_VER=35.0.0
PLATFORM=android-34
MIN_SDK=21
TARGET_SDK=34
# versionCode must increase for upgrades to install over an older APK; default = git commit count.
VERSION_CODE="${VERSION_CODE:-$(git rev-list --count HEAD 2>/dev/null || echo 1)}"
VERSION_NAME="${VERSION_NAME:-1.0.$VERSION_CODE}"
KEYSTORE="${KEYSTORE:-loderunner2099.keystore}"
KS_PASS="${KS_PASS:-lr2099tv}"
KS_ALIAS="${KS_ALIAS:-lr2099tv}"
# Server the app opens on first launch (changeable later in the app: hold OK → Change server URL). The first of:
#   WT_SERVER_URL  the full page, e.g. https://games.example.com/tv?app=1
#   PUBLIC_URL     your server's address, as in its settings (/tv?app=1 is added): from the environment, else from the
#                  server's env file (WT_ENV_FILE, else ../deploy.env)
#   the default production server (https://loderunner2099.exe.xyz)
URL_FROM="WT_SERVER_URL"
if [[ -z "${WT_SERVER_URL:-}" ]]; then
  pub="${PUBLIC_URL:-}"; URL_FROM="PUBLIC_URL"
  if [[ -z "$pub" ]]; then
    for f in "${WT_ENV_FILE:-}" ../deploy.env; do
      [[ -n "$f" && -e "$f" ]] || continue
      if [[ ! -r "$f" ]]; then echo "note: can't read $f (try: PUBLIC_URL=https://… android/build.sh)" >&2; continue; fi
      pub="$(sed -n 's/^[[:space:]]*PUBLIC_URL=//p' "$f" | tail -n1 | tr -d "\"' \r")"
      [[ -n "$pub" ]] && { URL_FROM="PUBLIC_URL in $f"; break; }
    done
  fi
  if [[ -n "$pub" ]]; then
    WT_SERVER_URL="${pub%/}/tv?app=1"
  else
    WT_SERVER_URL="https://loderunner2099.exe.xyz/tv?app=1"; URL_FROM="the default"
  fi
fi
case "$WT_SERVER_URL" in http://*|https://*) ;; *) echo "WT_SERVER_URL/PUBLIC_URL must start with http:// or https://: $WT_SERVER_URL" >&2; exit 1;; esac

BT="$ANDROID_HOME/build-tools/$BUILD_TOOLS_VER"
JAR="$ANDROID_HOME/platforms/$PLATFORM/android.jar"

need() { command -v "$1" >/dev/null || { echo "missing $1 (e.g. apt install openjdk-21-jdk-headless zip unzip curl)" >&2; exit 1; }; }
need javac; need keytool; need java; need zip; need unzip; need curl

if [[ ! -x "$BT/aapt2" || ! -f "$JAR" ]]; then
  echo "== installing Android SDK into $ANDROID_HOME"
  SDKM="$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager"
  if [[ ! -x "$SDKM" ]]; then
    mkdir -p "$ANDROID_HOME/cmdline-tools"
    tmp=$(mktemp -d)
    curl -fsSLo "$tmp/cmd.zip" https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip
    unzip -q "$tmp/cmd.zip" -d "$tmp"
    rm -rf "$ANDROID_HOME/cmdline-tools/latest"
    mv "$tmp/cmdline-tools" "$ANDROID_HOME/cmdline-tools/latest"
    rm -rf "$tmp"
  fi
  yes | "$SDKM" --sdk_root="$ANDROID_HOME" --licenses >/dev/null || true
  "$SDKM" --sdk_root="$ANDROID_HOME" "platforms;$PLATFORM" "build-tools;$BUILD_TOOLS_VER" >/dev/null
fi

if [[ ! -f "$KEYSTORE" ]]; then
  echo "== generating signing key $KEYSTORE"
  keytool -genkeypair -noprompt -keystore "$KEYSTORE" -storepass "$KS_PASS" -keypass "$KS_PASS" \
    -alias "$KS_ALIAS" -keyalg RSA -keysize 2048 -validity 36500 \
    -dname "CN=LodeRunner2099, O=LodeRunner2099" >/dev/null
fi

B=build
rm -rf "$B"; mkdir -p "$B/res" "$B/gen" "$B/classes" "$B/dex" "$B/src" out
cp -r src/. "$B/src/"
# bake the default server URL into the build copy of the source
sed -i "s|static final String DEFAULT_URL = \".*\";|static final String DEFAULT_URL = \"${WT_SERVER_URL//&/\\&}\";|" \
  "$B/src/io/loderunner2099/tv/MainActivity.java"
grep -q "DEFAULT_URL = \"$WT_SERVER_URL\"" "$B/src/io/loderunner2099/tv/MainActivity.java" || { echo "could not set WT_SERVER_URL" >&2; exit 1; }

echo "== aapt2 (version $VERSION_NAME / code $VERSION_CODE)"
"$BT/aapt2" compile --dir res -o "$B/res.zip"
"$BT/aapt2" link -o "$B/unsigned.apk" -I "$JAR" --manifest AndroidManifest.xml \
  --min-sdk-version $MIN_SDK --target-sdk-version $TARGET_SDK \
  --version-code "$VERSION_CODE" --version-name "$VERSION_NAME" \
  --java "$B/gen" "$B/res.zip"

echo "== javac"
javac --release 11 -encoding UTF-8 -Xlint:-options -nowarn -classpath "$JAR" -d "$B/classes" \
  $(find "$B/src" "$B/gen" -name '*.java')

echo "== d8"
"$BT/d8" --release --min-api $MIN_SDK --lib "$JAR" --output "$B/dex" $(find "$B/classes" -name '*.class')
(cd "$B/dex" && zip -q -X ../unsigned.apk classes.dex)

echo "== zipalign + sign"
"$BT/zipalign" -f -p 4 "$B/unsigned.apk" "$B/aligned.apk"
"$BT/apksigner" sign --ks "$KEYSTORE" --ks-pass "pass:$KS_PASS" --ks-key-alias "$KS_ALIAS" \
  --min-sdk-version $MIN_SDK --out out/loderunner2099.apk "$B/aligned.apk"
"$BT/apksigner" verify out/loderunner2099.apk
rm -f out/loderunner2099.apk.idsig
echo "== built android/out/loderunner2099.apk ($(du -h out/loderunner2099.apk | cut -f1), $VERSION_NAME, opens $WT_SERVER_URL, from $URL_FROM)"
