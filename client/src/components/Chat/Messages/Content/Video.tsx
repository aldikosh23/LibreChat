import { Download } from 'lucide-react';
import { useLocalize } from '~/hooks';

export default function Video({ videoPath }: { videoPath: string }) {
  const localize = useLocalize();

  return (
    <div className="mt-1 w-full max-w-2xl overflow-hidden rounded-lg border border-border-light bg-black">
      {/* Generated media does not include a caption track from the provider. */}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video className="max-h-[55vh] w-full" controls preload="metadata" src={videoPath} />
      <a
        className="flex items-center justify-center gap-2 border-t border-border-light px-3 py-2 text-sm text-text-secondary hover:text-text-primary"
        href={videoPath}
        download="video.mp4"
      >
        <Download className="size-4" />
        {localize('com_ui_download')}
      </a>
    </div>
  );
}
