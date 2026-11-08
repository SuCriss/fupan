#!/bin/bash
UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
echo "=== 涨停池完整一条 ==="
curl -s -m 15 -A "$UA" -H 'Referer: https://quote.eastmoney.com/' \
  'https://push2ex.eastmoney.com/getTopicZTPool?ut=7eea3edcaed734bea9cbfc24409ed989&dpt=wz.ztzt&Pageindex=0&pagesize=2&sort=fbt%3Aasc&date=20261106' \
  | python3 -m json.tool 2>/dev/null | head -40

echo
echo "=== 跌停池一条 ==="
curl -s -m 15 -A "$UA" -H 'Referer: https://quote.eastmoney.com/' \
  'https://push2ex.eastmoney.com/getTopicDTPool?ut=7eea3edcaed734bea9cbfc24409ed989&dpt=wz.ztzt&Pageindex=0&pagesize=1&sort=fund%3Aasc&date=20261106' \
  | python3 -m json.tool 2>/dev/null | head -20

echo
echo "=== 北向资金明细 ==="
curl -s -m 15 -A "$UA" -H 'Referer: https://data.eastmoney.com/' \
  'https://push2his.eastmoney.com/api/qt/kamt.kline/get?fields1=f1,f3,f5&fields2=f51,f52&klt=101&lmt=5' \
  | head -c 500
