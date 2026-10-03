#!/bin/bash

# 파일명 매핑
declare -A mapping=(
  ["Object place.mp3"]="place.mp3"
  ["Interface click.mp3"]="attach.mp3"
  ["Negative Notification.mp3"]="reject.mp3"
  ["Switch on.mp3"]="bulbOn.mp3"
  ["Switch off.mp3"]="bulbOff.mp3"
  ["flickeringlight2.mp3"]="bulbFlicker.mp3"
  ["Wood door open.mp3"]="doorOpen.mp3"
  ["Wood door close.mp3"]="doorClose.mp3"
  ["Liquid pouring.mp3"]="liquidPour.mp3"
  ["Measure done.mp3"]="measureDone.mp3"
)

# wireConnect/wireDisconnect는 attach/reject 재사용
# pick도 place 재사용

for src in "${!mapping[@]}"; do
  dst="${mapping[$src]}"
  if [ -f "$src" ]; then
    cp "$src" "public/audio/sfx/$dst"
    echo "✓ $src → $dst"
  else
    echo "✗ 파일 없음: $src"
  fi
done

# wireConnect/wireDisconnect 중복 생성
cp public/audio/sfx/attach.mp3 public/audio/sfx/wireConnect.mp3
cp public/audio/sfx/reject.mp3 public/audio/sfx/wireDisconnect.mp3
cp public/audio/sfx/place.mp3 public/audio/sfx/pick.mp3

echo ""
echo "최종 파일 목록:"
ls -1 public/audio/sfx/
