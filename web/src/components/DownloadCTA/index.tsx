import type {ReactNode} from 'react';
import Link from '@docusaurus/Link';
import styles from './styles.module.css';

export const DOWNLOAD_HREF = 'https://github.com/Ziinc/treq/releases';

export default function DownloadCTA({
  title = 'Run parallel agents with Treq',
}: {
  title?: string;
}): ReactNode {
  return (
    <aside className={styles.cta}>
      <p className={styles.title}>{title}</p>
      <p className={styles.body}>
        Free, open source desktop app for Claude, Codex, and Cursor workspaces.
        macOS, Windows, and Linux.
      </p>
      <div className={styles.actions}>
        <Link className="button button--primary" href={DOWNLOAD_HREF}>
          Download Treq
        </Link>
        <Link className="button button--secondary" to="/pricing">
          See pricing
        </Link>
      </div>
    </aside>
  );
}
