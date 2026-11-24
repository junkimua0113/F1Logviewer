import React, { useRef, useEffect, useMemo, useState } from 'react';
import type { LocationData, Driver, LapData } from '../api/openf1';

interface TrackMapProps {
  baseLocationData: LocationData[];
  allLocations: Record<number, LocationData[]>;
  drivers: Driver[];
  smoothTimeMs?: number;
  laps: LapData[];
}

export const TrackMap: React.FC<TrackMapProps> = ({ baseLocationData, allLocations, drivers, smoothTimeMs, laps }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const trackCanvasRef = useRef<HTMLCanvasElement>(null);
  const carsCanvasRef = useRef<HTMLCanvasElement>(null);
  
  const [dimensions, setDimensions] = useState({ width: 0, height: 0, dpr: 1 });

  // Handle Resize
  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setDimensions({
          width: rect.width,
          height: rect.height,
          dpr: window.devicePixelRatio || 1
        });
      }
    };
    
    window.addEventListener('resize', updateSize);
    updateSize();
    
    return () => window.removeEventListener('resize', updateSize);
  }, []);

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

  // Transform coordinates mapper
  const getMapCoords = useMemo(() => {
    if (!bounds || dimensions.width === 0) return null;
    const padding = 40;
    const cw = dimensions.width - padding * 2;
    const ch = dimensions.height - padding * 2;
    
    const scale = Math.min(cw / bounds.width, ch / bounds.height);
    const offsetX = padding + (cw - bounds.width * scale) / 2;
    const offsetY = padding + (ch - bounds.height * scale) / 2;

    return {
      mapX: (x: number) => offsetX + (x - bounds.minX) * scale,
      mapY: (y: number) => offsetY + (bounds.height - (y - bounds.minY)) * scale
    };
  }, [bounds, dimensions]);

  // Layer 1: Draw Track (runs only when track data or bounds change)
  useEffect(() => {
    const canvas = trackCanvasRef.current;
    if (!canvas || !bounds || !getMapCoords || trackLocationData.length === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { width, height, dpr } = dimensions;
    if (width === 0) return;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const { mapX, mapY } = getMapCoords;

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
      
      drawSegment(s1_pts, '#ff2a2a'); // Sector 1: Red
      drawSegment(s2_pts, '#2a8cff'); // Sector 2: Blue
      drawSegment(s3_pts, '#ffea00'); // Sector 3: Yellow
    } else {
      // Fallback
      const trackSampleRate = Math.max(1, Math.floor(trackLocationData.length / 1000));
      const sampled = trackLocationData.filter((_, i) => i % trackSampleRate === 0);
      drawSegment(sampled, '#2a2f3a');
    }
  }, [trackLocationData, bounds, dimensions, getMapCoords, referenceLap]);


  // Layer 2: Draw Cars (runs every frame during animation)
  useEffect(() => {
    const canvas = carsCanvasRef.current;
    if (!canvas || !getMapCoords || smoothTimeMs === undefined) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { width, height, dpr } = dimensions;
    if (width === 0) return;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const { mapX, mapY } = getMapCoords;
    const targetTime = smoothTimeMs;

    drivers.forEach(driver => {
      const locs = allLocations[driver.driver_number];
      if (!locs || locs.length === 0) return;

      const currentLoc = getInterpolatedLocation(locs, targetTime);
      if (!currentLoc) return;

      const cx = mapX(currentLoc.x);
      const cy = mapY(currentLoc.y);
      const dColor = `#${driver.team_colour || 'e10600'}`;

      ctx.beginPath();
      ctx.arc(cx, cy, 6, 0, Math.PI * 2);
      ctx.fillStyle = dColor;
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.fillStyle = '#fff';
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(driver.name_acronym, cx, cy - 10);
    });
  }, [allLocations, drivers, smoothTimeMs, dimensions, getMapCoords]);

  return (
    <div className="canvas-container" ref={containerRef} style={{ position: 'relative' }}>
      <canvas 
        ref={trackCanvasRef} 
        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', display: 'block' }} 
      />
      <canvas 
        ref={carsCanvasRef} 
        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', display: 'block' }} 
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
  
  // Notice: We completely removed the logic that snaps the car to a freeze point when the data gap is > 1000ms.
  // This ensures the car smoothly floats (interpolates) across the gap, preserving the visual flow instead of jumping/teleporting.
  const ratio = (targetTime - timeBefore) / (timeAfter - timeBefore);
  
  const interpX = tBefore.x + (tAfter.x - tBefore.x) * ratio;
  const interpY = tBefore.y + (tAfter.y - tBefore.y) * ratio;
  
  return { x: interpX, y: interpY };
}
