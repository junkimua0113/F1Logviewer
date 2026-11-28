import { useState, useEffect, useRef } from 'react'
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
  
  const [smoothTimeMs, setSmoothTimeMs] = useState<number | undefined>(undefined)

  const [carData, setCarData] = useState<CarData[]>([])
  const [locationData, setLocationData] = useState<LocationData[]>([])
  const [allLocations, setAllLocations] = useState<Record<number, LocationData[]>>({})
  const [laps, setLaps] = useState<LapData[]>([])
  
  const [isLoading, setIsLoading] = useState(false)
  const [loadingCarsProgress, setLoadingCarsProgress] = useState<{ loaded: number, total: number }>({ loaded: 0, total: 0 })
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
        const sorted = data.sort((a, b) => new Date(b.date_start).getTime() - new Date(a.date_start).getTime());
        setSessions(sorted);
        
        if (sorted.length > 0) {
          const now = new Date().getTime();
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
      } catch (err: any) {
        console.error("Failed to load sessions", err);
        setErrorMsg(err.message || 'Failed to load sessions for this year.');
      }
    }
    loadSessions();
  }, [selectedYear]);

  // Fetch drivers and session-wide data when session changes
  useEffect(() => {
    if (!selectedSession) return;
    
    async function loadSessionData() {
      setAllLocations({});
      setLoadingCarsProgress({ loaded: 0, total: 0 });
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
      } catch (err: any) {
        console.error("Failed to load session data", err);
        setErrorMsg(err.message || 'Failed to load drivers or laps.');
      }
    }
    loadSessionData();
  }, [selectedSession]);

  // Track cancellation of background driver loading
  const loadAbortRef = useRef<boolean>(false);

  // Fetch telemetry when driver changes
  useEffect(() => {
    if (!selectedSession || !selectedDriver) return;

    loadAbortRef.current = true; // Cancel previous loading queue
    const currentAbort = false;
    loadAbortRef.current = currentAbort;

    async function loadTelemetry() {
      setIsLoading(true);
      setErrorMsg('');
      setCurrentTimeIndex(0);
      try {
        const fetchLocation = !allLocations[selectedDriver as number];
        
        const promises: Promise<any>[] = [
          getCarData(selectedSession as number, selectedDriver as number)
        ];
        
        if (fetchLocation) {
          promises.push(getLocationData(selectedSession as number, selectedDriver as number));
        }

        const results = await Promise.all(promises);
        const car = results[0];
        const rawLoc = fetchLocation ? results[1] : allLocations[selectedDriver as number];
        const loc = rawLoc ? rawLoc.filter((p: LocationData) => p.x !== 0 || p.y !== 0) : [];
        
        if (!car || car.length === 0) {
          setErrorMsg('No telemetry data available for this session yet. It might be a future race or data is incomplete.');
          return;
        }

        setCarData(car);
        setLocationData(loc);
        
        if (fetchLocation) {
          setAllLocations(prev => ({ ...prev, [selectedDriver as number]: loc }));
        }

        // Auto seek to race start (Lap 1) if present, to avoid 1 hour grid-standing time (e.g. Brazil)
        let initialIdx = 0;
        const lap1 = laps.find(l => l.driver_number === selectedDriver && l.lap_number === 1);
        if (lap1 && lap1.date_start) {
          const lap1Time = new Date(lap1.date_start).getTime();
          // Find carData point closest to or just before lap1 start
          const idx = car.findIndex((c: CarData) => new Date(c.date).getTime() >= lap1Time);
          if (idx !== -1) {
            initialIdx = Math.max(0, idx - 50); // Seek ~15 seconds before green flag
          }
        }
        setCurrentTimeIndex(initialIdx);
        if (car[initialIdx]) {
          setSmoothTimeMs(new Date(car[initialIdx].date).getTime());
        }

        // Fast parallel batch load other drivers
        const otherDrivers = drivers.filter(d => d.driver_number !== selectedDriver);
        setLoadingCarsProgress({ loaded: 1, total: drivers.length });

        // Process in concurrent batches of 3
        const batchSize = 3;
        (async () => {
          let count = 1;
          for (let i = 0; i < otherDrivers.length; i += batchSize) {
            if (loadAbortRef.current) break;
            const batch = otherDrivers.slice(i, i + batchSize);
            
            await Promise.all(batch.map(async (d) => {
              if (loadAbortRef.current) return;
              if (allLocations[d.driver_number]) {
                count++;
                return;
              }
              try {
                const rawDLoc = await getLocationData(selectedSession as number, d.driver_number);
                if (loadAbortRef.current) return;
                const dLoc = rawDLoc.filter((p: LocationData) => p.x !== 0 || p.y !== 0);
                setAllLocations(prev => ({ ...prev, [d.driver_number]: dLoc }));
              } catch (e) {
                console.error(`Failed to load location for driver ${d.driver_number}`, e);
              }
              count++;
              setLoadingCarsProgress({ loaded: count, total: drivers.length });
            }));

            // Small delay between batches to stay safely within API rate limits
            await new Promise(resolve => setTimeout(resolve, 350));
          }
        })();
      } catch (err: any) {
        console.error("Failed to load telemetry", err);
        setErrorMsg(err.message || 'Failed to fetch data from OpenF1 API.');
      } finally {
        setIsLoading(false);
      }
    }
    loadTelemetry();

    return () => {
      loadAbortRef.current = true;
    };
  }, [selectedSession, selectedDriver]);

  const currentDriver = drivers.find(d => d.driver_number === selectedDriver);
  const driverColor = currentDriver ? `#${currentDriver.team_colour}` : '#e10600';

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newIdx = parseInt(e.target.value, 10);
    setCurrentTimeIndex(newIdx);
    if (!isPlaying && carData[newIdx]) {
      setSmoothTimeMs(new Date(carData[newIdx].date).getTime());
    }
  };

  // Jump directly to Lap 1 green flag start
  const jumpToRaceStart = () => {
    const lap1 = laps.find(l => l.driver_number === selectedDriver && l.lap_number === 1);
    if (lap1 && lap1.date_start && carData.length > 0) {
      const lap1Time = new Date(lap1.date_start).getTime();
      const idx = carData.findIndex((c: CarData) => new Date(c.date).getTime() >= lap1Time);
      if (idx !== -1) {
        const targetIdx = Math.max(0, idx - 30);
        setCurrentTimeIndex(targetIdx);
        if (carData[targetIdx]) {
          setSmoothTimeMs(new Date(carData[targetIdx].date).getTime());
        }
      }
    }
  };

  const playTimeMsRef = useRef<number>(0);
  const lastTickRef = useRef<number>(0);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (isPlaying && carData.length > 0) {
      if (playTimeMsRef.current === 0) {
        playTimeMsRef.current = new Date(carData[currentTimeIndex]?.date).getTime();
      }
      lastTickRef.current = performance.now();

      interval = setInterval(() => {
        const now = performance.now();
        const deltaMs = now - lastTickRef.current;
        lastTickRef.current = now;
        
        playTimeMsRef.current += deltaMs * playbackSpeed;
        const currentTargetTime = playTimeMsRef.current;
        
        setSmoothTimeMs(currentTargetTime);
        
        setCurrentTimeIndex(prev => {
          let i = prev;
          while (i < carData.length - 1 && new Date(carData[i + 1].date).getTime() <= currentTargetTime) {
            i++;
          }
          if (i >= carData.length - 1) {
            setIsPlaying(false);
            return carData.length - 1;
          }
          return i;
        });
      }, 33);
    } else {
      playTimeMsRef.current = 0;
      if (carData[currentTimeIndex]) {
        setSmoothTimeMs(new Date(carData[currentTimeIndex].date).getTime());
      }
    }
    return () => clearInterval(interval);
  }, [isPlaying, playbackSpeed, carData]);

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

          {/* Cars Tracking Status Indicator */}
          {drivers.length > 0 && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              backgroundColor: 'var(--bg-tertiary)',
              padding: '0.4rem 0.8rem',
              borderRadius: '8px',
              fontSize: '0.75rem',
              fontWeight: 600,
              color: loadingCarsProgress.loaded >= drivers.length ? '#00ff88' : '#ffb700'
            }}>
              <span style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                backgroundColor: loadingCarsProgress.loaded >= drivers.length ? '#00ff88' : '#ffb700',
                display: 'inline-block'
              }} />
              {loadingCarsProgress.loaded >= drivers.length 
                ? `ALL CARS READY (${drivers.length}/${drivers.length})`
                : `SYNCING CARS (${loadingCarsProgress.loaded}/${drivers.length})`
              }
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
            <h2>Notice</h2>
            <p style={{ maxWidth: '600px', lineHeight: 1.6 }}>{errorMsg}</p>
          </div>
        )}
        
        <PanelGroup orientation="horizontal" className="panel-group">
          <Panel defaultSize={25} minSize={15}>
            <div className="leaderboard-panel">
              <Leaderboard 
                laps={laps} 
                drivers={drivers} 
                currentDate={carData[currentTimeIndex]?.date}
                allLocations={allLocations}
              />
            </div>
          </Panel>
          
          <PanelResizeHandle className="resize-handle" />
          
          <Panel defaultSize={50} minSize={30}>
            <div className="map-panel">
              <TrackMap 
                baseLocationData={locationData} 
                allLocations={allLocations}
                drivers={drivers}
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

        <button 
          onClick={jumpToRaceStart}
          disabled={isLoading || carData.length === 0}
          style={{
            backgroundColor: 'var(--bg-tertiary)',
            color: 'var(--text-primary)',
            padding: '0.5rem 0.8rem',
            borderRadius: '6px',
            fontSize: '0.8rem',
            fontWeight: 600,
            whiteSpace: 'nowrap'
          }}
          title="Jump directly to Race Start (Lap 1)"
        >
          🏁 Start
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
        <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', minWidth: '130px', textAlign: 'right' }}>
          {carData[currentTimeIndex] 
            ? new Date(carData[currentTimeIndex].date).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) 
            : `${carData.length} pts`
          }
        </span>
      </div>
    </div>
  )
}

export default App
