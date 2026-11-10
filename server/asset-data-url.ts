type AssetMime = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif' | 'application/pdf';
type DecodeFailure = 'sizeLimit' | 'dataUrl' | 'canonicalBase64' | 'contentType';

interface DecodeOptions {
  allowed: readonly AssetMime[];
  maximumBytes: number;
  headerAllowance: number;
  error: (failure: DecodeFailure) => Error;
}

interface DecodedAsset {
  bytes: Buffer;
  extension: string;
  mime: AssetMime;
  kind: 'image' | 'pdf';
}

function extensionFor(bytes: Buffer, mime: AssetMime): string | null {
  const latin = (start: number, end: number) => bytes.toString('latin1', start, end);
  switch (mime) {
    case 'image/png':
      return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'png' : null;
    case 'image/jpeg':
      return bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? 'jpg' : null;
    case 'image/webp':
      return bytes.length >= 20 && latin(0, 4) === 'RIFF' && latin(8, 12) === 'WEBP'
        && bytes.readUInt32LE(4) + 8 === bytes.length && ['VP8 ', 'VP8L', 'VP8X'].includes(latin(12, 16)) ? 'webp' : null;
    case 'image/gif':
      return bytes.length >= 6 && ['GIF87a', 'GIF89a'].includes(latin(0, 6)) ? 'gif' : null;
    case 'application/pdf':
      return bytes.length >= 5 && latin(0, 5) === '%PDF-' ? 'pdf' : null;
  }
}

export function decodeAssetDataUrl(dataUrl: string, options: DecodeOptions): DecodedAsset {
  const maximumEncodedLength = Math.ceil(options.maximumBytes / 3) * 4;
  if (typeof dataUrl !== 'string' || dataUrl.length > maximumEncodedLength + options.headerAllowance) throw options.error('sizeLimit');
  const match = /^data:(image\/(?:png|jpeg|webp|gif)|application\/pdf);base64,([A-Za-z0-9+/]+={0,2})$/u.exec(dataUrl);
  if (!match || !options.allowed.includes(match[1] as AssetMime) || match[2].length % 4 !== 0
    || match[2].length > maximumEncodedLength) throw options.error('dataUrl');
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length === 0 || bytes.length > options.maximumBytes) throw options.error('sizeLimit');
  if (bytes.toString('base64') !== match[2]) throw options.error('canonicalBase64');
  const mime = match[1] as AssetMime;
  const extension = extensionFor(bytes, mime);
  if (!extension) throw options.error('contentType');
  return { bytes, extension, mime, kind: mime === 'application/pdf' ? 'pdf' : 'image' };
}
