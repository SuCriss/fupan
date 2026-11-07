#!/bin/bash
DB=/opt/fupan/data/fupan.db
echo "=== 表 ==="
sqlite3 "$DB" ".tables"
echo "=== 索引 ==="
sqlite3 "$DB" "SELECT name, tbl_name FROM sqlite_master WHERE type='index' ORDER BY tbl_name;"
echo "=== 行数 ==="
for t in snapshots boards universe klines kline_meta watchlist attributions; do
  n=$(sqlite3 "$DB" "SELECT COUNT(*) FROM $t;" 2>/dev/null)
  echo "  $t: ${n:-N/A}"
done
echo "=== journal_mode / page ==="
sqlite3 "$DB" "PRAGMA journal_mode; PRAGMA page_size; PRAGMA page_count;"
echo "=== 最老快照 ==="
sqlite3 "$DB" "SELECT MIN(date), MAX(date), COUNT(*) FROM snapshots;"
echo "=== klines 覆盖股票数 ==="
sqlite3 "$DB" "SELECT COUNT(DISTINCT code) FROM klines;"
echo "=== attributions 按日期 ==="
sqlite3 "$DB" "SELECT trade_date, COUNT(*) FROM attributions GROUP BY trade_date ORDER BY trade_date DESC LIMIT 5;"
