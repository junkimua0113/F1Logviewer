import React, { useMemo } from 'react';
import type { LapData, Driver } from '../api/openf1';

interface LeaderboardProps {
  laps: LapData[];
  drivers: Driver[];
  currentDate: string | undefined;
}

export const Leaderboard: React.FC<LeaderboardProps> = ({ laps, drivers, currentDate }) => {
  const currentLaps = useMemo(() => {
    if (!laps || laps.length === 0 || !currentDate || !drivers) return [];
    
    const targetTime = new Date(currentDate).getTime();
    
    // Group laps by driver
    const lapsByDriver: Record<number, LapData[]> = {};
    for (const lap of laps) {
      if (!lapsByDriver[lap.driver_number]) {
        lapsByDriver[lap.driver_number] = [];
      }
      lapsByDriver[lap.driver_number].push(lap);
    }
    
    const results = drivers.map(driver => {
      const dLaps = lapsByDriver[driver.driver_number];
      let activeLap = null;
      let bestLapTime = Infinity;
      
      if (dLaps && dLaps.length > 0) {
        dLaps.sort((a,b) => new Date(a.date_start).getTime() - new Date(b.date_start).getTime());
        
        for (let i = 0; i < dLaps.length; i++) {
          if (new Date(dLaps[i].date_start).getTime() <= targetTime) {
            activeLap = dLaps[i];
            if (activeLap.lap_duration && activeLap.lap_duration < bestLapTime) {
              bestLapTime = activeLap.lap_duration;
            }
          } else {
            break;
          }
        }
      }
      return {
        driver,
        lap: activeLap,
        bestLapTime
      };
    });
    
    results.sort((a, b) => {
      if (a.bestLapTime !== b.bestLapTime) {
        return a.bestLapTime - b.bestLapTime;
      }
      return a.driver.driver_number - b.driver.driver_number;
    });
    
    return results;
  }, [laps, drivers, currentDate]);

  return (
    <div className="leaderboard-container">
      <div className="leaderboard-header">
        <div className="lb-driver">DRIVER</div>
        <div className="lb-lap">LAP</div>
        <div className="lb-time">S1</div>
        <div className="lb-time">S2</div>
        <div className="lb-time">S3</div>
        <div className="lb-time highlight">TIME</div>
      </div>
      <div className="leaderboard-list">
        {currentLaps.map((item) => (
          <div key={item.driver.driver_number} className="leaderboard-row">
            <div className="lb-driver">
              <span className="lb-color" style={{ backgroundColor: `#${item.driver.team_colour || 'e10600'}` }}></span>
              {item.driver.name_acronym}
            </div>
            <div className="lb-lap">{item.lap ? item.lap.lap_number : '-'}</div>
            <div className="lb-time">{formatTime(item.lap?.duration_sector_1)}</div>
            <div className="lb-time">{formatTime(item.lap?.duration_sector_2)}</div>
            <div className="lb-time">{formatTime(item.lap?.duration_sector_3)}</div>
            <div className="lb-time highlight">{formatTime(item.lap?.lap_duration)}</div>
          </div>
        ))}
      </div>
    </div>
  );
};

function formatTime(seconds: number | undefined | null): string {
  if (seconds === undefined || seconds === null) return '-';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins > 0) {
    const secsStr = secs < 10 ? `0${secs.toFixed(3)}` : secs.toFixed(3);
    return `${mins}:${secsStr}`;
  }
  return seconds.toFixed(3);
}
