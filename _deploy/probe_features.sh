#!/bin/bash
UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
t() {
  name="$1"; url="$2"; ref="$3"
  rm -f /tmp/f.out
  code=$(curl -s -o /tmp/f.out -w '%{http_code}' -m 15 -A "$UA" -H "Referer: $ref" "$url" 2>/dev/null)
  size=$(wc -c < /tmp/f.out 2>/dev/null || echo 0)
  printf '%-26s http=%-4s bytes=%-7s ' "$name" "$code" "$size"
  head -c 100 /tmp/f.out | tr -d '\n'
  echo
}

echo "=== 全市场龙虎榜（不限个股）==="
t lhb_all "https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_DAILYBILLBOARD_DETAILSNEW&columns=SECURITY_CODE,SECURITY_NAME_ABBR,TRADE_DATE,EXPLANATION,BILLBOARD_NET_AMT,CHANGE_RATE&pageNumber=1&pageSize=3&sortColumns=TRADE_DATE&sortTypes=-1" "https://data.eastmoney.com/"

echo
echo "=== 涨停原因/涨停板行情（东财）==="
t em_ztpool "https://push2ex.eastmoney.com/getTopicZTPool?ut=7eea3edcaed734bea9cbfc24409ed989&dpt=wz.ztzt&Pageindex=0&pagesize=5&sort=fbt%3Aasc&date=20261107" "https://quote.eastmoney.com/"
t em_dtpool "https://push2ex.eastmoney.com/getTopicDTPool?ut=7eea3edcaed734bea9cbfc24409ed989&dpt=wz.ztzt&Pageindex=0&pagesize=3&sort=fund%3Aasc&date=20261107" "https://quote.eastmoney.com/"

echo
echo "=== 北向资金 ==="
t northbound "https://push2his.eastmoney.com/api/qt/kamt.kline/get?fields1=f1,f3,f5&fields2=f51,f52&klt=101&lmt=5" "https://data.eastmoney.com/"

echo
echo "=== 板块资金流排行 ==="
t sector_flow "https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=5&po=1&fid=f62&fs=m%3A90%2Bt%3A2&fields=f12,f14,f62,f184" "https://quote.eastmoney.com/"

echo
echo "=== 个股分时均线/竞价 ==="
t auction "https://push2.eastmoney.com/api/qt/stock/get?secid=0.002578&fields=f43,f46,f60,f44,f45,f47,f48,f50,f57,f58" "https://quote.eastmoney.com/"
