/**
 * Model adapter layer. The front end talks to every vision-language model through one typed contract;
 * choosing a different model never changes application logic.
 *
 * The request that leaves the browser is an allow-list of four fields: a model id, image data URLs, the
 * question text and the admissible answer words. There is no field through which scene coordinates,
 * camera poses, seeds, visibility fractions or gold labels could travel, and the adapter is never handed
 * a Scene or a Question object. The server validates the same allow-list again.
 *
 * Nothing here fabricates output: an unavailable model produces an error that the UI shows as such.
 */
import { normalizeAnswer } from './parse';

export interface SpatialVLMAdapter {
  id: string;
  label: string;
  capabilities: { image: boolean; multiImage: boolean; video?: boolean; localInference: boolean };
  predict(input: {
    /** PNG / JPEG data URLs of clean viewer renders (no overlays). */
    images: string[];
    question: string;
    taskType: string;
    options: string[];
    generation?: { maxNewTokens?: number; temperature?: number };
  }, signal?: AbortSignal): Promise<{
    answer: string;
    normalizedAnswer?: string;
    latencyMs?: number;
    modelRevision?: string;
    rawOutput?: string;
    prompt?: string;
    promptTokens?: number;
    quantization?: string;
    licenseNotice?: string | null;
  }>;
}

/** One row of GET /models: the registry entry plus availability probed from the runtime. */
export interface ModelInfo {
  id: string;
  label: string;
  role: 'student-base' | 'student-base-quantized' | 'student-tuned' | 'teacher' | 'student-alt';
  hf_id: string;
  params_millions: number;
  license: string;
  track: 'permissive' | 'research-nc';
  precision: string;
  how_to_get: string;
  available: boolean;
  unavailable_reason: string | null;
  revision: string | null;
  size_bytes: number | null;
  quantization: string | null;
  license_notice: string | null;
}

export interface ModelListing {
  runtime: { name: string; url: string; reachable: boolean };
  models: ModelInfo[];
}

export class ModelServerError extends Error {}

export async function fetchModels(server: string, signal?: AbortSignal): Promise<ModelListing> {
  let res: Response;
  try {
    res = await fetch(`${server}/models`, { signal });
  } catch {
    throw new ModelServerError(`The model server at ${server} is not running. Start it with "npm run model-server".`);
  }
  if (!res.ok) throw new ModelServerError(`The model server answered HTTP ${res.status}.`);
  return (await res.json()) as ModelListing;
}

/** The single choke point for what a model is sent. */
export function buildPredictRequest(modelId: string, images: string[], question: string, options: readonly string[], generation?: { maxNewTokens?: number; temperature?: number }) {
  return { model: modelId, images: [...images], question, options: [...options], ...(generation ? { generation } : {}) };
}

export function createServerAdapter(server: string, model: Pick<ModelInfo, 'id' | 'label'>): SpatialVLMAdapter {
  return {
    id: model.id,
    label: model.label,
    capabilities: { image: true, multiImage: true, video: false, localInference: true },
    async predict(input, signal) {
      let res: Response;
      try {
        res = await fetch(`${server}/predict`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildPredictRequest(model.id, input.images, input.question, input.options, input.generation)),
          signal,
        });
      } catch (e) {
        if ((e as Error).name === 'AbortError') throw e;
        throw new ModelServerError(`The model server at ${server} is not reachable. Start it with "npm run model-server".`);
      }
      const data = (await res.json()) as Record<string, unknown>;
      if (!res.ok) throw new ModelServerError(String(data.message ?? data.error ?? `HTTP ${res.status}`));
      const raw = String(data.rawOutput ?? '');
      return {
        answer: raw.trim(),
        normalizedAnswer: normalizeAnswer(raw, input.options) ?? undefined,
        rawOutput: raw,
        latencyMs: typeof data.latencyMs === 'number' ? data.latencyMs : undefined,
        modelRevision: typeof data.modelRevision === 'string' ? data.modelRevision : undefined,
        prompt: typeof data.prompt === 'string' ? data.prompt : undefined,
        promptTokens: typeof data.promptTokens === 'number' ? data.promptTokens : undefined,
        quantization: typeof data.quantization === 'string' ? data.quantization : undefined,
        licenseNotice: (data.licenseNotice as string | null) ?? null,
      };
    },
  };
}
