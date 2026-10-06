import type { ReactNode } from 'react';

export const metadata = {
  title: 'nextjs-postgres',
  description: 'A deploy double.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
