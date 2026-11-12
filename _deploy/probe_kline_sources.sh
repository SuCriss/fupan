#!/bin/bash
UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
t() {
  name="$1"; url="$2"; ref="$3"
  code=$(curl -s -o /tmp/k.out -w '%{http_code}' -m 15 -A "$UA" -H "Referer: $ref" "$url" 2>/dev/null)
  size=$(wc -c < /tmp/k.out 2>/dev/null || echo 0)
  printf '%-22s http=%-4s bytes=%-7s ' "$name" "$code" "$size"
  head -c 120 /tmp/k.out | tr -d '\n'
  echo
}
echo "=== 腾讯（当前源）==="
t tencent_web "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=sz002578,day,,,320,qfq" "https://gu.qq.com/"
t tencent_alt "https://ifzq.gtimg.cn/appstock/app/fqkline/get?param=sz002578,day,,,320,qfq" "https://gu.qq.com/"

echo
echo "=== 新浪 ==="
t sina_kline "https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=sz002578&scale=240&ma=no&datalen=320" "https://finance.sina.com.cn/"

echo
echo "=== 东方财富 ==="
t em_kline "https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=0.002578&fields1=f1,f2,f3,f4,f5&fields2=f51,f52,f53,f54,f55,f56&klt=101&fqt=1&end=20500101&lmt=320" "https://quote.eastmoney.com/"
t em_kline2 "https://push2.eastmoney.com/api/qt/stock/kline/get?secid=0.002578&fields1=f1,f2,f3,f4,f5&fields2=f51,f52,f53,f54,f55,f56&klt=101&fqt=1&end=20500101&lmt=320" "https://quote.eastmoney.com/"
