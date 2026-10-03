import React, { lazy, Suspense } from 'react';
import Layout from '@theme/Layout';
import DownloadCTA from '@site/src/components/DownloadCTA';
import Head from '@docusaurus/Head';
import BrowserOnly from '@docusaurus/BrowserOnly';

const DagVisualizerContent = lazy(() =>
  import('./_DagVisualizerContent').then((m) => ({ default: m.DagVisualizerContent }))
);

const loadingFallback = <div style={{ padding: '4rem', textAlign: 'center' }}>Loading…</div>;

const SCHEMA = {
  '@context': 'https://schema.org',
  '@type': 'WebApplication',
  name: 'DAG Visualizer',
  description:
    'Visualize AI-aided engineering workflows as interactive DAGs. Shareable via URL.',
  url: 'https://treq.dev/tools/dag-visualizer',
  applicationCategory: 'DeveloperApplication',
  operatingSystem: 'Any',
  isAccessibleForFree: true,
  provider: {
    '@type': 'Organization',
    name: 'Treq',
    url: 'https://treq.dev',
  },
};

export default function DagVisualizerPage() {
  return (
    <Layout
      title="DAG Visualizer"
      description="Visualize AI-aided engineering workflows as interactive DAGs. Shareable via URL."
    >
      <Head>
        <script type="application/ld+json">{JSON.stringify(SCHEMA)}</script>
      </Head>
      <noscript>
        <div style={{ padding: '2rem 2rem 0', maxWidth: '960px', margin: '0 auto' }}>
          <h1>DAG Visualizer</h1>
          <p>
            The DAG Visualizer turns AI-aided engineering workflows into interactive,
            shareable directed-acyclic-graph diagrams. Map out multi-step agent
            workflows, branching decision points, and parallel task pipelines, then
            share the resulting diagram via a URL — no account or install required.
          </p>
        </div>
      </noscript>
      <BrowserOnly fallback={loadingFallback}>
        {() => (
          <Suspense fallback={loadingFallback}>
            <DagVisualizerContent />
          </Suspense>
        )}
      </BrowserOnly>
      <DownloadCTA title="Built by Treq" />
    </Layout>
  );
}
