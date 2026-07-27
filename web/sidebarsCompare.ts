import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  compareSidebar: [
    {
      type: 'doc',
      id: 'index',
      label: 'Overview',
    },
    'treq-vs-superset',
    'treq-vs-conductor',
    'treq-vs-emdash',
    'treq-vs-claude-squad',
    'treq-vs-graphite-for-ai-teams',
    'treq-vs-orca',
  ],
};

export default sidebars;
