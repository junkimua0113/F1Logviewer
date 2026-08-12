import React, { useMemo, useState } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine
} from 'recharts';
import type { CarData } from '../api/openf1';

interface TelemetryChartProps {
  data: CarData[];
  dataKey: keyof CarData;
  color: string;
  title: string;
  currentTimeIndex: number;
  zoomRadius?: number;
}

export const TelemetryChart: React.FC<TelemetryChartProps> = ({
  data,
  dataKey,
  color,
  title,
  currentTimeIndex,
  zoomRadius = 0
}) => {
  // To avoid rendering 10k points, we might want to sample them or render as is.
  // Recharts can handle a few thousand, but might be sluggish. 
  // For demo, we render every 5th point if data is huge.
  const chartData = useMemo(() => {
    if (!data || data.length === 0) return [];

    let startIndex = 0;
    let endIndex = data.length;

    if (zoomRadius > 0) {
      startIndex = Math.max(0, currentTimeIndex - zoomRadius);
      endIndex = Math.min(data.length, currentTimeIndex + zoomRadius);
    }

    const slice = zoomRadius > 0 ? data.slice(startIndex, endIndex) : data;
    const sampleRate = slice.length > 5000 ? Math.ceil(slice.length / 2000) : 1;
    
    return slice.filter((_, i) => i % sampleRate === 0).map((d, i) => ({
      ...d,
      originalIndex: startIndex + i * sampleRate
    }));
  }, [data, zoomRadius, zoomRadius > 0 ? currentTimeIndex : 0]);

  const currentPoint = chartData.find(d => d.originalIndex >= currentTimeIndex) || chartData[0];
  const [isCollapsed, setIsCollapsed] = useState(false);

  return (
    <div className="chart-card" style={{ height: isCollapsed ? 'auto' : '250px' }}>
      <div 
        className="chart-title" 
        onClick={() => setIsCollapsed(!isCollapsed)}
        style={{ 
          cursor: 'pointer', 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center',
          marginBottom: isCollapsed ? '0' : '0.5rem'
        }}
      >
        <span>{title}</span>
        <span style={{ fontSize: '0.7rem', color: '#a0a6b1', userSelect: 'none' }}>
          {isCollapsed ? '▼ SHOW' : '▲ HIDE'}
        </span>
      </div>
      
      {!isCollapsed && (
        <div className="chart-container">
          <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 5, right: 20, left: -20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2a2f3a" vertical={false} />
            <XAxis dataKey="originalIndex" hide />
            <YAxis stroke="#a0a6b1" tick={{ fill: '#a0a6b1', fontSize: 12 }} />
            <Tooltip
              contentStyle={{ backgroundColor: '#1a1d24', border: '1px solid #2a2f3a', borderRadius: '8px' }}
              itemStyle={{ color: '#f0f2f5' }}
              labelStyle={{ display: 'none' }}
            />
            <Line
              type="monotone"
              dataKey={dataKey}
              stroke={color}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
            {currentPoint && (
              <ReferenceLine
                x={currentPoint.originalIndex}
                stroke="#f0f2f5"
                strokeDasharray="3 3"
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
      )}
    </div>
  );
};
