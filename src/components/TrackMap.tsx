import React, { useRef, useEffect, useMemo, useState, useCallback } from 'react';
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
  
  // Interactive zoom & pan state
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [panOffset, setPanOffset] = useState<{ x: number, y: number }>({ x: 0, y: 0 });
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef<{ x: number, y: number }>({ x: 0, y: 0 });

  // Handle Resize using ResizeObserver
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setDimensions({
            width,
            height,
            dpr: window.devicePixelRatio || 1
          });
        }
      }
    });

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // 1. Find the best valid lap across ALL drivers to extract clean circuit layout
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

  // 2. Extract exactly 1 lap of coordinates for the circuit layout
  const { circuitPoints, s1_end, s2_end, s3_end, hasSectors } = useMemo(() => {
    if (!trackLocationData || trackLocationData.length === 0) {
      return { circuitPoints: [], s1_end: 0, s2_end: 0, s3_end: 0, hasSectors: false };
    }

    if (referenceLap && referenceLap.duration_sector_1 && referenceLap.duration_sector_2 && referenceLap.duration_sector_3) {
      const startTime = new Date(referenceLap.date_start).getTime();
      const s1 = startTime + referenceLap.duration_sector_1 * 1000;
      const s2 = s1 + referenceLap.duration_sector_2 * 1000;
      const s3 = s2 + referenceLap.duration_sector_3 * 1000;

      const pts = trackLocationData.filter(p => {
        if (p.x === 0 && p.y === 0) return false;
        const t = new Date(p.date).getTime();
        return t >= startTime && t <= s3 + 1200;
      });

      if (pts.length > 50) {
        return {
          circuitPoints: pts,
          s1_end: s1,
          s2_end: s2,
          s3_end: s3,
          hasSectors: true
        };
      }
    }

    // Fallback: use all non-zero points if no single reference lap is found
    const filtered = trackLocationData.filter(p => p.x !== 0 || p.y !== 0);
    return {
      circuitPoints: filtered,
      s1_end: 0,
      s2_end: 0,
      s3_end: 0,
      hasSectors: false
    };
  }, [trackLocationData, referenceLap]);

  // 3. Accurately calculate bounds from the actual circuitPoints (so the track fills the canvas!)
  const bounds = useMemo(() => {
    if (!circuitPoints || circuitPoints.length === 0) return null;

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (let i = 0; i < circuitPoints.length; i++) {
      const { x, y } = circuitPoints[i];
      if (x === 0 && y === 0) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }

    if (!isFinite(minX) || !isFinite(maxX) || minX === maxX || minY === maxY) return null;

    return {
      minX,
      maxX,
      minY,
      maxY,
      width: maxX - minX,
      height: maxY - minY
    };
  }, [circuitPoints]);

  // 4. Transform coordinates mapper with Zoom & Pan support
  const getMapCoords = useMemo(() => {
    if (!bounds || dimensions.width === 0 || dimensions.height === 0) return null;
    const padding = 50;
    const cw = dimensions.width - padding * 2;
    const ch = dimensions.height - padding * 2;
    
    // Base scale to fit circuit perfectly within canvas
    const baseScale = Math.min(cw / bounds.width, ch / bounds.height);
    const scale = baseScale * zoomLevel;

    // Center of circuit
    const circuitCenterX = bounds.minX + bounds.width / 2;
    const circuitCenterY = bounds.minY + bounds.height / 2;

    // Center of canvas
    const canvasCenterX = dimensions.width / 2 + panOffset.x;
    const canvasCenterY = dimensions.height / 2 + panOffset.y;

    return {
      mapX: (x: number) => canvasCenterX + (x - circuitCenterX) * scale,
      mapY: (y: number) => canvasCenterY - (y - circuitCenterY) * scale,
      scale
    };
  }, [bounds, dimensions, zoomLevel, panOffset]);

  // Layer 1: Draw Track (runs when circuit data, bounds, dimensions, or zoom/pan changes)
  useEffect(() => {
    const canvas = trackCanvasRef.current;
    if (!canvas || !bounds || !getMapCoords || circuitPoints.length === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { width, height, dpr } = dimensions;
    if (width === 0 || height === 0) return;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const { mapX, mapY } = getMapCoords;

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
        if (p.x === 0 && p.y === 0) {
          isFirst = true;
          continue;
        }

        const t = new Date(p.date).getTime();
        // Break line if data gap is > 2000ms
        if (!isFirst && (t - lastTime > 2000)) {
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
      
      for (let i = 0; i < circuitPoints.length; i++) {
        const p = circuitPoints[i];
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
      const trackSampleRate = Math.max(1, Math.floor(circuitPoints.length / 1000));
      const sampled = circuitPoints.filter((_, i) => i % trackSampleRate === 0);
      drawSegment(sampled, '#00d2ff');
    }
  }, [circuitPoints, bounds, dimensions, getMapCoords, hasSectors, s1_end, s2_end, s3_end]);

  // Layer 2: Draw Cars (runs every frame during animation)
  useEffect(() => {
    const canvas = carsCanvasRef.current;
    if (!canvas || !getMapCoords || smoothTimeMs === undefined) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { width, height, dpr } = dimensions;
    if (width === 0 || height === 0) return;

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
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.fillStyle = '#fff';
      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(driver.name_acronym, cx, cy - 10);
    });
  }, [allLocations, drivers, smoothTimeMs, dimensions, getMapCoords]);

  // Mouse wheel zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.15 : 0.87;
    setZoomLevel(prev => Math.min(Math.max(prev * zoomFactor, 0.5), 10));
  }, []);

  // Mouse drag to pan
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    isDraggingRef.current = true;
    dragStartRef.current = { x: e.clientX - panOffset.x, y: e.clientY - panOffset.y };
  }, [panOffset]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDraggingRef.current) return;
    setPanOffset({
      x: e.clientX - dragStartRef.current.x,
      y: e.clientY - dragStartRef.current.y
    });
  }, []);

  const handleMouseUp = useCallback(() => {
    isDraggingRef.current = false;
  }, []);

  const resetView = () => {
    setZoomLevel(1);
    setPanOffset({ x: 0, y: 0 });
  };

  return (
    <div 
      className="canvas-container" 
      ref={containerRef} 
      style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', cursor: isDraggingRef.current ? 'grabbing' : 'grab' }}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <canvas 
        ref={trackCanvasRef} 
        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', display: 'block', pointerEvents: 'none' }} 
      />
      <canvas 
        ref={carsCanvasRef} 
        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', display: 'block', pointerEvents: 'none' }} 
      />
      
      {/* Zoom & Pan Controls Overlay */}
      <div style={{
        position: 'absolute',
        top: 12,
        right: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        zIndex: 20
      }}>
        <button 
          onClick={(e) => { e.stopPropagation(); setZoomLevel(prev => Math.min(prev * 1.25, 10)); }}
          title="Zoom In"
          style={{ width: 34, height: 34, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', fontWeight: 'bold' }}
        >
          +
        </button>
        <button 
          onClick={(e) => { e.stopPropagation(); setZoomLevel(prev => Math.max(prev * 0.8, 0.5)); }}
          title="Zoom Out"
          style={{ width: 34, height: 34, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', fontWeight: 'bold' }}
        >
          -
        </button>
        <button 
          onClick={(e) => { e.stopPropagation(); resetView(); }}
          title="Reset View"
          style={{ width: 34, height: 34, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px' }}
        >
          ⟲
        </button>
      </div>

      {/* Mini Hint */}
      <div style={{
        position: 'absolute',
        bottom: 8,
        right: 12,
        fontSize: '11px',
        color: 'var(--text-secondary)',
        pointerEvents: 'none',
        opacity: 0.7
      }}>
        Wheel: Zoom | Drag: Pan
      </div>
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
  
  const tBefore = locations[right];
  const tAfter = locations[left];
  
  if (!tBefore || !tAfter) {
    const fallback = tBefore || tAfter;
    return { x: fallback.x, y: fallback.y };
  }
  
  const timeBefore = new Date(tBefore.date).getTime();
  const timeAfter = new Date(tAfter.date).getTime();
  
  if (timeAfter === timeBefore) return { x: tBefore.x, y: tBefore.y };
  
  const ratio = (targetTime - timeBefore) / (timeAfter - timeBefore);
  
  const interpX = tBefore.x + (tAfter.x - tBefore.x) * ratio;
  const interpY = tBefore.y + (tAfter.y - tBefore.y) * ratio;
  
  return { x: interpX, y: interpY };
}
