const { ContentTypes } = require('librechat-data-provider');

const MEDIA_MARKER = /\[\[AIGATE_MEDIA:(image|video):([A-Za-z0-9_-]+)\]\]/g;

function decodeUrl(encoded) {
  try {
    return Buffer.from(encoded, 'base64url').toString('utf8');
  } catch {
    return null;
  }
}

function expandAigateMediaMarkers(contentParts) {
  if (!Array.isArray(contentParts)) {
    return contentParts;
  }

  const expanded = [];
  for (const part of contentParts) {
    if (part?.type !== ContentTypes.TEXT || typeof part.text !== 'string') {
      expanded.push(part);
      continue;
    }

    let cursor = 0;
    let matched = false;
    for (const match of part.text.matchAll(MEDIA_MARKER)) {
      matched = true;
      const before = part.text.slice(cursor, match.index);
      if (before) {
        expanded.push({ ...part, text: before });
      }

      const url = decodeUrl(match[2]);
      if (url) {
        const type = match[1] === 'image' ? ContentTypes.IMAGE_URL : ContentTypes.VIDEO_URL;
        expanded.push({ type, [type]: { url } });
      }
      cursor = (match.index ?? 0) + match[0].length;
    }

    if (!matched) {
      expanded.push(part);
      continue;
    }

    const after = part.text.slice(cursor);
    if (after) {
      expanded.push({ ...part, text: after });
    }
  }

  return expanded;
}

module.exports = { expandAigateMediaMarkers };
