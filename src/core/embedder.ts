const OLLAMA_HOST = (process.env.OLLAMA_HOST || "http://localhost:11434").replace(/\/+$/, "")

interface OllamaEmbedResponse {
  embedding: number[]
}

interface OllamaChatResponse {
  message: { content: string }
}

interface OllamaTagsResponse {
  models: { name: string }[]
}

async function ollamaFetch(path: string, body?: unknown, timeoutMs = 30000): Promise<Response> {
  const url = `${OLLAMA_HOST}${path}`
  let lastErr: Error | undefined

  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt))
    }

    const opts: RequestInit = {
      method: body ? "POST" : "GET",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    }
    if (timeoutMs > 0) opts.signal = AbortSignal.timeout(timeoutMs)

    try {
      const res = await fetch(url, opts)
      if (res.ok) return res

      const text = await res.text()
      if (res.status < 500) {
        throw new Error(`Ollama error (${res.status}): ${text}`)
      }
      lastErr = new Error(`Ollama error (${res.status}): ${text}`)
    } catch (e) {
      if (e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError")) {
        lastErr = e
        continue
      }
      throw e
    }
  }

  throw lastErr || new Error("Ollama request failed after 3 retries")
}

export async function checkOllama(): Promise<boolean> {
  try {
    const res = await ollamaFetch("/api/tags")
    return res.ok
  } catch {
    return false
  }
}

export async function checkModel(model: string): Promise<boolean> {
  try {
    const res = await ollamaFetch("/api/tags")
    const data: OllamaTagsResponse = await res.json()
    return data.models.some((m) => m.name.startsWith(model))
  } catch {
    return false
  }
}

export async function autoPull(model: string): Promise<void> {
  console.log(`Pulling model ${model}...`)
  const res = await ollamaFetch("/api/pull", { name: model, stream: false }, 0)
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Failed to pull ${model}: ${text}`)
  }
  console.log(`Model ${model} pulled.`)
}

export async function ensureModel(model: string): Promise<void> {
  const running = await checkOllama()
  if (!running) {
    throw new Error("Ollama is not running. Start it with `ollama serve`.")
  }
  if (!(await checkModel(model))) {
    await autoPull(model)
  }
}

export async function embed(text: string, model: string): Promise<number[]> {
  const res = await ollamaFetch("/api/embeddings", { model, prompt: text })
  const data: OllamaEmbedResponse = await res.json()
  return data.embedding
}

function countTokens(text: string): number {
  return Math.ceil(text.length / 3)
}

function truncateToTokens(text: string, max: number): string {
  while (countTokens(text) > max) {
    text = text.slice(0, Math.floor(text.length * 0.8))
  }
  return text
}

const BATCH_SIZE = 20
const MAX_TOKENS = 500

export async function embedBatch(texts: string[], model: string, onProgress?: (done: number, total: number) => void): Promise<(number[] | null)[]> {
  const results: (number[] | null)[] = new Array(texts.length).fill(null)

  for (let start = 0; start < texts.length; start += BATCH_SIZE) {
    const end = Math.min(start + BATCH_SIZE, texts.length)
    const batch = texts.slice(start, end).map((t) => truncateToTokens(t, MAX_TOKENS))

    try {
      const res = await ollamaFetch("/api/embed", { model, input: batch })
      const data: { embeddings: number[][] } = await res.json()
      for (let i = 0; i < data.embeddings.length; i++) {
        results[start + i] = data.embeddings[i]
      }
    } catch {
      for (let i = 0; i < batch.length; i++) {
        try {
          const res = await ollamaFetch("/api/embeddings", { model, prompt: batch[i] })
          const data: OllamaEmbedResponse = await res.json()
          results[start + i] = data.embedding
        } catch {
          results[start + i] = null
        }
      }
    }

    onProgress?.(end, texts.length)
  }

  return results
}

export async function chat(
  system: string,
  prompt: string,
  model: string,
  temperature?: number,
): Promise<string> {
  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: system },
      prompt.startsWith("data:image/")
        ? { role: "user", content: [{ type: "image_url", image_url: { url: prompt } }] }
        : { role: "user", content: prompt },
    ],
    stream: false,
  }
  if (temperature !== undefined) body.temperature = temperature
  const res = await ollamaFetch("/api/chat", body)
  const data: OllamaChatResponse = await res.json()
  return data.message.content
}
