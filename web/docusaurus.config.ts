import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';
import pkg from '../package.json';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

const featureFlags = pkg.featureFlags;
const shouldLoadGoogleTag = process.env.DOCUSAURUS_ENABLE_GTAG === 'true';

const config: Config = {
  plugins: [
    require.resolve('./plugins/rawMarkdownPlugin'),
    require.resolve('./plugins/versionPlugin'),
    require.resolve('./plugins/jsonLdPlugin'),
    [
      '@docusaurus/plugin-content-docs',
      {
        id: 'learn',
        path: 'learn',
        routeBasePath: 'learn',
        sidebarPath: './sidebarsLearn.ts',
        editUrl: 'https://github.com/Ziinc/treq/tree/main/web/',
      },
    ],
    [
      '@docusaurus/plugin-content-docs',
      {
        id: 'compare',
        path: 'compare',
        routeBasePath: 'compare',
        sidebarPath: './sidebarsCompare.ts',
        editUrl: 'https://github.com/Ziinc/treq/tree/main/web/',
      },
    ],
    function chunkSplittingPlugin() {
      return {
        name: 'chunk-splitting-plugin',
        configureWebpack(_config: object, isServer: boolean) {
          if (isServer) return {};
          return {
            optimization: {
              splitChunks: {
                chunks: 'all' as const,
                cacheGroups: {
                  // three.js — only loaded on rubber-duck, vibe-idea-generator, and roadmap pages
                  three: {
                    test: /[\\/]node_modules[\\/]three[\\/]/,
                    name: 'chunk-three',
                    chunks: 'all' as const,
                    priority: 40,
                    enforce: true,
                  },
                  // React Flow — only loaded on dag-visualizer page
                  reactFlow: {
                    test: /[\\/]node_modules[\\/]@xyflow[\\/]/,
                    name: 'chunk-react-flow',
                    chunks: 'all' as const,
                    priority: 40,
                    enforce: true,
                  },
                  // Dagre — only loaded on dag-visualizer page
                  dagre: {
                    test: /[\\/]node_modules[\\/]@dagrejs[\\/]/,
                    name: 'chunk-dagre',
                    chunks: 'all' as const,
                    priority: 40,
                    enforce: true,
                  },
                  // Rough.js — shared between branch-visualizer and vcs-simulator
                  roughjs: {
                    test: /[\\/]node_modules[\\/]roughjs[\\/]/,
                    name: 'chunk-roughjs',
                    chunks: 'all' as const,
                    priority: 40,
                    enforce: true,
                  },
                  // Supabase — only loaded on login/dashboard/auth pages
                  supabase: {
                    test: /[\\/]node_modules[\\/]@supabase[\\/]/,
                    name: 'chunk-supabase',
                    chunks: 'all' as const,
                    priority: 40,
                    enforce: true,
                  },
                  // sql.js — only loaded on demand via SearchDbContext
                  sqljs: {
                    test: /[\\/]node_modules[\\/]sql\.js[\\/]/,
                    name: 'chunk-sqljs',
                    chunks: 'all' as const,
                    priority: 40,
                    enforce: true,
                  },
                },
              },
            },
          };
        },
      };
    },
  ],

  title: 'Treq',
  tagline: 'The Open Source Graphite Alternative',
  favicon: 'img/favicon.svg',

  // Future flags, see https://docusaurus.io/docs/api/docusaurus-config#future
  future: {
    v4: true, // Improve compatibility with the upcoming Docusaurus v4
    faster: true, // Rspack/SWC/lightningcss build pipeline - smaller, faster bundles
  },

  // Set the production url of your site here
  url: 'https://treq.dev',
  // Set the /<baseUrl>/ pathname under which your site is served
  // For GitHub pages deployment, it is often '/<projectName>/'
  baseUrl: '/',

  // GitHub pages deployment config.
  // If you aren't using GitHub pages, you don't need these.
  organizationName: 'Ziinc', // Usually your GitHub org/user name.
  projectName: 'treq', // Usually your repo name.

  customFields: {
    featureFlags,
  },

  onBrokenLinks: 'throw',

  // Even if you don't use internationalization, you can use this field to set
  // useful metadata like html lang. For example, if your site is Chinese, you
  // may want to replace "en" with "zh-Hans".
  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          // Please change this to your repo.
          // Remove this to remove the "edit this page" links.
          editUrl:
            'https://github.com/Ziinc/treq/tree/main/docs/',
        },
        blog: false,
        theme: {
          customCss: ['./src/css/fonts.css', './src/css/custom.css'],
        },
        ...(shouldLoadGoogleTag ? {
          gtag: {
            trackingID: 'G-V9MPP2ZWZF',
            anonymizeIP: true,
          },
        } : {}),
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    // Replace with your project's social card
    // TODO: Replace with branded Treq social card (1200x630)
    image: 'img/treq-social-card.png',
    colorMode: {
      respectPrefersColorScheme: true,
    },
    navbar: {
      hideOnScroll: true,
      logo: {
        alt: 'Treq Logo',
        src: 'assets/combined-horizontal.png',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'learnSidebar',
          docsPluginId: 'learn',
          position: 'left',
          label: 'Learn',
        },
        {
          type: 'docSidebar',
          sidebarId: 'docsSidebar',
          position: 'left',
          label: 'Docs',
        },
        {
          type: 'docSidebar',
          sidebarId: 'compareSidebar',
          docsPluginId: 'compare',
          position: 'left',
          label: 'Compare',
        },
        {
          to: '/tools',
          label: 'Tools',
          position: 'left',
        },
        {
          to: '/pricing',
          label: 'Pricing',
          position: 'left',
        },
        {
          to: '/roadmap',
          label: 'Roadmap',
          position: 'left',
        },
        {
          to: '/changelog',
          label: 'Changelog',
          position: 'left',
        },

        ...(featureFlags.pro ? [{
          to: '/dashboard',
          label: 'Dashboard',
          position: 'right' as const,
        }] : []),
        {
          href: 'https://github.com/Ziinc/treq',
          label: 'GitHub',
          position: 'right',
        },
        {
          type: 'html',
          position: 'right',
          value: '<a href="/docs/getting-started/installation" class="button button--primary button--sm">Get Started</a>',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [
            {
              label: 'Installation',
              to: '/docs/getting-started/installation',
            },
            {
              label: 'Learn',
              to: '/learn',
            },
            {
              label: 'Concepts',
              to: '/learn/concepts',
            },
            {
              label: 'Security and Privacy',
              to: '/docs/security-and-privacy',
            },
            {
              label: 'Compare',
              to: '/compare',
            },
          ],
        },
        {
          title: 'More',
          items: [
            {
              label: 'Pricing',
              to: '/pricing',
            },
            {
              label: 'Roadmap',
              to: '/roadmap',
            },
            {
              label: 'Changelog',
              to: '/changelog',
            },
            {
              label: 'GitHub',
              href: 'https://github.com/Ziinc/treq',
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} Treq.<br />Treq is licensed under Apache License 2.0.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
