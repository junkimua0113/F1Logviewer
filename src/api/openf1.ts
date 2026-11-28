export interface Session {
  session_key: number;
  session_name: string;
  date_start: string;
  date_end: string;
  gmt_offset: string;
  session_type: string;
  meeting_key: number;
  location: string;
  country_key: number;
  country_code: string;
  country_name: string;
  circuit_key: number;
  circuit_short_name: string;
  year: number;
}

export interface Driver {
  driver_number: number;
  broadcast_name: string;
  full_name: string;
  name_acronym: string;
  team_name: string;
  team_colour: string;
  first_name: string;
  last_name: string;
  headshot_url: string;
  country_code: string;
  session_key: number;
  meeting_key: number;
}

export interface CarData {
  date: string;
  driver_number: number;
  rpm: number;
  speed: number;
  n_gear: number;
  throttle: number;
  brake: number;
  drs: number;
  session_key: number;
  meeting_key: number;
}

export interface LocationData {
  date: string;
  x: number;
  y: number;
  z: number;
  session_key: number;
  meeting_key: number;
  driver_number: number;
}

export interface LapData {
  meeting_key: number;
  session_key: number;
  driver_number: number;
  lap_number: number;
  date_start: string;
  lap_duration: number | null;
  duration_sector_1: number | null;
  duration_sector_2: number | null;
  duration_sector_3: number | null;
  is_pit_out_lap: boolean;
}

const BASE_URL = 'https://api.openf1.org/v1';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchWithRetry(url: string, maxRetries = 4): Promise<Response> {
  let retries = 0;
  while (retries < maxRetries) {
    const response = await fetch(url);
    if (response.status === 429) {
      const waitTime = Math.pow(2, retries) * 1000; // 1s, 2s, 4s, 8s
      console.warn(`Rate limit hit (429) for ${url}. Retrying in ${waitTime}ms...`);
      await delay(waitTime);
      retries++;
    } else {
      return response;
    }
  }
  throw new Error(`Failed to fetch after ${maxRetries} retries: 429 Too Many Requests`);
}

async function fetchJsonArray<T>(url: string): Promise<T[]> {
  const response = await fetchWithRetry(url);
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`API error (${response.status}): ${errText}`);
  }
  const data = await response.json();
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    if ('detail' in data) {
      throw new Error(`OpenF1 Notice: ${data.detail}`);
    }
    return [];
  }
  return Array.isArray(data) ? data : [];
}

export async function getSessions(year: number = 2024): Promise<Session[]> {
  return fetchJsonArray<Session>(`${BASE_URL}/sessions?year=${year}`);
}

export async function getDrivers(sessionKey: number): Promise<Driver[]> {
  return fetchJsonArray<Driver>(`${BASE_URL}/drivers?session_key=${sessionKey}`);
}

export async function getCarData(sessionKey: number, driverNumber: number): Promise<CarData[]> {
  return fetchJsonArray<CarData>(`${BASE_URL}/car_data?session_key=${sessionKey}&driver_number=${driverNumber}`);
}

export async function getLocationData(sessionKey: number, driverNumber: number): Promise<LocationData[]> {
  return fetchJsonArray<LocationData>(`${BASE_URL}/location?session_key=${sessionKey}&driver_number=${driverNumber}`);
}

export async function getLaps(sessionKey: number, driverNumber?: number): Promise<LapData[]> {
  const url = driverNumber 
    ? `${BASE_URL}/laps?session_key=${sessionKey}&driver_number=${driverNumber}`
    : `${BASE_URL}/laps?session_key=${sessionKey}`;
  return fetchJsonArray<LapData>(url);
}
