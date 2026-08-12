import React, { useRef, useEffect, useMemo } from 'react';
import type { LocationData, Driver, LapData } from '../api/openf1';

interface TrackMapProps {
  baseLocationData: LocationData[];
  allLocations: Record<number, LocationData[]>;
  drivers: Driver[];
  smoothTimeMs?: number;
  laps: LapData[];
}

export const TrackMap: React.FC<TrackMapProps> = ({ baseLocationData, allLocations, drivers, smoothTimeMs, laps }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Find the best valid lap across ALL drivers to draw the track map
  const { referenceLap, trackLocationData } = useMemo(() => {
    let bestLap: LapData | null = null;
    let bestLocs: LocationData[] | null = null;
    
    for (const driver of drivers) {
      const locs = allLocations[driver.driver_number];
      if (!locs || locs.length < 100) continue;
      
      const driverLaps = laps.filter(l => l.driver_number === driver.driver_number);
      const validLaps = driverLaps.filter(l => 
        !l.is_pit_out_lap && 
        l.duration_sector_1 && 
        l.duration_sector_2 && 
        l.duration_sector_3 &&
        l.lap_duration &&
        l.lap_duration > 50 &&
        l.lap_duration < 200
      );
      
      if (validLaps.length > 0) {
        // Find the fastest lap for this driver
        validLaps.sort((a, b) => (a.lap_duration || 9999) - (b.lap_duration || 9999));
        const candidateLap = validLaps[0];
        
        if (!bestLap || (candidateLap.lap_duration || 9999) < (bestLap.lap_duration || 9999)) {
          bestLap = candidateLap;
          bestLocs = locs;
        }
      }
    }
    
    return { 
      referenceLap: bestLap, 
      trackLocationData: bestLocs || baseLocationData 
    };
  }, [allLocations, laps, drivers, baseLocationData]);

  // Calculate track bounds to scale the map appropriately
  const bounds = useMemo(() => {
    if (!trackLocationData || trackLocationData.length === 0) return null;
    
    const xs: number[] = [];
    const ys: number[] = [];
    
    // Sample points and ignore exactly (0,0) which is a common telemetry error
    for (let i = 0; i < trackLocationData.length; i += 2) {
      const { x, y } = trackLocationData[i];
      if (x === 0 && y === 0) continue;
      xs.push(x);
      ys.push(y);
    }
    
    if (xs.length === 0) return null;
    
    xs.sort((a, b) => a - b);
    ys.sort((a, b) => a - b);
    
    // Use 1st and 99th percentiles to define bounds, ignoring extreme GPS glitches
    const p1 = Math.floor(xs.length * 0.01);
    const p99 = Math.floor(xs.length * 0.99);
    
    const minX = xs[p1];
    const maxX = xs[p99];
    const minY = ys[p1];
    const maxY = ys[p99];
    
    return { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };
  }, [trackLocationData]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !bounds || trackLocationData.length === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Handle high DPI displays
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    
    ctx.scale(dpr, dpr);
    
    // Setup transform to fit track into canvas
    const padding = 40;
    const cw = rect.width - padding * 2;
    const ch = rect.height - padding * 2;
    
    const scale = Math.min(cw / bounds.width, ch / bounds.height);
    
    const offsetX = padding + (cw - bounds.width * scale) / 2;
    const offsetY = padding + (ch - bounds.height * scale) / 2;

    const mapX = (x: number) => offsetX + (x - bounds.minX) * scale;
    // Y axis needs to be flipped for correct orientation in most F1 tracks
    const mapY = (y: number) => offsetY + (bounds.height - (y - bounds.minY)) * scale;

    // Clear canvas
    ctx.clearRect(0, 0, rect.width, rect.height);

    // We want to extract exactly one lap's worth of location data to draw the track,
    // and color it by sectors if referenceLap is available.
    let trackPoints = trackLocationData;
    let s1_end = 0;
    let s2_end = 0;
    let s3_end = 0;
    let hasSectors = false;
    
    if (referenceLap && referenceLap.duration_sector_1 && referenceLap.duration_sector_2 && referenceLap.duration_sector_3) {
      const startTime = new Date(referenceLap.date_start).getTime();
      s1_end = startTime + referenceLap.duration_sector_1 * 1000;
      s2_end = s1_end + referenceLap.duration_sector_2 * 1000;
      s3_end = s2_end + referenceLap.duration_sector_3 * 1000;
      
      trackPoints = trackLocationData.filter(p => {
        const t = new Date(p.date).getTime();
        return t >= startTime && t <= s3_end + 1000; // Add 1 sec buffer to close the loop
      });
      
      if (trackPoints.length > 50) {
        hasSectors = true;
      } else {
        trackPoints = trackLocationData; // Fallback
      }
    }

    const drawSegment = (points: LocationData[], color: string) => {
      if (points.length < 2) return;
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      
      let isFirst = true;
      let lastTime = 0;
      
      for (let i = 0; i < points.length; i++) {
        const p = points[i];
        
        // Skip anomalies and break the line
        if (p.x === 0 && p.y === 0) {
          isFirst = true;
          continue;
        }
        if (p.x < bounds.minX - bounds.width || p.x > bounds.maxX + bounds.width ||
            p.y < bounds.minY - bounds.height || p.y > bounds.maxY + bounds.height) {
          isFirst = true;
          continue;
        }

        const t = new Date(p.date).getTime();
        // If data is missing for > 1500ms, break the line so it doesn't draw across the infield
        if (!isFirst && (t - lastTime > 1500)) {
          isFirst = true;
        }

        if (isFirst) {
          ctx.moveTo(mapX(p.x), mapY(p.y));
          isFirst = false;
        } else {
          ctx.lineTo(mapX(p.x), mapY(p.y));
        }
        
        lastTime = t;
      }
      ctx.stroke();
    };

    if (hasSectors) {
      const s1_pts: LocationData[] = [];
      const s2_pts: LocationData[] = [];
      const s3_pts: LocationData[] = [];
      
      for (let i = 0; i < trackPoints.length; i++) {
        const p = trackPoints[i];
        const t = new Date(p.date).getTime();
        if (t <= s1_end) {
          s1_pts.push(p);
        } else if (t <= s2_end) {
          if (s2_pts.length === 0 && s1_pts.length > 0) s2_pts.push(s1_pts[s1_pts.length - 1]);
          s2_pts.push(p);
        } else {
          if (s3_pts.length === 0 && s2_pts.length > 0) s3_pts.push(s2_pts[s2_pts.length - 1]);
          s3_pts.push(p);
        }
      }
      
      // Neon colors for sectors
      drawSegment(s1_pts, '#ff2a2a'); // Sector 1: Red
      drawSegment(s2_pts, '#2a8cff'); // Sector 2: Blue
      drawSegment(s3_pts, '#ffea00'); // Sector 3: Yellow
    } else {
      // Fallback
      const trackSampleRate = Math.max(1, Math.floor(trackLocationData.length / 1000));
      const sampled = trackLocationData.filter((_, i) => i % trackSampleRate === 0);
      drawSegment(sampled, '#2a2f3a');
    }

    // Draw current position for all drivers
    const targetTime = smoothTimeMs !== undefined ? smoothTimeMs : null;
    
    if (targetTime !== null && drivers) {
      drivers.forEach(driver => {
        const locs = allLocations[driver.driver_number];
        if (!locs || locs.length === 0) return;

        const currentLoc = getInterpolatedLocation(locs, targetTime);
        if (!currentLoc) return;

        const cx = mapX(currentLoc.x);
        const cy = mapY(currentLoc.y);
        const dColor = `#${driver.team_colour || 'e10600'}`;

        // Draw dot
        ctx.beginPath();
        ctx.arc(cx, cy, 6, 0, Math.PI * 2);
        ctx.fillStyle = dColor;
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Draw Acronym text
        ctx.fillStyle = '#fff';
        ctx.font = '10px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(driver.name_acronym, cx, cy - 10);
      });
    }

  }, [trackLocationData, allLocations, drivers, smoothTimeMs, bounds, referenceLap]);

  return (
    <div className="canvas-container">
      <canvas 
        ref={canvasRef} 
        style={{ width: '100%', height: '100%', display: 'block' }} 
      />
    </div>
  );
};

// Helper function to interpolate location between two data points for smooth animation
function getInterpolatedLocation(locations: LocationData[], targetTime: number): { x: number, y: number } | null {
  if (!locations || locations.length === 0) return null;
  
  let left = 0;
  let right = locations.length - 1;
  
  const firstTime = new Date(locations[0].date).getTime();
  const lastTime = new Date(locations[right].date).getTime();
  
  if (targetTime <= firstTime) return { x: locations[0].x, y: locations[0].y };
  if (targetTime >= lastTime) return { x: locations[right].x, y: locations[right].y };

  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    const midTime = new Date(locations[mid].date).getTime();
    
    if (midTime === targetTime) return { x: locations[mid].x, y: locations[mid].y };
    if (midTime < targetTime) {
      left = mid + 1;
    } else {
      right = mid - 1;
    }
  }
  
  // Left and right have crossed. right is just before target, left is just after target.
  const tBefore = locations[right];
  const tAfter = locations[left];
  
  if (!tBefore || !tAfter) {
    const fallback = tBefore || tAfter;
    return { x: fallback.x, y: fallback.y };
  }
  
  const timeBefore = new Date(tBefore.date).getTime();
  const timeAfter = new Date(tAfter.date).getTime();
  
  if (timeAfter === timeBefore) return { x: tBefore.x, y: tBefore.y };
  
  // Prevent cars from slowly floating across the map during large data drops (e.g. >1 second)
  if (timeAfter - timeBefore > 1000) {
    const leftDiff = Math.abs(timeBefore - targetTime);
    const rightDiff = Math.abs(timeAfter - targetTime);
    const closest = leftDiff < rightDiff ? tBefore : tAfter;
    return { x: closest.x, y: closest.y };
  }
  
  const ratio = (targetTime - timeBefore) / (timeAfter - timeBefore);
  
  const interpX = tBefore.x + (tAfter.x - tBefore.x) * ratio;
  const interpY = tBefore.y + (tAfter.y - tBefore.y) * ratio;
  
  return { x: interpX, y: interpY };
}

