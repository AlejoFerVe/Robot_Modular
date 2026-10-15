import { MODULE_TYPES, type Capability, type ModuleReport, type ModuleType } from '../protocol/types';

/**
 * Estado visible de cada módulo. Se deriva SOLO de lo que informa el robot:
 * sin conexión, ningún módulo se muestra como detectado.
 */
export type ModuleStatus = 'unknown' | 'detected' | 'disconnected' | 'error';

export interface ModuleView {
  readonly type: ModuleType;
  readonly status: ModuleStatus;
  readonly firmware: string;
  readonly capabilities: readonly Capability[];
  readonly error?: string;
}

export type ModuleViews = Readonly<Record<ModuleType, ModuleView>>;

export function deriveModuleViews(reports: readonly ModuleReport[] | null): ModuleViews {
  const views = {} as Record<ModuleType, ModuleView>;
  for (const type of MODULE_TYPES) {
    if (reports === null) {
      views[type] = { type, status: 'unknown', firmware: '', capabilities: [] };
      continue;
    }
    const report = reports.find((r) => r.type === type);
    if (!report || report.state === 'absent') {
      views[type] = { type, status: 'disconnected', firmware: '', capabilities: [] };
    } else if (report.state === 'error') {
      views[type] = {
        type,
        status: 'error',
        firmware: report.firmware,
        capabilities: [],
        ...(report.error ? { error: report.error } : {}),
      };
    } else {
      views[type] = { type, status: 'detected', firmware: report.firmware, capabilities: report.capabilities };
    }
  }
  return views;
}

export function availableCapabilities(views: ModuleViews): ReadonlySet<Capability> {
  const caps = new Set<Capability>();
  for (const type of MODULE_TYPES) {
    if (views[type].status === 'detected') for (const c of views[type].capabilities) caps.add(c);
  }
  return caps;
}

/** Capacidades que estaban y ya no están. */
export function lostCapabilities(before: ReadonlySet<Capability>, after: ReadonlySet<Capability>): Capability[] {
  return [...before].filter((c) => !after.has(c));
}
