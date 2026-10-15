import { useSyncExternalStore } from 'react';

export interface Store<T> {
  subscribe(listener: () => void): () => void;
  getSnapshot(): T;
}

export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
