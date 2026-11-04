#!/bin/bash
echo "=== AI endpoint reachability from server ==="
cd /opt/fupan/server
.venv/bin/python - <<'PYEOF'
import json, os, sys, time
sys.path.insert(0, '.')
from fupan import config, llm
print('enabled:', llm.configured(), '| model:', os.environ.get('FUPAN_LLM_MODEL'))
print('base:', os.environ.get('FUPAN_LLM_BASE_URL'))
t = time.time()
out = llm._call_llm('股票：测试(000001)\n今日涨幅：10.0%\n概念题材：银行')
print(f'LLM reply in {time.time()-t:.1f}s:')
print((out or '(empty)')[:300])
PYEOF
