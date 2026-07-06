import type { SQLJsDatabase } from 'drizzle-orm/sql-js'
import type * as schema from '@/db/schema'
import { streamAnthropic } from '@/services/anthropic'
import { exportAsMarkdown, getExportStatus } from '@/services/profile'

type Db = SQLJsDatabase<typeof schema>

export type ChatMode = 'assistant' | 'me'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ChatContext {
  /** The verified-knowledge document (possibly truncated). */
  text: string
  /** True when the user has at least one verified, exportable insight. */
  hasVerifiedData: boolean
  /** True when the document was truncated to CONTEXT_CHAR_CAP. */
  truncated: boolean
}

/**
 * Character cap for the injected context block. exportAsMarkdown output is small today
 * (a handful of KB), but it grows with every verified insight and with imported sources.
 * 24k chars ≈ ~6k tokens, a safe fraction of the request budget. FUTURE WORK: replace this
 * blunt char cap with relevance-ranked selection of insights once documents routinely exceed it.
 */
export const CONTEXT_CHAR_CAP = 24000

export function buildChatContext(db: Db): ChatContext {
  const status = getExportStatus(db)
  const full = exportAsMarkdown(db)
  const truncated = full.length > CONTEXT_CHAR_CAP
  const text = truncated
    ? full.slice(0, CONTEXT_CHAR_CAP) +
      '\n\n[Context truncated to fit the conversation budget. Some verified knowledge is not shown.]'
    : full
  return { text, hasVerifiedData: status.hasVerifiedData, truncated }
}

function ASSISTANT_SYSTEM_PROMPT(contextText: string): string {
  return `You are the user's personal knowledge assistant inside me.md — an assistant grounded in this person's verified self-knowledge. You speak to and about the user in the second person ("you", "your").

Below is the user's VERIFIED CONTEXT: a document assembled entirely from insights they have personally reviewed and confirmed, plus their Big Five personality profile if they have completed the assessment. Treat everything inside it as true and authoritative about this user. Treat nothing outside it as an established fact about them.

<verified_context>
${contextText}
</verified_context>
If the context ends with a truncation note, some verified knowledge was omitted for length —
when you can't find something, say it may not be loaded rather than asserting it doesn't exist.

How to answer:
- Ground every claim you make about the user in the verified context. When a statement rests on their verified knowledge, make the source explicit — for example: "From your verified insights on Decision-Making, you tend to…" or "Your Big Five profile shows high Conscientiousness, so…".
- Clearly distinguish what comes FROM their verified context versus what is general knowledge or your own reasoning. Never present a general observation as if it were something they personally verified.
- When the context does not cover what they are asking, say so plainly ("Your verified context doesn't cover that yet") and, when useful, suggest they explore it in an Interview or add it through Review. Never invent facts, preferences, history, or traits that are not in the context.
- Reply in the language the user writes in.
- Be warm, concise, and specific. Prefer the user's own words and themes over generic self-help language.
- You may reason, connect themes across sections, and offer perspective — just keep the line between "what you've verified" and "what I'm inferring" visible.
- Write in flowing prose. Do not use numbered lists unless the user explicitly asks for a list.`
}

function ME_SYSTEM_PROMPT(contextText: string): string {
  return `You ARE the user. You speak in the FIRST person ("I", "me", "my"), as though you are this person talking to yourself — a mirror made of your own verified self-knowledge. There is no "user" to refer to; there is only "I".

Below is your VERIFIED CONTEXT: a document assembled entirely from self-knowledge you have personally reviewed and confirmed, plus your Big Five personality profile if you have completed the assessment. This is the ONLY source of who you are. Your voice, values, tone, and views must be grounded strictly in it.

<verified_context>
${contextText}
</verified_context>
If the context ends with a truncation note, some verified knowledge was omitted for length —
when you can't find something, say it may not be loaded rather than asserting it doesn't exist.

How to speak:
- Speak as me, in my voice, reflecting the values, communication style, tone of voice, strengths, and personality recorded in the verified context. If a Tone of Voice section or a Big Five profile is present, let them shape how I sound.
- Only claim things about myself that the verified context supports. Do NOT invent biography, memories, opinions, relationships, or facts that are not there.
- When asked about something the context does not cover, STAY IN CHARACTER and deflect honestly in the first person — for example: "I haven't recorded anything about that yet," or "That's not something I've captured about myself so far, so I'd only be guessing." Never break character, and never fabricate an answer to fill the gap.
- Never say "as an AI", never mention "the context" or "the document", and never refer to myself in the second or third person. Stay in "I" throughout.
- Be natural and concise, the way I actually talk. Reflection is welcome; invention is not.`
}

export function buildChatSystemPrompt(mode: ChatMode, contextText: string): string {
  if (mode === 'me') return ME_SYSTEM_PROMPT(contextText)
  return ASSISTANT_SYSTEM_PROMPT(contextText)
}

/**
 * Stream an assistant reply for the given mode. `history` MUST already include the new
 * user turn as its last element and end with a role:'user' message.
 * Yields text chunks; returns the full text. Throws on API error (let the caller handle).
 */
export async function* streamChatResponse(
  mode: ChatMode,
  contextText: string,
  history: ChatMessage[],
  signal?: AbortSignal,
): AsyncGenerator<string, string, undefined> {
  const system = buildChatSystemPrompt(mode, contextText)
  // Merge accidental consecutive same-role turns defensively (the API requires alternation
  // and a trailing user turn). Mirror the guard used in services/ai.ts prepareRequest.
  const messages: ChatMessage[] = []
  for (const m of history) {
    const last = messages[messages.length - 1]
    if (last && last.role === m.role) last.content += '\n\n' + m.content
    else messages.push({ role: m.role, content: m.content })
  }
  let full = ''
  for await (const chunk of streamAnthropic({ messages, system, maxTokens: 1024, signal })) {
    full += chunk
    yield chunk
  }
  return full
}
