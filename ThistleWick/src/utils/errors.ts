/**
 * Typed application errors.
 *
 * I. Why a dedicated error type
 *
 * 1. The brief requires graceful handling of a hostile environment (no WebGL,
 *    blocked storage, failed workers). A `code` makes the recovering layer able
 *    to branch on the failure without string matching on messages.
 * 2. `userMessage` is written for players, `message` for developers. Keeping
 *    both prevents the classic mistake of showing a stack trace on screen.
 *
 * @module utils/errors
 */

/** Machine readable failure categories. */
export type AppErrorCode =
  | 'WEBGL_UNAVAILABLE'
  | 'RENDERER_INIT_FAILED'
  | 'ASSET_LOAD_FAILED'
  | 'WORKER_UNAVAILABLE'
  | 'AUDIO_INIT_FAILED'
  | 'STORAGE_UNAVAILABLE'
  | 'SAVE_CORRUPTED'
  | 'SAVE_VERSION_UNSUPPORTED'
  | 'WORLD_GENERATION_FAILED'
  | 'UNKNOWN';

export interface AppErrorOptions {
  /** Message shown to the player; falls back to a per-code default. */
  readonly userMessage?: string;
  /** Original error, preserved for the console and for bug reports. */
  readonly cause?: unknown;
  /** Extra context attached for debugging; never shown as the primary text. */
  readonly context?: Readonly<Record<string, unknown>>;
}

const DEFAULT_USER_MESSAGE: Readonly<Record<AppErrorCode, string>> = {
  WEBGL_UNAVAILABLE:
    'Your browser or graphics driver does not support WebGL 2, so the game cannot start. Update your browser or enable hardware acceleration.',
  RENDERER_INIT_FAILED:
    'The renderer could not initialize. Reload the page and check your graphics driver if the problem continues.',
  ASSET_LOAD_FAILED: 'Game assets could not be loaded. Check your connection and reload the page.',
  WORKER_UNAVAILABLE:
    'Background workers are unavailable. The game will continue with reduced performance and chunk generation may stutter.',
  AUDIO_INIT_FAILED: 'Audio could not initialize. The game will continue without sound.',
  STORAGE_UNAVAILABLE:
    'Browser storage is unavailable, so worlds cannot be saved. Check private browsing and site permission settings.',
  SAVE_CORRUPTED:
    'This save is corrupted and cannot be loaded. You can create a new world to continue.',
  SAVE_VERSION_UNSUPPORTED:
    'This save was created by a newer game version and cannot be loaded here.',
  WORLD_GENERATION_FAILED: 'World generation failed. Try creating a world with a different seed.',
  UNKNOWN: 'An unexpected error occurred. Reload the page and try again.',
};

export class AppError extends Error {
  public readonly code: AppErrorCode;
  public readonly userMessage: string;
  public readonly context: Readonly<Record<string, unknown>>;

  public constructor(code: AppErrorCode, message: string, options: AppErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.userMessage = options.userMessage ?? DEFAULT_USER_MESSAGE[code];
    this.context = options.context ?? {};
  }
}

/**
 * Normalises anything throwable into an {@link AppError}.
 *
 * @param value - Caught value of unknown shape.
 * @param fallbackCode - Code used when `value` is not already an `AppError`.
 * @returns A guaranteed `AppError` instance.
 */
export function toAppError(value: unknown, fallbackCode: AppErrorCode = 'UNKNOWN'): AppError {
  if (value instanceof AppError) {
    return value;
  }
  if (value instanceof Error) {
    return new AppError(fallbackCode, value.message, { cause: value });
  }
  return new AppError(fallbackCode, String(value), { cause: value });
}
