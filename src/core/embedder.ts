const OLLAMA_HOST = "http://localhost:11434"

interface OllamaEmbedResponse {
  embedding: number[]
}

interface OllamaChatResponse {
  message: { content: string }
}

interface OllamaTagsResponse {
  models: { name: string }[]
}

async function ollamaFetch(path: string, body?: unknown): Promise<Response> {
  const url = `${OLLAMA_HOST}${path}`
  const res = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Ollama error (${res.status}): ${text}`)
  }
  return res
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
  const res = await ollamaFetch("/api/pull", { name: model, stream: false })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Failed to pull ${model}: ${text}`)
  }
  console.log(`Model ${model} pulled.`)
}

export async function ensureModel(model: string): Promise<void> {
  const running = await checkOllama()
  if (!running) {
    console.error("Ollama is not running. Start it with `ollama serve`.")
    process.exit(1)
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
): Promise<string> {
  const res = await ollamaFetch("/api/chat", {
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: prompt },
    ],
    stream: false,
  })
  const data: OllamaChatResponse = await res.json()
  return data.message.content
}
