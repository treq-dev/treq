import React, { lazy, Suspense } from 'react';
import Layout from '@theme/Layout';
import Head from '@docusaurus/Head';
import BrowserOnly from '@docusaurus/BrowserOnly';

const AnnotatorTool = lazy(() =>
  import('./_MarkdownAnnotatorContent').then((m) => ({ default: m.AnnotatorTool }))
);

const loadingFallback = <div style={{ padding: '4rem', textAlign: 'center' }}>Loading…</div>;

const SCHEMA = {
  '@context': 'https://schema.org',
  '@type': 'WebApplication',
  name: 'Markdown Annotator',
  description:
    'Annotate markdown and code files with inline review comments. Fetch from GitHub or paste content, add line-level comments, then export a review prompt for Claude or ChatGPT.',
  url: 'https://treq.dev/tools/markdown-annotator',
  applicationCategory: 'DeveloperApplication',
  operatingSystem: 'Any',
  isAccessibleForFree: true,
  provider: { '@type': 'Organization', name: 'Treq', url: 'https://treq.dev' },
};

export default function MarkdownAnnotatorPage() {
  return (
    <Layout
      title="Markdown Annotator"
      description="Annotate markdown and code files with inline review comments, then export as a prompt for Claude or ChatGPT."
    >
      <Head>
        <script type="application/ld+json">{JSON.stringify(SCHEMA)}</script>
      </Head>
      <BrowserOnly fallback={loadingFallback}>
        {() => (
          <Suspense fallback={loadingFallback}>
            <AnnotatorTool />
          </Suspense>
        )}
      </BrowserOnly>
    </Layout>
  );
}
