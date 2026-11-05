/**
 * Claude API calls made directly from the browser with the learner's own API key.
 * This module is loaded lazily so the SDK stays out of the main bundle.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { BetaContentBlock, BetaMessageParam } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { CARD_SET_SCHEMA, SYSTEM_PROMPT, normalizeOutput, type AiOutput } from './prompt';
import { estimateCost, getAiModel, type AiUsage } from './models';

export type AiErrorCode =
  | 'no_key'
  | 'auth'
  | 'permission'
  | 'billing'
  | 'rate_limit'
  | 'overloaded'
  | 'network'
  | 'refusal'
  | 'max_tokens'
  | 'bad_output'
  | 'aborted'
  | 'api';

export class AiError extends Error {
  constructor(
    public code: AiErrorCode,
    message: string = code,
  ) {
    super(message);
  }
}

const MAX_TOKENS = 32000;
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

/** Set after the API rejects the fallbacks parameter once, so we stop sending it this session. */
let fallbacksUnsupported = false;

function client(apiKey: string) {
  // The key belongs to the learner and never leaves their device except to api.anthropic.com.
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 });
}

function toAiError(e: unknown): AiError {
  if (e instanceof AiError) return e;
  if (e instanceof Anthropic.APIUserAbortError) return new AiError('aborted');
  if (e instanceof Anthropic.AuthenticationError) return new AiError('auth', e.message);
  if (e instanceof Anthropic.PermissionDeniedError) return new AiError('permission', e.message);
  if (e instanceof Anthropic.RateLimitError) return new AiError('rate_limit', e.message);
  if (e instanceof Anthropic.APIConnectionError) return new AiError('network', e.message);
  if (e instanceof Anthropic.APIError) {
    const type = (e as { type?: string }).type;
    if (e.status === 402 || type === 'billing_error') return new AiError('billing', e.message);
    if (e.status === 529 || type === 'overloaded_error') return new AiError('overloaded', e.message);
    return new AiError('api', e.message);
  }
  return new AiError('api', e instanceof Error ? e.message : String(e));
}

/** Cheap credential check: fetching a model's metadata needs a valid key and costs nothing. */
export async function testApiKey(apiKey: string, model: string): Promise<void> {
  if (!apiKey.trim()) throw new AiError('no_key');
  try {
    await client(apiKey.trim()).models.retrieve(model);
  } catch (e) {
    throw toAiError(e);
  }
}

export interface TurnProgress {
  /** Cards written so far in the streamed JSON. */
  cards: number;
  /** The "reply" text streamed so far. */
  reply: string;
}

export interface TurnResult {
  output: AiOutput;
  /** Assistant content exactly as returned, replayed unchanged in later turns. */
  content: BetaContentBlock[];
  usage: AiUsage;
}

const REPLY_RE = /"reply"\s*:\s*"((?:[^"\\]|\\.)*)/;

export function partialReply(json: string): string {
  const m = REPLY_RE.exec(json);
  if (!m) return '';
  try {
    return JSON.parse(`"${m[1].replace(/\\$/, '')}"`) as string;
  } catch {
    return m[1];
  }
}

export function countStreamedCards(json: string): number {
  const at = json.indexOf('"cards"');
  if (at < 0) return 0;
  return (json.slice(at).match(/"type"\s*:/g) ?? []).length;
}

export async function runTurn(opts: {
  apiKey: string;
  model: string;
  messages: BetaMessageParam[];
  signal?: AbortSignal;
  onProgress?: (p: TurnProgress) => void;
}): Promise<TurnResult> {
  if (!opts.apiKey.trim()) throw new AiError('no_key');
  const model = getAiModel(opts.model);
  const api = client(opts.apiKey.trim());

  const attempt = async (withFallbacks: boolean) => {
    const stream = api.beta.messages.stream(
      {
        model: model.id,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        messages: opts.messages,
        cache_control: { type: 'ephemeral' },
        thinking: { type: 'adaptive' },
        output_config: { effort: 'medium', format: { type: 'json_schema', schema: CARD_SET_SCHEMA as unknown as Record<string, unknown> } },
        ...(withFallbacks ? { betas: [FALLBACK_BETA], fallbacks: 'default' as const } : {}),
      },
      { signal: opts.signal },
    );
    stream.on('text', (_delta, snapshot) => opts.onProgress?.({ cards: countStreamedCards(snapshot), reply: partialReply(snapshot) }));
    return stream.finalMessage();
  };

  let message;
  const useFallbacks = model.fallbacks && !fallbacksUnsupported;
  try {
    message = await attempt(useFallbacks);
  } catch (e) {
    // A 400 when we asked for fallbacks most likely means this account/model does not offer them: retry plain once.
    if (useFallbacks && e instanceof Anthropic.BadRequestError) {
      fallbacksUnsupported = true;
      try {
        message = await attempt(false);
      } catch (e2) {
        throw toAiError(e2);
      }
    } else {
      throw toAiError(e);
    }
  }

  const u = message.usage;
  const usageBase = {
    input: u.input_tokens ?? 0,
    output: u.output_tokens ?? 0,
    cacheRead: u.cache_read_input_tokens ?? 0,
    cacheWrite: u.cache_creation_input_tokens ?? 0,
  };
  const usage: AiUsage = { model: model.id, ...usageBase, costUsd: estimateCost(model.id, usageBase) };

  // Check why generation stopped before reading content.
  if (message.stop_reason === 'refusal') {
    const details = message.stop_details as { explanation?: string | null } | null | undefined;
    throw Object.assign(new AiError('refusal', details?.explanation ?? 'refusal'), { usage });
  }
  if (message.stop_reason === 'max_tokens') throw Object.assign(new AiError('max_tokens'), { usage });

  const text = message.content
    .filter((b): b is Extract<BetaContentBlock, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join('');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw Object.assign(new AiError('bad_output', text.slice(0, 200)), { usage });
  }
  const output = normalizeOutput(parsed);
  if (!output) throw Object.assign(new AiError('bad_output', text.slice(0, 200)), { usage });
  return { output, content: message.content, usage };
}
