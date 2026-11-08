type Doc = { title: string; content: string };

/** Knowledge under this size is placed straight into the prompt (no tool round-trip). */
export const INLINE_KNOWLEDGE_LIMIT = 6000;

export function knowledgeSize(docs: Doc[]) {
  return docs.reduce((n, d) => n + d.title.length + d.content.length, 0);
}

export function inlineKnowledge(docs: Doc[]) {
  return docs.map((d) => `### ${d.title}\n${d.content.trim()}`).join("\n\n");
}

const STOP = new Set(
  "a an and are as at be but by do does for from how i in is it me my of on or our so that the this to was we what when where which who why will with you your".split(
    " ",
  ),
);


function terms(text: string) {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

/** Splits docs into ~800 character passages on paragraph boundaries. */
function chunk(docs: Doc[]) {
  const out: { title: string; text: string }[] = [];
  for (const d of docs) {
    let buf = "";
    for (const para of d.content.split(/\n\s*\n/)) {
      if (buf && buf.length + para.length > 800) {
        out.push({ title: d.title, text: buf.trim() });
        buf = "";
      }
      buf += `${para}\n\n`;
    }
    if (buf.trim()) out.push({ title: d.title, text: buf.trim() });
  }
  return out;
}

/** Keyword (BM25-lite) search over an agent's knowledge sources. */
export function searchKnowledge(docs: Doc[], query: string, limit = 3) {
  const passages = chunk(docs);
  const q = [...new Set(terms(query))];
  if (!q.length || !passages.length) return [];
  const tokenized = passages.map((p) => terms(`${p.title} ${p.text}`));
  const avgLen = tokenized.reduce((n, t) => n + t.length, 0) / tokenized.length;
  const df = new Map<string, number>();
  for (const t of q) df.set(t, tokenized.filter((toks) => toks.includes(t)).length);

  return passages
    .map((p, i) => {
      const toks = tokenized[i];
      let score = 0;
      for (const t of q) {
        const tf = toks.filter((x) => x === t).length;
        if (!tf) continue;
        const idf = Math.log(1 + (passages.length - df.get(t)! + 0.5) / (df.get(t)! + 0.5));
        score += (idf * tf * 2.2) / (tf + 1.2 * (0.25 + 0.75 * (toks.length / avgLen)));
      }
      return { ...p, score };
    })
    .filter((p) => p.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
