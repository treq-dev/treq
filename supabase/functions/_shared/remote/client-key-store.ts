// Storage helpers for remote_client_keys and remote_endpoint_authorized_keys,
// used by the remote-ssh-trust Edge Function. Only public key material and
// metadata are ever written here (PRD "Client key policy").

import type { SupabaseClient } from "npm:@supabase/supabase-js@2.95.3";

export interface ClientKeyRow {
  id: string;
  owner_user_id: string;
  public_key: string;
  algorithm: string;
  fingerprint_sha256: string;
  comment: string | null;
  created_at: string;
  revoked_at: string | null;
}

export async function findClientKeyByFingerprint(
  supabase: SupabaseClient,
  ownerUserId: string,
  fingerprintSha256: string,
): Promise<ClientKeyRow | null> {
  const { data, error } = await supabase
    .from("remote_client_keys")
    .select("*")
    .eq("owner_user_id", ownerUserId)
    .eq("fingerprint_sha256", fingerprintSha256)
    .maybeSingle();
  if (error) throw new Error(`failed to look up client key: ${error.message}`);
  return data as ClientKeyRow | null;
}

export async function insertClientKey(
  supabase: SupabaseClient,
  params: { ownerUserId: string; publicKey: string; algorithm: string; fingerprintSha256: string; comment: string | null },
): Promise<ClientKeyRow> {
  const { data, error } = await supabase
    .from("remote_client_keys")
    .insert({
      owner_user_id: params.ownerUserId,
      public_key: params.publicKey,
      algorithm: params.algorithm,
      fingerprint_sha256: params.fingerprintSha256,
      comment: params.comment,
    })
    .select()
    .single();
  if (error) throw new Error(`failed to register client key: ${error.message}`);
  return data as ClientKeyRow;
}

export async function listClientKeys(supabase: SupabaseClient, ownerUserId: string): Promise<ClientKeyRow[]> {
  const { data, error } = await supabase
    .from("remote_client_keys")
    .select("*")
    .eq("owner_user_id", ownerUserId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`failed to list client keys: ${error.message}`);
  return (data ?? []) as ClientKeyRow[];
}

// Ownership is enforced by the `owner_user_id` filter here, not by trusting
// the caller-supplied key id alone (PRD "Security requirements").
export async function getOwnedClientKey(
  supabase: SupabaseClient,
  ownerUserId: string,
  keyId: string,
): Promise<ClientKeyRow | null> {
  const { data, error } = await supabase
    .from("remote_client_keys")
    .select("*")
    .eq("owner_user_id", ownerUserId)
    .eq("id", keyId)
    .maybeSingle();
  if (error) throw new Error(`failed to read client key: ${error.message}`);
  return data as ClientKeyRow | null;
}

export async function revokeClientKey(supabase: SupabaseClient, ownerUserId: string, keyId: string): Promise<void> {
  const { error } = await supabase
    .from("remote_client_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("owner_user_id", ownerUserId)
    .eq("id", keyId);
  if (error) throw new Error(`failed to revoke client key: ${error.message}`);
}

export interface AuthorizedKeyRow {
  id: string;
  endpoint_id: string;
  client_key_id: string;
  installed_at: string;
  removed_at: string | null;
}

export async function findActiveAuthorizedKey(
  supabase: SupabaseClient,
  endpointId: string,
  clientKeyId: string,
): Promise<AuthorizedKeyRow | null> {
  const { data, error } = await supabase
    .from("remote_endpoint_authorized_keys")
    .select("*")
    .eq("endpoint_id", endpointId)
    .eq("client_key_id", clientKeyId)
    .is("removed_at", null)
    .maybeSingle();
  if (error) throw new Error(`failed to look up authorized key record: ${error.message}`);
  return data as AuthorizedKeyRow | null;
}

export async function recordAuthorizedKeyInstalled(
  supabase: SupabaseClient,
  params: { ownerUserId: string; endpointId: string; clientKeyId: string },
): Promise<void> {
  const { error } = await supabase.from("remote_endpoint_authorized_keys").upsert(
    {
      owner_user_id: params.ownerUserId,
      endpoint_id: params.endpointId,
      client_key_id: params.clientKeyId,
      installed_at: new Date().toISOString(),
      removed_at: null,
    },
    { onConflict: "endpoint_id,client_key_id" },
  );
  if (error) throw new Error(`failed to record authorized key install: ${error.message}`);
}

export async function recordAuthorizedKeyRemoved(
  supabase: SupabaseClient,
  endpointId: string,
  clientKeyId: string,
): Promise<void> {
  const { error } = await supabase
    .from("remote_endpoint_authorized_keys")
    .update({ removed_at: new Date().toISOString() })
    .eq("endpoint_id", endpointId)
    .eq("client_key_id", clientKeyId);
  if (error) throw new Error(`failed to record authorized key removal: ${error.message}`);
}
