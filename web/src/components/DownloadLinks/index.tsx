import type {ReactNode} from 'react';
import clsx from 'clsx';
import {usePluginData} from '@docusaurus/useGlobalData';
import useIsBrowser from '@docusaurus/useIsBrowser';
import {
  RELEASE_PAGE_LINK,
  pickDownloads,
  type DownloadLink,
  type ReleaseAsset,
} from '@site/src/lib/downloads';
import styles from './styles.module.css';

type LatestReleaseData = {release: {assets: ReleaseAsset[]} | null} | undefined;

// The server render and first client render use the release page link. The
// OS-specific installer link swaps in after hydration.
function useDownloads() {
  const isBrowser = useIsBrowser();
  const data = usePluginData('latest-release-plugin') as LatestReleaseData;
  return pickDownloads(
    data?.release?.assets ?? [],
    isBrowser ? navigator.userAgent : '',
  );
}

function DownloadAnchor({
  link,
  className,
  children,
}: {
  link: DownloadLink;
  className?: string;
  children: ReactNode;
}): ReactNode {
  // Installers download in place. The release page opens in a new tab.
  const newTab =
    link.platform === 'release-page'
      ? {target: '_blank', rel: 'noopener noreferrer'}
      : {};
  return (
    <a className={className} href={link.href} {...newTab}>
      {children}
    </a>
  );
}

export function DownloadButton({
  className,
  label,
  icon,
}: {
  className?: string;
  label?: string;
  icon?: ReactNode;
}): ReactNode {
  const {primary} = useDownloads();
  return (
    <DownloadAnchor link={primary} className={className}>
      {icon}
      {label ?? primary.label}
    </DownloadAnchor>
  );
}

export function OtherDownloads({className}: {className?: string}): ReactNode {
  const {secondary} = useDownloads();
  return (
    <p className={clsx(styles.other, className)}>
      {secondary ? (
        <>
          <DownloadAnchor link={secondary}>{secondary.label}</DownloadAnchor>
          {' · '}
        </>
      ) : null}
      <DownloadAnchor link={RELEASE_PAGE_LINK}>Other platforms</DownloadAnchor>
    </p>
  );
}
