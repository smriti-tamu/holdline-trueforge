// Keep local starts deterministic while honoring Railway's injected PORT.
process.env.NITRO_HOST ??= "0.0.0.0";
process.env.PORT ??= "8080";

await import("../.output/server/index.mjs");
