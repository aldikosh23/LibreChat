type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  return value != null && typeof value === 'object' ? (value as JsonRecord) : null;
}

function mediaUrl(item: unknown, kind: 'image' | 'video'): string | null {
  const value = asRecord(item);
  if (!value) return null;
  const nested = asRecord(value[`${kind}_url`]);
  const url = nested?.url ?? value.url;
  if (typeof url === 'string' && url) return url;
  if (typeof value.b64_json === 'string' && value.b64_json) {
    const defaultMime = kind === 'image' ? 'image/png' : 'video/mp4';
    const mime = typeof value.mime_type === 'string' ? value.mime_type : defaultMime;
    return `data:${mime};base64,${value.b64_json}`;
  }
  return null;
}

function normalizeMessage(value: unknown): void {
  const message = asRecord(value);
  if (!message) return;
  const parts: JsonRecord[] = [];
  if (Array.isArray(message.content)) {
    parts.push(...(message.content.filter((part) => asRecord(part)) as JsonRecord[]));
  } else if (typeof message.content === 'string' && message.content) {
    parts.push({ type: 'text', text: message.content });
  }
  for (const item of Array.isArray(message.images) ? message.images : []) {
    const url = mediaUrl(item, 'image');
    if (url) parts.push({ type: 'image_url', image_url: { url } });
  }
  for (const item of Array.isArray(message.videos) ? message.videos : []) {
    const url = mediaUrl(item, 'video');
    if (url) parts.push({ type: 'video_url', video_url: { url } });
  }
  if (parts.length > 0) message.content = parts;
  delete message.images;
  delete message.videos;
}

export function normalizeAigateMediaPayload<T>(payload: T): T {
  const root = asRecord(payload);
  if (!root) return payload;
  for (const choice of Array.isArray(root.choices) ? root.choices : []) {
    const value = asRecord(choice);
    normalizeMessage(value?.message);
    normalizeMessage(value?.delta);
  }
  for (const output of Array.isArray(root.output) ? root.output : []) {
    normalizeMessage(output);
  }
  return payload;
}

export function transformAigateMediaSseLine(line: string): string {
  const match = line.match(/^(data:\s*)(.*?)(\r?)$/);
  if (!match || match[2] === '[DONE]') return line;
  try {
    return `${match[1]}${JSON.stringify(normalizeAigateMediaPayload(JSON.parse(match[2])))}${match[3]}`;
  } catch {
    return line;
  }
}

export function createAigateMediaFetch(baseFetch: Fetch = globalThis.fetch): Fetch {
  return async (input, init) => {
    const response = await baseFetch(input, init);
    if (!response.ok || !response.body) return response;
    const contentType = response.headers.get('content-type') ?? '';
    const headers = new Headers(response.headers);
    headers.delete('content-length');
    if (contentType.includes('application/json')) {
      const payload = normalizeAigateMediaPayload(await response.json());
      return new Response(JSON.stringify(payload), {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    }
    if (!contentType.includes('text/event-stream')) return response;

    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let pending = '';
    const body = response.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          pending += decoder.decode(chunk, { stream: true });
          const lines = pending.split('\n');
          pending = lines.pop() ?? '';
          for (const line of lines) {
            controller.enqueue(encoder.encode(`${transformAigateMediaSseLine(line)}\n`));
          }
        },
        flush(controller) {
          pending += decoder.decode();
          if (pending) controller.enqueue(encoder.encode(transformAigateMediaSseLine(pending)));
        },
      }),
    );
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
}
