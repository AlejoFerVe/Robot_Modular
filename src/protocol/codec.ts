import {
  CAPABILITIES,
  ERROR_CODES,
  MODULE_TYPES,
  PROTOCOL_VERSION,
  type Args,
  type Capability,
  type ErrorCode,
  type HelloResult,
  type ModuleReport,
  type ModuleType,
  type RequestMessage,
  type RobotMessage,
} from './types';

/**
 * Codificación JSON por líneas (un objeto JSON por línea, terminado en "\n").
 * Todo lo que llega del robot se valida aquí antes de usarse: un mensaje mal
 * formado nunca se interpreta como una confirmación.
 */

export const MAX_LINE_LENGTH = 2048;

export function encodeRequest(id: number, cmd: string, args: Args): string {
  const msg: RequestMessage = { v: PROTOCOL_VERSION.major, type: 'req', id, cmd, args };
  return JSON.stringify(msg) + '\n';
}

export type DecodeResult =
  | { readonly ok: true; readonly message: RobotMessage }
  | { readonly ok: false; readonly reason: string };

type Obj = Record<string, unknown>;

const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
const isId = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 0;
const fail = (reason: string): DecodeResult => ({ ok: false, reason });

function isModuleType(x: unknown): x is ModuleType {
  return typeof x === 'string' && (MODULE_TYPES as readonly string[]).includes(x);
}

function isErrorCode(x: unknown): x is ErrorCode {
  return typeof x === 'string' && (ERROR_CODES as readonly string[]).includes(x);
}

/**
 * Valida un informe de módulo. Las capacidades desconocidas (de un firmware
 * más nuevo) se descartan en lugar de rechazar todo el informe.
 */
export function parseModuleReport(x: unknown): ModuleReport | null {
  if (!isObj(x)) return null;
  const { type, typeId, firmware, capabilities, state, error } = x;
  if (!isModuleType(type)) return null;
  if (typeof typeId !== 'number' || !Number.isInteger(typeId)) return null;
  if (typeof firmware !== 'string') return null;
  if (!Array.isArray(capabilities)) return null;
  if (state !== 'ok' && state !== 'error' && state !== 'absent') return null;
  if (error !== undefined && typeof error !== 'string') return null;
  const caps = capabilities.filter(
    (c): c is Capability => typeof c === 'string' && (CAPABILITIES as readonly string[]).includes(c),
  );
  return {
    type,
    typeId,
    firmware,
    // Un módulo que no está operativo no aporta capacidades.
    capabilities: state === 'ok' ? caps : [],
    state,
    ...(typeof error === 'string' ? { error } : {}),
  };
}

export function parseModuleList(x: unknown): ModuleReport[] | null {
  if (!Array.isArray(x)) return null;
  const out: ModuleReport[] = [];
  for (const item of x) {
    const report = parseModuleReport(item);
    if (!report) return null;
    out.push(report);
  }
  return out;
}

export function parseHelloResult(result: Readonly<Record<string, unknown>>): HelloResult | null {
  const { protocol, robot, firmware, modules } = result;
  if (typeof protocol !== 'string' || typeof robot !== 'string' || typeof firmware !== 'string') return null;
  const parsed = parseModuleList(modules);
  if (!parsed) return null;
  return { protocol, robot, firmware, modules: parsed };
}

export function decodeLine(line: string): DecodeResult {
  if (line.length > MAX_LINE_LENGTH) return fail('línea demasiado larga');
  let data: unknown;
  try {
    data = JSON.parse(line);
  } catch {
    return fail('JSON no válido');
  }
  if (!isObj(data)) return fail('el mensaje no es un objeto');
  const { v, type } = data;
  if (typeof v !== 'number' || !Number.isInteger(v)) return fail('falta la versión "v"');
  if (v !== PROTOCOL_VERSION.major) return fail(`versión de protocolo ${v} no compatible`);

  switch (type) {
    case 'ack':
      return isId(data['id']) ? { ok: true, message: { v, type, id: data['id'] } } : fail('ack sin id');
    case 'done': {
      const { id, result } = data;
      if (!isId(id)) return fail('done sin id');
      const res = result === undefined ? {} : result;
      if (!isObj(res)) return fail('done con resultado no válido');
      return { ok: true, message: { v, type, id, result: res } };
    }
    case 'err': {
      const { id, code, msg } = data;
      if (id !== null && !isId(id)) return fail('err con id no válido');
      if (!isErrorCode(code)) return fail('err con código desconocido');
      return { ok: true, message: { v, type, id, code, msg: typeof msg === 'string' ? msg : '' } };
    }
    case 'evt': {
      const { evt } = data;
      if (evt === 'modules') {
        const modules = parseModuleList(data['modules']);
        return modules ? { ok: true, message: { v, type, evt, modules } } : fail('evento modules no válido');
      }
      if (evt === 'status') {
        const { busy, uptime_ms } = data;
        if (typeof busy !== 'boolean' || typeof uptime_ms !== 'number') return fail('evento status no válido');
        return { ok: true, message: { v, type, evt, busy, uptime_ms } };
      }
      return fail('evento desconocido');
    }
    default:
      return fail('tipo de mensaje desconocido');
  }
}

/** Compatibilidad: misma versión mayor. Una versión menor distinta es compatible. */
export function isProtocolCompatible(remote: string): boolean {
  const match = /^(\d+)\.(\d+)$/.exec(remote);
  if (!match) return false;
  return Number(match[1]) === PROTOCOL_VERSION.major;
}

export const APP_PROTOCOL_STRING = `${PROTOCOL_VERSION.major}.${PROTOCOL_VERSION.minor}`;

/** Separa un flujo de texto en líneas completas. Descarta líneas demasiado largas. */
export class LineBuffer {
  private buffer = '';
  private discarding = false;

  push(chunk: string): string[] {
    this.buffer += chunk;
    const lines: string[] = [];
    let idx: number;
    while ((idx = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, idx).replace(/\r$/, '');
      this.buffer = this.buffer.slice(idx + 1);
      if (this.discarding) {
        this.discarding = false;
        continue;
      }
      if (line.trim().length > 0) lines.push(line);
    }
    if (this.buffer.length > MAX_LINE_LENGTH) {
      this.buffer = '';
      this.discarding = true;
    }
    return lines;
  }
}
