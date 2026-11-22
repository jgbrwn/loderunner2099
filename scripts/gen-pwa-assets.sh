#!/bin/sh
# Generates neon PWA icons + iOS startup images into public/. Needs ImageMagick (convert).
set -e
cd "$(dirname "$0")/../public"
BG='#05010f'
# logo LAYER: $1=size $2=out  (content scaled to fit, transparent bg)
logo() {
  S=$1; F=$(( S * 46 / 100 )); F2=$(( S * 20 / 100 ))
  convert -size ${S}x${S} xc:none -font Helvetica-Bold -gravity center \
    \( -size ${S}x${S} xc:none -fill '#00ffff' -pointsize $F -annotate +0-$((S/10)) 'LR' \
       -fill '#ff2bd6' -pointsize $F2 -annotate +0+$((S*22/100)) '2099' \) \
    \( +clone -channel RGBA -blur 0x$((S/40 + 2)) \) \( -clone 1 \) -delete 1 -background none -layers merge "$2"
}
logo 512 /tmp/lr-logo.png
# rounded neon frame for normal icons
convert -size 512x512 xc:none -fill "$BG" -stroke '#00ffff' -strokewidth 10 -draw 'roundrectangle 12,12 499,499 80,80' \
  \( +clone -blur 0x8 \) -swap 0,1 -background none -layers merge /tmp/lr-frame.png
convert /tmp/lr-frame.png /tmp/lr-logo.png -background none -layers merge icons/icon-512.png
convert icons/icon-512.png -resize 192x192 icons/icon-192.png
# maskable: full-bleed bg, logo inside the 80% safe zone
convert -size 512x512 xc:"$BG" \( /tmp/lr-logo.png -resize 380x380 \) -gravity center -composite icons/maskable-512.png
convert icons/maskable-512.png -resize 192x192 icons/maskable-192.png
# apple touch icon: opaque, no transparency
convert -size 180x180 xc:"$BG" \( /tmp/lr-logo.png -resize 170x170 \) -gravity center -composite icons/apple-touch-icon.png
# iOS startup images (portrait WxH device px); landscape variants are swapped
for d in 1290x2796 1179x2556 1170x2532 1284x2778 1125x2436 828x1792 750x1334 1242x2688 1668x2388 2048x2732; do
  W=${d%x*}; H=${d#*x}; M=$(( W < H ? W : H )); L=$(( M * 6 / 10 ))
  convert -size ${W}x${H} xc:"$BG" \( /tmp/lr-logo.png -resize ${L}x${L} \) -gravity center -composite -strip -colors 64 splash/p-${W}x${H}.png
  convert -size ${H}x${W} xc:"$BG" \( /tmp/lr-logo.png -resize ${L}x${L} \) -gravity center -composite -strip -colors 64 splash/l-${H}x${W}.png
done
