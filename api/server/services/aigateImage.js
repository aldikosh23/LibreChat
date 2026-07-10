const IMAGE_MODEL_PATTERN = /^openai\/gpt-image(?:[-/]|$)/i;

function isAigateImageModel(provider, model) {
  return String(provider).toLowerCase() === 'aigate' && IMAGE_MODEL_PATTERN.test(String(model));
}

function extractAigateImageInput(messages) {
  const message = [...messages].reverse().find((item) => item?._getType?.() === 'human');
  const content = message?.content;
  if (typeof content === 'string') return { prompt: content, imageUrls: [] };
  if (!Array.isArray(content)) return { prompt: '', imageUrls: [] };
  return {
    prompt: content
      .filter((part) => part?.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text)
      .join('\n'),
    imageUrls: content
      .filter((part) => part?.type === 'image_url')
      .map((part) => (typeof part.image_url === 'string' ? part.image_url : part.image_url?.url))
      .filter(Boolean),
  };
}

function buildAigateImageRequest({ model, prompt, imageUrls }) {
  return imageUrls.length > 0
    ? { path: 'images/edits', body: { model, prompt, image_urls: imageUrls } }
    : { path: 'images/generations', body: { model, prompt } };
}

function parseAigateImageResponse(payload) {
  if (!Array.isArray(payload?.data)) return [];
  return payload.data
    .map((item) => item?.url || (item?.b64_json ? `data:image/png;base64,${item.b64_json}` : null))
    .filter(Boolean);
}

module.exports = {
  buildAigateImageRequest,
  extractAigateImageInput,
  isAigateImageModel,
  parseAigateImageResponse,
};
