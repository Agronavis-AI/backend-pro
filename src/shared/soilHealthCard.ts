import axios from 'axios';

/**
 * The Soil Health Card portal's GraphQL API, which answers without a key.
 *
 * Shared by the soil sync and the fertiliser sync: both read the same endpoint,
 * and it rejects requests that do not look like they came from its own web app.
 */
const API = 'https://soilhealth4.dac.gov.in';

const HEADERS = {
  'Content-Type': 'application/json',
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  Origin: 'https://soilhealth.dac.gov.in',
  Referer: 'https://soilhealth.dac.gov.in/',
};

export interface ShcState {
  _id: string;
  name: string;
}

export async function shcQuery<T>(
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const { data } = await axios.post<{ data: T; errors?: { message: string }[] }>(
    API,
    { query, variables },
    { headers: HEADERS, timeout: 90_000 },
  );
  if (data.errors?.length) throw new Error(data.errors[0].message);
  return data.data;
}

/** Every state and UT the scheme knows, with the ids its other queries expect. */
export async function shcStates(): Promise<ShcState[]> {
  const { getState } = await shcQuery<{ getState: ShcState[] }>('query GetState { getState }');
  return (getState ?? []).filter((s) => s?._id && s?.name);
}

/** "ANDHRA PRADESH" reads badly in a list; lookups lower-case anyway. */
export function titleCase(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase())
    .replace(/\s+/g, ' ')
    .trim();
}
