import { cn, healthColor, healthBg, healthLabel } from '@/lib/utils';

interface MetricCardProps {
  label: string;
  value: string | number;
  unit?: string;
  score?: number;
  trend?: 'up' | 'down' | 'flat';
  className?: string;
}

export function MetricCard({ label, value, unit, score, trend, className }: MetricCardProps) {
  return (
    <div className={cn('rounded-lg border bg-white p-4 shadow-sm', className)}>
      <p className="text-xs text-gray-500 uppercase tracking-wide">{label}</p>
      <div className="mt-1 flex items-baseline gap-2">
        <span className={cn('text-2xl font-bold', score != null && healthColor(score))}>
          {typeof value === 'number' ? Math.round(value * 10) / 10 : value}
        </span>
        {unit && <span className="text-sm text-gray-400">{unit}</span>}
        {trend && (
          <span className={cn('text-xs', trend === 'up' ? 'text-health-green' : trend === 'down' ? 'text-health-red' : 'text-gray-400')}>
            {trend === 'up' ? '↑' : trend === 'down' ? '↓' : '→'}
          </span>
        )}
      </div>
      {score != null && (
        <div className="mt-2">
          <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
            <div
              className={cn('h-full rounded-full transition-all', healthBg(score))}
              style={{ width: `${Math.min(100, Math.max(0, score))}%` }}
            />
          </div>
          <p className={cn('text-xs mt-1', healthColor(score))}>{healthLabel(score)}</p>
        </div>
      )}
    </div>
  );
}
