#!/bin/bash
DOMAIN=fupan.chrisite.eu.cc
LOG=/tmp/certbot_fupan.log
rm -f "$LOG"

if [ -d "/etc/letsencrypt/live/$DOMAIN" ]; then
  echo "ALREADY_PRESENT"
  exit 0
fi

nohup certbot certonly --webroot -w /var/www/html -d "$DOMAIN" \
  --non-interactive --agree-tos --register-unsafely-without-email \
  > "$LOG" 2>&1 &
echo "started pid $!"
