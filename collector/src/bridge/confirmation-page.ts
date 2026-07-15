/**
 * **Agent-owned local confirmation page (pure).** Served by the bridge over loopback so the human confirms
 * a pairing ON THE DEVICE (slice §0.2/§Phase C). It shows the requesting SellerOps origin, the workspace
 * display context, and a short human-verifiable confirmation code the user cross-checks against the number
 * shown in SellerOps, then Allow/Deny. This is the local trust step that prevents ambient-localhost pairing.
 *
 * All interpolated values are HTML-escaped — origin/workspace are untrusted request inputs. The page never
 * contains a pairing secret or ticket; only the short-lived `requestId` and the confirmation code.
 */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface ConfirmationPageInput {
  requestId: string;
  origin: string;
  workspaceLabel: string;
  confirmationCode: string;
  /**
   * Does `allow` require the out-of-band approval code? When true the page collects it from the human, who
   * reads it off the AGENT'S OWN CONSOLE. The code itself is deliberately NOT an input to this renderer —
   * this page is fetchable by anyone holding the (public) `requestId`, so it must never contain the secret.
   */
  approvalRequired: boolean;
}

export function renderConfirmationPage(input: ConfirmationPageInput): string {
  const origin = escapeHtml(input.origin);
  const workspace = escapeHtml(input.workspaceLabel);
  const code = escapeHtml(input.confirmationCode);
  const requestId = escapeHtml(input.requestId);
  const approvalField = input.approvalRequired
    ? `  <p class="meta">에이전트를 실행한 터미널에 표시된 <strong>승인 코드</strong>를 입력하세요.</p>
  <input class="approval" id="approval" inputmode="latin" autocomplete="off" spellcheck="false" placeholder="XXXX-XXXX" aria-label="승인 코드">`
    : "";
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>SellerOps 로컬 에이전트 연결 확인</title>
<style>
  body { font-family: -apple-system, "Apple SD Gothic Neo", sans-serif; max-width: 32rem; margin: 3rem auto; padding: 0 1.25rem; color: #1a1a1a; }
  .card { border: 1px solid #e2e2e2; border-radius: 12px; padding: 1.5rem; }
  h1 { font-size: 1.2rem; }
  .code { font-size: 1.8rem; letter-spacing: .15em; font-weight: 700; margin: 1rem 0; padding: .75rem 1rem; background: #f4f6f8; border-radius: 8px; text-align: center; }
  .approval { width: 100%; box-sizing: border-box; font-size: 1.4rem; letter-spacing: .12em; text-align: center; text-transform: uppercase; padding: .7rem 1rem; border: 1px solid #cfd4da; border-radius: 8px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .meta { font-size: .95rem; color: #444; margin: .35rem 0; word-break: break-all; }
  .actions { display: flex; gap: .75rem; margin-top: 1.5rem; }
  button { flex: 1; padding: .8rem 1rem; font-size: 1rem; border-radius: 8px; border: 0; cursor: pointer; }
  .allow { background: #1f6feb; color: #fff; }
  .deny { background: #f4f6f8; color: #1a1a1a; }
  .result { margin-top: 1.25rem; font-size: 1rem; }
</style></head>
<body><div class="card">
  <h1>이 기기의 SellerOps 연결을 허용하시겠어요?</h1>
  <p class="meta">요청한 SellerOps 주소: <strong>${origin}</strong></p>
  <p class="meta">워크스페이스: <strong>${workspace}</strong></p>
  <p class="meta">아래 확인 코드가 SellerOps 화면의 코드와 같은지 확인하세요.</p>
  <div class="code">${code}</div>
${approvalField}
  <div class="actions">
    <button class="allow" id="allow">허용</button>
    <button class="deny" id="deny">거부</button>
  </div>
  <div class="result" id="result"></div>
</div>
<script>
  const requestId = ${JSON.stringify(requestId)};
  const approvalRequired = ${JSON.stringify(input.approvalRequired)};
  async function decide(decision) {
    const approvalEl = document.getElementById('approval');
    const approvalCode = approvalEl ? approvalEl.value : '';
    if (decision === 'allow' && approvalRequired && !approvalCode.trim()) {
      document.getElementById('result').textContent = '터미널에 표시된 승인 코드를 입력하세요.';
      return;
    }
    document.getElementById('allow').disabled = true;
    document.getElementById('deny').disabled = true;
    try {
      const r = await fetch('/bridge/pair/confirm', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId, decision, approvalCode })
      });
      const ok = r.ok;
      if (decision === 'allow' && !ok) {
        // Wrong/expired code — let the human retry. Attempts are bounded server-side; once they run out the
        // request is burned and every further attempt fails, which is the intended terminal state.
        document.getElementById('allow').disabled = false;
        document.getElementById('deny').disabled = false;
        document.getElementById('result').textContent = approvalRequired
          ? '승인 코드가 올바르지 않거나 요청이 만료되었습니다. 다시 확인해 주세요.'
          : '허용에 실패했습니다. 다시 시도해 주세요.';
        return;
      }
      document.getElementById('result').textContent = decision === 'allow'
        ? '연결을 허용했습니다. 이 창을 닫아도 됩니다.'
        : '연결을 거부했습니다. 이 창을 닫아도 됩니다.';
    } catch (e) {
      document.getElementById('result').textContent = '처리 중 문제가 발생했습니다.';
    }
  }
  document.getElementById('allow').addEventListener('click', () => decide('allow'));
  document.getElementById('deny').addEventListener('click', () => decide('deny'));
</script>
</body></html>`;
}
