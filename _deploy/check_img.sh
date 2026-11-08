#!/bin/bash
cd /opt/fupan/server
echo "=== Pillow ==="
./.venv/bin/python -c "import PIL, PIL.Image; print('Pillow', PIL.__version__)" 2>&1 | head -2
echo "=== cairosvg ==="
./.venv/bin/python -c "import cairosvg; print('ok')" 2>&1 | head -1
echo "=== 系统工具 ==="
for t in convert rsvg-convert inkscape magick; do
  command -v $t >/dev/null 2>&1 && echo "  $t: $(command -v $t)" || echo "  $t: 无"
done
