export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...init });
  if (!response.ok) {
    throw new ApiError(response.status, 'That request could not be completed. Please try again.');
  }
  return response.json() as Promise<T>;
}

export function timeLabel(seconds: number): string {
  const value = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const rest = String(value % 60).padStart(2, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
}

export const originLabels = {
  archived_research: 'Original research transcript',
  talkbank_ai_draft: 'TalkBank AI transcript draft',
  local_ai_draft: 'Local AI transcript draft',
} as const;
