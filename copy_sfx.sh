#!/bin/bash

# 루트의 파일들을 public/audio/sfx/로 복사 (파일명 정규화)
declare -a files=(
  "Cabinet open.mp3"
  "Generator on.mp3"
  "Glass.mp3"
  "Interface click.mp3"
  "Negative Notification.mp3"
  "Switch off.mp3"
  "Switch on.mp3"
  "Wood door close.mp3"
  "Wood door open.mp3"
)

for file in "${files[@]}"; do
  if [ -f "$file" ]; then
    # 파일명을 언더스코어로 변환
    normalized="${file// /_}"
    cp "$file" "public/audio/sfx/$normalized"
    echo "✓ $file → $normalized"
  else
    echo "✗ 파일 없음: $file"
  fi
done

echo ""
echo "최종 파일 목록 (public/audio/sfx/):"
ls -1 public/audio/sfx/ | wc -l
echo "파일들:"
ls -1 public/audio/sfx/
