import { ScrollViewStyleReset } from 'expo-router/html';

export default function Root({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, maximum-scale=1"
        />
        <style>{`
          html, body {
            background-color: #000000 !important;
            overscroll-behavior: none;
            overflow: hidden;
          }
          #root, [data-reactroot] {
            background-color: #000000;
            height: 100%;
          }
          /* RN Web: Step 3 helper box — muted copy (wrappers often set near-white) */
          #arbiter-helper-verdict,
          #arbiter-helper-verdict * {
            color: #a0a0a0 !important;
          }
        `}</style>
        <script defer src="/_vercel/insights/script.js"></script>
        <ScrollViewStyleReset />
      </head>
      <body>{children}</body>
    </html>
  );
}
