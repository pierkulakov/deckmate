import { useCallback, useState, type ImgHTMLAttributes, type ReactNode } from 'react';
import { ImageOff } from 'lucide-react';
import { loadDecodedImage, decodedImage } from '../decoded-image.ts';
import { defineText, useText } from '../i18n.ts';
import '../decoded-image.css';

const text = defineText({ unavailable: 'Image unavailable' }, { unavailable: 'Изображение недоступно' });

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'onLoad' | 'onError' | 'srcSet'> & {
  src: string;
  fallback?: ReactNode;
};

function ImageSource({ src, alt = '', className = '', loading, fallback, ...props }: Props) {
  const t = useText(text);
  const [cached] = useState(() => Boolean(decodedImage(src)));
  const [state, setState] = useState(cached ? 'ready' : 'loading');
  const reveal = useCallback(() => {
    void loadDecodedImage(src).then(() => setState('ready'), () => setState('error'));
  }, [src]);
  const ref = useCallback((image: HTMLImageElement | null) => {
    // 2026-11-13: lazy images start at intersection; cached images may finish before React attaches onLoad.
    if (image && (loading !== 'lazy' || image.complete)) reveal();
  }, [loading, reveal]);

  if (state === 'error') return <span className={'image-fallback ' + className} style={props.style}
    role={alt ? 'img' : undefined} aria-label={alt ? `${alt} — ${t.unavailable}` : undefined} aria-hidden={alt ? undefined : true}
    title={t.unavailable} data-image-state="error">{fallback ?? <ImageOff size={20} aria-hidden="true" />}</span>;
  return <img src={src} alt={alt} {...props} className={'decoded-image ' + className} loading={loading} decoding="async"
    data-image-state={state} data-image-cached={cached || undefined} ref={ref}
    onLoad={reveal} onError={() => setState('error')} />;
}

// 2026-11-13: a new source gets its own decode lifecycle; a late result cannot reveal the previous picture.
export function DecodedImage(props: Props) {
  return <ImageSource key={props.src} {...props} />;
}
