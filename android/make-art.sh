#!/usr/bin/env bash
# Generates the neon launcher icons + Android TV banner (needs ImageMagick).
set -euo pipefail
cd "$(dirname "$0")/res"
F=DejaVu-Sans-Bold
BG='#05010f'
neon() { # out w h text pointsize color
  local out=$1 w=$2 h=$3 txt=$4 pt=$5 col=$6 dy=${7:-0}
  convert -size ${w}x${h} xc:"$BG" \
    \( -size ${w}x${h} xc:none -font $F -pointsize $pt -fill "$col" -gravity center -annotate +0+$dy "$txt" -blur 0x$((pt/8+1)) \) -composite \
    \( -size ${w}x${h} xc:none -font $F -pointsize $pt -fill white -stroke "$col" -strokewidth $((pt/30+1)) -gravity center -annotate +0+$dy "$txt" \) -composite \
    "$out"
}
banner() { # out w h
  local w=$2 h=$3 s=$(($3/180))
  neon /tmp/lr-b1.png $w $h "LODE RUNNER" $((34*s)) '#00f0ff' -$((22*s))
  convert /tmp/lr-b1.png -fill none -stroke '#ff2bd6' -strokewidth $((2*s)) -draw "rectangle $((8*s)),$((8*s)) $((w-8*s)),$((h-8*s))" \
    \( -size ${w}x${h} xc:none -font $F -pointsize $((40*s)) -fill '#ff2bd6' -gravity south -annotate +0+$((18*s)) 2099 \) -composite "$1"
}
mkdir -p drawable drawable-xhdpi
banner drawable/banner.png 320 180
banner drawable-xhdpi/banner.png 640 360
for d in mdpi:48 hdpi:72 xhdpi:96 xxhdpi:144 xxxhdpi:192; do
  n=${d#*:}; mkdir -p mipmap-${d%:*}
  neon /tmp/lr-i.png $n $n "LR" $((n*45/100)) '#00f0ff' -$((n/9))
  convert /tmp/lr-i.png \( -size ${n}x${n} xc:none -font $F -pointsize $((n*18/100)) -fill '#ff2bd6' -gravity south -annotate +0+$((n/14)) 2099 \) -composite mipmap-${d%:*}/ic_launcher.png
done
rm -f /tmp/lr-b1.png /tmp/lr-i.png
