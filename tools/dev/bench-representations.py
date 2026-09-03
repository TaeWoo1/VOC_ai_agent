#!/usr/bin/env python3
"""Generate the Knowledge Retrieval Quality v2 exploration representations.

Run from the repo root after `BenchmarkArmDump` has written backend/build/bench/:

    SELLEROPS_KNOWLEDGE_EMBEDDING_API_KEY=... python3 tools/dev/bench-representations.py intent
    ...                                                                                 synthetic
    ...                                                                                 summary
    ...                                                                                 eligibility   (after one sweep run)
    ...                                                                                 embed         (last)

Everything lands in backend/build/bench/ and is NEVER checked in: these files are a model's output,
and the question the benchmark asks is whether that output earns its cost. Prints counts only.
"""
import base64, hashlib, json, os, struct, sys, urllib.request

DIR = "backend/build/bench"
KEY = os.environ.get("SELLEROPS_KNOWLEDGE_EMBEDDING_API_KEY") or os.environ.get("SELLEROPS_AGENT_DRAFT_API_KEY")
CHAT_MODEL = os.environ.get("BENCH_CHAT_MODEL", "gpt-5-2025-08-07")
EMBED_MODEL = os.environ.get("BENCH_EMBED_MODEL", "text-embedding-3-large")
EMBED_DIMENSIONS = int(os.environ.get("BENCH_EMBED_DIMENSIONS", "1024"))
if not KEY:
    sys.exit("no key in the environment")


def post(url, body):
    request = urllib.request.Request(
        url, data=json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=180) as response:
        return json.load(response)


def chat(system, user):
    payload = post("https://api.openai.com/v1/chat/completions", {
        "model": CHAT_MODEL,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        "response_format": {"type": "json_object"},
        "max_completion_tokens": 4000,
        "reasoning_effort": "minimal",
    })
    return json.loads(payload["choices"][0]["message"]["content"])


def load(name, default):
    path = f"{DIR}/{name}"
    return json.load(open(path)) if os.path.exists(path) else default


def save(name, value):
    json.dump(value, open(f"{DIR}/{name}", "w"), ensure_ascii=False, indent=0, sort_keys=True)


INTENT_SYSTEM = (
    "당신은 고객이 남긴 문장을 읽고, 그 문장에 답하려면 어떤 정보가 필요한지 한 문장으로 다시 적습니다.\n"
    "규칙:\n"
    "- 문장에 없는 사실, 수치, 제품명, 회사 이름을 만들지 않습니다.\n"
    "- 고객이 쓴 구어체 표현이 가리키는 상황을 일반적인 말로 풀어 적습니다.\n"
    "- 문장이 아무 정보도 요구하지 않으면(칭찬, 인사, 감상만 있으면) 빈 문자열을 적습니다.\n"
    '출력은 {"items":[{"i":정수,"intent":"문자열"}]} 형식의 JSON만.')

SYNTHETIC_SYSTEM = (
    "당신은 판매자가 등록한 안내 문단을 읽고, 그 문단이 답해 줄 수 있는 고객의 말을 짧게 예상합니다.\n"
    "규칙:\n"
    "- 실제 고객이 쓰는 구어체로 적습니다. 질문형과 불만형을 섞습니다.\n"
    "- 문단에 없는 사실을 지어내지 않습니다.\n"
    "- 각 문장은 25자 이내로 적습니다.\n"
    '출력은 {"questions":["...", "..."]} 형식의 JSON만. 5개.')

SUMMARY_SYSTEM = (
    "당신은 판매자가 등록한 안내 문단을 읽고, 그 문단이 어떤 질문에 답할 수 있는지 한두 문장으로 적습니다.\n"
    "규칙: 문단에 없는 수치나 조건을 만들지 않습니다. 요약이 아니라 '무엇에 답할 수 있는가'를 적습니다.\n"
    '출력은 {"summary":"문자열"} 형식의 JSON만.')

# v2. The first version said "고객이 아무것도 묻지 않았다면 모든 문단은 거짓" to protect compliments,
# and measured -3 on complaints (N 6/7 -> 4/7) and -3 on natural questions: a customer who says
# 「배송이 너무 느려서 실망했습니다」 is not asking a question and the shipping policy is still the
# seller's answer. The rule that replaces it asks whether there is something to tell them.
ELIGIBILITY_SYSTEM = (
    "당신은 고객의 문장 하나와 후보 문단 여러 개를 받고, 각 문단이 그 문장에 답할 때 판매자가 인용할 "
    "사실을 실제로 담고 있는지 판정합니다.\n"
    "규칙:\n"
    "- 주제가 가깝다는 것만으로는 참이 아닙니다. 고객이 말한 바로 그 일에 대한 사실이 문단 안에 "
    "있어야 참입니다.\n"
    "- 고객이 질문하지 않고 불만이나 상황만 말했더라도, 그 일에 대해 안내할 사실이 문단에 있으면 "
    "참입니다.\n"
    "- 고객이 칭찬이나 인사만 남겨서 안내할 것이 없다면 거짓입니다.\n"
    '출력은 {"verdicts":[{"k":"키","supports":true|false}]} 형식의 JSON만.')


def do_intent():
    queries = json.load(open(f"{DIR}/queries.json"))
    out = load("intent.json", {})
    todo = [q for q in queries if q["text"] not in out]
    for i in range(0, len(todo), 8):
        batch = todo[i:i + 8]
        user = json.dumps([{"i": n, "text": q["text"]} for n, q in enumerate(batch)],
                          ensure_ascii=False)
        for item in chat(INTENT_SYSTEM, user)["items"]:
            intent = (item.get("intent") or "").strip()
            if intent:
                out[batch[item["i"]]["text"]] = intent
    save("intent.json", out)
    print(f"intent {len(out)}/{len(queries)} (empty = asks for nothing, arm falls back to raw)")


def do_passages(name, system, extract):
    passages = json.load(open(f"{DIR}/passages.json"))
    out = load(name, {})
    for key, passage in passages.items():
        if key in out:
            continue
        user = passage["title"] + "\n" + passage["content"]
        out[key] = extract(chat(system, user))
    save(name, out)
    print(f"{name} {len(out)}")


def do_eligibility():
    passages = json.load(open(f"{DIR}/passages.json"))
    queries = {q["id"]: q["text"] for q in json.load(open(f"{DIR}/queries.json"))}
    todo = json.load(open(f"{DIR}/eligibility-todo.json"))
    out = load("eligibility.json", {})
    calls = 0
    for query_id, keys in todo.items():
        keys = [k for k in keys if f"{query_id}|{k}" not in out]
        if not keys:
            continue
        user = json.dumps({
            "customer": queries[query_id],
            "passages": [{"k": k, "text": passages[k]["title"] + "\n" + passages[k]["content"]}
                         for k in keys]}, ensure_ascii=False)
        calls += 1
        for verdict in chat(ELIGIBILITY_SYSTEM, user)["verdicts"]:
            out[f"{query_id}|{verdict['k']}"] = bool(verdict["supports"])
    save("eligibility.json", out)
    kept = sum(1 for v in out.values() if v)
    print(f"eligibility {len(out)} judgements ({kept} kept, {len(out) - kept} dropped) in {calls} calls")


def do_embed():
    texts = set()
    for text in load("intent.json", {}).values():
        texts.add(text)
    for value in load("summary.json", {}).values():
        texts.add(value)
    for values in load("synthetic.json", {}).values():
        texts.update(values)
    shipped = json.load(open("backend/src/test/resources/retrieval-benchmark/vectors.json"))
    out = load("vectors-arms.json", {})
    todo = [t for t in sorted(texts)
            if hashlib.sha256(t.encode()).hexdigest()[:24] not in shipped
            and hashlib.sha256(t.encode()).hexdigest()[:24] not in out]
    for i in range(0, len(todo), 64):
        batch = todo[i:i + 64]
        payload = post("https://api.openai.com/v1/embeddings",
                       {"model": EMBED_MODEL, "input": batch, "dimensions": EMBED_DIMENSIONS})
        for item in payload["data"]:
            text = batch[item["index"]]
            key = hashlib.sha256(text.encode()).hexdigest()[:24]
            out[key] = base64.b64encode(
                struct.pack(f"<{len(item['embedding'])}f", *item["embedding"])).decode()
    save("vectors-arms.json", out)
    print(f"arm vectors {len(out)} (+{len(todo)} new)")


STEPS = {
    "intent": do_intent,
    "synthetic": lambda: do_passages("synthetic.json", SYNTHETIC_SYSTEM, lambda r: r["questions"]),
    "summary": lambda: do_passages("summary.json", SUMMARY_SYSTEM, lambda r: r["summary"]),
    "eligibility": do_eligibility,
    "embed": do_embed,
}
for step in sys.argv[1:] or sys.exit("usage: " + " | ".join(STEPS)):
    STEPS[step]()
