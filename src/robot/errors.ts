import type { ErrorCode } from '../protocol/types';

/** Errores del lado de la app (no los envía el robot). */
export type LocalErrorCode = 'TIMEOUT' | 'LINK_LOST' | 'NOT_CONNECTED' | 'INCOMPATIBLE' | 'BAD_RESPONSE';

export type RobotErrorCode = ErrorCode | LocalErrorCode;

export class RobotError extends Error {
  constructor(
    readonly code: RobotErrorCode,
    readonly detail = '',
  ) {
    super(friendlyMessage(code, detail));
    this.name = 'RobotError';
  }
}

/** Mensajes comprensibles para niños de 10 a 14 años. */
export function friendlyMessage(code: RobotErrorCode, detail = ''): string {
  switch (code) {
    case 'TIMEOUT':
      return 'El robot tardó demasiado en responder. Revisa que esté encendido y conectado.';
    case 'LINK_LOST':
      return 'Se perdió la comunicación con el robot. Revisa el cable y la batería.';
    case 'NOT_CONNECTED':
      return 'Primero conecta el robot (o usa el simulador).';
    case 'INCOMPATIBLE':
      return `La versión del robot no es compatible con esta aplicación. Pide ayuda para actualizarla. ${detail}`.trim();
    case 'BAD_RESPONSE':
      return 'El robot respondió algo que no se entiende. Intenta de nuevo.';
    case 'MODULE_UNAVAILABLE':
      return 'Una pieza del robot no está conectada o no responde.';
    case 'BUSY':
      return 'El robot todavía está haciendo otra cosa.';
    case 'ABORTED':
      return 'El robot se detuvo.';
    case 'INVALID_ARGS':
      return `Un valor del bloque no es válido. ${detail}`.trim();
    case 'NOT_IMPLEMENTED':
      return 'El robot todavía no sabe hacer esa acción.';
    case 'HARDWARE_ERROR':
    case 'I2C_ERROR':
      return 'Una pieza del robot tuvo un problema. Revisa las conexiones.';
    case 'VERSION_MISMATCH':
      return 'El robot usa otra versión del idioma de comunicación. Pide ayuda para actualizarlo.';
    case 'BAD_REQUEST':
    case 'UNKNOWN_COMMAND':
      return 'El robot no entendió la orden. Puede que necesite actualizarse.';
  }
}
