const IMAGE_MODEL_PATTERN = /^openai\/gpt-image(?:[-/]|$)/i;
const ASPECT_RATIOS = new Set(['1:1', '16:9', '9:16', '21:9', '4:3', '3:4', '4:5', '5:4']);
const IMAGE_SIZES = new Set(['1K', '2K', '4K']);
const QUALITIES = new Set(['auto', 'low', 'medium', 'high']);

function isAigateImageModel(_provider, model) {
  return IMAGE_MODEL_PATTERN.test(String(model));
}

function getMessageImageUrls(message) {
  if (!Array.isArray(message?.content)) return [];
  return message.content
    .filter((part) => part?.type === 'image_url')
    .map((part) => (typeof part.image_url === 'string' ? part.image_url : part.image_url?.url))
    .filter(Boolean);
}

function getMessageText(message) {
  if (typeof message?.content === 'string') return message.content;
  if (!Array.isArray(message?.content)) return '';
  return message.content
    .filter((part) => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n');
}

function extractAigateImageInput(messages) {
  const currentIndex = messages.findLastIndex((item) => item?._getType?.() === 'human');
  if (currentIndex < 0) {
    return { prompt: '', currentImageUrls: [], previousImageUrls: [] };
  }

  const current = messages[currentIndex];
  let previousImageUrls = [];
  for (let index = currentIndex - 1; index >= 0; index -= 1) {
    previousImageUrls = getMessageImageUrls(messages[index]);
    if (previousImageUrls.length > 0) break;
  }

  return {
    prompt: getMessageText(current),
    currentImageUrls: getMessageImageUrls(current),
    previousImageUrls,
  };
}

function normalizePlan(plan) {
  const action = plan?.action === 'edit' ? 'edit' : 'generate';
  const aspectRatio = ASPECT_RATIOS.has(plan?.aspect_ratio) ? plan.aspect_ratio : undefined;
  const imageSize = IMAGE_SIZES.has(String(plan?.image_size).toUpperCase())
    ? String(plan.image_size).toUpperCase()
    : undefined;
  const quality = QUALITIES.has(String(plan?.quality).toLowerCase())
    ? String(plan.quality).toLowerCase()
    : undefined;
  return {
    action,
    ...(aspectRatio ? { aspectRatio } : {}),
    ...(imageSize ? { imageSize } : {}),
    ...(quality ? { quality } : {}),
  };
}

function parseAigateImagePlan(content) {
  const json = String(content)
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  return normalizePlan(JSON.parse(json));
}

function inferAigateImagePlan(prompt, hasCurrentImages, hasPreviousImages) {
  const text = String(prompt);
  const editVerb =
    /(?:измени|изменить|переделай|подправь|исправь|отредактируй|edit|modify|change|adjust|fix)/iu;
  const imageReference =
    /(?:эту|это|е[её]|на ней|в ней|предыдущ|картинк|изображени|фото|image|picture|photo|\bit\b|previous|above)/iu;
  const aspectRatio = text.match(/(?:^|\s)(1:1|16:9|9:16|21:9|4:3|3:4|4:5|5:4)(?=\s|$|[,.])/i)?.[1];
  const imageSize = text.match(/\b([124])\s*k\b/i)?.[1];
  const quality = text.match(/\b(auto|low|medium|high)\b/i)?.[1]?.toLowerCase();
  const action =
    hasCurrentImages || (hasPreviousImages && editVerb.test(text) && imageReference.test(text))
      ? 'edit'
      : 'generate';

  return {
    action,
    ...(aspectRatio ? { aspectRatio } : {}),
    ...(imageSize ? { imageSize: `${imageSize}K` } : {}),
    ...(quality ? { quality } : {}),
  };
}

function getOpenAIEditSize(aspectRatio) {
  if (aspectRatio === '1:1') return '1024x1024';
  if (['9:16', '3:4', '4:5'].includes(aspectRatio)) return '1024x1536';
  if (aspectRatio) return '1536x1024';
  return undefined;
}

function buildAigateImageRequest({
  model,
  prompt,
  currentImageUrls = [],
  previousImageUrls = [],
  plan = { action: 'generate' },
}) {
  let imageUrls = currentImageUrls;
  if (imageUrls.length === 0) {
    imageUrls = plan.action === 'edit' ? previousImageUrls : [];
  }
  const isEdit = imageUrls.length > 0;
  const body = { model, prompt };

  if (plan.quality) body.quality = plan.quality;
  if (isEdit) {
    body.images = imageUrls.map((imageUrl) => ({ image_url: imageUrl }));
    const size = getOpenAIEditSize(plan.aspectRatio);
    if (size) body.size = size;
    return { path: 'images/edits', body };
  }

  if (plan.aspectRatio || plan.imageSize) {
    body.image_config = {
      ...(plan.aspectRatio ? { aspect_ratio: plan.aspectRatio } : {}),
      ...(plan.imageSize ? { image_size: plan.imageSize } : {}),
    };
  }
  return { path: 'images/generations', body };
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
  inferAigateImagePlan,
  isAigateImageModel,
  parseAigateImagePlan,
  parseAigateImageResponse,
};
