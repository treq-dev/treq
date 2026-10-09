#!/usr/bin/env bash
# Installs the treq-gpui debug APK on a running emulator, opens the home and
# add-host screens, and checks the app renders without crashing. Screenshots
# and logcat go to the output directory.
#
#   mobile-gpui/scripts/android-smoke.sh <app.apk> [output-dir]
set -euo pipefail

APK=$1
OUT=${2:-target/android-smoke}
PKG=dev.treq.gpui
mkdir -p "$OUT"

adb wait-for-device
adb install -r -g "$APK"
adb logcat -c
adb shell am start -n "$PKG/.MainActivity"

failures=0
shot() { adb exec-out screencap -p > "$OUT/$1.png"; }
wait_for() {
  local deadline=$((SECONDS + $2))
  while (( SECONDS < deadline )); do
    if adb logcat -d | grep -Eq "$1"; then return 0; fi
    sleep 1
  done
  echo "FAIL: no log line matching /$1/ within $2 s"
  failures=$((failures + 1))
  return 1
}

wait_for "treq-gpui: attached" 120 || true
sleep 6
shot 01-home

# "Add SSH host" sits below the account and remote cards; scroll and tap it
# by its approximate position, then come back with the back button.
size=$(adb shell wm size | awk '/Physical/ {print $3}' | tr -d '\r')
width=${size%x*}
height=${size#*x}
adb shell input swipe $((width / 2)) $((height * 80 / 100)) $((width / 2)) $((height * 30 / 100)) 300
sleep 2
shot 02-home-scrolled
adb shell input keyevent 4
sleep 2

# Background and foreground: the GPU surface is destroyed and recreated.
adb shell input keyevent 3
sleep 2
adb shell am start -n "$PKG/.MainActivity"
sleep 4
shot 03-resumed

adb logcat -d > "$OUT/logcat.txt"
if ! adb shell pidof "$PKG" > /dev/null; then
  echo "FAIL: app is not running"
  failures=$((failures + 1))
fi
if grep -E "FATAL EXCEPTION|panicked at" "$OUT/logcat.txt"; then
  echo "FAIL: crash in logcat"
  failures=$((failures + 1))
fi
echo "treq-gpui smoke test: $failures failure(s)"
exit $(( failures > 0 ))
