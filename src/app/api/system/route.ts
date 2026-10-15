import { connection } from "next/server";
import { handle, ok } from "@/lib/api/http";
import { systemStatus } from "@/lib/api/views";

export async function GET() {
  await connection();
  return handle(async () => ok(await systemStatus()));
}
