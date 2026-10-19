import { generateText, Output, parsePartialJson, streamText } from "ai"
import { z } from "zod"
import type { Browser } from "#imports"
import type { BackgroundGenerateTextPayload } from "@/types/background-generate-text"
import type {
  BackgroundStreamPortName,
  BackgroundStreamSnapshot,
  BackgroundStreamStructuredObjectSerializablePayload,
  BackgroundStreamTextSerializablePayload,
  BackgroundStructuredObjectOutputField,
  BackgroundStructuredObjectStreamSnapshot,
  BackgroundTextStreamSnapshot,
  StartMessageParseResult,
  StreamPortHandler,
  StreamPortRequestMessage,
  StreamPortResponse,
  StreamPortResponseWithoutRequestId,
  StreamRuntimeOptions,
  ThinkingSnapshot,
} from "@/types/background-stream"
import { BACKGROUND_STREAM_PORTS } from "@/types/background-stream"
import { isLLMProviderConfig } from "@/types/config/provider"
import { selectionToolbarCustomActionOutputTypeSchema } from "@/types/config/selection-toolbar"
import { createStructuredObjectSchema } from "@/utils/ai/structured-object-schema"
import { extractAISDKErrorMessage } from "@/utils/error/extract-message"
import { logger } from "@/utils/logger"
import { buildLocalGenerateTextParams } from "@/utils/providers/generate-params"
import { getLanguageModelById, getLanguageModelForConfig } from "@/utils/providers/model"

const invalidStreamStartPayloadMessage = "Invalid stream start payload"
const aiStreamProtocolErrorMessage = "Invalid AI stream response."
const aiOutputValidationErrorMessage = "AI output does not match the expected format."
const aiOutputLengthLimitErrorMessage =
  "The AI output reached the length limit. Please reduce the requested output length and try again."

type AiStreamPart = Record<string, unknown> & { type: string }

function createStreamAbortError(message: string) {
  return new DOMException(message, "AbortError")
}

function isAbortLikeError(error: unknown) {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  )
}

const streamPortStartEnvelopeSchema = z.object({
  type: z.literal("start"),
  requestId: z.string().trim().min(1),
  payload: z.unknown(),
})

const streamTextPayloadSchema = z
  .object({
    providerId: z.string().trim().min(1),
  })
  .loose()

const structuredObjectFieldSchema = z.object({
  name: z.string().trim().min(1),
  type: selectionToolbarCustomActionOutputTypeSchema,
})

const structuredObjectPayloadSchema = z
  .object({
    providerId: z.string().trim().min(1),
    outputSchema: z.array(structuredObjectFieldSchema).min(1),
  })
  .loose()
  .superRefine((payload, ctx) => {
    const nameSet = new Set<string>()

    payload.outputSchema.forEach((field, index) => {
      if (nameSet.has(field.name)) {
        ctx.addIssue({
          code: "custom",
          message: `Duplicate output schema name "${field.name}".`,
          path: ["outputSchema", index, "name"],
        })
        return
      }
      nameSet.add(field.name)
    })
  })

function createStartMessageParser<TSerializablePayload>(payloadSchema: z.ZodTypeAny) {
  return (msg: unknown): StartMessageParseResult<TSerializablePayload> => {
    const envelopeResult = streamPortStartEnvelopeSchema.safeParse(msg)
    if (!envelopeResult.success) {
      return { success: false }
    }

    const payloadResult = payloadSchema.safeParse(envelopeResult.data.payload)
    if (!payloadResult.success) {
      return {
        success: false,
        requestId: envelopeResult.data.requestId,
      }
    }

    return {
      success: true,
      message: {
        type: "start",
        requestId: envelopeResult.data.requestId,
        payload: payloadResult.data as TSerializablePayload,
      },
    }
  }
}

function createStreamPortHandler<TSerializablePayload, TResponse>(
  streamFn: (
    serializablePayload: TSerializablePayload,
    options: StreamRuntimeOptions<TResponse>,
  ) => Promise<TResponse>,
  startMessageParser: (msg: unknown) => StartMessageParseResult<TSerializablePayload>,
) {
  return (port: Browser.runtime.Port) => {
    const abortController = new AbortController()
    let isActive = true
    let hasStarted = false
    let requestId: string | undefined
    let messageListener: ((rawMessage: unknown) => void) | undefined
    let disconnectListener: (() => void) | undefined

    const safePost = (response: StreamPortResponseWithoutRequestId<TResponse>) => {
      if (!isActive || abortController.signal.aborted || !requestId) {
        return
      }
      try {
        const message: StreamPortResponse<TResponse> = {
          ...response,
          requestId,
        }
        port.postMessage(message)
      } catch (error) {
        logger.error("[Background] Stream port post failed", error)
      }
    }

    const cleanup = () => {
      if (!isActive) {
        return
      }
      isActive = false
      if (messageListener) {
        port.onMessage.removeListener(messageListener)
      }
      if (disconnectListener) {
        port.onDisconnect.removeListener(disconnectListener)
      }
    }

    disconnectListener = () => {
      abortController.abort(createStreamAbortError("stream port disconnected"))
      cleanup()
    }

    messageListener = async (rawMessage: unknown) => {
      const requestMessage = rawMessage as
        | StreamPortRequestMessage<TSerializablePayload>
        | undefined
      if (requestMessage?.type === "ping") {
        return
      }

      if (hasStarted) {
        return
      }

      const parseResult = startMessageParser(rawMessage)
      if (!parseResult.success) {
        if (parseResult.requestId) {
          requestId = parseResult.requestId
          safePost({
            type: "error",
            error: { message: invalidStreamStartPayloadMessage },
          })
        }

        cleanup()
        try {
          port.disconnect()
        } catch {
          // The port may already be closed due to a race with onDisconnect.
          // This is expected during cleanup and safe to ignore.
        }
        return
      }

      const startMessage = parseResult.message
      requestId = startMessage.requestId
      hasStarted = true
      let streamError: unknown

      try {
        const result = await streamFn(startMessage.payload, {
          signal: abortController.signal,
          onChunk: (snapshot) => {
            safePost({ type: "chunk", data: snapshot })
          },
          onError: (error) => {
            if (streamError === undefined) {
              streamError = error
            }
          },
        })

        if (streamError !== undefined) {
          throw streamError instanceof Error
            ? new Error(streamError.message, { cause: streamError })
            : new Error(typeof streamError === "string" ? streamError : "Unknown stream error")
        }

        if (!abortController.signal.aborted) {
          safePost({ type: "done", data: result })
        }
      } catch (error) {
        const finalError = streamError ?? error
        if (abortController.signal.aborted || isAbortLikeError(finalError)) {
          return
        }

        logger.error("[Background] Stream Function failed", finalError)
        safePost({ type: "error", error: { message: extractAISDKErrorMessage(finalError) } })
      } finally {
        cleanup()
        try {
          port.disconnect()
        } catch {
          // The port may already be closed due to a race with onDisconnect.
          // This is expected during cleanup and safe to ignore.
        }
      }
    }

    port.onMessage.addListener(messageListener)
    port.onDisconnect.addListener(disconnectListener)
  }
}

function createStreamSnapshot<TOutput>(
  output: TOutput,
  thinking: ThinkingSnapshot,
): BackgroundStreamSnapshot<TOutput> {
  return {
    output: output !== null && typeof output === "object" ? { ...output } : output,
    thinking: { ...thinking },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

class BackgroundStreamError extends Error {
  constructor(
    readonly code: string,
    message: string,
    options?: { cause?: unknown; retryAfterMs?: number },
  ) {
    super(message, { cause: options?.cause })
    this.retryAfterMs = options?.retryAfterMs
  }

  readonly retryAfterMs?: number
}

function toAiStreamPart(part: unknown): AiStreamPart {
  if (!isRecord(part) || typeof part.type !== "string" || part.type.trim().length === 0) {
    throw new BackgroundStreamError("stream_protocol_error", aiStreamProtocolErrorMessage)
  }

  return part as AiStreamPart
}

function getStringPartField(part: Record<string, unknown>, field: string): string {
  const value = part[field]
  if (typeof value !== "string") {
    throw new BackgroundStreamError("stream_protocol_error", aiStreamProtocolErrorMessage)
  }

  return value
}

function getStreamPartError(part: Record<string, unknown>): unknown {
  return "error" in part
    ? part.error
    : new BackgroundStreamError("stream_protocol_error", aiStreamProtocolErrorMessage)
}

function getStreamFinishReason(part: Record<string, unknown>): string | undefined {
  return typeof part.finishReason === "string" ? part.finishReason : undefined
}

/**
 * Reasoning is over once the answer starts coming out, so the first output delta
 * closes the thinking phase. Models that emit no reasoning at all never send
 * `reasoning-end`, and without this they would stay "thinking" for the whole
 * stream while their output is already rendering. Models that interleave need no
 * special case: a later `reasoning-delta` reopens the phase on its own.
 */
function endThinkingOnOutput(thinking: ThinkingSnapshot): ThinkingSnapshot {
  return thinking.status === "thinking" ? { ...thinking, status: "complete" } : thinking
}

function validateFinishedStream(hasFinish: boolean, finishReason: string | undefined): void {
  if (!hasFinish) {
    throw new BackgroundStreamError("stream_protocol_error", aiStreamProtocolErrorMessage)
  }

  if (finishReason === "length") {
    throw new BackgroundStreamError("output_validation_failed", aiOutputLengthLimitErrorMessage)
  }
}

interface ConsumedPartStream<TValue> {
  /** Full accumulated stream text after every text delta. */
  cumulativeText: string
  /** The value the stream's snapshots last presented. */
  value: TValue
  /** Thinking snapshot with the status forced to "complete". */
  thinking: ThinkingSnapshot
}

/**
 * The single part loop both background streams walk: reasoning / finish /
 * error handling is identical for text and structured-object streams, and
 * only what a `text-delta` does with the accumulated text differs, which
 * `onTextDelta` owns. It receives the accumulated text with the thinking phase
 * already closed (the answer started), returns the value the stream now
 * presents, and calls `emit` to push an intermediate snapshot when one is due.
 */
async function consumePartStream<TValue>(
  partStream: AsyncIterable<unknown>,
  options: {
    signal?: AbortSignal
    onChunk?: (snapshot: BackgroundStreamSnapshot<TValue>) => void
    initialValue: TValue
    onTextDelta: (text: string, emit: (value: TValue) => void) => TValue | Promise<TValue>
  },
): Promise<ConsumedPartStream<TValue>> {
  const { signal, onChunk, initialValue, onTextDelta } = options
  let cumulativeText = ""
  let value = initialValue
  let thinking: ThinkingSnapshot = {
    status: "thinking",
    text: "",
  }
  let hasFinish = false
  let finishReason: string | undefined

  for await (const rawPart of partStream) {
    if (signal?.aborted) {
      throw new DOMException("stream aborted", "AbortError")
    }

    const part = toAiStreamPart(rawPart)
    switch (part.type) {
      case "text-delta": {
        cumulativeText += getStringPartField(part, "text")
        thinking = endThinkingOnOutput(thinking)
        value = await onTextDelta(cumulativeText, (emitted) => {
          onChunk?.(createStreamSnapshot(emitted, thinking))
        })
        break
      }
      case "reasoning-start": {
        thinking = {
          ...thinking,
          status: "thinking",
        }
        break
      }
      case "reasoning-delta": {
        thinking = {
          status: "thinking",
          text: thinking.text + getStringPartField(part, "text"),
        }
        onChunk?.(createStreamSnapshot(value, thinking))
        break
      }
      case "reasoning-end": {
        thinking = {
          ...thinking,
          status: "complete",
        }
        onChunk?.(createStreamSnapshot(value, thinking))
        break
      }
      case "reasoning-file": {
        break
      }
      case "finish": {
        hasFinish = true
        finishReason = getStreamFinishReason(part)
        break
      }
      case "error": {
        throw getStreamPartError(part)
      }
      default: {
        break
      }
    }
  }

  validateFinishedStream(hasFinish, finishReason)

  return {
    cumulativeText,
    value,
    thinking: {
      ...thinking,
      status: "complete",
    },
  }
}

async function consumeTextPartStream(
  partStream: AsyncIterable<unknown>,
  options: {
    onChunk?: StreamRuntimeOptions<BackgroundTextStreamSnapshot>["onChunk"]
    signal?: AbortSignal
  },
): Promise<BackgroundTextStreamSnapshot> {
  const { value, thinking } = await consumePartStream<string>(partStream, {
    signal: options.signal,
    onChunk: options.onChunk,
    initialValue: "",
    onTextDelta: (text, emit) => {
      emit(text)
      return text
    },
  })

  return createStreamSnapshot(value, thinking)
}

async function consumeStructuredObjectPartStream<TOutput extends Record<string, unknown>>(
  partStream: AsyncIterable<unknown>,
  options: {
    objectSchema: z.ZodType<TOutput>
    onChunk?: StreamRuntimeOptions<BackgroundStructuredObjectStreamSnapshot>["onChunk"]
    signal?: AbortSignal
  },
): Promise<BackgroundStreamSnapshot<TOutput>> {
  const { objectSchema, onChunk, signal } = options
  let cumulativeValue: Record<string, unknown> = {}

  const { cumulativeText, thinking } = await consumePartStream<Record<string, unknown>>(
    partStream,
    {
      signal,
      onChunk,
      initialValue: {},
      onTextDelta: async (text, emit) => {
        // A delta only reaches the UI when its JSON parses into an object:
        // mid-fragment deltas are kept until the next one completes them.
        const partial = await parsePartialJson(text)
        if (isRecord(partial.value)) {
          cumulativeValue = { ...cumulativeValue, ...partial.value }
          emit(cumulativeValue)
        }
        return cumulativeValue
      },
    },
  )

  try {
    const finalJson = await parsePartialJson(cumulativeText)
    const finalValue = objectSchema.parse(finalJson.value)
    return createStreamSnapshot(finalValue, thinking)
  } catch (error) {
    throw new BackgroundStreamError("output_validation_failed", aiOutputValidationErrorMessage, {
      cause: error,
    })
  }
}

/**
 * One streamText call against the provider registry, for the background port
 * handlers. The structured-object variant is the same call with an `output`
 * schema attached — pass `objectSchema` to get it.
 */
async function createLocalPartStream<
  TOutput extends Record<string, unknown> = Record<string, unknown>,
>(
  serializablePayload: BackgroundStreamTextSerializablePayload & {
    outputSchema?: BackgroundStructuredObjectOutputField[]
  },
  options: {
    signal?: AbortSignal
    onError?: StreamRuntimeOptions<BackgroundTextStreamSnapshot>["onError"]
  } = {},
  objectSchema?: z.ZodType<TOutput>,
): Promise<AsyncIterable<unknown>> {
  const { providerId, outputSchema: _outputSchema, ...streamTextParams } = serializablePayload
  const { signal, onError } = options

  const model = await getLanguageModelById(providerId)
  const result = streamText({
    ...(streamTextParams as Parameters<typeof streamText>[0]),
    model,
    ...(objectSchema ? { output: Output.object({ schema: objectSchema }) } : {}),
    abortSignal: signal,
    onError: ({ error }) => {
      onError?.(error)
    },
  })

  return result.stream
}

/**
 * One text generation against the provider config, collected into a string.
 *
 * Four callers are non-streaming `generateText` calls — the page summary, the
 * video summary, subtitle segmentation, and language detection.
 */
export async function generateTextForProviderRef(
  payload: BackgroundGenerateTextPayload,
  options: { signal?: AbortSignal } = {},
): Promise<string> {
  const { providerRef, instructions, prompt, maxRetries } = payload
  const { signal } = options

  if (signal?.aborted) {
    throw new DOMException("stream aborted", "AbortError")
  }

  // Text generation needs a real LLM: pure translate providers (DeepLX,
  // Google, Microsoft) have no model to prompt. Callers already pick an
  // LLM-capable provider, so this is a guard, not a branch.
  if (!isLLMProviderConfig(providerRef.config)) {
    throw new BackgroundStreamError(
      "invalid_request",
      `Provider "${providerRef.config.id}" cannot generate text`,
    )
  }

  // Built from the config the ref carries, not looked up by id: every other
  // parameter below already comes from the ref, so re-reading storage would
  // pair a model from the current row with reasoning/temperature/providerOptions
  // computed from the snapshot the caller captured — and would fail outright
  // for a row deleted from another tab while the config was already in hand.
  const model = await getLanguageModelForConfig(providerRef.config)
  const { text } = await generateText({
    model,
    instructions,
    prompt,
    // maxRetries: 0 — retries belong to the RequestQueue, which meters them
    // against the token bucket; ai-sdk's hidden default (2) would issue extra
    // HTTP attempts invisible to the rate limiter.
    maxRetries: maxRetries ?? 0,
    abortSignal: signal,
    ...buildLocalGenerateTextParams(providerRef.config),
  })
  return text.trim()
}

async function runBackgroundStream<TSnapshot>(
  serializablePayload: BackgroundStreamTextSerializablePayload & {
    outputSchema?: BackgroundStructuredObjectOutputField[]
  },
  options: StreamRuntimeOptions<TSnapshot> = {},
  mode: {
    objectSchema?: z.ZodType<Record<string, unknown>>
    consumePartStream: (
      partStream: AsyncIterable<unknown>,
      options: { signal?: AbortSignal; onChunk?: StreamRuntimeOptions<TSnapshot>["onChunk"] },
    ) => Promise<TSnapshot>
  },
): Promise<TSnapshot> {
  const { signal, onChunk } = options

  if (signal?.aborted) {
    throw new DOMException("stream aborted", "AbortError")
  }

  const partStream = await createLocalPartStream(serializablePayload, options, mode.objectSchema)

  return mode.consumePartStream(partStream, { onChunk, signal })
}

const BACKGROUND_STREAM_PORT_HANDLERS: Readonly<
  Record<BackgroundStreamPortName, StreamPortHandler>
> = {
  [BACKGROUND_STREAM_PORTS.streamText]: createStreamPortHandler<
    BackgroundStreamTextSerializablePayload,
    BackgroundTextStreamSnapshot
  >(
    (serializablePayload, options) =>
      runBackgroundStream(serializablePayload, options, {
        consumePartStream: consumeTextPartStream,
      }),
    createStartMessageParser<BackgroundStreamTextSerializablePayload>(streamTextPayloadSchema),
  ),
  [BACKGROUND_STREAM_PORTS.streamStructuredObject]: createStreamPortHandler<
    BackgroundStreamStructuredObjectSerializablePayload,
    BackgroundStructuredObjectStreamSnapshot
  >((serializablePayload, options) => {
    const objectSchema = createStructuredObjectSchema(serializablePayload.outputSchema)
    return runBackgroundStream(serializablePayload, options, {
      objectSchema,
      consumePartStream: (partStream, consumeOptions) =>
        consumeStructuredObjectPartStream(partStream, { ...consumeOptions, objectSchema }),
    })
  }, createStartMessageParser<BackgroundStreamStructuredObjectSerializablePayload>(
    structuredObjectPayloadSchema,
  )),
}

export function dispatchBackgroundStreamPort(port: Browser.runtime.Port): boolean {
  const handler = BACKGROUND_STREAM_PORT_HANDLERS[port.name as BackgroundStreamPortName]
  if (!handler) {
    return false
  }

  handler(port)
  return true
}
