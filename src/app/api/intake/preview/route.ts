import { fail, handle, ok } from "@/lib/api/http";
import { classifyDocument, inferCase } from "@/lib/intake/classify";
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
      const documents = extracted.map((e) => ({ ...classifyDocument(e.filename, e.text), truncated: e.truncated }));
      return ok({ documents, inferred: inferCase(documents) });
    } catch (err) {
      if (err instanceof IntakeError) return fail(err.message, 422);
      throw err;
    }
  });
}
