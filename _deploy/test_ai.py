"""Verify the configured LLM endpoint answers from the server."""
import os
import sys
import time

sys.path.insert(0, '/opt/fupan/server')
from fupan import llm  # noqa: E402

print('enabled:', llm.configured())
print('model  :', os.environ.get('FUPAN_LLM_MODEL'))
print('base   :', os.environ.get('FUPAN_LLM_BASE_URL'))

facts = 'Stock: Test Co (000001)\nChange today: +10.0%\nThemes: banking, state-owned reform'
t = time.time()
try:
    out = llm._call_llm(facts)
    print('elapsed: %.1fs' % (time.time() - t))
    print('reply  :', (out or '(empty)')[:400])
except Exception as exc:
    print('FAILED after %.1fs: %s: %s' % (time.time() - t, type(exc).__name__, exc))
