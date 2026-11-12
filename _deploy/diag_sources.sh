#!/bin/bash
UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

echo "=== K 线源可用性 ==="
t() {
  label="$1"; url="$2"; ref="$3"
  code=$(curl -s -o /tmp/k.out -w '%{http_code}' -m 12 -A "$UA" -H "Referer: $ref" "$url" 2>/dev/null)
  size=$(wc -c < /tmp/k.out 2>/dev/null || echo 0)
  printf '  %-16s http=%-4s bytes=%s\n' "$label" "$code" "$size"
}
t tencent "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=sz002578,day,,,100,qfq" "https://gu.qq.com/"
t eastmoney "https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=0.002578&fields1=f1,f2&fields2=f51,f52,f53,f54,f55,f56&klt=101&fqt=1&end=20500101&lmt=100" "https://quote.eastmoney.com/"
t sina "https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=sz002578&scale=240&ma=no&datalen=100" "https://finance.sina.com.cn/"

echo
echo "=== 主行情源（Sina Market Center）==="
curl -s -o /tmp/mc.out -w '  http=%{http_code} time=%{time_total}s\n' -m 15 -A "$UA" \
  "https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData?page=1&num=100&sort=changepercent&asc=0&node=hs_a"
echo "  bytes=$(wc -c < /tmp/mc.out)"

echo
echo "=== 构建线程栈（py-spy 若可用）==="
if command -v py-spy >/dev/null 2>&1; then
  PID=$(systemctl show fupan.service -p MainPID --value)
  py-spy dump --pid "$PID" 2>/dev/null | head -30
else
  echo "  py-spy 未安装"
  PID=$(systemctl show fupan.service -p MainPID --value)
  echo "  --- 线程状态 ---"
  ls /proc/$PID/task | wc -l | sed 's/^/  线程数: /'
  for t in $(ls /proc/$PID/task | head -30); do
    st=$(awk '{print $3}' /proc/$PID/task/$t/stat 2>/dev/null)
    [ "$st" = "R" ] && echo "  线程 $t 状态 R(运行)"
  done
fi

echo
echo "=== 前端首屏（公网 vs 源站）==="
curl -s -o /dev/null -w '  公网 / -> %{http_code} %{time_total}s\n' -m 20 https://fupan.chrisite.eu.cc/
curl -s -o /dev/null -w '  源站 / -> %{http_code} %{time_total}s\n' -m 10 http://127.0.0.1:8000/
curl -s -o /dev/null -w '  公网 /api/health -> %{http_code}\n' -m 20 https://fupan.chrisite.eu.cc/api/health
