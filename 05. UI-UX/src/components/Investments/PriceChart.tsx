/**
 * PriceChart — gráfico de línea simple en SVG para series temporales.
 *
 * ── Características ───────────────────────────────────────────────────────────
 *
 * - Sin dependencias extra: SVG puro, tree-shakeable, cero bundle overhead
 * - Responsive nativo: `viewBox` escala solo
 * - Tooltip on hover: muestra precio y fecha del punto más cercano
 * - Sin labels de precio en Y (limpio), solo tiempo en X
 * - Grilla horizontal opcional vía `showGrid` (sin labels: solo referencia visual)
 * - Línea suave (quadratic Bezier) + área semitransparente
 */

import React, { useMemo, useState, useRef, useEffect } from 'react';
// `services/` vive en `src/`, y este componente en `src/components/Investments/`:
// hacen falta dos niveles (`../../`), no uno.
import type { PricePoint } from '../../services/coinGecko';

interface PriceChartProps {
  readonly data: PricePoint[];
  readonly width?: number;
  readonly height?: number;
  readonly strokeColor?: string;
  readonly fillColor?: string;
  readonly strokeWidth?: number;
  readonly showArea?: boolean;
  /**
   * Dibuja líneas de referencia horizontales (3 pasos) detrás de la curva.
   * Opt-in: el chart sigue siendo limpio por default, pero el call site del
   * detalle de asset la pide explícitamente para leer mejor la pendiente.
   */
  readonly showGrid?: boolean;
  readonly className?: string;
}

/**
 * Formatea precio para tooltip: $1,234.56 o $0.000012
 */
function formatPrice(price: number): string {
  if (price >= 1) {
    return `$${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return `$${price.toFixed(8).replace(/\.?0+$/, '')}`;
}

/**
 * Formatea timestamp para tooltip: "15 oct, 14:30" o "15 oct"
 */
function formatDateTime(ts: number): string {
  const date = new Date(ts);
  return date.toLocaleString('es-AR', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Formatea timestamp para label X: "15 oct" o "14:30"
 */
function formatTimeLabel(ts: number, _index: number, total: number): string {
  const date = new Date(ts);
  return total > 50
    ? date.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })
    : date.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
}

export const PriceChart: React.FC<PriceChartProps> = ({
  data,
  width = 300,
  height = 150,
  strokeColor = '#1a1a2e',
  fillColor = 'rgba(26, 26, 46, 0.15)',
  strokeWidth = 2.5,
  showArea = true,
  showGrid = false,
  className = '',
}) => {
  if (data.length < 2) {
    return (
      <div className={`w-full h-[150px] ${className}`} aria-hidden="true" style={{ background: '#f8f9fa', border: '1px dashed #ccc', borderRadius: '8px' }}>
        <svg viewBox="0 0 300 150" className="w-full h-full text-slate-300">
          <rect x="0" y="0" width="300" height="150" fill="transparent" />
          <text x="150" y="75" textAnchor="middle" dominantBaseline="middle" fontSize="12" fill="#999">
            Sin datos para graficar
          </text>
        </svg>
      </div>
    );
  }

  const { minPrice, maxPrice, minTime, maxTime } = useMemo(() => {
    let minP = Infinity, maxP = -Infinity;
    let minT = Infinity, maxT = -Infinity;
    for (const [t, p] of data) {
      if (p < minP) minP = p;
      if (p > maxP) maxP = p;
      if (t < minT) minT = t;
      if (t > maxT) maxT = t;
    }
    const pricePad = (maxP - minP) * 0.05 || maxP * 0.05;
    const timePad = (maxT - minT) * 0.02;
    return {
      minPrice: minP - pricePad,
      maxPrice: maxP + pricePad,
      minTime: minT - timePad,
      maxTime: maxT + timePad,
    };
  }, [data]);

  const priceRange = maxPrice - minPrice || 1;
  const timeRange = maxTime - minTime || 1;

  const pathPoints = useMemo(() =>
    data.map(([t, p]) => {
      const x = ((t - minTime) / timeRange) * width;
      const y = height - ((p - minPrice) / priceRange) * height;
      return { x, y, price: p, time: t };
    }), [data, minPrice, maxPrice, minTime, maxTime, width, height]);

  const pathD = useMemo(() => {
    const points = pathPoints;
    if (points.length < 2) return '';
    let d = `M${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;
    for (let i = 1; i < points.length; i++) {
      const xc = (points[i - 1].x + points[i].x) / 2;
      const yc = (points[i - 1].y + points[i].y) / 2;
      d += ` Q${points[i - 1].x.toFixed(1)},${points[i - 1].y.toFixed(1)} ${xc.toFixed(1)},${yc.toFixed(1)}`;
    }
    const last = points[points.length - 1];
    const prev = points[points.length - 2];
    d += ` Q${prev.x.toFixed(1)},${prev.y.toFixed(1)} ${last.x.toFixed(1)},${last.y.toFixed(1)}`;
    return d;
  }, [pathPoints]);

  const areaD = useMemo(() => {
    if (!showArea || pathPoints.length < 2) return '';
    const pts = pathPoints;
    let d = `M${pts[0].x.toFixed(1)},${height} L${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
    for (let i = 1; i < pts.length; i++) {
      const xc = (pts[i - 1].x + pts[i].x) / 2;
      const yc = (pts[i - 1].y + pts[i].y) / 2;
      d += ` Q${pts[i - 1].x.toFixed(1)},${pts[i - 1].y.toFixed(1)} ${xc.toFixed(1)},${yc.toFixed(1)}`;
    }
    const last = pts[pts.length - 1];
    const prev = pts[pts.length - 2];
    d += ` Q${prev.x.toFixed(1)},${prev.y.toFixed(1)} ${last.x.toFixed(1)},${last.y.toFixed(1)}`;
    d += ` L${last.x.toFixed(1)},${height} Z`;
    return d;
  }, [pathPoints, height, showArea]);

  // Time labels (bottom X-axis)
  const timeLabels = useMemo(() => {
    const labels = 5;
    return Array.from({ length: labels }, (_, i) => {
      const idx = Math.round((i / (labels - 1)) * (pathPoints.length - 1));
      const pt = pathPoints[Math.min(idx, pathPoints.length - 1)];
      return { x: pt.x, label: formatTimeLabel(pt.time, idx, pathPoints.length) };
    });
  }, [pathPoints]);

  // Grilla horizontal (referencia visual, sin labels de precio).
  const gridLines = useMemo(() => {
    if (!showGrid) return [];
    const steps = 3;
    return Array.from({ length: steps }, (_, i) => ((i + 1) / (steps + 1)) * height);
  }, [showGrid, height]);

  // Hover state
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // Find nearest point to mouse X
  const findNearestPoint = (mouseX: number): number | null => {
    if (pathPoints.length === 0) return null;
    let closest = 0;
    let minDist = Infinity;
    for (let i = 0; i < pathPoints.length; i++) {
      const dist = Math.abs(pathPoints[i].x - mouseX);
      if (dist < minDist) {
        minDist = dist;
        closest = i;
      }
    }
    return closest;
  };

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const idx = findNearestPoint(mouseX);
    setHoverIndex(idx);
  };

  const handleMouseLeave = () => {
    setHoverIndex(null);
  };

  const hoveredPoint = hoverIndex !== null ? pathPoints[hoverIndex] : null;

  return (
    <div className={`w-full ${className}`} style={{ width, height }} aria-label="Gráfico de precio">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-full"
        role="img"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        style={{ cursor: 'crosshair' }}
      >
        {/* Grilla: debajo de área y línea para no competir con el dato */}
        {gridLines.map((y, i) => (
          <line
            key={`grid-${i}`}
            x1={0}
            y1={y}
            x2={width}
            y2={y}
            stroke={strokeColor}
            strokeWidth={1}
            strokeDasharray="2 4"
            strokeOpacity={0.15}
            vectorEffect="non-scaling-stroke"
          />
        ))}

        {/* Área bajo la curva */}
        {areaD && (
          <path d={areaD} fill={fillColor} fillOpacity={0.6} />
        )}

        {/* Línea de precio */}
        <path
          d={pathD}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />

        {/* Hover indicator: vertical line + tooltip */}
        {hoveredPoint && (
          <g>
            {/* Línea vertical */}
            <line
              x1={hoveredPoint.x}
              y1={0}
              x2={hoveredPoint.x}
              y2={height}
              stroke={strokeColor}
              strokeWidth={1}
              strokeDasharray="4 4"
              strokeOpacity={0.6}
            />
            {/* Tooltip background */}
            <rect
              x={hoveredPoint.x + 10 > width - 120 ? hoveredPoint.x - 130 : hoveredPoint.x + 10}
              y={hoveredPoint.y - 45 > 0 ? hoveredPoint.y - 45 : 5}
              width={120}
              height={40}
              rx={6}
              fill="#1a1a2e"
              fillOpacity={0.95}
              stroke={strokeColor}
              strokeWidth={1}
            />
            {/* Tooltip text */}
            <text
              x={hoveredPoint.x + 10 > width - 120 ? hoveredPoint.x - 120 : hoveredPoint.x + 20}
              y={hoveredPoint.y - 45 > 0 ? hoveredPoint.y - 28 : 17}
              fill="white"
              fontSize="11"
              fontWeight="600"
              fontFamily="system-ui, sans-serif"
            >
              {formatPrice(hoveredPoint.price)}
            </text>
            <text
              x={hoveredPoint.x + 10 > width - 120 ? hoveredPoint.x - 120 : hoveredPoint.x + 20}
              y={hoveredPoint.y - 45 > 0 ? hoveredPoint.y - 15 : 30}
              fill="white"
              fillOpacity={0.7}
              fontSize="10"
              fontFamily="system-ui, sans-serif"
            >
              {formatDateTime(hoveredPoint.time)}
            </text>
          </g>
        )}

        {/* Puntos en hover. La transición va por CSS (clase de Tailwind),
            no como atributo SVG: `transition` no existe en SVGProps y el
            atributo crudo tampoco produce animación. */}
        {pathPoints.map((pt, i) => (
          <circle
            key={i}
            cx={pt.x}
            cy={pt.y}
            r={3}
            fill={strokeColor}
            opacity={hoverIndex === i ? 1 : 0}
            className="transition-opacity duration-150"
          />
        ))}

        {/* Labels de tiempo abajo (X-axis) */}
        {timeLabels.map((tl, i) => (
          <text
            key={i}
            x={tl.x}
            y={height - 4}
            textAnchor="middle"
            fontSize="9"
            fill="currentColor"
            fillOpacity={0.5}
          >
            {tl.label}
          </text>
        ))}
      </svg>
    </div>
  );
};