export interface Session {
  session_key: number;
  session_name: string;
  date_start: string;
  date_end: string;
  year: number;
  circuit_short_name: string;
  country_name: string;
}

export interface Driver {
  driver_number: number;
  broadcast_name: string;
  full_name: string;
  name_acronym: string;
  team_name: string;
  team_colour: string;
  headshot_url: string;
}

export interface CarData {
  date: string;
  rpm: number;
  speed: number;
  n_gear: number;
  throttle: number;
  brake: number;
  drs: number;
  session_key: number;
  meeting_key: number;
  driver_number: number;
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

export async function getSessions(year: number = 2024): Promise<Session[]> {
  const response = await fetchWithRetry(`${BASE_URL}/sessions?year=${year}`);
  if (!response.ok) throw new Error('Failed to fetch sessions');
  return response.json();
}

export async function getDrivers(sessionKey: number): Promise<Driver[]> {
  const response = await fetchWithRetry(`${BASE_URL}/drivers?session_key=${sessionKey}`);
  if (!response.ok) throw new Error('Failed to fetch drivers');
  return response.json();
}

export async function getCarData(sessionKey: number, driverNumber: number): Promise<CarData[]> {
  // To avoid fetching too much data, we can limit it or just fetch a specific timeframe if needed.
  const response = await fetchWithRetry(`${BASE_URL}/car_data?session_key=${sessionKey}&driver_number=${driverNumber}`);
  if (!response.ok) throw new Error('Failed to fetch car data');
  return response.json();
}

export async function getLocationData(sessionKey: number, driverNumber: number): Promise<LocationData[]> {
  const response = await fetchWithRetry(`${BASE_URL}/location?session_key=${sessionKey}&driver_number=${driverNumber}`);
  if (!response.ok) throw new Error('Failed to fetch location data');
  return response.json();
}

export async function getLaps(sessionKey: number, driverNumber?: number): Promise<LapData[]> {
  const url = driverNumber 
    ? `${BASE_URL}/laps?session_key=${sessionKey}&driver_number=${driverNumber}`
    : `${BASE_URL}/laps?session_key=${sessionKey}`;
  const response = await fetchWithRetry(url);
  if (!response.ok) throw new Error('Failed to fetch lap data');
  return response.json();
}
