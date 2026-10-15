import { fail, handle, ok } from "@/lib/api/http";
import { getLlm } from "@/lib/agents/llm";
import { classifyDocument, inferCase } from "@/lib/intake/classify";
import { inferWithClaude, needsClaude, type PreviewDoc } from "@/lib/intake/claude-infer";
import { extractFile, IntakeError, MAX_FILES } from "@/lib/intake/extract";

/** Extracts, classifies and summarises uploaded files. Writes nothing: the client confirms first. */
export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail("Expected a multipart upload", 400);
  }
  const files = form.getAll("files").filter((f): f is File => typeof f !== "string");
  return handle(async () => {
    if (files.length === 0) return fail("Add at least one document", 400);
    if (files.length > MAX_FILES) return fail(`Upload at most ${MAX_FILES} documents at a time`, 400);
    try {
      const extracted = await Promise.all(files.map(async (f) => extractFile(f.name, new Uint8Array(await f.arrayBuffer()))));
      const classified = extracted.map((e) => classifyDocument(e.filename, e.text));
      const rules = inferCase(classified);
      const truncated = (i: number) => extracted[i].truncated;
      const llm = getLlm();
      let result: { documents: PreviewDoc[]; inferred: typeof rules } = { documents: classified.map((d) => ({ ...d, readBy: "rules" })), inferred: rules };
      let warning: string | null = null;
      if (llm && needsClaude(classified, rules)) {
        try {
          result = await inferWithClaude(llm, classified, rules);
        } catch (err) {
          console.error("[intake] Claude inference failed; using rules only", err);
          warning = "Claude couldn't read these documents just now, so some details may need filling in by hand.";
        }
      }
      return ok({ documents: result.documents.map((d, i) => ({ ...d, truncated: truncated(i) })), inferred: result.inferred, warning });
    } catch (err) {
      if (err instanceof IntakeError) return fail(err.message, 422);
      throw err;
    }
  });
}
