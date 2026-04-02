import { useContext } from 'react';
import { DebugContext } from './DebugProvider.jsx';

export function useDebug() {
  const ctx = useContext(DebugContext);
  if (!ctx) throw new Error('Must be used inside DebugProvider');
  return ctx;
}

export function useLogger() {
  return useDebug().logger;
}

export function useFeature(name) {
  const { config } = useDebug();
  return config.features.has(name) && !config.disable.has(name);
}

export function useDebugFlag(name) {
  return useDebug().config.debug.has(name);
}

export function useRole() {
  return useDebug().config.role;
}

export function useForcedState() {
  return useDebug().config.state;
}
