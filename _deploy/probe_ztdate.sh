#!/bin/bash
UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
U='7eea3edcaed734bea9cbfc24409ed989'
probe() {
  label="$1"; url="$2"
  out=$(curl -s -m 15 -A "$UA" -H 'Referer: https://quote.eastmoney.com/' "$url" 2>/dev/null)
  tc=$(printf '%s' "$out" | grep -o '"tc":[0-9]*' | head -1)
  qd=$(printf '%s' "$out" | grep -o '"qdate":[0-9]*' | head -1)
  printf '%-28s %-12s %-16s bytes=%s\n' "$label" "${tc:-no-tc}" "${qd:-no-qdate}" "${#out}"
}
echo "今天: $(date +%Y%m%d)  星期$(date +%u)"
probe "date=今天(周日)" "https://push2ex.eastmoney.com/getTopicZTPool?ut=$U&dpt=wz.ztzt&Pageindex=0&pagesize=300&sort=fbt%3Aasc&date=$(date +%Y%m%d)"
probe "date=20261106(周五)" "https://push2ex.eastmoney.com/getTopicZTPool?ut=$U&dpt=wz.ztzt&Pageindex=0&pagesize=300&sort=fbt%3Aasc&date=20261106"
probe "无 date 参数" "https://push2ex.eastmoney.com/getTopicZTPool?ut=$U&dpt=wz.ztzt&Pageindex=0&pagesize=300&sort=fbt%3Aasc"
