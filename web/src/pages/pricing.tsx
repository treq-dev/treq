import type {ReactNode} from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import Head from '@docusaurus/Head';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';

import styles from './pricing.module.css';

const PRICING_SCHEMA = {
  '@context': 'https://schema.org',
  '@type': 'Product',
  name: 'Treq',
  description:
    'AI workspace manager for developers. Free for open source developers on public GitHub repos. Pro adds private repos.',
  url: 'https://treq.dev/pricing',
  brand: {
    '@type': 'Brand',
    name: 'Treq',
  },
  offers: [
    {
      '@type': 'Offer',
      name: 'Free',
      price: '0',
      priceCurrency: 'USD',
      description:
        'Desktop app for open source developers, with GitHub integration for public repositories.',
    },
    {
      '@type': 'Offer',
      name: 'Pro',
      price: '15',
      priceCurrency: 'USD',
      unitText: 'user/month',
      description:
        'GitHub integration for all repositories. Billed per user per month.',
    },
  ],
};

type PlanFeature = {
  text: string;
  included: boolean;
};

const FREE_FEATURES: PlanFeature[] = [
  {text: 'Full desktop app', included: true},
  {
    text: 'GitHub integration (public repos only)',
    included: true,
  },
];

const PRO_FEATURES: PlanFeature[] = [
  {text: 'Full desktop app', included: true},
  {text: 'GitHub integration for all repos', included: true},
];

type ComparisonCell = {
  included: boolean;
  detail?: string;
};

type ComparisonRow = {
  feature: string;
  free: ComparisonCell;
  pro: ComparisonCell;
};

const COMPARISON_ROWS: ComparisonRow[] = [
  {
    feature: 'Desktop app',
    free: {included: true},
    pro: {included: true},
  },
  {
    feature: 'GitHub integration',
    free: {included: true, detail: 'Public repos only'},
    pro: {included: true, detail: 'All repos'},
  },
];

const FAQ_ITEMS = [
  {
    question: 'Who is Free for?',
    answer:
      'Free covers open source developers. You get the full desktop workspace manager and GitHub integration for public repositories.',
  },
  {
    question: 'Is the desktop app still free on Pro?',
    answer:
      'Yes. Pro is a cloud subscription on top of the same open source desktop app. Your local workspaces stay on your machine either way.',
  },
  {
    question: 'How do I upgrade?',
    answer:
      'Create an account, then start a Pro subscription from the dashboard. You can move back to Free if you cancel.',
  },
] as const;

function FeatureList({features}: {features: PlanFeature[]}): ReactNode {
  return (
    <ul className={styles.featureList}>
      {features.map((feature) => (
        <li
          key={feature.text}
          className={clsx(
            styles.featureItem,
            feature.included ? styles.featureIncluded : styles.featureExcluded,
          )}
        >
          <span className={styles.featureMark} aria-hidden="true">
            {feature.included ? '✓' : '–'}
          </span>
          <span className={styles.featureText}>
            <span>{feature.text}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function PlansSection(): ReactNode {
  return (
    <section className={styles.plans} aria-label="Plans">
      <article className={styles.plan}>
        <Heading as="h2" className={styles.planName}>
          Free
        </Heading>
        <p className={styles.planPrice}>
          <span className={styles.priceAmount}>$0</span>
        </p>
        <FeatureList features={FREE_FEATURES} />
        <Link
          className={clsx('button', styles.planButton, styles.planButtonSecondary)}
          to="/docs/getting-started/installation"
        >
          Get started
        </Link>
      </article>

      <article className={clsx(styles.plan, styles.planPro)}>
        <Heading as="h2" className={styles.planName}>
          Pro
        </Heading>
        <p className={styles.planSeats}>Per user</p>
        <p className={styles.planPrice}>
          <span className={styles.priceAmount}>$15</span>
          <span className={styles.priceUnit}>/user/month</span>
        </p>
        <FeatureList features={PRO_FEATURES} />
        <Link
          className={clsx('button', styles.planButton, styles.planButtonPrimary)}
          to="/dashboard"
        >
          Upgrade to Pro
        </Link>
      </article>
    </section>
  );
}

function ComparisonValue({cell}: {cell: ComparisonCell}): ReactNode {
  const statusLabel = cell.included ? 'Included' : 'Not included';
  const ariaLabel = cell.detail
    ? `${statusLabel}, ${cell.detail}`
    : statusLabel;

  return (
    <span className={styles.comparisonValue} aria-label={ariaLabel}>
      <span
        className={clsx(
          styles.comparisonIcon,
          cell.included
            ? styles.comparisonIconYes
            : styles.comparisonIconNo,
        )}
        aria-hidden="true"
      >
        {cell.included ? '✓' : '✗'}
      </span>
      {cell.detail ? (
        <span className={styles.comparisonDetail}>{cell.detail}</span>
      ) : null}
    </span>
  );
}

function ComparisonSection(): ReactNode {
  return (
    <section className={styles.comparison} aria-label="Feature comparison">
      <Heading
        as="h2"
        className={clsx(styles.sectionHeading, styles.comparisonHeading)}
      >
        Feature comparison
      </Heading>
      <div className={styles.comparisonTableWrap}>
        <table className={styles.comparisonTable}>
          <colgroup>
            <col className={styles.comparisonFeatureCol} />
            <col className={styles.comparisonPlanCol} />
            <col className={styles.comparisonPlanCol} />
          </colgroup>
          <thead>
            <tr>
              <th scope="col" className={styles.comparisonFeatureHeader}>
                Feature
              </th>
              <th scope="col" className={styles.comparisonPlanHeader}>
                Free
              </th>
              <th
                scope="col"
                className={clsx(
                  styles.comparisonPlanHeader,
                  styles.comparisonPlanHeaderPro,
                )}
              >
                Pro
              </th>
            </tr>
          </thead>
          <tbody>
            {COMPARISON_ROWS.map((row) => (
              <tr key={row.feature} className={styles.comparisonRow}>
                <th scope="row" className={styles.comparisonFeatureCell}>
                  <span className={styles.comparisonFeatureLabel}>
                    <span>{row.feature}</span>
                  </span>
                </th>
                <td className={styles.comparisonDataCell}>
                  <ComparisonValue cell={row.free} />
                </td>
                <td
                  className={clsx(
                    styles.comparisonDataCell,
                    styles.comparisonDataCellPro,
                  )}
                >
                  <ComparisonValue cell={row.pro} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function FaqSection(): ReactNode {
  return (
    <section className={styles.faq} aria-label="Frequently asked questions">
      <Heading as="h2" className={styles.sectionHeading}>
        Frequently asked questions
      </Heading>

      <div className={styles.faqList}>
        {FAQ_ITEMS.map((item) => (
          <details key={item.question} className={styles.faqItem}>
            <summary className={styles.faqQuestion}>{item.question}</summary>
            <p className={styles.faqAnswer}>{item.answer}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

export default function PricingPage(): ReactNode {
  return (
    <Layout
      title="Pricing"
      description="Treq pricing. Free for open source developers on public GitHub repos. Pro is $15/user/month for all repos."
    >
      <Head>
        <script type="application/ld+json">
          {JSON.stringify(PRICING_SCHEMA)}
        </script>
      </Head>
      <main className={styles.page}>
        <header className={styles.header}>
          <Heading as="h1" className={styles.title}>
            Pricing
          </Heading>
          <p className={styles.intro}>
            The Treq desktop app is free and open source.
          </p>
        </header>

        <PlansSection />
        <ComparisonSection />
        <FaqSection />
      </main>
    </Layout>
  );
}
