import { useState, useEffect } from 'react'
import { getSessions, getDrivers, getCarData, getLocationData, getLaps } from './api/openf1'
import type { Session, Driver, CarData, LocationData, LapData } from './api/openf1'
import { TelemetryChart } from './components/TelemetryChart'
import { TrackMap } from './components/TrackMap'
import { Leaderboard } from './components/Leaderboard'
import { Group as PanelGroup, Panel, Separator as PanelResizeHandle } from 'react-resizable-panels'
import './App.css'

function App() {
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear())
  const [sessions, setSessions] = useState<Session[]>([])
  const [selectedSession, setSelectedSession] = useState<number | ''>('')
  
  const [drivers, setDrivers] = useState<Driver[]>([])
  const [selectedDriver, setSelectedDriver] = useState<number | ''>('')
  
  const [fractionalProgress, setFractionalProgress] = useState<number>(0)

  const [carData, setCarData] = useState<CarData[]>([])
  const [locationData, setLocationData] = useState<LocationData[]>([])
  const [allLocations, setAllLocations] = useState<Record<number, LocationData[]>>({})
  const [laps, setLaps] = useState<LapData[]>([])
  
  const [isLoading, setIsLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string>('')
  const [currentTimeIndex, setCurrentTimeIndex] = useState(0)
  
  const [isPlaying, setIsPlaying] = useState(false)
  const [playbackSpeed, setPlaybackSpeed] = useState(10)
  const [zoomRadius, setZoomRadius] = useState<number>(0)

  // Fetch initial sessions when year changes
  useEffect(() => {
    async function loadSessions() {
      try {
        setErrorMsg('');
        const data = await getSessions(selectedYear);
        // Sort sessions by date descending
        const sorted = data.sort((a, b) => new Date(b.date_start).getTime() - new Date(a.date_start).getTime());
        setSessions(sorted);
        
        if (sorted.length > 0) {
          const now = new Date().getTime();
          // Find the most recent session that has already started, or just the first one if all are future
          const pastSession = sorted.find(s => new Date(s.date_start).getTime() < now);
          setSelectedSession(pastSession ? pastSession.session_key : sorted[0].session_key);
        } else {
          setSelectedSession('');
          setDrivers([]);
          setCarData([]);
          setLocationData([]);
          setAllLocations({});
          setLaps([]);
        }
      } catch (err) {
        console.error("Failed to load sessions", err);
        setErrorMsg('Failed to load sessions for this year.');
      }
    }
    loadSessions();
  }, [selectedYear]);

  // Fetch drivers and session-wide data when session changes
  useEffect(() => {
    if (!selectedSession) return;
    
    async function loadSessionData() {
      setAllLocations({}); // Clear previous session's location cache
      try {
        const [driversData, lapsData] = await Promise.all([
          getDrivers(selectedSession as number),
          getLaps(selectedSession as number)
        ]);
        
        setDrivers(driversData);
        setLaps(lapsData);
        
        if (driversData.length > 0) {
          setSelectedDriver(driversData[0].driver_number);
        }
      } catch (err) {
        console.error("Failed to load session data", err);
        setErrorMsg('Failed to load drivers or laps. API rate limit may be hit.');
      }
    }
    loadSessionData();
  }, [selectedSession]);

  // Fetch telemetry when driver changes
  useEffect(() => {
    if (!selectedSession || !selectedDriver) return;

    async function loadTelemetry() {
      setIsLoading(true);
      setErrorMsg('');
      setCurrentTimeIndex(0);
      try {
        // Only fetch if we don't already have the location data for this driver
        const fetchLocation = !allLocations[selectedDriver as number];
        
        const promises: Promise<any>[] = [
          getCarData(selectedSession as number, selectedDriver as number)
        ];
        
        if (fetchLocation) {
          promises.push(getLocationData(selectedSession as number, selectedDriver as number));
        }

        const results = await Promise.all(promises);
        const car = results[0];
        const loc = fetchLocation ? results[1] : allLocations[selectedDriver as number];
        
        if (!car || car.length === 0) {
          setErrorMsg('No telemetry data available for this session yet. It might be a future race or data is incomplete.');
          return;
        }

        setCarData(car);
        setLocationData(loc);
        
        if (fetchLocation) {
          setAllLocations(prev => ({ ...prev, [selectedDriver as number]: loc }));
        }

        // Background load other drivers if not already loaded
        const otherDrivers = drivers.filter(d => d.driver_number !== selectedDriver);
        (async () => {
          for (const d of otherDrivers) {
            // Skip if already loaded
            if (allLocations[d.driver_number]) continue;
            
            try {
              // 1000ms delay to be very safe against 429 Too Many Requests
              await new Promise(resolve => setTimeout(resolve, 1000));
              
              const dLoc = await getLocationData(selectedSession as number, d.driver_number);
              setAllLocations(prev => ({ ...prev, [d.driver_number]: dLoc }));
            } catch (e) {
              console.error(`Failed to load location for driver ${d.driver_number}`);
            }
          }
        })();
      } catch (err) {
        console.error("Failed to load telemetry", err);
        setErrorMsg('Failed to fetch data from OpenF1 API. The race might be in the future or the API rate limit was hit.');
      } finally {
        setIsLoading(false);
      }
    }
    loadTelemetry();
  }, [selectedSession, selectedDriver]);

  const currentDriver = drivers.find(d => d.driver_number === selectedDriver);
  const driverColor = currentDriver ? `#${currentDriver.team_colour}` : '#e10600';

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setCurrentTimeIndex(parseInt(e.target.value, 10));
  };

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (isPlaying && carData.length > 0) {
      let accumulated = 0;
      interval = setInterval(() => {
        accumulated += (33 / 330) * playbackSpeed;
        if (accumulated >= 1) {
          const step = Math.floor(accumulated);
          accumulated -= step;
          setCurrentTimeIndex(prev => {
            if (prev >= carData.length - 1) {
              setIsPlaying(false);
              return prev;
            }
            return Math.min(prev + step, carData.length - 1);
          });
        }
        
        if (playbackSpeed === 1) {
          setFractionalProgress(accumulated);
        } else {
          setFractionalProgress(0);
        }
      }, 33);
    } else {
      setFractionalProgress(0);
    }
    return () => clearInterval(interval);
  }, [isPlaying, playbackSpeed, carData.length]);



  // Compute smooth time for the map animation
  const currentCarData = carData[currentTimeIndex];
  const nextCarData = carData[Math.min(currentTimeIndex + 1, Math.max(0, carData.length - 1))];
  
  let smoothTimeMs = currentCarData ? new Date(currentCarData.date).getTime() : undefined;
  if (smoothTimeMs && nextCarData && fractionalProgress > 0) {
    const t2 = new Date(nextCarData.date).getTime();
    smoothTimeMs = smoothTimeMs + (t2 - smoothTimeMs) * fractionalProgress;
  }

  const togglePlay = () => setIsPlaying(!isPlaying);

  return (
    <div className="app-container">
      <header className="header">
        <div className="logo">
          <h1>F1 TELEMETRY</h1>
          <span className="badge">Viewer</span>
        </div>
        
        <div className="controls">
          <select 
            value={selectedYear} 
            onChange={e => setSelectedYear(Number(e.target.value))}
            disabled={isLoading}
            className="year-select"
          >
            <option value="2026">2026</option>
            <option value="2025">2025</option>
            <option value="2024">2024</option>
            <option value="2023">2023</option>
          </select>

          <select 
            value={selectedSession} 
            onChange={e => setSelectedSession(Number(e.target.value))}
            disabled={isLoading || sessions.length === 0}
          >
            {sessions.length === 0 ? (
              <option value="">No sessions found</option>
            ) : (
              sessions.map(s => (
                <option key={s.session_key} value={s.session_key}>
                  {s.circuit_short_name} ({s.country_name}) - {s.session_name}
                </option>
              ))
            )}
          </select>

          <select 
            value={selectedDriver} 
            onChange={e => setSelectedDriver(Number(e.target.value))}
            disabled={isLoading || drivers.length === 0}
          >
            {drivers.map(d => (
              <option key={d.driver_number} value={d.driver_number}>
                {d.driver_number} - {d.full_name}
              </option>
            ))}
          </select>
          
          {currentDriver && (
            <div className="driver-info">
              <div className="driver-color" style={{ backgroundColor: driverColor }} />
              <div className="driver-name">{currentDriver.name_acronym}</div>
            </div>
          )}
        </div>
      </header>

      <main className="main-content">
        {isLoading && (
          <div className="loading-overlay">
            <div className="spinner"></div>
            <h2>Fetching telemetry data...</h2>
            <p>This may take a moment as F1 data is huge.</p>
          </div>
        )}

        {errorMsg && !isLoading && (
          <div className="error-overlay">
            <h2>Oops!</h2>
            <p>{errorMsg}</p>
          </div>
        )}
        
        <PanelGroup orientation="horizontal" className="panel-group">
          <Panel defaultSize={25} minSize={15}>
            <div className="leaderboard-panel">
              <Leaderboard laps={laps} drivers={drivers} currentDate={carData[currentTimeIndex]?.date} />
            </div>
          </Panel>
          
          <PanelResizeHandle className="resize-handle" />
          
          <Panel defaultSize={50} minSize={30}>
            <div className="map-panel">
              <TrackMap 
                baseLocationData={locationData} 
                allLocations={allLocations}
                drivers={drivers}
                currentDate={carData[currentTimeIndex]?.date}
                smoothTimeMs={smoothTimeMs}
                laps={laps}
              />
            </div>
          </Panel>
          
          <PanelResizeHandle className="resize-handle" />
          
          <Panel defaultSize={25} minSize={15}>
            <div className="charts-panel">
              <TelemetryChart 
                title="Speed (km/h)" 
                data={carData} 
                dataKey="speed" 
                color="var(--speed-color)" 
                currentTimeIndex={currentTimeIndex} 
                zoomRadius={zoomRadius}
              />
              <TelemetryChart 
                title="Throttle (%)" 
                data={carData} 
                dataKey="throttle" 
                color="var(--throttle-color)" 
                currentTimeIndex={currentTimeIndex} 
                zoomRadius={zoomRadius}
              />
              <TelemetryChart 
                title="Brake (%)" 
                data={carData} 
                dataKey="brake" 
                color="var(--brake-color)" 
                currentTimeIndex={currentTimeIndex} 
                zoomRadius={zoomRadius}
              />
              <TelemetryChart 
                title="Gear" 
                data={carData} 
                dataKey="n_gear" 
                color="var(--gear-color)" 
                currentTimeIndex={currentTimeIndex} 
                zoomRadius={zoomRadius}
              />
            </div>
          </Panel>
        </PanelGroup>
      </main>

      <div className="timeline-control">
        <button 
          onClick={togglePlay} 
          disabled={isLoading || carData.length === 0}
          className="play-button"
        >
          {isPlaying ? '⏸ Pause' : '▶ Play'}
        </button>
        <select 
          value={playbackSpeed} 
          onChange={e => setPlaybackSpeed(Number(e.target.value))}
          className="speed-select"
        >
          <option value="1">1x Speed</option>
          <option value="5">5x Speed</option>
          <option value="10">10x Speed</option>
          <option value="50">50x Speed</option>
          <option value="100">100x Speed</option>
        </select>
        <select 
          value={zoomRadius} 
          onChange={e => setZoomRadius(Number(e.target.value))}
          className="speed-select"
        >
          <option value="0">Zoom: All</option>
          <option value="180">±60s (Zoom In)</option>
          <option value="90">±30s (Closer)</option>
          <option value="30">±10s (Max Zoom)</option>
        </select>
        <div className="slider-container">
          <input 
            type="range" 
            className="slider" 
            min="0" 
            max={carData.length > 0 ? carData.length - 1 : 0} 
            value={currentTimeIndex} 
            onChange={handleSliderChange}
            disabled={isLoading || carData.length === 0}
          />
        </div>
        <span>{carData.length} points</span>
      </div>
    </div>
  )
}

export default App
