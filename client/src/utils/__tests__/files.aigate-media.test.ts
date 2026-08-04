import { getViableUploadOptions } from '../files';

describe('AIGate direct media attachments', () => {
  it('allows video files on the AIGate custom endpoint', () => {
    const video = new File(['video'], 'clip.mp4', { type: 'video/mp4' });

    const baseContext = {
      endpointType: 'custom',
      fileSearchEnabled: false,
      codeEnabled: false,
      contextEnabled: false,
      fileSearchAllowedByAgent: false,
      codeAllowedByAgent: false,
      fileConfig: null,
    };

    expect(
      getViableUploadOptions([video], {
        ...baseContext,
        endpoint: 'Other',
      }),
    ).toEqual([]);

    expect(
      getViableUploadOptions([video], {
        ...baseContext,
        endpoint: 'AIGate',
      }),
    ).toEqual([undefined]);
  });

  it('routes PDFs natively only for AIGate model families that accept them', () => {
    const pdf = new File(['pdf'], 'document.pdf', { type: 'application/pdf' });
    const baseContext = {
      endpoint: 'AIGate',
      endpointType: 'custom',
      fileSearchEnabled: false,
      codeEnabled: false,
      contextEnabled: true,
      fileSearchAllowedByAgent: false,
      codeAllowedByAgent: false,
      fileConfig: {
        text: { supportedMimeTypes: [/^application\/pdf$/] },
      },
    };

    expect(
      getViableUploadOptions([pdf], { ...baseContext, model: 'google/gemini-3.1-flash-lite' }),
    ).toEqual([undefined, 'context']);
    expect(getViableUploadOptions([pdf], { ...baseContext, model: 'openai/gpt-5.4-mini' })).toEqual(
      [undefined, 'context'],
    );
    expect(
      getViableUploadOptions([pdf], { ...baseContext, model: 'anthropic/claude-sonnet-5' }),
    ).toEqual(['context']);
  });
});
