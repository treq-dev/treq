import { useRef, useState, useSyncExternalStore } from "react";
const mutatingCounts = new Map<string, number>();
const mutationListeners = new Set<() => void>();

function serializeMutationKey(key: readonly unknown[]): string {
  return JSON.stringify(key);
}

function emitMutationChange() {
  for (const listener of mutationListeners) listener();
}

function beginMutation(key: readonly unknown[] | undefined) {
  if (!key) return;
  const serialized = serializeMutationKey(key);
  mutatingCounts.set(serialized, (mutatingCounts.get(serialized) ?? 0) + 1);
  emitMutationChange();
}

function endMutation(key: readonly unknown[] | undefined) {
  if (!key) return;
  const serialized = serializeMutationKey(key);
  const next = (mutatingCounts.get(serialized) ?? 1) - 1;
  if (next <= 0) mutatingCounts.delete(serialized);
  else mutatingCounts.set(serialized, next);
  emitMutationChange();
}

export function useIsMutating(key: readonly unknown[]): boolean {
  const serialized = serializeMutationKey(key);
  return useSyncExternalStore(
    (onStoreChange) => {
      mutationListeners.add(onStoreChange);
      return () => {
        mutationListeners.delete(onStoreChange);
      };
    },
    () => (mutatingCounts.get(serialized) ?? 0) > 0,
  );
}

export type MutationResult<TData, TVariables> = {
  mutate: (variables: TVariables) => void;
  mutateAsync: (variables: TVariables) => Promise<TData>;
  isPending: boolean;
  isError: boolean;
  error: unknown;
};

export function useMutation<TData, TVariables = void>(options: {
  mutationFn: (variables: TVariables) => Promise<TData>;
  mutationKey?: readonly unknown[];
  onSuccess?: (data: TData, variables: TVariables) => void | Promise<void>;
  onError?: (error: unknown, variables: TVariables) => void;
}): MutationResult<TData, TVariables> {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const [localPending, setLocalPending] = useState(false);
  const [error, setError] = useState<unknown>(undefined);
  const sharedPending = useIsMutating(options.mutationKey ?? []);
  const isPending = options.mutationKey ? sharedPending : localPending;

  const mutateAsync = async (variables: TVariables) => {
    const opts = optionsRef.current;
    setLocalPending(true);
    setError(undefined);
    beginMutation(opts.mutationKey);
    try {
      const data = await opts.mutationFn(variables);
      await opts.onSuccess?.(data, variables);
      return data;
    } catch (err) {
      setError(err);
      opts.onError?.(err, variables);
      throw err;
    } finally {
      endMutation(opts.mutationKey);
      setLocalPending(false);
    }
  };

  const mutate = (variables: TVariables) => {
    void mutateAsync(variables);
  };

  return {
    mutate,
    mutateAsync,
    isPending,
    isError: error !== undefined,
    error,
  };
}
