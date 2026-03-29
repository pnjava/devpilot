'use client';

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { cn, healthColor, healthLabel } from '@/lib/utils';

interface HealthGaugeProps {
  score: number;
  label: string;
  size?: number;
}

export function HealthGauge({ score, label, size = 140 }: HealthGaugeProps) {
  const clamped = Math.min(100, Math.max(0, score));
  const data = [
    { name: 'score', value: clamped },
    { name: 'remaining', value: 100 - clamped },
  ];

  const fillColor = clamped >= 70 ? '#22c55e' : clamped >= 40 ? '#f59e0b' : '#ef4444';

  return (
    <div className="flex flex-col items-center">
      <ResponsiveContainer width={size} height={size}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={size * 0.3}
            outerRadius={size * 0.42}
            startAngle={90}
            endAngle={-270}
            dataKey="value"
            stroke="none"
          >
            <Cell fill={fillColor} />
            <Cell fill="#e5e7eb" />
          </Pie>
          <Tooltip formatter={(v: number) => `${Math.round(v)}%`} />
        </PieChart>
      </ResponsiveContainer>
      <div className="text-center -mt-2">
        <p className={cn('text-xl font-bold', healthColor(score))}>{Math.round(score)}</p>
        <p className="text-xs text-gray-500">{label}</p>
        <p className={cn('text-xs font-medium', healthColor(score))}>{healthLabel(score)}</p>
      </div>
    </div>
  );
}
