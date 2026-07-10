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
});
