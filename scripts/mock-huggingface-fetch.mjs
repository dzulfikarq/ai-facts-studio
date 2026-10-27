import { appendFileSync, readFileSync } from "node:fs";

const model = process.env.HF_IMAGE_MODEL || "stabilityai/stable-diffusion-3-medium-diffusers";
const originalFetch = globalThis.fetch.bind(globalThis);
const record = (value) => { if (process.env.MOCK_HF_LOG_PATH) appendFileSync(process.env.MOCK_HF_LOG_PATH, `${JSON.stringify(value)}\n`); };

globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (url.startsWith("https://huggingface.co/api/models?")) {
    record({ type: "catalog" });
    return new Response(JSON.stringify([{ id: model, tags: ["license:other"], inferenceProviderMapping: [{ provider: "hf-inference", status: "live", task: "text-to-image" }] }]), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (url.startsWith("https://router.huggingface.co/hf-inference/models/")) {
    const authorized = new Headers(init?.headers).get("authorization") === `Bearer ${process.env.HF_TOKEN}`;
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
    record({ type: "generate", authorized, prompt: body.inputs, parameters: body.parameters });
    if (!authorized) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "content-type": "application/json" } });
    const image = readFileSync(process.env.MOCK_HF_IMAGE_PATH);
    return new Response(image, { status: 200, headers: { "content-type": "image/png", "x-compute-time": "0.001", "x-rate-limit-remaining": "unknown" } });
  }
  if (url.startsWith("https://")) throw new Error(`Unexpected outbound request in mock smoke: ${url}`);
  return originalFetch(input, init);
};
