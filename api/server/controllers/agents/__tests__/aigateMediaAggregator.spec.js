const { GraphEvents, createContentAggregator } = require('@librechat/agents');

describe('AIGate media aggregation', () => {
  it.each([
    ['image_url', 'image_url', { url: 'data:image/png;base64,abc' }],
    ['video_url', 'video_url', { url: 'https://aigate.shop/v1/media/video.mp4' }],
  ])('preserves %s payloads', (type, key, value) => {
    const { contentParts, aggregateContent } = createContentAggregator();
    aggregateContent({
      event: GraphEvents.ON_RUN_STEP,
      data: {
        id: 'step-1',
        index: 0,
        stepDetails: { type: 'message_creation', message_creation: { message_id: 'message-1' } },
      },
    });
    aggregateContent({
      event: GraphEvents.ON_MESSAGE_DELTA,
      data: { id: 'step-1', delta: { content: [{ type, [key]: value }] } },
    });

    expect(contentParts[0]).toEqual({ type, [key]: value });
  });
});
