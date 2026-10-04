import React, { lazy, Suspense } from 'react';
import Layout from '@theme/Layout';
import DownloadCTA from '@site/src/components/DownloadCTA';
import Head from '@docusaurus/Head';
import BrowserOnly from '@docusaurus/BrowserOnly';

const GherkinEditorContent = lazy(() =>
  import('./_GherkinEditorContent').then((m) => ({ default: m.GherkinEditorContent }))
);

const loadingFallback = <div style={{ padding: '4rem', textAlign: 'center' }}>Loading…</div>;

const SCHEMA = {
  '@context': 'https://schema.org',
  '@type': 'WebApplication',
  name: 'Gherkin BDD Editor',
  description:
    'Write BDD specs in a structured form and export to .feature files. Features are saved locally in your browser.',
  url: 'https://treq.dev/tools/gherkin-editor',
  applicationCategory: 'DeveloperApplication',
  operatingSystem: 'Any',
  isAccessibleForFree: true,
  provider: {
    '@type': 'Organization',
    name: 'Treq',
    url: 'https://treq.dev',
  },
};

export default function GherkinEditorPage() {
  return (
    <Layout
      title="Gherkin BDD Editor"
      description="Write BDD specs in a structured form and export to .feature files. Features are saved locally in your browser."
    >
      <Head>
        <script type="application/ld+json">{JSON.stringify(SCHEMA)}</script>
      </Head>
      <BrowserOnly fallback={loadingFallback}>
        {() => (
          <Suspense fallback={loadingFallback}>
            <GherkinEditorContent />
          </Suspense>
        )}
      </BrowserOnly>
      <DownloadCTA title="Built by Treq" />
    </Layout>
  );
}
