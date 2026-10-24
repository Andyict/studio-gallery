import type { MetadataRoute } from 'next';

// Lets customers add their album to the phone's home screen.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Studio Gallery',
    short_name: 'Album ảnh',
    description: 'Xem album, chọn ảnh và trò chuyện với studio',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#f8f9f6',
    theme_color: '#365c48',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
    ]
  };
}
