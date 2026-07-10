import { Download } from 'lucide-react';
import { useLocalize } from '~/hooks';

export default function Video({ videoPath }: { videoPath: string }) {
  const localize = useLocalize();

  const downloadVideo = async () => {
    try {
      const response = await fetch(videoPath);
      if (!response.ok) throw new Error(`Failed to fetch video: ${response.status}`);
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = 'video.mp4';
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      window.open(videoPath, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <div className="mt-1 w-full max-w-2xl overflow-hidden rounded-lg border border-border-light bg-black">
      {/* Generated media does not include a caption track from the provider. */}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video className="max-h-[55vh] w-full" controls preload="metadata" src={videoPath} />
      <button
        type="button"
        className="flex w-full items-center justify-center gap-2 border-t border-border-light px-3 py-2 text-sm text-text-secondary hover:text-text-primary"
        onClick={() => void downloadVideo()}
      >
        <Download className="size-4" />
        {localize('com_ui_download')}
      </button>
    </div>
  );
}
