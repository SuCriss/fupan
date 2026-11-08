#!/bin/bash
UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
echo "=== 全市场龙虎榜（最近交易日，净买入降序）==="
curl -s -m 20 -A "$UA" -H 'Referer: https://data.eastmoney.com/' \
 'https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_DAILYBILLBOARD_DETAILSNEW&columns=SECURITY_CODE,SECURITY_NAME_ABBR,TRADE_DATE,EXPLANATION,BILLBOARD_NET_AMT,BILLBOARD_BUY_AMT,BILLBOARD_SELL_AMT,CHANGE_RATE,TURNOVERRATE,ACCUM_AMOUNT&pageNumber=1&pageSize=3&sortColumns=BILLBOARD_NET_AMT&sortTypes=-1' \
 | python3 -m json.tool 2>/dev/null | head -30

echo
echo "=== 机构席位明细 ==="
curl -s -m 20 -A "$UA" -H 'Referer: https://data.eastmoney.com/' \
 'https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_ORGANIZATION_TRADE_DETAILS&columns=ALL&pageNumber=1&pageSize=2&sortColumns=TRADE_DATE&sortTypes=-1' \
 | python3 -m json.tool 2>/dev/null | head -30
