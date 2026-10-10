import React, {useCallback, useEffect, useState, type ReactNode} from 'react';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';
import BrowserOnly from '@docusaurus/BrowserOnly';
import type {User} from '@supabase/supabase-js';
import {supabase} from '../lib/supabase';
import {
  ALPHA_FORM_VERSION,
  alphaSignInHref,
  alphaSourcePage,
  sessionStore,
  stashPendingJoin,
  takePendingJoin,
} from '../lib/alpha';

import styles from './alpha.module.css';

const CONSENT_TEXT =
  'Email me alpha invitations and updates. Unsubscribe any time.';

interface Membership {
  consented_at: string;
  unsubscribed_at: string | null;
}

type JoinWrite = () => PromiseLike<{error: {message: string} | null}>;

function joinWaitlist(user: User, sourcePage: string): JoinWrite {
  // The database stamps consented_at, and a rejoin clears unsubscribed_at
  // and records a new consent (see the alpha_waitlist migration).
  return () =>
    supabase.from('alpha_waitlist').upsert(
      {
        user_id: user.id,
        form_version: ALPHA_FORM_VERSION,
        source_page: sourcePage,
        unsubscribed_at: null,
      },
      {onConflict: 'user_id'},
    );
}

function ConsentCheckbox({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
}): ReactNode {
  return (
    <label className={styles.consent}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{CONSENT_TEXT}</span>
    </label>
  );
}

function SignedOutJoin(): ReactNode {
  const [consent, setConsent] = useState(false);

  const signInToJoin = () => {
    stashPendingJoin(sessionStore(), alphaSourcePage(window.location.search));
    window.location.href = alphaSignInHref();
  };

  return (
    <div className={styles.card} data-testid="alpha-join">
      <Heading as="h2">Join the waitlist</Heading>
      <p className={styles.muted}>
        Joining needs a free Treq account, so invitations go to the address
        you sign in with. It does not change your plan or billing.
      </p>
      <ConsentCheckbox checked={consent} onChange={setConsent} />
      <button
        type="button"
        className="button button--primary"
        disabled={!consent}
        onClick={signInToJoin}>
        Sign in to join
      </button>
    </div>
  );
}

function SignedInJoin({user}: {user: User}): ReactNode {
  const [membership, setMembership] = useState<Membership | null>(null);
  const [loading, setLoading] = useState(true);
  const [consent, setConsent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Row-level security returns only the signed-in user's row.
  const load = useCallback(async () => {
    const {data, error: loadError} = await supabase
      .from('alpha_waitlist')
      .select('consented_at, unsubscribed_at')
      .maybeSingle();
    if (loadError) setError(loadError.message);
    setMembership((data as Membership | null) ?? null);
    setLoading(false);
  }, []);

  const save = useCallback(
    async (write: JoinWrite) => {
      setSaving(true);
      setError(null);
      const {error: saveError} = await write();
      if (saveError) {
        setError(saveError.message);
      } else {
        setConsent(false);
        await load();
      }
      setSaving(false);
    },
    [load],
  );

  useEffect(() => {
    // A visitor who ticked the consent box before signing in comes back
    // here. Finish that join instead of asking them to tick it again.
    const pending = takePendingJoin(sessionStore());
    if (pending) {
      save(joinWaitlist(user, pending.sourcePage));
    } else {
      load();
    }
  }, [load, save, user]);

  const leave = () =>
    save(() =>
      supabase
        .from('alpha_waitlist')
        .update({unsubscribed_at: new Date().toISOString()})
        .eq('user_id', user.id),
    );

  if (loading) {
    return <div className={styles.card}>Loading…</div>;
  }

  if (membership && !membership.unsubscribed_at) {
    return (
      <div className={styles.card} data-testid="alpha-join">
        <Heading as="h2">You're on the waitlist</Heading>
        <p>
          <span className={styles.badge}>Joined</span>
          <span className={styles.muted}>
            {new Date(membership.consented_at).toLocaleDateString()}
          </span>
        </p>
        <p className={styles.muted}>
          Treq will email {user.email} with alpha invitations and updates.
          Every email has an unsubscribe link.
        </p>
        <button
          type="button"
          className="button button--secondary"
          disabled={saving}
          onClick={leave}>
          {saving ? 'Leaving…' : 'Leave the waitlist'}
        </button>
        {error && <div className={styles.error}>{error}</div>}
      </div>
    );
  }

  return (
    <div className={styles.card} data-testid="alpha-join">
      <Heading as="h2">Join the waitlist</Heading>
      {membership?.unsubscribed_at && (
        <p className={styles.muted}>
          You left the waitlist on{' '}
          {new Date(membership.unsubscribed_at).toLocaleDateString()}. Treq
          will not send you alpha emails unless you join again.
        </p>
      )}
      <p className={styles.muted}>
        Joining lets Treq email {user.email} about this alpha: invitations to
        try it, and updates on its progress. It does not change your plan or
        billing.
      </p>
      <ConsentCheckbox checked={consent} onChange={setConsent} />
      <button
        type="button"
        className="button button--primary"
        disabled={!consent || saving}
        onClick={() =>
          save(joinWaitlist(user, alphaSourcePage(window.location.search)))
        }>
        {saving ? 'Joining…' : 'Join the alpha'}
      </button>
      {error && <div className={styles.error}>{error}</div>}
    </div>
  );
}

function JoinPanel(): ReactNode {
  const [user, setUser] = useState<User | null | undefined>(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({data: {session}}) => {
      setUser(session?.user ?? null);
    });
  }, []);

  if (user === undefined) {
    return <div className={styles.card}>Loading…</div>;
  }
  return user ? <SignedInJoin user={user} /> : <SignedOutJoin />;
}

export default function AlphaPage(): ReactNode {
  return (
    <Layout
      title="Private alpha"
      description="Join the waitlist for Treq's private alpha of managed cloud workspaces and SSH Remote Development.">
      <main className={styles.page}>
        <Heading as="h1" className={styles.title}>
          Private alpha
        </Heading>
        <p className={styles.intro}>
          Two Treq features are in a private alpha. Treq invites people from
          the waitlist in batches and emails each invitation.
        </p>
        <ul className={styles.features}>
          <li className={styles.feature}>
            <Heading as="h2">Managed cloud workspaces</Heading>
            <p>
              Your workspaces and agents run on a machine that Treq hosts
              instead of your laptop.
            </p>
          </li>
          <li className={styles.feature}>
            <Heading as="h2">SSH Remote Development</Heading>
            <p>
              Treq opens a repository on your own server over SSH, and agents
              run there.
            </p>
          </li>
        </ul>
        <BrowserOnly
          fallback={<div className={styles.card}>Loading…</div>}>
          {() => <JoinPanel />}
        </BrowserOnly>
      </main>
    </Layout>
  );
}
