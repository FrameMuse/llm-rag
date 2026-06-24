import { readFile } from "fs/promises"
import { createHash } from "crypto"
import sharp from "sharp"

const OLLAMA_HOST = (process.env.OLLAMA_HOST || "http://localhost:11434").replace(/\/+$/, "")
const VISION_PROMPT = "Describe this image in detail suitable for searching. Include: visible objects, colors, text, layout, and distinguishing features. Be specific but concise."

export const IMAGE_EXTS = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"]

export function isImage(filePath: string): boolean {
  return IMAGE_EXTS.some((ext) => filePath.toLowerCase().endsWith(ext))
}

async function imageToBase64(filePath: string): Promise<string> {
  let buffer: Buffer
  if (filePath.toLowerCase().endsWith(".svg")) {
    buffer = await sharp(filePath).png().toBuffer()
  } else {
    buffer = await readFile(filePath)
  }
  return buffer.toString("base64")
}

export async function describeImage(
  filePath: string,
  visionModel: string,
  _projectDir: string,
): Promise<string | null> {
  try {
    const b64 = await imageToBase64(filePath)
    const body = JSON.stringify({
      model: visionModel,
      messages: [
        { role: "user", content: VISION_PROMPT, images: [b64] },
      ],
      stream: false,
    })

    const res = await fetch(`${OLLAMA_HOST}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(60000),
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Ollama error (${res.status}): ${text}`)
    }

    const data = await res.json()
    return data.message?.content ?? null
  } catch (e) {
    console.error(`  Failed to caption ${filePath}: ${e}`)
    return null
  }
}
