#!/bin/bash

TARGET_DIR="content"

export LC_ALL=C

find "$TARGET_DIR" -type f -print0 | while IFS= read -r -d '' file; do
  sed -i '' -E \
    's|!youtube\[([^]]+)\]|![](https://youtu.be/\1)|g' \
    "$file"
done
