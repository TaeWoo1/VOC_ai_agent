#!/usr/bin/env python3
"""Build the retrieval benchmark's embedding cache.

Run once, from the repo root, after `BenchmarkTextDump` has written build/bench-texts.json:

    SELLEROPS_KNOWLEDGE_EMBEDDING_API_KEY=... python3 tools/dev/bench-embed.py

Writes backend/src/test/resources/retrieval-benchmark/vectors.json so the benchmark is reproducible
and CI never calls a vendor. Prints counts only — never a key, never a vector, never a passage.
"""
import base64, hashlib, json, os, struct, sys, urllib.request

MODEL = os.environ.get("BENCH_EMBED_MODEL", "text-embedding-3-small")
DIMENSIONS = int(os.environ.get("BENCH_EMBED_DIMENSIONS", "256"))
KEY = os.environ.get("SELLEROPS_KNOWLEDGE_EMBEDDING_API_KEY") or os.environ.get("SELLEROPS_AGENT_DRAFT_API_KEY")
if not KEY:
    sys.exit("no embedding key in the environment")

texts = json.load(open("backend/build/bench-texts.json"))
out = {}
for i in range(0, len(texts), 32):
    batch = texts[i:i + 32]
    body = json.dumps({"model": MODEL, "input": batch, "dimensions": DIMENSIONS}).encode()
    request = urllib.request.Request(
        "https://api.openai.com/v1/embeddings", data=body,
        headers={"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=60) as response:
        payload = json.load(response)
    for item in payload["data"]:
        text = batch[item["index"]]
        key = hashlib.sha256(text.encode()).hexdigest()[:24]
        out[key] = base64.b64encode(struct.pack(f"<{len(item['embedding'])}f", *item["embedding"])).decode()

path = os.environ.get("BENCH_EMBED_OUT", "backend/src/test/resources/retrieval-benchmark/vectors.json")
json.dump(out, open(path, "w"), indent=0, sort_keys=True)
print(f"model={MODEL} dimensions={DIMENSIONS} vectors={len(out)} bytes={os.path.getsize(path)}")
