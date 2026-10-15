export async function register() {
  // Boot the agent worker on server start (not while `next build` prerenders pages).
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NEXT_PHASE !== "phase-production-build") {
    const { boot } = await import("./lib/boot");
    boot();
  }
}
