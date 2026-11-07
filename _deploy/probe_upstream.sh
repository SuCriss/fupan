#!/bin/bash
echo "=== 服务最新日志 ==="
journalctl -u fupan.service -n 12 --no-pager | tail -8
echo
echo "=== 从服务器测上游连通性 ==="
/opt/fupan/server/.venv/bin/python - <<'PYEOF'
import json, ssl, urllib.parse, urllib.request, time
ctx = ssl.create_default_context(); ctx.check_hostname=False; ctx.verify_mode=ssl.CERT_NONE
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")

def probe(name, url, referer):
    t = time.time()
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Referer": referer})
        with urllib.request.urlopen(req, timeout=20, context=ctx) as r:
            b = r.read()
        print(f"  {name}: OK {len(b)} bytes in {time.time()-t:.1f}s")
        return True
    except Exception as e:
        print(f"  {name}: FAIL {type(e).__name__} {str(e)[:90]} in {time.time()-t:.1f}s")
        return False

print("[1] Sina full market")
probe("sina", "https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData?page=1&num=10&sort=changepercent&asc=0&node=hs_a", "https://vip.stock.finance.sina.com.cn/")

print("[2] Eastmoney datacenter (concepts)")
flt = '(SECUCODE in ("002086.SZ"))'
params = {"reportName":"RPT_F10_CORETHEME_BOARDTYPE","columns":"SECURITY_CODE,BOARD_NAME,IS_PRECISE",
          "filter":flt,"pageNumber":"1","pageSize":"50","source":"HSF10","client":"PC"}
probe("datacenter", "https://datacenter-web.eastmoney.com/api/data/v1/get?"+urllib.parse.urlencode(params), "https://data.eastmoney.com/")

print("[3] Tencent kline")
probe("kline", "https://ifzq.gtimg.cn/appstock/app/fqkline/get?param=sh600000,day,,,10,qfq", "https://gu.qq.com/")

print("[4] Tencent minute")
probe("minute", "https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=sh600000", "https://gu.qq.com/")
PYEOF
