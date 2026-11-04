#!/bin/bash
set -e
cd /opt/fupan
git pull --ff-only 2>&1 | tail -3
echo "--- build web ---"
cd web
npm run build 2>&1 | tail -6
echo "--- restart ---"
systemctl restart fupan.service
sleep 4
systemctl is-active fupan.service
