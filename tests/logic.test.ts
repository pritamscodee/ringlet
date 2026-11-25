import { describe, expect, test } from "bun:test";
import { SentenceChunker } from "../src/lib/voice/player";
import { searchKnowledge } from "../src/mastra/knowledge";

describe("sentence chunker", () => {
  test("emits the first clause early and later sentences whole", () => {
    const c = new SentenceChunker();
    const out: string[] = [];
    for (const piece of ["Sure thing, ", "I can help with that. ", "What day works ", "best for you? ", "Great"]) {
      out.push(...c.push(piece));
    }
    expect(out).toEqual(["Sure thing,", "I can help with that.", "What day works best for you?"]);
    expect(c.flush()).toBe("Great");
  });
});

describe("knowledge search", () => {
  test("ranks the relevant passage first", () => {
    const docs = [
      { title: "Hours", content: "We are open Monday to Friday, 9am to 6pm. Closed on weekends." },
      { title: "Pricing", content: "A standard cleaning costs 120 dollars. Whitening costs 300 dollars." },
    ];
    const hits = searchKnowledge(docs, "how much does whitening cost?");
    expect(hits[0].title).toBe("Pricing");
    expect(searchKnowledge(docs, "the and of")).toEqual([]);
  });
});
