import { getAuth } from "@/lib/auth";
import { checkAnswer, askMessage, askSystem, newAskMarker } from "@/lib/ask/answer";
import { retrieve } from "@/lib/ask/retrieve";
import { parseScope } from "@/lib/ask/scope";
import { cacheKey, indexVersion, readCache, remember, writeCache } from "@/lib/ask/store";
import { GEMINI_ERROR_MESSAGES, streamContent } from "@/lib/ai/gemini";
import { takeAiCall } from "@/lib/ai/rate-limit";
import { getDb } from "@/lib/db";
import { currentAiConfig, effectiveEnv } from "@/lib/secrets/effective";
import { dailyLimit, release, reserve } from "@/lib/search/usage";

export const dynamic = "force-dynamic";

/**
 * « Demande à ta veille » (docs/design/3.3 § 4): one question, one answer, streamed as NDJSON events:
 *   meta → sources (found first) → delta… (text as written) → answer (checked) | empty | error.
 * Only reached by an explicit gesture (Enter on « Demander », a click). The extracts are articles only, never a
 * note. Stopping the request (« Arrêter ») stops the model. No text of the question or the answer is logged.
 */
export async function GET(request: Request) {
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session) return new Response(null, { status: 401 });
  const url = new URL(request.url);
  const params = Object.fromEntries([...new Set(url.searchParams.keys())].map((k) => [k, url.searchParams.getAll(k)]));
  const q = (url.searchParams.get("q") ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
  if (q.length < 3) return Response.json({ error: "Question trop courte." }, { status: 400 });
  const scope = parseScope(q, params);
  const db = getDb();
  const env = await effectiveEnv(db);
  const ai = await currentAiConfig(db);
  const signal = request.signal;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (event: object) => {
        try {
          controller.enqueue(enc.encode(`${JSON.stringify(event)}\n`));
        } catch {
          /* client gone */
        }
      };
      try {
        const historyId = await remember(db, session.user.id, q, new URLSearchParams(Object.entries({ periode: scope.period })).toString());
        send({ type: "meta", historyId, scope });

        const found = await retrieve(db, q, scope, { ai, env });
        const sources = found.extracts.map((e) => ({ n: e.n, topicId: e.topicId, title: e.title, forum: e.forum, sources: e.sources, at: e.at, read: e.read }));
        send({ type: "sources", sources, also: found.also, alsoTotal: found.alsoTotal, keywords: found.keywords, semantic: found.semantic });
        // Without sources, no answer: the model is not even called.
        if (!found.extracts.length) return send({ type: "empty", reason: "nosource" });
        if (!ai) return send({ type: "error", message: "Aucune clé Gemini configurée : les articles trouvés sont listés ci-dessous." });

        const key = cacheKey(q, scope, await indexVersion(db));
        const cached = await readCache(db, key);
        if (cached) return send({ type: "answer", answer: cached.answer, cached: true });

        const limit = takeAiCall(session.user.id);
        if (!limit.ok) return send({ type: "error", message: `Trop de demandes : réessaie dans ${limit.retryAfterSec} s.` });
        if ((await reserve(db, "ask", 1, dailyLimit("ask", env))) === 0) {
          return send({ type: "error", message: `Limite quotidienne de questions atteinte (${dailyLimit("ask", env)}). Réessaie demain : la recherche, elle, reste disponible.` });
        }

        const id = newAskMarker();
        let text = "";
        let failed: string | null = null;
        for await (const ev of streamContent({
          apiKey: ai.apiKey,
          model: ai.translateModel,
          system: askSystem(id),
          user: askMessage(q, found.extracts, id),
          maxOutputTokens: 1_200,
          temperature: 0.2,
          thinkingLevel: "low",
          signal,
        })) {
          if ("text" in ev) {
            text += ev.text;
            send({ type: "delta", text: ev.text });
          } else if ("error" in ev) {
            failed = signal.aborted ? null : GEMINI_ERROR_MESSAGES[ev.error];
            if (!failed) return;
            // The call was not made, or made nothing usable: the question is given back.
            if (!text) await release(db, "ask", 1);
            console.error(`[ask] génération en échec : ${ev.error}${ev.status ? ` (HTTP ${ev.status})` : ""}`);
          }
        }
        if (failed) return send({ type: "error", message: failed });
        const checked = checkAnswer(text, found.extracts.length);
        if (!checked) return send({ type: "empty", reason: "nocite" });
        await writeCache(db, key, { answer: checked, sources: found.extracts.map((e) => e.topicId) });
        send({ type: "answer", answer: checked, cached: false });
      } catch (err) {
        if (!signal.aborted) {
          console.error("[ask] question en échec :", (err as Error)?.name ?? "erreur");
          send({ type: "error", message: "La question n'a pas abouti : réessaie." });
        }
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
}
